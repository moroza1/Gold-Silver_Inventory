using Microsoft.EntityFrameworkCore;

namespace Ledger.Gl.EfCore;

// ============================================================================
// A small, self-contained bounded-context DbContext for JUST the GL tables. It
// runs against the SAME physical database as the host (share the connection
// string) but does NOT touch the host's DbContext (e.g. PMIMS AppDbContext), so
// wiring the GL in never risks the host's mappings/migrations. Two tables only:
// gl_journal_entries and gl_journal_lines. Naming/index style mirrors PMIMS
// (snake_case ToTable, explicit HasIndex).
// ============================================================================
public sealed class GlDbContext : DbContext
{
    public GlDbContext(DbContextOptions<GlDbContext> options) : base(options) { }

    public DbSet<GlJournalEntryRecord> JournalEntries => Set<GlJournalEntryRecord>();
    public DbSet<GlJournalLineRecord> JournalLines => Set<GlJournalLineRecord>();
    public DbSet<GlConfigVersionRecord> ConfigVersions => Set<GlConfigVersionRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<GlJournalEntryRecord>(e =>
        {
            e.HasKey(x => x.Id);
            e.ToTable("gl_journal_entries");

            // The hash-chain integrity guard: no two entries may share a sequence
            // number. Under concurrent posts the second insert fails here and the
            // caller rebuilds+retries (see EfLedgerStore / GeneralLedger notes).
            e.HasIndex(x => x.SequenceNumber).IsUnique();
            e.HasIndex(x => x.EntryId).IsUnique();
            // Idempotency: at most one entry per external key (filtered so many
            // NULLs are allowed on providers that support filtered indexes).
            e.HasIndex(x => x.ExternalKey).IsUnique().HasFilter("[ExternalKey] IS NOT NULL");
            e.HasIndex(x => new { x.SourceType, x.SourceId }); // origin trace-back
            e.HasIndex(x => x.OccurredAtUtc);                  // date-range reports

            e.Property(x => x.EntryId).HasMaxLength(64);
            e.Property(x => x.EntryHash).HasMaxLength(64);
            e.Property(x => x.PreviousHash).HasMaxLength(64);
            e.Property(x => x.Currency).HasMaxLength(8);

            e.HasMany(x => x.Lines)
             .WithOne(l => l.Entry!)
             .HasForeignKey(l => l.EntryId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<GlJournalLineRecord>(l =>
        {
            l.HasKey(x => x.Id);
            l.ToTable("gl_journal_lines");
            l.HasIndex(x => x.EntryId);
            l.HasIndex(x => x.AccountCode);                    // per-account balance queries
            // 18,4 handles precious-metal money values comfortably; adjust per host.
            l.Property(x => x.Amount).HasPrecision(18, 4);
            l.Property(x => x.Side).HasMaxLength(8);
        });

        modelBuilder.Entity<GlConfigVersionRecord>(v =>
        {
            v.HasKey(x => x.VersionId);
            v.ToTable("gl_config_versions");
            v.HasIndex(x => x.VersionNumber).IsUnique();
            v.HasIndex(x => x.Status);                         // fast lookup of the single ACTIVE row
            v.Property(x => x.Status).HasMaxLength(20);
        });
    }
}
