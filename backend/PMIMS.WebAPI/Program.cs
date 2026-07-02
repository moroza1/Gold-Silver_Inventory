using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using PMIMS.Application;
using PMIMS.Infrastructure;

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

// 3. Register Background Task Cleanup Hosted Service
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

// Simple Health Endpoint
app.MapGet("/api/health", () => Results.Ok(new { status = "Healthy", environment = useSqlServer ? "SQL Server" : "SQLite Local Fallback", timestamp = DateTime.UtcNow }));

app.Run();
