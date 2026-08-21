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
    private readonly IMonitoringAdapter _monitoringAdapter;
    private readonly IBarcodeLabelService _barcodeLabelService;

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
        IMonitoringAdapter monitoringAdapter,
        IBarcodeLabelService barcodeLabelService)
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
        _monitoringAdapter = monitoringAdapter;
        _barcodeLabelService = barcodeLabelService;
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
            denomination_id = p.DenominationId,
            denomination_label = p.Denomination?.Label ?? "",
            weight_grams = p.Denomination?.WeightGrams ?? 0,
            purity_value = p.Purity?.PurityValue ?? 0,
            origin_country = p.OriginCountry,
            brand_id = p.BrandId,
            brand_name = p.Brand?.BrandName ?? p.BrandName ?? "",
            is_active = p.IsActive
        }));
    }

    [Authorize(Policy = "master_data.write")]
    [HttpPost("catalog/products")]
    public async Task<IActionResult> CreateProduct([FromBody] CreateProductRequestDto req)
    {
        var product = await _repository.CreateDenominationProductAsync(req.Label, req.MetalName, req.WeightGrams, req.OriginCountry, req.BrandId);
        return Ok(new
        {
            product_id = product.ProductId,
            product_code = product.ProductCode,
            metal_name = product.MetalType?.MetalName ?? "",
            denomination_label = product.Denomination?.Label ?? "",
            weight_grams = product.Denomination?.WeightGrams ?? 0,
            purity_value = product.Purity?.PurityValue ?? 0,
            origin_country = product.OriginCountry,
            brand_id = product.BrandId,
            brand_name = product.Brand?.BrandName ?? product.BrandName ?? "",
            is_active = product.IsActive
        });
    }

    // =========================================================================
    // 2b. BRAND / REFINER / MINT LOOKUP MASTER DATA
    // =========================================================================
    [HttpGet("catalog/brands")]
    public async Task<IActionResult> GetBrands()
    {
        var brands = await _repository.GetBrandsAsync();
        return Ok(brands.Select(b => new
        {
            brand_id = b.BrandId,
            brand_code = b.BrandCode,
            brand_name = b.BrandName,
            country_of_origin = b.CountryOfOrigin,
            lbma_refiner_id = b.LbmaRefinerId,
            is_lbma_certified = b.IsLbmaCertified,
            is_active = b.IsActive,
            description = b.Description,
            created_at = b.CreatedAt
        }));
    }

    [Authorize(Policy = "master_data.write")]
    [HttpPost("catalog/brands")]
    public async Task<IActionResult> CreateBrand([FromBody] CreateBrandRequestDto req)
    {
        if (string.IsNullOrWhiteSpace(req.BrandCode) || string.IsNullOrWhiteSpace(req.BrandName))
        {
            return BadRequest(new { error = "Brand code and brand name are required." });
        }

        var brand = await _repository.CreateBrandAsync(req.BrandCode, req.BrandName, req.CountryOfOrigin ?? "Switzerland", req.LbmaRefinerId, req.IsLbmaCertified, req.Description);
        return Created($"/api/catalog/brands/{brand.BrandId}", new
        {
            brand_id = brand.BrandId,
            brand_code = brand.BrandCode,
            brand_name = brand.BrandName,
            country_of_origin = brand.CountryOfOrigin,
            lbma_refiner_id = brand.LbmaRefinerId,
            is_lbma_certified = brand.IsLbmaCertified,
            is_active = brand.IsActive,
            description = brand.Description,
            created_at = brand.CreatedAt
        });
    }

    [Authorize(Policy = "master_data.write")]
    [HttpPut("catalog/brands/{id}")]
    public async Task<IActionResult> UpdateBrand(int id, [FromBody] CreateBrandRequestDto req)
    {
        var updated = await _repository.UpdateBrandAsync(id, req.BrandCode, req.BrandName, req.CountryOfOrigin ?? "Switzerland", req.LbmaRefinerId, req.IsLbmaCertified, req.Description);
        if (updated == null) return NotFound(new { error = "Brand not found." });

        return Ok(new
        {
            brand_id = updated.BrandId,
            brand_code = updated.BrandCode,
            brand_name = updated.BrandName,
            country_of_origin = updated.CountryOfOrigin,
            lbma_refiner_id = updated.LbmaRefinerId,
            is_lbma_certified = updated.IsLbmaCertified,
            is_active = updated.IsActive,
            description = updated.Description
        });
    }

    [Authorize(Policy = "master_data.write")]
    [HttpDelete("catalog/brands/{id}")]
    public async Task<IActionResult> DeleteBrand(int id)
    {
        var success = await _repository.DeleteBrandAsync(id);
        if (!success) return NotFound(new { error = "Brand not found." });
        return Ok(new { success = true });
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
            // VALIDATION: Ensure PURCHASE_ORDER workflow template exists before allowing PO creation
            var poWorkflow = await _repository.GetWorkflowTemplateByTypeAsync("PURCHASE_ORDER");
            if (poWorkflow == null || !poWorkflow.IsActive)
            {
                return BadRequest(new {
                    error = "Cannot create Purchase Order: No active PURCHASE_ORDER workflow template is configured. Please contact an administrator to set up the workflow first."
                });
            }

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
            // VALIDATION: Ensure INTAKE_SHIPMENT workflow template exists before allowing shipment receipt
            var intakeWorkflow = await _repository.GetWorkflowTemplateByTypeAsync("INTAKE_SHIPMENT");
            if (intakeWorkflow == null || !intakeWorkflow.IsActive)
            {
                return BadRequest(new {
                    error = "Cannot receive shipment: No active INTAKE_SHIPMENT workflow template is configured. Please contact an administrator to set up the workflow first."
                });
            }

            int? vendorId = req.VendorId;
            if (vendorId == null || vendorId <= 0)
            {
                var defaultVendor = (await _repository.GetVendorsAsync()).FirstOrDefault();
                vendorId = defaultVendor?.VendorId ?? 1;
            }

            string itemsJson = JsonSerializer.Serialize(req.Items);
            int? poId = (req.PoId == 0) ? null : req.PoId;
            var pending = await _repository.InitiateWorkflowIntakeAsync(
                poId, req.LotNumber, req.LocationId, req.ReceivedBy, itemsJson,
                sourceType: "SUPPLIER", customerId: null, accountId: null, receiptReason: null,
                vendorId: vendorId, shipmentReference: req.ShipmentReference, deliveryNoteNumber: req.DeliveryNoteNumber,
                airwayBillNumber: req.AirwayBillNumber, supportingDocumentUrl: req.SupportingDocumentUrl,
                discrepancyNotes: req.DiscrepancyNotes, receivingDate: req.ReceivingDate,
                ownershipType: string.IsNullOrWhiteSpace(req.OwnershipType) ? "KFH_OWNED" : req.OwnershipType);

            return Ok(new { pending_id = pending.PendingIntakeId, message = "Intake shipment verification request initiated and routed to the Maker-Checker workflow approval." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [HttpGet("vault/intake/pending")]
    [Authorize(Policy = "intake.read")]
    public async Task<IActionResult> GetPendingIntakes()
    {
        var list = await _repository.GetPendingIntakesAsync();
        return Ok(list.Select(pi => new {
            pending_id = pi.PendingIntakeId,
            lot_number = pi.LotNumber,
            source_type = pi.SourceType,
            ownership_type = pi.OwnershipType ?? "KFH_OWNED",
            vendor_id = pi.VendorId,
            vendor_name = pi.Vendor?.VendorName ?? (pi.SourceType == "CUSTOMER" ? (pi.Customer?.CustomerName ?? "Customer") : "Direct Supplier"),
            shipment_reference = pi.ShipmentReference,
            delivery_note = pi.DeliveryNoteNumber,
            airway_bill = pi.AirwayBillNumber,
            supporting_document_url = pi.SupportingDocumentUrl,
            discrepancy_notes = pi.DiscrepancyNotes,
            receiving_date = pi.ReceivingDate ?? pi.CreatedAt,
            status_code = pi.StatusCode,
            received_by = pi.ReceivedBy,
            location_id = pi.LocationId,
            location_desc = pi.Location != null ? $"{pi.Location.ZoneRoom} - {pi.Location.ShelfRow} - {pi.Location.SlotBin}" : "Main Vault",
            serials_json = pi.SerialsJsonList,
            created_at = pi.CreatedAt
        }));
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
            // VALIDATION: Ensure INTAKE_SHIPMENT workflow template exists before allowing customer receipt
            var intakeWorkflow = await _repository.GetWorkflowTemplateByTypeAsync("INTAKE_SHIPMENT");
            if (intakeWorkflow == null || !intakeWorkflow.IsActive)
            {
                return BadRequest(new {
                    error = "Cannot receive from customer: No active INTAKE_SHIPMENT workflow template is configured. Please contact an administrator to set up the workflow first."
                });
            }

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

    [Authorize(Policy = "intake.write")]
    [HttpPost("transfers")]
    public async Task<IActionResult> TransferStock([FromBody] TransferRequest req)
    {
        string result = await _repository.InitiateBranchTransferAsync(req.ItemId, req.DestinationLocationId, req.CourierInfo, req.InitiatedBy);
        if (result != "SUCCESS") return BadRequest(result);

        return Ok(new { message = "Branch transfer initiated successfully. Stock locked in TRANSIT status." });
    }

    [Authorize(Policy = "intake.write")]
    [HttpPost("transfers/workflow-initiate")]
    public async Task<IActionResult> TransferStockWorkflow([FromBody] TransferWorkflowRequest req)
    {
        try
        {
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

            var transfer = await _repository.InitiateWorkflowBranchTransferAsync(
                req.ItemId, req.DestinationBranchId, req.CourierInfo, req.InitiatedBy);

            return Ok(new { transfer_id = transfer.TransferId, message = "Branch transfer workflow initiated successfully." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "intake.read")]
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

    [Authorize(Policy = "intake.write")]
    [HttpPost("transfers/{id}/receive")]
    public async Task<IActionResult> ReceiveBranchTransfer([FromRoute] int id, [FromBody] ReceiveTransferRequest req)
    {
        // VALIDATION: Ensure BRANCH_TRANSFER workflow template exists before allowing transfer receipt
        var transferWorkflow = await _repository.GetWorkflowTemplateByTypeAsync("BRANCH_TRANSFER");
        if (transferWorkflow == null || !transferWorkflow.IsActive)
        {
            return BadRequest(new {
                error = "Cannot receive branch transfer: No active BRANCH_TRANSFER workflow template is configured. Please contact an administrator to set up the workflow first."
            });
        }

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
                        vendor_id = pending.VendorId,
                        vendor_name = pending.Vendor?.VendorName ?? (pending.SourceType == "CUSTOMER" ? (pending.Customer?.CustomerName ?? "Customer") : "Direct Supplier"),
                        shipment_reference = pending.ShipmentReference,
                        delivery_note = pending.DeliveryNoteNumber,
                        airway_bill = pending.AirwayBillNumber,
                        supporting_document_url = pending.SupportingDocumentUrl,
                        discrepancy_notes = pending.DiscrepancyNotes,
                        receiving_date = pending.ReceivingDate ?? pending.CreatedAt,
                        po_id = pending.PoId,
                        po_number = pending.SourceType == "CUSTOMER" ? null : (pending.PurchaseOrder?.PoNumber ?? "Direct Shipment"),
                        customer_id = pending.CustomerId,
                        customer_name = pending.Customer?.CustomerName,
                        account_id = pending.AccountId,
                        receipt_reason = pending.ReceiptReason,
                        lot_number = pending.LotNumber,
                        location_id = pending.LocationId,
                        location_name = $"{pending.Location?.ZoneRoom}-{pending.Location?.ShelfRow}-{pending.Location?.SlotBin}",
                        received_by = pending.ReceivedBy,
                        status_code = pending.StatusCode,
                        serials_json = pending.SerialsJsonList,
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
            else if (inst.WorkflowType == "TURKEY_PURCHASE")
            {
                var purchases = await _repository.GetPendingTurkeyPurchasesAsync();
                var pur = purchases.FirstOrDefault(p => p.PendingPurchaseId == inst.EntityId);
                if (pur != null)
                {
                    entityDetails = new
                    {
                        pending_purchase_id = pur.PendingPurchaseId,
                        batch_reference = pur.BatchReference,
                        total_items = pur.TotalItems,
                        total_weight_grams = pur.TotalWeightGrams,
                        unit_price = pur.UnitPricePerGram,
                        total_cost = pur.TotalCost,
                        requested_by = pur.RequestedBy,
                        notes = pur.Notes,
                        serials_json = pur.SerialsJsonList,
                        status_code = pur.StatusCode,
                        created_by = pur.RequestedBy
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
            if (workflowType == "TURKEY_PURCHASE")
            {
                return $"Turkey Purchase #{entityId}";
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

        // Filter by date range if provided; items without a Lot are included in the result
        // even if outside the range (they represent undated/legacy inventory)
        if (rangeStart.HasValue)
            items = items.Where(i => i.Lot == null || i.Lot.AcquisitionDate >= rangeStart.Value);
        if (rangeEndExclusive.HasValue)
            items = items.Where(i => i.Lot == null || i.Lot.AcquisitionDate < rangeEndExclusive.Value);
        var scopedItems = items.ToList();

        // Proprietary Gold Stock: gold before transfer to KFH (Turkey Consignment / Inbound)
        var proprietaryBeforeTransferWeightGrams = scopedItems
            .Where(i => i.Product?.MetalType?.MetalName == "Gold" && i.OwnershipType == "TURKEY_OWNED")
            .Sum(i => i.Product?.Denomination?.WeightGrams ?? 0m);

        // ============================================================
        // Main Vault / Sold / Available-for-Customers cards.
        // "Available for customers / Ready for Sale": gold AFTER transfer from Turkey to KFH (KFH-owned, READY status)
        // ============================================================
        var mainVaultItems = scopedItems.Where(i => i.Location?.Vault?.VaultName == "Main Vault").ToList();
        var soldItems = scopedItems.Where(i => i.OwnershipType == "CUSTOMER_OWNED").ToList();
        var availableItems = scopedItems.Where(i => i.StatusCode == "READY" && i.OwnershipType == "KFH_OWNED").ToList();

        static decimal WeightKg(IEnumerable<InventoryItem> list) =>
            Math.Round(list.Sum(i => i.Product?.Denomination?.WeightGrams ?? 0m) / 1000m, 3);

        var holdings = (await _repository.GetAllCustomerHoldingsAsync())
            .Where(h => h.StatusCode == "HELD_IN_CUSTODY")
            .AsEnumerable();
        if (rangeStart.HasValue)
            holdings = holdings.Where(h => h.AllocationDate >= rangeStart.Value);
        if (rangeEndExclusive.HasValue)
            holdings = holdings.Where(h => h.AllocationDate < rangeEndExclusive.Value);

        // ============================================================
        // PURCHASE ORDER RECEIPT TRACKING
        // ============================================================
        var purchaseOrders = (await _repository.GetPurchaseOrdersAsync())
            .AsEnumerable();
        if (rangeStart.HasValue)
            purchaseOrders = purchaseOrders.Where(p => p.CreatedAt >= rangeStart.Value);
        if (rangeEndExclusive.HasValue)
            purchaseOrders = purchaseOrders.Where(p => p.CreatedAt < rangeEndExclusive.Value);
        var scopedPOs = purchaseOrders.ToList();

        return Ok(new
        {
            total_gold_weight_kg = Math.Round(proprietaryBeforeTransferWeightGrams / 1000m, 3),
            // Dropped the old `ready_qty` field: it used to be `i.StatusCode == "READY"` with
            // no ownership check, which double-counted sold-but-still-custodied bars as
            // available stock. Fixing that filter to require OwnershipType == KFH_OWNED made
            // it numerically identical to `available_qty` below, so this was a duplicate
            // dashboard card rather than a distinct metric -- see availableItems above.
            reserved_qty = scopedItems.Count(i => i.StatusCode == "RESERVED"),
            reserved_weight_kg = WeightKg(scopedItems.Where(i => i.StatusCode == "RESERVED").ToList()),
            custody_qty = holdings.Count(),
            custody_weight_kg = WeightKg(holdings.Select(h => h.Item).ToList()),
            main_vault_qty = mainVaultItems.Count,
            main_vault_weight_kg = WeightKg(mainVaultItems),
            sold_qty = soldItems.Count,
            sold_weight_kg = WeightKg(soldItems),
            available_qty = availableItems.Count,
            available_weight_kg = WeightKg(availableItems),
            purchase_orders = new
            {
                total = scopedPOs.Count,
                pending_approval = scopedPOs.Count(p => p.StatusCode == "PENDING_APPROVAL"),
                approved = scopedPOs.Count(p => p.StatusCode == "APPROVED"),
                partial_receipt = scopedPOs.Count(p => p.StatusCode == "PARTIAL_RECEIPT"),
                fully_received = scopedPOs.Count(p => p.StatusCode == "RECEIVED")
            },
            purchase_order_list = scopedPOs.Select(p => new
            {
                po_id = p.PoId,
                po_number = p.PoNumber,
                vendor_name = p.Vendor?.VendorName ?? "Unknown",
                status = p.StatusCode,
                total_cost = p.TotalCost,
                currency = p.Currency,
                created_at = p.CreatedAt,
                order_date = p.OrderDate,
                expected_delivery = p.ExpectedDeliveryDate,
                items = p.Items.Select(i => new
                {
                    product_id = i.ProductId,
                    ordered_qty = i.OrderedQuantity,
                    received_qty = i.ReceivedQuantity,
                    product_name = i.Product?.ProductCode ?? "Unknown"
                })
            }),
            items = scopedItems.Select(i => new
            {
                item_id = i.ItemId,
                serial_number = i.SerialNumber,
                metal = i.Product?.MetalType?.MetalName ?? "Unknown",
                denomination = i.Product?.Denomination?.Label ?? "Unknown",
                weight_grams = i.Product?.Denomination?.WeightGrams ?? 0m,
                purity = i.Product?.Purity?.PurityValue ?? 0.9999m,
                product_name = i.Product?.ProductCode ?? i.Product?.Denomination?.Label ?? "Gold Bar",
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
        "dashboard", "pending_actions", "spatial_map", "custody",
        "stocktake", "migration", "reports", "workflows", "settings", "user_admin",
        "vault_location", "master_data", "workflow_design", "intake",
        "rules_engine", "monitoring", "barcode_qr_labeling",
        "purchase_orders", "dispensing", "device_integration", "notifications"
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

    // =========================================================================
    // GFS & Damaged Bar Operations (BRD Alignment)
    // =========================================================================
    [Authorize(Policy = "intake.read")]
    [HttpPost("inventory/items/scan-qr")]
    public async Task<IActionResult> ScanQr([FromBody] ScanQrRequest req)
    {
        try
        {
            var item = await _repository.ScanBarWithGfsLookupAsync(req.SerialNumber);
            if (item == null) return NotFound(new { error = "Gold bar not found in inventory." });
            return Ok(item);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "custody.write")]
    [HttpPost("inventory/items/{id}/mark-damaged")]
    public async Task<IActionResult> MarkDamaged(int id, [FromBody] MarkDamagedRequest req)
    {
        try
        {
            string username = User.Identity?.Name ?? "system";
            var result = await _repository.MarkBarDamagedAsync(id, req.Reason, req.Description, req.EvidenceDocId, username);
            if (result != "SUCCESS") return BadRequest(new { error = result });
            return Ok(new { message = "Marked as damaged, pending approval." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "custody.write")]
    [HttpPost("inventory/items/{id}/damage-action")]
    public async Task<IActionResult> ProcessDamagedAction(int id, [FromBody] ProcessDamageActionRequest req)
    {
        try
        {
            string username = User.Identity?.Name ?? "system";
            var result = await _repository.ProcessDamagedBarActionAsync(id, req.Action, username);
            if (result != "SUCCESS") return BadRequest(new { error = result });
            return Ok(new { message = $"Damage action '{req.Action}' processed successfully." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "custody.read")]
    [HttpGet("inventory/damaged-items")]
    public async Task<IActionResult> GetDamagedBars()
    {
        var bars = await _repository.GetDamagedBarsAsync();
        return Ok(bars);
    }

    [Authorize(Policy = "intake.write")]
    [HttpPost("gfs/delivery-requests")]
    public async Task<IActionResult> CreateGfsDeliveryRequest([FromBody] CreateGfsDeliveryRequest req)
    {
        try
        {
            var request = await _repository.CreateGfsDeliveryRequestAsync(req.GfsRefNumber, req.BarId, req.CustomerAccountNumber, req.DestinationBranchId, req.RouteDetails);
            return Ok(request);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "intake.read")]
    [HttpGet("gfs/delivery-requests")]
    public async Task<IActionResult> GetGfsDeliveryRequests()
    {
        var requests = await _repository.GetGfsDeliveryRequestsAsync();
        return Ok(requests);
    }

    [Authorize(Policy = "intake.write")]
    [HttpPost("gfs/delivery-requests/{id}/dispatch")]
    public async Task<IActionResult> DispatchGfsBranchDelivery(int id, [FromBody] DispatchGfsBranchRequest? req)
    {
        try
        {
            string username = User.Identity?.Name ?? "system";
            string company = req?.CourierCompany ?? "KFH Secure Logistics";
            string repName = req?.CourierRepName ?? "Authorized Transporter";
            string civilId = req?.CourierCivilId ?? "285010101234";
            string plate = req?.VehiclePlate ?? "KWT-10-8899";
            string seal = req?.SecuritySealNumber ?? $"SEAL-{DateTime.UtcNow.Ticks % 1000000:D6}";

            var result = await _repository.DispatchGfsBranchDeliveryAsync(id, company, repName, civilId, plate, seal, username);
            if (!result.StartsWith("SUCCESS")) return BadRequest(new { error = result });
            return Ok(new { message = "Dispatched successfully to courier." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "intake.write")]
    [HttpPost("gfs/delivery-requests/{id}/receive")]
    public async Task<IActionResult> ReceiveGfsBranchDelivery(int id, [FromBody] ReceiveGfsBranchDeliveryRequest req)
    {
        try
        {
            string username = User.Identity?.Name ?? "system";
            var result = await _repository.ReceiveGfsBranchDeliveryAsync(id, req.ScannedSerialNumber, req.DestinationBranchId, username, req.ManualOverride, req.OverrideReason);
            if (!result.StartsWith("SUCCESS")) return BadRequest(new { error = result });
            return Ok(new { message = "Received successfully at branch." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    // =========================================================================
    // Home Delivery Endpoints (UC07)
    // =========================================================================
    [Authorize(Policy = "intake.write")]
    [HttpPost("gfs/home-delivery")]
    public async Task<IActionResult> CreateHomeDelivery([FromBody] CreateHomeDeliveryApiRequest req)
    {
        try
        {
            string username = User.Identity?.Name ?? "system";
            if (!_repository.ValidateKuwaitCivilId(req.CustomerCivilId))
            {
                return BadRequest(new { error = "Invalid Kuwait PACI Civil ID format or checksum." });
            }

            string delNum = $"HD-KFH-{DateTime.UtcNow.Year}-{new Random().Next(1000, 9999)}";
            var hd = await _repository.CreateHomeDeliveryRequestAsync(
                delNum, req.BarId, req.CustomerAccountNumber, req.CustomerCivilId,
                req.CustomerName, req.CustomerPhone, req.Governorate, req.Area,
                req.Block, req.Street, req.BuildingHouse, req.FloorFlat,
                req.SpecialInstructions, username);

            return Ok(hd);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "intake.read")]
    [HttpGet("gfs/home-delivery")]
    public async Task<IActionResult> GetHomeDeliveries()
    {
        var list = await _repository.GetHomeDeliveryRequestsAsync();
        return Ok(list);
    }

    [Authorize(Policy = "intake.read")]
    [HttpGet("gfs/home-delivery/{id:int}")]
    public async Task<IActionResult> GetHomeDeliveryById(int id)
    {
        var hd = await _repository.GetHomeDeliveryRequestByIdAsync(id);
        if (hd == null) return NotFound(new { error = "Home delivery request not found." });
        return Ok(hd);
    }

    [Authorize(Policy = "intake.write")]
    [HttpPost("gfs/home-delivery/{id:int}/dispatch")]
    public async Task<IActionResult> DispatchHomeDelivery(int id, [FromBody] DispatchHomeDeliveryApiRequest req)
    {
        try
        {
            string username = User.Identity?.Name ?? "system";
            var result = await _repository.DispatchHomeDeliveryAsync(
                id, req.CourierCompany, req.CourierRepName, req.CourierCivilId,
                req.VehiclePlate, req.SecuritySealNumber, username);

            if (!result.StartsWith("SUCCESS")) return BadRequest(new { error = result });
            return Ok(new { message = "Home delivery dispatched to courier." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "intake.write")]
    [HttpPost("gfs/home-delivery/{id:int}/confirm-handover")]
    public async Task<IActionResult> ConfirmHomeDeliveryHandover(int id, [FromBody] ConfirmHomeDeliveryApiRequest req)
    {
        try
        {
            string username = User.Identity?.Name ?? "system";
            var result = await _repository.ConfirmHomeDeliveryHandoverAsync(
                id, req.VerificationOtp, req.RecipientCivilId, req.RecipientSignature, username);

            if (!result.StartsWith("SUCCESS")) return BadRequest(new { error = result });
            return Ok(new { message = "Home delivery customer handover confirmed successfully." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    // =========================================================================
    // Kuwait Regulatory / PACI Civil ID & GFS Customer Profile Lookups
    // =========================================================================
    [HttpGet("validation/civil-id/{civilId}")]
    public IActionResult ValidateCivilId(string civilId)
    {
        bool isValid = _repository.ValidateKuwaitCivilId(civilId);
        return Ok(new { civilId, isValid, message = isValid ? "Valid Kuwait PACI Civil ID" : "Invalid Civil ID format or checksum" });
    }

    [Authorize(Policy = "dashboard.read")]
    [HttpGet("gfs/customer-profile/{civilIdOrAccount}")]
    public async Task<IActionResult> GetGfsCustomerProfile(string civilIdOrAccount, [FromServices] IGfsService gfsService)
    {
        var (success, name, rim, acc, holding) = await gfsService.LookupCustomerProfileAsync(civilIdOrAccount);
        return Ok(new { success, customerName = name, customerRim = rim, accountNumber = acc, goldHoldingGrams = holding });
    }

    [Authorize(Policy = "intake.write")]
    [HttpPost("gfs/sync-eod")]
    public async Task<IActionResult> SyncGfsEod()
    {
        try
        {
            string username = User.Identity?.Name ?? "system";
            var log = await _repository.SyncGfsEodAsync(username);
            return Ok(log);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "intake.read")]
    [HttpGet("gfs/sync-logs")]
    public async Task<IActionResult> GetGfsSyncLogs()
    {
        var logs = await _repository.GetGfsSyncLogsAsync();
        return Ok(logs);
    }

    [Authorize(Policy = "master_data.read")]
    [HttpGet("inventory/stock-thresholds")]
    public async Task<IActionResult> GetStockCutoffThresholds()
    {
        var thresholds = await _repository.GetStockCutoffThresholdsAsync();
        return Ok(thresholds);
    }

    [Authorize(Policy = "master_data.write")]
    [HttpPost("inventory/stock-thresholds")]
    public async Task<IActionResult> SaveStockCutoffThreshold([FromBody] SaveStockThresholdRequest req)
    {
        try
        {
            string username = User.Identity?.Name ?? "system";
            var th = new StockCutoffThreshold
            {
                ThresholdId = req.ThresholdId ?? 0,
                AlertType = req.AlertType,
                ProductId = req.ProductId,
                DenominationId = req.DenominationId,
                CutoffValueKg = req.CutoffValueKg,
                CreatedBy = username,
                StatusCode = "PENDING_MAKER"
            };
            var saved = await _repository.SaveStockCutoffThresholdAsync(th);
            return Ok(saved);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "master_data.write")]
    [HttpPost("inventory/stock-thresholds/{id}/action")]
    public async Task<IActionResult> ProcessStockThresholdAction(int id, [FromBody] ProcessThresholdActionRequest req)
    {
        try
        {
            string username = User.Identity?.Name ?? "system";
            var result = await _repository.ProcessStockCutoffThresholdActionAsync(id, username, req.Action);
            if (result != "SUCCESS") return BadRequest(new { error = result });
            return Ok(new { message = "Action processed successfully." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "master_data.read")]
    [HttpGet("inventory/stock-alerts/enterprise")]
    public async Task<IActionResult> EvaluateEnterpriseStockAlerts()
    {
        var alerts = await _repository.EvaluateEnterpriseStockAlertsAsync();
        return Ok(alerts);
    }

    private static string ComputeSha256(string input)
    {
        using var sha = System.Security.Cryptography.SHA256.Create();
        var bytes = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}

public class ScanQrRequest { public string SerialNumber { get; set; } = null!; }
public class MarkDamagedRequest { public string Reason { get; set; } = null!; public string Description { get; set; } = null!; public string EvidenceDocId { get; set; } = null!; }
public class ProcessDamageActionRequest { public string Action { get; set; } = null!; }
public class CreateGfsDeliveryRequest { public string GfsRefNumber { get; set; } = null!; public int BarId { get; set; } public string? CustomerAccountNumber { get; set; } public int DestinationBranchId { get; set; } public string RouteDetails { get; set; } = null!; }
public class DispatchGfsBranchRequest { public string? CourierCompany { get; set; } public string? CourierRepName { get; set; } public string? CourierCivilId { get; set; } public string? VehiclePlate { get; set; } public string? SecuritySealNumber { get; set; } }
public class ReceiveGfsBranchDeliveryRequest { public string ScannedSerialNumber { get; set; } = null!; public int DestinationBranchId { get; set; } public bool ManualOverride { get; set; } = false; public string? OverrideReason { get; set; } }
public class ReceiveGfsDeliveryRequest { public bool ValidationPassed { get; set; } }
public class CreateHomeDeliveryApiRequest
{
    public int BarId { get; set; }
    public string CustomerAccountNumber { get; set; } = null!;
    public string CustomerCivilId { get; set; } = null!;
    public string CustomerName { get; set; } = null!;
    public string CustomerPhone { get; set; } = null!;
    public string Governorate { get; set; } = null!;
    public string Area { get; set; } = null!;
    public string Block { get; set; } = null!;
    public string Street { get; set; } = null!;
    public string BuildingHouse { get; set; } = null!;
    public string? FloorFlat { get; set; }
    public string? SpecialInstructions { get; set; }
}
public class DispatchHomeDeliveryApiRequest
{
    public string CourierCompany { get; set; } = "KFH Secure Transport";
    public string CourierRepName { get; set; } = "Authorized Driver";
    public string CourierCivilId { get; set; } = "285010101234";
    public string VehiclePlate { get; set; } = "KWT-10-8899";
    public string SecuritySealNumber { get; set; } = "SEAL-009988";
}
public class ConfirmHomeDeliveryApiRequest
{
    public string VerificationOtp { get; set; } = null!;
    public string RecipientCivilId { get; set; } = null!;
    public string? RecipientSignature { get; set; }
}
public class SaveStockThresholdRequest { public int? ThresholdId { get; set; } public string AlertType { get; set; } = null!; public int ProductId { get; set; } public int DenominationId { get; set; } public decimal CutoffValueKg { get; set; } }
public class ProcessThresholdActionRequest { public string Action { get; set; } = null!; }

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
public class IntakeRequest
{
    public int? PoId { get; set; }
    public int? VendorId { get; set; }
    public string? ShipmentReference { get; set; }
    public string? DeliveryNoteNumber { get; set; }
    public string? AirwayBillNumber { get; set; }
    public string? SupportingDocumentUrl { get; set; }
    public string? DiscrepancyNotes { get; set; }
    public DateTime? ReceivingDate { get; set; }
    public string LotNumber { get; set; } = null!;
    public int LocationId { get; set; }
    public string ReceivedBy { get; set; } = null!;
    public string OwnershipType { get; set; } = "KFH_OWNED"; // KFH_OWNED or TURKEY_OWNED
    public List<IntakeItemDTO> Items { get; set; } = new();
}

public class TurkeyPurchaseRequest
{
    public List<string> SerialNumbers { get; set; } = new();
    public decimal UnitPricePerGram { get; set; }
    public string? RequestedBy { get; set; }
    public string? Notes { get; set; }
}

public class IntakeItemDTO
{
    public string serial { get; set; } = null!;
    public int product_id { get; set; }
    public decimal? weight_grams { get; set; }
    public decimal? purity { get; set; }
    public bool is_damaged { get; set; } = false;
    public string? damage_reason { get; set; }

    // LBMA Good Delivery attributes
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
public class CreateProductRequestDto
{
    public string Label { get; set; } = null!;
    public string MetalName { get; set; } = null!;
    public decimal WeightGrams { get; set; }
    public string OriginCountry { get; set; } = "Unknown";  // Origin country (e.g., Turkey, Switzerland)
    public int? BrandId { get; set; }
}

public class CreateBrandRequestDto
{
    public string BrandCode { get; set; } = null!;
    public string BrandName { get; set; } = null!;
    public string? CountryOfOrigin { get; set; } = "Switzerland";
    public string? LbmaRefinerId { get; set; }
    public bool IsLbmaCertified { get; set; } = true;
    public string? Description { get; set; }
}
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
