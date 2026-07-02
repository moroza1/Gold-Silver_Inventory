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

    public InventoryRepository(AppDbContext dbContext)
    {
        _dbContext = dbContext;
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
    public async Task<(int poId, string result)> CreatePurchaseOrderAsync(string poNumber, int vendorId, decimal totalWeightGrams, decimal totalCost, string currency, string createdBy, string poItemJsonList)
    {
        if (IsSqlServer)
        {
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
                CreatedAt = DateTime.UtcNow
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
    public async Task<bool> UpdatePurchaseOrderAsync(int poId, int vendorId, decimal totalWeightGrams, decimal totalCost, string currency, string username, string poItemJsonList)
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

    // sp_IntakeInventoryItems execution / emulation
    public async Task<string> IntakeInventoryItemsAsync(int poId, string lotNumber, int locationId, string receivedBy, string serialsJsonList)
    {
        if (IsSqlServer)
        {
            await _dbContext.Database.ExecuteSqlRawAsync(
                "EXEC sp_IntakeInventoryItems @POID, @LotNumber, @LocationID, @ReceivedBy, @SerialsList",
                new SqlParameter("@POID", poId),
                new SqlParameter("@LotNumber", lotNumber),
                new SqlParameter("@LocationID", locationId),
                new SqlParameter("@ReceivedBy", receivedBy),
                new SqlParameter("@SerialsList", serialsJsonList)
            );
            return "SUCCESS";
        }
        else
        {
            var po = await _dbContext.PurchaseOrders.Include(p => p.Items).FirstOrDefaultAsync(p => p.PoId == poId);
            if (po != null && po.StatusCode != "APPROVED")
            {
                throw new InvalidOperationException("Cannot receive shipment: The associated purchase order must be fully approved.");
            }
            int vendorId = po?.VendorId ?? 1;
            decimal avgCost = po != null && po.TotalWeightGrams > 0 ? po.TotalCost / po.TotalWeightGrams : 0;

            using var doc = JsonDocument.Parse(serialsJsonList);
            int totalItems = doc.RootElement.EnumerateArray().Count();

            var lot = new InventoryLot
            {
                LotNumber = lotNumber,
                PoId = poId > 0 ? poId : null,
                VendorId = vendorId,
                AcquisitionDate = DateTime.UtcNow,
                TotalItems = totalItems,
                AverageUnitCost = avgCost,
                CreatedAt = DateTime.UtcNow
            };
            _dbContext.InventoryLots.Add(lot);
            await _dbContext.SaveChangesAsync();

            var affectedProducts = new HashSet<int>();
            foreach (var element in doc.RootElement.EnumerateArray())
            {
                string serial = element.GetProperty("serial").GetString() ?? "";
                int productId = element.GetProperty("product_id").GetInt32();
                affectedProducts.Add(productId);

                var item = new InventoryItem
                {
                    SerialNumber = serial,
                    ProductId = productId,
                    LotId = lot.LotId,
                    LocationId = locationId,
                    OwnershipType = "KFH_OWNED",
                    StatusCode = "READY"
                };
                _dbContext.InventoryItems.Add(item);
            }
            await _dbContext.SaveChangesAsync();

            foreach (var prodId in affectedProducts)
            {
                await RecalculateInventoryBalanceAsync(locationId, prodId, "KFH_OWNED");
            }

            if (po != null)
            {
                po.StatusCode = "RECEIVED";
                await _dbContext.SaveChangesAsync();
            }

            await SaveAuditLogAsync(receivedBy, "SYSTEM", "VAULT_OPS", $"Received and spatialized {totalItems} bars in Lot: {lotNumber}");
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

    public async Task<IEnumerable<InventoryItem>> GetItemsAsync() => await _dbContext.InventoryItems.Include(i => i.Product).ThenInclude(p => p!.MetalType).Include(i => i.Product).ThenInclude(p => p!.Denomination).Include(i => i.Location).ThenInclude(l => l!.Vault).Include(i => i.Lot).ToListAsync();
    public async Task<IEnumerable<PurchaseOrder>> GetPurchaseOrdersAsync() => await _dbContext.PurchaseOrders.Include(p => p.Vendor).Include(p => p.Items).ThenInclude(i => i.Product).ToListAsync();

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

    public async Task SaveAuditLogAsync(string username, string ipAddress, string moduleName, string actionDescription, string? sqlExecuted = null)
    {
        var log = new AuditLog
        {
            Username = username,
            IpAddress = ipAddress,
            ModuleName = moduleName,
            ActionDescription = actionDescription,
            SqlExecuted = sqlExecuted,
            Timestamp = DateTime.UtcNow
        };
        _dbContext.AuditLogs.Add(log);
        await _dbContext.SaveChangesAsync();
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

                            var move = new MovementTransaction
                            {
                                TransactionId = tx.TransactionId,
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
                        string result = await IntakeInventoryItemsAsync(pending.PoId, pending.LotNumber, pending.LocationId, pending.ReceivedBy, pending.SerialsJsonList);
                        if (result != "SUCCESS")
                        {
                            throw new InvalidOperationException($"Intake execution failed: {result}");
                        }
                    }
                }
            }
        }

        await _dbContext.SaveChangesAsync();
        return "SUCCESS";
    }

    public async Task<IEnumerable<WorkflowInstance>> GetActiveWorkflowInstancesAsync()
    {
        return await _dbContext.WorkflowInstances
            .Where(i => i.StatusCode == "PENDING_MAKER")
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync();
    }

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

    private List<string> GetUserRoles(string username)
    {
        var roles = new List<string>();
        if (username.Contains("maker")) roles.Add("Operations Maker");
        if (username.Contains("checker")) roles.Add("Operations Checker");
        if (username.Contains("reconciler")) roles.Add("Reconciliation Officer");
        if (username.Contains("admin")) roles.Add("IT/Admin");

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
                        // User Admin screen (i.e. not the hard-coded "system-admin" demo login)
                        // would be blocked from approving/rejecting a request whose current step
                        // requires a different role -- only the demo account worked, by
                        // accident, via the username.Contains("admin") hack above.
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

    public async Task<PendingIntake> InitiateWorkflowIntakeAsync(int poId, string lotNumber, int locationId, string receivedBy, string serialsJsonList)
    {
        var po = await _dbContext.PurchaseOrders.FindAsync(poId);
        if (po == null)
        {
            throw new InvalidOperationException("Associated Purchase Order not found.");
        }
        if (po.StatusCode != "APPROVED")
        {
            throw new InvalidOperationException("Associated Purchase Order is not approved yet.");
        }

        var template = await _dbContext.WorkflowTemplates.Include(t => t.Steps)
            .FirstOrDefaultAsync(t => t.WorkflowType == "INTAKE_SHIPMENT" && t.IsActive);
        if (template == null || template.Steps.Count == 0)
        {
            throw new InvalidOperationException("Cannot receive shipment: No active intake shipment workflow template or steps are defined in the setup. Please contact an administrator to design the workflow first.");
        }

        var pending = new PendingIntake
        {
            PoId = poId,
            LotNumber = lotNumber,
            LocationId = locationId,
            ReceivedBy = receivedBy,
            SerialsJsonList = serialsJsonList,
            StatusCode = "PENDING_APPROVAL",
            CreatedAt = DateTime.UtcNow
        };
        _dbContext.PendingIntakes.Add(pending);
        await _dbContext.SaveChangesAsync();

        // Spawn a workflow instance of type "INTAKE_SHIPMENT"
        await StartWorkflowInstanceAsync("INTAKE_SHIPMENT", pending.PendingIntakeId, receivedBy);

        return pending;
    }

    public async Task<IEnumerable<PendingIntake>> GetPendingIntakesAsync()
    {
        return await _dbContext.PendingIntakes
            .Include(pi => pi.PurchaseOrder)
            .Include(pi => pi.Location)
            .ToListAsync();
    }
}

