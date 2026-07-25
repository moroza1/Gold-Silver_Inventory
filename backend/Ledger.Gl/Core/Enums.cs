namespace Ledger.Gl.Core;

// ============================================================================
// GL primitives. Deliberately small and stable: these are the only vocabulary
// terms an inventory system needs to know about to talk to this module.
// ============================================================================

/// <summary>
/// The five classical account classifications. Normal balance side is derived
/// from this (Asset/Expense = Debit-normal; Liability/Equity/Revenue = Credit-
/// normal), which is what lets the reporting layer sign balances correctly
/// without any per-account configuration.
/// </summary>
public enum AccountType
{
    Asset,
    Liability,
    Equity,
    Revenue,
    Expense
}

/// <summary>Which side of the double entry a line posts to.</summary>
public enum PostingSide
{
    Debit,
    Credit
}

/// <summary>
/// The canonical inventory event kinds this module knows how to post. The set
/// is intentionally inventory-agnostic (no gold/silver, no PMIMS concepts) so
/// any inventory system can map its own transaction types onto these. Extend by
/// adding a value here AND a mapping rule in configuration -- no engine change.
/// </summary>
public enum InventoryEventType
{
    Purchase,     // stock acquired from a supplier
    Sale,         // stock sold to a customer
    Transfer,     // stock moved between locations/ownership (usually GL-neutral)
    Adjustment,   // quantity/value corrected up or down
    WriteOff      // stock removed with no consideration (loss, shrinkage, spoilage)
}
