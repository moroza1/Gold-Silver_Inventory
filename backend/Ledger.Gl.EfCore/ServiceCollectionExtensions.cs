using Ledger.Gl.Core;
using Ledger.Gl.Integration;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;

namespace Ledger.Gl.EfCore;

// ============================================================================
// One-call DI wiring for a durable, DB-backed, maker-checker GL configuration.
// After AddLedgerGl + InitializeLedgerGlAsync you can inject: GeneralLedger and
// InventoryEventListener (posting), and GlConfigService (the admin screen's API).
// The live GL always posts against the ACTIVE config version, served hot from
// IGlConfigProvider and swapped in the instant a new version is approved.
// ============================================================================
public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddLedgerGl(
        this IServiceCollection services,
        string configFilePath,
        Action<DbContextOptionsBuilder> configureDb)
        => AddLedgerGl(services, GlConfiguration.FromFile(configFilePath), configureDb);

    public static IServiceCollection AddLedgerGl(
        this IServiceCollection services,
        GlConfiguration seedConfig,
        Action<DbContextOptionsBuilder> configureDb)
    {
        seedConfig.Validate();               // fail fast on a bad seed
        services.AddSingleton(seedConfig);   // seed/fallback until the DB ACTIVE version loads

        services.AddDbContext<GlDbContext>(configureDb);

        // Active-config provider: singleton in-memory cache, hot-reloaded on approval.
        services.AddSingleton<IGlConfigProvider>(sp =>
            new DbGlConfigProvider(sp.GetRequiredService<IServiceScopeFactory>(), sp.GetRequiredService<GlConfiguration>()));

        // Store + GL facade always read the CURRENT active config from the provider,
        // so an approved config change takes effect on the very next posting.
        services.AddScoped<ILedgerStore>(sp =>
            new EfLedgerStore(sp.GetRequiredService<GlDbContext>(),
                              sp.GetRequiredService<IGlConfigProvider>().Current.BuildAccounts()));
        services.AddScoped(sp =>
            new GeneralLedger(sp.GetRequiredService<IGlConfigProvider>().Current, sp.GetRequiredService<ILedgerStore>()));
        services.AddScoped(sp => new InventoryEventListener(sp.GetRequiredService<GeneralLedger>()));

        // Maker-checker config service (backs the admin screen).
        services.AddScoped(sp =>
            new GlConfigService(sp.GetRequiredService<GlDbContext>(), sp.GetRequiredService<IGlConfigProvider>()));

        return services;
    }

    /// <summary>
    /// Create the gl_* tables (if missing), seed the initial ACTIVE config version from
    /// the file/seed (if none), and load it into the provider. Call once at startup.
    /// Dev/SQLite convenience; production SQL Server should use EF migrations for GlDbContext.
    /// </summary>
    public static async Task InitializeLedgerGlAsync(this IServiceProvider provider, string seededBy = "SYSTEM")
    {
        using var scope = provider.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<GlDbContext>();

        // GlDbContext shares the host's database but is a SEPARATE context, so
        // EnsureCreated (which is all-or-nothing on DATABASE existence) won't create
        // our tables once the host DB already exists — and won't add a new table on
        // upgrade. Instead, run the model's CREATE statements individually, ignoring
        // "already exists" per statement. This is idempotent and upgrade-safe.
        var script = ((RelationalDatabaseCreator)db.GetService<IDatabaseCreator>()).GenerateCreateScript();
        foreach (var raw in script.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            try { await db.Database.ExecuteSqlRawAsync(raw); }
            catch { /* table/index already exists — expected on re-run and partial upgrades */ }
        }

        var svc = sp.GetRequiredService<GlConfigService>();
        await svc.EnsureSeededAsync(sp.GetRequiredService<GlConfiguration>(), seededBy);
        await sp.GetRequiredService<IGlConfigProvider>().ReloadAsync();
    }
}
