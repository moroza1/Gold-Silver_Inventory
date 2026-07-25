using Ledger.Gl.Core;
using Microsoft.EntityFrameworkCore;

namespace Ledger.Gl.EfCore;

// ============================================================================
// Maker-checker workflow + dry-run simulator for the GL configuration. Scoped
// service used by the admin API. All state transitions are validated here (not
// in the controller), including segregation-of-duties: the checker who approves
// (or rejects) must be a different user than the maker who created/submitted.
// ============================================================================
public sealed class GlConfigService
{
    private readonly GlDbContext _db;
    private readonly IGlConfigProvider _provider;

    public GlConfigService(GlDbContext db, IGlConfigProvider provider)
    {
        _db = db;
        _provider = provider;
    }

    // ----- bootstrap ---------------------------------------------------------

    /// <summary>
    /// If the ledger has no config versions yet, create version 1 (ACTIVE) from the
    /// file/seed config so the system starts with a working, editable baseline.
    /// Idempotent — safe to call at every startup.
    /// </summary>
    public async Task EnsureSeededAsync(GlConfiguration seed, string seededBy, CancellationToken ct = default)
    {
        if (await _db.ConfigVersions.AnyAsync(ct)) return;
        seed.Validate();
        _db.ConfigVersions.Add(new GlConfigVersionRecord
        {
            VersionNumber = 1,
            ConfigJson = seed.ToJson(),
            Status = GlConfigStatus.Active,
            ChangeSummary = "Initial configuration seeded from file.",
            CreatedBy = seededBy,
            SubmittedBy = seededBy,
            SubmittedAt = DateTime.UtcNow,
            ReviewedBy = seededBy,
            ReviewedAt = DateTime.UtcNow,
            ActivatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(ct);
        await _provider.ReloadAsync(ct);
    }

    // ----- reads -------------------------------------------------------------

    public async Task<GlConfigVersionDto?> GetActiveAsync(CancellationToken ct = default)
    {
        var v = await _db.ConfigVersions
            .Where(x => x.Status == GlConfigStatus.Active)
            .OrderByDescending(x => x.VersionNumber)
            .FirstOrDefaultAsync(ct);
        return v is null ? null : GlConfigVersionDto.From(v, includeConfig: true);
    }

    public async Task<IReadOnlyList<GlConfigVersionDto>> ListVersionsAsync(CancellationToken ct = default) =>
        (await _db.ConfigVersions.OrderByDescending(x => x.VersionNumber).ToListAsync(ct))
        .Select(v => GlConfigVersionDto.From(v, includeConfig: false)).ToList();

    public async Task<GlConfigVersionDto?> GetVersionAsync(long id, CancellationToken ct = default)
    {
        var v = await _db.ConfigVersions.FindAsync([id], ct);
        return v is null ? null : GlConfigVersionDto.From(v, includeConfig: true);
    }

    // ----- maker path --------------------------------------------------------

    /// <summary>Return the open DRAFT if one exists, else clone the ACTIVE config into a new DRAFT.</summary>
    public async Task<GlConfigVersionDto> GetOrCreateDraftAsync(string maker, CancellationToken ct = default)
    {
        var existing = await _db.ConfigVersions
            .Where(x => x.Status == GlConfigStatus.Draft)
            .OrderByDescending(x => x.VersionNumber)
            .FirstOrDefaultAsync(ct);
        if (existing is not null) return GlConfigVersionDto.From(existing, includeConfig: true);

        var active = await _db.ConfigVersions
            .Where(x => x.Status == GlConfigStatus.Active)
            .OrderByDescending(x => x.VersionNumber)
            .FirstOrDefaultAsync(ct);

        var draft = new GlConfigVersionRecord
        {
            VersionNumber = await NextVersionNumberAsync(ct),
            ConfigJson = active?.ConfigJson ?? _provider.Current.ToJson(),
            Status = GlConfigStatus.Draft,
            ChangeSummary = null,
            CreatedBy = maker
        };
        _db.ConfigVersions.Add(draft);
        await _db.SaveChangesAsync(ct);
        return GlConfigVersionDto.From(draft, includeConfig: true);
    }

    /// <summary>Replace a DRAFT's config (validated) and change summary. Maker-only edit.</summary>
    public async Task<GlConfigVersionDto> SaveDraftAsync(long id, string configJson, string? changeSummary, string maker, CancellationToken ct = default)
    {
        var draft = await RequireAsync(id, ct);
        if (draft.Status != GlConfigStatus.Draft)
            throw new GlConfigException($"Version {draft.VersionNumber} is {draft.Status}, not an editable DRAFT.");

        // Parse + structurally validate before persisting — the screen can never save a broken config.
        GlConfiguration parsed;
        try { parsed = GlConfiguration.FromJson(configJson); }
        catch (Exception ex) { throw new GlConfigException($"Configuration is not valid JSON: {ex.Message}"); }
        parsed.Validate(); // throws GlConfigurationException on unbalanced rules / unknown accounts

        draft.ConfigJson = parsed.ToJson(); // normalized
        draft.ChangeSummary = changeSummary;
        draft.CreatedBy = maker;            // last editor is the maker of record
        await _db.SaveChangesAsync(ct);
        return GlConfigVersionDto.From(draft, includeConfig: true);
    }

    /// <summary>DRAFT → PENDING_CHECKER. After this the maker can no longer edit it.</summary>
    public async Task<GlConfigVersionDto> SubmitAsync(long id, string maker, CancellationToken ct = default)
    {
        var draft = await RequireAsync(id, ct);
        if (draft.Status != GlConfigStatus.Draft)
            throw new GlConfigException($"Only a DRAFT can be submitted (version {draft.VersionNumber} is {draft.Status}).");
        GlConfiguration.FromJson(draft.ConfigJson).Validate(); // re-check at the gate
        draft.Status = GlConfigStatus.PendingChecker;
        draft.SubmittedBy = maker;
        draft.SubmittedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return GlConfigVersionDto.From(draft, includeConfig: false);
    }

    // ----- checker path ------------------------------------------------------

    /// <summary>
    /// PENDING_CHECKER → ACTIVE. Enforces 4-eyes: the approver must differ from the
    /// maker and the submitter. Archives the previously ACTIVE version and hot-reloads
    /// the live config so new postings use it immediately.
    /// </summary>
    public async Task<GlConfigVersionDto> ApproveAsync(long id, string checker, CancellationToken ct = default)
    {
        var pending = await RequireAsync(id, ct);
        if (pending.Status != GlConfigStatus.PendingChecker)
            throw new GlConfigException($"Version {pending.VersionNumber} is {pending.Status}, not awaiting approval.");
        EnforceSegregation(pending, checker);
        GlConfiguration.FromJson(pending.ConfigJson).Validate(); // final safety check before it goes live

        foreach (var prior in await _db.ConfigVersions.Where(x => x.Status == GlConfigStatus.Active).ToListAsync(ct))
            prior.Status = GlConfigStatus.Archived;

        pending.Status = GlConfigStatus.Active;
        pending.ReviewedBy = checker;
        pending.ReviewedAt = DateTime.UtcNow;
        pending.ActivatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        await _provider.ReloadAsync(ct); // live GL now posts against the new config
        return GlConfigVersionDto.From(pending, includeConfig: false);
    }

    /// <summary>PENDING_CHECKER → REJECTED (with a reason). Also 4-eyes.</summary>
    public async Task<GlConfigVersionDto> RejectAsync(long id, string comments, string checker, CancellationToken ct = default)
    {
        var pending = await RequireAsync(id, ct);
        if (pending.Status != GlConfigStatus.PendingChecker)
            throw new GlConfigException($"Version {pending.VersionNumber} is {pending.Status}, not awaiting approval.");
        EnforceSegregation(pending, checker);
        pending.Status = GlConfigStatus.Rejected;
        pending.ReviewedBy = checker;
        pending.ReviewedAt = DateTime.UtcNow;
        pending.ReviewComments = comments;
        await _db.SaveChangesAsync(ct);
        return GlConfigVersionDto.From(pending, includeConfig: false);
    }

    // ----- simulator (dry-run, no persistence) -------------------------------

    /// <summary>
    /// Preview the journal entry a sample event would produce — against the ACTIVE
    /// config, or against a candidate ConfigJson (to see a DRAFT's effect before
    /// saving). Never persists anything. This is the "see it before you trust it" tool.
    /// </summary>
    public GlSimulationResult Simulate(GlSimulationRequest req)
    {
        try
        {
            var config = string.IsNullOrWhiteSpace(req.ConfigJson)
                ? _provider.Current
                : GlConfiguration.FromJson(req.ConfigJson!);
            config.Validate();

            if (!Enum.TryParse<InventoryEventType>(req.EventType, ignoreCase: true, out var eventType))
                return GlSimulationResult.Fail($"Unknown event type '{req.EventType}'.");

            var validator = new LedgerValidator(config.BuildAccounts());
            var engine = new PostingEngine(config, validator);

            var metadata = new Dictionary<string, string>();
            if (!string.IsNullOrWhiteSpace(req.Ownership)) metadata["ownership"] = req.Ownership!;

            var evt = new InventoryEvent
            {
                EventType = eventType,
                Commodity = req.Commodity,
                Amount = req.Amount,
                Currency = req.Currency,
                SourceType = "SIMULATION",
                SourceId = "preview",
                InitiatedBy = "simulator",
                Metadata = metadata.Count > 0 ? metadata : null
            };

            var entry = engine.BuildEntry(evt, sequenceNumber: 0, previousHash: null);
            var lines = entry.Lines.Select(l => new GlSimulatedLine(
                l.AccountCode,
                config.Accounts.FirstOrDefault(a => a.Code == l.AccountCode)?.Name ?? l.AccountCode,
                l.Side.ToString(), l.Amount, l.Memo)).ToList();

            return new GlSimulationResult(true, lines, entry.TotalDebits, entry.TotalCredits, entry.IsBalanced, null);
        }
        catch (Exception ex)
        {
            return GlSimulationResult.Fail(ex.Message);
        }
    }

    // ----- helpers -----------------------------------------------------------

    private async Task<GlConfigVersionRecord> RequireAsync(long id, CancellationToken ct) =>
        await _db.ConfigVersions.FindAsync([id], ct)
        ?? throw new GlConfigException($"Config version {id} not found.");

    private async Task<int> NextVersionNumberAsync(CancellationToken ct) =>
        (await _db.ConfigVersions.AnyAsync(ct) ? await _db.ConfigVersions.MaxAsync(x => x.VersionNumber, ct) : 0) + 1;

    private static void EnforceSegregation(GlConfigVersionRecord v, string reviewer)
    {
        if (string.Equals(reviewer, v.SubmittedBy, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(reviewer, v.CreatedBy, StringComparison.OrdinalIgnoreCase))
            throw new GlConfigException("Segregation of duties: the reviewer must be different from the maker/submitter of this change.");
    }
}

public sealed class GlConfigException : Exception
{
    public GlConfigException(string message) : base(message) { }
}

// ----- DTOs ------------------------------------------------------------------

public sealed record GlConfigVersionDto(
    long VersionId, int VersionNumber, string Status, string? ChangeSummary,
    string CreatedBy, DateTime CreatedAt, string? SubmittedBy, DateTime? SubmittedAt,
    string? ReviewedBy, DateTime? ReviewedAt, string? ReviewComments, DateTime? ActivatedAt,
    string? ConfigJson)
{
    public static GlConfigVersionDto From(GlConfigVersionRecord v, bool includeConfig) => new(
        v.VersionId, v.VersionNumber, v.Status, v.ChangeSummary, v.CreatedBy, v.CreatedAt,
        v.SubmittedBy, v.SubmittedAt, v.ReviewedBy, v.ReviewedAt, v.ReviewComments, v.ActivatedAt,
        includeConfig ? v.ConfigJson : null);
}

public sealed record GlSimulationRequest(
    string EventType, string Commodity, decimal Amount, string? Ownership, string? Currency, string? ConfigJson);

public sealed record GlSimulatedLine(string AccountCode, string AccountName, string Side, decimal Amount, string? Memo);

public sealed record GlSimulationResult(
    bool Ok, IReadOnlyList<GlSimulatedLine> Lines, decimal TotalDebits, decimal TotalCredits, bool Balanced, string? Error)
{
    public static GlSimulationResult Fail(string error) =>
        new(false, Array.Empty<GlSimulatedLine>(), 0, 0, false, error);
}
