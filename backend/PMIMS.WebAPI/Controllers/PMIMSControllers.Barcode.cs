using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PMIMS.Application;

namespace PMIMS.WebAPI.Controllers;

// =========================================================================
// Barcode/QR Code Tracking (RFP Section 3) -- generates a GS1-128 barcode and an
// ISO/IEC 18004 QR code per serialized bar (or a whole lot at once for a print
// run), backed by IBarcodeLabelService (PMIMS.Application/BarcodeLabelService.cs).
//
// GET endpoints are pure reads (labels are computed on demand from existing item
// data, never stored) gated by `barcode_qr_labeling.read`. The one write action is
// an explicit "log that this label was printed" call, recorded as a
// ChainOfCustodyEvent alongside every other movement/event for that item --
// gated by `barcode_qr_labeling.write`, same tier as intake/dispensing.
// =========================================================================
public partial class PMIMSControllers
{
    [Authorize(Policy = "barcode_qr_labeling.read")]
    [HttpGet("barcode/items/by-serial/{serialNumber}/label")]
    public async Task<IActionResult> GetItemLabelBySerial(string serialNumber)
    {
        var label = await _barcodeLabelService.GenerateItemLabelAsync(serialNumber);
        if (label == null) return NotFound(new { error = $"No inventory item found with serial number '{serialNumber}'." });
        return Ok(label);
    }

    [Authorize(Policy = "barcode_qr_labeling.read")]
    [HttpGet("barcode/items/{itemId:int}/label")]
    public async Task<IActionResult> GetItemLabelById(int itemId)
    {
        var label = await _barcodeLabelService.GenerateItemLabelByIdAsync(itemId);
        if (label == null) return NotFound(new { error = "Inventory item not found." });
        return Ok(label);
    }

    [Authorize(Policy = "barcode_qr_labeling.read")]
    [HttpGet("barcode/lots/{lotNumber}/labels")]
    public async Task<IActionResult> GetLotLabelSheet(string lotNumber)
    {
        var sheet = await _barcodeLabelService.GenerateLotLabelSheetAsync(lotNumber);
        if (sheet == null) return NotFound(new { error = $"No inventory lot found with lot number '{lotNumber}'." });
        return Ok(sheet);
    }

    [Authorize(Policy = "barcode_qr_labeling.write")]
    [HttpPost("barcode/items/{itemId:int}/print-log")]
    public async Task<IActionResult> LogLabelPrint(int itemId, [FromBody] LogLabelPrintRequest? req)
    {
        var printedBy = req?.PrintedBy ?? User.Identity?.Name ?? "unknown";
        try
        {
            var evt = await _repository.RecordChainOfCustodyEventAsync(itemId, "LABEL_PRINTED", printedBy, notes: "GS1-128/QR label printed.");
            return Ok(new { custody_event_id = evt.CustodyEventId, recorded_at = evt.RecordedAt });
        }
        catch (System.Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }
}

public class LogLabelPrintRequest
{
    public string? PrintedBy { get; set; }
}
