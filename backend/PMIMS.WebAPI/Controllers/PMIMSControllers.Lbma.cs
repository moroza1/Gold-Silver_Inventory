using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace PMIMS.WebAPI.Controllers;

// =========================================================================
// LBMA Good Delivery / Chain-of-Custody
// ------------------------------------------------------------------------
// Read-only surface over the LBMA fields captured on InventoryItem at intake
// (see IntakeItemDTO / IntakeInventoryItemsAsync) and the ChainOfCustodyEvent
// ledger. Gated by the existing `reports` and `custody` operational modules --
// this is a new report/view, not a new administrative surface, so it doesn't
// need its own permission module.
// =========================================================================
public partial class PMIMSControllers
{
    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/lbma-compliance")]
    public async Task<IActionResult> GetLbmaComplianceReport()
    {
        var gaps = await _repository.GetLbmaComplianceReportAsync();
        return Ok(gaps);
    }

    [Authorize(Policy = "custody.read")]
    [HttpGet("inventory/items/{id}/custody-chain")]
    public async Task<IActionResult> GetCustodyChain(int id)
    {
        var events = await _repository.GetChainOfCustodyEventsAsync(id);
        return Ok(events.Select(e => new
        {
            custody_event_id = e.CustodyEventId,
            event_type = e.EventType,
            location = e.Location?.Description,
            recorded_by = e.RecordedBy,
            recorded_at = e.RecordedAt,
            reference_number = e.ReferenceNumber,
            notes = e.Notes
        }));
    }
}
