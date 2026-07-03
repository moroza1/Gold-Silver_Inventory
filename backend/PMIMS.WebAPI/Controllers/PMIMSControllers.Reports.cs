using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace PMIMS.WebAPI.Controllers;

// =========================================================================
// Official Reports -- Inventory Balance, Transaction Log, Reconciliation
// Differences.
// ------------------------------------------------------------------------
// Audit findings already have a dedicated, fuller export surface
// (PMIMSControllers.Audit.cs: search/filter/paginate + CSV/XLSX/PDF). The
// other three report types named in the RFP ("official reports on inventory
// balances, transaction logs, reconciliation differences, and audit
// findings") existed only as raw JSON views with no downloadable/"official"
// output -- GET /api/reports/transactions had no export at all, and
// reconciliation differences (GET /api/reconciliation/discrepancies) weren't
// even on the Reports screen. This file brings those three up to the same
// bar, reusing the exact same generic table-export path
// (IAuditExportService.ExportTableToExcel/Pdf/Csv) that Item 7's scheduled
// email reports already use (NotificationSchedulerService.BuildReportAsync),
// so there is still exactly one table-rendering implementation in PMIMS.
// =========================================================================
public partial class PMIMSControllers
{
    // On-screen JSON view of the aggregated inventory balance (mirrors the
    // per-item /reports/valuation view, but grouped by vault/metal/denomination
    // the way NotificationSchedulerService's INVENTORY_BALANCE email report is,
    // plus a total weight column). No dedicated GET existed for this on demand.
    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/inventory-balance")]
    public async Task<IActionResult> GetInventoryBalanceReport()
    {
        var (_, rows) = await BuildInventoryBalanceTableAsync();
        return Ok(rows.Select(r => new
        {
            vault = r[0],
            metal_type = r[1],
            denomination = r[2],
            ready_qty = r[3],
            total_weight_grams = r[4]
        }));
    }

    // Single download endpoint for all three report types, same shape as
    // GET /api/reports/audit-logs/export (format=csv|xlsx|pdf).
    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/export")]
    public async Task<IActionResult> ExportOfficialReport([FromQuery] string type, [FromQuery] string format)
    {
        (IReadOnlyList<string> headers, List<IReadOnlyList<string>> rows) table;
        string title;
        string safeType = (type ?? "").ToLowerInvariant();

        switch (safeType)
        {
            case "inventory_balance":
                table = await BuildInventoryBalanceTableAsync();
                title = "PMIMS Inventory Balance Report";
                break;
            case "transactions":
                table = await BuildTransactionLogTableAsync();
                title = "PMIMS Transaction Log Report";
                break;
            case "reconciliation":
                table = await BuildReconciliationDifferencesTableAsync();
                title = "PMIMS Reconciliation Differences Report";
                break;
            default:
                return BadRequest(new { error = "type must be one of: inventory_balance, transactions, reconciliation." });
        }

        switch ((format ?? "csv").ToLowerInvariant())
        {
            case "xlsx":
                return File(_auditExport.ExportTableToExcel(title, table.headers, table.rows),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"{safeType}_report.xlsx");
            case "pdf":
                return File(_auditExport.ExportTableToPdf(title, table.headers, table.rows), "application/pdf", $"{safeType}_report.pdf");
            case "csv":
                return File(_auditExport.ExportTableToCsv(table.headers, table.rows), "text/csv", $"{safeType}_report.csv");
            default:
                return BadRequest(new { error = "format must be one of: csv, xlsx, pdf." });
        }
    }

    private async Task<(IReadOnlyList<string> headers, List<IReadOnlyList<string>> rows)> BuildInventoryBalanceTableAsync()
    {
        var headers = new[] { "Vault", "Metal Type", "Denomination", "Ready Qty", "Total Weight (g)" };
        var items = (await _repository.GetItemsAsync()).Where(i => i.StatusCode == "READY").ToList();

        var rows = items
            .GroupBy(i => new
            {
                Vault = i.Location?.Vault?.VaultName ?? "Unknown",
                Metal = i.Product?.MetalType?.MetalName ?? "Unknown",
                Denom = i.Product?.Denomination?.Label ?? "Unknown",
                WeightGrams = i.Product?.Denomination?.WeightGrams ?? 0m
            })
            .OrderBy(g => g.Key.Vault).ThenBy(g => g.Key.Metal).ThenBy(g => g.Key.Denom)
            .Select(g => (IReadOnlyList<string>)new[]
            {
                g.Key.Vault, g.Key.Metal, g.Key.Denom, g.Count().ToString(), (g.Key.WeightGrams * g.Count()).ToString("N2")
            })
            .ToList();

        return (headers, rows);
    }

    private async Task<(IReadOnlyList<string> headers, List<IReadOnlyList<string>> rows)> BuildTransactionLogTableAsync()
    {
        // Denomination (not MetalType) since GetTransactionsAsync's Include chain only loads
        // Item.Product.Denomination, not Item.Product.MetalType.
        var headers = new[] { "Transaction #", "Type", "Serial Number", "Denomination", "Source", "Destination", "Initiated By", "Approved By", "Timestamp (UTC)" };
        var txs = (await _repository.GetTransactionsAsync()).ToList();

        var rows = txs.Select(t => (IReadOnlyList<string>)new[]
        {
            t.TransactionNumber,
            t.TransactionType,
            t.Item?.SerialNumber ?? "",
            t.Item?.Product?.Denomination?.Label ?? "",
            $"{t.SourceLocation?.Vault?.VaultName ?? ""} {t.SourceLocation?.Description ?? ""}".Trim(),
            $"{t.DestinationLocation?.Vault?.VaultName ?? ""} {t.DestinationLocation?.Description ?? ""}".Trim(),
            t.InitiatedBy,
            t.ApprovedBy ?? "",
            t.TransactionTimestamp.ToString("u")
        }).ToList();

        return (headers, rows);
    }

    private async Task<(IReadOnlyList<string> headers, List<IReadOnlyList<string>> rows)> BuildReconciliationDifferencesTableAsync()
    {
        var headers = new[] { "Case ID", "Serial Number", "Denomination", "Expected Location", "Mismatch", "Status", "Reason Code", "Resolved By", "Resolved At" };
        var cases = await _repository.GetMismatchCasesAsync();

        var rows = cases.Select(c => (IReadOnlyList<string>)new[]
        {
            c.CaseId.ToString(),
            c.ReconItem?.Item?.SerialNumber ?? "Unknown",
            c.ReconItem?.Item?.Product?.Denomination?.Label ?? "Unknown",
            c.ReconItem?.Item?.Location?.Description ?? "Unknown",
            c.InvestigatorComments ?? $"Status: {c.StatusCode}",
            c.StatusCode,
            c.ReasonCode ?? "",
            c.ResolvedBy ?? "",
            c.ResolvedAt.HasValue ? c.ResolvedAt.Value.ToString("u") : ""
        }).ToList();

        return (headers, rows);
    }
}
