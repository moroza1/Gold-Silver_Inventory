using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using PMIMS.Application;
using PMIMS.Infrastructure;
using PMIMS.WebAPI.Realtime;
using Ledger.Gl.EfCore;   // plug-and-play General Ledger module DI extensions
using Serilog;

// Configure Serilog for file logging
var baseDir = AppContext.BaseDirectory;
var logsDir = Path.Combine(Directory.GetCurrentDirectory(), "logs");
var errorLogsDir = Path.Combine(Directory.GetCurrentDirectory(), "ErrorLogs");

try
{
    Directory.CreateDirectory(logsDir);
    Directory.CreateDirectory(errorLogsDir);
    Console.WriteLine($"📝 Standard Logs will be written to: {logsDir}");
    Console.WriteLine($"🚨 Daily Support Error Logs will be written to: {errorLogsDir}");
}
catch (Exception ex)
{
    Console.WriteLine($"❌ Failed to create log directories: {ex.Message}");
}

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .WriteTo.Console()
    .WriteTo.File(
        path: Path.Combine(logsDir, "pmims-.txt"),
        rollingInterval: RollingInterval.Day,
        shared: true,
        outputTemplate: "[{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz}] [{Level:u3}] {Message:lj}{NewLine}{Exception}")
    .WriteTo.File(
        path: Path.Combine(errorLogsDir, "error-.txt"),
        restrictedToMinimumLevel: Serilog.Events.LogEventLevel.Error,
        rollingInterval: RollingInterval.Day,
        shared: true,
        outputTemplate: "==============================================================================={NewLine}TIMESTAMP: [{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz}]{NewLine}LEVEL:     [{Level:u3}]{NewLine}MESSAGE:   {Message:lj}{NewLine}{Exception}==============================================================================={NewLine}")
    .CreateLogger();

try
{
    Log.Information("🚀 PMIMS Backend Starting...");

    var builder = WebApplication.CreateBuilder(args);

    // Add Serilog to the host
    builder.Host.UseSerilog();

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
    builder.Services.AddScoped<IGfsService, GfsService>();
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

    // Plug-and-play double-entry General Ledger module (Ledger.Gl + Ledger.Gl.EfCore).
    // Registers the config (chart of accounts + posting rules), an EF-backed GeneralLedger,
    // and an InventoryEventListener -- all injectable. The GL uses its own bounded-context
    // GlDbContext against the SAME database as AppDbContext, so it never touches PMIMS'
    // mappings. Post inventory transactions to it via the listener (see WIRING.md).
    {
        var glConfigPath = Path.Combine(AppContext.BaseDirectory, "Config", "gl-accounts.gold-silver.json");
        builder.Services.AddLedgerGl(glConfigPath, opt =>
        {
            if (useSqlServer)
                opt.UseSqlServer(dbConfig.GetValue<string>("SqlServerConnection") ?? "");
            else
                opt.UseSqlite(dbConfig.GetValue<string>("SqliteConnection") ?? "Data Source=pmims.db");
        });
    }

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

    // 4. Add MVC Controllers and Session middleware
    builder.Services.AddControllers();
    builder.Services.AddDistributedMemoryCache();
    builder.Services.AddSession(options =>
    {
        options.IdleTimeout = TimeSpan.FromMinutes(20);
        options.Cookie.HttpOnly = true;
        options.Cookie.IsEssential = true;
    });

    // 5. Configure CORS for frontend access (development: allow all origins)
    builder.Services.AddCors(options =>
    {
        options.AddPolicy("AllowAll", policy =>
        {
            policy.AllowAnyOrigin()  // Allow file://, localhost, and any origin for development
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

        // Purchase Orders
        Read("purchase_orders.read", "purchase_orders");
        Write("purchase_orders.write", "purchase_orders");

        // Custody, stocktake, workflows and reports (operational modules)
        Read("custody.read", "custody");
        Write("custody.write", "custody");
        Read("stocktake.read", "stocktake");
        Write("stocktake.write", "stocktake");
        Read("workflows.read", "workflows");
        Read("reports.read", "reports");

        // Spatial map
        Read("spatial_map.read", "spatial_map");
        Write("spatial_map.write", "spatial_map");

        // "pending_actions" is the module that actually governs approving/rejecting
        // a workflow instance assigned to the caller
        Read("pending_actions.read", "pending_actions");
        Write("pending_actions.write", "pending_actions");

        // Missing .read variants for modules that only had .write registered.
        Read("migration.read", "migration");
        Read("vault_location.read", "vault_location");
        Read("master_data.read", "master_data");
        Read("workflow_design.read", "workflow_design");

        // Administrative MANAGE/SETUP modules
        Write("vault_location.write", "vault_location");
        Write("master_data.write", "master_data");
        Write("workflow_design.write", "workflow_design");

        // Intake module policies
        Read("intake.read", "intake");
        Write("intake.write", "intake");

        // Rules Engine and Monitoring
        Read("rules_engine.read", "rules_engine");
        Write("rules_engine.write", "rules_engine");
        Read("monitoring.read", "monitoring");
        Write("monitoring.write", "monitoring");

        // Notifications, Dispensing and Device Integration
        Read("notifications.read", "notifications");
        Write("notifications.write", "notifications");
        Read("dispensing.read", "dispensing");
        Write("dispensing.write", "dispensing");
        Read("device_integration.read", "device_integration");
        Write("device_integration.write", "device_integration");

        // Reports write
        Write("reports.write", "reports");

        // Barcode/QR Code Tracking
        Read("barcode_qr_labeling.read", "barcode_qr_labeling");
        Write("barcode_qr_labeling.write", "barcode_qr_labeling");

        // Settings module
        Read("settings.read", "settings");
        Write("settings.write", "settings");
    });

    var app = builder.Build();

    // 6. Database Creation & Seeding Lifecycle
    using (var scope = app.Services.CreateScope())
    {
        try
        {
            var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Console.WriteLine("🔄 Creating database...");
            await context.Database.EnsureCreatedAsync();
            Console.WriteLine("✅ Database created/verified");

            Console.WriteLine("🔄 Seeding data...");
            await DbSeeder.SeedAsync(context);
            Console.WriteLine("✅ Database seeded successfully");

            // Top up module permissions on already-seeded databases so a newly-added
            // admin module (e.g. gl_config) becomes visible after a restart without a
            // full reseed. Idempotent; no-op on a fresh DB just seeded above.
            Console.WriteLine("🔄 Ensuring module permissions are up to date...");
            await DbSeeder.EnsureModulePermissionsAsync(context);
            Console.WriteLine("✅ Module permissions verified");

            // Create the General Ledger tables (gl_journal_*, gl_config_versions) in the
            // same database, seed the initial ACTIVE config version from the JSON file, and
            // load it into the hot config provider. Dev/SQLite convenience; production SQL
            // Server should use EF migrations for GlDbContext.
            Console.WriteLine("🔄 Initializing General Ledger (schema + active config)...");
            await app.Services.InitializeLedgerGlAsync("SYSTEM");
            Console.WriteLine("✅ General Ledger initialized");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"❌ Database error: {ex.Message}");
            Console.WriteLine($"Stack: {ex.StackTrace}");
            throw;
        }
    }

    // 7. Request Pipeline Setup
    app.UseCors("AllowAll");

    // Global Error & Exception Logging Middleware for Support Team
    app.Use(async (context, next) =>
    {
        try
        {
            await next();
            if (context.Response.StatusCode >= 500)
            {
                Log.Error("🚨 HTTP {StatusCode} SERVER ERROR: {Method} {Path}{Query} [User: {User}] [Client IP: {RemoteIp}]",
                    context.Response.StatusCode,
                    context.Request.Method,
                    context.Request.Path,
                    context.Request.QueryString,
                    context.User.Identity?.Name ?? "Anonymous",
                    context.Connection.RemoteIpAddress?.ToString() ?? "Unknown");
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "🚨 UNHANDLED SERVER EXCEPTION: {Method} {Path}{Query} [User: {User}] [Client IP: {RemoteIp}]",
                context.Request.Method,
                context.Request.Path,
                context.Request.QueryString,
                context.User.Identity?.Name ?? "Anonymous",
                context.Connection.RemoteIpAddress?.ToString() ?? "Unknown");

            if (!context.Response.HasStarted)
            {
                context.Response.StatusCode = 500;
                context.Response.ContentType = "application/json";
                var errorPayload = new
                {
                    error = ex.InnerException?.Message ?? ex.Message,
                    type = ex.GetType().Name,
                    path = context.Request.Path.Value,
                    timestamp = DateTime.UtcNow
                };
                await context.Response.WriteAsync(System.Text.Json.JsonSerializer.Serialize(errorPayload));
            }
        }
    });

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

    Log.Information("✅ PMIMS Backend Started Successfully");
    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "❌ PMIMS Backend terminated unexpectedly");
}
finally
{
    Log.CloseAndFlush();
}
