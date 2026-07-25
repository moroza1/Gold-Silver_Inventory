namespace Ledger.Gl.Core;

// ============================================================================
// GL data model: accounts, journal entries, journal lines.
// These are plain POCOs with no persistence framework attributes so they can be
// mapped by EF Core, Dapper, or serialized to JSON as-is. The host chooses.
// ============================================================================

/// <summary>
/// A GL account (a line in the chart of accounts). Identified by a stable string
/// <see cref="Code"/> so configuration and mappings never depend on database ids.
/// </summary>
public sealed class LedgerAccount
{
    public required string Code { get; init; }        // e.g. "1200"
    public required string Name { get; init; }        // e.g. "Inventory - Gold"
    public required AccountType Type { get; init; }
    public string Currency { get; init; } = "KWD";
    public bool IsActive { get; init; } = true;

    /// <summary>
    /// The side on which a positive balance sits. Asset/Expense are debit-normal;
    /// Liability/Equity/Revenue are credit-normal. Used to sign report balances.
    /// </summary>
    public PostingSide NormalSide =>
        Type is AccountType.Asset or AccountType.Expense ? PostingSide.Debit : PostingSide.Credit;
}

/// <summary>One leg of a balanced journal entry: a debit or credit to one account.</summary>
public sealed class JournalLine
{
    public required string AccountCode { get; init; }
    public required PostingSide Side { get; init; }
    public required decimal Amount { get; init; }     // always positive; Side carries direction
    public string? Memo { get; init; }

    public decimal SignedAmount => Side == PostingSide.Debit ? Amount : -Amount;
}

/// <summary>
/// A complete, balanced double-entry transaction (sum of debits == sum of
/// credits). Carries full origin traceability and an append-only audit record.
/// </summary>
public sealed class JournalEntry
{
    /// <summary>Module-assigned unique id (GUID string; stable across stores).</summary>
    public required string EntryId { get; init; }

    /// <summary>
    /// Monotonic per-ledger sequence number. Together with <see cref="EntryHash"/>
    /// and <see cref="PreviousHash"/> this forms a tamper-evident hash chain.
    /// </summary>
    public required long SequenceNumber { get; init; }

    public required DateTime PostedAtUtc { get; init; }
    public required DateTime OccurredAtUtc { get; init; }

    public required IReadOnlyList<JournalLine> Lines { get; init; }

    // ----- Origin traceability (links back to the inventory record) ---------
    public required string SourceType { get; init; }
    public required string SourceId { get; init; }
    public required InventoryEventType SourceEventType { get; init; }
    public required string Commodity { get; init; }
    public string Currency { get; init; } = "KWD";

    // ----- Audit trail -------------------------------------------------------
    public required string InitiatedBy { get; init; }
    public string? Description { get; init; }
    public string? ExternalKey { get; init; }

    /// <summary>Hash of the previous entry in the chain (null for the first entry).</summary>
    public string? PreviousHash { get; init; }

    /// <summary>SHA-256 over this entry's canonical content + PreviousHash.</summary>
    public required string EntryHash { get; init; }

    public decimal TotalDebits => Lines.Where(l => l.Side == PostingSide.Debit).Sum(l => l.Amount);
    public decimal TotalCredits => Lines.Where(l => l.Side == PostingSide.Credit).Sum(l => l.Amount);
    public bool IsBalanced => TotalDebits == TotalCredits;
}
