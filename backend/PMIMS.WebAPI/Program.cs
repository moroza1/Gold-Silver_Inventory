using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using PMIMS.Application;
using PMIMS.Infrastructure;
using PMIMS.WebAPI.Realtime;

var builder = WebApplication.CreateBuilder(args);

// 1. Load Custom Database Configurations
var dbConfig = builder.Configuration.GetSection("DatabaseConfig");
bool useSqlServer = dbConfig.GetValue<bool>("UseSqlServer");

builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (useSqlServer)
    {
        string connectionString = dbConfig.GetValue<string>("SqlServerConnection") ?? "";
        options.UseSqlServer(connectionString, b => b.MigrationsAssembly("PMIMS.Infrastructure"));
    }
    else
    {
        string connectionString = dbConfig.GetValue<string>("SqliteConnection") ?? "Data Source=pmims.db";
        options.UseSqlite(connectionString, b => b.MigrationsAssembly("PMIMS.Infrastructure"));
    }
});

// 2. Register Application & Infrastructure Services
builder.Services.AddScoped<IInventoryRepository, InventoryRepository>();
builder.Services.AddScoped<IActiveDirectoryService, ActiveDirectoryService>();
builder.Services.AddScoped<IFimService, FimService>();
builder.Services.AddScoped<IRateFeedService, RateFeedService>();
builder.Services.AddScoped<IReconciliationService, ReconciliationService>();
builder.Services.AddScoped<IBulkMigrationService, BulkMigrationService>();

// 2a. RFP items 5-8: Rules Engine, Enhanced Audit Trail export, Email
// Notifications, KFH Monitoring Integration.
builder.Services.AddScoped<IRuleEngineService, RuleEngineService>();
builder.Services.AddScoped<IAuditExportService, AuditExportService>();
builder.Services.AddScoped<IEmailSenderService, EmailSenderService>();
builder.Services.AddScoped<IMonitoringAdapter, GenericWebhookMonitoringAdapter>();
// Cost Tracking & Valuation -- Core Banking (IMAL) GL Integration (pushes purchase-order
// receipt landed-cost journal entries; see InventoryRepository.IntakeInventoryItemsAsync).
builder.Services.AddScoped<ICoreBankingLedgerService, CoreBankingGlAdapter>();
// Item 7 extension -- immediate event-triggered notifications (transfer completed,
// inventory discrepancy found), shared by ReconciliationService and PMIMSControllers.
builder.Services.AddScoped<INotificationDispatchService, NotificationDispatchService>();

// Barcode/QR Code Tracking (RFP Section 3) -- GS1-128 + ISO/IEC 18004 label generation.
builder.Services.AddScoped<IBarcodeLabelService, BarcodeLabelService>();

// 2b. Real-Time Inventory Monitoring (precious-metal quantities & movements --
// to/from main vault, between branches, and with customers). AppDbContext pushes
// through this notifier from a single choke point in SaveChangesAsync; see
// PMIMS.Infrastructure/AppDbContext.cs and PMIMS.WebAPI/Realtime/*.
builder.Services.AddSignalR();
builder.Services.AddScoped<IInventoryMonitoringNotifier, SignalRInventoryMonitoringNotifier>();

// QuestPDF (used by AuditExportService) requires the license type to be set once at
// startup. LICENSING NOTE: Community is free only under $1M USD annual gross revenue --
// KFH will need a Commercial license before production use (see PMIMS.Infrastructure.csproj).
QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;

// 3. Register Background Task Cleanup Hosted Services
builder.Services.AddHostedService<ReservationCleanupService>();
builder.Services.AddHostedService<NotificationSchedulerService>();

// 4. Add MVC Controllers and Session middleware
builder.Services.AddControllers();
builder.Services.AddDistributedMemoryCache();
builder.Services.AddSession(options =>
{
    options.IdleTimeout = TimeSpan.FromMinutes(20);
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true;
});

// 5. Configure CORS for frontend access
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// 5a. JWT Bearer authentication
var jwtSection = builder.Configuration.GetSection("Jwt");
var jwtKey = jwtSection.GetValue<string>("Key") ?? "dev-only-pmims-signing-key-change-me-32+chars-minimum-0123456789";
var jwtIssuer = jwtSection.GetValue<string>("Issuer") ?? "KFH-PMIMS";
var jwtAudience = jwtSection.GetValue<string>("Audience") ?? "KFH-PMIMS-Client";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ClockSkew = TimeSpan.FromMinutes(1)
        };

        // SignalR's browser client can't set an Authorization header on the WebSocket/SSE
        // upgrade request, so it sends the JWT as an "access_token" query string parameter
        // instead (standard ASP.NET Core SignalR pattern). Only honor that for the
        // real-time monitoring hub path -- every normal REST call still must use the
        // Authorization header.
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(accessToken) && context.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            }
        };
    });

// 5b. Authorization policies (Phase 1 -- module-key + write-level enforcement).
// A grant of FULL or READ_WRITE on a module = write authority. IT/Admin is a superuser.
// Read policies require any non-HIDDEN grant on the module (or IT/Admin).
builder.Services.AddAuthorization(options =>
{
    static bool HasWrite(ClaimsPrincipal u, string moduleKey)
    {
        if (u.IsInRole("IT/Admin")) return true;
        var level = u.FindFirst("perm:" + moduleKey)?.Value;
        return level is "FULL" or "READ_WRITE";
    }
    static bool CanRead(ClaimsPrincipal u, string moduleKey)
    {
        if (u.IsInRole("IT/Admin")) return true;
        var level = u.FindFirst("perm:" + moduleKey)?.Value;
        return !string.IsNullOrEmpty(level) && level != "HIDDEN";
    }

    void Write(string policy, string moduleKey) =>
        options.AddPolicy(policy, p => p.RequireAssertion(ctx => HasWrite(ctx.User, moduleKey)));
    void Read(string policy, string moduleKey) =>
        options.AddPolicy(policy, p => p.RequireAssertion(ctx => CanRead(ctx.User, moduleKey)));

    Read("user_admin.read", "user_admin");
    Write("user_admin.write", "user_admin");
    Write("migration.write", "migration");

    // "dashboard" -- the module was seeded with a permission level for every role (RO for
    // Maker/Checker/Recon, FULL for IT/Admin) but had no registered policy anywhere, so it
    // was purely decorative: GET /api/dashboard/executive-board had no [Authorize] at all
    // (fully anonymous) and /api/dashboard/my-activity only required plain [Authorize]. Give
    // the executive board a real read gate; "my-activity" intentionally stays a personal
    // any-authenticated-user read (see comment at that endpoint), not a module-level one.
    Read("dashboard.read", "dashboard");

    // Purchase orders (operational module) -- was missing, which left the
    // create/update PO endpoints unprotected regardless of the caller's
    // GroupPermission level (e.g. Treasury Operations (Checker) = READ_ONLY).
    Read("purchase_orders.read", "purchase_orders");
    Write("purchase_orders.write", "purchase_orders");

    // Custody, stocktake, workflows and reports (operational modules) -- also
    // had no policy registered at all, leaving their write endpoints (stock
    // transfers, reservations, purchases, withdrawals, stocktake sessions,
    // workflow approve/reject) and read endpoints (reports, holdings, active
    // workflow instances) fully open to anonymous callers.
    Read("custody.read", "custody");
    Write("custody.write", "custody");
    Read("stocktake.read", "stocktake");
    Write("stocktake.write", "stocktake");
    Read("workflows.read", "workflows");
    Read("reports.read", "reports");

    // "pending_actions" is the module that actually governs approving/rejecting
    // a workflow instance assigned to the caller (Treasury Operations (Checker)
    // and Reconciliation Officers are FULL here; "workflows" itself is READ_ONLY
    // for everyone but IT/Admin -- it's just the browse/list view).
    Read("pending_actions.read", "pending_actions");
    Write("pending_actions.write", "pending_actions");

    // Missing .read variants for modules that only had .write registered.
    Read("migration.read", "migration");
    Read("vault_location.read", "vault_location");
    Read("master_data.read", "master_data");
    Read("workflow_design.read", "workflow_design");

    // Phase 2/3 -- administrative MANAGE/SETUP modules, distinct from the
    // operational VIEW modules of the same data.
    Write("vault_location.write", "vault_location");
    Write("master_data.write", "master_data");
    Write("workflow_design.write", "workflow_design");

    // Intake module policies
    Read("intake.read", "intake");
    Write("intake.write", "intake");

    // RFP items 5-8. Rules Engine and Notifications are administrative/governance
    // modules (rule authoring, distribution-list configuration are sensitive --
    // same tier as workflow_design/master_data). Monitoring alert-route config is
    // likewise admin-tier; GET /api/health/detailed and the existing GET /api/health
    // stay anonymous since external monitoring tools poll them without a user JWT.
    Read("rules_engine.read", "rules_engine");
    Write("rules_engine.write", "rules_engine");
    Read("notifications.read", "notifications");
    Write("notifications.write", "notifications");
    Read("monitoring.read", "monitoring");
    Write("monitoring.write", "monitoring");

    // "reports" previously only had a .read policy (the report views themselves are
    // read-only). Generating a persisted IFRS valuation disclosure snapshot is a write
    // action layered on the same module -- gate it so only roles with FULL on `reports`
    // (Reconciliation Officers, IT/Admin) can produce a disclosure of record, while
    // everyone with reports.read can still list/view previously generated ones.
    Write("reports.write", "reports");

    // Gold Dispensing Machine (GDM) integration -- scalability hook (RFP-adjacent
    // enhancement). `dispensing` is the operational module (view/operate dispense
    // transactions, mirrors intake/custody); `device_integration` is the administrative
    // module that governs registering/decommissioning physical machines, same tier as
    // vault_location/master_data.
    Read("dispensing.read", "dispensing");
    Write("dispensing.write", "dispensing");
    Read("device_integration.read", "device_integration");
    Write("device_integration.write", "device_integration");

    // Barcode/QR Code Tracking (RFP Section 3) -- generating/printing GS1-128 + QR
    // labels is an operational task (same tier as intake/dispensing); the write side
    // is only used to log a "label printed" chain-of-custody event, not to mutate
    // the label content itself (labels are derived/computed, never stored).
    Read("barcode_qr_labeling.read", "barcode_qr_labeling");
    Write("barcode_qr_labeling.write", "barcode_qr_labeling");

    // "settings" module key existed in the seed data (DbSeeder) and the frontend's
    // MODULE_KEYS catalog, but had no registered policy anywhere -- decorative like
    // "dashboard" used to be. Backs the sidebar menu-layout write endpoint (arranging
    // the nav order is a system-wide administrative change, same tier as
    // vault_location/master_data/rules_engine). The read side of the menu layout is
    // intentionally a plain any-authenticated-user [Authorize] (every user needs the
    // current order to render their own sidebar), not gated by settings.read.
    Read("settings.read", "settings");
    Write("settings.write", "settings");
});

var app = builder.Build();

// 6. Database Creation & Seeding Lifecycle
using (var scope = app.Services.CreateScope())
{
    var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await context.Database.EnsureCreatedAsync();
    await DbSeeder.SeedAsync(context);
}

// 7. Request Pipeline Setup
app.UseCors("AllowAll");
app.UseSession();
app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

// Real-Time Inventory Monitoring hub (precious-metal quantities & movements).
// Gated by the `reports.read` policy on the hub class itself (see
// PMIMS.WebAPI/Realtime/InventoryMonitoringHub.cs).
app.MapHub<InventoryMonitoringHub>("/hubs/inventory-monitoring");

// Simple Health Endpoint
app.MapGet("/api/health", () => Results.Ok(new { status = "Healthy", environment = useSqlServer ? "SQL Server" : "SQLite Local Fallback", timestamp = DateTime.UtcNow }));

app.Run();
