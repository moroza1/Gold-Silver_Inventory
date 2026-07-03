using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
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

// The real FIM Integration Module implementation (IFimService) now lives in
// its own file, FimService.cs, backed by AppUser/PrivilegeGroup/FimRight/
// FimUserAttribute/FimUserRight/FimSyncLog rather than mock data -- see that
// file for the full identity-provisioning / access-management / password
// implementation covering every function in the RFP's FIM Integration Module.
