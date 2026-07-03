using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using PMIMS.Domain;

namespace PMIMS.Application;

public class ReconciliationService : IReconciliationService
{
    private readonly IInventoryRepository _repository;
    // KFH Existing Monitoring Tool Integration (RFP item 8) -- pushes an ALERT event when a
    // reconciliation run finds breaks, so the external monitoring tool sees it without polling.
    // Optional/nullable so this service still works if no adapter is registered (e.g. in unit
    // tests that construct it directly without a full DI container).
    private readonly IMonitoringAdapter? _monitoringAdapter;
    // Automatic Management Email Notifications (RFP item 7 extension) -- fires an
    // INVENTORY_DISCREPANCY email to any active subscription of that report type the moment
    // this run finds a break, same optional/nullable pattern as _monitoringAdapter above.
    private readonly INotificationDispatchService? _notificationDispatch;

    public ReconciliationService(IInventoryRepository repository, IMonitoringAdapter? monitoringAdapter = null, INotificationDispatchService? notificationDispatch = null)
    {
        _repository = repository;
        _monitoringAdapter = monitoringAdapter;
        _notificationDispatch = notificationDispatch;
    }

    public async Task<ReconciliationRun> RunReconciliationAsync(string executedBy)
    {
        // 1. Fetch active database items
        var items = (await _repository.GetItemsAsync()).ToList();

        // 2. Query expected balances from Core Banking / IMAL (Simulated core database lookup)
        // We simulate that Core Banking expects items matching our DB, but with a discrepancy for verification
        var discrepancies = new List<(InventoryItem item, int pmimsVal, int coreVal)>();

        int totalChecked = items.Count;
        int totalDiscrepancies = 0;

        // Insert Reconciliation Run record
        var run = new ReconciliationRun
        {
            ExecutedBy = executedBy,
            RunTimestamp = DateTime.UtcNow,
            TotalItemsChecked = totalChecked,
            TotalDiscrepancies = 0,
            StatusCode = "COMPLETED"
        };

        // For simulation, if there are items, we create exactly 1 discrepancy if a serial number contains "TR-10293-02"
        // simulating a physical scan discrepancy or core mismatch.
        foreach (var item in items)
        {
            if (item.SerialNumber == "TR-10293-02")
            {
                discrepancies.Add((item, 1, 0)); // Present in PMIMS, missing in Core IMAL GL
                totalDiscrepancies++;
            }
        }

        run.TotalDiscrepancies = totalDiscrepancies;

        // Save run details in audit/logs or mock structures.
        // NOTE: `run` itself is not persisted to reconciliation_runs by this method (pre-existing
        // behavior, unrelated to items 5-8) -- the audit log entry is the durable record of this
        // execution. entityId is intentionally omitted since run.RunId is never assigned.
        await _repository.SaveAuditLogAsync(executedBy, "SYSTEM", "RECONCILIATION", $"Executed reconciliation run. Checked: {totalChecked}, Breaks Found: {totalDiscrepancies}", entityType: "RECONCILIATION_RUN");

        if (totalDiscrepancies > 0 && _monitoringAdapter != null)
        {
            await _monitoringAdapter.PushAsync("ALERT", "reconciliation_breaks_detected", totalDiscrepancies.ToString(), "CRITICAL");
        }

        if (totalDiscrepancies > 0 && _notificationDispatch != null)
        {
            string serialList = string.Join(", ", discrepancies.Select(d => d.item.SerialNumber));
            string body = $"<p>A PMIMS reconciliation run executed by <b>{executedBy}</b> at {run.RunTimestamp:u} found " +
                $"<b>{totalDiscrepancies}</b> discrepanc{(totalDiscrepancies == 1 ? "y" : "ies")} against Core Banking GL " +
                $"out of {totalChecked} items checked.</p>" +
                $"<p>Affected serial number(s): {serialList}</p>" +
                "<p>Affected items have been quarantined pending investigation. See Reconciliation &gt; Discrepancies in PMIMS for details.</p>";
            await _notificationDispatch.DispatchAsync("INVENTORY_DISCREPANCY", $"KFH PMIMS -- Inventory Discrepancy Detected ({totalDiscrepancies})", body);
        }

        // If breaks are found, quarantine the items and record a proper ADJUSTMENT
        // ledger transaction (this used to re-call IntakeInventoryItemsAsync purely for
        // its balance-recalc side effect, which would throw a duplicate-SerialNumber
        // constraint violation since that method unconditionally re-Adds an
        // InventoryItem row -- untested until now, see RecordInventoryAdjustmentAsync).
        foreach (var breakItem in discrepancies)
        {
            breakItem.item.StatusCode = "QUARANTINED";
            await _repository.RecordInventoryAdjustmentAsync(breakItem.item.ItemId, "STOCK_DISCREPANCY", executedBy,
                $"Flagged during reconciliation run: present in PMIMS ({breakItem.pmimsVal}), missing/mismatched in Core Banking GL ({breakItem.coreVal}).");
        }

        return run;
    }

    public async Task<bool> ResolveMismatchAsync(int caseId, string comments, string reasonCode, string resolvedBy)
    {
        // Maker Checker adjustment resolution
        var cases = await _repository.GetMismatchCasesAsync();
        var targetCase = cases.FirstOrDefault(c => c.CaseId == caseId);

        if (targetCase == null) return false;

        targetCase.StatusCode = "RESOLVED";
        targetCase.InvestigatorComments = comments;
        targetCase.ResolvedBy = resolvedBy;
        targetCase.ResolvedAt = DateTime.UtcNow;

        if (targetCase.ReconItem?.Item != null)
        {
            // Revert item status from QUARANTINED back to READY
            targetCase.ReconItem.Item.StatusCode = "READY";

            await _repository.RecordInventoryAdjustmentAsync(targetCase.ReconItem.Item.ItemId, reasonCode, resolvedBy,
                $"Reconciliation break Case ID {caseId} resolved. Comments: {comments}");
        }

        await _repository.SaveAuditLogAsync(resolvedBy, "SYSTEM", "RECONCILIATION", $"Resolved reconciliation break Case ID: {caseId}. Reason: {reasonCode}. Comments: {comments}");
        return true;
    }
}
