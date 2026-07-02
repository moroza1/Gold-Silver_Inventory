using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using PMIMS.Domain;

namespace PMIMS.Application;

public class ReconciliationService : IReconciliationService
{
    private readonly IInventoryRepository _repository;

    public ReconciliationService(IInventoryRepository repository)
    {
        _repository = repository;
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
        await _repository.SaveAuditLogAsync(executedBy, "SYSTEM", "RECONCILIATION", $"Executed reconciliation run. Checked: {totalChecked}, Breaks Found: {totalDiscrepancies}");

        // If breaks are found, quarantine the items
        foreach (var breakItem in discrepancies)
        {
            // Set status to QUARANTINED
            breakItem.item.StatusCode = "QUARANTINED";
            
            // Recalculate balances
            if (breakItem.item.LocationId.HasValue)
            {
                await _repository.IntakeInventoryItemsAsync(0, "RECON-BREAK", breakItem.item.LocationId.Value, executedBy, $"[{{\"serial\":\"{breakItem.item.SerialNumber}\",\"product_id\":{breakItem.item.ProductId}}}]");
            }
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
            
            if (targetCase.ReconItem.Item.LocationId.HasValue)
            {
                // Trigger recalculation of balances
                await _repository.IntakeInventoryItemsAsync(0, "RECON-RESOLVE", targetCase.ReconItem.Item.LocationId.Value, resolvedBy, $"[{{\"serial\":\"{targetCase.ReconItem.Item.SerialNumber}\",\"product_id\":{targetCase.ReconItem.Item.ProductId}}}]");
            }
        }

        await _repository.SaveAuditLogAsync(resolvedBy, "SYSTEM", "RECONCILIATION", $"Resolved reconciliation break Case ID: {caseId}. Reason: {reasonCode}. Comments: {comments}");
        return true;
    }
}
