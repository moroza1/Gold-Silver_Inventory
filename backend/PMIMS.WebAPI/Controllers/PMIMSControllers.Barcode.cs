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

        string requiredPrivilege = await _repository.GetQrCodeReprintPrivilegeAsync();
        bool isAdmin = User.IsInRole("IT/Admin") || User.IsInRole("IT Administrators");
        bool isChecker = User.IsInRole("Treasury Operations (Checker)") || User.IsInRole("Checker");

        if (requiredPrivilege == "DISABLED")
        {
            return StatusCode(403, new { error = "QR Code label reprinting is currently disabled in system configuration." });
        }
        else if (requiredPrivilege == "ADMIN_ONLY" && !isAdmin)
        {
            return StatusCode(403, new { error = "Unauthorized: QR Code label reprinting is restricted to Administrators in system settings." });
        }
        else if (requiredPrivilege == "CHECKER_AND_ADMIN" && !isAdmin && !isChecker)
        {
            return StatusCode(403, new { error = "Unauthorized: QR Code label reprinting requires Checker or Administrator privilege in system settings." });
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

    // =========================================================================
    // Enhanced QR Printing & Reprinting Workflow (Requirement 3)
    // =========================================================================

    [Authorize(Policy = "barcode_qr_labeling.read")]
    [HttpGet("barcode/unprinted")]
    public async Task<IActionResult> GetUnprintedBars()
    {
        try
        {
            var bars = await _repository.GetUnprintedMainVaultBarsAsync();
            return Ok(bars.Select(i => new
            {
                item_id = i.ItemId,
                serial_number = i.SerialNumber,
                metal_name = i.Product?.MetalType?.MetalName ?? "Gold",
                denomination = i.Product?.Denomination?.Label ?? "1kg Bar",
                weight_grams = i.Product?.Denomination?.WeightGrams ?? 0,
                location_code = i.Location != null ? $"{i.Location.ZoneRoom} / {i.Location.ShelfRow} / {i.Location.SlotBin}" : "Main Vault",
                vault_name = i.Location?.Vault?.VaultName ?? "Main Vault",
                lot_number = i.Lot?.LotNumber,
                ownership_type = i.OwnershipType,
                status_code = i.StatusCode
            }));
        }
        catch (System.Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "barcode_qr_labeling.write")]
    [HttpPost("barcode/print-single")]
    public async Task<IActionResult> PrintSingleBarQr([FromBody] SingleQrPrintRequest req)
    {
        var printedBy = User.Identity?.Name ?? "system-user";
        try
        {
            var label = await _barcodeLabelService.GenerateItemLabelByIdAsync(req.ItemId);
            if (label == null) return NotFound(new { error = "Inventory item not found." });

            var log = await _repository.RecordQrPrintAsync(req.ItemId, "INITIAL_SINGLE", printedBy, req.Reason, labelPayload: label.QrCodeContent);
            return Ok(new
            {
                label,
                log_id = log.PrintLogId,
                printed_at = log.PrintedAt,
                message = $"Initial QR label printed for bar #{req.ItemId}."
            });
        }
        catch (System.Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "barcode_qr_labeling.write")]
    [HttpPost("barcode/print-batch")]
    public async Task<IActionResult> PrintBatchBarsQr([FromBody] BatchQrPrintRequest req)
    {
        var printedBy = User.Identity?.Name ?? "system-user";
        try
        {
            if (req.ItemIds == null || req.ItemIds.Count == 0)
            {
                return BadRequest(new { error = "No bars selected for batch printing." });
            }

            var logs = await _repository.RecordBatchQrPrintAsync(req.ItemIds, "INITIAL_BATCH", printedBy, req.Reason);
            var labels = new List<BarcodeLabelDto>();
            foreach (var id in req.ItemIds)
            {
                var l = await _barcodeLabelService.GenerateItemLabelByIdAsync(id);
                if (l != null) labels.Add(l);
            }
            return Ok(new
            {
                total_printed = req.ItemIds.Count,
                labels,
                message = $"Batch QR labels successfully generated for {req.ItemIds.Count} bars."
            });
        }
        catch (System.Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "barcode_qr_labeling.write")]
    [HttpPost("barcode/reprint/initiate")]
    public async Task<IActionResult> InitiateQrReprint([FromBody] InitiateQrReprintRequest req)
    {
        var initiator = User.Identity?.Name ?? "system-maker";
        try
        {
            var pending = await _repository.InitiateQrReprintAsync(req.RequestType ?? "SINGLE", req.ItemIds, req.Reason, req.AttachmentUrl, initiator);
            return Ok(new
            {
                request_id = pending.ReprintRequestId,
                status = pending.Status,
                item_count = pending.ItemCount,
                message = "QR reprint request submitted for Checker approval."
            });
        }
        catch (System.Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "barcode_qr_labeling.read")]
    [HttpGet("barcode/reprint/pending")]
    public async Task<IActionResult> GetPendingQrReprints()
    {
        try
        {
            var list = await _repository.GetPendingQrReprintsAsync();
            return Ok(list);
        }
        catch (System.Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "pending_actions.write")]
    [HttpPost("barcode/reprint/{id:int}/approve")]
    public async Task<IActionResult> ApproveQrReprint(int id)
    {
        var checker = User.Identity?.Name ?? "system-checker";
        try
        {
            var result = await _repository.ApproveQrReprintAsync(id, checker);
            return Ok(new { status = result, message = "QR reprint request approved and logged." });
        }
        catch (System.Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "pending_actions.write")]
    [HttpPost("barcode/reprint/{id:int}/reject")]
    public async Task<IActionResult> RejectQrReprint(int id, [FromBody] RejectReprintRequest req)
    {
        var checker = User.Identity?.Name ?? "system-checker";
        try
        {
            var result = await _repository.RejectQrReprintAsync(id, req?.Reason ?? "Rejected by Checker", checker);
            return Ok(new { status = result, message = "QR reprint request rejected." });
        }
        catch (System.Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "barcode_qr_labeling.read")]
    [HttpGet("barcode/history")]
    public async Task<IActionResult> GetQrHistory([FromQuery] int? itemId)
    {
        try
        {
            var logs = await _repository.GetQrPrintLogsAsync(itemId);
            return Ok(logs.Select(l => new
            {
                log_id = l.PrintLogId,
                item_id = l.ItemId,
                serial_number = l.SerialNumber,
                print_type = l.PrintType,
                reason = l.PrintReason,
                reprint_request_id = l.ReprintRequestId,
                printed_by = l.PrintedBy,
                printed_at = l.PrintedAt
            }));
        }
        catch (System.Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }
}

public class SingleQrPrintRequest
{
    public int ItemId { get; set; }
    public string? Reason { get; set; }
}

public class BatchQrPrintRequest
{
    public List<int> ItemIds { get; set; } = new();
    public string? Reason { get; set; }
}

public class InitiateQrReprintRequest
{
    public string RequestType { get; set; } = "SINGLE"; // SINGLE, BATCH
    public List<int> ItemIds { get; set; } = new();
    public string Reason { get; set; } = null!;
    public string? AttachmentUrl { get; set; }
}

public class RejectReprintRequest
{
    public string Reason { get; set; } = null!;
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

