using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace PMIMS.WebAPI.Controllers;

// =========================================================================
// IFRS Valuation Disclosures (IAS 2 lower-of-cost-or-NRV, IFRS 13 fair value)
// ------------------------------------------------------------------------
// Complements the existing GET /api/reports/valuation per-item view with a
// persisted, per-metal-type accounting snapshot suitable for attaching to a
// period-end GL/Finance package. Listing is `reports.read` (same as every
// other report); generating a new snapshot writes a durable disclosure row so
// it's gated `reports.write` (Reconciliation Officers / IT/Admin only, who
// hold FULL on `reports` -- see Program.cs and DbSeeder.cs).
// =========================================================================
public partial class PMIMSControllers
{
    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/ifrs-disclosures")]
    public async Task<IActionResult> GetIfrsDisclosures()
    {
        var list = await _repository.GetIfrsValuationDisclosuresAsync();
        return Ok(list.Select(d => new
        {
            disclosure_id = d.DisclosureId,
            snapshot_date = d.SnapshotDate,
            metal_name = d.MetalType?.MetalName,
            currency = d.Currency,
            total_weight_grams = d.TotalWeightGrams,
            cost_basis_total = d.CostBasisTotal,
            net_realizable_value_total = d.NetRealizableValueTotal,
            fair_value_total = d.FairValueTotal,
            fair_value_hierarchy_level = d.FairValueHierarchyLevel,
            lower_of_cost_or_nrv_total = d.LowerOfCostOrNrvTotal,
            impairment_loss_recognized = d.ImpairmentLossRecognized,
            generated_by = d.GeneratedBy,
            generated_at = d.GeneratedAt
        }));
    }

    [Authorize(Policy = "reports.write")]
    [HttpPost("reports/ifrs-disclosures/generate")]
    public async Task<IActionResult> GenerateIfrsDisclosure([FromBody] GenerateIfrsDisclosureRequest req)
    {
        var disclosure = await _repository.GenerateIfrsValuationDisclosureAsync(req.GeneratedBy);
        return Created($"/api/reports/ifrs-disclosures", new
        {
            disclosure_id = disclosure.DisclosureId,
            snapshot_date = disclosure.SnapshotDate,
            message = "IFRS valuation disclosure snapshot generated. See GET /api/reports/ifrs-disclosures for the full set (one row per metal type)."
        });
    }
}

public class GenerateIfrsDisclosureRequest
{
    public string GeneratedBy { get; set; } = null!;
}
