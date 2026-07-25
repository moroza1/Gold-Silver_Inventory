namespace Ledger.Gl.Core;

// ============================================================================
// PUBLIC FACADE -- the single entry point the host wires up.
//
//   var gl = GeneralLedger.FromConfigFile("Config/gl-accounts.gold-silver.json");
//   await gl.PostAsync(new InventoryEvent { ... });
//   var tb = await gl.Reports.GetTrialBalanceAsync();
//
// It owns the config, validator, posting engine, store and reports, and is the
// only place that mutates the ledger (via PostAsync). Everything it needs is
// injectable, so in production you pass your own ILedgerStore; by default it
// uses the in-memory one so it runs with zero setup.
// ============================================================================
public sealed class GeneralLedger
{
    private readonly GlConfiguration _config;
    private readonly PostingEngine _engine;
    private readonly ILedgerStore _store;
    private readonly SemaphoreSlim _postLock = new(1, 1);

    public LedgerReports Reports { get; }
    public GlConfiguration Configuration => _config;

    public GeneralLedger(GlConfiguration config, ILedgerStore store)
    {
        config.Validate();                 // fail fast on a bad config
        _config = config;
        _store = store;
        var accounts = config.BuildAccounts();
        var validator = new LedgerValidator(accounts);
        _engine = new PostingEngine(config, validator);
        Reports = new LedgerReports(store);
    }

    /// <summary>Convenience: build a ready-to-use GL from a JSON config file + in-memory store.</summary>
    public static GeneralLedger FromConfigFile(string configPath)
    {
        var config = GlConfiguration.FromFile(configPath);
        return new GeneralLedger(config, new InMemoryLedgerStore(config.BuildAccounts()));
    }

    /// <summary>Convenience: build from a JSON config string + in-memory store.</summary>
    public static GeneralLedger FromConfigJson(string configJson)
    {
        var config = GlConfiguration.FromJson(configJson);
        return new GeneralLedger(config, new InMemoryLedgerStore(config.BuildAccounts()));
    }

    /// <summary>
    /// Post one inventory event as a balanced, hash-chained journal entry.
    /// Idempotent when the event carries an ExternalKey. Serialized so the
    /// sequence/hash chain is consistent; for horizontal scale, back it with a
    /// store whose AppendAsync enforces sequence uniqueness and retry on conflict.
    /// </summary>
    public async Task<PostResult> PostAsync(InventoryEvent e, CancellationToken ct = default)
    {
        if (!string.IsNullOrEmpty(e.ExternalKey) &&
            await _store.ExistsByExternalKeyAsync(e.ExternalKey, ct))
        {
            return PostResult.Duplicate(e.ExternalKey);
        }

        await _postLock.WaitAsync(ct);
        try
        {
            var seq = await _store.GetMaxSequenceAsync(ct) + 1;
            var prevHash = await _store.GetLastHashAsync(ct);
            var entry = _engine.BuildEntry(e, seq, prevHash);
            await _store.AppendAsync(entry, ct);
            return PostResult.Posted(entry);
        }
        finally
        {
            _postLock.Release();
        }
    }

    /// <summary>Post a batch in order; stops and reports on the first failure.</summary>
    public async Task<IReadOnlyList<PostResult>> PostManyAsync(IEnumerable<InventoryEvent> events, CancellationToken ct = default)
    {
        var results = new List<PostResult>();
        foreach (var e in events)
            results.Add(await PostAsync(e, ct));
        return results;
    }
}

/// <summary>Outcome of a post: the entry that was written, or a duplicate signal.</summary>
public sealed record PostResult(bool Success, bool WasDuplicate, JournalEntry? Entry, string? Message)
{
    public static PostResult Posted(JournalEntry e) => new(true, false, e, null);
    public static PostResult Duplicate(string key) => new(true, true, null, $"Event with ExternalKey '{key}' already posted; skipped.");
}
