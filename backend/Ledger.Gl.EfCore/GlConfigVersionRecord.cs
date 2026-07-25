namespace Ledger.Gl.EfCore;

// ============================================================================
// Versioned, maker-checker GL configuration. Each row is a full snapshot of the
// chart of accounts + posting rules (stored as the module's own JSON, so the
// core Ledger.Gl remains the single source of truth for the schema). Exactly one
// row is ACTIVE at a time; that is the config the live GL posts against. Edits
// create a new DRAFT which a maker submits and a *different* user (checker)
// approves before it becomes ACTIVE — 4-eyes on how money is booked.
// ============================================================================
public sealed class GlConfigVersionRecord
{
    public long VersionId { get; set; }
    public int VersionNumber { get; set; }

    /// <summary>Full GlConfiguration serialized via GlConfiguration.ToJson().</summary>
    public string ConfigJson { get; set; } = null!;

    /// <summary>DRAFT | PENDING_CHECKER | ACTIVE | ARCHIVED | REJECTED.</summary>
    public string Status { get; set; } = GlConfigStatus.Draft;

    /// <summary>Maker's short description of what this change does / why.</summary>
    public string? ChangeSummary { get; set; }

    // ----- maker-checker audit trail ----------------------------------------
    public string CreatedBy { get; set; } = null!;      // maker
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? SubmittedBy { get; set; }
    public DateTime? SubmittedAt { get; set; }
    public string? ReviewedBy { get; set; }             // checker (approve/reject)
    public DateTime? ReviewedAt { get; set; }
    public string? ReviewComments { get; set; }
    public DateTime? ActivatedAt { get; set; }
}

/// <summary>Status constants for a GL config version (avoids magic strings).</summary>
public static class GlConfigStatus
{
    public const string Draft = "DRAFT";                 // editable by the maker
    public const string PendingChecker = "PENDING_CHECKER"; // submitted, awaiting approval
    public const string Active = "ACTIVE";               // the live config (exactly one)
    public const string Archived = "ARCHIVED";           // a previously-active version
    public const string Rejected = "REJECTED";           // checker declined the draft
}
