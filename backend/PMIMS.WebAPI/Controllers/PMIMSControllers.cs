using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using PMIMS.Application;
using PMIMS.Domain;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;

namespace PMIMS.WebAPI.Controllers;

[ApiController]
[Route("api")]
public partial class PMIMSControllers : ControllerBase
{
    private readonly IInventoryRepository _repository;
    private readonly IActiveDirectoryService _adService;
    private readonly IFimService _fimService;
    private readonly IRateFeedService _rateFeed;
    private readonly IReconciliationService _reconService;
    private readonly IBulkMigrationService _migrationService;
    private readonly IConfiguration _config;
    // Items 5-8
    private readonly IRuleEngineService _ruleEngine;
    private readonly IAuditExportService _auditExport;
    private readonly IEmailSenderService _emailSender;
    private readonly IMonitoringAdapter _monitoringAdapter;
    private readonly INotificationDispatchService _notificationDispatch;

    public PMIMSControllers(
        IInventoryRepository repository,
        IActiveDirectoryService adService,
        IFimService fimService,
        IRateFeedService rateFeed,
        IReconciliationService reconService,
        IBulkMigrationService migrationService,
        IConfiguration config,
        IRuleEngineService ruleEngine,
        IAuditExportService auditExport,
        IEmailSenderService emailSender,
        IMonitoringAdapter monitoringAdapter,
        INotificationDispatchService notificationDispatch)
    {
        _repository = repository;
        _adService = adService;
        _fimService = fimService;
        _rateFeed = rateFeed;
        _reconService = reconService;
        _migrationService = migrationService;
        _config = config;
        _ruleEngine = ruleEngine;
        _auditExport = auditExport;
        _emailSender = emailSender;
        _monitoringAdapter = monitoringAdapter;
        _notificationDispatch = notificationDispatch;
    }

    // =========================================================================
    // 1. AUTHENTICATION & LOGIN
    // =========================================================================
    [AllowAnonymous]
    [HttpPost("auth/login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        var (success, name, roles) = await _adService.AuthenticateAsync(req.Username, req.Password);
        if (!success) return Unauthorized("Invalid Active Directory credentials.");

        // Get effective permissions from group memberships
        var permissions = await _repository.GetEffectivePermissionsForUserAsync(req.Username);

        // Issue a signed JWT carrying identity, roles, and effective module permissions as claims.
        var token = GenerateJwt(req.Username, name, roles, permissions);

        return Ok(new { username = req.Username, displayName = name, roles, permissions, token });
    }

    // Builds a signed JWT. Each effective module permission is emitted as a claim
    // of type "perm:<moduleKey>" with the access level as its value, so authorization
    // policies can evaluate verb/level without another DB round-trip.
    private string GenerateJwt(string username, string? displayName, List<string> roles, Dictionary<string, string> permissions)
    {
        var jwt = _config.GetSection("Jwt");
        var key = jwt.GetValue<string>("Key") ?? "dev-only-pmims-signing-key-change-me-32+chars-minimum-0123456789";
        var issuer = jwt.GetValue<string>("Issuer") ?? "KFH-PMIMS";
        var audience = jwt.GetValue<string>("Audience") ?? "KFH-PMIMS-Client";
        var expiryMinutes = jwt.GetValue<int?>("ExpiryMinutes") ?? 60;

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, username),
            new(ClaimTypes.Name, username),
            new("displayName", displayName ?? username),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };
        foreach (var role in roles)
            claims.Add(new Claim(ClaimTypes.Role, role));
        foreach (var perm in permissions)
            claims.Add(new Claim("perm:" + perm.Key, perm.Value));

        var creds = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
            SecurityAlgorithms.HmacSha256);

        var securityToken = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(expiryMinutes),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(securityToken);
    }

    // =========================================================================
    // 2. PRODUCT CATALOG & LIVE RATES
    // =========================================================================
    [HttpGet("catalog/products")]
    public async Task<IActionResult> GetProducts()
    {
        var list = await _repository.GetProductsAsync();
        // Project to a flat snake_case DTO (consistent with the rest of the API and what the
        // frontend dropdowns consume: product catalog = the denominations defined in settings).
        return Ok(list.Select(p => new
        {
            product_id = p.ProductId,
            product_code = p.ProductCode,
            metal_name = p.MetalType?.MetalName ?? "",
            denomination_label = p.Denomination?.Label ?? "",
            weight_grams = p.Denomination?.WeightGrams ?? 0,
            purity_value = p.Purity?.PurityValue ?? 0,
            origin_country = p.OriginCountry,
            is_active = p.IsActive
        }));
    }

    // Was missing [Authorize] entirely -- anonymous callers could create new product/
    // denomination catalog entries. This is master-data (same tier as branches/vendors/
    // reorder-thresholds below), so gate it the same way.
    [Authorize(Policy = "master_data.write")]
    [HttpPost("catalog/products")]
    public async Task<IActionResult> CreateProduct([FromBody] CreateProductRequestDto req)
    {
        var product = await _repository.CreateDenominationProductAsync(req.Label, req.MetalName, req.WeightGrams);
        return Ok(new
        {
            product_id = product.ProductId,
            product_code = product.ProductCode,
            metal_name = product.MetalType?.MetalName ?? "",
            denomination_label = product.Denomination?.Label ?? "",
            weight_grams = product.Denomination?.WeightGrams ?? 0,
            purity_value = product.Purity?.PurityValue ?? 0,
            origin_country = product.OriginCountry,
            is_active = product.IsActive
        });
    }

    [HttpGet("rates")]
    public async Task<IActionResult> GetLiveRates()
    {
        var gold = await _rateFeed.GetLiveRatesAsync("Gold");
        var silver = await _rateFeed.GetLiveRatesAsync("Silver");

        return Ok(new
        {
            gold = new { bid = gold.bid, ask = gold.ask, source = gold.source, time = DateTime.UtcNow },
            silver = new { bid = silver.bid, ask = silver.ask, source = silver.source, time = DateTime.UtcNow }
        });
    }

    // Reference lookup for the cost-budget admin form (Reporting Requirements Gap Analysis,
    // Item 8) -- same public-reference-data tier as catalog/vendors/products below.
    [HttpGet("catalog/metal-types")]
    public async Task<IActionResult> GetMetalTypes()
    {
        var metalTypes = await _repository.GetMetalTypesAsync();
        return Ok(metalTypes.Select(m => new { metal_type_id = m.MetalTypeId, metal_name = m.MetalName }));
    }

    [HttpGet("catalog/vendors")]
    public async Task<IActionResult> GetVendors()
    {
        var vendors = await _repository.GetVendorsAsync();
        return Ok(vendors.Select(v => new
        {
            vendor_id = v.VendorId,
            code = v.VendorCode,
            name = v.VendorName,
            country = v.CountryOfOrigin,
            sharia = v.IsShariaCompliant,
            email = v.ContactEmail
        }));
    }

    [HttpGet("catalog/locations")]
    public async Task<IActionResult> GetLocations()
    {
        var locations = (await _repository.GetLocationsAsync()).Where(l => l.VaultId == 1 || l.Vault?.VaultName == "Main Vault");
        var items = await _repository.GetItemsAsync();

        // Group locations by vault + zone + shelf row to separate rows properly
        var grouped = locations
            .GroupBy(l => new { VaultName = l.Vault?.VaultName ?? "Unknown", l.ZoneRoom, l.ShelfRow })
            .Select(g =>
            {
                var slots = g.Select(loc =>
                {
                    var itemsInSlot = items.Where(i => i.LocationId == loc.LocationId && i.StatusCode != "INACTIVE" && i.StatusCode != "WITHDRAWN");
                    return new
                    {
                        location_id = loc.LocationId,
                        shelf_row = loc.ShelfRow,
                        slot_bin = loc.SlotBin,
                        description = loc.Description,
                        occupied = itemsInSlot.Any(),
                        item_count = itemsInSlot.Count(),
                        metal_type = itemsInSlot.FirstOrDefault()?.Product?.MetalType?.MetalName
                    };
                })
                .OrderBy(s => s.slot_bin)
                .ToList();

                return new
                {
                    id = g.First().LocationId,
                    vault_name = g.Key.VaultName,
                    zone_room = g.Key.ZoneRoom,
                    shelf_row = g.Key.ShelfRow,
                    name = $"{g.Key.VaultName} {g.Key.ZoneRoom} - {g.Key.ShelfRow}",
                    total_slots = slots.Count,
                    occupied_slots = slots.Count(s => s.occupied),
                    occupancy = slots.Count > 0 ? (int)Math.Round((double)slots.Count(s => s.occupied) / slots.Count * 100) : 0,
                    slots
                };
            })
            .OrderBy(g => g.shelf_row)
            .ToList();

        return Ok(grouped);
    }

    [Authorize(Policy = "vault_location.write")]
    [HttpPost("catalog/locations")]
    public async Task<IActionResult> CreateLocation([FromBody] CreateLocationRequest req)
    {
        try
        {
            var loc = await _repository.AddLocationAsync(1, 1, req.ZoneRoom, req.ShelfRow, req.SlotBin);
            return Created($"/api/catalog/locations/{loc.LocationId}", loc);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "vault_location.write")]
    [HttpDelete("catalog/locations/{id}")]
    public async Task<IActionResult> DeleteLocation(int id)
    {
        try
        {
            var success = await _repository.DeleteLocationAsync(id);
            if (!success) return NotFound();
            return Ok(new { message = "Location removed successfully." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [HttpGet("stock/items")]
    public async Task<IActionResult> GetItemsRegistry()
    {
        var items = await _repository.GetItemsAsync();
        return Ok(items.Select(i => new
        {
            item_id = i.ItemId,
            serial_number = i.SerialNumber,
            metal = i.Product?.MetalType?.MetalName ?? "Unknown",
            denomination = i.Product?.Denomination?.Label ?? "Unknown",
            origin = i.Product?.OriginCountry ?? "Unknown",
            location = i.Location?.Description ?? "Unknown",
            location_id = i.LocationId,
            status = i.StatusCode,
            ownership = i.OwnershipType
        }));
    }

    // Was missing [Authorize] entirely (see AGENTS.md "missing [Authorize] = anonymous
    // access" gotcha) -- reconciliation break data is sensitive financial discrepancy
    // information, so it gets the same reports.read policy as every other reporting view.
    [Authorize(Policy = "reports.read")]
    [HttpGet("reconciliation/discrepancies")]
    public async Task<IActionResult> GetDiscrepancies()
    {
        var cases = await _repository.GetMismatchCasesAsync();
        return Ok(cases.Select(c => new
        {
            case_id = c.CaseId,
            serial_number = c.ReconItem?.Item?.SerialNumber ?? "Unknown",
            denomination = c.ReconItem?.Item?.Product?.Denomination?.Label ?? "Unknown",
            expected = c.ReconItem?.Item?.Location?.Description ?? "Unknown",
            mismatch = c.InvestigatorComments ?? $"Status: {c.StatusCode}",
            status = c.StatusCode,
            reason_code = c.ReasonCode,
            resolved_by = c.ResolvedBy,
            resolved_at = c.ResolvedAt
        }));
    }

    // Previously IReconciliationService.RunReconciliationAsync had no HTTP endpoint at all --
    // it existed (and was unit-tested) but nothing in the API surface could trigger it. This
    // is also the trigger point for the INVENTORY_DISCREPANCY notification (see
    // ReconciliationService.RunReconciliationAsync), so without this endpoint that event type
    // could never fire in practice. Gated reports.write, same tier as the IFRS disclosure
    // snapshot generation just below -- a mutating action (quarantines items) that only
    // Reconciliation Officers / IT/Admin (FULL on `reports`) should be able to invoke.
    [Authorize(Policy = "reports.write")]
    [HttpPost("reconciliation/run")]
    public async Task<IActionResult> RunReconciliation([FromBody] RunReconciliationRequest? req)
    {
        string executedBy = req?.ExecutedBy ?? User.Identity?.Name ?? "system";
        var run = await _reconService.RunReconciliationAsync(executedBy);
        return Ok(new
        {
            executed_by = run.ExecutedBy,
            run_timestamp = run.RunTimestamp,
            total_items_checked = run.TotalItemsChecked,
            total_discrepancies = run.TotalDiscrepancies,
            status = run.StatusCode
        });
    }

    // =========================================================================
    // 3. INVENTORY CORE & VAULT OPERATIONS
    // =========================================================================
    [HttpGet("stock/available")]
    public async Task<IActionResult> GetAvailableStock([FromQuery] int? branch_id, [FromQuery] int? metal_type_id, [FromQuery] string? origin_country, [FromQuery] int? denomination_id)
    {
        var stock = await _repository.QueryAvailableStockAsync(branch_id, metal_type_id, origin_country, denomination_id);
        return Ok(stock);
    }

    [Authorize(Policy = "purchase_orders.write")]
    [HttpPost("purchase-orders")]
    public async Task<IActionResult> CreatePurchaseOrder([FromBody] CreatePORequest req)
    {
        try
        {
            string itemsJson = JsonSerializer.Serialize(req.Items);
            var (poId, result) = await _repository.CreatePurchaseOrderAsync(req.PoNumber, req.VendorId, req.TotalWeightGrams, req.TotalCost, req.Currency, req.CreatedBy, itemsJson,
                req.SupplierInvoiceNumber, req.SupplierInvoiceDate, req.FreightCost, req.InsuranceCost, req.CustomsDutyCost, req.OtherFeesCost, req.OtherFeesDescription);

            if (result != "SUCCESS") return BadRequest(result);
            return Created($"/api/purchase-orders/{poId}", new { po_id = poId, message = "Purchase Order created and staged under Maker-Checker review." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "purchase_orders.write")]
    [HttpPut("purchase-orders/{id}")]
    public async Task<IActionResult> UpdatePurchaseOrder(int id, [FromBody] CreatePORequest req)
    {
        try
        {
            string itemsJson = JsonSerializer.Serialize(req.Items);
            var success = await _repository.UpdatePurchaseOrderAsync(id, req.VendorId, req.TotalWeightGrams, req.TotalCost, req.Currency, req.CreatedBy, itemsJson,
                req.SupplierInvoiceNumber, req.SupplierInvoiceDate, req.FreightCost, req.InsuranceCost, req.CustomsDutyCost, req.OtherFeesCost, req.OtherFeesDescription);
            if (!success) return NotFound();
            return Ok(new { message = "Purchase Order amended successfully." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    // Deletion is a harder action than the ordinary create/edit covered by
    // "purchase_orders.write" (FULL is held by Maker too) -- it erases the P.O.'s audit
    // and workflow trail entirely rather than amending it, so it's reserved for IT/Admin
    // regardless of the caller's purchase_orders module grant.
    [Authorize]
    [HttpDelete("purchase-orders/{id}")]
    public async Task<IActionResult> DeletePurchaseOrder(int id, [FromQuery] string? username)
    {
        if (!User.IsInRole("IT/Admin"))
        {
            return Forbid();
        }
        try
        {
            var result = await _repository.DeletePurchaseOrderAsync(id, username ?? User.Identity?.Name ?? "unknown");
            if (result == "SUCCESS") return Ok(new { message = "Purchase Order deleted." });
            if (result == "PO_NOT_FOUND") return NotFound();
            return BadRequest(new { error = result });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "purchase_orders.read")]
    [HttpGet("purchase-orders")]
    public async Task<IActionResult> GetPurchaseOrders()
    {
        var list = await _repository.GetPurchaseOrdersAsync();
        var activeInstances = (await _repository.GetActiveWorkflowInstancesAsync()).ToList();
        var templates = (await _repository.GetWorkflowTemplatesAsync()).ToList();

        var poList = new List<object>();
        foreach (var po in list)
        {
            string? requiredRole = null;
            bool isWithMaker = false;
            var inst = activeInstances.FirstOrDefault(i => i.WorkflowType == "PURCHASE_ORDER" && i.EntityId == po.PoId);
            if (inst != null)
            {
                var template = templates.FirstOrDefault(t => t.TemplateId == inst.TemplateId);
                var currentStep = template?.Steps.FirstOrDefault(s => s.StepOrder == inst.CurrentStepOrder);
                
                var historyActions = await _repository.GetApprovalActionsForInstanceAsync(inst.InstanceId);
                var lastAction = historyActions.OrderByDescending(a => a.ActionTimestamp).ThenByDescending(a => a.ActionId).FirstOrDefault();
                
                if (lastAction != null && lastAction.ActionTaken == "RETURNED")
                {
                    isWithMaker = true;
                    requiredRole = "Operations Maker";
                }
                else
                {
                    isWithMaker = false;
                    requiredRole = currentStep?.RequiredRole;
                }
            }

            var firstItem = po.Items?.FirstOrDefault();
            poList.Add(new {
                po_id = po.PoId,
                po_number = po.PoNumber,
                vendor_id = po.VendorId,
                supplier = po.Vendor?.VendorName ?? "Unknown Supplier",
                weight = po.TotalWeightGrams,
                cost = po.TotalCost,
                currency = po.Currency,
                // Cost Tracking & Valuation -- purchase cost detail + the landed cost that
                // actually feeds InventoryLot.AverageUnitCost at intake (see PurchaseOrder.LandedCost).
                supplier_invoice_number = po.SupplierInvoiceNumber,
                supplier_invoice_date = po.SupplierInvoiceDate,
                freight_cost = po.FreightCost,
                insurance_cost = po.InsuranceCost,
                customs_duty_cost = po.CustomsDutyCost,
                other_fees_cost = po.OtherFeesCost,
                other_fees_description = po.OtherFeesDescription,
                landed_cost = po.LandedCost,
                status_code = po.StatusCode,
                created_by = po.CreatedBy,
                approved_by = po.ApprovedBy,
                required_role = requiredRole,
                is_with_maker = isWithMaker,
                // Back-compat aliases for any caller still reading a single item: first line's
                // product, and total units summed across all lines.
                product_id = firstItem?.ProductId ?? 1,
                qty = po.Items != null && po.Items.Count > 0 ? po.Items.Sum(i => i.OrderedQuantity) : 1,
                line_count = po.Items?.Count ?? 0,
                // Full line-item breakdown (per-unit weight is resolved on the frontend from the product catalog).
                items = (po.Items ?? new List<POItem>()).Select(i => new {
                    product_id = i.ProductId,
                    product_code = i.Product?.ProductCode,
                    qty = i.OrderedQuantity,
                    unit_cost = i.UnitCost,
                    received = i.ReceivedQuantity
                })
            });
        }
        return Ok(poList);
    }

    [HttpPost("vault/intake")]
    [Authorize(Policy = "intake.write")]
    public async Task<IActionResult> IntakeShipment([FromBody] IntakeRequest req)
    {
        try
        {
            string itemsJson = JsonSerializer.Serialize(req.Items);
            var pending = await _repository.InitiateWorkflowIntakeAsync(req.PoId, req.LotNumber, req.LocationId, req.ReceivedBy, itemsJson);
            return Ok(new { pending_id = pending.PendingIntakeId, message = "Intake shipment verification request initiated and routed to the Maker-Checker workflow approval." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    // Receipt of precious metals from a customer (buyback / custody deposit / return) --
    // no Purchase Order involved. Same Maker-Checker workflow (INTAKE_SHIPMENT) as a supplier
    // receipt so it goes through the identical approval queue/UI.
    [HttpPost("vault/intake/customer")]
    [Authorize(Policy = "intake.write")]
    public async Task<IActionResult> IntakeFromCustomer([FromBody] CustomerReceiptRequest req)
    {
        try
        {
            string itemsJson = JsonSerializer.Serialize(req.Items);
            var pending = await _repository.InitiateWorkflowIntakeAsync(null, req.LotNumber, req.LocationId, req.ReceivedBy, itemsJson,
                sourceType: "CUSTOMER", customerId: req.CustomerId, accountId: req.AccountId, receiptReason: req.ReceiptReason);
            return Ok(new { pending_id = pending.PendingIntakeId, message = "Customer receipt verification request initiated and routed to the Maker-Checker workflow approval." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "purchase_orders.write")]
    [HttpPost("transfers")]
    public async Task<IActionResult> TransferStock([FromBody] TransferRequest req)
    {
        string result = await _repository.InitiateBranchTransferAsync(req.ItemId, req.DestinationLocationId, req.CourierInfo, req.InitiatedBy);
        if (result != "SUCCESS") return BadRequest(result);

        return Ok(new { message = "Branch transfer initiated successfully. Stock locked in TRANSIT status." });
    }

    [Authorize(Policy = "purchase_orders.write")]
    [HttpPost("transfers/workflow-initiate")]
    public async Task<IActionResult> TransferStockWorkflow([FromBody] TransferWorkflowRequest req)
    {
        try
        {
            // Dynamic Business Validation Rules Engine (RFP item 5) -- additive pre-check,
            // e.g. a business-authored "no single transfer over N grams without dual approval"
            // rule. Never replaces the workflow's own Maker-Checker approval; a BLOCK-severity
            // rule match here just stops the transfer from being initiated at all.
            var item = (await _repository.GetItemsAsync()).FirstOrDefault(i => i.ItemId == req.ItemId);
            if (item != null)
            {
                var context = new Dictionary<string, object>
                {
                    ["weightGrams"] = item.Product?.Denomination?.WeightGrams ?? 0m,
                    ["metalType"] = item.Product?.MetalType?.MetalName ?? "",
                    ["destinationBranchId"] = req.DestinationBranchId
                };
                var ruleResult = await _ruleEngine.EvaluateAsync("TRANSFER_LIMIT", "InventoryItem", req.ItemId.ToString(), context);
                if (!ruleResult.Passed)
                {
                    string reasons = string.Join("; ", ruleResult.Details.Where(d => d.Result == "FAIL").Select(d => d.Message));
                    return BadRequest(new { error = $"Blocked by business rule: {reasons}" });
                }
            }

            var transfer = await _repository.InitiateWorkflowBranchTransferAsync(req.ItemId, req.DestinationBranchId, req.CourierInfo, req.InitiatedBy);
            return Ok(new { transfer_id = transfer.TransferId, message = "Branch transfer initiated and routed to the Maker-Checker workflow approval." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [Authorize(Policy = "custody.read")]
    [HttpGet("transfers")]
    public async Task<IActionResult> GetBranchTransfers()
    {
        var list = await _repository.GetBranchTransfersAsync();
        return Ok(list.Select(t => new {
            transfer_id = t.TransferId,
            item_id = t.ItemId,
            serial_number = t.Item?.SerialNumber ?? "Unknown",
            metal = t.Item?.Product?.MetalType?.MetalName ?? "Gold",
            denomination = t.Item?.Product?.Denomination?.Label ?? "Bar",
            source_branch_id = t.SourceBranchId,
            source_branch = t.SourceBranch?.BranchName ?? "Main Vault",
            destination_branch_id = t.DestinationBranchId,
            destination_branch = t.DestinationBranch?.BranchName ?? "Branch",
            courier_info = t.CourierInfo,
            status_code = t.StatusCode,
            created_by = t.CreatedBy,
            created_at = t.CreatedAt,
            approved_by = t.ApprovedBy
        }));
    }

    [Authorize(Policy = "purchase_orders.write")]
    [HttpPost("transfers/{id}/receive")]
    public async Task<IActionResult> ReceiveBranchTransfer([FromRoute] int id, [FromBody] ReceiveTransferRequest req)
    {
        var result = await _repository.ReceiveBranchTransferAsync(id, req.ReceivedBy);
        if (result != "SUCCESS") return BadRequest(new { error = result });

        return Ok(new { message = "Branch transfer marked as received successfully. Metal inventory status updated to READY." });
    }

    // =========================================================================
    // 4. RESERVATIONS (Pessimistic Lock TTL)
    // =========================================================================
    [Authorize(Policy = "custody.write")]
    [HttpPost("reservations")]
    public async Task<IActionResult> ReserveSerializedItem([FromHeader(Name = "X-Idempotency-Key")] string idempotencyKey, [FromBody] ReserveRequest req)
    {
        if (string.IsNullOrEmpty(idempotencyKey)) return BadRequest("X-Idempotency-Key header is mandatory.");

        var token = await _repository.ReserveStockAsync(req.CustomerId, req.ProductId, req.BranchId, req.ChannelId, idempotencyKey, 300);
        if (token == null) return Conflict(new { error_code = "OUT_OF_STOCK", message = "Requested metal denomination is out of stock in this branch vault." });

        return StatusCode(201, new { reservation_token = token.Value, expires_at = DateTime.UtcNow.AddMinutes(5) });
    }

    [Authorize(Policy = "custody.write")]
    [HttpPost("reservations/{token}/cancel")]
    public async Task<IActionResult> CancelReservation([FromRoute] Guid token)
    {
        await _repository.CancelReservationAsync(token);
        return Ok(new { message = "Reservation cancelled and locks released successfully." });
    }

    // =========================================================================
    // 5. CUSTODY, SALES & PHYSICAL REDEMPTION
    // =========================================================================
    [Authorize(Policy = "custody.write")]
    [HttpPost("purchases")]
    public async Task<IActionResult> ConfirmPurchase([FromBody] PurchaseConfirmRequest req)
    {
        string result = await _repository.ConfirmPurchaseWithCustodyAsync(req.ReservationToken, req.AccountId, req.SalePrice, req.MarkupAmount, req.InvoiceNumber, req.CustodyAgreementNumber);
        if (result != "SUCCESS") return BadRequest(result);

        return Ok(new { message = "Customer purchase confirmed, custody holdings portfolio updated." });
    }

    [Authorize(Policy = "custody.read")]
    [HttpGet("custody/holdings")]
    public async Task<IActionResult> GetHoldings([FromQuery] int customer_id)
    {
        var list = await _repository.GetCustomerHoldingsAsync(customer_id);
        return Ok(list.Select(h => new
        {
            holding_id = h.HoldingId,
            serial_number = h.Item?.SerialNumber,
            metal_name = h.Item?.Product?.MetalType?.MetalName,
            weight_grams = h.Item?.Product?.Denomination?.WeightGrams,
            purity_value = h.Item?.Product?.Purity?.PurityValue,
            vault_name = h.Item?.Location?.Vault?.VaultName,
            spatial_coordinates = $"{h.Item?.Location?.ZoneRoom} - {h.Item?.Location?.ShelfRow} - {h.Item?.Location?.SlotBin}",
            custody_agreement_number = h.CustodyAgreementNumber
        }));
    }

    [Authorize(Policy = "custody.write")]
    [HttpPost("withdrawals/request")]
    public async Task<IActionResult> RequestWithdrawal([FromBody] WithdrawalRequestModel req)
    {
        // In local mock, we mock OTP creation and return a successful request
        string otp = new Random().Next(100000, 999999).ToString();
        HttpContext.Session.SetString($"OTP_WITHDRAW_{req.HoldingId}", otp);

        return Ok(new { redemption_id = 455, message = $"OTP code {otp} sent successfully to customer mobile." });
    }

    [Authorize(Policy = "custody.write")]
    [HttpPost("withdrawals/confirm")]
    public async Task<IActionResult> ConfirmWithdrawal([FromBody] WithdrawalConfirmRequest req)
    {
        string result = await _repository.ExecuteBranchWithdrawalAsync(req.HoldingId, req.BranchId, req.VerificationOtp, req.RecipientSignature, "TELLER_USER");
        if (result != "SUCCESS") return BadRequest(result);

        return Ok(new { message = "Custody gold bar handed over to client. Spatial coordinate is now empty." });
    }

    // =========================================================================
    // 6. STOCKTAKE & AUDITING
    // =========================================================================
    [Authorize(Policy = "stocktake.write")]
    [HttpPost("stocktake/session")]
    public async Task<IActionResult> StartStocktake([FromBody] StartStocktakeRequest req)
    {
        string freezeLocsJson = JsonSerializer.Serialize(req.FreezeLocationIds);
        var (sessionId, result) = await _repository.StartStocktakeSessionAsync(req.SessionCode, req.VaultId, req.InitiatedBy, freezeLocsJson);

        if (result != "SUCCESS") return BadRequest(result);
        return Created($"/api/stocktake/session/{sessionId}", new { session_id = sessionId, message = "Stocktake session started. Vault location coordinates frozen." });
    }

    [Authorize(Policy = "stocktake.write")]
    [HttpPost("stocktake/scan")]
    public async Task<IActionResult> LogScan([FromBody] LogScanRequest req)
    {
        var scan = new StocktakeScan
        {
            SessionId = req.SessionId,
            ScannedSerial = req.ScannedSerial,
            LocationId = req.LocationId,
            ScannedBy = req.ScannedBy,
            ScannedAt = DateTime.UtcNow
        };

        // Standard save (using context directly to save time)
        await _repository.SaveAuditLogAsync(req.ScannedBy, "STOCKTAKE", "SCAN", $"Scanned serial: '{req.ScannedSerial}' at location: {req.LocationId}");
        return Ok(new { message = "Physical shelf scan logged." });
    }

    // =========================================================================
    // 7. EXCEL DATA MIGRATION
    // =========================================================================
    [Authorize(Policy = "migration.write")]
    [HttpPost("migration/upload")]
    public async Task<IActionResult> UploadMigrationTemplate([FromForm] IFormFile file, [FromForm] string uploaded_by)
    {
        if (file == null || file.Length == 0) return BadRequest("File is empty.");

        using var ms = new MemoryStream();
        await file.CopyToAsync(ms);
        string fileBase64 = Convert.ToBase64String(ms.ToArray());

        var diagnostics = await _migrationService.StageMigrationExcelAsync(file.FileName, fileBase64, uploaded_by);
        return Ok(diagnostics);
    }

    [Authorize(Policy = "migration.write")]
    [HttpPost("migration/commit")]
    public async Task<IActionResult> CommitMigration([FromBody] CommitMigrationRequest req)
    {
        string result = await _migrationService.CommitMigrationAsync(req.MigrationId, req.ApprovedBy);
        if (result != "SUCCESS") return BadRequest(result);

        return Ok(new { message = "Excel ingestion committed. Legacies data merged into inventory ledger." });
    }

    // =========================================================================
    // 9. FIM SYNC PROVISIONING HOOKS
    // -- Moved to PMIMSControllers.Fim.cs, which covers all 29 RFP FIM
    // Integration Module functions (identity provisioning, access
    // management/rights, password management, delta-sync) against the real
    // FimService implementation. See that file for GET/POST/PUT/DELETE
    // /api/fim/* endpoints.
    // =========================================================================

    // =========================================================================
    // 10. REPORTING & EXPORTS
    // =========================================================================
    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/audit-logs")]
    public async Task<IActionResult> GetAuditLogsReport()
    {
        var logs = await _repository.GetAuditLogsAsync();
        return Ok(logs);
    }

    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/holdings")]
    public async Task<IActionResult> GetHoldingsReport()
    {
        var holdings = await _repository.GetAllCustomerHoldingsAsync();
        return Ok(holdings.Select(h => new
        {
            holding_id = h.HoldingId,
            civil_id = h.Customer?.CivilId,
            customer_name = h.Customer?.CustomerName,
            serial_number = h.Item?.SerialNumber,
            metal_name = h.Item?.Product?.MetalType?.MetalName,
            weight_grams = h.Item?.Product?.Denomination?.WeightGrams,
            purity_value = h.Item?.Product?.Purity?.PurityValue,
            vault_name = h.Item?.Location?.Vault?.VaultName,
            location_description = h.Item?.Location?.Description,
            status_code = h.StatusCode,
            custody_agreement_number = h.CustodyAgreementNumber
        }));
    }

    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/transactions")]
    public async Task<IActionResult> GetTransactionsReport()
    {
        var txs = await _repository.GetTransactionsAsync();
        return Ok(txs.Select(t => new
        {
            transaction_id = t.TransactionId,
            transaction_number = t.TransactionNumber,
            serial_number = t.Item?.SerialNumber,
            metal_name = t.Item?.Product?.MetalType?.MetalName,
            weight_grams = t.Item?.Product?.Denomination?.WeightGrams,
            transaction_type = t.TransactionType,
            source_vault = t.SourceLocation?.Vault?.VaultName,
            source_location = t.SourceLocation?.Description,
            destination_vault = t.DestinationLocation?.Vault?.VaultName,
            destination_location = t.DestinationLocation?.Description,
            source_ownership = t.SourceOwnership,
            destination_ownership = t.DestinationOwnership,
            initiated_by = t.InitiatedBy,
            approved_by = t.ApprovedBy,
            timestamp = t.TransactionTimestamp
        }));
    }

    // Assembles one movement's full traceability picture: the ledger row, its matched
    // (tamper-hash-verified) audit log entry, courier detail if it's a TRANSFER, and the
    // full chain-of-custody timeline for the underlying bar. See
    // IInventoryRepository.GetTransactionTraceAsync.
    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/transactions/{id:int}/trace")]
    public async Task<IActionResult> GetTransactionTrace(int id)
    {
        var trace = await _repository.GetTransactionTraceAsync(id);
        if (trace == null) return NotFound(new { error = "Transaction not found." });
        return Ok(trace);
    }

    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/valuation")]
    public async Task<IActionResult> GetValuationReport([FromQuery] string method = "AVERAGE")
    {
        var items = await _repository.GetItemsAsync();
        var goldRate = await _rateFeed.GetLiveRatesAsync("Gold");
        var silverRate = await _rateFeed.GetLiveRatesAsync("Silver");

        decimal goldPricePerGram = goldRate.bid / 31.1034768m;
        decimal silverPricePerGram = silverRate.bid / 31.1034768m;

        var valuationList = new List<object>();
        var itemsList = items.ToList();
        var methodUpper = (method ?? "AVERAGE").Trim().ToUpperInvariant();

        var productsGrouped = itemsList.GroupBy(i => i.ProductId);
        foreach (var group in productsGrouped)
        {
            var productId = group.Key;
            var prodItems = group.ToList();
            var activeItems = prodItems.Where(i => i.StatusCode != "INACTIVE" && i.StatusCode != "WITHDRAWN").ToList();
            
            // Build cost pools for FIFO/LIFO
            List<decimal> costPool = new List<decimal>();
            if (methodUpper == "FIFO")
            {
                activeItems = activeItems.OrderByDescending(i => i.Lot?.AcquisitionDate).ThenByDescending(i => i.LotId).ToList();
                var prodLots = prodItems.Where(i => i.Lot != null).Select(i => i.Lot!).DistinctBy(l => l.LotId)
                    .OrderByDescending(l => l.AcquisitionDate).ThenByDescending(l => l.LotId).ToList();
                foreach (var lot in prodLots)
                {
                    int originalCount = prodItems.Count(i => i.LotId == lot.LotId);
                    costPool.AddRange(Enumerable.Repeat(lot.AverageUnitCost, originalCount));
                }
            }
            else if (methodUpper == "LIFO")
            {
                activeItems = activeItems.OrderBy(i => i.Lot?.AcquisitionDate).ThenBy(i => i.LotId).ToList();
                var prodLots = prodItems.Where(i => i.Lot != null).Select(i => i.Lot!).DistinctBy(l => l.LotId)
                    .OrderBy(l => l.AcquisitionDate).ThenBy(l => l.LotId).ToList();
                foreach (var lot in prodLots)
                {
                    int originalCount = prodItems.Count(i => i.LotId == lot.LotId);
                    costPool.AddRange(Enumerable.Repeat(lot.AverageUnitCost, originalCount));
                }
            }

            for (int k = 0; k < activeItems.Count; k++)
            {
                var item = activeItems[k];
                decimal weight = item.Product?.Denomination?.WeightGrams ?? 0;
                string metal = item.Product?.MetalType?.MetalName ?? "Gold";
                
                decimal currentPricePerGram = metal.Equals("Silver", StringComparison.OrdinalIgnoreCase) 
                    ? silverPricePerGram 
                    : goldPricePerGram;

                decimal currentMarketValue = weight * currentPricePerGram;

                decimal unitCost = 0;
                if (methodUpper == "FIFO" || methodUpper == "LIFO")
                {
                    unitCost = k < costPool.Count ? costPool[k] : (item.Lot?.AverageUnitCost ?? 0);
                }
                else
                {
                    unitCost = item.Lot?.AverageUnitCost ?? 0;
                }
                
                decimal costBasis = weight * unitCost;
                decimal unrealizedPnl = currentMarketValue - costBasis;

                valuationList.Add(new
                {
                    item_id = item.ItemId,
                    serial_number = item.SerialNumber,
                    metal_name = metal,
                    denomination = item.Product?.Denomination?.Label,
                    weight_grams = weight,
                    purity = item.Product?.Purity?.PurityValue,
                    location = item.Location?.Description ?? "Unknown",
                    status_code = item.StatusCode,
                    ownership_type = item.OwnershipType,
                    cost_basis = Math.Round(costBasis, 2),
                    market_value = Math.Round(currentMarketValue, 2),
                    unrealized_pnl = Math.Round(unrealizedPnl, 2)
                });
            }
        }

        return Ok(valuationList);
    }

    // Cost Tracking & Valuation -- Core Banking (IMAL) GL Integration: every journal entry
    // PMIMS has pushed (or attempted to push) to Core Banking's general ledger, newest first.
    // Same `reports` module/tier as the rest of the financial reporting surface (valuation,
    // transactions, reconciliation) -- this is the "did the ledger update actually happen"
    // audit view for that integration, not a new operational workflow of its own.
    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/gl-postings")]
    public async Task<IActionResult> GetCoreBankingLedgerPostings()
    {
        var postings = await _repository.GetCoreBankingPostingsAsync();
        return Ok(postings.Select(p => new
        {
            posting_id = p.PostingId,
            source_type = p.SourceType,
            source_id = p.SourceId,
            debit_account = p.DebitAccount,
            credit_account = p.CreditAccount,
            amount = p.Amount,
            currency = p.Currency,
            memo = p.Memo,
            status_code = p.StatusCode,
            core_banking_reference = p.CoreBankingReference,
            response_message = p.ResponseMessage,
            initiated_by = p.InitiatedBy,
            created_at = p.CreatedAt,
            posted_at = p.PostedAt
        }));
    }

    // =========================================================================
    // 11. WORKFLOW ENGINE
    // =========================================================================
    [Authorize(Policy = "workflows.read")]
    [HttpGet("workflows/templates")]
    public async Task<IActionResult> GetTemplates()
    {
        var list = await _repository.GetWorkflowTemplatesAsync();
        return Ok(list);
    }

    [Authorize(Policy = "workflow_design.write")]
    [HttpPost("workflows/templates")]
    public async Task<IActionResult> SaveTemplate([FromBody] SaveTemplateRequest req)
    {
        if (string.IsNullOrEmpty(req.WorkflowType) || string.IsNullOrEmpty(req.Name))
        {
            return BadRequest("WorkflowType and Name are required.");
        }

        try
        {
            var stepsJson = JsonSerializer.Serialize(req.Steps);
            var template = await _repository.SaveWorkflowTemplateAsync(req.WorkflowType, req.Name, req.Description, stepsJson);
            if (template == null) return BadRequest(new { error = "Failed to save workflow template." });
            return Ok(template);
        }
        catch (InvalidOperationException ex)
        {
            // e.g. "Cannot edit or delete this workflow: N request(s) are pending against it."
            return BadRequest(new { error = ex.Message });
        }
    }

    [Authorize(Policy = "workflows.read")]
    [HttpGet("workflows/instances/active")]
    public async Task<IActionResult> GetActiveInstances()
    {
        var instances = await _repository.GetActiveWorkflowInstancesAsync();
        var list = new List<object>();
        var templates = await _repository.GetWorkflowTemplatesAsync();
        var purchaseOrders = await _repository.GetPurchaseOrdersAsync();

        foreach (var inst in instances)
        {
            var template = templates.FirstOrDefault(t => t.TemplateId == inst.TemplateId);
            var currentStep = template?.Steps.FirstOrDefault(s => s.StepOrder == inst.CurrentStepOrder);
            var approvalActions = await _repository.GetApprovalActionsForInstanceAsync(inst.InstanceId);
            
            object? entityDetails = null;
            if (inst.WorkflowType == "PURCHASE_ORDER")
            {
                var po = purchaseOrders.FirstOrDefault(p => p.PoId == inst.EntityId);
                if (po != null)
                {
                    entityDetails = new
                    {
                        po_id = po.PoId,
                        po_number = po.PoNumber,
                        vendor_id = po.VendorId,
                        vendor_name = po.Vendor?.VendorName,
                        total_weight = po.TotalWeightGrams,
                        total_cost = po.TotalCost,
                        currency = po.Currency,
                        status_code = po.StatusCode,
                        created_by = po.CreatedBy
                    };
                }
            }
            else if (inst.WorkflowType == "INTAKE_SHIPMENT")
            {
                var pendingIntakes = await _repository.GetPendingIntakesAsync();
                var pending = pendingIntakes.FirstOrDefault(pi => pi.PendingIntakeId == inst.EntityId);
                if (pending != null)
                {
                    entityDetails = new
                    {
                        pending_intake_id = pending.PendingIntakeId,
                        source_type = pending.SourceType,
                        po_id = pending.PoId,
                        po_number = pending.SourceType == "CUSTOMER" ? null : (pending.PurchaseOrder?.PoNumber ?? "Unknown"),
                        customer_id = pending.CustomerId,
                        customer_name = pending.Customer?.CustomerName,
                        account_id = pending.AccountId,
                        receipt_reason = pending.ReceiptReason,
                        lot_number = pending.LotNumber,
                        location_id = pending.LocationId,
                        location_name = $"{pending.Location?.ZoneRoom}-{pending.Location?.ShelfRow}-{pending.Location?.SlotBin}",
                        received_by = pending.ReceivedBy,
                        status_code = pending.StatusCode,
                        created_by = pending.ReceivedBy
                    };
                }
            }
            else if (inst.WorkflowType == "BRANCH_TRANSFER")
            {
                var transfers = await _repository.GetBranchTransfersAsync();
                var tr = transfers.FirstOrDefault(t => t.TransferId == inst.EntityId);
                if (tr != null)
                {
                    entityDetails = new
                    {
                        transfer_id = tr.TransferId,
                        item_id = tr.ItemId,
                        serial_number = tr.Item?.SerialNumber ?? "Unknown",
                        product_name = tr.Item?.Product?.ProductCode ?? "Bar",
                        source_branch = tr.SourceBranch?.BranchName ?? "Main Vault",
                        destination_branch = tr.DestinationBranch?.BranchName ?? "Branch",
                        courier_info = tr.CourierInfo,
                        status_code = tr.StatusCode,
                        created_by = tr.CreatedBy
                    };
                }
            }

            var lastAction = approvalActions.OrderByDescending(a => a.ActionTimestamp).ThenByDescending(a => a.ActionId).FirstOrDefault();
            string? stepName = currentStep?.StepName;
            string? requiredRole = currentStep?.RequiredRole;
            string? stepDesc = currentStep?.Description;
            if (lastAction != null && lastAction.ActionTaken == "RETURNED")
            {
                stepName = "Pending Maker Revision";
                requiredRole = "Operations Maker";
                stepDesc = "The request has been returned to the maker for correction.";
            }

            list.Add(new
            {
                instance_id = inst.InstanceId,
                workflow_type = inst.WorkflowType,
                entity_id = inst.EntityId,
                status_code = inst.StatusCode,
                current_step_order = inst.CurrentStepOrder,
                template_id = inst.TemplateId,
                template_name = template?.Name,
                initiated_by = inst.InitiatedBy,
                created_at = inst.CreatedAt,
                current_step = currentStep != null ? new
                {
                    step_id = currentStep.StepId,
                    step_order = currentStep.StepOrder,
                    step_name = stepName,
                    required_role = requiredRole,
                    description = stepDesc
                } : null,
                steps = template?.Steps.Select(s => new
                {
                    step_id = s.StepId,
                    step_order = s.StepOrder,
                    step_name = s.StepName,
                    required_role = s.RequiredRole,
                    description = s.Description
                }).ToList(),
                history = approvalActions.Select(a => new
                {
                    action_id = a.ActionId,
                    approver = a.ApproverUsername,
                    action = a.ActionTaken,
                    comments = a.Comments,
                    timestamp = a.ActionTimestamp
                }).ToList(),
                details = entityDetails
            });
        }
        return Ok(list);
    }

    [Authorize(Policy = "pending_actions.write")]
    [HttpPost("workflows/instances/{id}/action")]
    public async Task<IActionResult> ProcessAction([FromRoute] int id, [FromBody] WorkflowActionRequest req)
    {
        if (string.IsNullOrEmpty(req.Username) || string.IsNullOrEmpty(req.Action))
        {
            return BadRequest("Username and Action are required.");
        }

        var result = await _repository.ProcessWorkflowActionAsync(id, req.Username, req.Action, req.Comments);
        if (result == "SUCCESS")
        {
            if (req.Action == "APPROVED")
            {
                // Customer/management communication (RFP item 7 extension) -- fires only when
                // this action was the final approval step of a BRANCH_TRANSFER (i.e. the
                // transfer is now actually complete), not on every intermediate step.
                await NotifyIfTransferCompletedAsync(id);
            }
            return Ok(new { message = "Workflow action processed successfully." });
        }
        return BadRequest(new { error = result });
    }

    // =========================================================================
    // PER-USER ACTIVITY DASHBOARD ("My Activity")
    // =========================================================================
    // Any authenticated user can see their own activity -- this isn't gated by a module
    // permission, it's just a personal read of the caller's own decisions/queue.
    [Authorize]
    [HttpGet("dashboard/my-activity")]
    public async Task<IActionResult> GetMyActivity([FromQuery] string username, [FromQuery] string? startDate, [FromQuery] string? endDate)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            return BadRequest("username is required.");
        }

        // Optional "between dates" scope. startDate/endDate are plain yyyy-MM-dd strings from the
        // frontend date pickers; endDate is treated as inclusive by bumping to the next day's start.
        DateTime? rangeStart = ParseDateOrNull(startDate);
        DateTime? rangeEndExclusive = ParseDateOrNull(endDate)?.Date.AddDays(1);

        var actions = (await _repository.GetApprovalActionsByUserAsync(username)).ToList();
        var pending = (await _repository.GetPendingWorkflowInstancesForUserAsync(username)).ToList();

        if (rangeStart.HasValue)
        {
            actions = actions.Where(a => a.ActionTimestamp >= rangeStart.Value).ToList();
            pending = pending.Where(p => p.CreatedAt >= rangeStart.Value).ToList();
        }
        if (rangeEndExclusive.HasValue)
        {
            actions = actions.Where(a => a.ActionTimestamp < rangeEndExclusive.Value).ToList();
            pending = pending.Where(p => p.CreatedAt < rangeEndExclusive.Value).ToList();
        }

        var purchaseOrders = (await _repository.GetPurchaseOrdersAsync()).ToList();
        var pendingIntakes = (await _repository.GetPendingIntakesAsync()).ToList();
        var transfers = (await _repository.GetBranchTransfersAsync()).ToList();

        string Summarize(string workflowType, int entityId)
        {
            if (workflowType == "PURCHASE_ORDER")
            {
                var po = purchaseOrders.FirstOrDefault(p => p.PoId == entityId);
                return po != null ? $"PO {po.PoNumber} ({po.Vendor?.VendorName ?? "Vendor"})" : $"PO #{entityId}";
            }
            if (workflowType == "INTAKE_SHIPMENT")
            {
                var pi = pendingIntakes.FirstOrDefault(p => p.PendingIntakeId == entityId);
                if (pi == null) return $"Intake #{entityId}";
                return pi.SourceType == "CUSTOMER"
                    ? $"Intake lot {pi.LotNumber} (Customer {pi.Customer?.CustomerName ?? "Unknown"} -- {pi.ReceiptReason})"
                    : $"Intake lot {pi.LotNumber} (PO {pi.PurchaseOrder?.PoNumber ?? "Unknown"})";
            }
            if (workflowType == "BRANCH_TRANSFER")
            {
                var tr = transfers.FirstOrDefault(t => t.TransferId == entityId);
                return tr != null ? $"Transfer {tr.Item?.SerialNumber ?? "item"} -> {tr.DestinationBranch?.BranchName ?? "branch"}" : $"Transfer #{entityId}";
            }
            return $"{workflowType} #{entityId}";
        }

        var actionsTaken = actions.Select(a => new
        {
            action_id = a.ActionId,
            instance_id = a.InstanceId,
            workflow_type = a.Instance?.WorkflowType ?? "UNKNOWN",
            entity_summary = a.Instance != null ? Summarize(a.Instance.WorkflowType, a.Instance.EntityId) : $"Instance #{a.InstanceId}",
            action = a.ActionTaken,
            comments = a.Comments,
            timestamp = a.ActionTimestamp
        }).ToList();

        var pendingList = pending.Select(i => new
        {
            instance_id = i.InstanceId,
            workflow_type = i.WorkflowType,
            entity_summary = Summarize(i.WorkflowType, i.EntityId),
            current_step_order = i.CurrentStepOrder,
            initiated_by = i.InitiatedBy,
            created_at = i.CreatedAt
        }).ToList();

        return Ok(new
        {
            actions_taken_count = actionsTaken.Count,
            approved_count = actionsTaken.Count(a => a.action == "APPROVED"),
            rejected_count = actionsTaken.Count(a => a.action == "REJECTED"),
            pending_count = pendingList.Count,
            actions_taken = actionsTaken,
            pending = pendingList
        });
    }

    // =========================================================================
    // EXECUTIVE BOARD DASHBOARD ("Executive Board")
    // =========================================================================
    // Scopes the board's KPIs (gold weight / ready / custody) and inventory table to
    // items whose lot was acquired within the given date range. Custody is scoped by
    // when the holding was allocated, since that's the event date for that KPI.
    // Was fully anonymous -- no [Authorize] at all -- exposing executive KPIs (gold weight,
    // ready/reserved/custody counts, the underlying inventory item list) to unauthenticated
    // callers. There was also no "dashboard" policy registered anywhere, so the seeded
    // per-role "dashboard" permission level was never enforced (see Program.cs).
    [Authorize(Policy = "dashboard.read")]
    [HttpGet("dashboard/executive-board")]
    public async Task<IActionResult> GetExecutiveBoard([FromQuery] string? startDate, [FromQuery] string? endDate)
    {
        DateTime? rangeStart = ParseDateOrNull(startDate);
        DateTime? rangeEndExclusive = ParseDateOrNull(endDate)?.Date.AddDays(1);

        var items = (await _repository.GetItemsAsync()).AsEnumerable();
        if (rangeStart.HasValue)
            items = items.Where(i => i.Lot != null && i.Lot.AcquisitionDate >= rangeStart.Value);
        if (rangeEndExclusive.HasValue)
            items = items.Where(i => i.Lot != null && i.Lot.AcquisitionDate < rangeEndExclusive.Value);
        var scopedItems = items.ToList();

        var goldWeightGrams = scopedItems
            .Where(i => i.Product?.MetalType?.MetalName == "Gold")
            .Sum(i => i.Product?.Denomination?.WeightGrams ?? 0m);

        var holdings = (await _repository.GetAllCustomerHoldingsAsync())
            .Where(h => h.StatusCode == "HELD_IN_CUSTODY")
            .AsEnumerable();
        if (rangeStart.HasValue)
            holdings = holdings.Where(h => h.AllocationDate >= rangeStart.Value);
        if (rangeEndExclusive.HasValue)
            holdings = holdings.Where(h => h.AllocationDate < rangeEndExclusive.Value);

        return Ok(new
        {
            total_gold_weight_kg = Math.Round(goldWeightGrams / 1000m, 2),
            ready_qty = scopedItems.Count(i => i.StatusCode == "READY"),
            reserved_qty = scopedItems.Count(i => i.StatusCode == "RESERVED"),
            custody_qty = holdings.Count(),
            items = scopedItems.Select(i => new
            {
                item_id = i.ItemId,
                serial_number = i.SerialNumber,
                metal = i.Product?.MetalType?.MetalName ?? "Unknown",
                denomination = i.Product?.Denomination?.Label ?? "Unknown",
                origin = i.Product?.OriginCountry ?? "Unknown",
                location = i.Location?.Description ?? "Unknown",
                location_id = i.LocationId,
                status = i.StatusCode,
                ownership = i.OwnershipType,
                acquisition_date = i.Lot?.AcquisitionDate
            })
        });
    }

    // =========================================================================
    // COMPLIANCE DASHBOARD -- Reporting Requirements Gap Analysis, Item 6.
    // ------------------------------------------------------------------------
    // The Executive Board dashboard above serves Management; Compliance/Audit
    // previously had no curated view of their own, just the audit-log search
    // screen (a search tool, not a dashboard). This summarizes the same
    // exceptions feed Item 5's report exposes (open reconciliation breaks,
    // rule blocks/warnings, low-stock breaches, overdue approvals) plus the
    // audit trail's tamper-check status -- both read-only rollups over data
    // every other module already writes.
    // =========================================================================
    [Authorize(Policy = "dashboard.read")]
    [HttpGet("dashboard/compliance")]
    public async Task<IActionResult> GetComplianceDashboard()
    {
        var (_, exceptionRows) = await BuildExceptionsTableAsync();

        var byType = exceptionRows.GroupBy(r => r[0])
            .Select(g => new { exception_type = g.Key, count = g.Count() })
            .OrderByDescending(g => g.count).ToList();
        var bySeverity = exceptionRows.GroupBy(r => r[3])
            .Select(g => new { severity = g.Key, count = g.Count() })
            .OrderByDescending(g => g.count).ToList();

        // Tamper-check status across the whole audit trail -- reuses the same row_hash
        // recompute-and-compare SearchAuditLogsAsync already does for the audit search screen
        // (PMIMSControllers.Audit.cs), rather than re-implementing hash verification here.
        var tampered = await _repository.SearchAuditLogsAsync(new AuditLogFilter { StatusFilter = "Tampered", Page = 1, PageSize = 1 });
        var unverified = await _repository.SearchAuditLogsAsync(new AuditLogFilter { StatusFilter = "Unverified", Page = 1, PageSize = 1 });

        return Ok(new
        {
            exceptions_total = exceptionRows.Count,
            exceptions_by_type = byType,
            exceptions_by_severity = bySeverity,
            recent_exceptions = exceptionRows.Take(25).Select(r => new
            {
                exception_type = r[0],
                reference = r[1],
                description = r[2],
                severity = r[3],
                raised_at = r[4],
                status = r[5]
            }),
            audit_tamper_check = new
            {
                tampered_count = tampered.TotalCount,
                unverified_count = unverified.TotalCount
            }
        });
    }

    // Parses a yyyy-MM-dd (or any culture-invariant DateTime-parseable) query string; returns
    // null on blank/unparseable input so callers can treat the range bound as "unbounded".
    private static DateTime? ParseDateOrNull(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed
            : (DateTime?)null;
    }

    private static readonly string[] AllModuleKeys =
    {
        "dashboard", "pending_actions", "purchase_orders", "spatial_map", "custody",
        "stocktake", "migration", "reports", "workflows", "settings", "user_admin",
        "vault_location", "master_data", "workflow_design", "intake",
        "rules_engine", "notifications", "monitoring", "dispensing", "device_integration"
    };

    // Reconstructs the caller's effective module permissions from the JWT "perm:*" claims.
    // IT/Admin is treated as a superuser with FULL access to every module.
    private static Dictionary<string, string> BuildPermissionMap(ClaimsPrincipal user)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        const string prefix = "perm:";
        foreach (var claim in user.Claims)
        {
            if (claim.Type.StartsWith(prefix, StringComparison.Ordinal))
                map[claim.Type.Substring(prefix.Length)] = claim.Value;
        }
        if (user.IsInRole("IT/Admin"))
        {
            foreach (var key in AllModuleKeys)
                map[key] = "FULL";
        }
        return map;
    }

    // SHA-256 utility for password hashing
    private static string ComputeSha256(string input)
    {
        using var sha = System.Security.Cryptography.SHA256.Create();
        var bytes = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}

// Request and DTO payloads
public class LoginRequest { public string Username { get; set; } = null!; public string Password { get; set; } = null!; }
public class CreateLocationRequest { public string ZoneRoom { get; set; } = null!; public string ShelfRow { get; set; } = null!; public string SlotBin { get; set; } = null!; }
public class CreatePORequest {
    public string PoNumber { get; set; } = null!; public int VendorId { get; set; } public decimal TotalWeightGrams { get; set; } public decimal TotalCost { get; set; } public string Currency { get; set; } = "USD"; public string CreatedBy { get; set; } = null!; public List<POItemDTO> Items { get; set; } = new();
    // Cost Tracking & Valuation -- purchase cost detail (supplier invoice + acquisition fees).
    // All optional so an existing/simple client that doesn't know about them still works.
    public string? SupplierInvoiceNumber { get; set; }
    public DateTime? SupplierInvoiceDate { get; set; }
    public decimal FreightCost { get; set; } = 0;
    public decimal InsuranceCost { get; set; } = 0;
    public decimal CustomsDutyCost { get; set; } = 0;
    public decimal OtherFeesCost { get; set; } = 0;
    public string? OtherFeesDescription { get; set; }
}
public class POItemDTO { public int product_id { get; set; } public int qty { get; set; } public decimal unit_cost { get; set; } }
public class IntakeRequest { public int PoId { get; set; } public string LotNumber { get; set; } = null!; public int LocationId { get; set; } public string ReceivedBy { get; set; } = null!; public List<IntakeItemDTO> Items { get; set; } = new(); }
public class IntakeItemDTO
{
    public string serial { get; set; } = null!;
    public int product_id { get; set; }

    // LBMA Good Delivery attributes -- all optional; omit for products/lots
    // where refiner/assay data isn't captured yet (GoodDeliveryStatus then
    // defaults to NOT_ASSESSED and shows up in GET /api/reports/lbma-compliance).
    public string? refiner_name { get; set; }
    public string? refiner_lbma_id { get; set; }
    public string? assay_certificate_number { get; set; }
    public decimal? fineness_ppt { get; set; }
    public string? hallmark_number { get; set; }
    public string? good_delivery_status { get; set; }
}
// Receipt of precious metals FROM a customer -- the mirror of IntakeRequest (which is the
// supplier/PO-based receipt). ReceiptReason: BUYBACK (KFH purchases the metal outright),
// CUSTODY_DEPOSIT (customer's own metal placed into vault safekeeping -- requires AccountId),
// or RETURN (a previously withdrawn/dispensed bar physically comes back). See
// IInventoryRepository.InitiateWorkflowIntakeAsync / IntakeInventoryItemsAsync.
public class CustomerReceiptRequest
{
    public int CustomerId { get; set; }
    public int? AccountId { get; set; }
    public string ReceiptReason { get; set; } = "BUYBACK";
    public string LotNumber { get; set; } = null!;
    public int LocationId { get; set; }
    public string ReceivedBy { get; set; } = null!;
    public List<IntakeItemDTO> Items { get; set; } = new();
}
public class TransferRequest { public int ItemId { get; set; } public int DestinationLocationId { get; set; } public string CourierInfo { get; set; } = null!; public string InitiatedBy { get; set; } = null!; }
public class ReserveRequest { public int CustomerId { get; set; } public int ProductId { get; set; } public int BranchId { get; set; } public int ChannelId { get; set; } }
public class PurchaseConfirmRequest { public Guid ReservationToken { get; set; } public int AccountId { get; set; } public decimal SalePrice { get; set; } public decimal MarkupAmount { get; set; } public string InvoiceNumber { get; set; } = null!; public string? CustodyAgreementNumber { get; set; } }
public class WithdrawalRequestModel { public int HoldingId { get; set; } public int BranchId { get; set; } }
public class WithdrawalConfirmRequest { public int HoldingId { get; set; } public int BranchId { get; set; } public string VerificationOtp { get; set; } = null!; public string RecipientSignature { get; set; } = null!; }
public class StartStocktakeRequest { public string SessionCode { get; set; } = null!; public int VaultId { get; set; } public string InitiatedBy { get; set; } = null!; public List<int> FreezeLocationIds { get; set; } = new(); }
public class LogScanRequest { public int SessionId { get; set; } public string ScannedSerial { get; set; } = null!; public int LocationId { get; set; } public string ScannedBy { get; set; } = null!; }
public class CommitMigrationRequest { public int MigrationId { get; set; } public string ApprovedBy { get; set; } = null!; }
public class CreateProductRequestDto { public string Label { get; set; } = null!; public string MetalName { get; set; } = null!; public decimal WeightGrams { get; set; } }
// FimAddUserRequest / FimAddProfileRequest retired -- see FimAttributesRequest
// and the rest of the /api/fim/* DTOs in PMIMSControllers.Fim.cs.

public class SaveTemplateRequest
{
    public string WorkflowType { get; set; } = null!;
    public string Name { get; set; } = null!;
    public string Description { get; set; } = null!;
    public List<WorkflowStepDTO> Steps { get; set; } = new();
}

public class WorkflowStepDTO
{
    public string step_name { get; set; } = null!;
    public string required_role { get; set; } = null!;
    public string description { get; set; } = null!;
}

public class WorkflowActionRequest
{
    public string Username { get; set; } = null!;
    public string Action { get; set; } = null!; // APPROVED, REJECTED
    public string? Comments { get; set; }
}

public class RunReconciliationRequest
{
    public string? ExecutedBy { get; set; }
}

public class CreateAppUserRequest
{
    public string Username { get; set; } = null!;
    public string DisplayName { get; set; } = null!;
    public string Email { get; set; } = null!;
    public string Password { get; set; } = null!;
    public string CreatedBy { get; set; } = "system-admin";
    public List<int>? GroupIds { get; set; }
}

public class UpdateAppUserRequest
{
    public string DisplayName { get; set; } = null!;
    public string Email { get; set; } = null!;
}

public class ToggleActiveRequest { public bool IsActive { get; set; } }

public class CreateGroupRequest
{
    public string GroupName { get; set; } = null!;
    public string Description { get; set; } = null!;
}

public class UpdateGroupRequest
{
    public string GroupName { get; set; } = null!;
    public string Description { get; set; } = null!;
}

public class SavePermissionsRequest
{
    public List<PermissionEntry> Permissions { get; set; } = new();
}

public class PermissionEntry
{
    public string ModuleKey { get; set; } = null!;
    public string AccessLevel { get; set; } = "HIDDEN";
}

public class AddMemberRequest
{
    public int UserId { get; set; }
    public string AssignedBy { get; set; } = "system-admin";
}

public class SaveReorderThresholdRequest
{
    public int? ThresholdId { get; set; }
    public int ProductId { get; set; }
    public int VendorId { get; set; }
    public int MinStockQty { get; set; }
    public int ReorderQty { get; set; }
    public bool IsActive { get; set; } = true;
}

public class DraftPORequest
{
    public string CreatedBy { get; set; } = "SYSTEM";
}

// Reporting Requirements Gap Analysis -- Item 8 (Cost Analysis & Variance).
public class SaveCostBudgetRequest
{
    public int? BudgetId { get; set; }
    public int MetalTypeId { get; set; }
    public string Period { get; set; } = null!; // yyyy-MM
    public decimal BudgetedUnitCostPerGram { get; set; }
    public string Currency { get; set; } = "KWD";
    public string? CreatedBy { get; set; }
}

// Sidebar Menu Layout -- admin-arrangeable navigation order.
public class SaveMenuLayoutRequest
{
    public List<string> Order { get; set; } = null!;
    public string? UpdatedBy { get; set; }
}

public class TransferWorkflowRequest
{
    public int ItemId { get; set; }
    public int DestinationBranchId { get; set; }
    public string CourierInfo { get; set; } = null!;
    public string InitiatedBy { get; set; } = null!;
}

public class ReceiveTransferRequest
{
    public string ReceivedBy { get; set; } = null!;
}

public class SaveBranchRequest
{
    public int? BranchId { get; set; }
    public string BranchCode { get; set; } = null!;
    public string BranchName { get; set; } = null!;
    public int VaultId { get; set; }
    public bool IsActive { get; set; } = true;
}
