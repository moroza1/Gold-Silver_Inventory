namespace Ledger.Gl.Core;

// ============================================================================
// The heart of the module: turn a standardized InventoryEvent into a balanced,
// hash-chained JournalEntry using ONLY the configured mapping rules. It is pure
// and stateless with respect to the ledger -- it takes the current sequence
// number + previous hash as inputs and returns the next entry, so it scales
// horizontally and is trivially unit-testable. Persistence is someone else's job.
// ============================================================================
public sealed class PostingEngine
{
    private readonly GlConfiguration _config;
    private readonly LedgerValidator _validator;

    public PostingEngine(GlConfiguration config, LedgerValidator validator)
    {
        _config = config;
        _validator = validator;
    }

    /// <summary>
    /// Map one event to a fully-formed journal entry. Does NOT persist; the caller
    /// (GeneralLedger) supplies chain context and stores the result. Deterministic.
    /// </summary>
    public JournalEntry BuildEntry(InventoryEvent e, long sequenceNumber, string? previousHash)
    {
        _validator.ValidateEvent(e);

        // Metadata (e.g. ownership, location) can select a more specific rule -- see
        // GlConfiguration.ResolveRule and the custody rules in the example config.
        var rule = _config.ResolveRule(e.EventType, e.Commodity, e.Metadata)
            ?? throw new LedgerValidationException(
                $"No posting rule configured for event {e.EventType} / commodity '{e.Commodity}'" +
                (e.Metadata is { Count: > 0 } ? $" / attributes [{string.Join(", ", e.Metadata.Select(kv => $"{kv.Key}={kv.Value}"))}]" : "") +
                ". Add a rule to the GL configuration (no code change needed).");

        var currency = e.Currency ?? _config.BaseCurrency;

        // Translate each rule leg into a concrete journal line, scaling the event
        // amount by the leg's factor. Rounding to 2 dp per leg; the balance check
        // below guarantees we never emit a lopsided entry even after rounding.
        var lines = rule.Legs.Select(leg => new JournalLine
        {
            AccountCode = leg.Account,
            Side = leg.Side,
            Amount = decimal.Round(e.Amount * leg.AmountFactor, 2, MidpointRounding.AwayFromZero),
            Memo = leg.Memo ?? rule.Description
        }).ToList();

        _validator.ValidateLines(lines);

        var occurred = (e.OccurredAtUtc ?? DateTime.UtcNow).ToUniversalTime();
        var hash = HashChain.ComputeEntryHash(
            sequenceNumber, occurred, e.SourceType, e.SourceId, e.EventType,
            e.Commodity, currency, e.InitiatedBy, lines, previousHash);

        return new JournalEntry
        {
            EntryId = Guid.NewGuid().ToString("N"),
            SequenceNumber = sequenceNumber,
            PostedAtUtc = DateTime.UtcNow,
            OccurredAtUtc = occurred,
            Lines = lines,
            SourceType = e.SourceType,
            SourceId = e.SourceId,
            SourceEventType = e.EventType,
            Commodity = e.Commodity.ToUpperInvariant(),
            Currency = currency,
            InitiatedBy = e.InitiatedBy,
            Description = e.Description ?? rule.Description,
            ExternalKey = e.ExternalKey,
            PreviousHash = previousHash,
            EntryHash = hash
        };
    }
}
