using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PMIMS.Domain;

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

    // =========================================================================
    // Reporting Requirements Gap Analysis -- KPIs (Item 4), Exceptions (Item 5),
    // Cost Analysis & Variance (Item 8), Movement report (Item 9). Each reuses
    // existing repository reads (no new write paths) and is wired into the same
    // reports/export download endpoint below. See
    // docs/PMIMS_Reporting_Requirements_Gap_Analysis.docx for the design.
    // =========================================================================

    // On-screen JSON view, same metric/value flat shape as the export table
    // (BuildKpiTableAsync) -- consistent with every other report GET in this
    // file (e.g. GetInventoryBalanceReport), and keeps the Reports screen's
    // generic two-column array-table renderer usable here without a bespoke
    // nested-object UI. See docs/PMIMS_Reporting_Requirements_Gap_Analysis.docx
    // Item 4 for the metric definitions.
    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/kpis")]
    public async Task<IActionResult> GetKpiReport([FromQuery] string? startDate, [FromQuery] string? endDate)
    {
        var from = ParseDateOrNull(startDate);
        var toExclusive = ParseDateOrNull(endDate)?.Date.AddDays(1);
        var (_, rows) = await BuildKpiTableAsync(from, toExclusive);
        return Ok(rows.Select(r => new { kpi = r[0], value = r[1] }));
    }

    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/exceptions")]
    public async Task<IActionResult> GetExceptionsReport([FromQuery] string? type)
    {
        var (_, rows) = await BuildExceptionsTableAsync();
        IEnumerable<object> mapped = rows.Select(r => new
        {
            exception_type = r[0],
            reference = r[1],
            description = r[2],
            severity = r[3],
            raised_at = r[4],
            status = r[5]
        });
        if (!string.IsNullOrWhiteSpace(type))
        {
            mapped = rows.Where(r => string.Equals(r[0], type, StringComparison.OrdinalIgnoreCase))
                .Select(r => new { exception_type = r[0], reference = r[1], description = r[2], severity = r[3], raised_at = r[4], status = r[5] });
        }
        return Ok(mapped);
    }

    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/cost-analysis")]
    public async Task<IActionResult> GetCostAnalysisReport([FromQuery] string groupBy = "metal_type")
    {
        var (_, rows) = await BuildCostAnalysisTableAsync(groupBy);
        return Ok(rows.Select(r => new
        {
            group = r[0],
            item_count = r[1],
            total_weight_grams = r[2],
            total_landed_cost = r[3],
            avg_unit_cost_per_gram = r[4]
        }));
    }

    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/cost-variance")]
    public async Task<IActionResult> GetCostVarianceReport([FromQuery] string? period)
    {
        var (_, rows) = await BuildCostVarianceTableAsync(period);
        return Ok(rows.Select(r => new
        {
            metal_type = r[0],
            period = r[1],
            budgeted_cost_per_gram = r[2],
            actual_avg_cost_per_gram = r[3],
            variance_per_gram = r[4],
            variance_pct = r[5]
        }));
    }

    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/movements")]
    public async Task<IActionResult> GetMovementReport([FromQuery] string bucket = "day", [FromQuery] string? startDate = null, [FromQuery] string? endDate = null)
    {
        var from = ParseDateOrNull(startDate);
        var toExclusive = ParseDateOrNull(endDate)?.Date.AddDays(1);
        var (_, rows) = await BuildMovementReportTableAsync(bucket, from, toExclusive);
        return Ok(rows.Select(r => new
        {
            period = r[0],
            location = r[1],
            ownership = r[2],
            inbound_count = r[3],
            outbound_count = r[4],
            net_weight_grams = r[5]
        }));
    }

    // Single download endpoint for all report types, same shape as
    // GET /api/reports/audit-logs/export (format=csv|xlsx|pdf).
    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/export")]
    public async Task<IActionResult> ExportOfficialReport([FromQuery] string type, [FromQuery] string format,
        [FromQuery] string? startDate = null, [FromQuery] string? endDate = null,
        [FromQuery] string? groupBy = null, [FromQuery] string? period = null, [FromQuery] string? bucket = null)
    {
        (IReadOnlyList<string> headers, List<IReadOnlyList<string>> rows) table;
        string title;
        string safeType = (type ?? "").ToLowerInvariant();
        var from = ParseDateOrNull(startDate);
        var toExclusive = ParseDateOrNull(endDate)?.Date.AddDays(1);

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
            case "kpis":
                table = await BuildKpiTableAsync(from, toExclusive);
                title = "PMIMS KPI Report";
                break;
            case "exceptions":
                table = await BuildExceptionsTableAsync();
                title = "PMIMS Exceptions Report";
                break;
            case "cost_analysis":
                table = await BuildCostAnalysisTableAsync(groupBy ?? "metal_type");
                title = "PMIMS Cost Analysis Report";
                break;
            case "cost_variance":
                table = await BuildCostVarianceTableAsync(period);
                title = "PMIMS Cost Variance Report";
                break;
            case "movements":
                table = await BuildMovementReportTableAsync(bucket ?? "day", from, toExclusive);
                title = "PMIMS Movement Report";
                break;
            default:
                return BadRequest(new { error = "type must be one of: inventory_balance, transactions, reconciliation, kpis, exceptions, cost_analysis, cost_variance, movements." });
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

    // =========================================================================
    // Reporting Requirements Gap Analysis -- private helpers backing the
    // KPI/Exceptions/Cost Analysis & Variance/Movement endpoints above.
    // =========================================================================

    // Shared raw-data fetch for the KPI JSON view and its export table, so the
    // underlying repository reads (and the date-range filtering) happen exactly once.
    private async Task<(List<InventoryTransaction> Transactions, List<ApprovalAction> Approvals, List<BusinessRuleEvaluation> Evaluations, List<MismatchCase> MismatchCases)>
        GetKpiRawDataAsync(System.DateTime? from, System.DateTime? toExclusive)
    {
        var transactions = (await _repository.GetTransactionsAsync()).AsEnumerable();
        if (from.HasValue) transactions = transactions.Where(t => t.TransactionTimestamp >= from.Value);
        if (toExclusive.HasValue) transactions = transactions.Where(t => t.TransactionTimestamp < toExclusive.Value);

        var approvals = await _repository.GetAllApprovalActionsAsync(from, toExclusive);
        var evaluations = await _repository.GetBusinessRuleEvaluationsAsync(from, toExclusive);
        // Not date-scoped -- see the comment on GetKpiReport's error_rates block.
        var mismatchCases = await _repository.GetMismatchCasesAsync();

        return (transactions.ToList(), approvals.ToList(), evaluations.ToList(), mismatchCases.ToList());
    }

    private async Task<(IReadOnlyList<string> headers, List<IReadOnlyList<string>> rows)> BuildKpiTableAsync(System.DateTime? from, System.DateTime? toExclusive)
    {
        var headers = new[] { "KPI", "Value" };
        var (transactions, approvals, evaluations, mismatchCases) = await GetKpiRawDataAsync(from, toExclusive);

        var cycleHours = approvals.Where(a => a.Instance != null)
            .Select(a => (a.ActionTimestamp - a.Instance!.CreatedAt).TotalHours)
            .Where(h => h >= 0).ToList();
        double ruleBlockRate = evaluations.Count > 0 ? System.Math.Round(100.0 * evaluations.Count(e => e.Result == "FAIL") / evaluations.Count, 2) : 0;

        var rows = new List<IReadOnlyList<string>>
        {
            new[] { "Total Transactions", transactions.Count.ToString() },
            new[] { "Total Approval Actions", approvals.Count.ToString() },
            new[] { "Approved Count", approvals.Count(a => a.ActionTaken == "APPROVED").ToString() },
            new[] { "Rejected Count", approvals.Count(a => a.ActionTaken == "REJECTED").ToString() },
            new[] { "Avg Time to Decision (hrs)", cycleHours.Count > 0 ? System.Math.Round(cycleHours.Average(), 2).ToString("N2") : "N/A" },
            new[] { "Rule Evaluations Total", evaluations.Count.ToString() },
            new[] { "Rule FAIL Count", evaluations.Count(e => e.Result == "FAIL").ToString() },
            new[] { "Rule WARN Count", evaluations.Count(e => e.Result == "WARN").ToString() },
            new[] { "Rule Block Rate (%)", ruleBlockRate.ToString("N2") },
            new[] { "Open Reconciliation Breaks", mismatchCases.Count(c => c.StatusCode != "RESOLVED").ToString() },
            new[] { "Total Reconciliation Breaks Recorded", mismatchCases.Count.ToString() }
        };
        foreach (var g in transactions.GroupBy(t => t.TransactionType).OrderByDescending(g => g.Count()))
        {
            rows.Add(new[] { $"Transactions -- {g.Key}", g.Count().ToString() });
        }

        return (headers, rows);
    }

    // Unions four existing "something needs attention" data sources into one feed --
    // reads only, no new source of truth (mirrors the Enhanced Audit Trail UI's "every
    // module already writes here" principle). See
    // docs/PMIMS_Reporting_Requirements_Gap_Analysis.docx Item 5.
    private async Task<(IReadOnlyList<string> headers, List<IReadOnlyList<string>> rows)> BuildExceptionsTableAsync()
    {
        var headers = new[] { "Exception Type", "Reference", "Description", "Severity", "Raised At", "Status" };
        var rows = new List<IReadOnlyList<string>>();

        var openMismatchCases = (await _repository.GetMismatchCasesAsync()).Where(c => c.StatusCode != "RESOLVED");
        foreach (var c in openMismatchCases)
        {
            rows.Add(new[]
            {
                "RECONCILIATION_BREAK",
                $"Case #{c.CaseId}",
                $"{c.ReconItem?.Item?.SerialNumber ?? "Unknown"} -- {c.InvestigatorComments ?? $"Status: {c.StatusCode}"}",
                "HIGH",
                "", // MismatchCase carries no raised-at timestamp of its own -- see design doc note
                c.StatusCode
            });
        }

        var ruleHits = (await _repository.GetBusinessRuleEvaluationsAsync()).Where(e => e.Result == "FAIL" || e.Result == "WARN");
        foreach (var e in ruleHits)
        {
            rows.Add(new[]
            {
                "RULE_" + e.Result,
                $"Eval #{e.EvaluationId}",
                $"{e.Rule?.RuleName ?? ("Rule #" + e.RuleId)} on {e.EntityType} #{e.EntityId}",
                e.Result == "FAIL" ? "BLOCK" : "WARN",
                e.EvaluatedAt.ToString("u"),
                e.Result
            });
        }

        foreach (dynamic a in await _repository.CheckLowStockAlertsAsync())
        {
            rows.Add(new[]
            {
                "LOW_STOCK",
                $"Threshold #{a.threshold_id}",
                $"{a.product_name}: {a.current_stock} on hand, minimum {a.min_stock_qty} (deficit {a.deficit})",
                "MEDIUM",
                "",
                "OPEN"
            });
        }

        // Pending Maker-Checker instances open longer than 48 hours.
        var overdueCutoff = System.DateTime.UtcNow.AddHours(-48);
        var overdueInstances = (await _repository.GetActiveWorkflowInstancesAsync()).Where(i => i.CreatedAt < overdueCutoff);
        foreach (var i in overdueInstances)
        {
            rows.Add(new[]
            {
                "OVERDUE_APPROVAL",
                $"Instance #{i.InstanceId}",
                $"{i.WorkflowType} initiated by {i.InitiatedBy}, pending since {i.CreatedAt:u} (step {i.CurrentStepOrder})",
                "MEDIUM",
                i.CreatedAt.ToString("u"),
                i.StatusCode
            });
        }

        return (headers, rows);
    }

    private async Task<(IReadOnlyList<string> headers, List<IReadOnlyList<string>> rows)> BuildCostAnalysisTableAsync(string groupBy)
    {
        var headers = new[] { "Group", "Item Count", "Total Weight (g)", "Total Landed Cost", "Avg Unit Cost/g" };
        var items = (await _repository.GetItemsAsync())
            .Where(i => i.StatusCode != "INACTIVE" && i.StatusCode != "WITHDRAWN" && i.Lot != null)
            .ToList();

        System.Func<InventoryItem, string> keySelector = (groupBy ?? "metal_type").ToLowerInvariant() switch
        {
            "lot" => (InventoryItem i) => i.Lot?.LotNumber ?? "Unknown",
            "vendor" => (InventoryItem i) => i.Lot?.Vendor?.VendorName ?? "Unknown",
            _ => (InventoryItem i) => i.Product?.MetalType?.MetalName ?? "Unknown"
        };

        var grouped = items
            .GroupBy(keySelector)
            .Select(g => new
            {
                Key = g.Key,
                Count = g.Count(),
                TotalWeight = g.Sum(i => i.Product?.Denomination?.WeightGrams ?? 0m),
                TotalCost = g.Sum(i => (i.Product?.Denomination?.WeightGrams ?? 0m) * (i.Lot?.AverageUnitCost ?? 0m))
            })
            .OrderByDescending(g => g.TotalCost)
            .ToList();

        var rows = grouped.Select(g => (IReadOnlyList<string>)new[]
        {
            g.Key,
            g.Count.ToString(),
            g.TotalWeight.ToString("N2"),
            g.TotalCost.ToString("N2"),
            (g.TotalWeight > 0 ? g.TotalCost / g.TotalWeight : 0).ToString("N4")
        }).ToList();

        return (headers, rows);
    }

    // Variance = actual average unit cost (from InventoryLot.AverageUnitCost, the same
    // figure the Item 3-delivered valuation report uses) vs. the budgeted figure an admin
    // configures via POST /api/master-data/cost-budgets. No budget row for a metal
    // type/period = no variance line for it (nothing to compare against yet).
    private async Task<(IReadOnlyList<string> headers, List<IReadOnlyList<string>> rows)> BuildCostVarianceTableAsync(string? period)
    {
        var headers = new[] { "Metal Type", "Period", "Budgeted Cost/g", "Actual Avg Cost/g", "Variance/g", "Variance %" };
        string effectivePeriod = string.IsNullOrWhiteSpace(period) ? System.DateTime.UtcNow.ToString("yyyy-MM") : period;

        var budgets = (await _repository.GetCostBudgetsAsync()).Where(b => b.Period == effectivePeriod).ToList();
        var items = (await _repository.GetItemsAsync())
            .Where(i => i.StatusCode != "INACTIVE" && i.StatusCode != "WITHDRAWN" && i.Lot != null)
            .ToList();

        var actualByMetal = items
            .GroupBy(i => i.Product?.MetalTypeId ?? 0)
            .ToDictionary(g => g.Key, g =>
            {
                decimal totalWeight = g.Sum(i => i.Product?.Denomination?.WeightGrams ?? 0m);
                decimal totalCost = g.Sum(i => (i.Product?.Denomination?.WeightGrams ?? 0m) * (i.Lot?.AverageUnitCost ?? 0m));
                return totalWeight > 0 ? totalCost / totalWeight : 0m;
            });

        var rows = new List<IReadOnlyList<string>>();
        foreach (var b in budgets)
        {
            decimal actual = actualByMetal.TryGetValue(b.MetalTypeId, out var a) ? a : 0m;
            decimal variance = actual - b.BudgetedUnitCostPerGram;
            decimal variancePct = b.BudgetedUnitCostPerGram != 0 ? System.Math.Round(variance / b.BudgetedUnitCostPerGram * 100, 2) : 0;
            rows.Add(new[]
            {
                b.MetalType?.MetalName ?? $"Metal #{b.MetalTypeId}",
                b.Period,
                b.BudgetedUnitCostPerGram.ToString("N4"),
                actual.ToString("N4"),
                variance.ToString("N4"),
                variancePct.ToString("N2")
            });
        }

        return (headers, rows);
    }

    // Every transaction contributes an outbound leg at its source (if any) and an
    // inbound leg at its destination (if any) -- same Source -> Destination shape
    // InventoryTransaction itself models -- bucketed by day/week/month and grouped by
    // location + ownership type. See docs/PMIMS_Reporting_Requirements_Gap_Analysis.docx
    // Item 9.
    private async Task<(IReadOnlyList<string> headers, List<IReadOnlyList<string>> rows)> BuildMovementReportTableAsync(string bucket, System.DateTime? from, System.DateTime? toExclusive)
    {
        var headers = new[] { "Period", "Location", "Ownership", "Inbound Count", "Outbound Count", "Net Weight (g)" };

        var transactions = (await _repository.GetTransactionsAsync()).AsEnumerable();
        if (from.HasValue) transactions = transactions.Where(t => t.TransactionTimestamp >= from.Value);
        if (toExclusive.HasValue) transactions = transactions.Where(t => t.TransactionTimestamp < toExclusive.Value);
        var txList = transactions.ToList();

        string BucketKey(System.DateTime ts) => (bucket ?? "day").ToLowerInvariant() switch
        {
            "month" => ts.ToString("yyyy-MM"),
            "week" => $"{ISOWeek.GetYear(ts)}-W{ISOWeek.GetWeekOfYear(ts):D2}",
            _ => ts.ToString("yyyy-MM-dd")
        };

        var legs = new List<(string Period, string Location, string Ownership, bool Inbound, decimal Weight)>();
        foreach (var t in txList)
        {
            decimal weight = t.Item?.Product?.Denomination?.WeightGrams ?? 0m;
            string period = BucketKey(t.TransactionTimestamp);
            if (t.SourceLocationId.HasValue)
                legs.Add((period, t.SourceLocation?.Description ?? $"Location #{t.SourceLocationId}", t.SourceOwnership, false, weight));
            if (t.DestinationLocationId.HasValue)
                legs.Add((period, t.DestinationLocation?.Description ?? $"Location #{t.DestinationLocationId}", t.DestinationOwnership, true, weight));
        }

        var rows = legs
            .GroupBy(l => new { l.Period, l.Location, l.Ownership })
            .OrderBy(g => g.Key.Period).ThenBy(g => g.Key.Location).ThenBy(g => g.Key.Ownership)
            .Select(g => (IReadOnlyList<string>)new[]
            {
                g.Key.Period,
                g.Key.Location,
                g.Key.Ownership,
                g.Count(l => l.Inbound).ToString(),
                g.Count(l => !l.Inbound).ToString(),
                (g.Where(l => l.Inbound).Sum(l => l.Weight) - g.Where(l => !l.Inbound).Sum(l => l.Weight)).ToString("N2")
            })
            .ToList();

        return (headers, rows);
    }
}
