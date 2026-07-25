using Ledger.Gl.Core;
using Microsoft.EntityFrameworkCore;

namespace Ledger.Gl.EfCore;

// ============================================================================
// Production ILedgerStore backed by EF Core (GlDbContext). Drop-in replacement
// for InMemoryLedgerStore: same interface, durable storage. The chart of
// accounts comes from the GL configuration (not the DB), so it is injected once
// and returned by GetAccountsAsync for the reporting layer.
//
// Concurrency: AppendAsync relies on the UNIQUE index on SequenceNumber to
// prevent a forked hash chain. If two posts race, one insert throws
// DbUpdateException; GeneralLedger serializes posts within a process, and for
// multi-instance deployments you wrap PostAsync in a retry (see WIRING.md).
// ============================================================================
public sealed class EfLedgerStore : ILedgerStore
{
    private readonly GlDbContext _db;
    private readonly IReadOnlyList<LedgerAccount> _accounts;

    public EfLedgerStore(GlDbContext db, IEnumerable<LedgerAccount> accounts)
    {
        _db = db;
        _accounts = accounts.ToList();
    }

    public async Task<long> GetMaxSequenceAsync(CancellationToken ct = default) =>
        await _db.JournalEntries.AnyAsync(ct)
            ? await _db.JournalEntries.MaxAsync(e => e.SequenceNumber, ct)
            : 0L;

    public async Task<string?> GetLastHashAsync(CancellationToken ct = default) =>
        await _db.JournalEntries
            .OrderByDescending(e => e.SequenceNumber)
            .Select(e => e.EntryHash)
            .FirstOrDefaultAsync(ct);

    public async Task AppendAsync(JournalEntry entry, CancellationToken ct = default)
    {
        _db.JournalEntries.Add(ToRecord(entry));
        await _db.SaveChangesAsync(ct); // unique(SequenceNumber) enforces chain integrity
    }

    public Task<bool> ExistsByExternalKeyAsync(string externalKey, CancellationToken ct = default) =>
        _db.JournalEntries.AnyAsync(e => e.ExternalKey == externalKey, ct);

    public async Task<IReadOnlyList<JournalEntry>> GetEntriesAsync(
        DateTime? fromUtc = null, DateTime? toUtc = null, string? accountCode = null,
        string? sourceType = null, string? sourceId = null, CancellationToken ct = default)
    {
        IQueryable<GlJournalEntryRecord> q = _db.JournalEntries.Include(e => e.Lines);
        if (fromUtc is { } f) q = q.Where(e => e.OccurredAtUtc >= f);
        if (toUtc is { } t) q = q.Where(e => e.OccurredAtUtc <= t);
        if (!string.IsNullOrWhiteSpace(sourceType)) q = q.Where(e => e.SourceType == sourceType);
        if (!string.IsNullOrWhiteSpace(sourceId)) q = q.Where(e => e.SourceId == sourceId);
        if (!string.IsNullOrWhiteSpace(accountCode))
            q = q.Where(e => e.Lines.Any(l => l.AccountCode == accountCode));

        var records = await q.OrderBy(e => e.SequenceNumber).ToListAsync(ct);
        return records.Select(ToDomain).ToList();
    }

    public Task<IReadOnlyList<LedgerAccount>> GetAccountsAsync(CancellationToken ct = default) =>
        Task.FromResult(_accounts);

    // ----- translation -------------------------------------------------------

    private static GlJournalEntryRecord ToRecord(JournalEntry e) => new()
    {
        EntryId = e.EntryId,
        SequenceNumber = e.SequenceNumber,
        PostedAtUtc = e.PostedAtUtc,
        OccurredAtUtc = e.OccurredAtUtc,
        SourceType = e.SourceType,
        SourceId = e.SourceId,
        SourceEventType = e.SourceEventType.ToString(),
        Commodity = e.Commodity,
        Currency = e.Currency,
        InitiatedBy = e.InitiatedBy,
        Description = e.Description,
        ExternalKey = e.ExternalKey,
        PreviousHash = e.PreviousHash,
        EntryHash = e.EntryHash,
        Lines = e.Lines.Select((l, i) => new GlJournalLineRecord
        {
            LineNumber = i,
            AccountCode = l.AccountCode,
            Side = l.Side.ToString(),
            Amount = l.Amount,
            Memo = l.Memo
        }).ToList()
    };

    private static JournalEntry ToDomain(GlJournalEntryRecord r) => new()
    {
        EntryId = r.EntryId,
        SequenceNumber = r.SequenceNumber,
        PostedAtUtc = r.PostedAtUtc,
        OccurredAtUtc = r.OccurredAtUtc,
        SourceType = r.SourceType,
        SourceId = r.SourceId,
        SourceEventType = Enum.Parse<InventoryEventType>(r.SourceEventType),
        Commodity = r.Commodity,
        Currency = r.Currency,
        InitiatedBy = r.InitiatedBy,
        Description = r.Description,
        ExternalKey = r.ExternalKey,
        PreviousHash = r.PreviousHash,
        EntryHash = r.EntryHash,
        Lines = r.Lines.OrderBy(l => l.LineNumber).Select(l => new JournalLine
        {
            AccountCode = l.AccountCode,
            Side = Enum.Parse<PostingSide>(l.Side),
            Amount = l.Amount,
            Memo = l.Memo
        }).ToList()
    };
}
