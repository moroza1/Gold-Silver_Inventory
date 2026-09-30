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

        // Target operating market hours check (simulate Phoenix fallback outside 7:00 AM - 5:00 PM Kuwait Time)
        var kuwaitTime = TimeZoneInfo.ConvertTime(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Arab Standard Time"));
        bool isMarketOpen = kuwaitTime.Hour >= 7 && kuwaitTime.Hour < 17;

        string fallbackSource = isMarketOpen ? "360T Live Feed (Simulated)" : "Phoenix Core Rate Fallback (Simulated)";

        decimal baseBid = metalName.Equals("Silver", StringComparison.OrdinalIgnoreCase) ? 28.15m : 2284.50m;
        decimal delta = (decimal)(_rand.NextDouble() - 0.5) * (baseBid * 0.001m);
        decimal bidFallback = Math.Round(baseBid + delta, 2);
        decimal askFallback = Math.Round(bidFallback + (baseBid * 0.0008m), 2);

        return (bidFallback, askFallback, fallbackSource);
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

    public async Task<(bool success, string? customerAccount, string? rimNumber, decimal averageCost)> LookupBarAsync(string serialNumber)
    {
        await Task.Delay(50); // simulate latency

        if (serialNumber.Contains("ERR") || serialNumber.StartsWith("999"))
        {
            return (false, null, null, 0); // simulated failure
        }
        
        string? customerAccount = "GFS-CUST-88771122";
        string? rimNumber = "RIM-998822";
        decimal averageCost = 62.50m;

        if (serialNumber.Contains("KFH"))
        {
            customerAccount = null;
            rimNumber = null;
            averageCost = 59.80m;
        }

        return (true, customerAccount, rimNumber, averageCost);
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
            var (success, account, rim, cost) = await LookupBarAsync(item.SerialNumber);
            if (success)
            {
                item.CustomerAccountNumber = account;
                item.CustomerRimNumber = rim;
                item.AveragePurchaseCost = cost;
                item.GfsLastSyncAt = DateTime.UtcNow;
            }
        }
        return true;
    }
}
