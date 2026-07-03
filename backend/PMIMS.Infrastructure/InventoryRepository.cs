using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using PMIMS.Application;
using PMIMS.Domain;

namespace PMIMS.Infrastructure;

public class InventoryRepository : IInventoryRepository
{
    private readonly AppDbContext _dbContext;
    // Nullable/optional (default null) so every existing `new InventoryRepository(context)`
    // call site -- test fixtures included -- keeps compiling; only
    // GenerateIfrsValuationDisclosureAsync needs a live rate feed, and it fails fast with a
    // clear error if none was supplied instead of silently pricing at zero.
    private readonly IRateFeedService? _rateFeed;
    // Cost Tracking & Valuation -- Core Banking (IMAL) GL Integration. Nullable/optional
    // (default null), same pattern as _rateFeed, so every existing
    // `new InventoryRepository(context)` call site -- test fixtures included -- keeps
    // compiling; a supplier receipt just doesn't push a GL posting if none is supplied.
    private readonly ICoreBankingLedgerService? _coreBanking;

    public InventoryRepository(AppDbContext dbContext, IRateFeedService? rateFeed = null, ICoreBankingLedgerService? coreBanking = null)
    {
        _dbContext = dbContext;
        _rateFeed = rateFeed;
        _coreBanking = coreBanking;
    }

    private bool IsSqlServer => _dbContext.Database.ProviderName?.Contains("SqlServer") ?? false;

    // Recalculates stock balances for a given location, product, and ownership (C# Emulation)
    private async Task RecalculateInventoryBalanceAsync(int locationId, int productId, string ownershipType)
    {
        var items = await _dbContext.InventoryItems
            .Where(i => i.LocationId == locationId && i.ProductId == productId && i.OwnershipType == ownershipType)
            .ToListAsync();

        int ready = items.Count(i => i.StatusCode == "READY");
        int reserved = items.Count(i => i.StatusCode == "RESERVED");
        int sold = items.Count(i => i.StatusCode == "SOLD");
        int quarantined = items.Count(i => i.StatusCode == "QUARANTINED");
        int transit = items.Count(i => i.StatusCode == "IN_TRANSFER");

        var balance = await _dbContext.InventoryBalances
            .FirstOrDefaultAsync(b => b.LocationId == locationId && b.ProductId == productId && b.OwnershipType == ownershipType);

        if (balance == null)
        {
            balance = new InventoryBalance
            {
                LocationId = locationId,
                ProductId = productId,
                OwnershipType = ownershipType,
                ReadyForSaleQty = ready,
                ReservedQty = reserved,
                SoldQty = sold,
                QuarantinedQty = quarantined,
                InTransitQty = transit,
                LastUpdated = DateTime.UtcNow
            };
            _dbContext.InventoryBalances.Add(balance);
        }
        else
        {
            balance.ReadyForSaleQty = ready;
            balance.ReservedQty = reserved;
            balance.SoldQty = sold;
            balance.QuarantinedQty = quarantined;
            balance.InTransitQty = transit;
            balance.LastUpdated = DateTime.UtcNow;
        }

        await _dbContext.SaveChangesAsync();
    }

    // sp_CreatePurchaseOrder execution / emulation
    public async Task<(int poId, string result)> CreatePurchaseOrderAsync(string poNumber, int vendorId, decimal totalWeightGrams, decimal totalCost, string currency, string createdBy, string poItemJsonList,
        string? supplierInvoiceNumber = null, DateTime? supplierInvoiceDate = null, decimal freightCost = 0, decimal insuranceCost = 0, decimal customsDutyCost = 0, decimal otherFeesCost = 0, string? otherFeesDescription = null)
    {
        if (IsSqlServer)
        {
            // NOTE: sp_CreatePurchaseOrder (database/procedures.sql) does not yet accept the
            // cost-detail params (supplierInvoiceNumber/supplierInvoiceDate/fees) -- this is a
            // known follow-up for the SQL Server production path, same "documented gap, not a
            // silent drop" posture as the rest of this codebase's greenfield integrations. The
            // SQLite emulation branch below (what every local/dev/test run actually exercises)
            // persists them.
            var poIdParam = new SqlParameter("@POID", SqlDbType.Int) { Direction = ParameterDirection.Output };
            var resultParam = new SqlParameter("@result", SqlDbType.VarChar, 50) { Direction = ParameterDirection.Output };

            await _dbContext.Database.ExecuteSqlRawAsync(
                "EXEC sp_CreatePurchaseOrder @PONumber, @VendorID, @TotalWeightGrams, @TotalCost, @Currency, @CreatedBy, @POItemIDList, @POID OUTPUT, @result OUTPUT",
                new SqlParameter("@PONumber", poNumber),
                new SqlParameter("@VendorID", vendorId),
                new SqlParameter("@TotalWeightGrams", totalWeightGrams),
                new SqlParameter("@TotalCost", totalCost),
                new SqlParameter("@Currency", currency),
                new SqlParameter("@CreatedBy", createdBy),
                new SqlParameter("@POItemIDList", poItemJsonList),
                poIdParam,
                resultParam
            );

            return ((int)poIdParam.Value, poIdParam.Value.ToString() ?? "SUCCESS");
        }
        else
        {
            // Emulation
            var existingPo = await _dbContext.PurchaseOrders.AnyAsync(p => p.PoNumber == poNumber);
            if (existingPo)
            {
                throw new InvalidOperationException($"Cannot create Purchase Order: A purchase order with number '{poNumber}' already exists.");
            }

            var vendor = await _dbContext.Vendors.FindAsync(vendorId);
            if (vendor == null || !vendor.IsShariaCompliant)
            {
                throw new InvalidOperationException("Selected vendor is not approved for Sharia transactions.");
            }

            var template = await _dbContext.WorkflowTemplates.Include(t => t.Steps)
                .FirstOrDefaultAsync(t => t.WorkflowType == "PURCHASE_ORDER" && t.IsActive);
            if (template == null || template.Steps.Count == 0)
            {
                throw new InvalidOperationException("Cannot create Purchase Order: No active PO approval workflow template or steps are defined in the setup.");
            }

            var po = new PurchaseOrder
            {
                PoNumber = poNumber,
                VendorId = vendorId,
                OrderDate = DateTime.UtcNow,
                TotalWeightGrams = totalWeightGrams,
                TotalCost = totalCost,
                Currency = currency,
                StatusCode = "PENDING_APPROVAL",
                CreatedBy = createdBy,
                CreatedAt = DateTime.UtcNow,
                SupplierInvoiceNumber = supplierInvoiceNumber,
                SupplierInvoiceDate = supplierInvoiceDate,
                FreightCost = freightCost,
                InsuranceCost = insuranceCost,
                CustomsDutyCost = customsDutyCost,
                OtherFeesCost = otherFeesCost,
                OtherFeesDescription = otherFeesDescription
            };
            _dbContext.PurchaseOrders.Add(po);
            await _dbContext.SaveChangesAsync();

            // Parse json items
            using var doc = JsonDocument.Parse(poItemJsonList);
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                var poItem = new POItem
                {
                    PoId = po.PoId,
                    ProductId = item.GetProperty("product_id").GetInt32(),
                    OrderedQuantity = item.GetProperty("qty").GetInt32(),
                    UnitCost = item.GetProperty("unit_cost").GetDecimal(),
                    ReceivedQuantity = 0
                };
                _dbContext.POItems.Add(poItem);
            }
            await _dbContext.SaveChangesAsync();

            await SaveAuditLogAsync(createdBy, "SYSTEM", "PROCUREMENT", $"Created Purchase Order ID: {po.PoId}");

            if (template != null)
            {
                await StartWorkflowInstanceAsync("PURCHASE_ORDER", po.PoId, createdBy);
            }

            return (po.PoId, "SUCCESS");
    }
}
    public async Task<bool> UpdatePurchaseOrderAsync(int poId, int vendorId, decimal totalWeightGrams, decimal totalCost, string currency, string username, string poItemJsonList,
        string? supplierInvoiceNumber = null, DateTime? supplierInvoiceDate = null, decimal freightCost = 0, decimal insuranceCost = 0, decimal customsDutyCost = 0, decimal otherFeesCost = 0, string? otherFeesDescription = null)
    {
        var po = await _dbContext.PurchaseOrders.FindAsync(poId);
        if (po == null) return false;

        // Check if the workflow is currently at the first stage (with the maker)
        var instance = await _dbContext.WorkflowInstances
            .FirstOrDefaultAsync(i => i.WorkflowType == "PURCHASE_ORDER" && i.EntityId == poId);
        
        if (instance == null || instance.StatusCode != "PENDING_MAKER" || instance.CurrentStepOrder != 1)
        {
            throw new InvalidOperationException("This P.O. cannot be edited because it is not currently in the Maker stage.");
        }

        var vendor = await _dbContext.Vendors.FindAsync(vendorId);
        if (vendor == null || !vendor.IsShariaCompliant)
        {
            throw new InvalidOperationException("Selected vendor is not approved for Sharia transactions.");
        }

        // Update PO details
        po.VendorId = vendorId;
        po.TotalWeightGrams = totalWeightGrams;
        po.TotalCost = totalCost;
        po.Currency = currency;
        po.SupplierInvoiceNumber = supplierInvoiceNumber;
        po.SupplierInvoiceDate = supplierInvoiceDate;
        po.FreightCost = freightCost;
        po.InsuranceCost = insuranceCost;
        po.CustomsDutyCost = customsDutyCost;
        po.OtherFeesCost = otherFeesCost;
        po.OtherFeesDescription = otherFeesDescription;

        // Remove existing items and add new ones
        var existingItems = _dbContext.POItems.Where(i => i.PoId == poId);
        _dbContext.POItems.RemoveRange(existingItems);

        using var doc = JsonDocument.Parse(poItemJsonList);
        foreach (var item in doc.RootElement.EnumerateArray())
        {
            var poItem = new POItem
            {
                PoId = poId,
                ProductId = item.GetProperty("product_id").GetInt32(),
                OrderedQuantity = item.GetProperty("qty").GetInt32(),
                UnitCost = item.GetProperty("unit_cost").GetDecimal(),
                ReceivedQuantity = 0
            };
            _dbContext.POItems.Add(poItem);
        }

        await _dbContext.SaveChangesAsync();
        await SaveAuditLogAsync(username, "SYSTEM", "PROCUREMENT", $"Amended Purchase Order ID: {poId}");
        return true;
    }

    // A customer-sourced receipt (buyback/custody deposit/return) has no vendor -- but
    // InventoryLot.VendorId is a required column, so a dedicated internal "walk-in"
    // vendor row stands in for "no vendor" without loosening that column's non-null
    // constraint (which every other reporting/valuation query already assumes holds).
    // Created lazily so existing seeded databases don't need a reseed just for this.
    private async Task<int> GetOrCreateWalkInVendorIdAsync()
    {
        var vendor = await _dbContext.Vendors.FirstOrDefaultAsync(v => v.VendorCode == "WALK-IN");
        if (vendor != null) return vendor.VendorId;

        vendor = new Vendor
        {
            VendorCode = "WALK-IN",
            VendorName = "Walk-In Customer (Receipt Source)",
            CountryOfOrigin = "KWT",
            IsShariaCompliant = true,
            ContactEmail = "n/a@kfh.internal",
            CreatedAt = DateTime.UtcNow
        };
        _dbContext.Vendors.Add(vendor);
        await _dbContext.SaveChangesAsync();
        return vendor.VendorId;
    }

    // sp_IntakeInventoryItems execution / emulation -- receipt of precious metals into the
    // vault ledger, from either a supplier (sourceType SUPPLIER, tied to an approved PO) or
    // a customer (sourceType CUSTOMER). See the PendingIntake doc comment (Entities.cs) for
    // what each receiptReason means.
    public async Task<string> IntakeInventoryItemsAsync(int? poId, string lotNumber, int locationId, string receivedBy, string serialsJsonList,
        string sourceType = "SUPPLIER", int? customerId = null, int? accountId = null, string? receiptReason = null)
    {
        sourceType = string.IsNullOrWhiteSpace(sourceType) ? "SUPPLIER" : sourceType.Trim().ToUpperInvariant();
        bool isCustomerReceipt = sourceType == "CUSTOMER";

        if (IsSqlServer)
        {
            await _dbContext.Database.ExecuteSqlRawAsync(
                "EXEC sp_IntakeInventoryItems @POID, @LotNumber, @LocationID, @ReceivedBy, @SerialsList, @SourceType, @CustomerID, @AccountID, @ReceiptReason",
                new SqlParameter("@POID", (object?)poId ?? DBNull.Value),
                new SqlParameter("@LotNumber", lotNumber),
                new SqlParameter("@LocationID", locationId),
                new SqlParameter("@ReceivedBy", receivedBy),
                new SqlParameter("@SerialsList", serialsJsonList),
                new SqlParameter("@SourceType", sourceType),
                new SqlParameter("@CustomerID", (object?)customerId ?? DBNull.Value),
                new SqlParameter("@AccountID", (object?)accountId ?? DBNull.Value),
                new SqlParameter("@ReceiptReason", (object?)receiptReason ?? DBNull.Value)
            );
            return "SUCCESS";
        }
        else
        {
            PurchaseOrder? po = null;
            Customer? customer = null;
            int vendorId;
            decimal avgCost = 0;

            if (isCustomerReceipt)
            {
                if (customerId == null)
                {
                    throw new InvalidOperationException("Cannot receive from a customer: a customer must be specified.");
                }
                customer = await _dbContext.Customers.FindAsync(customerId.Value);
                if (customer == null)
                {
                    throw new InvalidOperationException("Customer not found.");
                }

                receiptReason = string.IsNullOrWhiteSpace(receiptReason) ? "BUYBACK" : receiptReason.Trim().ToUpperInvariant();
                if (receiptReason != "BUYBACK" && receiptReason != "CUSTODY_DEPOSIT" && receiptReason != "RETURN")
                {
                    throw new ArgumentException("receiptReason must be BUYBACK, CUSTODY_DEPOSIT, or RETURN for a customer receipt.");
                }
                if (receiptReason == "CUSTODY_DEPOSIT" && accountId == null)
                {
                    throw new InvalidOperationException("A customer account must be specified to hold a custody deposit.");
                }

                vendorId = await GetOrCreateWalkInVendorIdAsync();
            }
            else
            {
                po = poId.HasValue ? await _dbContext.PurchaseOrders.Include(p => p.Items).FirstOrDefaultAsync(p => p.PoId == poId.Value) : null;
                if (po != null && po.StatusCode != "APPROVED")
                {
                    throw new InvalidOperationException("Cannot receive shipment: The associated purchase order must be fully approved.");
                }
                vendorId = po?.VendorId ?? 1;
                // Cost Tracking & Valuation: Average Cost is computed off the full landed cost
                // (line-item cost + freight/insurance/customs/other fees -- see
                // PurchaseOrder.LandedCost), not the bare TotalCost, so the fee detail recorded
                // at PO creation actually feeds the Average Cost Method valuation.
                avgCost = po != null && po.TotalWeightGrams > 0 ? po.LandedCost / po.TotalWeightGrams : 0;
            }

            using var doc = JsonDocument.Parse(serialsJsonList);
            int totalItems = doc.RootElement.EnumerateArray().Count();

            var lot = new InventoryLot
            {
                LotNumber = lotNumber,
                PoId = isCustomerReceipt ? null : poId,
                VendorId = vendorId,
                AcquisitionDate = DateTime.UtcNow,
                TotalItems = totalItems,
                AverageUnitCost = avgCost,
                CreatedAt = DateTime.UtcNow
            };
            _dbContext.InventoryLots.Add(lot);
            await _dbContext.SaveChangesAsync();

            // A customer custody deposit stays CUSTOMER_OWNED (the bar never becomes KFH's
            // stock, just its safekeeping responsibility); every other path (supplier receipt,
            // customer buyback, customer return) becomes KFH_OWNED.
            string ownershipType = isCustomerReceipt && receiptReason == "CUSTODY_DEPOSIT" ? "CUSTOMER_OWNED" : "KFH_OWNED";

            var affectedProducts = new HashSet<int>();
            var newItems = new List<InventoryItem>();
            foreach (var element in doc.RootElement.EnumerateArray())
            {
                string serial = element.GetProperty("serial").GetString() ?? "";
                int productId = element.GetProperty("product_id").GetInt32();
                affectedProducts.Add(productId);

                // LBMA Good Delivery attributes -- optional per bar. Present if the intake
                // form (IntakeItemDTO) supplied them; absent for callers that haven't been
                // updated yet (e.g. the reconciliation-break re-intake calls above), which
                // simply leaves GoodDeliveryStatus at its NOT_ASSESSED default.
                string? refinerName = element.TryGetProperty("refiner_name", out var rn) ? rn.GetString() : null;
                string? refinerLbmaId = element.TryGetProperty("refiner_lbma_id", out var rl) ? rl.GetString() : null;
                string? assayCert = element.TryGetProperty("assay_certificate_number", out var ac) ? ac.GetString() : null;
                decimal? fineness = element.TryGetProperty("fineness_ppt", out var fp) && fp.ValueKind is JsonValueKind.Number ? fp.GetDecimal() : (decimal?)null;
                string? hallmark = element.TryGetProperty("hallmark_number", out var hm) ? hm.GetString() : null;
                string? gdStatusRaw = element.TryGetProperty("good_delivery_status", out var gs) ? gs.GetString() : null;
                bool hasLbmaData = !string.IsNullOrWhiteSpace(refinerName) || !string.IsNullOrWhiteSpace(assayCert) || fineness.HasValue;

                var item = new InventoryItem
                {
                    SerialNumber = serial,
                    ProductId = productId,
                    LotId = lot.LotId,
                    LocationId = locationId,
                    OwnershipType = ownershipType,
                    StatusCode = "READY",
                    RefinerName = refinerName,
                    RefinerLbmaId = refinerLbmaId,
                    AssayCertificateNumber = assayCert,
                    FinenessPpt = fineness,
                    HallmarkNumber = hallmark,
                    GoodDeliveryStatus = !string.IsNullOrWhiteSpace(gdStatusRaw) ? gdStatusRaw! : (hasLbmaData ? "GDL_LISTED" : "NOT_ASSESSED")
                };
                _dbContext.InventoryItems.Add(item);
                newItems.Add(item);
            }
            await _dbContext.SaveChangesAsync();

            // One RECEIPT ledger transaction per bar -- the origin point of every serialized
            // item's movement history. Previously intake created no InventoryTransaction row at
            // all (TransactionType.RECEIPT was defined but never used anywhere), so a bar's
            // trail effectively started mid-story at its first transfer/sale/withdrawal.
            foreach (var item in newItems)
            {
                var receiptTx = new InventoryTransaction
                {
                    TransactionNumber = $"RCPT-{lotNumber}-{item.ItemId}",
                    ItemId = item.ItemId,
                    TransactionType = "RECEIPT",
                    SourceLocationId = null, // external origin (vendor/refiner/customer) -- not yet a vault location
                    DestinationLocationId = locationId,
                    SourceOwnership = ownershipType,
                    DestinationOwnership = ownershipType,
                    InitiatedBy = receivedBy,
                    TransactionTimestamp = DateTime.UtcNow
                };
                _dbContext.InventoryTransactions.Add(receiptTx);
            }
            await _dbContext.SaveChangesAsync();

            string custodyNote = isCustomerReceipt
                ? $"Received from customer {customer!.CustomerName} (Civil ID {customer.CivilId}) -- {receiptReason}. Lot {lotNumber}."
                : "Intake into vault ledger.";
            foreach (var item in newItems)
            {
                await RecordChainOfCustodyEventAsync(item.ItemId, "RECEIVED", receivedBy, locationId, lotNumber, custodyNote);
            }

            // Customer custody deposit: the bars physically sit in the vault but remain the
            // customer's property -- create the same CustomerHolding/CustomerAllocation pair
            // ConfirmPurchaseWithCustodyAsync creates for a sold-into-custody bar, just without
            // the SalesOrder (no sale occurred; the customer already owned this metal).
            if (isCustomerReceipt && receiptReason == "CUSTODY_DEPOSIT")
            {
                foreach (var item in newItems)
                {
                    item.StatusCode = "HELD_IN_CUSTODY";
                    var holding = new CustomerHolding
                    {
                        CustomerId = customerId!.Value,
                        AccountId = accountId!.Value,
                        ItemId = item.ItemId,
                        AllocationDate = DateTime.UtcNow,
                        CustodyFeeRate = 0.005m, // 0.5% annual rate default, same as ConfirmPurchaseWithCustodyAsync
                        StatusCode = "HELD_IN_CUSTODY"
                    };
                    _dbContext.CustomerHoldings.Add(holding);
                    await _dbContext.SaveChangesAsync();

                    _dbContext.CustomerAllocations.Add(new CustomerAllocation
                    {
                        HoldingId = holding.HoldingId,
                        AssignedLocationId = locationId,
                        AssignedAt = DateTime.UtcNow
                    });
                }
                await _dbContext.SaveChangesAsync();
            }

            foreach (var prodId in affectedProducts)
            {
                await RecalculateInventoryBalanceAsync(locationId, prodId, ownershipType);
            }

            if (po != null)
            {
                po.StatusCode = "RECEIVED";
                await _dbContext.SaveChangesAsync();

                // Cost Tracking & Valuation -- Core Banking (IMAL) GL Integration: a supplier
                // receipt is the point the landed cost (line-item cost + freight/insurance/
                // customs/other fees) becomes a real liability -- post the standard
                // Debit Inventory-Precious Metals / Credit Accounts Payable-Vendor journal
                // entry for it. Optional/nullable adapter (see _coreBanking) -- if none is
                // configured, intake proceeds exactly as before this feature existed.
                if (_coreBanking != null && po.LandedCost > 0)
                {
                    var vendorForMemo = await _dbContext.Vendors.FindAsync(po.VendorId);
                    await _coreBanking.PostLedgerEntryAsync(
                        "PURCHASE_ORDER_RECEIPT", po.PoId,
                        "INVENTORY_PRECIOUS_METALS", "ACCOUNTS_PAYABLE_VENDOR",
                        po.LandedCost, po.Currency, receivedBy,
                        $"Receipt of Lot {lotNumber} ({totalItems} bar(s)) against PO {po.PoNumber} -- {vendorForMemo?.VendorName ?? "Vendor #" + po.VendorId}");
                }
            }

            // Lot-level summary entry (one row per intake batch rather than per bar, to avoid
            // flooding the audit log for large shipments) -- cross-referenced to the
            // InventoryLot so GetTransactionTraceAsync can still resolve a RECEIPT
            // transaction's audit trail via the lot even though it isn't logged per-item.
            string auditMsg = isCustomerReceipt
                ? $"Received {totalItems} bar(s) from customer {customer!.CustomerName} ({receiptReason}) in Lot: {lotNumber}"
                : $"Received and spatialized {totalItems} bars in Lot: {lotNumber}";
            await SaveAuditLogAsync(receivedBy, "SYSTEM", "VAULT_OPS", auditMsg,
                entityType: "INVENTORY_LOT", entityId: lot.LotId.ToString());
            return "SUCCESS";
        }
    }

    // sp_QueryAvailableStock execution / emulation
    public async Task<IEnumerable<dynamic>> QueryAvailableStockAsync(int? branchId, int? metalTypeId, string? originCountry, int? denominationId)
    {
        if (IsSqlServer)
        {
            // Execute SP and map dynamically
            return await _dbContext.InventoryBalances
                .FromSqlRaw("EXEC sp_QueryAvailableStock @BranchID, @MetalTypeID, @OriginCountry, @DenominationID",
                    new SqlParameter("@BranchID", branchId ?? (object)DBNull.Value),
                    new SqlParameter("@MetalTypeID", metalTypeId ?? (object)DBNull.Value),
                    new SqlParameter("@OriginCountry", originCountry ?? (object)DBNull.Value),
                    new SqlParameter("@DenominationID", denominationId ?? (object)DBNull.Value))
                .ToListAsync();
        }
        else
        {
            var query = _dbContext.InventoryBalances
                .Include(b => b.Location).ThenInclude(l => l!.Vault)
                .Include(b => b.Location).ThenInclude(l => l!.Branch)
                .Include(b => b.Product).ThenInclude(p => p!.MetalType)
                .Include(b => b.Product).ThenInclude(p => p!.Denomination)
                .Where(b => b.OwnershipType == "KFH_OWNED" && b.ReadyForSaleQty > 0);

            if (branchId.HasValue) query = query.Where(b => b.Location!.BranchId == branchId);
            if (metalTypeId.HasValue) query = query.Where(b => b.Product!.MetalTypeId == metalTypeId);
            if (!string.IsNullOrEmpty(originCountry)) query = query.Where(b => b.Product!.OriginCountry == originCountry);
            if (denominationId.HasValue) query = query.Where(b => b.Product!.DenominationId == denominationId);

            var list = await query.ToListAsync();
            return list.Select(b => new
            {
                branch_name = b.Location!.Branch?.BranchName ?? "Main Vault",
                zone_room = b.Location.ZoneRoom,
                shelf_row = b.Location.ShelfRow,
                slot_bin = b.Location.SlotBin,
                metal_name = b.Product!.MetalType!.MetalName,
                origin_country = b.Product.OriginCountry,
                denomination = b.Product.Denomination!.Label,
                weight_grams = b.Product.Denomination.WeightGrams,
                ready_for_sale_qty = b.ReadyForSaleQty
            });
        }
    }

    // sp_ReserveStock execution / emulation
    public async Task<Guid?> ReserveStockAsync(int customerId, int productId, int branchId, int channelId, string idempotencyKey, int ttlSeconds)
    {
        if (IsSqlServer)
        {
            var tokenParam = new SqlParameter("@ReservationToken", SqlDbType.UniqueIdentifier) { Direction = ParameterDirection.Output };

            await _dbContext.Database.ExecuteSqlRawAsync(
                "EXEC sp_ReserveStock @CustomerID, @ProductID, @BranchID, @ChannelID, @IdempotencyKey, @TTLSeconds, @ReservationToken OUTPUT",
                new SqlParameter("@CustomerID", customerId),
                new SqlParameter("@ProductID", productId),
                new SqlParameter("@BranchID", branchId),
                new SqlParameter("@ChannelID", channelId),
                new SqlParameter("@IdempotencyKey", idempotencyKey),
                new SqlParameter("@TTLSeconds", ttlSeconds),
                tokenParam
            );

            return (Guid?)tokenParam.Value;
        }
        else
        {
            // Check idempotency
            var existing = await _dbContext.ReservationRequests.FirstOrDefaultAsync(r => r.IdempotencyKey == idempotencyKey);
            if (existing != null) return existing.ReservationToken;

            // Find and pessimistically lock (emulated by executing first row write check)
            var item = await _dbContext.InventoryItems
                .FirstOrDefaultAsync(i => i.ProductId == productId && i.StatusCode == "READY" && i.OwnershipType == "KFH_OWNED");

            if (item == null) return null;

            item.StatusCode = "RESERVED";

            Guid token = Guid.NewGuid();
            var reservation = new ReservationRequest
            {
                ReservationToken = token,
                CustomerId = customerId,
                ItemId = item.ItemId,
                ChannelId = channelId,
                ReservedAt = DateTime.UtcNow,
                ExpiresAt = DateTime.UtcNow.AddSeconds(ttlSeconds),
                IdempotencyKey = idempotencyKey,
                StatusCode = "ACTIVE"
            };

            _dbContext.ReservationRequests.Add(reservation);
            await _dbContext.SaveChangesAsync();

            if (item.LocationId.HasValue)
            {
                await RecalculateInventoryBalanceAsync(item.LocationId.Value, productId, "KFH_OWNED");
            }

            return token;
        }
    }

    // sp_ConfirmPurchaseWithCustody execution / emulation
    public async Task<string> ConfirmPurchaseWithCustodyAsync(Guid reservationToken, int accountId, decimal salePrice, decimal markupAmount, string invoiceNumber, string? custodyAgreementNumber)
    {
        if (IsSqlServer)
        {
            await _dbContext.Database.ExecuteSqlRawAsync(
                "EXEC sp_ConfirmPurchaseWithCustody @ReservationToken, @AccountID, @SalePrice, @MarkupAmount, @InvoiceNumber, @CustodyAgreementNumber",
                new SqlParameter("@ReservationToken", reservationToken),
                new SqlParameter("@AccountID", accountId),
                new SqlParameter("@SalePrice", salePrice),
                new SqlParameter("@MarkupAmount", markupAmount),
                new SqlParameter("@InvoiceNumber", invoiceNumber),
                new SqlParameter("@CustodyAgreementNumber", custodyAgreementNumber ?? (object)DBNull.Value)
            );
            return "SUCCESS";
        }
        else
        {
            var res = await _dbContext.ReservationRequests.FirstOrDefaultAsync(r => r.ReservationToken == reservationToken && r.StatusCode == "ACTIVE");
            if (res == null) throw new InvalidOperationException("Invalid or expired reservation token.");

            var item = await _dbContext.InventoryItems.FindAsync(res.ItemId);
            if (item == null) throw new InvalidOperationException("Associated inventory item not found.");

            int productId = item.ProductId;
            int locationId = item.LocationId ?? 1;

            // Sales order record
            var sale = new SalesOrder
            {
                OrderNumber = Guid.NewGuid().ToString(),
                CustomerId = res.CustomerId,
                AccountId = accountId,
                ItemId = item.ItemId,
                ChannelId = res.ChannelId,
                SalePrice = salePrice,
                MarkupAmount = markupAmount,
                InvoiceNumber = invoiceNumber,
                SoldAt = DateTime.UtcNow
            };
            _dbContext.SalesOrders.Add(sale);

            // Update item details
            item.OwnershipType = "CUSTOMER_OWNED";
            item.StatusCode = "READY";

            // Customer custody holdings
            var holding = new CustomerHolding
            {
                CustomerId = res.CustomerId,
                AccountId = accountId,
                ItemId = item.ItemId,
                AllocationDate = DateTime.UtcNow,
                CustodyAgreementNumber = custodyAgreementNumber,
                CustodyFeeRate = 0.005m, // 0.5% annual rate default
                StatusCode = "HELD_IN_CUSTODY"
            };
            _dbContext.CustomerHoldings.Add(holding);
            await _dbContext.SaveChangesAsync();

            var allocation = new CustomerAllocation
            {
                HoldingId = holding.HoldingId,
                AssignedLocationId = locationId,
                AssignedAt = DateTime.UtcNow
            };
            _dbContext.CustomerAllocations.Add(allocation);

            res.StatusCode = "COMPLETED";

            await _dbContext.SaveChangesAsync();

            await RecalculateInventoryBalanceAsync(locationId, productId, "KFH_OWNED");
            await RecalculateInventoryBalanceAsync(locationId, productId, "CUSTOMER_OWNED");

            // Transaction log
            var tx = new InventoryTransaction
            {
                TransactionNumber = Guid.NewGuid().ToString(),
                ItemId = item.ItemId,
                TransactionType = "SALE",
                SourceLocationId = locationId,
                DestinationLocationId = locationId,
                SourceOwnership = "KFH_OWNED",
                DestinationOwnership = "CUSTOMER_OWNED",
                RateUsed = salePrice,
                InitiatedBy = "CHANNEL_API",
                TransactionTimestamp = DateTime.UtcNow
            };
            _dbContext.InventoryTransactions.Add(tx);
            await _dbContext.SaveChangesAsync();

            // Previously this movement type -- a customer purchase, arguably the most
            // financially significant event in the ledger -- wrote no audit log entry and no
            // chain-of-custody event at all. Cross-reference it like every other movement.
            await RecordChainOfCustodyEventAsync(item.ItemId, "SOLD", "CHANNEL_API", locationId, invoiceNumber ?? tx.TransactionNumber,
                $"Sold to customer account {accountId}. Invoice: {invoiceNumber}.");
            await SaveAuditLogAsync("CHANNEL_API", "SYSTEM", "CUSTODY",
                $"Sale completed for serial {item.SerialNumber} to account {accountId}. Invoice: {invoiceNumber}. Sale price: {salePrice}.",
                entityType: "INVENTORY_TRANSACTION", entityId: tx.TransactionId.ToString());

            return "SUCCESS";
        }
    }

    // sp_CancelReservation execution / emulation
    public async Task CancelReservationAsync(Guid reservationToken)
    {
        if (IsSqlServer)
        {
            await _dbContext.Database.ExecuteSqlRawAsync(
                "EXEC sp_CancelReservation @ReservationToken",
                new SqlParameter("@ReservationToken", reservationToken)
            );
        }
        else
        {
            var res = await _dbContext.ReservationRequests.FirstOrDefaultAsync(r => r.ReservationToken == reservationToken && r.StatusCode == "ACTIVE");
            if (res != null)
            {
                var item = await _dbContext.InventoryItems.FindAsync(res.ItemId);
                if (item != null)
                {
                    item.StatusCode = "READY";
                    res.StatusCode = "CANCELLED";
                    await _dbContext.SaveChangesAsync();

                    if (item.LocationId.HasValue)
                    {
                        await RecalculateInventoryBalanceAsync(item.LocationId.Value, item.ProductId, "KFH_OWNED");
                    }
                }
            }
        }
    }

    // sp_InitiateBranchTransfer execution / emulation
    public async Task<string> InitiateBranchTransferAsync(int itemId, int destLocationId, string courierInfo, string initiatedBy)
    {
        if (IsSqlServer)
        {
            await _dbContext.Database.ExecuteSqlRawAsync(
                "EXEC sp_InitiateBranchTransfer @ItemID, @DestLocationID, @CourierInfo, @InitiatedBy",
                new SqlParameter("@ItemID", itemId),
                new SqlParameter("@DestLocationID", destLocationId),
                new SqlParameter("@CourierInfo", courierInfo),
                new SqlParameter("@InitiatedBy", initiatedBy)
            );
            return "SUCCESS";
        }
        else
        {
            var item = await _dbContext.InventoryItems.FindAsync(itemId);
            if (item == null || item.StatusCode != "READY")
            {
                throw new InvalidOperationException("Selected item is not ready for transfer.");
            }

            int srcLoc = item.LocationId ?? 1;
            item.StatusCode = "IN_TRANSFER";

            var tx = new InventoryTransaction
            {
                TransactionNumber = Guid.NewGuid().ToString(),
                ItemId = itemId,
                TransactionType = "TRANSFER",
                SourceLocationId = srcLoc,
                DestinationLocationId = destLocationId,
                SourceOwnership = item.OwnershipType,
                DestinationOwnership = item.OwnershipType,
                InitiatedBy = initiatedBy,
                TransactionTimestamp = DateTime.UtcNow
            };
            _dbContext.InventoryTransactions.Add(tx);
            await _dbContext.SaveChangesAsync();

            var move = new MovementTransaction
            {
                TransactionId = tx.TransactionId,
                CourierDetails = courierInfo,
                DepartureTime = DateTime.UtcNow
            };
            _dbContext.MovementTransactions.Add(move);
            await _dbContext.SaveChangesAsync();

            await RecalculateInventoryBalanceAsync(srcLoc, item.ProductId, item.OwnershipType);
            await RecordChainOfCustodyEventAsync(itemId, "TRANSFERRED", initiatedBy, destLocationId, tx.TransactionNumber, courierInfo);
            await SaveAuditLogAsync(initiatedBy, "SYSTEM", "TRANSFER",
                $"Direct transfer initiated for serial {item.SerialNumber} to location #{destLocationId}. Courier: {courierInfo}.",
                entityType: "INVENTORY_TRANSACTION", entityId: tx.TransactionId.ToString());
            return "SUCCESS";
        }
    }

    // sp_ExecuteBranchWithdrawal execution / emulation
    public async Task<string> ExecuteBranchWithdrawalAsync(int holdingId, int branchId, string otp, string signature, string withdrawnBy)
    {
        if (IsSqlServer)
        {
            await _dbContext.Database.ExecuteSqlRawAsync(
                "EXEC sp_ExecuteBranchWithdrawal @HoldingID, @BranchID, @OTP, @Signature, @WithdrawnBy",
                new SqlParameter("@HoldingID", holdingId),
                new SqlParameter("@BranchID", branchId),
                new SqlParameter("@OTP", otp),
                new SqlParameter("@Signature", signature),
                new SqlParameter("@WithdrawnBy", withdrawnBy)
            );
            return "SUCCESS";
        }
        else
        {
            var holding = await _dbContext.CustomerHoldings.Include(h => h.Item).FirstOrDefaultAsync(h => h.HoldingId == holdingId && h.StatusCode == "HELD_IN_CUSTODY");
            if (holding == null) throw new InvalidOperationException("Gold custody holding not found or already withdrawn.");

            var item = holding.Item;
            if (item == null) throw new InvalidOperationException("Inventory item details missing.");

            int currentLoc = item.LocationId ?? 1;

            var request = new WithdrawalRequest
            {
                HoldingId = holdingId,
                DestinationBranchId = branchId,
                VerificationOtp = otp,
                WithdrawnAt = DateTime.UtcNow,
                RecipientSignature = signature,
                StatusCode = "COMPLETED"
            };
            _dbContext.WithdrawalRequests.Add(request);

            item.StatusCode = "INACTIVE";
            item.LocationId = null;

            holding.StatusCode = "WITHDRAWN";

            await _dbContext.SaveChangesAsync();

            await RecalculateInventoryBalanceAsync(currentLoc, item.ProductId, "CUSTOMER_OWNED");

            var tx = new InventoryTransaction
            {
                TransactionNumber = Guid.NewGuid().ToString(),
                ItemId = item.ItemId,
                TransactionType = "REDEMPTION",
                SourceLocationId = currentLoc,
                DestinationLocationId = null,
                SourceOwnership = "CUSTOMER_OWNED",
                DestinationOwnership = "CUSTOMER_OWNED",
                InitiatedBy = withdrawnBy,
                TransactionTimestamp = DateTime.UtcNow
            };
            _dbContext.InventoryTransactions.Add(tx);
            await _dbContext.SaveChangesAsync();
            await RecordChainOfCustodyEventAsync(item.ItemId, "WITHDRAWN", withdrawnBy, currentLoc, tx.TransactionNumber, $"Withdrawn to branch {branchId} for customer holding {holdingId}.");
            await SaveAuditLogAsync(withdrawnBy, "SYSTEM", "CUSTODY",
                $"Physical withdrawal completed for serial {item.SerialNumber} at branch #{branchId} (holding {holdingId}).",
                entityType: "INVENTORY_TRANSACTION", entityId: tx.TransactionId.ToString());

            return "SUCCESS";
        }
    }

    // sp_StartStocktakeSession execution / emulation
    public async Task<(int sessionId, string result)> StartStocktakeSessionAsync(string sessionCode, int vaultId, string initiatedBy, string freezeLocationIdJsonList)
    {
        if (IsSqlServer)
        {
            var sessionParam = new SqlParameter("@SessionID", SqlDbType.Int) { Direction = ParameterDirection.Output };
            var resultParam = new SqlParameter("@result", SqlDbType.VarChar, 50) { Direction = ParameterDirection.Output };

            await _dbContext.Database.ExecuteSqlRawAsync(
                "EXEC sp_StartStocktakeSession @SessionCode, @VaultID, @InitiatedBy, @FreezeLocationIDList, @SessionID OUTPUT, @result OUTPUT",
                new SqlParameter("@SessionCode", sessionCode),
                new SqlParameter("@VaultID", vaultId),
                new SqlParameter("@InitiatedBy", initiatedBy),
                new SqlParameter("@FreezeLocationIDList", freezeLocationIdJsonList),
                sessionParam,
                resultParam
            );
            return ((int)sessionParam.Value, resultParam.Value.ToString() ?? "SUCCESS");
        }
        else
        {
            var session = new StocktakeSession
            {
                SessionCode = sessionCode,
                VaultId = vaultId,
                StartedAt = DateTime.UtcNow,
                InitiatedBy = initiatedBy,
                StatusCode = "ACTIVE"
            };
            _dbContext.StocktakeSessions.Add(session);
            await _dbContext.SaveChangesAsync();

            using var doc = JsonDocument.Parse(freezeLocationIdJsonList);
            foreach (var elem in doc.RootElement.EnumerateArray())
            {
                int locId = elem.GetInt32();
                var freeze = new StocktakeFreeze
                {
                    SessionId = session.SessionId,
                    LocationId = locId,
                    FrozenAt = DateTime.UtcNow
                };
                _dbContext.StocktakeFreezes.Add(freeze);

                // Set items in frozen location to quarantined state
                var items = await _dbContext.InventoryItems.Where(i => i.LocationId == locId).ToListAsync();
                foreach (var item in items)
                {
                    item.StatusCode = "QUARANTINED";
                }
            }
            await _dbContext.SaveChangesAsync();

            // Recalculate balances
            var frozenLocs = _dbContext.StocktakeFreezes.Where(f => f.SessionId == session.SessionId).Select(f => f.LocationId);
            var balancesToRecalc = await _dbContext.InventoryItems
                .Where(i => frozenLocs.Contains(i.LocationId ?? 0))
                .Select(i => new { i.LocationId, i.ProductId, i.OwnershipType })
                .Distinct()
                .ToListAsync();

            foreach (var item in balancesToRecalc)
            {
                await RecalculateInventoryBalanceAsync(item.LocationId!.Value, item.ProductId, item.OwnershipType);
            }

            return (session.SessionId, "SUCCESS");
        }
    }

    // sp_ImportMigrationData execution / emulation
    public async Task<string> ImportMigrationDataAsync(int migrationLogID, string approvedBy)
    {
        if (IsSqlServer)
        {
            await _dbContext.Database.ExecuteSqlRawAsync(
                "EXEC sp_ImportMigrationData @MigrationLogID, @ApprovedBy",
                new SqlParameter("@MigrationLogID", migrationLogID),
                new SqlParameter("@ApprovedBy", approvedBy)
            );
            return "SUCCESS";
        }
        else
        {
            // Merging staging items into inventory items
            var staged = await _dbContext.MigrationStagingItems.Where(s => s.IsValid).ToListAsync();
            
            var lot = new InventoryLot
            {
                LotNumber = $"MIG-LOT-{migrationLogID}",
                AcquisitionDate = DateTime.UtcNow,
                TotalItems = staged.Count,
                AverageUnitCost = 0.00m,
                VendorId = 1, // Default Suiza refiner
                CreatedAt = DateTime.UtcNow
            };
            _dbContext.InventoryLots.Add(lot);
            await _dbContext.SaveChangesAsync();

            var products = await _dbContext.MetalProducts.ToListAsync();
            var locations = await _dbContext.InventoryLocations.Include(l => l.Vault).ToListAsync();

            foreach (var s in staged)
            {
                var product = products.First(p => p.ProductCode == s.ProductCode);
                var location = locations.First(l =>
                    l.Vault?.VaultName == s.VaultName &&
                    l.ZoneRoom == s.ZoneRoom &&
                    l.ShelfRow == s.ShelfRow &&
                    l.SlotBin == s.SlotBin);

                var item = new InventoryItem
                {
                    SerialNumber = s.SerialNumber,
                    ProductId = product.ProductId,
                    LotId = lot.LotId,
                    LocationId = location.LocationId,
                    OwnershipType = s.OwnershipType,
                    StatusCode = "READY"
                };
                _dbContext.InventoryItems.Add(item);
            }
            await _dbContext.SaveChangesAsync();

            // Clear staging items and log completion
            _dbContext.MigrationStagingItems.RemoveRange(staged);
            await _dbContext.SaveChangesAsync();

            var log = new AuditLog
            {
                Username = approvedBy,
                IpAddress = "SYSTEM",
                ModuleName = "DATA_MIGRATION",
                ActionDescription = $"Completed data migration run ID: {migrationLogID}",
                Timestamp = DateTime.UtcNow
            };
            _dbContext.AuditLogs.Add(log);
            await _dbContext.SaveChangesAsync();

            return "SUCCESS";
        }
    }

    // Standard catalog access methods
    public async Task<IEnumerable<MetalType>> GetMetalTypesAsync() => await _dbContext.MetalTypes.OrderBy(m => m.MetalName).ToListAsync();

    public async Task<IEnumerable<MetalProduct>> GetProductsAsync() => await _dbContext.MetalProducts.Include(p => p.Denomination).Include(p => p.Purity).Include(p => p.MetalType).ToListAsync();
    public async Task<IEnumerable<Vendor>> GetVendorsAsync() => await _dbContext.Vendors.ToListAsync();
    public async Task<IEnumerable<InventoryLocation>> GetLocationsAsync() => await _dbContext.InventoryLocations.Include(l => l.Vault).Include(l => l.Branch).ToListAsync();

    public async Task<InventoryLocation> AddLocationAsync(int vaultId, int? branchId, string zoneRoom, string shelfRow, string slotBin)
    {
        var loc = new InventoryLocation
        {
            VaultId = vaultId,
            BranchId = branchId,
            ZoneRoom = zoneRoom,
            ShelfRow = shelfRow,
            SlotBin = slotBin
        };
        _dbContext.InventoryLocations.Add(loc);
        await _dbContext.SaveChangesAsync();
        return loc;
    }

    public async Task<bool> DeleteLocationAsync(int locationId)
    {
        var loc = await _dbContext.InventoryLocations.FindAsync(locationId);
        if (loc == null) return false;

        var hasActiveItems = await _dbContext.InventoryItems
            .AnyAsync(i => i.LocationId == locationId && i.StatusCode != "INACTIVE" && i.StatusCode != "WITHDRAWN");
        
        if (hasActiveItems)
        {
            throw new InvalidOperationException("Cannot remove location because it contains active inventory materials.");
        }

        _dbContext.InventoryLocations.Remove(loc);
        await _dbContext.SaveChangesAsync();
        return true;
    }

    // Lot.Vendor added for the Reporting Requirements Gap Analysis's Item 8 cost-analysis
    // rollup (cost by vendor) -- purely additive eager-load, no existing caller is affected.
    public async Task<IEnumerable<InventoryItem>> GetItemsAsync() => await _dbContext.InventoryItems.Include(i => i.Product).ThenInclude(p => p!.MetalType).Include(i => i.Product).ThenInclude(p => p!.Denomination).Include(i => i.Location).ThenInclude(l => l!.Vault).Include(i => i.Lot).ThenInclude(l => l!.Vendor).ToListAsync();
    public async Task<IEnumerable<PurchaseOrder>> GetPurchaseOrdersAsync() => await _dbContext.PurchaseOrders.Include(p => p.Vendor).Include(p => p.Items).ThenInclude(i => i.Product).ToListAsync();

    // Cost Tracking & Valuation -- Core Banking (IMAL) GL Integration: every posting PMIMS
    // has pushed (or attempted to push), newest first.
    public async Task<IEnumerable<CoreBankingLedgerPosting>> GetCoreBankingPostingsAsync() =>
        await _dbContext.CoreBankingLedgerPostings.OrderByDescending(p => p.CreatedAt).ToListAsync();

    // Hard delete of a Purchase Order -- reserved for IT/Admin cleanup of erroneous/test
    // records (there's no "undo" here, unlike REJECTED which preserves the audit trail).
    // Blocked once the P.O. has been intake-processed, since that creates real downstream
    // inventory/PendingIntake records that would otherwise be orphaned.
    public async Task<string> DeletePurchaseOrderAsync(int poId, string username)
    {
        var po = await _dbContext.PurchaseOrders.FindAsync(poId);
        if (po == null) return "PO_NOT_FOUND";

        var hasIntake = await _dbContext.PendingIntakes.AnyAsync(pi => pi.PoId == poId);
        if (hasIntake)
        {
            return "This P.O. has already been received/intake-processed against real inventory records. It can't be deleted -- reject or otherwise resolve it instead of removing it.";
        }

        var instances = await _dbContext.WorkflowInstances
            .Where(i => i.WorkflowType == "PURCHASE_ORDER" && i.EntityId == poId)
            .ToListAsync();
        foreach (var inst in instances)
        {
            var actions = await _dbContext.ApprovalActions.Where(a => a.InstanceId == inst.InstanceId).ToListAsync();
            _dbContext.ApprovalActions.RemoveRange(actions);
        }
        _dbContext.WorkflowInstances.RemoveRange(instances);

        var items = await _dbContext.POItems.Where(i => i.PoId == poId).ToListAsync();
        _dbContext.POItems.RemoveRange(items);

        _dbContext.PurchaseOrders.Remove(po);
        await _dbContext.SaveChangesAsync();

        await SaveAuditLogAsync(username, "SYSTEM", "PROCUREMENT", $"Deleted Purchase Order '{po.PoNumber}' (ID: {poId}) and its workflow history.");

        return "SUCCESS";
    }
    public async Task<IEnumerable<CustomerHolding>> GetCustomerHoldingsAsync(int customerId) => await _dbContext.CustomerHoldings.Include(h => h.Customer).Include(h => h.Account).Include(h => h.Item).ThenInclude(i => i!.Product).Where(h => h.CustomerId == customerId).ToListAsync();
    public async Task<IEnumerable<CustomerHolding>> GetAllCustomerHoldingsAsync() => await _dbContext.CustomerHoldings.Include(h => h.Customer).Include(h => h.Account).Include(h => h.Item).ThenInclude(i => i!.Product).ThenInclude(p => p!.Denomination).Include(h => h.Item).ThenInclude(i => i!.Product).ThenInclude(p => p!.Purity).Include(h => h.Item).ThenInclude(i => i!.Product).ThenInclude(p => p!.MetalType).Include(h => h.Item).ThenInclude(i => i!.Location).ThenInclude(l => l!.Vault).ToListAsync();
    public async Task<IEnumerable<InventoryTransaction>> GetTransactionsAsync() => await _dbContext.InventoryTransactions.Include(t => t.Item).ThenInclude(i => i!.Product).ThenInclude(p => p!.Denomination).Include(t => t.SourceLocation).ThenInclude(l => l!.Vault).Include(t => t.DestinationLocation).ThenInclude(l => l!.Vault).OrderByDescending(t => t.TransactionTimestamp).ToListAsync();
    public async Task<IEnumerable<StocktakeSession>> GetStocktakeSessionsAsync() => await _dbContext.StocktakeSessions.Include(s => s.Vault).ToListAsync();
    public async Task<IEnumerable<MismatchCase>> GetMismatchCasesAsync() => await _dbContext.MismatchCases.Include(c => c.ReconItem).ThenInclude(r => r!.Item).ThenInclude(i => i!.Product).ThenInclude(p => p!.Denomination).Include(c => c.ReconItem).ThenInclude(r => r!.Item).ThenInclude(i => i!.Location).ToListAsync();
    public async Task<IEnumerable<AuditLog>> GetAuditLogsAsync() => await _dbContext.AuditLogs.OrderByDescending(a => a.Timestamp).ToListAsync();
    public async Task<IEnumerable<ReconciliationRun>> GetReconciliationRunsAsync() => await _dbContext.ReconciliationRuns.ToListAsync();

    public async Task AddVendorAsync(Vendor vendor)
    {
        _dbContext.Vendors.Add(vendor);
        await _dbContext.SaveChangesAsync();
    }

    public async Task AddProductAsync(MetalProduct product)
    {
        _dbContext.MetalProducts.Add(product);
        await _dbContext.SaveChangesAsync();
    }

    public async Task AddDenominationAsync(MetalDenomination denomination)
    {
        _dbContext.MetalDenominations.Add(denomination);
        await _dbContext.SaveChangesAsync();
    }

    public async Task<MetalProduct> CreateDenominationProductAsync(string label, string metalName, decimal weightGrams)
    {
        var metalType = await _dbContext.MetalTypes.FirstOrDefaultAsync(m => m.MetalName.ToLower() == metalName.ToLower());
        if (metalType == null)
        {
            metalType = new MetalType { MetalName = metalName };
            _dbContext.MetalTypes.Add(metalType);
            await _dbContext.SaveChangesAsync();
        }

        decimal purityVal = metalName.ToLower() == "gold" ? 99.99m : 99.90m;
        var purity = await _dbContext.MetalPurityLevels.FirstOrDefaultAsync(p => p.PurityValue == purityVal);
        if (purity == null)
        {
            purity = new MetalPurityLevel { PurityValue = purityVal, Description = $"{purityVal} Purity" };
            _dbContext.MetalPurityLevels.Add(purity);
            await _dbContext.SaveChangesAsync();
        }

        var denom = await _dbContext.MetalDenominations.FirstOrDefaultAsync(d => d.Label.ToLower() == label.ToLower() && d.MetalTypeId == metalType.MetalTypeId);
        if (denom == null)
        {
            denom = new MetalDenomination { Label = label, WeightGrams = weightGrams, WeightOunces = weightGrams * 0.0321507m, MetalTypeId = metalType.MetalTypeId };
            _dbContext.MetalDenominations.Add(denom);
            await _dbContext.SaveChangesAsync();
        }

        string code = $"{(metalName.ToLower() == "gold" ? "AU" : "AG")}-{weightGrams}G-GEN";
        var product = await _dbContext.MetalProducts
            .Include(p => p.Denomination)
            .Include(p => p.Purity)
            .Include(p => p.MetalType)
            .FirstOrDefaultAsync(p => p.ProductCode == code && p.MetalTypeId == metalType.MetalTypeId && p.DenominationId == denom.DenominationId);
        if (product == null)
        {
            product = new MetalProduct
            {
                ProductCode = code,
                MetalTypeId = metalType.MetalTypeId,
                DenominationId = denom.DenominationId,
                PurityId = purity.PurityId,
                OriginCountry = "Switzerland",
                IsActive = true
            };
            _dbContext.MetalProducts.Add(product);
            await _dbContext.SaveChangesAsync();

            product = await _dbContext.MetalProducts
                .Include(p => p.Denomination)
                .Include(p => p.Purity)
                .Include(p => p.MetalType)
                .FirstOrDefaultAsync(p => p.ProductId == product.ProductId);
        }

        return product!;
    }

    public async Task SaveAuditLogAsync(string username, string ipAddress, string moduleName, string actionDescription, string? sqlExecuted = null, string? entityType = null, string? entityId = null)
    {
        var log = new AuditLog
        {
            Username = username,
            IpAddress = ipAddress,
            ModuleName = moduleName,
            ActionDescription = actionDescription,
            SqlExecuted = sqlExecuted,
            EntityType = entityType,
            EntityId = entityId,
            Timestamp = DateTime.UtcNow
        };
        log.RowHash = ComputeAuditRowHash(log);
        _dbContext.AuditLogs.Add(log);
        await _dbContext.SaveChangesAsync();
    }

    // Tamper-detection fingerprint for Item 6 (Enhanced Audit Trail UI) -- SHA-256 over the
    // row's other fields, computed at insert time. SearchAuditLogsAsync/GetAuditLogByIdAsync
    // recompute this on read and compare; a mismatch surfaces as "Tampered" in the UI. This
    // detects in-place edits, not deletions -- pair with normal DB access controls for that.
    internal static string ComputeAuditRowHash(AuditLog log)
    {
        string material = string.Join("|",
            log.Timestamp.ToString("O"), log.Username, log.IpAddress, log.ModuleName,
            log.ActionDescription, log.SqlExecuted ?? "", log.EntityType ?? "", log.EntityId ?? "");
        using var sha = System.Security.Cryptography.SHA256.Create();
        var bytes = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(material));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    // Workflow Engine
    public async Task<IEnumerable<WorkflowTemplate>> GetWorkflowTemplatesAsync()
    {
        return await _dbContext.WorkflowTemplates.Include(t => t.Steps).ToListAsync();
    }

    public async Task<WorkflowTemplate?> SaveWorkflowTemplateAsync(string workflowType, string name, string description, string stepsJson)
    {
        var existing = await _dbContext.WorkflowTemplates.Include(t => t.Steps)
            .FirstOrDefaultAsync(t => t.WorkflowType == workflowType);

        if (existing != null)
        {
            // Block edits (and, since there is no separate "delete" action, this is
            // also the only guard we need against effective deletion) while any
            // request of this workflow type is still in flight -- a P.O., branch
            // transfer, intake shipment, etc. that hasn't reached a terminal
            // APPROVED/REJECTED state yet. Every in-progress instance keeps
            // StatusCode == "PENDING_MAKER" regardless of which step it's actually
            // sitting at (see GetActiveWorkflowInstancesAsync), so that's the
            // correct filter for "pending" here.
            int pendingCount = await _dbContext.WorkflowInstances
                .CountAsync(i => i.WorkflowType == workflowType && i.StatusCode == "PENDING_MAKER");
            if (pendingCount > 0)
            {
                throw new InvalidOperationException(
                    $"Cannot edit or delete this workflow: {pendingCount} {workflowType} request(s) are currently pending against it. " +
                    "Wait until all in-flight requests are approved, rejected, or otherwise resolved before changing its steps.");
            }
        }

        WorkflowTemplate template;
        if (existing != null)
        {
            // Update in place -- preserve TemplateId. The old behavior deleted and
            // recreated the template on every save, which changed its TemplateId
            // and silently orphaned any WorkflowInstance still pointing at the old
            // one (its current step could no longer be resolved, stranding the
            // request with no visible required role for anyone). We only ever
            // reach here when there are zero pending instances now, but keeping
            // edits in-place is still the right behavior for historical instances
            // (already APPROVED/REJECTED) that still reference this template.
            existing.Name = name;
            existing.Description = description;
            existing.IsActive = true;
            _dbContext.WorkflowSteps.RemoveRange(existing.Steps);
            template = existing;
        }
        else
        {
            template = new WorkflowTemplate
            {
                WorkflowType = workflowType,
                Name = name,
                Description = description,
                IsActive = true
            };
            _dbContext.WorkflowTemplates.Add(template);
        }
        await _dbContext.SaveChangesAsync();

        using var doc = JsonDocument.Parse(stepsJson);
        int order = 1;
        foreach (var elem in doc.RootElement.EnumerateArray())
        {
            var step = new WorkflowStep
            {
                TemplateId = template.TemplateId,
                StepOrder = order++,
                StepName = elem.GetProperty("step_name").GetString() ?? "",
                RequiredRole = elem.GetProperty("required_role").GetString() ?? "",
                Description = elem.GetProperty("description").GetString() ?? ""
            };
            _dbContext.WorkflowSteps.Add(step);
        }
        await _dbContext.SaveChangesAsync();
        return await _dbContext.WorkflowTemplates.Include(t => t.Steps).FirstOrDefaultAsync(t => t.TemplateId == template.TemplateId);
    }

    public async Task<WorkflowInstance> StartWorkflowInstanceAsync(string workflowType, int entityId, string username)
    {
        var template = await _dbContext.WorkflowTemplates
            .Include(t => t.Steps)
            .FirstOrDefaultAsync(t => t.WorkflowType == workflowType && t.IsActive);
        
        if (template == null || template.Steps == null || !template.Steps.Any())
        {
            throw new InvalidOperationException($"Cannot create request: No active workflow design (template) exists with steps defined for '{workflowType}'. Please design and activate this workflow template first.");
        }
        
        var instance = new WorkflowInstance
        {
            WorkflowType = workflowType,
            EntityId = entityId,
            StatusCode = "PENDING_MAKER",
            CurrentStepOrder = 1,
            TemplateId = template.TemplateId,
            InitiatedBy = username,
            CreatedAt = DateTime.UtcNow
        };
        _dbContext.WorkflowInstances.Add(instance);
        await _dbContext.SaveChangesAsync();
        return instance;
    }

    public async Task<string> ProcessWorkflowActionAsync(int instanceId, string username, string action, string? comments)
    {
        var instance = await _dbContext.WorkflowInstances.FindAsync(instanceId);
        if (instance == null) return "INSTANCE_NOT_FOUND";

        if (instance.StatusCode != "PENDING_MAKER") return "INSTANCE_NOT_PENDING";

        List<WorkflowStep> steps = new();
        if (instance.TemplateId.HasValue)
        {
            steps = await _dbContext.WorkflowSteps
                .Where(s => s.TemplateId == instance.TemplateId)
                .OrderBy(s => s.StepOrder)
                .ToListAsync();
        }

        var currentStep = steps.FirstOrDefault(s => s.StepOrder == instance.CurrentStepOrder);
        if (currentStep != null)
        {
            var userRoles = GetUserRoles(username);
            if (!userRoles.Contains("IT/Admin") && 
                !userRoles.Contains(currentStep.RequiredRole))
            {
                return "UNAUTHORIZED_ROLE";
            }
        }

        var approval = new ApprovalAction
        {
            InstanceId = instanceId,
            ApproverUsername = username,
            ActionTaken = action,
            Comments = comments,
            ActionTimestamp = DateTime.UtcNow
        };
        _dbContext.ApprovalActions.Add(approval);

        // Set below when a workflow-approved branch transfer creates its InventoryTransaction --
        // TransactionId isn't assigned until the method's single final SaveChangesAsync, so the
        // chain-of-custody/audit cross-reference (which needs that ID) has to happen after it,
        // not inline where the transaction is constructed.
        InventoryTransaction? approvedTransferTx = null;

        if (action == "REJECTED")
        {
            instance.StatusCode = "REJECTED";
            if (instance.WorkflowType == "PURCHASE_ORDER")
            {
                var po = await _dbContext.PurchaseOrders.FindAsync(instance.EntityId);
                if (po != null) po.StatusCode = "REJECTED";
            }
            else if (instance.WorkflowType == "BRANCH_TRANSFER")
            {
                var transfer = await _dbContext.BranchTransfers.FindAsync(instance.EntityId);
                if (transfer != null)
                {
                    transfer.StatusCode = "REJECTED";
                    // Release locked item back to READY
                    var item = await _dbContext.InventoryItems.FindAsync(transfer.ItemId);
                    if (item != null)
                    {
                        item.StatusCode = "READY";
                    }
                }
            }
            else if (instance.WorkflowType == "INTAKE_SHIPMENT")
            {
                var pending = await _dbContext.PendingIntakes.FindAsync(instance.EntityId);
                if (pending != null) pending.StatusCode = "REJECTED";
            }
        }
        else if (action == "RETURNED")
        {
            instance.CurrentStepOrder = 1;
            if (instance.WorkflowType == "PURCHASE_ORDER")
            {
                var po = await _dbContext.PurchaseOrders.FindAsync(instance.EntityId);
                if (po != null) po.StatusCode = "PENDING_APPROVAL";
            }
            else if (instance.WorkflowType == "BRANCH_TRANSFER")
            {
                var transfer = await _dbContext.BranchTransfers.FindAsync(instance.EntityId);
                if (transfer != null) transfer.StatusCode = "PENDING_APPROVAL";
            }
            else if (instance.WorkflowType == "INTAKE_SHIPMENT")
            {
                var pending = await _dbContext.PendingIntakes.FindAsync(instance.EntityId);
                if (pending != null) pending.StatusCode = "PENDING_APPROVAL";
            }
        }
        else if (action == "APPROVED")
        {
            instance.CurrentStepOrder++;
            if (steps.Count == 0 || instance.CurrentStepOrder > steps.Count)
            {
                instance.StatusCode = "APPROVED";
                if (instance.WorkflowType == "PURCHASE_ORDER")
                {
                    var po = await _dbContext.PurchaseOrders.FindAsync(instance.EntityId);
                    if (po != null)
                    {
                        po.StatusCode = "APPROVED";
                        po.ApprovedBy = username;
                    }
                }
                else if (instance.WorkflowType == "BRANCH_TRANSFER")
                {
                    var transfer = await _dbContext.BranchTransfers.FindAsync(instance.EntityId);
                    if (transfer != null)
                    {
                        transfer.StatusCode = "APPROVED";
                        transfer.ApprovedBy = username;

                        // Trigger the transfer logic
                        var item = await _dbContext.InventoryItems.FindAsync(transfer.ItemId);
                        if (item != null)
                        {
                            // Find a free destination location at the destination branch
                            var destLoc = await _dbContext.InventoryLocations
                                .FirstOrDefaultAsync(l => l.BranchId == transfer.DestinationBranchId);
                            int destLocId = destLoc?.LocationId ?? 1;

                            int srcLoc = item.LocationId ?? 1;
                            item.LocationId = destLocId;
                            item.StatusCode = "IN_TRANSFER"; // Sets it to in transit

                            var tx = new InventoryTransaction
                            {
                                TransactionNumber = Guid.NewGuid().ToString(),
                                ItemId = item.ItemId,
                                TransactionType = "TRANSFER",
                                SourceLocationId = srcLoc,
                                DestinationLocationId = destLocId,
                                SourceOwnership = item.OwnershipType,
                                DestinationOwnership = item.OwnershipType,
                                InitiatedBy = transfer.CreatedBy,
                                ApprovedBy = username,
                                TransactionTimestamp = DateTime.UtcNow
                            };
                            _dbContext.InventoryTransactions.Add(tx);
                            approvedTransferTx = tx;

                            var move = new MovementTransaction
                            {
                                Transaction = tx,
                                CourierDetails = transfer.CourierInfo,
                                DepartureTime = DateTime.UtcNow
                            };
                            _dbContext.MovementTransactions.Add(move);

                            await RecalculateInventoryBalanceAsync(srcLoc, item.ProductId, item.OwnershipType);
                            await RecalculateInventoryBalanceAsync(destLocId, item.ProductId, item.OwnershipType);
                        }
                    }
                }
                else if (instance.WorkflowType == "INTAKE_SHIPMENT")
                {
                    var pending = await _dbContext.PendingIntakes.FindAsync(instance.EntityId);
                    if (pending != null)
                    {
                        pending.StatusCode = "APPROVED";
                        string result = await IntakeInventoryItemsAsync(pending.PoId, pending.LotNumber, pending.LocationId, pending.ReceivedBy, pending.SerialsJsonList,
                            pending.SourceType, pending.CustomerId, pending.AccountId, pending.ReceiptReason);
                        if (result != "SUCCESS")
                        {
                            throw new InvalidOperationException($"Intake execution failed: {result}");
                        }
                    }
                }
            }
        }

        await _dbContext.SaveChangesAsync();

        // Now that the transaction row has a real TransactionId, record its
        // chain-of-custody event and cross-referenced audit entry -- this was previously
        // missing entirely for maker-checker-approved transfers (the direct/non-workflow
        // transfer path had both; this one, oddly, had neither).
        if (approvedTransferTx != null)
        {
            await RecordChainOfCustodyEventAsync(approvedTransferTx.ItemId, "TRANSFERRED", username, approvedTransferTx.DestinationLocationId, approvedTransferTx.TransactionNumber, "Approved via Maker-Checker branch transfer workflow.");
            await SaveAuditLogAsync(username, "SYSTEM", "TRANSFER",
                $"Maker-Checker approved branch transfer completed (transaction {approvedTransferTx.TransactionNumber}).",
                entityType: "INVENTORY_TRANSACTION", entityId: approvedTransferTx.TransactionId.ToString());
        }

        return "SUCCESS";
    }

    public async Task<IEnumerable<WorkflowInstance>> GetActiveWorkflowInstancesAsync()
    {
        return await _dbContext.WorkflowInstances
            .Where(i => i.StatusCode == "PENDING_MAKER")
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync();
    }

    public async Task<WorkflowInstance?> GetWorkflowInstanceByIdAsync(int instanceId) =>
        await _dbContext.WorkflowInstances.FindAsync(instanceId);

    public async Task<IEnumerable<ApprovalAction>> GetApprovalActionsForInstanceAsync(int instanceId)
    {
        return await _dbContext.ApprovalActions
            .Where(a => a.InstanceId == instanceId)
            .OrderBy(a => a.ActionTimestamp)
            .ToListAsync();
    }

    // Every decision (APPROVED/REJECTED/RETURNED) this user has ever recorded, most recent first.
    public async Task<IEnumerable<ApprovalAction>> GetApprovalActionsByUserAsync(string username)
    {
        return await _dbContext.ApprovalActions
            .Include(a => a.Instance)
            .Where(a => a.ApproverUsername == username)
            .OrderByDescending(a => a.ActionTimestamp)
            .ToListAsync();
    }

    // Currently-open requests sitting at a step whose required role this user holds.
    // Mirrors the role check in ProcessWorkflowActionAsync, including the IT/Admin
    // superuser bypass -- an admin's "pending" queue is every open request in the system.
    public async Task<IEnumerable<WorkflowInstance>> GetPendingWorkflowInstancesForUserAsync(string username)
    {
        var userRoles = GetUserRoles(username);
        bool isSuperuser = userRoles.Contains("IT/Admin");

        var pending = await _dbContext.WorkflowInstances
            .Where(i => i.StatusCode == "PENDING_MAKER")
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync();

        if (isSuperuser) return pending;

        var templateIds = pending.Where(i => i.TemplateId.HasValue).Select(i => i.TemplateId!.Value).Distinct().ToList();
        var steps = await _dbContext.WorkflowSteps
            .Where(s => templateIds.Contains(s.TemplateId))
            .ToListAsync();

        return pending.Where(i =>
        {
            var step = steps.FirstOrDefault(s => s.TemplateId == i.TemplateId && s.StepOrder == i.CurrentStepOrder);
            return step != null && userRoles.Contains(step.RequiredRole);
        }).ToList();
    }

    // Resolves a user's effective roles for Maker-Checker step gating purely from real
    // AppUser -> PrivilegeGroup membership (PrivilegeGroup.GroupName strings, plus the
    // "IT/Admin" alias for "IT Administrators"). This used to also unconditionally add
    // "Operations Maker" / "Operations Checker" / "Reconciliation Officer" / "IT/Admin"
    // whenever the *username itself* contained the matching substring ("maker", "checker",
    // "reconciler", "admin") -- independent of actual group membership. That was a second,
    // deeper instance of the same username-pattern hack removed from
    // ActiveDirectoryService.AuthenticateAsync: it let any account get an unrelated approval
    // role (including IT/Admin, which bypasses the role check entirely) just because of its
    // username spelling, AND meant a real Checker/Reconciliation Officer whose username
    // didn't happen to contain that substring would be wrongly rejected with
    // UNAUTHORIZED_ROLE even though their PrivilegeGroup grants pending_actions.write. Don't
    // reintroduce it -- WorkflowStep.RequiredRole values are seeded in DbSeeder.cs to match
    // PrivilegeGroup.GroupName exactly, so this DB-only lookup is sufficient and correct for
    // any properly-provisioned user, not just the demo accounts.
    private List<string> GetUserRoles(string username)
    {
        var roles = new List<string>();

        try
        {
            var user = _dbContext.AppUsers
                .Include(u => u.Memberships)
                .ThenInclude(m => m.Group)
                .FirstOrDefault(u => u.Username == username || u.Email == username);
            if (user != null)
            {
                foreach (var m in user.Memberships)
                {
                    if (m.Group != null && !string.IsNullOrEmpty(m.Group.GroupName))
                    {
                        roles.Add(m.Group.GroupName);
                        // The seeded/administrable superuser group is named "IT Administrators"
                        // (see DbSeeder), but the superuser bypass checks throughout the app
                        // (here and the "IT/Admin" role claim in Program.cs) look for the
                        // literal "IT/Admin". Without this alias, any admin user added via the
                        // User Admin screen would be blocked from approving/rejecting a
                        // request whose current step requires a different role.
                        if (m.Group.GroupName == "IT Administrators")
                        {
                            roles.Add("IT/Admin");
                        }
                    }
                }
            }
        }
        catch { }

        return roles.Distinct().ToList();
    }

    // =========================================================================
    // User & Group Privilege Management Implementation
    // =========================================================================

    private static readonly Dictionary<string, int> AccessPriority = new()
    {
        { "HIDDEN", 0 }, { "READ_ONLY", 1 }, { "READ_WRITE", 2 }, { "FULL", 3 }
    };

    public async Task<IEnumerable<AppUser>> GetAllUsersAsync()
    {
        return await _dbContext.AppUsers
            .Include(u => u.Memberships)
                .ThenInclude(m => m.Group)
            .OrderBy(u => u.Username)
            .ToListAsync();
    }

    public async Task<AppUser?> GetUserByIdAsync(int userId)
    {
        return await _dbContext.AppUsers
            .Include(u => u.Memberships)
                .ThenInclude(m => m.Group)
            .FirstOrDefaultAsync(u => u.UserId == userId);
    }

    public async Task<AppUser?> GetUserByUsernameAsync(string username)
    {
        return await _dbContext.AppUsers
            .Include(u => u.Memberships)
                .ThenInclude(m => m.Group)
            .FirstOrDefaultAsync(u => u.Username == username || u.Email == username);
    }

    public async Task<AppUser> CreateUserAsync(string username, string displayName, string email, string passwordHash, string createdBy)
    {
        var user = new AppUser
        {
            Username = username,
            DisplayName = displayName,
            Email = email,
            PasswordHash = passwordHash,
            CreatedBy = createdBy
        };
        _dbContext.AppUsers.Add(user);
        await _dbContext.SaveChangesAsync();
        return user;
    }

    public async Task<AppUser?> UpdateUserAsync(int userId, string displayName, string email)
    {
        var user = await _dbContext.AppUsers.FindAsync(userId);
        if (user == null) return null;
        user.DisplayName = displayName;
        user.Email = email;
        await _dbContext.SaveChangesAsync();
        return user;
    }

    public async Task<bool> ToggleUserActiveAsync(int userId, bool isActive)
    {
        var user = await _dbContext.AppUsers.FindAsync(userId);
        if (user == null) return false;
        user.IsActive = isActive;
        await _dbContext.SaveChangesAsync();
        return true;
    }

    public async Task<IEnumerable<PrivilegeGroup>> GetAllGroupsAsync()
    {
        return await _dbContext.PrivilegeGroups
            .Include(g => g.Permissions)
            .Include(g => g.Members)
                .ThenInclude(m => m.User)
            .OrderBy(g => g.GroupName)
            .ToListAsync();
    }

    public async Task<PrivilegeGroup?> GetGroupByIdAsync(int groupId)
    {
        return await _dbContext.PrivilegeGroups
            .Include(g => g.Permissions)
            .Include(g => g.Members)
                .ThenInclude(m => m.User)
            .FirstOrDefaultAsync(g => g.GroupId == groupId);
    }

    public async Task<PrivilegeGroup> CreateGroupAsync(string groupName, string description)
    {
        var group = new PrivilegeGroup { GroupName = groupName, Description = description };
        _dbContext.PrivilegeGroups.Add(group);
        await _dbContext.SaveChangesAsync();
        return group;
    }

    public async Task<PrivilegeGroup?> UpdateGroupAsync(int groupId, string groupName, string description)
    {
        var group = await _dbContext.PrivilegeGroups.FindAsync(groupId);
        if (group == null) return null;
        group.GroupName = groupName;
        group.Description = description;
        await _dbContext.SaveChangesAsync();
        return group;
    }

    public async Task<bool> DeleteGroupAsync(int groupId)
    {
        var group = await _dbContext.PrivilegeGroups.FindAsync(groupId);
        if (group == null || group.IsSystem) return false;
        _dbContext.PrivilegeGroups.Remove(group);
        await _dbContext.SaveChangesAsync();
        return true;
    }

    public async Task<IEnumerable<GroupPermission>> GetGroupPermissionsAsync(int groupId)
    {
        return await _dbContext.GroupPermissions
            .Where(p => p.GroupId == groupId)
            .OrderBy(p => p.ModuleKey)
            .ToListAsync();
    }

    public async Task SaveGroupPermissionsAsync(int groupId, IEnumerable<(string moduleKey, string accessLevel)> permissions)
    {
        // Remove old permissions for this group
        var existing = _dbContext.GroupPermissions.Where(p => p.GroupId == groupId);
        _dbContext.GroupPermissions.RemoveRange(existing);

        // Add new permissions
        foreach (var (moduleKey, accessLevel) in permissions)
        {
            _dbContext.GroupPermissions.Add(new GroupPermission
            {
                GroupId = groupId,
                ModuleKey = moduleKey,
                AccessLevel = accessLevel
            });
        }
        await _dbContext.SaveChangesAsync();
    }

    public async Task<bool> AddUserToGroupAsync(int userId, int groupId, string assignedBy)
    {
        var exists = await _dbContext.UserGroupMemberships
            .AnyAsync(m => m.UserId == userId && m.GroupId == groupId);
        if (exists) return false;

        _dbContext.UserGroupMemberships.Add(new UserGroupMembership
        {
            UserId = userId,
            GroupId = groupId,
            AssignedBy = assignedBy
        });
        await _dbContext.SaveChangesAsync();
        return true;
    }

    public async Task<bool> RemoveUserFromGroupAsync(int userId, int groupId)
    {
        var membership = await _dbContext.UserGroupMemberships
            .FirstOrDefaultAsync(m => m.UserId == userId && m.GroupId == groupId);
        if (membership == null) return false;

        _dbContext.UserGroupMemberships.Remove(membership);
        await _dbContext.SaveChangesAsync();
        return true;
    }

    public async Task<Dictionary<string, string>> GetEffectivePermissionsForUserAsync(string username)
    {
        var user = await _dbContext.AppUsers
            .Include(u => u.Memberships)
                .ThenInclude(m => m.Group)
                    .ThenInclude(g => g!.Permissions)
            .FirstOrDefaultAsync(u => u.Username == username || u.Email == username);

        if (user == null) return new Dictionary<string, string>();

        var result = new Dictionary<string, string>();

        foreach (var membership in user.Memberships)
        {
            if (membership.Group == null || !membership.Group.IsActive) continue;
            foreach (var perm in membership.Group.Permissions)
            {
                if (!result.ContainsKey(perm.ModuleKey))
                {
                    result[perm.ModuleKey] = perm.AccessLevel;
                }
                else
                {
                    // Highest access wins
                    int currentPriority = AccessPriority.GetValueOrDefault(result[perm.ModuleKey], 0);
                    int newPriority = AccessPriority.GetValueOrDefault(perm.AccessLevel, 0);
                    if (newPriority > currentPriority)
                    {
                        result[perm.ModuleKey] = perm.AccessLevel;
                    }
                }
            }
        }

        return result;
    }

    // =========================================================================
    // Stock Reorder Thresholds
    // =========================================================================

    public async Task<IEnumerable<ReorderThreshold>> GetReorderThresholdsAsync()
    {
        return await _dbContext.ReorderThresholds
            .Include(t => t.Product).ThenInclude(p => p!.MetalType)
            .Include(t => t.Product).ThenInclude(p => p!.Denomination)
            .Include(t => t.Vendor)
            .OrderBy(t => t.ProductId)
            .ToListAsync();
    }

    public async Task<ReorderThreshold> SaveReorderThresholdAsync(int? thresholdId, int productId, int vendorId, int minStockQty, int reorderQty, bool isActive)
    {
        ReorderThreshold threshold;
        if (thresholdId.HasValue && thresholdId.Value > 0)
        {
            threshold = await _dbContext.ReorderThresholds.FindAsync(thresholdId.Value)
                ?? throw new InvalidOperationException("Threshold not found.");
            threshold.ProductId = productId;
            threshold.VendorId = vendorId;
            threshold.MinStockQty = minStockQty;
            threshold.ReorderQty = reorderQty;
            threshold.IsActive = isActive;
            threshold.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            threshold = new ReorderThreshold
            {
                ProductId = productId,
                VendorId = vendorId,
                MinStockQty = minStockQty,
                ReorderQty = reorderQty,
                IsActive = isActive
            };
            _dbContext.ReorderThresholds.Add(threshold);
        }
        await _dbContext.SaveChangesAsync();

        // Reload with nav properties
        await _dbContext.Entry(threshold).Reference(t => t.Product).LoadAsync();
        await _dbContext.Entry(threshold).Reference(t => t.Vendor).LoadAsync();
        return threshold;
    }

    public async Task<bool> DeleteReorderThresholdAsync(int thresholdId)
    {
        var threshold = await _dbContext.ReorderThresholds.FindAsync(thresholdId);
        if (threshold == null) return false;
        _dbContext.ReorderThresholds.Remove(threshold);
        await _dbContext.SaveChangesAsync();
        return true;
    }

    public async Task<IEnumerable<dynamic>> CheckLowStockAlertsAsync()
    {
        var thresholds = await _dbContext.ReorderThresholds
            .Where(t => t.IsActive)
            .Include(t => t.Product).ThenInclude(p => p!.MetalType)
            .Include(t => t.Product).ThenInclude(p => p!.Denomination)
            .Include(t => t.Vendor)
            .ToListAsync();

        if (!thresholds.Any()) return Enumerable.Empty<dynamic>();

        var alerts = new List<dynamic>();

        foreach (var t in thresholds)
        {
            // Sum all READY stock for this product across all locations
            var currentStock = await _dbContext.InventoryItems
                .Where(i => i.ProductId == t.ProductId && i.StatusCode == "READY" && i.OwnershipType == "KFH_OWNED")
                .CountAsync();

            if (currentStock <= t.MinStockQty)
            {
                alerts.Add(new
                {
                    threshold_id = t.ThresholdId,
                    product_id = t.ProductId,
                    product_code = t.Product?.ProductCode ?? "",
                    product_name = $"{t.Product?.MetalType?.MetalName ?? ""} {t.Product?.Denomination?.Label ?? ""}",
                    vendor_name = t.Vendor?.VendorName ?? "",
                    min_stock_qty = t.MinStockQty,
                    reorder_qty = t.ReorderQty,
                    current_stock = currentStock,
                    deficit = t.MinStockQty - currentStock
                });
            }
        }

        return alerts;
    }

    public async Task<(int poId, string result)> CreateDraftPurchaseOrderAsync(int thresholdId, string createdBy)
    {
        var threshold = await _dbContext.ReorderThresholds
            .Include(t => t.Product).ThenInclude(p => p!.Denomination)
            .Include(t => t.Vendor)
            .FirstOrDefaultAsync(t => t.ThresholdId == thresholdId);

        if (threshold == null) return (0, "THRESHOLD_NOT_FOUND");

        // Generate a unique PO number
        var poNumber = $"PO-AUTO-{DateTime.UtcNow:yyyyMMdd}-{thresholdId:D3}";

        // Check if a DRAFT PO already exists for this threshold to avoid duplicates
        var existingDraft = await _dbContext.PurchaseOrders
            .FirstOrDefaultAsync(po => po.PoNumber.StartsWith($"PO-AUTO-") && po.VendorId == threshold.VendorId && po.StatusCode == "DRAFT");
        if (existingDraft != null)
            return (existingDraft.PoId, "DRAFT_EXISTS");

        var weightPerUnit = threshold.Product?.Denomination?.WeightGrams ?? 1000m;
        var totalWeight = weightPerUnit * threshold.ReorderQty;

        var po = new PurchaseOrder
        {
            PoNumber = poNumber,
            VendorId = threshold.VendorId,
            TotalWeightGrams = totalWeight,
            TotalCost = 0m, // To be filled by treasury
            Currency = "USD",
            StatusCode = "DRAFT",
            CreatedBy = createdBy
        };
        _dbContext.PurchaseOrders.Add(po);
        await _dbContext.SaveChangesAsync();

        await SaveAuditLogAsync(createdBy, "SYSTEM", "Purchase Orders",
            $"Auto-generated DRAFT P.O. {poNumber} for {threshold.ReorderQty}x {threshold.Product?.ProductCode ?? "?"} from {threshold.Vendor?.VendorName ?? "?"}");

        return (po.PoId, "SUCCESS");
    }

    // =========================================================================
    // KFH Branch settings CRUD & Workflow Transfers
    // =========================================================================

    public async Task<IEnumerable<Branch>> GetBranchesAsync()
    {
        return await _dbContext.Branches.Include(b => b.Vault).OrderBy(b => b.BranchCode).ToListAsync();
    }

    public async Task<Branch> SaveBranchAsync(int? branchId, string branchCode, string branchName, int vaultId, bool isActive)
    {
        Branch b;
        if (branchId.HasValue && branchId.Value > 0)
        {
            b = await _dbContext.Branches.FindAsync(branchId.Value) ?? throw new InvalidOperationException("Branch not found.");
            b.BranchCode = branchCode;
            b.BranchName = branchName;
            b.VaultId = vaultId;
            b.IsActive = isActive;
        }
        else
        {
            b = new Branch
            {
                BranchCode = branchCode,
                BranchName = branchName,
                VaultId = vaultId,
                IsActive = isActive
            };
            _dbContext.Branches.Add(b);
        }
        await _dbContext.SaveChangesAsync();
        await _dbContext.Entry(b).Reference(x => x.Vault).LoadAsync();
        return b;
    }

    public async Task<bool> DeleteBranchAsync(int branchId)
    {
        var b = await _dbContext.Branches.FindAsync(branchId);
        if (b == null) return false;
        _dbContext.Branches.Remove(b);
        await _dbContext.SaveChangesAsync();
        return true;
    }

    public async Task<IEnumerable<BranchTransfer>> GetBranchTransfersAsync()
    {
        return await _dbContext.BranchTransfers
            .Include(t => t.Item).ThenInclude(i => i!.Product)
            .Include(t => t.SourceBranch)
            .Include(t => t.DestinationBranch)
            .OrderByDescending(t => t.CreatedAt)
            .ToListAsync();
    }

    public async Task<BranchTransfer?> GetBranchTransferByIdAsync(int transferId)
    {
        return await _dbContext.BranchTransfers
            .Include(t => t.Item).ThenInclude(i => i!.Product)
            .Include(t => t.SourceBranch)
            .Include(t => t.DestinationBranch)
            .FirstOrDefaultAsync(t => t.TransferId == transferId);
    }

    public async Task<BranchTransfer> InitiateWorkflowBranchTransferAsync(int itemId, int destinationBranchId, string courierInfo, string initiatedBy)
    {
        var item = await _dbContext.InventoryItems.FindAsync(itemId);
        if (item == null || item.StatusCode != "READY")
        {
            throw new InvalidOperationException("Selected item is not ready for transfer.");
        }

        var template = await _dbContext.WorkflowTemplates.Include(t => t.Steps)
            .FirstOrDefaultAsync(t => t.WorkflowType == "BRANCH_TRANSFER" && t.IsActive);
        if (template == null || template.Steps.Count == 0)
        {
            throw new InvalidOperationException("Cannot initiate Branch Transfer: No active branch transfer workflow template or steps are defined in the setup. Please contact an administrator to design the workflow first.");
        }

        // Get location branch ID
        var loc = await _dbContext.InventoryLocations.FindAsync(item.LocationId);
        int srcBranchId = loc?.BranchId ?? 1; // Default to Main/HO Branch if not specified

        // Create the BranchTransfer entity
        var transfer = new BranchTransfer
        {
            ItemId = itemId,
            SourceBranchId = srcBranchId,
            DestinationBranchId = destinationBranchId,
            CourierInfo = courierInfo,
            StatusCode = "PENDING_APPROVAL",
            CreatedBy = initiatedBy,
            CreatedAt = DateTime.UtcNow
        };
        _dbContext.BranchTransfers.Add(transfer);

        // Lock the item status so it cannot be double transferred or sold during approval
        item.StatusCode = "RESERVED"; 

        await _dbContext.SaveChangesAsync();

        // Spawn a workflow instance of type "BRANCH_TRANSFER"
        await StartWorkflowInstanceAsync("BRANCH_TRANSFER", transfer.TransferId, initiatedBy);

        await _dbContext.Entry(transfer).Reference(t => t.Item).LoadAsync();
        await _dbContext.Entry(transfer).Reference(t => t.SourceBranch).LoadAsync();
        await _dbContext.Entry(transfer).Reference(t => t.DestinationBranch).LoadAsync();

        return transfer;
    }

    public async Task<string> ReceiveBranchTransferAsync(int transferId, string receivedBy)
    {
        var transfer = await _dbContext.BranchTransfers
            .Include(t => t.Item)
            .FirstOrDefaultAsync(t => t.TransferId == transferId);
        
        if (transfer == null) return "TRANSFER_NOT_FOUND";
        if (transfer.StatusCode != "APPROVED") return "TRANSFER_NOT_APPROVED";

        var item = transfer.Item;
        if (item != null)
        {
            // Update item status back to READY
            item.StatusCode = "READY";
            
            // Recalculate balances
            var loc = await _dbContext.InventoryLocations.FirstOrDefaultAsync(l => l.BranchId == transfer.DestinationBranchId);
            int destLocId = loc?.LocationId ?? item.LocationId ?? 1;
            int srcLoc = item.LocationId ?? 1;
            
            item.LocationId = destLocId;

            await RecalculateInventoryBalanceAsync(srcLoc, item.ProductId, item.OwnershipType);
            await RecalculateInventoryBalanceAsync(destLocId, item.ProductId, item.OwnershipType);
        }

        transfer.StatusCode = "RECEIVED";
        
        // Find movement transaction to update arrival time
        var tx = await _dbContext.InventoryTransactions
            .FirstOrDefaultAsync(t => t.ItemId == transfer.ItemId && t.TransactionType == "TRANSFER" && t.DestinationLocationId == (item != null ? item.LocationId : 1));
        if (tx != null)
        {
            var move = await _dbContext.MovementTransactions.FirstOrDefaultAsync(m => m.TransactionId == tx.TransactionId);
            if (move != null)
            {
                move.ArrivalTime = DateTime.UtcNow;
            }
        }

        await SaveAuditLogAsync(receivedBy, "SYSTEM", "OPERATIONS", $"Received Branch Transfer ID: {transferId}");
        await _dbContext.SaveChangesAsync();
        return "SUCCESS";
    }

    public async Task<PendingIntake> InitiateWorkflowIntakeAsync(int? poId, string lotNumber, int locationId, string receivedBy, string serialsJsonList,
        string sourceType = "SUPPLIER", int? customerId = null, int? accountId = null, string? receiptReason = null)
    {
        sourceType = string.IsNullOrWhiteSpace(sourceType) ? "SUPPLIER" : sourceType.Trim().ToUpperInvariant();
        if (sourceType != "SUPPLIER" && sourceType != "CUSTOMER")
        {
            throw new ArgumentException("sourceType must be SUPPLIER or CUSTOMER.");
        }

        if (sourceType == "SUPPLIER")
        {
            if (poId == null)
            {
                throw new InvalidOperationException("A Purchase Order is required for a supplier receipt.");
            }
            var po = await _dbContext.PurchaseOrders.FindAsync(poId.Value);
            if (po == null)
            {
                throw new InvalidOperationException("Associated Purchase Order not found.");
            }
            if (po.StatusCode != "APPROVED")
            {
                throw new InvalidOperationException("Associated Purchase Order is not approved yet.");
            }
        }
        else // CUSTOMER
        {
            if (customerId == null)
            {
                throw new InvalidOperationException("A customer is required for a customer receipt.");
            }
            var customer = await _dbContext.Customers.FindAsync(customerId.Value);
            if (customer == null)
            {
                throw new InvalidOperationException("Customer not found.");
            }
            if (!customer.IsActive)
            {
                throw new InvalidOperationException("Customer is not active.");
            }

            receiptReason = string.IsNullOrWhiteSpace(receiptReason) ? "BUYBACK" : receiptReason.Trim().ToUpperInvariant();
            if (receiptReason != "BUYBACK" && receiptReason != "CUSTODY_DEPOSIT" && receiptReason != "RETURN")
            {
                throw new ArgumentException("receiptReason must be BUYBACK, CUSTODY_DEPOSIT, or RETURN.");
            }
            if (receiptReason == "CUSTODY_DEPOSIT" && accountId == null)
            {
                throw new InvalidOperationException("A customer account is required to hold a custody deposit.");
            }
        }

        var template = await _dbContext.WorkflowTemplates.Include(t => t.Steps)
            .FirstOrDefaultAsync(t => t.WorkflowType == "INTAKE_SHIPMENT" && t.IsActive);
        if (template == null || template.Steps.Count == 0)
        {
            throw new InvalidOperationException("Cannot receive shipment: No active intake shipment workflow template or steps are defined in the setup. Please contact an administrator to design the workflow first.");
        }

        var pending = new PendingIntake
        {
            PoId = sourceType == "SUPPLIER" ? poId : null,
            SourceType = sourceType,
            CustomerId = sourceType == "CUSTOMER" ? customerId : null,
            AccountId = sourceType == "CUSTOMER" ? accountId : null,
            ReceiptReason = sourceType == "CUSTOMER" ? receiptReason : null,
            LotNumber = lotNumber,
            LocationId = locationId,
            ReceivedBy = receivedBy,
            SerialsJsonList = serialsJsonList,
            StatusCode = "PENDING_APPROVAL",
            CreatedAt = DateTime.UtcNow
        };
        _dbContext.PendingIntakes.Add(pending);
        await _dbContext.SaveChangesAsync();

        // Spawn a workflow instance of type "INTAKE_SHIPMENT" -- the same Maker-Checker
        // approval workflow handles both supplier and customer sourced receipts.
        await StartWorkflowInstanceAsync("INTAKE_SHIPMENT", pending.PendingIntakeId, receivedBy);

        return pending;
    }

    public async Task<IEnumerable<PendingIntake>> GetPendingIntakesAsync()
    {
        return await _dbContext.PendingIntakes
            .Include(pi => pi.PurchaseOrder)
            .Include(pi => pi.Location)
            .Include(pi => pi.Customer)
            .ToListAsync();
    }

    // =========================================================================
    // Dynamic Business Validation Rules Engine (RFP item 5)
    // =========================================================================

    public async Task<IEnumerable<BusinessRule>> GetBusinessRulesAsync(string? ruleType = null, bool activeOnly = false)
    {
        var query = _dbContext.BusinessRules.AsQueryable();
        if (!string.IsNullOrEmpty(ruleType)) query = query.Where(r => r.RuleType == ruleType);
        if (activeOnly) query = query.Where(r => r.IsActive);
        return await query.OrderBy(r => r.RuleCode).ThenByDescending(r => r.Version).ToListAsync();
    }

    public async Task<BusinessRule?> GetBusinessRuleByIdAsync(int ruleId) =>
        await _dbContext.BusinessRules.FirstOrDefaultAsync(r => r.RuleId == ruleId);

    public async Task<IEnumerable<BusinessRule>> GetBusinessRuleVersionsAsync(string ruleCode) =>
        await _dbContext.BusinessRules.Where(r => r.RuleCode == ruleCode).OrderByDescending(r => r.Version).ToListAsync();

    // Append-only versioning: supersedes the previous active version (if any) of the same
    // RuleCode rather than mutating it, so GetBusinessRuleVersionsAsync always has real history.
    public async Task<BusinessRule> AddBusinessRuleVersionAsync(BusinessRule rule)
    {
        var previous = await _dbContext.BusinessRules
            .Where(r => r.RuleCode == rule.RuleCode)
            .OrderByDescending(r => r.Version)
            .FirstOrDefaultAsync();

        rule.Version = (previous?.Version ?? 0) + 1;
        if (previous != null) previous.IsActive = false;

        _dbContext.BusinessRules.Add(rule);
        await _dbContext.SaveChangesAsync();
        return rule;
    }

    public async Task<bool> SetBusinessRuleActiveAsync(int ruleId, bool isActive)
    {
        var rule = await _dbContext.BusinessRules.FirstOrDefaultAsync(r => r.RuleId == ruleId);
        if (rule == null) return false;
        rule.IsActive = isActive;
        await _dbContext.SaveChangesAsync();
        return true;
    }

    public async Task SaveBusinessRuleEvaluationAsync(BusinessRuleEvaluation evaluation)
    {
        _dbContext.BusinessRuleEvaluations.Add(evaluation);
        await _dbContext.SaveChangesAsync();
    }

    // =========================================================================
    // Enhanced Audit Trail UI (RFP item 6)
    // =========================================================================

    public async Task<AuditLogSearchResult> SearchAuditLogsAsync(AuditLogFilter filter)
    {
        var query = _dbContext.AuditLogs.AsQueryable();

        if (!string.IsNullOrWhiteSpace(filter.Query))
            query = query.Where(a => a.ActionDescription.Contains(filter.Query));
        if (!string.IsNullOrWhiteSpace(filter.Username))
            query = query.Where(a => a.Username == filter.Username);
        if (!string.IsNullOrWhiteSpace(filter.ModuleName))
            query = query.Where(a => a.ModuleName == filter.ModuleName);
        if (!string.IsNullOrWhiteSpace(filter.EntityType))
            query = query.Where(a => a.EntityType == filter.EntityType);
        if (filter.From.HasValue)
            query = query.Where(a => a.Timestamp >= filter.From.Value);
        if (filter.To.HasValue)
            query = query.Where(a => a.Timestamp <= filter.To.Value);

        int page = Math.Max(1, filter.Page);
        int pageSize = Math.Clamp(filter.PageSize, 1, 500);

        if (!string.IsNullOrWhiteSpace(filter.StatusFilter))
        {
            // TamperStatus is a computed value (row-hash recompute), not a persisted column, so
            // it can't be pushed into the SQL WHERE clause. Applying it AFTER the count/paging
            // (the previous approach) reported a `total_count` that didn't match the filtered
            // rows and could skip/duplicate rows across pages. Instead, materialize everything
            // matching the other filters, filter by tamper status in memory, then take the
            // count and page from that already-filtered set.
            string sf = filter.StatusFilter.Trim().ToLowerInvariant();
            var allMatching = await query.OrderByDescending(a => a.Timestamp).ToListAsync();
            var filteredItems = allMatching
                .Select(MapAuditLogSearchResultItem)
                .Where(i => i.TamperStatus.ToLowerInvariant() == sf)
                .ToList();
            var pagedItems = filteredItems.Skip((page - 1) * pageSize).Take(pageSize).ToList();
            return new AuditLogSearchResult { Items = pagedItems, TotalCount = filteredItems.Count, Page = page, PageSize = pageSize };
        }

        int totalCount = await query.CountAsync();
        var rows = await query
            .OrderByDescending(a => a.Timestamp)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();
        var items = rows.Select(MapAuditLogSearchResultItem).ToList();

        return new AuditLogSearchResult { Items = items, TotalCount = totalCount, Page = page, PageSize = pageSize };
    }

    public async Task<AuditLogSearchResultItem?> GetAuditLogByIdAsync(int logId)
    {
        var log = await _dbContext.AuditLogs.FirstOrDefaultAsync(a => a.LogId == logId);
        return log == null ? null : MapAuditLogSearchResultItem(log);
    }

    private static AuditLogSearchResultItem MapAuditLogSearchResultItem(AuditLog log)
    {
        string tamperStatus;
        if (string.IsNullOrEmpty(log.RowHash)) tamperStatus = "Unverified";
        else tamperStatus = ComputeAuditRowHash(log) == log.RowHash ? "Verified" : "Tampered";

        return new AuditLogSearchResultItem
        {
            LogId = log.LogId,
            Timestamp = log.Timestamp,
            Username = log.Username,
            IpAddress = log.IpAddress,
            ModuleName = log.ModuleName,
            ActionDescription = log.ActionDescription,
            EntityType = log.EntityType,
            EntityId = log.EntityId,
            TamperStatus = tamperStatus
        };
    }

    // =========================================================================
    // Automatic Management Email Notifications (RFP item 7)
    // =========================================================================

    public async Task<IEnumerable<NotificationSubscription>> GetNotificationSubscriptionsAsync() =>
        await _dbContext.NotificationSubscriptions.OrderBy(s => s.DistributionListEmail).ToListAsync();

    public async Task<NotificationSubscription?> GetNotificationSubscriptionByIdAsync(int subscriptionId) =>
        await _dbContext.NotificationSubscriptions.FirstOrDefaultAsync(s => s.SubscriptionId == subscriptionId);

    public async Task<NotificationSubscription> SaveNotificationSubscriptionAsync(NotificationSubscription subscription)
    {
        if (subscription.SubscriptionId == 0)
        {
            _dbContext.NotificationSubscriptions.Add(subscription);
        }
        else
        {
            var existing = await _dbContext.NotificationSubscriptions.FirstOrDefaultAsync(s => s.SubscriptionId == subscription.SubscriptionId);
            if (existing == null) throw new InvalidOperationException("Subscription not found.");
            existing.DistributionListEmail = subscription.DistributionListEmail;
            existing.ReportType = subscription.ReportType;
            existing.ScheduleCron = subscription.ScheduleCron;
            existing.Format = subscription.Format;
            existing.IsActive = subscription.IsActive;
            subscription = existing;
        }
        await _dbContext.SaveChangesAsync();
        return subscription;
    }

    public async Task<bool> DeleteNotificationSubscriptionAsync(int subscriptionId)
    {
        var existing = await _dbContext.NotificationSubscriptions.FirstOrDefaultAsync(s => s.SubscriptionId == subscriptionId);
        if (existing == null) return false;
        _dbContext.NotificationSubscriptions.Remove(existing);
        await _dbContext.SaveChangesAsync();
        return true;
    }

    public async Task<bool> UnsubscribeAsync(int subscriptionId)
    {
        var existing = await _dbContext.NotificationSubscriptions.FirstOrDefaultAsync(s => s.SubscriptionId == subscriptionId);
        if (existing == null) return false;
        existing.IsActive = false;
        existing.UnsubscribedAt = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync();
        return true;
    }

    public async Task RecordNotificationDeliveryAsync(NotificationDelivery delivery)
    {
        _dbContext.NotificationDeliveries.Add(delivery);
        await _dbContext.SaveChangesAsync();
    }

    public async Task<IEnumerable<NotificationDelivery>> GetNotificationDeliveriesAsync(int? subscriptionId = null)
    {
        var query = _dbContext.NotificationDeliveries.AsQueryable();
        if (subscriptionId.HasValue) query = query.Where(d => d.SubscriptionId == subscriptionId.Value);
        return await query.OrderByDescending(d => d.SentAt).ToListAsync();
    }

    // =========================================================================
    // KFH Existing Monitoring Tool Integration (RFP item 8)
    // =========================================================================

    public async Task<IEnumerable<MonitoringAlertRoute>> GetMonitoringAlertRoutesAsync() =>
        await _dbContext.MonitoringAlertRoutes.ToListAsync();

    public async Task<MonitoringAlertRoute> SaveMonitoringAlertRouteAsync(MonitoringAlertRoute route)
    {
        if (route.RouteId == 0)
        {
            _dbContext.MonitoringAlertRoutes.Add(route);
        }
        else
        {
            var existing = await _dbContext.MonitoringAlertRoutes.FirstOrDefaultAsync(r => r.RouteId == route.RouteId);
            if (existing == null) throw new InvalidOperationException("Alert route not found.");
            existing.EventType = route.EventType;
            existing.Severity = route.Severity;
            existing.Destination = route.Destination;
            existing.IsActive = route.IsActive;
            route = existing;
        }
        await _dbContext.SaveChangesAsync();
        return route;
    }

    public async Task<MonitoringEvent> RecordMonitoringEventAsync(MonitoringEvent evt)
    {
        _dbContext.MonitoringEvents.Add(evt);
        await _dbContext.SaveChangesAsync();
        return evt;
    }

    public async Task<IEnumerable<MonitoringEvent>> GetRecentMonitoringEventsAsync(int hours = 24)
    {
        var cutoff = DateTime.UtcNow.AddHours(-Math.Abs(hours));
        return await _dbContext.MonitoringEvents
            .Where(e => e.OccurredAt >= cutoff)
            .OrderByDescending(e => e.OccurredAt)
            .ToListAsync();
    }

    // =========================================================================
    // Real-Time Inventory Monitoring -- initial snapshot
    // =========================================================================

    public async Task<IEnumerable<InventoryBalance>> GetAllInventoryBalancesAsync() =>
        await _dbContext.InventoryBalances
            .Include(b => b.Location).ThenInclude(l => l!.Vault)
            .Include(b => b.Location).ThenInclude(l => l!.Branch)
            .Include(b => b.Product).ThenInclude(p => p!.MetalType)
            .Include(b => b.Product).ThenInclude(p => p!.Denomination)
            .ToListAsync();

    // =========================================================================
    // LBMA Good Delivery / Chain-of-Custody
    // =========================================================================

    public async Task<ChainOfCustodyEvent> RecordChainOfCustodyEventAsync(int itemId, string eventType, string recordedBy, int? locationId = null, string? referenceNumber = null, string? notes = null)
    {
        var evt = new ChainOfCustodyEvent
        {
            ItemId = itemId,
            EventType = eventType,
            RecordedBy = recordedBy,
            LocationId = locationId,
            ReferenceNumber = referenceNumber,
            Notes = notes,
            RecordedAt = DateTime.UtcNow
        };
        _dbContext.ChainOfCustodyEvents.Add(evt);
        await _dbContext.SaveChangesAsync();
        return evt;
    }

    public async Task<IEnumerable<ChainOfCustodyEvent>> GetChainOfCustodyEventsAsync(int itemId) =>
        await _dbContext.ChainOfCustodyEvents
            .Include(e => e.Location)
            .Where(e => e.ItemId == itemId)
            .OrderBy(e => e.RecordedAt)
            .ToListAsync();

    public async Task<IEnumerable<dynamic>> GetLbmaComplianceReportAsync()
    {
        var items = await _dbContext.InventoryItems
            .Include(i => i.Product).ThenInclude(p => p!.MetalType)
            .Include(i => i.Product).ThenInclude(p => p!.Denomination)
            .Include(i => i.Location).ThenInclude(l => l!.Vault)
            .Where(i => i.StatusCode != "INACTIVE" && i.StatusCode != "WITHDRAWN")
            .Where(i => i.GoodDeliveryStatus != "GDL_LISTED"
                        || i.RefinerName == null || i.AssayCertificateNumber == null || i.FinenessPpt == null)
            .ToListAsync();

        return items.Select(i => new
        {
            item_id = i.ItemId,
            serial_number = i.SerialNumber,
            metal_name = i.Product?.MetalType?.MetalName,
            denomination = i.Product?.Denomination?.Label,
            vault_name = i.Location?.Vault?.VaultName,
            status_code = i.StatusCode,
            good_delivery_status = i.GoodDeliveryStatus,
            refiner_name = i.RefinerName,
            refiner_lbma_id = i.RefinerLbmaId,
            assay_certificate_number = i.AssayCertificateNumber,
            fineness_ppt = i.FinenessPpt,
            hallmark_number = i.HallmarkNumber,
            gap_reason = i.RefinerName == null ? "Missing refiner identification"
                       : i.AssayCertificateNumber == null ? "Missing assay certificate"
                       : i.FinenessPpt == null ? "Missing fineness reading"
                       : i.GoodDeliveryStatus == "NOT_LISTED" ? "Refiner not on current LBMA Good Delivery List"
                       : "Not yet assessed"
        });
    }

    // =========================================================================
    // Sidebar Menu Layout (admin-arrangeable navigation order)
    // =========================================================================
    public async Task<SidebarMenuLayout?> GetSidebarMenuLayoutAsync() =>
        await _dbContext.SidebarMenuLayouts.FirstOrDefaultAsync(l => l.Id == 1);

    public async Task<SidebarMenuLayout> SaveSidebarMenuLayoutAsync(string orderJson, string updatedBy)
    {
        var existing = await _dbContext.SidebarMenuLayouts.FirstOrDefaultAsync(l => l.Id == 1);
        if (existing == null)
        {
            existing = new SidebarMenuLayout { Id = 1, OrderJson = orderJson, UpdatedBy = updatedBy, UpdatedAt = DateTime.UtcNow };
            _dbContext.SidebarMenuLayouts.Add(existing);
        }
        else
        {
            existing.OrderJson = orderJson;
            existing.UpdatedBy = updatedBy;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        await _dbContext.SaveChangesAsync();
        return existing;
    }

    // =========================================================================
    // Barcode/QR Code Tracking (RFP Section 3) -- same Product/Lot/Location include
    // chain as GetItemsAsync, scoped to a single item or lot for label generation.
    // =========================================================================
    private IQueryable<InventoryItem> ItemsWithLabelDetails() =>
        _dbContext.InventoryItems
            .Include(i => i.Product).ThenInclude(p => p!.MetalType)
            .Include(i => i.Product).ThenInclude(p => p!.Denomination)
            .Include(i => i.Product).ThenInclude(p => p!.Purity)
            .Include(i => i.Location).ThenInclude(l => l!.Vault)
            .Include(i => i.Lot).ThenInclude(l => l!.Vendor);

    public async Task<InventoryItem?> GetItemBySerialNumberAsync(string serialNumber) =>
        await ItemsWithLabelDetails().FirstOrDefaultAsync(i => i.SerialNumber == serialNumber);

    public async Task<InventoryItem?> GetItemByIdWithDetailsAsync(int itemId) =>
        await ItemsWithLabelDetails().FirstOrDefaultAsync(i => i.ItemId == itemId);

    public async Task<InventoryLot?> GetLotByNumberAsync(string lotNumber) =>
        await _dbContext.InventoryLots.Include(l => l.Vendor).FirstOrDefaultAsync(l => l.LotNumber == lotNumber);

    public async Task<IEnumerable<InventoryItem>> GetItemsByLotIdAsync(int lotId) =>
        await ItemsWithLabelDetails().Where(i => i.LotId == lotId).OrderBy(i => i.SerialNumber).ToListAsync();

    // =========================================================================
    // Auditable, traceable movement records
    // ------------------------------------------------------------------------
    // Replaces the previous pattern (ReconciliationService quarantine/resolve
    // calling IntakeInventoryItemsAsync purely to trigger a balance recalc
    // side-effect) which -- being an untested code path -- would re-Add an
    // InventoryItem row for a serial number that already exists, throwing on
    // the unique index the moment it actually ran. This produces a real
    // ADJUSTMENT ledger transaction plus a cross-referenced, tamper-hashed
    // audit log entry, exactly like every other movement type.
    // =========================================================================
    public async Task<InventoryTransaction> RecordInventoryAdjustmentAsync(int itemId, string reasonCode, string performedBy, string? notes = null)
    {
        var item = await _dbContext.InventoryItems.FindAsync(itemId);
        if (item == null) throw new InvalidOperationException("Inventory item not found.");

        if (item.LocationId.HasValue)
        {
            await RecalculateInventoryBalanceAsync(item.LocationId.Value, item.ProductId, item.OwnershipType);
        }

        var tx = new InventoryTransaction
        {
            TransactionNumber = $"ADJ-{item.ItemId}-{DateTime.UtcNow:yyyyMMddHHmmssfff}",
            ItemId = item.ItemId,
            TransactionType = "ADJUSTMENT",
            SourceLocationId = item.LocationId,
            DestinationLocationId = item.LocationId,
            SourceOwnership = item.OwnershipType,
            DestinationOwnership = item.OwnershipType,
            InitiatedBy = performedBy,
            ApprovedBy = performedBy,
            TransactionTimestamp = DateTime.UtcNow
        };
        _dbContext.InventoryTransactions.Add(tx);
        await _dbContext.SaveChangesAsync();

        string custodyEventType = item.StatusCode switch
        {
            "QUARANTINED" => "QUARANTINED",
            "READY" => "RELEASED",
            _ => "ADJUSTED"
        };
        string custodyNotes = $"Status changed to {item.StatusCode}. Reason: {reasonCode}." + (string.IsNullOrWhiteSpace(notes) ? "" : $" {notes}");
        await RecordChainOfCustodyEventAsync(item.ItemId, custodyEventType, performedBy, item.LocationId, tx.TransactionNumber, custodyNotes);
        await SaveAuditLogAsync(performedBy, "SYSTEM", "RECONCILIATION",
            $"Inventory adjustment for serial {item.SerialNumber}: status -> {item.StatusCode} (reason: {reasonCode}).{(string.IsNullOrWhiteSpace(notes) ? "" : " " + notes)}",
            entityType: "INVENTORY_TRANSACTION", entityId: tx.TransactionId.ToString());

        return tx;
    }

    // Best-effort assembly of everything traceable about one movement: the ledger
    // row itself, its matched audit entry (tamper status included), courier detail
    // if it's a TRANSFER, and the full custody timeline for the underlying bar.
    public async Task<dynamic?> GetTransactionTraceAsync(int transactionId)
    {
        var tx = await _dbContext.InventoryTransactions
            .Include(t => t.Item).ThenInclude(i => i!.Product).ThenInclude(p => p!.MetalType)
            .Include(t => t.Item).ThenInclude(i => i!.Product).ThenInclude(p => p!.Denomination)
            .Include(t => t.SourceLocation).ThenInclude(l => l!.Vault)
            .Include(t => t.DestinationLocation).ThenInclude(l => l!.Vault)
            .FirstOrDefaultAsync(t => t.TransactionId == transactionId);
        if (tx == null) return null;

        var auditEntry = await _dbContext.AuditLogs
            .Where(a => a.EntityType == "INVENTORY_TRANSACTION" && a.EntityId == transactionId.ToString())
            .OrderByDescending(a => a.Timestamp)
            .FirstOrDefaultAsync();

        // RECEIPT transactions are logged at the lot level (one audit row per intake batch,
        // not per bar -- see IntakeInventoryItemsAsync), so fall back to the item's lot when
        // there's no per-transaction entry.
        if (auditEntry == null && tx.TransactionType == "RECEIPT" && tx.Item?.LotId > 0)
        {
            auditEntry = await _dbContext.AuditLogs
                .Where(a => a.EntityType == "INVENTORY_LOT" && a.EntityId == tx.Item.LotId.ToString())
                .OrderByDescending(a => a.Timestamp)
                .FirstOrDefaultAsync();
        }

        var auditItem = auditEntry == null ? null : MapAuditLogSearchResultItem(auditEntry);

        var movement = await _dbContext.MovementTransactions.FirstOrDefaultAsync(m => m.TransactionId == transactionId);

        var custodyEvents = tx.ItemId > 0
            ? await _dbContext.ChainOfCustodyEvents
                .Include(e => e.Location)
                .Where(e => e.ItemId == tx.ItemId)
                .OrderBy(e => e.RecordedAt)
                .ToListAsync()
            : new List<ChainOfCustodyEvent>();

        return new
        {
            transaction = new
            {
                transaction_id = tx.TransactionId,
                transaction_number = tx.TransactionNumber,
                transaction_type = tx.TransactionType,
                serial_number = tx.Item?.SerialNumber,
                metal_name = tx.Item?.Product?.MetalType?.MetalName,
                denomination = tx.Item?.Product?.Denomination?.Label,
                source_vault = tx.SourceLocation?.Vault?.VaultName,
                source_location = tx.SourceLocation?.Description,
                destination_vault = tx.DestinationLocation?.Vault?.VaultName,
                destination_location = tx.DestinationLocation?.Description,
                source_ownership = tx.SourceOwnership,
                destination_ownership = tx.DestinationOwnership,
                rate_used = tx.RateUsed,
                fees_applied = tx.FeesApplied,
                initiated_by = tx.InitiatedBy,
                approved_by = tx.ApprovedBy,
                timestamp = tx.TransactionTimestamp
            },
            audit_entry = auditItem == null ? null : new
            {
                log_id = auditItem.LogId,
                username = auditItem.Username,
                ip_address = auditItem.IpAddress,
                module_name = auditItem.ModuleName,
                action_description = auditItem.ActionDescription,
                tamper_status = auditItem.TamperStatus,
                timestamp = auditItem.Timestamp
            },
            courier = movement == null ? null : new
            {
                courier_details = movement.CourierDetails,
                security_escort_name = movement.SecurityEscortName,
                shipment_ref_number = movement.ShipmentRefNumber,
                departure_time = movement.DepartureTime,
                arrival_time = movement.ArrivalTime
            },
            custody_chain = custodyEvents.Select(e => new
            {
                custody_event_id = e.CustodyEventId,
                event_type = e.EventType,
                location = e.Location?.Description,
                recorded_by = e.RecordedBy,
                recorded_at = e.RecordedAt,
                reference_number = e.ReferenceNumber,
                notes = e.Notes
            })
        };
    }

    // =========================================================================
    // IFRS Valuation Disclosures (IAS 2 lower-of-cost-or-NRV, IFRS 13 fair value)
    // =========================================================================

    public async Task<IfrsValuationDisclosure> GenerateIfrsValuationDisclosureAsync(string generatedBy)
    {
        if (_rateFeed == null) throw new InvalidOperationException("No live rate feed configured -- cannot mark inventory to fair value for an IFRS disclosure.");

        var items = await _dbContext.InventoryItems
            .Include(i => i.Product).ThenInclude(p => p!.MetalType)
            .Include(i => i.Product).ThenInclude(p => p!.Denomination)
            .Include(i => i.Lot)
            .Where(i => i.StatusCode != "INACTIVE" && i.StatusCode != "WITHDRAWN")
            .ToListAsync();

        var byMetal = items.GroupBy(i => i.Product?.MetalTypeId ?? 0);
        IfrsValuationDisclosure? last = null;

        foreach (var group in byMetal)
        {
            var metalType = await _dbContext.MetalTypes.FindAsync(group.Key);
            if (metalType == null) continue;

            var (bid, ask, _) = await _rateFeed.GetLiveRatesAsync(metalType.MetalName);
            decimal pricePerGram = ask / 31.1034768m; // ask = cost to replace, conservative for fair value mark
            decimal nrvPricePerGram = bid / 31.1034768m; // bid = net proceeds on disposal, proxy for NRV

            decimal totalWeight = 0, costBasis = 0, fairValue = 0, nrv = 0;
            foreach (var item in group)
            {
                decimal weight = item.Product?.Denomination?.WeightGrams ?? 0;
                decimal unitCost = item.Lot?.AverageUnitCost ?? 0;
                totalWeight += weight;
                costBasis += weight * unitCost;
                fairValue += weight * pricePerGram;
                nrv += weight * nrvPricePerGram;
            }

            decimal lowerOfCostOrNrv = Math.Min(costBasis, nrv);
            decimal impairment = Math.Max(0, costBasis - nrv); // IAS 2 para 34: write-down when cost > NRV

            var disclosure = new IfrsValuationDisclosure
            {
                SnapshotDate = DateTime.UtcNow,
                MetalTypeId = group.Key,
                Currency = "KWD",
                TotalWeightGrams = totalWeight,
                CostBasisTotal = Math.Round(costBasis, 2),
                NetRealizableValueTotal = Math.Round(nrv, 2),
                FairValueTotal = Math.Round(fairValue, 2),
                FairValueHierarchyLevel = 1, // LBMA/exchange-quoted spot -- Level 1 input
                LowerOfCostOrNrvTotal = Math.Round(lowerOfCostOrNrv, 2),
                ImpairmentLossRecognized = Math.Round(impairment, 2),
                GeneratedBy = generatedBy,
                GeneratedAt = DateTime.UtcNow
            };
            _dbContext.IfrsValuationDisclosures.Add(disclosure);
            last = disclosure;
        }

        await _dbContext.SaveChangesAsync();
        await SaveAuditLogAsync(generatedBy, "SYSTEM", "IFRS_DISCLOSURE", $"Generated IFRS valuation disclosure snapshot covering {byMetal.Count()} metal type(s).", entityType: "IFRS_VALUATION_DISCLOSURE");

        // Every relevant metal type produces its own row; return the last one generated
        // (callers wanting the full set should use GetIfrsValuationDisclosuresAsync).
        return last ?? new IfrsValuationDisclosure { MetalTypeId = 0, GeneratedBy = generatedBy };
    }

    public async Task<IEnumerable<IfrsValuationDisclosure>> GetIfrsValuationDisclosuresAsync() =>
        await _dbContext.IfrsValuationDisclosures
            .Include(d => d.MetalType)
            .OrderByDescending(d => d.SnapshotDate)
            .ToListAsync();

    // =========================================================================
    // Gold Dispensing Machine (GDM) Integration -- scalability hook
    // =========================================================================

    public async Task<IEnumerable<DispensingDevice>> GetDispensingDevicesAsync() =>
        await _dbContext.DispensingDevices
            .Include(d => d.Location)
            .Include(d => d.Branch)
            .ToListAsync();

    public async Task<DispensingDevice> SaveDispensingDeviceAsync(DispensingDevice device)
    {
        if (device.DeviceId == 0)
        {
            _dbContext.DispensingDevices.Add(device);
        }
        else
        {
            var existing = await _dbContext.DispensingDevices.FirstOrDefaultAsync(d => d.DeviceId == device.DeviceId);
            if (existing == null) throw new InvalidOperationException("Device not found.");
            existing.DeviceCode = device.DeviceCode;
            existing.DeviceName = device.DeviceName;
            existing.LocationId = device.LocationId;
            existing.BranchId = device.BranchId;
            existing.Manufacturer = device.Manufacturer;
            existing.Model = device.Model;
            existing.ApiEndpoint = device.ApiEndpoint;
            existing.StatusCode = device.StatusCode;
            existing.IsActive = device.IsActive;
            device = existing;
        }
        await _dbContext.SaveChangesAsync();
        return device;
    }

    public async Task<bool> DeleteDispensingDeviceAsync(int deviceId)
    {
        var device = await _dbContext.DispensingDevices.FindAsync(deviceId);
        if (device == null) return false;
        bool hasActivity = await _dbContext.DispenseTransactions.AnyAsync(t => t.DeviceId == deviceId && t.StatusCode == "REQUESTED");
        if (hasActivity) return false; // block delete while a dispense is in flight
        _dbContext.DispensingDevices.Remove(device);
        await _dbContext.SaveChangesAsync();
        return true;
    }

    public async Task<DispensingDevice?> RecordDeviceHeartbeatAsync(int deviceId, string statusCode)
    {
        var device = await _dbContext.DispensingDevices.FindAsync(deviceId);
        if (device == null) return null;
        device.StatusCode = statusCode;
        device.LastHeartbeatAt = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync();
        return device;
    }

    public async Task<IEnumerable<DispenseTransaction>> GetDispenseTransactionsAsync(int? deviceId = null)
    {
        var query = _dbContext.DispenseTransactions
            .Include(t => t.Device)
            .Include(t => t.Product).ThenInclude(p => p!.Denomination)
            .Include(t => t.Item)
            .Include(t => t.Channel)
            .AsQueryable();
        if (deviceId.HasValue) query = query.Where(t => t.DeviceId == deviceId.Value);
        return await query.OrderByDescending(t => t.RequestedAt).ToListAsync();
    }

    // Allocates one available serialized bar of `productId` sitting in the
    // device's own cassette location to a dispense request. Mirrors the
    // allocate-then-confirm/fail shape of ReserveStockAsync /
    // ConfirmPurchaseWithCustodyAsync / CancelReservationAsync so a machine
    // integration is "call these three endpoints", not a new core pattern.
    public async Task<(DispenseTransaction? txn, string result)> RequestDispenseAsync(int deviceId, int productId, int? customerId, int channelId, string idempotencyKey, string initiatedBy)
    {
        var existing = await _dbContext.DispenseTransactions.FirstOrDefaultAsync(t => t.IdempotencyKey == idempotencyKey);
        if (existing != null) return (existing, "IDEMPOTENT_REPLAY");

        var device = await _dbContext.DispensingDevices.FindAsync(deviceId);
        if (device == null) return (null, "DEVICE_NOT_FOUND");
        if (!device.IsActive || device.StatusCode != "ACTIVE") return (null, "DEVICE_NOT_ACTIVE");

        var item = await _dbContext.InventoryItems
            .FirstOrDefaultAsync(i => i.LocationId == device.LocationId && i.ProductId == productId && i.StatusCode == "READY");
        if (item == null) return (null, "NO_STOCK_AT_DEVICE");

        item.StatusCode = "RESERVED";

        var txn = new DispenseTransaction
        {
            DeviceId = deviceId,
            ProductId = productId,
            ItemId = item.ItemId,
            CustomerId = customerId,
            ChannelId = channelId,
            IdempotencyKey = idempotencyKey,
            StatusCode = "REQUESTED",
            InitiatedBy = initiatedBy,
            RequestedAt = DateTime.UtcNow
        };
        _dbContext.DispenseTransactions.Add(txn);
        await _dbContext.SaveChangesAsync();

        await RecalculateInventoryBalanceAsync(device.LocationId, productId, item.OwnershipType);
        await RecordChainOfCustodyEventAsync(item.ItemId, "RESERVED", initiatedBy, device.LocationId, $"GDM-DISPENSE-{txn.DispenseId}", $"Allocated to dispensing device {device.DeviceCode} for GDM dispatch.");

        return (txn, "SUCCESS");
    }

    public async Task<(bool success, string result)> CompleteDispenseAsync(int dispenseId, string completedBy)
    {
        var txn = await _dbContext.DispenseTransactions.Include(t => t.Item).Include(t => t.Device).FirstOrDefaultAsync(t => t.DispenseId == dispenseId);
        if (txn == null) return (false, "NOT_FOUND");
        if (txn.StatusCode != "REQUESTED") return (false, "NOT_IN_REQUESTED_STATE");
        if (txn.Item == null) return (false, "ITEM_NOT_FOUND");

        txn.StatusCode = "DISPENSED";
        txn.DispensedAt = DateTime.UtcNow;
        txn.Item.StatusCode = "INACTIVE"; // physically dispensed out of vault custody

        var transaction = new InventoryTransaction
        {
            TransactionNumber = $"GDM-{txn.DispenseId}-{DateTime.UtcNow:yyyyMMddHHmmss}",
            ItemId = txn.Item.ItemId,
            TransactionType = "DISPATCH",
            SourceLocationId = txn.Item.LocationId,
            DestinationLocationId = null,
            SourceOwnership = txn.Item.OwnershipType,
            DestinationOwnership = "CUSTOMER_OWNED",
            InitiatedBy = completedBy,
            ApprovedBy = completedBy,
            TransactionTimestamp = DateTime.UtcNow
        };
        _dbContext.InventoryTransactions.Add(transaction);

        await _dbContext.SaveChangesAsync();

        if (txn.Item.LocationId.HasValue)
            await RecalculateInventoryBalanceAsync(txn.Item.LocationId.Value, txn.Item.ProductId, txn.Item.OwnershipType);

        await RecordChainOfCustodyEventAsync(txn.Item.ItemId, "DISPENSED_GDM", completedBy, txn.Item.LocationId, $"GDM-DISPENSE-{txn.DispenseId}", $"Dispensed via device {txn.Device?.DeviceCode}.");
        await SaveAuditLogAsync(completedBy, "SYSTEM", "DISPENSING", $"GDM dispense {dispenseId} completed for serial {txn.Item.SerialNumber} via device {txn.Device?.DeviceCode}.", entityType: "DISPENSE_TRANSACTION", entityId: dispenseId.ToString());
        // Cross-referenced a second time under INVENTORY_TRANSACTION (the ledger row just
        // created above) so GetTransactionTraceAsync's Reports -> Transactions drill-down
        // finds it the same way it finds every other movement type's audit entry.
        await SaveAuditLogAsync(completedBy, "SYSTEM", "DISPENSING", $"GDM dispense {dispenseId} completed for serial {txn.Item.SerialNumber} via device {txn.Device?.DeviceCode}.", entityType: "INVENTORY_TRANSACTION", entityId: transaction.TransactionId.ToString());

        return (true, "SUCCESS");
    }

    public async Task<bool> FailDispenseAsync(int dispenseId, string reason)
    {
        var txn = await _dbContext.DispenseTransactions.Include(t => t.Item).FirstOrDefaultAsync(t => t.DispenseId == dispenseId);
        if (txn == null || txn.StatusCode != "REQUESTED") return false;

        txn.StatusCode = "FAILED";
        txn.FailureReason = reason;
        if (txn.Item != null)
        {
            txn.Item.StatusCode = "READY"; // release the allocation back to available stock
        }
        await _dbContext.SaveChangesAsync();

        if (txn.Item?.LocationId != null)
            await RecalculateInventoryBalanceAsync(txn.Item.LocationId.Value, txn.Item.ProductId, txn.Item.OwnershipType);

        return true;
    }

    // =========================================================================
    // Reporting Requirements Gap Analysis -- read-side aggregation support for
    // KPIs (Item 4), the Exceptions report (Item 5), Cost Analysis & Variance
    // (Item 8), and the Movement report (Item 9). See
    // PMIMSControllers.Reports.cs / PMIMSControllers.Admin.cs for the endpoints
    // that consume these, and docs/PMIMS_Reporting_Requirements_Gap_Analysis.docx
    // for the design this implements.
    // =========================================================================

    public async Task<IEnumerable<BusinessRuleEvaluation>> GetBusinessRuleEvaluationsAsync(DateTime? from = null, DateTime? to = null, string? result = null)
    {
        var query = _dbContext.BusinessRuleEvaluations.Include(e => e.Rule).AsQueryable();
        if (from.HasValue) query = query.Where(e => e.EvaluatedAt >= from.Value);
        if (to.HasValue) query = query.Where(e => e.EvaluatedAt < to.Value);
        if (!string.IsNullOrWhiteSpace(result)) query = query.Where(e => e.Result == result);
        return await query.OrderByDescending(e => e.EvaluatedAt).ToListAsync();
    }

    public async Task<IEnumerable<ApprovalAction>> GetAllApprovalActionsAsync(DateTime? from = null, DateTime? to = null)
    {
        var query = _dbContext.ApprovalActions.Include(a => a.Instance).AsQueryable();
        if (from.HasValue) query = query.Where(a => a.ActionTimestamp >= from.Value);
        if (to.HasValue) query = query.Where(a => a.ActionTimestamp < to.Value);
        return await query.OrderByDescending(a => a.ActionTimestamp).ToListAsync();
    }

    public async Task<IEnumerable<CostBudget>> GetCostBudgetsAsync() =>
        await _dbContext.CostBudgets.Include(b => b.MetalType).OrderByDescending(b => b.Period).ToListAsync();

    public async Task<CostBudget> SaveCostBudgetAsync(CostBudget budget)
    {
        if (budget.BudgetId > 0)
        {
            var existing = await _dbContext.CostBudgets.FindAsync(budget.BudgetId)
                ?? throw new InvalidOperationException("Cost budget not found.");
            existing.MetalTypeId = budget.MetalTypeId;
            existing.Period = budget.Period;
            existing.BudgetedUnitCostPerGram = budget.BudgetedUnitCostPerGram;
            existing.Currency = budget.Currency;
            await _dbContext.SaveChangesAsync();
            await _dbContext.Entry(existing).Reference(b => b.MetalType).LoadAsync();
            return existing;
        }
        else
        {
            budget.CreatedAt = DateTime.UtcNow;
            _dbContext.CostBudgets.Add(budget);
            await _dbContext.SaveChangesAsync();
            await _dbContext.Entry(budget).Reference(b => b.MetalType).LoadAsync();
            return budget;
        }
    }

    public async Task<bool> DeleteCostBudgetAsync(int budgetId)
    {
        var budget = await _dbContext.CostBudgets.FindAsync(budgetId);
        if (budget == null) return false;
        _dbContext.CostBudgets.Remove(budget);
        await _dbContext.SaveChangesAsync();
        return true;
    }
}

