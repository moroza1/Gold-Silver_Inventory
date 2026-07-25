# Ledger.Gl — Plug-and-Play General Ledger Module

A self-contained, inventory-agnostic **double-entry General Ledger** you can drop into any
.NET solution. It turns standardized inventory events (purchases, sales, transfers,
adjustments, write-offs) into balanced, hash-chained journal entries, using a **configuration
file** for the chart of accounts and event→account mapping — no code changes to re-map
accounts, add a commodity, or onboard a new project.

It ships with an example gold/silver configuration and a runnable self-test.

---

## Why it's reusable

- **No dependency on your inventory schema.** The only thing the host produces is an
  [`InventoryEvent`](Core/InventoryEvent.cs) — a flat, serializable contract. Change your
  inventory database all you like; as long as you can still fill in an `InventoryEvent`, the
  GL keeps working.
- **No NuGet or project references.** Pure BCL, targets `net10.0`. Copy the folder into any
  solution and reference it.
- **Config, not code.** Accounts and mappings live in JSON ([example](Config/gl-accounts.gold-silver.json)).
- **Stateless core, pluggable persistence.** The engine takes chain context in and returns the
  next entry; persistence is behind [`ILedgerStore`](Core/ILedgerStore.cs). Back it with the
  in-memory store (dev/tests) or your own EF Core/SQL store (production) and scale horizontally.

---

## Architecture

```
Core/                         ← GL logic, zero knowledge of any inventory system
  Enums.cs                    AccountType, PostingSide, InventoryEventType
  InventoryEvent.cs           THE integration contract (all the host must produce)
  Models.cs                   LedgerAccount, JournalEntry, JournalLine
  GlConfiguration.cs          chart of accounts + posting rules (JSON-loadable) + validation
  LedgerValidator.cs          double-entry + account-existence enforcement
  PostingEngine.cs            event → balanced journal entry (pure, stateless)
  HashChain.cs                SHA-256 tamper-evident audit chain
  ILedgerStore.cs             persistence abstraction (swap in your DB)
  InMemoryLedgerStore.cs      reference store for dev/tests
  LedgerReports.cs            balances, history, trial balance, integrity check
  GeneralLedger.cs            public facade — wire this up

Integration/                  ← the ONLY place coupled to a host inventory system
  InventoryEventListener.cs   choke point: inventory activity → GL postings
  PmimsInventoryAdapter.cs    example adapter (PMIMS InventoryTransaction → InventoryEvent)

Config/
  gl-accounts.gold-silver.json  example configuration

Demo/
  Program.cs                  runnable self-test (asserts every invariant)
```

The dependency arrow only ever points **Integration → Core**. Core never references
Integration, your inventory schema, or a database.

---

## Quick start

```csharp
using Ledger.Gl.Core;

// 1. Build a GL from a config file (uses the in-memory store by default).
var gl = GeneralLedger.FromConfigFile("Config/gl-accounts.gold-silver.json");

// 2. Post an inventory event.
await gl.PostAsync(new InventoryEvent {
    EventType   = InventoryEventType.Purchase,
    Commodity   = "GOLD",
    Amount      = 20000m,
    SourceType  = "PURCHASE_ORDER",   // origin traceability…
    SourceId    = "PO-1001",          // …links the GL entry back to your record
    InitiatedBy = "treasury-maker",
    ExternalKey = "PO-1001:PURCHASE"  // idempotency: safe to retry
});

// 3. Query.
var tb      = await gl.Reports.GetTrialBalanceAsync();          // balanced Dr/Cr
var goldInv = await gl.Reports.GetBalanceAsync("1200");         // 19,700 after a 300 write-off
var history = await gl.Reports.GetHistoryAsync(sourceId: "PO-1001");
var audit   = await gl.Reports.VerifyIntegrityAsync();          // hash chain intact?
```

### Run the self-test

```bash
cd backend/Ledger.Gl
dotnet run -c Release -p:DEMO=true
```

It posts a realistic gold/silver stream, prints the trial balance, verifies the audit chain,
and asserts every invariant (non-zero exit code = broken). The same scenario is verified
independently and passes: Inventory-Gold 19,700 · A/P 23,000 · Gold Revenue 8,500 · trial
balance 31,500 Dr = 31,500 Cr.

---

## Wiring into an existing inventory system

You need **one adapter** that maps your inventory record to an `InventoryEvent`. Implement
[`IInventoryEventAdapter<TSource>`](Integration/InventoryEventListener.cs) and post via the
listener:

```csharp
var gl       = GeneralLedger.FromConfigFile(configPath);      // register as a singleton in DI
var listener = new InventoryEventListener(gl,
                   onPosted: r => log.Info($"GL seq {r.Entry?.SequenceNumber}"),
                   onError:  (e, ex) => log.Error(ex, $"GL post failed for {e.SourceId}"));

// wherever your inventory system commits a transaction:
await listener.HandleAsync(myTransaction, new MyInventoryAdapter());
```

An adapter returns `null` for records that should **not** hit the GL (e.g. a pure reservation),
and the listener silently skips them.

### PMIMS specifically

[`PmimsInventoryAdapter`](Integration/PmimsInventoryAdapter.cs) shows the mapping from PMIMS
`InventoryTransaction` types (`PURCHASE`, `SALE`, `TRANSFER`, `ADJUSTMENT`, …) to the canonical
event types. To keep this module dependency-free it maps from a small
`InventoryTransactionSnapshot` DTO; two integration options are documented in that file:
either add a `ProjectReference` to `PMIMS.Domain` and read `InventoryTransaction` directly, or
(recommended) project the entity into the snapshot in `PMIMS.Infrastructure` at the post site.
This is a natural companion to the existing `CoreBankingLedgerPosting` / `ICoreBankingLedgerService`
seam — the GL module can produce the local double-entry record that those postings summarize.

**Production persistence (included).** The companion project **`Ledger.Gl.EfCore`** provides a
durable `ILedgerStore` (`EfLedgerStore`) over its own bounded-context `GlDbContext`, plus a
one-call DI extension. It lives in a separate project so the core stays dependency-free — hosts
that want a different store just don't reference it. Full PMIMS recipe: **`Ledger.Gl.EfCore/WIRING.md`**.

```csharp
using Ledger.Gl.EfCore;
builder.Services.AddLedgerGl("Config/gl-accounts.gold-silver.json",
    opt => opt.UseSqlite(connectionString));   // same DB as the host; own gl_journal_* tables
app.Services.EnsureLedgerGlSchema();            // dev; use EF migrations in production
// now inject GeneralLedger or InventoryEventListener anywhere
```

The only hard requirement for any store is that `AppendAsync` enforces a **unique, monotonic
sequence number** so the hash chain can't fork; `EfLedgerStore` does this with a `UNIQUE` index.

### Ownership-aware account segregation (custody)

Rules can carry `match` conditions on event `Metadata`, so the same event type routes to
different accounts by context. This is how customer-owned custody metal is kept off KFH's
books — a `{ "ownership": "CUSTOMER_OWNED" }` rule (custody liability/contra) overrides the
generic commodity rule (a satisfied condition outranks an exact commodity match):

```jsonc
{ "eventType": "Purchase", "commodity": "*",
  "match": { "ownership": "CUSTOMER_OWNED" },
  "legs": [ { "account": "1900", "side": "Debit" }, { "account": "2900", "side": "Credit" } ] }
```

The mechanism is generic — match on location, channel, counterparty class, anything you put in
`InventoryEvent.Metadata`.

---

## Configuring accounts & commodities (no code changes)

A configuration is a **chart of accounts** plus **posting rules**. A rule says: for this event
type (and optionally this commodity), debit these accounts and credit those. Debit legs and
credit legs must each sum to the full amount, so every entry balances.

```jsonc
{
  "baseCurrency": "KWD",
  "accounts": [
    { "code": "1200", "name": "Inventory - Gold", "type": "Asset" },
    { "code": "2000", "name": "Accounts Payable", "type": "Liability" }
  ],
  "rules": [
    {
      "eventType": "Purchase", "commodity": "GOLD",
      "legs": [
        { "account": "1200", "side": "Debit"  },   // inventory up
        { "account": "2000", "side": "Credit" }    // payable up
      ]
    }
  ]
}
```

**Add a new commodity (e.g. platinum):** add its inventory/revenue accounts and copy the
Purchase/Sale/etc. rules with `"commodity": "PLATINUM"`. No recompile. A rule with
`"commodity": "*"` (or omitted) is the fallback for any commodity of that event type, so
common treatments can be shared and only the specifics overridden.

**Split an amount across accounts** (e.g. book a fee on a sale) with `amountFactor` on each leg
— the validator confirms debit and credit factors still balance.

The config is validated at startup (`GlConfiguration.Validate()` / called by the `GeneralLedger`
constructor): duplicate codes, unknown account references, and unbalanced rules fail fast.

---

## Requirements coverage

| Requirement | Where |
|---|---|
| Auto-generate debits/credits from inventory transactions | `PostingEngine`, `InventoryEventListener` |
| Multi-account mapping, configurable per project | `GlConfiguration`, `Config/*.json` |
| Transaction origin (link back by id + type) | `JournalEntry.SourceType/SourceId/SourceEventType` |
| Audit trail (timestamp, user, description, hash + sequence) | `JournalEntry`, `HashChain` |
| Multiple commodities, extensible | `InventoryEvent.Commodity` (free-form) + commodity rules |
| Balance lookups by account/date | `LedgerReports.GetBalanceAsync` |
| Transaction history | `LedgerReports.GetHistoryAsync` |
| Trial balance | `LedgerReports.GetTrialBalanceAsync` |
| Double-entry enforcement + account existence checks | `LedgerValidator` |
| Config-driven account mapping for gold/silver | `Config/gl-accounts.gold-silver.json` |
| Stateless / horizontally scalable | pure `PostingEngine` + pluggable `ILedgerStore` |

Out of scope by design (per the brief): UI, external API endpoints, and reporting beyond basic
transaction history.

> **Note on verification:** the ledger arithmetic, config validity, double-entry balancing, and
> the self-test's expected figures were verified independently and all pass. The `net10.0`
> compile/`dotnet run` step should be executed in your environment, as the authoring sandbox had
> no .NET SDK available.
