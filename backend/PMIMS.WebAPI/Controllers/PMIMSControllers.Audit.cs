using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PMIMS.Application;

namespace PMIMS.WebAPI.Controllers;

// =========================================================================
// Enhanced Audit Trail UI (RFP item 6)
// Reuses the existing `reports` module/policy -- this is a read-side
// enhancement of the audit log data every module already writes via
// SaveAuditLogAsync (Section 10 "REPORTING & EXPORTS" in PMIMSControllers.cs
// already gates GET /api/reports/audit-logs the same way).
// =========================================================================
public partial class PMIMSControllers
{
    [AllowAnonymous]
    [HttpGet("reports/audit-logs/search")]
    public async Task<IActionResult> SearchAuditLogs(
        [FromQuery] string? query, [FromQuery] string? user, [FromQuery] string? module,
        [FromQuery] string? entityType, [FromQuery] string? status,
        [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        var filter = new AuditLogFilter
        {
            Query = query,
            Username = user,
            ModuleName = module,
            EntityType = entityType,
            StatusFilter = status,
            From = from,
            To = to,
            Page = page,
            PageSize = pageSize
        };
        var result = await _repository.SearchAuditLogsAsync(filter);
        return Ok(new
        {
            items = result.Items,
            total_count = result.TotalCount,
            page = result.Page,
            page_size = result.PageSize
        });
    }

    [AllowAnonymous]
    [HttpGet("reports/audit-logs/{id:int}")]
    public async Task<IActionResult> GetAuditLogDetail(int id)
    {
        var log = await _repository.GetAuditLogByIdAsync(id);
        if (log == null) return NotFound(new { error = "Audit log entry not found." });
        return Ok(log);
    }

    [AllowAnonymous]
    [HttpGet("reports/audit-logs/export")]
    public async Task<IActionResult> ExportAuditLogs(
        [FromQuery] string format, [FromQuery] string? query, [FromQuery] string? user,
        [FromQuery] string? module, [FromQuery] string? entityType, [FromQuery] string? status,
        [FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        var filter = new AuditLogFilter
        {
            Query = query,
            Username = user,
            ModuleName = module,
            EntityType = entityType,
            StatusFilter = status,
            From = from,
            To = to,
            Page = 1,
            PageSize = _config.GetValue<int?>("Audit:ExportMaxRows") ?? 5000
        };
        var result = await _repository.SearchAuditLogsAsync(filter);

        switch ((format ?? "csv").ToLowerInvariant())
        {
            case "xlsx":
                return File(_auditExport.ExportToExcel(result.Items), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "audit_logs.xlsx");
            case "pdf":
                return File(_auditExport.ExportToPdf(result.Items, "PMIMS Audit Log Export"), "application/pdf", "audit_logs.pdf");
            case "csv":
                return File(_auditExport.ExportToCsv(result.Items), "text/csv", "audit_logs.csv");
            default:
                return BadRequest(new { error = "format must be one of: csv, xlsx, pdf." });
        }
    }

    [AllowAnonymous]
    [HttpPost("audit/client-error")]
    public async Task<IActionResult> LogClientError([FromBody] ClientErrorLogDto req)
    {
        var username = req.Username ?? User.Identity?.Name ?? "ANONYMOUS";
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "0.0.0.0";
        var desc = $"[CLIENT_ERROR] Incident: {req.IncidentId ?? "N/A"} | Screen: {req.Screen ?? "Unknown"} | Function: {req.FunctionName ?? "Unknown"} | Role: {req.UserRole ?? "N/A"} | Error: {req.ErrorMessage} | Status: {req.HttpStatus?.ToString() ?? "N/A"} | Details: {req.Details ?? "None"}";
        await _repository.SaveAuditLogAsync(
            username: username,
            ipAddress: ip,
            moduleName: req.Module ?? "CLIENT_EXCEPTION",
            actionDescription: desc,
            entityType: "CLIENT_INCIDENT",
            entityId: req.IncidentId ?? req.FunctionName ?? "N/A"
        );
        return Ok(new { success = true, incident_id = req.IncidentId });
    }
}

public class ClientErrorLogDto
{
    public string? IncidentId { get; set; }
    public string? Screen { get; set; }
    public string? FunctionName { get; set; }
    public string? Module { get; set; }
    public string? ErrorMessage { get; set; }
    public string? Details { get; set; }
    public string? Username { get; set; }
    public string? UserRole { get; set; }
    public int? HttpStatus { get; set; }
    public string? Timestamp { get; set; }
}
