namespace Ledger.Gl.Core;

// ============================================================================
// Persistence abstraction. The GL core never talks to a database directly -- it
// talks to this interface, so the host can back it with EF Core, Dapper, Mongo,
// a message log, or (for tests/dev) the in-memory store. This is also the seam
// that keeps the module stateless: swap in a shared/distributed store and you
// can run many GL instances behind a load balancer.
//
// Implementations MUST make AppendAsync atomic w.r.t. sequence numbering (the
// InMemory one uses a lock; a SQL one would use an identity column / row lock)
// so the hash chain never forks under concurrency.
// ============================================================================
public interface ILedgerStore
{
    /// <summary>Highest sequence number stored, or 0 if empty. Used to continue the chain.</summary>
    Task<long> GetMaxSequenceAsync(CancellationToken ct = default);

    /// <summary>Hash of the most recent entry, or null if the ledger is empty.</summary>
    Task<string?> GetLastHashAsync(CancellationToken ct = default);

    /// <summary>Persist a new entry. Implementations should enforce sequence uniqueness.</summary>
    Task AppendAsync(JournalEntry entry, CancellationToken ct = default);

    /// <summary>Idempotency guard: has an entry with this ExternalKey already been posted?</summary>
    Task<bool> ExistsByExternalKeyAsync(string externalKey, CancellationToken ct = default);

    /// <summary>All entries in sequence order (implementations may stream/paginate).</summary>
    Task<IReadOnlyList<JournalEntry>> GetEntriesAsync(
        DateTime? fromUtc = null,
        DateTime? toUtc = null,
        string? accountCode = null,
        string? sourceType = null,
        string? sourceId = null,
        CancellationToken ct = default);

    /// <summary>The chart of accounts this ledger posts against.</summary>
    Task<IReadOnlyList<LedgerAccount>> GetAccountsAsync(CancellationToken ct = default);
}
