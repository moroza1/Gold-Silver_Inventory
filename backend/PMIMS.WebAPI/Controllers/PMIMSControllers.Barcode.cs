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
            var evt = await _repository.RecordChainOfCustodyEventAsync(itemId, "LABEL_PRINTED", printedBy, notes: req?.Notes ?? "GS1-128/QR label printed.");
            return Ok(new { custody_event_id = evt.CustodyEventId, recorded_at = evt.RecordedAt });
        }
        catch (System.Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "barcode_qr_labeling.write")]
    [HttpPost("barcode/items/{itemId:int}/reprint")]
    public async Task<IActionResult> ReprintItemLabel(int itemId, [FromBody] ReprintLabelRequest req)
    {
        if (string.IsNullOrWhiteSpace(req?.Reason))
        {
            return BadRequest(new { error = "Reprint reason is mandatory (e.g. 'LABEL_DAMAGED', 'PACKAGING_REPLACED', 'AUDIT_REQUEST')." });
        }

        var label = await _barcodeLabelService.GenerateItemLabelByIdAsync(itemId);
        if (label == null) return NotFound(new { error = "Inventory item not found." });

        var printedBy = req.ReprintedBy ?? User.Identity?.Name ?? "unknown";
        try
        {
            var notes = $"Reprint Reason: {req.Reason}. {req.Comments}".Trim();
            var evt = await _repository.RecordChainOfCustodyEventAsync(itemId, "LABEL_REPRINTED", printedBy, notes: notes);
            return Ok(new
            {
                label,
                custody_event_id = evt.CustodyEventId,
                recorded_at = evt.RecordedAt,
                message = "Label reprinted and logged in Chain of Custody."
            });
        }
        catch (System.Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "barcode_qr_labeling.read")]
    [HttpPost("barcode/items/generate-custom")]
    public async Task<IActionResult> GenerateCustomLabel([FromBody] CustomBarcodeLabelRequest req)
    {
        var (valid, error, label) = await _barcodeLabelService.GenerateCustomLabelAsync(req);
        if (!valid || label == null)
        {
            return BadRequest(new { error = error ?? "Invalid bar attributes." });
        }
        return Ok(label);
    }

    [Authorize(Policy = "barcode_qr_labeling.read")]
    [HttpPost("barcode/bulk-generate")]
    public async Task<IActionResult> BulkGenerateLabels([FromBody] BulkGenerateLabelsRequest req)
    {
        if (req?.SerialNumbers == null || req.SerialNumbers.Count == 0)
        {
            return BadRequest(new { error = "Please provide at least one serial number." });
        }

        var labels = await _barcodeLabelService.GenerateBulkLabelsAsync(req.SerialNumbers);
        return Ok(new
        {
            total_labels = labels.Count,
            labels
        });
    }
}

public class LogLabelPrintRequest
{
    public string? PrintedBy { get; set; }
    public string? Notes { get; set; }
}

public class ReprintLabelRequest
{
    public string Reason { get; set; } = null!; // e.g. LABEL_DAMAGED, PACKAGING_REPLACED, PHYSICAL_AUDIT
    public string? Comments { get; set; }
    public string? ReprintedBy { get; set; }
}

public class BulkGenerateLabelsRequest
{
    public List<string> SerialNumbers { get; set; } = new();
}
