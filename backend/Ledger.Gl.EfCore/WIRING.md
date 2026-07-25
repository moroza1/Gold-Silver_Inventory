# Wiring the GL into PMIMS

This is the concrete "create a GL and assign it" recipe for PMIMS. It uses **one**
ledger (one set of books) — the right choice for a single-entity system like PMIMS —
with durable EF Core persistence in the same database. New commodities/accounts are
config changes, not new ledgers.

## 1. Project reference (done)

`PMIMS.WebAPI.csproj` references `Ledger.Gl.EfCore`, which transitively brings in the
dependency-free core `Ledger.Gl`. The example config is copied to the output `Config/`
folder.

## 2. Registration (done — `Program.cs`)

```csharp
using Ledger.Gl.EfCore;

var glConfigPath = Path.Combine(AppContext.BaseDirectory, "Config", "gl-accounts.gold-silver.json");
builder.Services.AddLedgerGl(glConfigPath, opt =>
{
    if (useSqlServer) opt.UseSqlServer(dbConfig.GetValue<string>("SqlServerConnection") ?? "");
    else              opt.UseSqlite(dbConfig.GetValue<string>("SqliteConnection") ?? "Data Source=pmims.db");
});
```

`AddLedgerGl` registers: the validated `GlConfiguration` (singleton), a `GlDbContext`
(its own bounded context — it does **not** touch `AppDbContext`), an EF-backed
`GeneralLedger` (scoped), and an `InventoryEventListener` (scoped). At startup,
`app.Services.EnsureLedgerGlSchema()` creates the `gl_journal_entries` /
`gl_journal_lines` tables (dev/SQLite; use EF migrations for production SQL Server).

## 3. Post at the transaction choke point (done)

This is now wired in `InventoryRepository`: the constructor takes an optional
`InventoryEventListener?` (same nullable pattern as `_coreBanking`), and the PO-receipt
block posts a GL entry right after the `CoreBankingLedgerPosting` call, guarded by
try/catch so a GL failure is audit-logged and can never break physical intake. The origin
id is the receipt's **lot number** (unique per receipt → correct idempotency across partial
receipts); commodity is derived from the received metal type; ownership drives custody
routing. `PMIMS.Infrastructure` references `Ledger.Gl` for the adapter/listener types.

The shape that was applied:

```csharp
// constructor — add an optional param (backward compatible)
public InventoryRepository(
    AppDbContext dbContext,
    IRateFeedService? rateFeed = null,
    ICoreBankingLedgerService? coreBanking = null,
    Ledger.Gl.Integration.InventoryEventListener? glListener = null)   // NEW
{
    _dbContext = dbContext; _rateFeed = rateFeed;
    _coreBanking = coreBanking; _glListener = glListener;              // NEW
}
```

Then, right after the existing `_coreBanking.PostLedgerEntryAsync(...)` call on a
purchase-order receipt:

```csharp
if (_glListener != null && po.LandedCost > 0)
{
    await _glListener.HandleAsync(new Ledger.Gl.Integration.InventoryTransactionSnapshot
    {
        TransactionNumber = po.PoNumber,          // origin id -> ExternalKey/SourceId
        TransactionType   = "PURCHASE",
        Commodity         = metalTypeName,         // "GOLD"/"SILVER" from the lot's MetalType
        Amount            = po.LandedCost,
        Currency          = po.Currency,
        InitiatedBy       = receivedBy,
        Ownership         = "KFH_OWNED",           // supplier purchase -> KFH inventory rule
        OccurredAtUtc     = DateTime.UtcNow
    }, new Ledger.Gl.Integration.PmimsInventoryAdapter());
}
```

For a **customer custody deposit** set `Ownership = "CUSTOMER_OWNED"` and
`ReceiptReason = "CUSTODY_DEPOSIT"` — the config's ownership-conditioned rule then books
it to the custody accounts (`1900`/`2900`) instead of KFH inventory. That's the same
`KFH_OWNED` vs `CUSTOMER_OWNED` split PMIMS already tracks in
`InventoryRepository` (see the `ownershipType` decision on receipt).

Register `InventoryRepository`'s new dependency: nothing to change — the DI container
supplies `InventoryEventListener` automatically because `AddLedgerGl` registered it.

## Reading the ledger

Inject `GeneralLedger` anywhere (e.g. a reporting service):

```csharp
var tb      = await gl.Reports.GetTrialBalanceAsync();
var goldInv = await gl.Reports.GetBalanceAsync("1200", asOfUtc: someDate);
var history = await gl.Reports.GetHistoryAsync(sourceType: "INVENTORY_TRANSACTION", sourceId: "TR-9001");
var audit   = await gl.Reports.VerifyIntegrityAsync();
```

## Concurrency note

`GeneralLedger` serializes posts within a process and the `UNIQUE(SequenceNumber)` index
backstops the hash chain. PMIMS is a single-process modular monolith with maker-checker
serialization on GL-relevant writes, so this is sufficient. If you later run multiple API
instances, wrap `PostAsync` in a retry that rebuilds the entry on a unique-violation.
