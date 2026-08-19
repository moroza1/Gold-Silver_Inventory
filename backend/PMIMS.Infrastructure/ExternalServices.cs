using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PMIMS.Application;
using PMIMS.Domain;

namespace PMIMS.Infrastructure;

// Mock Active Directory integration mapping to AD Groups
// Now backed by AppUser database for group-based privilege management
public class ActiveDirectoryService : IActiveDirectoryService
{
    private readonly AppDbContext _dbContext;

    public ActiveDirectoryService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<(bool success, string? displayName, List<string> roles)> AuthenticateAsync(string username, string password)
    {
        // Try database-backed user lookup first
        var user = await _dbContext.AppUsers
            .Include(u => u.Memberships)
                .ThenInclude(m => m.Group)
            .FirstOrDefaultAsync(u => u.Username == username || u.Email == username);

        if (user != null)
        {
            if (!user.IsActive) return (false, null, new List<string>());

            // Algorithm-aware verification -- accounts provisioned/reset via the
            // FIM SetPassword function may carry BCRYPT or AES256 hashes instead
            // of the legacy SHA-256 demo-seed default (AppUser.PasswordAlgorithm).
            if (!PasswordHasher.Verify(password, user.PasswordHash, user.PasswordAlgorithm))
                return (false, null, new List<string>());

            var roles = user.Memberships
                .Where(m => m.Group != null && m.Group.IsActive)
                .Select(m => m.Group!.GroupName)
                .ToList();

            // Alias the seeded superuser group name to the canonical "IT/Admin" role used
            // by the authorization policies' IsInRole("IT/Admin") superuser bypass
            // (Program.cs) so any member of "IT Administrators" gets it.
            if (roles.Contains("IT Administrators") && !roles.Contains("IT/Admin"))
            {
                roles.Add("IT/Admin");
            }

            return (true, user.DisplayName, roles);
        }

        // NOTE: there used to be a "legacy fallback" here that granted a successful login
        // (including, for any username containing "admin", the IT/Admin superuser role) to
        // ANY username not found in AppUsers, as long as the password was the literal demo
        // string "Password123" -- e.g. "backdoor-admin" or "not-a-real-admin" with that
        // password would authenticate as a full superuser without ever being provisioned.
        // It predates the DB-backed AppUser/PrivilegeGroup model and is redundant with it:
        // every demo login (treasury-maker, treasury-checker, reconciliation-reconciler,
        // system-admin) is seeded as a real AppUser row by DbSeeder and is handled by the
        // lookup above. Do not reintroduce a username-pattern-based authentication bypass.
        return (false, null, new List<string>());
    }

    private static string ComputeSha256(string input)
    {
        using var sha = System.Security.Cryptography.SHA256.Create();
        var bytes = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}

// 360T and IMAL Live rates simulation
public class RateFeedService : IRateFeedService
{
    private readonly Random _rand = new();
    private static readonly HttpClient _httpClient = new HttpClient();

    public async Task<(decimal bid, decimal ask, string source)> GetLiveRatesAsync(string metalName)
    {
        string symbol = metalName.Equals("Silver", StringComparison.OrdinalIgnoreCase) ? "XAG" : "XAU";
        string url = $"https://api.gold-api.com/price/{symbol}";
        
        try
        {
            using var cts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(5));
            var response = await _httpClient.GetAsync(url, cts.Token);
            if (response.IsSuccessStatusCode)
            {
                string jsonString = await response.Content.ReadAsStringAsync(cts.Token);
                using var doc = JsonDocument.Parse(jsonString);
                if (doc.RootElement.TryGetProperty("price", out var priceProp))
                {
                    decimal price = priceProp.GetDecimal();
                    decimal bid = Math.Round(price, 2);
                    decimal ask = Math.Round(bid * 1.0008m, 2);
                    string source = "Gold-API Live Feed";
                    return (bid, ask, source);
                }
            }
        }
        catch (Exception)
        {
            // Fallback to simulation if offline/failed
        }

        // Target operating market hours check (simulate IMAL fallback outside 7:00 AM - 5:00 PM Kuwait Time)
        var kuwaitTime = TimeZoneInfo.ConvertTime(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Arab Standard Time"));
        bool isMarketOpen = kuwaitTime.Hour >= 7 && kuwaitTime.Hour < 17;

        string fallbackSource = isMarketOpen ? "360T Live Feed (Simulated)" : "IMAL Core Rate Fallback (Simulated)";

        decimal baseBid = metalName.Equals("Silver", StringComparison.OrdinalIgnoreCase) ? 28.15m : 2284.50m;
        decimal delta = (decimal)(_rand.NextDouble() - 0.5) * (baseBid * 0.001m);
        decimal bidFallback = Math.Round(baseBid + delta, 2);
        decimal askFallback = Math.Round(bidFallback + (baseBid * 0.0008m), 2);

        return (bidFallback, askFallback, fallbackSource);
    }
}

// ============================================================
// Cost Tracking & Valuation -- Core Banking (IMAL) GL Integration
// ------------------------------------------------------------
// Pushes one journal entry to Core Banking's general ledger for a PMIMS-
// originated financial event (currently: a purchase-order receipt's landed
// cost -- see InventoryRepository.IntakeInventoryItemsAsync). Same
// "adapter, not vendor lock-in" shape as GenericWebhookMonitoringAdapter:
// every attempt is first recorded locally as PENDING, then updated to
// POSTED/FAILED, so core_banking_ledger_postings is a reliable local audit
// trail even if Core Banking/IMAL is unreachable or not yet wired up for
// this environment. When no live endpoint is configured (CoreBanking:
// WebhookUrl), this simulates a successful post rather than leaving the
// entry stuck PENDING/DISABLED -- same "always produce a usable result"
// posture as RateFeedService's live-feed-with-simulated-fallback, since a
// GL posting that never resolves would silently break the cost-tracking
// audit trail this feature exists to provide.
// ============================================================
public class CoreBankingGlAdapter : ICoreBankingLedgerService
{
    private readonly AppDbContext _dbContext;
    private readonly Microsoft.Extensions.Configuration.IConfiguration _config;
    private static readonly HttpClient _httpClient = new HttpClient();

    public CoreBankingGlAdapter(AppDbContext dbContext, Microsoft.Extensions.Configuration.IConfiguration config)
    {
        _dbContext = dbContext;
        _config = config;
    }

    public async Task<CoreBankingLedgerPosting> PostLedgerEntryAsync(string sourceType, int sourceId, string debitAccount, string creditAccount, decimal amount, string currency, string initiatedBy, string? memo = null)
    {
        var posting = new CoreBankingLedgerPosting
        {
            SourceType = sourceType,
            SourceId = sourceId,
            DebitAccount = debitAccount,
            CreditAccount = creditAccount,
            Amount = amount,
            Currency = currency,
            Memo = memo,
            InitiatedBy = initiatedBy,
            StatusCode = "PENDING",
            CreatedAt = DateTime.UtcNow
        };
        _dbContext.CoreBankingLedgerPostings.Add(posting);
        await _dbContext.SaveChangesAsync();

        bool enabled = _config.GetValue<bool?>("CoreBanking:Enabled") ?? false;
        string? webhookUrl = _config.GetValue<string>("CoreBanking:WebhookUrl");

        if (enabled && !string.IsNullOrWhiteSpace(webhookUrl))
        {
            try
            {
                var payload = JsonSerializer.Serialize(new
                {
                    sourceType,
                    sourceId,
                    debitAccount,
                    creditAccount,
                    amount,
                    currency,
                    memo,
                    initiatedBy,
                    postedAt = DateTime.UtcNow
                });
                using var cts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(5));
                var response = await _httpClient.PostAsync(webhookUrl, new StringContent(payload, System.Text.Encoding.UTF8, "application/json"), cts.Token);

                if (response.IsSuccessStatusCode)
                {
                    string body = await response.Content.ReadAsStringAsync(cts.Token);
                    posting.StatusCode = "POSTED";
                    posting.CoreBankingReference = TryExtractReference(body) ?? $"GL-{posting.PostingId}";
                    posting.ResponseMessage = "Accepted by Core Banking GL endpoint.";
                }
                else
                {
                    posting.StatusCode = "FAILED";
                    posting.ResponseMessage = $"Core Banking GL endpoint returned HTTP {(int)response.StatusCode}.";
                }
            }
            catch (Exception ex)
            {
                posting.StatusCode = "FAILED";
                posting.ResponseMessage = $"Core Banking GL endpoint unreachable: {ex.GetType().Name}.";
            }
        }
        else
        {
            // No live Core Banking/IMAL GL endpoint configured for this environment -- accept
            // the posting locally so the cost-tracking audit trail stays complete. Matches the
            // gap-closure doc's stance: IMAL/GL exist as concepts in PMIMS, but a
            // vendor-specific live connection is out of scope for this codebase alone.
            posting.StatusCode = "POSTED";
            posting.CoreBankingReference = $"SIM-GL-{posting.PostingId:D8}";
            posting.ResponseMessage = "Simulated Core Banking (IMAL) GL posting -- no live endpoint configured (see CoreBanking:WebhookUrl in appsettings.json).";
        }

        posting.PostedAt = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync();
        return posting;
    }

    private static string? TryExtractReference(string responseBody)
    {
        try
        {
            using var doc = JsonDocument.Parse(responseBody);
            if (doc.RootElement.TryGetProperty("reference", out var refProp))
            {
                return refProp.GetString();
            }
        }
        catch (Exception)
        {
            // Non-JSON or unexpected shape -- fall back to the caller's own default reference.
        }
        return null;
    }
}

// The real FIM Integration Module implementation (IFimService) now lives in
// its own file, FimService.cs, backed by AppUser/PrivilegeGroup/FimRight/
// FimUserAttribute/FimUserRight/FimSyncLog rather than mock data -- see that
// file for the full identity-provisioning / access-management / password
// implementation covering every function in the RFP's FIM Integration Module.

// ============================================================
// GFS Live Integration Service Emulation (BRD Alignment)
// ============================================================
public class GfsService : IGfsService
{
    private readonly AppDbContext _dbContext;

    public GfsService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<(bool success, string? customerAccount, decimal averageCost)> LookupBarAsync(string serialNumber)
    {
        await Task.Delay(50); // simulate latency

        if (serialNumber.Contains("ERR") || serialNumber.StartsWith("999"))
        {
            return (false, null, 0); // simulated failure
        }
        
        string? customerAccount = "GFS-CUST-88771122";
        decimal averageCost = 62.50m;

        if (serialNumber.Contains("KFH"))
        {
            customerAccount = null;
            averageCost = 59.80m;
        }

        return (true, customerAccount, averageCost);
    }

    public async Task<GfsDeliveryRequest?> GetDeliveryRequestAsync(string gfsRefNumber)
    {
        await Task.Delay(50);
        return await _dbContext.GfsDeliveryRequests
            .Include(r => r.Bar)
            .Include(r => r.DestinationBranch)
            .FirstOrDefaultAsync(r => r.GfsRefNumber == gfsRefNumber);
    }

    public async Task<HomeDeliveryRequest?> GetHomeDeliveryRequestAsync(string deliveryNumber)
    {
        await Task.Delay(50);
        return await _dbContext.HomeDeliveryRequests
            .Include(r => r.Bar)
            .FirstOrDefaultAsync(r => r.DeliveryNumber == deliveryNumber);
    }

    public async Task<(bool success, string? customerName, string? rim, string? accountNo, decimal goldHoldingGrams)> LookupCustomerProfileAsync(string civilIdOrAccount)
    {
        await Task.Delay(50);
        var cust = await _dbContext.Customers.FirstOrDefaultAsync(c => c.CivilId == civilIdOrAccount);
        if (cust != null)
        {
            var acc = await _dbContext.CustomerAccounts.FirstOrDefaultAsync(a => a.CustomerId == cust.CustomerId);
            var holdings = await _dbContext.CustomerHoldings
                .Include(h => h.Item)
                    .ThenInclude(i => i!.Product)
                        .ThenInclude(p => p!.Denomination)
                .Where(h => h.CustomerId == cust.CustomerId && h.StatusCode == "HELD_IN_CUSTODY")
                .ToListAsync();

            decimal totalGrams = holdings.Sum(h => h.Item?.Product?.Denomination?.WeightGrams ?? 0);
            return (true, cust.CustomerName, $"RIM-{cust.CustomerId:D6}", acc?.AccountNumber ?? "ACC-KFH-001", totalGrams);
        }

        return (true, "KFH Gold Investor", "RIM-998822", "KWD-GOLD-INV-8877", 250.0m);
    }

    public async Task<bool> SyncEodDataAsync(List<InventoryItem> items)
    {
        await Task.Delay(100);
        foreach (var item in items)
        {
            var (success, account, cost) = await LookupBarAsync(item.SerialNumber);
            if (success)
            {
                item.CustomerAccountNumber = account;
                item.AveragePurchaseCost = cost;
                item.GfsLastSyncAt = DateTime.UtcNow;
            }
        }
        return true;
    }
}
