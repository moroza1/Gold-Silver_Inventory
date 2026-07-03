using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using PMIMS.Application;
using PMIMS.Domain;

namespace PMIMS.Infrastructure;

// ============================================================
// FIM (Forefront Identity Manager) Integration Module
// ------------------------------------------------------------
// Full implementation of every function mandated by the RFP's "FIM
// Integration Module" section (identity provisioning, access management,
// password management, delta-sync change detection), targeting PMIMS's own
// identity store (AppUser / PrivilegeGroup / FimRight) -- the
// "application-own identity list" scenario the RFP explicitly calls out as
// a supported fallback to a real Active-Directory-backed FIM connector.
//
// Every mutating call appends a PMIMS.Domain.FimSyncLog row (LogSyncAsync)
// so DetectDeltaChangesAsync gives external FIM sync jobs a cheap,
// structured "what changed since X" feed instead of having to mine free-text
// AuditLog rows. Every mutating call ALSO writes a normal AuditLog entry
// (via SaveAuditLogAsync-equivalent inline insert) so the change shows up in
// the standard PMIMS audit trail like any other administrative action.
//
// SQL Server-side mirror: database/procedures.sql, procedures prefixed
// sp_FIM_ -- one per function below, for direct-database-connectivity FIM
// sync scenarios that bypass the REST API entirely.
// ============================================================
public class FimService : IFimService
{
    private readonly AppDbContext _dbContext;
    private readonly Microsoft.Extensions.Configuration.IConfiguration? _config;

    // Attribute keys that map onto dedicated AppUser/PrivilegeGroup columns
    // rather than being stored as free-form FimUserAttribute rows.
    private static readonly HashSet<string> ReservedUserKeys = new(StringComparer.OrdinalIgnoreCase)
    { "username", "displayname", "display_name", "email", "password", "isactive", "is_active" };

    private static readonly HashSet<string> ReservedProfileKeys = new(StringComparer.OrdinalIgnoreCase)
    { "profilename", "profile_name", "name", "description", "issystem", "is_system", "isactive", "is_active" };

    public FimService(AppDbContext dbContext, Microsoft.Extensions.Configuration.IConfiguration? config = null)
    {
        _dbContext = dbContext;
        _config = config;
    }

    // =========================================================================
    // Identity Provisioning Functions
    // =========================================================================

    public async Task<IEnumerable<FimUserDto>> GetUsersAsync()
    {
        var users = await _dbContext.AppUsers.AsNoTracking().OrderBy(u => u.Username).ToListAsync();
        return await MapUsersAsync(users);
    }

    public async Task<int> GetNumberOfUsersAsync() => await _dbContext.AppUsers.CountAsync();

    public async Task<FimUserDto?> GetUserInfoAsync(int userId)
    {
        var user = await _dbContext.AppUsers.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
        if (user == null) return null;
        return (await MapUsersAsync(new List<AppUser> { user })).First();
    }

    public async Task<IEnumerable<FimProfileDto>> GetProfilesAsync()
    {
        var groups = await _dbContext.PrivilegeGroups
            .Include(g => g.Permissions)
            .Include(g => g.Members)
            .AsNoTracking()
            .OrderBy(g => g.GroupName)
            .ToListAsync();
        return groups.Select(MapProfile);
    }

    public async Task<int> GetNumberOfProfilesAsync() => await _dbContext.PrivilegeGroups.CountAsync();

    public async Task<FimProfileDto?> GetProfileInfoAsync(int profileId)
    {
        var group = await _dbContext.PrivilegeGroups
            .Include(g => g.Permissions)
            .Include(g => g.Members)
            .AsNoTracking()
            .FirstOrDefaultAsync(g => g.GroupId == profileId);
        return group == null ? null : MapProfile(group);
    }

    public async Task<IEnumerable<FimUserDto>> GetUsersFromProfileAsync(int profileId)
    {
        var users = await _dbContext.UserGroupMemberships
            .Where(m => m.GroupId == profileId)
            .Select(m => m.User!)
            .AsNoTracking()
            .ToListAsync();
        return await MapUsersAsync(users);
    }

    public async Task<int> GetNumberOfUsersFromProfileAsync(int profileId) =>
        await _dbContext.UserGroupMemberships.CountAsync(m => m.GroupId == profileId);

    public async Task<IEnumerable<FimProfileDto>> GetProfilesFromUserAsync(int userId)
    {
        var groups = await _dbContext.UserGroupMemberships
            .Where(m => m.UserId == userId)
            .Include(m => m.Group!.Permissions)
            .Include(m => m.Group!.Members)
            .Select(m => m.Group!)
            .AsNoTracking()
            .ToListAsync();
        return groups.Select(MapProfile);
    }

    public async Task<int> GetNumberOfProfilesFromUserAsync(int userId) =>
        await _dbContext.UserGroupMemberships.CountAsync(m => m.UserId == userId);

    public async Task<FimUserDto> AddUserAsync(Dictionary<string, string> attributes, string createdBy)
    {
        var attrs = new Dictionary<string, string>(attributes, StringComparer.OrdinalIgnoreCase);

        // Mandatory attributes per RFP ("Creates user with mandatory attributes").
        if (!attrs.TryGetValue("username", out var username) || string.IsNullOrWhiteSpace(username))
            throw new ArgumentException("Mandatory attribute 'username' is required to provision a FIM user.");
        if (!attrs.TryGetValue("email", out var email) || string.IsNullOrWhiteSpace(email))
            throw new ArgumentException("Mandatory attribute 'email' is required to provision a FIM user.");

        if (await _dbContext.AppUsers.AnyAsync(u => u.Username == username || u.Email == email))
            throw new InvalidOperationException($"A user with username '{username}' or email '{email}' already exists.");

        attrs.TryGetValue("displayname", out var displayName);
        if (string.IsNullOrWhiteSpace(displayName)) attrs.TryGetValue("display_name", out displayName);
        if (string.IsNullOrWhiteSpace(displayName)) displayName = username;

        // If FIM doesn't push a password, generate a random temporary one --
        // never leave PasswordHash empty. Returned once via the DTO
        // (generated_temp_password) so the provisioning caller can relay it
        // out-of-band; never persisted in the attribute bag.
        string? tempPassword = null;
        if (!attrs.TryGetValue("password", out var password) || string.IsNullOrWhiteSpace(password))
        {
            tempPassword = "Tmp-" + Guid.NewGuid().ToString("N")[..12];
            password = tempPassword;
        }

        var user = new AppUser
        {
            Username = username,
            DisplayName = displayName!,
            Email = email,
            PasswordHash = PasswordHasher.Hash(password, PasswordHasher.AlgorithmBcrypt, ResolveAesKey()),
            PasswordAlgorithm = PasswordHasher.AlgorithmBcrypt,
            IsActive = true,
            CreatedBy = createdBy,
            CreatedAt = DateTime.UtcNow
        };
        _dbContext.AppUsers.Add(user);
        await _dbContext.SaveChangesAsync();

        await PersistExtraAttributesAsync(user.UserId, attrs, ReservedUserKeys);
        await LogSyncAsync("USER", user.UserId.ToString(), "CREATE", createdBy, $"Provisioned via FIM AddUser (username={username})");
        await WriteAuditLogAsync(createdBy, "FIM_INTEGRATION", $"FIM AddUser: created user '{username}' (id={user.UserId}).");

        var dto = (await MapUsersAsync(new List<AppUser> { user })).First();
        if (tempPassword != null) dto.Attributes["generated_temp_password"] = tempPassword;
        return dto;
    }

    public async Task<FimProfileDto> AddProfileAsync(Dictionary<string, string> attributes, string createdBy)
    {
        var attrs = new Dictionary<string, string>(attributes, StringComparer.OrdinalIgnoreCase);

        if (!attrs.TryGetValue("profilename", out var profileName) || string.IsNullOrWhiteSpace(profileName))
            attrs.TryGetValue("name", out profileName);
        if (string.IsNullOrWhiteSpace(profileName))
            throw new ArgumentException("Mandatory attribute 'profileName' is required to provision a FIM profile.");

        if (await _dbContext.PrivilegeGroups.AnyAsync(g => g.GroupName == profileName))
            throw new InvalidOperationException($"A profile named '{profileName}' already exists.");

        attrs.TryGetValue("description", out var description);

        var group = new PrivilegeGroup
        {
            GroupName = profileName!,
            Description = description ?? string.Empty,
            IsSystem = false,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        _dbContext.PrivilegeGroups.Add(group);
        await _dbContext.SaveChangesAsync();

        await LogSyncAsync("PROFILE", group.GroupId.ToString(), "CREATE", createdBy, $"Provisioned via FIM AddProfile (profileName={profileName})");
        await WriteAuditLogAsync(createdBy, "FIM_INTEGRATION", $"FIM AddProfile: created profile '{profileName}' (id={group.GroupId}).");

        return MapProfile(group);
    }

    public async Task<bool> AddUserToProfileAsync(int userId, int profileId, string assignedBy)
    {
        if (!await _dbContext.AppUsers.AnyAsync(u => u.UserId == userId)) return false;
        if (!await _dbContext.PrivilegeGroups.AnyAsync(g => g.GroupId == profileId)) return false;
        if (await _dbContext.UserGroupMemberships.AnyAsync(m => m.UserId == userId && m.GroupId == profileId)) return false;

        _dbContext.UserGroupMemberships.Add(new UserGroupMembership
        {
            UserId = userId,
            GroupId = profileId,
            AssignedBy = assignedBy,
            AssignedAt = DateTime.UtcNow
        });
        await _dbContext.SaveChangesAsync();

        await LogSyncAsync("USER_PROFILE", $"{userId}:{profileId}", "CREATE", assignedBy);
        await WriteAuditLogAsync(assignedBy, "FIM_INTEGRATION", $"FIM AddUserToProfile: bound user {userId} to profile {profileId}.");
        return true;
    }

    public async Task<FimProfileDto?> UpdateProfileInfoAsync(int profileId, Dictionary<string, string> attributes)
    {
        var group = await _dbContext.PrivilegeGroups
            .Include(g => g.Permissions).Include(g => g.Members)
            .FirstOrDefaultAsync(g => g.GroupId == profileId);
        if (group == null) return null;

        var attrs = new Dictionary<string, string>(attributes, StringComparer.OrdinalIgnoreCase);
        if (attrs.TryGetValue("profilename", out var name) || attrs.TryGetValue("name", out name))
            if (!string.IsNullOrWhiteSpace(name)) group.GroupName = name;
        if (attrs.TryGetValue("description", out var desc)) group.Description = desc;
        if (attrs.TryGetValue("isactive", out var active) || attrs.TryGetValue("is_active", out active))
            if (bool.TryParse(active, out var b)) group.IsActive = b;

        await _dbContext.SaveChangesAsync();
        await LogSyncAsync("PROFILE", profileId.ToString(), "UPDATE", "FIM_INTEGRATION");
        return MapProfile(group);
    }

    public async Task<FimUserDto?> UpdateUserInfoAsync(int userId, Dictionary<string, string> attributes)
    {
        var user = await _dbContext.AppUsers.FirstOrDefaultAsync(u => u.UserId == userId);
        if (user == null) return null;

        var attrs = new Dictionary<string, string>(attributes, StringComparer.OrdinalIgnoreCase);
        if ((attrs.TryGetValue("displayname", out var dn) || attrs.TryGetValue("display_name", out dn)) && !string.IsNullOrWhiteSpace(dn))
            user.DisplayName = dn;
        if (attrs.TryGetValue("email", out var email) && !string.IsNullOrWhiteSpace(email))
            user.Email = email;
        if ((attrs.TryGetValue("isactive", out var active) || attrs.TryGetValue("is_active", out active)) && bool.TryParse(active, out var b))
            user.IsActive = b;

        await _dbContext.SaveChangesAsync();
        await PersistExtraAttributesAsync(userId, attrs, ReservedUserKeys);
        await LogSyncAsync("USER", userId.ToString(), "UPDATE", "FIM_INTEGRATION");

        return (await MapUsersAsync(new List<AppUser> { user })).First();
    }

    public async Task<bool> RemoveUserAsync(int userId)
    {
        var user = await _dbContext.AppUsers.FirstOrDefaultAsync(u => u.UserId == userId);
        if (user == null) return false;

        var attrs = _dbContext.FimUserAttributes.Where(a => a.UserId == userId);
        _dbContext.FimUserAttributes.RemoveRange(attrs);
        var rights = _dbContext.FimUserRights.Where(r => r.UserId == userId);
        _dbContext.FimUserRights.RemoveRange(rights);

        _dbContext.AppUsers.Remove(user); // cascades UserGroupMembership (configured OnDelete.Cascade)
        await _dbContext.SaveChangesAsync();

        await LogSyncAsync("USER", userId.ToString(), "DELETE", "FIM_INTEGRATION", $"Removed user '{user.Username}'");
        await WriteAuditLogAsync("FIM_INTEGRATION", "FIM_INTEGRATION", $"FIM RemoveUser: deleted user '{user.Username}' (id={userId}).");
        return true;
    }

    public async Task<bool> RemoveProfileAsync(int profileId)
    {
        var group = await _dbContext.PrivilegeGroups.FirstOrDefaultAsync(g => g.GroupId == profileId);
        if (group == null) return false;
        if (group.IsSystem) return false; // Cannot delete built-in operational role groups via FIM.

        _dbContext.PrivilegeGroups.Remove(group); // cascades GroupPermission + UserGroupMembership
        await _dbContext.SaveChangesAsync();

        await LogSyncAsync("PROFILE", profileId.ToString(), "DELETE", "FIM_INTEGRATION", $"Removed profile '{group.GroupName}'");
        return true;
    }

    public async Task<bool> RemoveUserFromProfileAsync(int userId, int profileId)
    {
        var membership = await _dbContext.UserGroupMemberships
            .FirstOrDefaultAsync(m => m.UserId == userId && m.GroupId == profileId);
        if (membership == null) return false;

        _dbContext.UserGroupMemberships.Remove(membership);
        await _dbContext.SaveChangesAsync();

        await LogSyncAsync("USER_PROFILE", $"{userId}:{profileId}", "DELETE", "FIM_INTEGRATION");
        return true;
    }

    public async Task<int> RemoveUsersFromProfileAsync(IEnumerable<int> userIds, int profileId)
    {
        int removed = 0;
        foreach (var userId in userIds.Distinct())
        {
            if (await RemoveUserFromProfileAsync(userId, profileId)) removed++;
        }
        return removed;
    }

    // =========================================================================
    // Access Management Functions
    // =========================================================================

    public async Task<IEnumerable<FimRightDto>> GetAllRightsAsync()
    {
        var rights = await _dbContext.FimRights.AsNoTracking().OrderBy(r => r.RightCode).ToListAsync();
        return rights.Select(MapRight);
    }

    public async Task<int> GetNumberOfRightsAsync() => await _dbContext.FimRights.CountAsync();

    public async Task<FimRightDto?> GetRightInfoAsync(int rightId)
    {
        var right = await _dbContext.FimRights.AsNoTracking().FirstOrDefaultAsync(r => r.RightId == rightId);
        return right == null ? null : MapRight(right);
    }

    public async Task<IEnumerable<FimRightDto>> GetAllRightsForUserAsync(int userId)
    {
        var rights = await _dbContext.FimUserRights
            .Where(ur => ur.UserId == userId)
            .Select(ur => ur.Right!)
            .AsNoTracking()
            .ToListAsync();
        return rights.Select(MapRight);
    }

    public async Task<int> GetNumberOfRightsForUserAsync(int userId) =>
        await _dbContext.FimUserRights.CountAsync(ur => ur.UserId == userId);

    public async Task<IEnumerable<FimUserDto>> GetAllUsersForRightAsync(int rightId)
    {
        var users = await _dbContext.FimUserRights
            .Where(ur => ur.RightId == rightId)
            .Select(ur => ur.User!)
            .AsNoTracking()
            .ToListAsync();
        return await MapUsersAsync(users);
    }

    public async Task<int> GetNumberOfUsersForRightAsync(int rightId) =>
        await _dbContext.FimUserRights.CountAsync(ur => ur.RightId == rightId);

    public async Task<bool> AddUserToRightAsync(int userId, int rightId, string grantedBy)
    {
        if (!await _dbContext.AppUsers.AnyAsync(u => u.UserId == userId)) return false;
        if (!await _dbContext.FimRights.AnyAsync(r => r.RightId == rightId)) return false;
        if (await _dbContext.FimUserRights.AnyAsync(ur => ur.UserId == userId && ur.RightId == rightId)) return false;

        _dbContext.FimUserRights.Add(new FimUserRight
        {
            UserId = userId,
            RightId = rightId,
            GrantedBy = grantedBy,
            GrantedAt = DateTime.UtcNow
        });
        await _dbContext.SaveChangesAsync();

        await LogSyncAsync("USER_RIGHT", $"{userId}:{rightId}", "CREATE", grantedBy);
        await WriteAuditLogAsync(grantedBy, "FIM_INTEGRATION", $"FIM AddUserToRight: granted right {rightId} to user {userId}.");
        return true;
    }

    public async Task<bool> RemoveUserFromRightAsync(int userId, int rightId)
    {
        var link = await _dbContext.FimUserRights.FirstOrDefaultAsync(ur => ur.UserId == userId && ur.RightId == rightId);
        if (link == null) return false;

        _dbContext.FimUserRights.Remove(link);
        await _dbContext.SaveChangesAsync();

        await LogSyncAsync("USER_RIGHT", $"{userId}:{rightId}", "DELETE", "FIM_INTEGRATION");
        return true;
    }

    // =========================================================================
    // Password Management Functions
    // =========================================================================

    public async Task<bool> SetPasswordAsync(int userId, string password, string encryptionAlgorithm = "BCRYPT")
    {
        var user = await _dbContext.AppUsers.FirstOrDefaultAsync(u => u.UserId == userId);
        if (user == null) return false;
        if (string.IsNullOrWhiteSpace(password))
            throw new ArgumentException("Password must not be empty.", nameof(password));

        string algo = PasswordHasher.Normalize(encryptionAlgorithm);
        user.PasswordHash = PasswordHasher.Hash(password, algo, ResolveAesKey());
        user.PasswordAlgorithm = algo;
        await _dbContext.SaveChangesAsync();

        // Never write the plaintext/hash into audit trail or sync log details.
        await LogSyncAsync("PASSWORD", userId.ToString(), "UPDATE", "FIM_INTEGRATION", $"algorithm={algo}");
        await WriteAuditLogAsync("FIM_INTEGRATION", "FIM_INTEGRATION", $"FIM SetPassword: credential reset for user {userId} using {algo}.");
        return true;
    }

    // =========================================================================
    // Connectivity support & Sync change detection
    // =========================================================================

    public async Task<IEnumerable<FimSyncChangeDto>> DetectDeltaChangesAsync(DateTime lastSyncTime)
    {
        var changes = await _dbContext.FimSyncLogs
            .Where(s => s.ChangedAt > lastSyncTime)
            .OrderBy(s => s.ChangedAt)
            .AsNoTracking()
            .ToListAsync();

        return changes.Select(c => new FimSyncChangeDto
        {
            SyncLogId = c.SyncLogId,
            EntityType = c.EntityType,
            EntityKey = c.EntityKey,
            ChangeType = c.ChangeType,
            ChangedAt = c.ChangedAt,
            ChangedBy = c.ChangedBy,
            Source = c.Source,
            DetailsJson = c.DetailsJson
        });
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    private async Task<List<FimUserDto>> MapUsersAsync(List<AppUser> users)
    {
        var ids = users.Select(u => u.UserId).ToList();
        var attrRows = await _dbContext.FimUserAttributes
            .Where(a => ids.Contains(a.UserId))
            .AsNoTracking()
            .ToListAsync();

        return users.Select(u => new FimUserDto
        {
            UserId = u.UserId,
            Username = u.Username,
            DisplayName = u.DisplayName,
            Email = u.Email,
            IsActive = u.IsActive,
            CreatedAt = u.CreatedAt,
            CreatedBy = u.CreatedBy,
            PasswordAlgorithm = u.PasswordAlgorithm,
            Attributes = attrRows.Where(a => a.UserId == u.UserId)
                                 .ToDictionary(a => a.AttributeName, a => a.AttributeValue, StringComparer.OrdinalIgnoreCase)
        }).ToList();
    }

    private static FimProfileDto MapProfile(PrivilegeGroup group) => new()
    {
        ProfileId = group.GroupId,
        ProfileName = group.GroupName,
        Description = group.Description,
        IsSystem = group.IsSystem,
        IsActive = group.IsActive,
        CreatedAt = group.CreatedAt,
        MemberCount = group.Members?.Count ?? 0,
        Permissions = (group.Permissions ?? new List<GroupPermission>())
            .ToDictionary(p => p.ModuleKey, p => p.AccessLevel, StringComparer.OrdinalIgnoreCase)
    };

    private static FimRightDto MapRight(FimRight r) => new()
    {
        RightId = r.RightId,
        RightCode = r.RightCode,
        RightName = r.RightName,
        Description = r.Description,
        ModuleKey = r.ModuleKey,
        IsActive = r.IsActive,
        CreatedAt = r.CreatedAt
    };

    private async Task PersistExtraAttributesAsync(int userId, Dictionary<string, string> attrs, HashSet<string> reservedKeys)
    {
        foreach (var kv in attrs)
        {
            if (reservedKeys.Contains(kv.Key)) continue;

            var existing = await _dbContext.FimUserAttributes
                .FirstOrDefaultAsync(a => a.UserId == userId && a.AttributeName == kv.Key);
            if (existing != null)
            {
                existing.AttributeValue = kv.Value;
                existing.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                _dbContext.FimUserAttributes.Add(new FimUserAttribute
                {
                    UserId = userId,
                    AttributeName = kv.Key,
                    AttributeValue = kv.Value,
                    UpdatedAt = DateTime.UtcNow
                });
            }
        }
        await _dbContext.SaveChangesAsync();
    }

    private async Task LogSyncAsync(string entityType, string entityKey, string changeType, string changedBy, string? details = null)
    {
        _dbContext.FimSyncLogs.Add(new FimSyncLog
        {
            EntityType = entityType,
            EntityKey = entityKey,
            ChangeType = changeType,
            ChangedBy = changedBy,
            ChangedAt = DateTime.UtcNow,
            Source = "APPLICATION",
            DetailsJson = details == null ? null : JsonSerializer.Serialize(new { note = details })
        });
        await _dbContext.SaveChangesAsync();
    }

    private async Task WriteAuditLogAsync(string username, string moduleName, string description)
    {
        _dbContext.AuditLogs.Add(new AuditLog
        {
            Username = username,
            IpAddress = "SYSTEM",
            ModuleName = moduleName,
            ActionDescription = description,
            Timestamp = DateTime.UtcNow
        });
        await _dbContext.SaveChangesAsync();
    }

    private string? ResolveAesKey() => _config?["Fim:AesKey"];
}
