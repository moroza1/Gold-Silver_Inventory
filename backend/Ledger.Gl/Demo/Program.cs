using Ledger.Gl.Core;
using Ledger.Gl.Integration;

namespace Ledger.Gl.Demo;

// ============================================================================
// Runnable self-test / usage demo. Build & run with:
//     dotnet run -c Release -p:DEMO=true
// It posts a realistic gold/silver event stream, prints the trial balance,
// verifies the audit hash chain, and ASSERTS every invariant so a non-zero exit
// code means the module is broken. Doubles as living documentation of the API.
// ============================================================================
public static class Program
{
    public static int Main()
    {
        int failures = 0;
        void Check(string label, bool ok)
        {
            Console.WriteLine($"  [{(ok ? "PASS" : "FAIL")}] {label}");
            if (!ok) failures++;
        }

        var configPath = Path.Combine(AppContext.BaseDirectory, "Config", "gl-accounts.gold-silver.json");
        if (!File.Exists(configPath))
            configPath = Path.Combine("..", "..", "..", "Config", "gl-accounts.gold-silver.json");

        Console.WriteLine("=== Ledger.Gl self-test ===\n");
        Console.WriteLine($"Loading config: {configPath}\n");

        var gl = GeneralLedger.FromConfigFile(configPath);
        var listener = new InventoryEventListener(gl,
            onPosted: r => { if (r.Entry is { } e)
                Console.WriteLine($"  posted seq {e.SequenceNumber,-2} {e.SourceEventType,-10} {e.Commodity,-6} {e.TotalDebits,10:0.00} Dr / {e.TotalCredits,10:0.00} Cr  hash={e.EntryHash[..12]}…"); });

        Console.WriteLine("Posting inventory events:");

        // 1) Buy 1kg gold from vendor for 20,000 KWD on credit.
        var r1 = listener.HandleAsync(new InventoryEvent {
            EventType = InventoryEventType.Purchase, Commodity = "GOLD", Amount = 20000m,
            SourceType = "PURCHASE_ORDER", SourceId = "PO-1001", InitiatedBy = "treasury-maker",
            Description = "1kg gold bar, vendor Metalor", ExternalKey = "PO-1001:PURCHASE" }).Result;

        // 2) Buy 50kg silver for 3,000 KWD on credit.
        listener.HandleAsync(new InventoryEvent {
            EventType = InventoryEventType.Purchase, Commodity = "SILVER", Amount = 3000m,
            SourceType = "PURCHASE_ORDER", SourceId = "PO-1002", InitiatedBy = "treasury-maker",
            ExternalKey = "PO-1002:PURCHASE" }).Wait();

        // 3) Sell gold to a customer for 8,500 KWD on account.
        listener.HandleAsync(new InventoryEvent {
            EventType = InventoryEventType.Sale, Commodity = "GOLD", Amount = 8500m,
            SourceType = "SALES_INVOICE", SourceId = "INV-5001", InitiatedBy = "treasury-checker",
            ExternalKey = "INV-5001:SALE" }).Wait();

        // 4) Transfer silver between vaults (GL-neutral).
        listener.HandleAsync(new InventoryEvent {
            EventType = InventoryEventType.Transfer, Commodity = "SILVER", Amount = 500m,
            SourceType = "INVENTORY_TRANSACTION", SourceId = "TR-9001", InitiatedBy = "treasury-maker",
            ExternalKey = "TR-9001:TRANSFER" }).Wait();

        // 5) Write off damaged gold worth 300 KWD.
        listener.HandleAsync(new InventoryEvent {
            EventType = InventoryEventType.WriteOff, Commodity = "GOLD", Amount = 300m,
            SourceType = "INVENTORY_TRANSACTION", SourceId = "TR-9002", InitiatedBy = "system-admin",
            ExternalKey = "TR-9002:WRITEOFF" }).Wait();

        // 6) Via the PMIMS adapter: an ADJUSTMENT transaction projected from PMIMS.
        var adapter = new PmimsInventoryAdapter();
        listener.HandleAsync(new InventoryTransactionSnapshot {
            TransactionNumber = "TR-9003", TransactionType = "ADJUSTMENT", Commodity = "SILVER",
            Amount = 120m, InitiatedBy = "treasury-maker", ApprovedBy = "treasury-checker",
            Note = "Assay revalued silver lot down" }, adapter).Wait();

        // 7) Idempotency: re-post PO-1001 -> should be skipped, not doubled.
        var dup = listener.HandleAsync(new InventoryEvent {
            EventType = InventoryEventType.Purchase, Commodity = "GOLD", Amount = 20000m,
            SourceType = "PURCHASE_ORDER", SourceId = "PO-1001", InitiatedBy = "treasury-maker",
            ExternalKey = "PO-1001:PURCHASE" }).Result;

        Console.WriteLine("\n--- Assertions ---");
        Check("first purchase posted & balanced", r1 is { Success: true, Entry.IsBalanced: true });
        Check("re-post of PO-1001 detected as duplicate", dup.WasDuplicate);

        // Trial balance must balance.
        var tb = gl.Reports.GetTrialBalanceAsync().Result;
        Check($"trial balance balances (Dr {tb.TotalDebits} == Cr {tb.TotalCredits})", tb.IsBalanced);

        // Gold inventory = 20,000 purchase - 300 write-off = 19,700 (debit-normal asset).
        var goldInv = gl.Reports.GetBalanceAsync("1200").Result;
        Check($"Inventory-Gold balance == 19,700 (was {goldInv.Balance})", goldInv.Balance == 19700m);

        // AP = 20,000 + 3,000 = 23,000 (credit-normal liability, positive).
        var ap = gl.Reports.GetBalanceAsync("2000").Result;
        Check($"Accounts Payable balance == 23,000 (was {ap.Balance})", ap.Balance == 23000m);

        // Gold revenue = 8,500.
        var rev = gl.Reports.GetBalanceAsync("4000").Result;
        Check($"Gold Sales Revenue == 8,500 (was {rev.Balance})", rev.Balance == 8500m);

        // History trace-back: everything from PO-1001 should be one entry.
        var hist = gl.Reports.GetHistoryAsync(sourceType: "PURCHASE_ORDER", sourceId: "PO-1001").Result;
        Check("origin trace-back returns exactly the PO-1001 entry", hist.Count == 1 && hist[0].SourceId == "PO-1001");

        // Audit chain intact.
        var integ = gl.Reports.VerifyIntegrityAsync().Result;
        Check($"hash chain intact ({integ.EntriesChecked} entries)", integ.Ok);

        Console.WriteLine("\n--- Trial balance ---");
        Console.WriteLine($"{"Account",-40}{"Debit",14}{"Credit",14}");
        foreach (var row in tb.Rows)
            Console.WriteLine($"{row.AccountCode + " " + row.AccountName,-40}{row.DebitBalance,14:0.00}{row.CreditBalance,14:0.00}");
        Console.WriteLine($"{"TOTAL",-40}{tb.TotalDebits,14:0.00}{tb.TotalCredits,14:0.00}");

        Console.WriteLine($"\n=== {(failures == 0 ? "ALL CHECKS PASSED" : $"{failures} CHECK(S) FAILED")} ===");
        return failures == 0 ? 0 : 1;
    }
}
