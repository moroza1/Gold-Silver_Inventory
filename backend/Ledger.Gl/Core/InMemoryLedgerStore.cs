namespace Ledger.Gl.Core;

// ============================================================================
// Reference ILedgerStore for dev, tests, and demos. Thread-safe via a single
// lock so concurrent AppendAsync calls can't fork the hash chain. NOT for
// production persistence -- swap in an EF Core / SQL implementation there. It
// exists so the module is runnable and testable out of the box with zero infra.
// ============================================================================
public sealed class InMemoryLedgerStore : ILedgerStore
{
    private readonly object _gate = new();
    private readonly List<JournalEntry> _entries = new();
    private readonly HashSet<string> _externalKeys = new(StringComparer.Ordinal);
    private readonly List<LedgerAccount> _accounts;

    public InMemoryLedgerStore(IEnumerable<LedgerAccount> accounts) => _accounts = accounts.ToList();

    public Task<long> GetMaxSequenceAsync(CancellationToken ct = default)
    {
        lock (_gate) return Task.FromResult(_entries.Count == 0 ? 0L : _entries[^1].SequenceNumber);
    }

    public Task<string?> GetLastHashAsync(CancellationToken ct = default)
    {
        lock (_gate) return Task.FromResult(_entries.Count == 0 ? null : _entries[^1].EntryHash);
    }

    public Task AppendAsync(JournalEntry entry, CancellationToken ct = default)
    {
        lock (_gate)
        {
            var expected = (_entries.Count == 0 ? 0L : _entries[^1].SequenceNumber) + 1;
            if (entry.SequenceNumber != expected)
                throw new InvalidOperationException(
                    $"Concurrent append detected: expected sequence {expected}, got {entry.SequenceNumber}. Retry.");
            _entries.Add(entry);
            if (!string.IsNullOrEmpty(entry.ExternalKey)) _externalKeys.Add(entry.ExternalKey);
        }
        return Task.CompletedTask;
    }

    public Task<bool> ExistsByExternalKeyAsync(string externalKey, CancellationToken ct = default)
    {
        lock (_gate) return Task.FromResult(_externalKeys.Contains(externalKey));
    }

    public Task<IReadOnlyList<JournalEntry>> GetEntriesAsync(
        DateTime? fromUtc = null, DateTime? toUtc = null, string? accountCode = null,
        string? sourceType = null, string? sourceId = null, CancellationToken ct = default)
    {
        lock (_gate)
        {
            IEnumerable<JournalEntry> q = _entries;
            if (fromUtc is { } f) q = q.Where(e => e.OccurredAtUtc >= f);
            if (toUtc is { } t) q = q.Where(e => e.OccurredAtUtc <= t);
            if (!string.IsNullOrWhiteSpace(accountCode))
                q = q.Where(e => e.Lines.Any(l => string.Equals(l.AccountCode, accountCode, StringComparison.OrdinalIgnoreCase)));
            if (!string.IsNullOrWhiteSpace(sourceType))
                q = q.Where(e => string.Equals(e.SourceType, sourceType, StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrWhiteSpace(sourceId))
                q = q.Where(e => string.Equals(e.SourceId, sourceId, StringComparison.OrdinalIgnoreCase));
            return Task.FromResult<IReadOnlyList<JournalEntry>>(q.OrderBy(e => e.SequenceNumber).ToList());
        }
    }

    public Task<IReadOnlyList<LedgerAccount>> GetAccountsAsync(CancellationToken ct = default)
    {
        lock (_gate) return Task.FromResult<IReadOnlyList<LedgerAccount>>(_accounts.ToList());
    }
}
