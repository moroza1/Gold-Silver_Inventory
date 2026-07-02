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

            // Validate SHA-256 password hash
            string hash = ComputeSha256(password);
            if (hash != user.PasswordHash) return (false, null, new List<string>());

            var roles = user.Memberships
                .Where(m => m.Group != null && m.Group.IsActive)
                .Select(m => m.Group!.GroupName)
                .ToList();

            // Alias the seeded superuser group name to the canonical "IT/Admin" role used
            // by the authorization policies' IsInRole("IT/Admin") superuser bypass
            // (Program.cs) so any member of "IT Administrators" gets it -- not just the
            // hard-coded "system-admin" demo login that happened to satisfy the legacy
            // username-based fallback below.
            if (roles.Contains("IT Administrators") && !roles.Contains("IT/Admin"))
            {
                roles.Add("IT/Admin");
            }

            return (true, user.DisplayName, roles);
        }

        // Legacy fallback for backward compatibility (hard-coded demo accounts)
        if ((username.EndsWith("maker", StringComparison.OrdinalIgnoreCase) || username.Contains("maker", StringComparison.OrdinalIgnoreCase)) && password == "Password123")
        {
            return (true, "KFH Treasury Maker User", new List<string> { "Operations Maker", "Branch Operator" });
        }
        if ((username.EndsWith("checker", StringComparison.OrdinalIgnoreCase) || username.Contains("checker", StringComparison.OrdinalIgnoreCase)) && password == "Password123")
        {
            return (true, "KFH Treasury Checker User", new List<string> { "Operations Checker", "Branch Checker" });
        }
        if ((username.EndsWith("reconciler", StringComparison.OrdinalIgnoreCase) || username.Contains("reconciler", StringComparison.OrdinalIgnoreCase)) && password == "Password123")
        {
            return (true, "KFH Reconciliation Officer", new List<string> { "Reconciliation Officer" });
        }
        if ((username.EndsWith("admin", StringComparison.OrdinalIgnoreCase) || username.Contains("admin", StringComparison.OrdinalIgnoreCase)) && password == "Password123")
        {
            return (true, "KFH Admin User", new List<string> { "IT/Admin" });
        }

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

// FIM Identity Synchronization provisioning API mapping
public class FimService : IFimService
{
    private readonly AppDbContext _dbContext;

    public FimService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<IEnumerable<string>> GetUsersAsync() => 
        await _dbContext.AuditLogs.Select(a => a.Username).Distinct().ToListAsync();

    public async Task<int> GetNumberOfUsersAsync() => 
        (await GetUsersAsync()).Count();

    public async Task<dynamic> GetUserInfoAsync(string username) => 
        new { Username = username, Domain = "kfh.com.kw", LastAction = "Active" };

    public async Task<IEnumerable<string>> GetProfilesAsync() => 
        await _dbContext.UserRoles.Select(r => r.RoleName).ToListAsync();

    public async Task<int> GetNumberOfProfilesAsync() => 
        await _dbContext.UserRoles.CountAsync();

    public async Task<dynamic> GetProfileInfoAsync(string profileName) => 
        await _dbContext.UserRoles.FirstOrDefaultAsync(r => r.RoleName == profileName) ?? new object();

    public async Task<IEnumerable<string>> GetUsersFromProfileAsync(string profileName)
    {
        // AD Mapped query emulation
        return new List<string> { $"mock-{profileName}-user@kfh.com" };
    }

    public async Task<int> GetNumberOfUsersFromProfileAsync(string profileName) => 1;

    public async Task<IEnumerable<string>> GetProfilesFromUserAsync(string username)
    {
        if (username.Contains("maker")) return new[] { "Operations Maker" };
        if (username.Contains("checker")) return new[] { "Operations Checker" };
        return new[] { "Audit/Compliance" };
    }

    public async Task<int> GetNumberOfProfilesFromUserAsync(string username) => 
        (await GetProfilesFromUserAsync(username)).Count();

    public async Task<bool> AddUserAsync(string username, string email, string passwordHash)
    {
        var log = new AuditLog
        {
            Username = "FIM_PROVISIONER",
            IpAddress = "127.0.0.1",
            ModuleName = "FIM_SYNC",
            ActionDescription = $"Created user '{username}' via FIM Provisioning API",
            Timestamp = DateTime.UtcNow
        };
        _dbContext.AuditLogs.Add(log);
        await _dbContext.SaveChangesAsync();
        return true;
    }

    public async Task<bool> AddProfileAsync(string profileName, string description)
    {
        if (await _dbContext.UserRoles.AnyAsync(r => r.RoleName == profileName)) return false;
        
        _dbContext.UserRoles.Add(new UserRole { RoleName = profileName, Description = description });
        await _dbContext.SaveChangesAsync();
        return true;
    }

    public async Task<bool> AddUserToProfileAsync(string username, string profileName)
    {
        await _dbContext.Database.ExecuteSqlRawAsync(
            "INSERT INTO audit_logs (username, ip_address, module_name, action_description) VALUES ({0}, {1}, {2}, {3})",
            "FIM_PROVISIONER", "127.0.0.1", "FIM_SYNC", $"Assigned user '{username}' to role profile '{profileName}'");
        return true;
    }

    public async Task<bool> UpdateProfileInfoAsync(string profileName, string description)
    {
        var role = await _dbContext.UserRoles.FirstOrDefaultAsync(r => r.RoleName == profileName);
        if (role == null) return false;
        role.Description = description;
        await _dbContext.SaveChangesAsync();
        return true;
    }

    public async Task<bool> UpdateUserInfoAsync(string username, string email) => true;

    public async Task<bool> RemoveUserAsync(string username) => true;

    public async Task<bool> RemoveProfileAsync(string profileName)
    {
        var role = await _dbContext.UserRoles.FirstOrDefaultAsync(r => r.RoleName == profileName);
        if (role == null) return false;
        _dbContext.UserRoles.Remove(role);
        await _dbContext.SaveChangesAsync();
        return true;
    }

    public async Task<bool> RemoveUserFromProfileAsync(string username, string profileName) => true;

    // Rights mapping
    public async Task<IEnumerable<string>> GetAllRightsAsync() => 
        await _dbContext.UserPermissions.Select(p => p.PermissionName).Distinct().ToListAsync();

    public async Task<int> GetNumberOfRightsAsync() => 
        (await GetAllRightsAsync()).Count();

    public async Task<dynamic> GetRightInfoAsync(string rightName) => 
        new { Right = rightName, Description = "Dynamic fine-grained system privilege" };

    public async Task<IEnumerable<string>> GetAllRightsForUserAsync(string username)
    {
        if (username.Contains("maker")) return new[] { "po_create", "intake_make", "transfer_make" };
        if (username.Contains("checker")) return new[] { "po_approve", "intake_approve", "transfer_approve" };
        return new[] { "view_dashboard" };
    }

    public async Task<int> GetNumberOfRightsForUserAsync(string username) => 
        (await GetAllRightsForUserAsync(username)).Count();

    public async Task<IEnumerable<string>> GetAllUsersForRightAsync(string rightName) => 
        new[] { "treasury-user@kfh.com", "vault-user@kfh.com" };

    public async Task<int> GetNumberOfUsersForRightAsync(string rightName) => 2;

    public async Task<bool> AddUserToRightAsync(string username, string rightName) => true;

    public async Task<bool> RemoveUserFromRightAsync(string username, string rightName) => true;

    public async Task<IEnumerable<dynamic>> DetectDeltaChangesAsync(DateTime lastSyncTime)
    {
        // Returns audit log revisions since last synchronization to detect changes
        var changes = await _dbContext.AuditLogs
            .Where(a => a.Timestamp > lastSyncTime && a.ModuleName == "FIM_SYNC")
            .ToListAsync();

        return changes.Select(c => new
        {
            Timestamp = c.Timestamp,
            User = c.Username,
            Action = c.ActionDescription
        });
    }
}
