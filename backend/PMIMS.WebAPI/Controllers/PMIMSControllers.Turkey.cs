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
                fineness_ppt = i.FinenessPpt,
                brand_name = i.Product?.Brand?.BrandName,
                refiner_name = i.RefinerName,
                origin_country = i.Product?.OriginCountry ?? "Turkey",
                location_id = i.LocationId,
                vault_name = i.Location?.Vault?.VaultName ?? "Main Vault",
                location_code = i.Location != null ? $"{i.Location.ZoneRoom} / {i.Location.ShelfRow} / {i.Location.SlotBin}" : "Unassigned",
                ownership_type = i.OwnershipType,
                status_code = i.StatusCode,
                lot_number = i.Lot?.LotNumber
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
}
