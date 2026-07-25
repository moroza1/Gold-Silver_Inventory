using Ledger.Gl.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Ledger.Gl.EfCore;

// ============================================================================
// Holds the CURRENTLY ACTIVE GlConfiguration in memory so the hot posting path
// never hits the DB per request. It is a singleton; the maker-checker service
// calls Reload() the moment a new version is activated, so live posting picks up
// the change immediately without a restart. The GL facade + store read their
// config/accounts from here (see AddLedgerGl), which is what makes the config
// DB-backed and runtime-editable while keeping the core module unchanged.
// ============================================================================
public interface IGlConfigProvider
{
    /// <summary>The active configuration the live GL posts against.</summary>
    GlConfiguration Current { get; }

    /// <summary>Re-read the ACTIVE version from the database and swap it in atomically.</summary>
    Task ReloadAsync(CancellationToken ct = default);
}

public sealed class DbGlConfigProvider : IGlConfigProvider
{
    private readonly IServiceScopeFactory _scopeFactory;
    private volatile GlConfiguration _current;

    public DbGlConfigProvider(IServiceScopeFactory scopeFactory, GlConfiguration seed)
    {
        _scopeFactory = scopeFactory;
        _current = seed; // validated fallback until the DB ACTIVE version is loaded
    }

    public GlConfiguration Current => _current;

    public async Task ReloadAsync(CancellationToken ct = default)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GlDbContext>();
        var active = await db.ConfigVersions
            .Where(v => v.Status == GlConfigStatus.Active)
            .OrderByDescending(v => v.VersionNumber)
            .FirstOrDefaultAsync(ct);
        if (active is null) return; // keep the seed if nothing is active yet

        var cfg = GlConfiguration.FromJson(active.ConfigJson);
        cfg.Validate();            // never swap in a broken config
        _current = cfg;
    }
}
