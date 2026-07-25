namespace Ledger.Gl.Core;

// ============================================================================
// THE INTEGRATION CONTRACT
// ----------------------------------------------------------------------------
// This is the ONLY type the host inventory system has to produce. It is a flat,
// serializable value object with no reference to any inventory schema. The
// inventory system's adapter fills this in from whatever its own transaction
// record looks like (see Integration/InventoryEventListener.cs and the PMIMS
// example adapter). Keeping this contract minimal and stable is what makes the
// GL module drop-in: change your inventory schema all you like, as long as you
// can still populate an InventoryEvent, the GL keeps working unchanged.
// ============================================================================

/// <summary>
/// A standardized, inventory-agnostic description of something that happened in
/// the inventory system and that may require a ledger posting.
/// </summary>
public sealed record InventoryEvent
{
    /// <summary>What kind of inventory movement this is (drives account mapping).</summary>
    public required InventoryEventType EventType { get; init; }

    /// <summary>
    /// Commodity key, e.g. "GOLD", "SILVER", "PLATINUM". Free-form string so the
    /// module is extensible to any commodity without a code change; it must match
    /// a commodity key used in the configuration's mapping rules. Case-insensitive.
    /// </summary>
    public required string Commodity { get; init; }

    /// <summary>
    /// The monetary value of the movement in <see cref="Currency"/>. Always the
    /// gross transaction amount that hits the primary accounts. Must be &gt; 0;
    /// direction is decided by the mapping (which side each account posts to),
    /// not by the sign of this number.
    /// </summary>
    public required decimal Amount { get; init; }

    /// <summary>ISO currency code. Defaults to the config's base currency if left null.</summary>
    public string? Currency { get; init; }

    // ----- Transaction-origin traceability (audit requirement) --------------

    /// <summary>
    /// The inventory system's own record type that originated this event, e.g.
    /// "PURCHASE_ORDER", "SALES_INVOICE", "INVENTORY_TRANSACTION". Stored on the
    /// journal entry so every GL row can be traced back to its source.
    /// </summary>
    public required string SourceType { get; init; }

    /// <summary>The inventory system's primary key for the originating record.</summary>
    public required string SourceId { get; init; }

    // ----- Audit-trail inputs ------------------------------------------------

    /// <summary>User (or system principal) responsible for the movement.</summary>
    public required string InitiatedBy { get; init; }

    /// <summary>Human-readable description carried onto the journal entry memo.</summary>
    public string? Description { get; init; }

    /// <summary>
    /// When the movement occurred in the source system. If null the module uses
    /// the current UTC time. Supplying it keeps GL dates aligned with inventory
    /// dates for period reporting even when events are posted in batch/late.
    /// </summary>
    public DateTime? OccurredAtUtc { get; init; }

    /// <summary>
    /// Optional idempotency key. If supplied, the module will refuse to post the
    /// same event twice (see ILedgerStore.ExistsByExternalKey). Recommended value:
    /// $"{SourceType}:{SourceId}:{EventType}". Prevents double-posting on retries.
    /// </summary>
    public string? ExternalKey { get; init; }

    /// <summary>
    /// Optional extra fields (weight, purity, location, counterparty, ...) that a
    /// specific mapping rule might reference or that you simply want on the audit
    /// record. Never required by the core engine.
    /// </summary>
    public IReadOnlyDictionary<string, string>? Metadata { get; init; }
}
