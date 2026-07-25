namespace Ledger.Gl.EfCore;

// ============================================================================
// EF Core persistence records for the GL. These are DELIBERATELY separate from
// the pure domain types in Ledger.Gl.Core (JournalEntry/JournalLine): the core
// stays framework-free, and EfLedgerStore translates between the two. That keeps
// the module's plug-and-play promise intact -- persistence is an optional adapter.
// ============================================================================

/// <summary>Persisted header row for one journal entry (maps to gl_journal_entries).</summary>
public sealed class GlJournalEntryRecord
{
    public long Id { get; set; }                       // surrogate PK (identity)
    public string EntryId { get; set; } = null!;       // domain GUID
    public long SequenceNumber { get; set; }           // monotonic; UNIQUE index -> chain guard
    public DateTime PostedAtUtc { get; set; }
    public DateTime OccurredAtUtc { get; set; }

    public string SourceType { get; set; } = null!;
    public string SourceId { get; set; } = null!;
    public string SourceEventType { get; set; } = null!; // stored as enum name
    public string Commodity { get; set; } = null!;
    public string Currency { get; set; } = "KWD";

    public string InitiatedBy { get; set; } = null!;
    public string? Description { get; set; }
    public string? ExternalKey { get; set; }           // UNIQUE (filtered) -> idempotency

    public string? PreviousHash { get; set; }
    public string EntryHash { get; set; } = null!;

    public List<GlJournalLineRecord> Lines { get; set; } = new();
}

/// <summary>Persisted debit/credit leg (maps to gl_journal_lines).</summary>
public sealed class GlJournalLineRecord
{
    public long Id { get; set; }                       // surrogate PK (identity)
    public long EntryId { get; set; }                  // FK -> GlJournalEntryRecord.Id
    public int LineNumber { get; set; }                // preserves leg order within an entry
    public string AccountCode { get; set; } = null!;
    public string Side { get; set; } = null!;          // "Debit" / "Credit"
    public decimal Amount { get; set; }
    public string? Memo { get; set; }

    public GlJournalEntryRecord? Entry { get; set; }
}
