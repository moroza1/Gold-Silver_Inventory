using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PMIMS.Domain;

namespace PMIMS.WebAPI.Controllers;

public partial class PMIMSControllers
{
    // =========================================================================
    // Turkey Consignment Stock & KFH Purchase Module
    // =========================================================================

    [HttpGet("inventory/turkey")]
    [Authorize(Policy = "purchase_orders.read")]
    public async Task<IActionResult> GetTurkeyInventory()
    {
        try
        {
            var items = (await _repository.GetTurkeyInventoryAsync()).ToList();
            var itemIds = items.Select(i => i.ItemId).ToList();
            var printedItemIds = await _repository.GetPrintedLabelItemIdsAsync(itemIds);
            bool qrRequired = await _repository.IsQrCodeRequiredForTurkeyTransferAsync();

            var missingItems = (await _repository.GetTurkeyMissingItemsAsync()).ToList();

            var summary = new
            {
                total_bars = items.Count,
                total_weight_grams = items.Sum(i => i.Product?.Denomination?.WeightGrams ?? 0),
                total_weight_kg = Math.Round(items.Sum(i => i.Product?.Denomination?.WeightGrams ?? 0) / 1000m, 4),
                total_missing_bars = missingItems.Count,
                total_missing_weight_grams = missingItems.Sum(i => i.Product?.Denomination?.WeightGrams ?? 0),
                total_missing_weight_kg = Math.Round(missingItems.Sum(i => i.Product?.Denomination?.WeightGrams ?? 0) / 1000m, 4),
                qr_required_for_transfer = qrRequired,
                total_qr_printed = items.Count(i => printedItemIds.Contains(i.ItemId)),
                total_qr_missing = items.Count(i => !printedItemIds.Contains(i.ItemId)),
                by_product = items.GroupBy(i => i.Product?.ProductCode ?? "UNKNOWN")
                    .Select(g => new
                    {
                        product_code = g.Key,
                        metal_name = g.First().Product?.MetalType?.MetalName ?? "Gold",
                        denomination = g.First().Product?.Denomination?.Label ?? "1kg Bar",
                        weight_grams = g.First().Product?.Denomination?.WeightGrams ?? 0,
                        count = g.Count(),
                        total_grams = g.Sum(x => x.Product?.Denomination?.WeightGrams ?? 0)
                    }).ToList()
            };

            var itemsList = items.Select(i => new
            {
                item_id = i.ItemId,
                serial_number = i.SerialNumber,
                product_id = i.ProductId,
                product_code = i.Product?.ProductCode,
                metal_name = i.Product?.MetalType?.MetalName,
                denomination = i.Product?.Denomination?.Label,
                weight_grams = i.Product?.Denomination?.WeightGrams ?? 0,
                purity = i.Product?.Purity?.PurityValue,
                fineness_ppt = i.FinenessPpt,
                brand_name = i.Product?.Brand?.BrandName,
                refiner_name = i.RefinerName,
                origin_country = i.Product?.OriginCountry ?? "Turkey",
                location_id = i.LocationId,
                vault_name = i.Location?.Vault?.VaultName ?? "Main Vault",
                location_code = i.Location != null ? $"{i.Location.ZoneRoom} / {i.Location.ShelfRow} / {i.Location.SlotBin}" : "Unassigned",
                ownership_type = i.OwnershipType,
                status_code = i.StatusCode,
                lot_number = i.Lot?.LotNumber,
                has_qr_printed = printedItemIds.Contains(i.ItemId)
            }).ToList();

            return Ok(new
            {
                summary,
                items = itemsList
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [HttpGet("inventory/turkey/pending")]
    [Authorize(Policy = "purchase_orders.read")]
    public async Task<IActionResult> GetPendingTurkeyPurchases()
    {
        try
        {
            var purchases = await _repository.GetPendingTurkeyPurchasesAsync();
            return Ok(purchases.Select(p => new
            {
                pending_purchase_id = p.PendingPurchaseId,
                batch_reference = p.BatchReference,
                total_items = p.TotalItems,
                total_weight_grams = p.TotalWeightGrams,
                unit_price = p.UnitPricePerGram,
                total_cost = p.TotalCost,
                requested_by = p.RequestedBy,
                notes = p.Notes,
                status_code = p.StatusCode,
                serials_json = p.SerialsJsonList,
                created_at = p.CreatedAt,
                approved_by = p.ApprovedBy,
                approved_at = p.ApprovedAt
            }));
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [HttpPost("inventory/turkey/purchase")]
    [Authorize(Policy = "purchase_orders.write")]
    public async Task<IActionResult> InitiateTurkeyPurchase([FromBody] TurkeyPurchaseRequest req)
    {
        try
        {
            if (req.SerialNumbers == null || req.SerialNumbers.Count == 0)
            {
                return BadRequest(new { error = "Please select or provide at least one Turkey serial number to purchase." });
            }

            string requestedBy = !string.IsNullOrWhiteSpace(req.RequestedBy) ? req.RequestedBy : (User.Identity?.Name ?? "Treasury Maker");

            var pending = await _repository.InitiateTurkeyPurchaseWorkflowAsync(
                req.SerialNumbers,
                req.UnitPricePerGram,
                requestedBy,
                req.Notes);

            return Ok(new
            {
                pending_purchase_id = pending.PendingPurchaseId,
                batch_reference = pending.BatchReference,
                total_items = pending.TotalItems,
                total_weight_grams = pending.TotalWeightGrams,
                total_cost = pending.TotalCost,
                message = "Turkey gold purchase request initiated and routed to the Maker-Checker workflow for Checker approval."
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    // =========================================================================
    // VIP Exclusive Stock & Dispensation Module (Non-Online Inventory)
    // =========================================================================

    [HttpGet("inventory/vip")]
    [Authorize(Policy = "custody.read")]
    public async Task<IActionResult> GetVipInventory()
    {
        try
        {
            var items = (await _repository.GetVipInventoryAsync()).ToList();
            var itemIds = items.Select(i => i.ItemId).ToList();
            var printedItemIds = await _repository.GetPrintedLabelItemIdsAsync(itemIds);

            var summary = new
            {
                total_bars = items.Count,
                total_weight_grams = items.Sum(i => i.Product?.Denomination?.WeightGrams ?? 0),
                total_weight_kg = Math.Round(items.Sum(i => i.Product?.Denomination?.WeightGrams ?? 0) / 1000m, 4),
                total_qr_printed = items.Count(i => printedItemIds.Contains(i.ItemId)),
                total_qr_missing = items.Count(i => !printedItemIds.Contains(i.ItemId)),
                by_product = items.GroupBy(i => i.Product?.ProductCode ?? "UNKNOWN")
                    .Select(g => new
                    {
                        product_code = g.Key,
                        metal_name = g.First().Product?.MetalType?.MetalName ?? "Gold",
                        denomination = g.First().Product?.Denomination?.Label ?? "1kg Bar",
                        weight_grams = g.First().Product?.Denomination?.WeightGrams ?? 0,
                        count = g.Count(),
                        total_grams = g.Sum(x => x.Product?.Denomination?.WeightGrams ?? 0)
                    }).ToList()
            };

            var itemsList = items.Select(i => new
            {
                item_id = i.ItemId,
                serial_number = i.SerialNumber,
                product_id = i.ProductId,
                product_code = i.Product?.ProductCode,
                metal_name = i.Product?.MetalType?.MetalName,
                denomination = i.Product?.Denomination?.Label,
                weight_grams = i.Product?.Denomination?.WeightGrams ?? 0,
                purity = i.Product?.Purity?.PurityValue,
                fineness_ppt = i.FinenessPpt,
                brand_name = i.Product?.Brand?.BrandName,
                refiner_name = i.RefinerName,
                origin_country = i.Product?.OriginCountry ?? "Turkey",
                location_id = i.LocationId,
                vault_name = i.Location?.Vault?.VaultName ?? "Main Vault",
                location_code = i.Location != null ? $"{i.Location.ZoneRoom} / {i.Location.ShelfRow} / {i.Location.SlotBin}" : "Unassigned",
                ownership_type = i.OwnershipType,
                status_code = i.StatusCode,
                lot_number = i.Lot?.LotNumber,
                has_qr_printed = printedItemIds.Contains(i.ItemId)
            }).ToList();

            return Ok(new
            {
                summary,
                items = itemsList
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [HttpGet("inventory/kfh-available")]
    [Authorize(Policy = "purchase_orders.read")]
    public async Task<IActionResult> GetKfhAvailableInventory()
    {
        try
        {
            var items = (await _repository.GetKfhAvailableInventoryAsync()).ToList();
            var itemIds = items.Select(i => i.ItemId).ToList();
            var printedItemIds = await _repository.GetPrintedLabelItemIdsAsync(itemIds);

            var summary = new
            {
                total_bars = items.Count,
                total_weight_grams = items.Sum(i => i.Product?.Denomination?.WeightGrams ?? 0),
                total_weight_kg = Math.Round(items.Sum(i => i.Product?.Denomination?.WeightGrams ?? 0) / 1000m, 4),
                by_product = items.GroupBy(i => i.Product?.ProductCode ?? "UNKNOWN")
                    .Select(g => new
                    {
                        product_code = g.Key,
                        metal_name = g.First().Product?.MetalType?.MetalName ?? "Gold",
                        denomination = g.First().Product?.Denomination?.Label ?? "1kg Bar",
                        weight_grams = g.First().Product?.Denomination?.WeightGrams ?? 0,
                        count = g.Count(),
                        total_grams = g.Sum(x => x.Product?.Denomination?.WeightGrams ?? 0)
                    }).ToList()
            };

            var itemsList = items.Select(i => new
            {
                item_id = i.ItemId,
                serial_number = i.SerialNumber,
                product_id = i.ProductId,
                product_code = i.Product?.ProductCode,
                metal_name = i.Product?.MetalType?.MetalName,
                denomination = i.Product?.Denomination?.Label,
                weight_grams = i.Product?.Denomination?.WeightGrams ?? 0,
                purity = i.Product?.Purity?.PurityValue,
                brand_name = i.Product?.Brand?.BrandName,
                location_id = i.LocationId,
                vault_name = i.Location?.Vault?.VaultName ?? "Main Vault",
                location_code = i.Location != null ? $"{i.Location.ZoneRoom} / {i.Location.ShelfRow} / {i.Location.SlotBin}" : "Unassigned",
                ownership_type = i.OwnershipType,
                status_code = i.StatusCode,
                has_qr_printed = printedItemIds.Contains(i.ItemId)
            }).ToList();

            return Ok(new
            {
                summary,
                items = itemsList
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [HttpGet("inventory/vip/pending-allocations")]
    [Authorize(Policy = "pending_actions.read")]
    public async Task<IActionResult> GetPendingVipAllocations()
    {
        try
        {
            var list = await _repository.GetPendingVipAllocationsAsync();
            return Ok(list);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [HttpGet("inventory/vip/pending-dispenses")]
    [Authorize(Policy = "pending_actions.read")]
    public async Task<IActionResult> GetPendingVipDispenses()
    {
        try
        {
            var list = await _repository.GetPendingVipDispensesAsync();
            return Ok(list);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [HttpPost("inventory/vip/allocate")]
    [Authorize(Policy = "custody.write")]
    public async Task<IActionResult> InitiateVipAllocation([FromBody] VipAllocationRequest req)
    {
        try
        {
            if (req.SerialNumbers == null || req.SerialNumbers.Count == 0)
            {
                return BadRequest(new { error = "Please select at least one gold bar serial to allocate to VIP Exclusive Stock." });
            }

            string requestedBy = !string.IsNullOrWhiteSpace(req.RequestedBy) ? req.RequestedBy : (User.Identity?.Name ?? "Treasury Maker");

            var pending = await _repository.InitiateVipAllocationWorkflowAsync(
                req.SerialNumbers,
                requestedBy,
                req.Notes,
                req.VipCategory);

            return Ok(new
            {
                pending_allocation_id = pending.PendingAllocationId,
                batch_reference = pending.BatchReference,
                total_items = pending.TotalItems,
                total_weight_grams = pending.TotalWeightGrams,
                vip_category = pending.VipCategory,
                message = "VIP stock allocation initiated and routed to Maker-Checker workflow for Checker approval."
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [HttpPost("inventory/vip/dispense")]
    [Authorize(Policy = "custody.write")]
    public async Task<IActionResult> InitiateVipDispense([FromBody] VipDispenseRequest req)
    {
        try
        {
            if (req.SerialNumbers == null || req.SerialNumbers.Count == 0)
            {
                return BadRequest(new { error = "Please select at least one VIP gold bar serial for dispensation." });
            }
            if (string.IsNullOrWhiteSpace(req.CustomerName))
            {
                return BadRequest(new { error = "VIP customer name is required." });
            }
            if (string.IsNullOrWhiteSpace(req.CustomerCivilId))
            {
                return BadRequest(new { error = "VIP customer Civil ID is required." });
            }

            string requestedBy = !string.IsNullOrWhiteSpace(req.RequestedBy) ? req.RequestedBy : (User.Identity?.Name ?? "VIP Specialist");

            var pending = await _repository.InitiateVipDispenseWorkflowAsync(
                req.SerialNumbers,
                req.CustomerName,
                req.CustomerCivilId,
                req.CustomerAccount,
                req.SpecialInstructions,
                requestedBy,
                req.Notes);

            return Ok(new
            {
                pending_dispense_id = pending.PendingDispenseId,
                batch_reference = pending.BatchReference,
                total_items = pending.TotalItems,
                total_weight_grams = pending.TotalWeightGrams,
                customer_name = pending.CustomerName,
                customer_civil_id = pending.CustomerCivilId,
                message = "VIP gold dispensation request initiated and routed to Maker-Checker workflow for Checker authorization."
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [HttpGet("inventory/turkey/pending-returns")]
    [Authorize(Policy = "pending_actions.read")]
    public async Task<IActionResult> GetPendingTurkeyReturns()
    {
        try
        {
            var list = await _repository.GetPendingTurkeyReturnsAsync();
            return Ok(list);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [HttpPost("inventory/turkey/return")]
    [Authorize(Policy = "purchase_orders.write")]
    public async Task<IActionResult> InitiateTurkeyReturn([FromBody] TurkeyReturnRequest req)
    {
        try
        {
            if (req.SerialNumbers == null || req.SerialNumbers.Count == 0)
            {
                return BadRequest(new { error = "Please select at least one gold bar serial to return to Turkey consignment." });
            }

            string requestedBy = !string.IsNullOrWhiteSpace(req.RequestedBy) ? req.RequestedBy : (User.Identity?.Name ?? "Treasury Maker");

            var pending = await _repository.InitiateTurkeyReturnWorkflowAsync(
                req.SerialNumbers,
                requestedBy,
                req.ReturnReason,
                req.Notes);

            return Ok(new
            {
                pending_return_id = pending.PendingReturnId,
                batch_reference = pending.BatchReference,
                total_items = pending.TotalItems,
                total_weight_grams = pending.TotalWeightGrams,
                source_ownership = pending.SourceOwnership,
                return_reason = pending.ReturnReason,
                message = "Turkey consignment return request initiated and routed to Maker-Checker workflow for Checker authorization."
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    // =========================================================================
    // Missing Items Operations (Customs / Turkey Consignment Verification)
    // =========================================================================

    [HttpGet("inventory/turkey/pending-missing-reports")]
    [Authorize(Policy = "pending_actions.read")]
    public async Task<IActionResult> GetPendingMissingItemReports()
    {
        try
        {
            var list = await _repository.GetPendingMissingItemReportsAsync();
            return Ok(list.Select(r => new
            {
                pending_report_id = r.PendingReportId,
                report_reference = r.ReportReference,
                ownership_type = r.OwnershipType,
                lot_id = r.LotId,
                lot_number = r.LotNumber,
                total_items = r.TotalItems,
                total_weight_grams = r.TotalWeightGrams,
                discrepancy_reason = r.DiscrepancyReason,
                serials_json = r.SerialsJsonList,
                requested_by = r.RequestedBy,
                notes = r.Notes,
                status_code = r.StatusCode,
                created_at = r.CreatedAt,
                approved_by = r.ApprovedBy,
                approved_at = r.ApprovedAt
            }));
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [HttpGet("inventory/turkey/missing-items")]
    [Authorize(Policy = "purchase_orders.read")]
    public async Task<IActionResult> GetTurkeyMissingItems()
    {
        try
        {
            var items = (await _repository.GetTurkeyMissingItemsAsync()).ToList();
            return Ok(items.Select(i => new
            {
                item_id = i.ItemId,
                serial_number = i.SerialNumber,
                product_id = i.ProductId,
                product_code = i.Product?.ProductCode,
                metal_name = i.Product?.MetalType?.MetalName ?? "Gold",
                denomination = i.Product?.Denomination?.Label ?? "1kg Bar",
                weight_grams = i.Product?.Denomination?.WeightGrams ?? 0,
                lot_number = i.Lot?.LotNumber,
                location_code = i.Location != null ? $"{i.Location.ZoneRoom} / {i.Location.ShelfRow} / {i.Location.SlotBin}" : "Unassigned",
                status_code = i.StatusCode,
                ownership_type = i.OwnershipType
            }));
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [HttpPost("inventory/turkey/missing-items/report")]
    [Authorize(Policy = "purchase_orders.write")]
    public async Task<IActionResult> InitiateMissingItemsReport([FromBody] MissingItemsReportRequest req)
    {
        try
        {
            if (req.SerialNumbers == null || req.SerialNumbers.Count == 0)
            {
                return BadRequest(new { error = "Please select or provide at least one missing serial number to report." });
            }

            string requestedBy = !string.IsNullOrWhiteSpace(req.RequestedBy) ? req.RequestedBy : (User.Identity?.Name ?? "Treasury Maker");

            var pending = await _repository.InitiateMissingItemsWorkflowAsync(
                req.SerialNumbers,
                requestedBy,
                req.DiscrepancyReason,
                req.Notes,
                req.LotId,
                req.OwnershipType ?? "TURKEY_OWNED");

            return Ok(new
            {
                pending_report_id = pending.PendingReportId,
                report_reference = pending.ReportReference,
                total_items = pending.TotalItems,
                total_weight_grams = pending.TotalWeightGrams,
                ownership_type = pending.OwnershipType,
                message = "Missing items discrepancy report initiated and routed to Maker-Checker workflow for Checker authorization."
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }
}

public class MissingItemsReportRequest
{
    public List<string> SerialNumbers { get; set; } = new();
    public int? LotId { get; set; }
    public string? DiscrepancyReason { get; set; }
    public string? RequestedBy { get; set; }
    public string? Notes { get; set; }
    public string OwnershipType { get; set; } = "TURKEY_OWNED";
}

public class VipAllocationRequest
{
    public List<string> SerialNumbers { get; set; } = new();
    public string? VipCategory { get; set; }
    public string? RequestedBy { get; set; }
    public string? Notes { get; set; }
}

public class VipDispenseRequest
{
    public List<string> SerialNumbers { get; set; } = new();
    public string CustomerName { get; set; } = null!;
    public string CustomerCivilId { get; set; } = null!;
    public string? CustomerAccount { get; set; }
    public string? SpecialInstructions { get; set; }
    public string? RequestedBy { get; set; }
    public string? Notes { get; set; }
}

public class TurkeyReturnRequest
{
    public List<string> SerialNumbers { get; set; } = new();
    public string? ReturnReason { get; set; }
    public string? RequestedBy { get; set; }
    public string? Notes { get; set; }
}

