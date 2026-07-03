using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using PMIMS.Domain;
using PMIMS.Infrastructure;
using Xunit;

namespace PMIMS.Tests;

// Coverage for the FIM (Forefront Identity Manager) Integration Module --
// FimService (PMIMS.Infrastructure) and PasswordHasher, against the real
// AppUser/PrivilegeGroup/FimRight-backed implementation (not the old mock).
public class FimServiceTests
{
    private class DbSetup : IDisposable
    {
        public AppDbContext Context { get; }
        public SqliteConnection Connection { get; }

        public DbSetup(AppDbContext context, SqliteConnection connection)
        {
            Context = context;
            Connection = connection;
        }

        public void Dispose()
        {
            Context.Dispose();
            Connection.Dispose();
        }
    }

    private DbSetup CreateContext()
    {
        var conn = new SqliteConnection("DataSource=:memory:");
        conn.Open();
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(conn)
            .Options;

        var context = new AppDbContext(options);
        context.Database.EnsureDeleted();
        context.Database.EnsureCreated();
        return new DbSetup(context, conn);
    }

    // ---- Identity Provisioning ----

    [Fact]
    public async Task AddUserAsync_CreatesUser_WithMandatoryAttributes()
    {
        using var db = CreateContext();
        var fim = new FimService(db.Context);

        var attrs = new Dictionary<string, string>
        {
            { "username", "fim-test-user" },
            { "email", "fim-test-user@kfh.com.kw" },
            { "displayName", "FIM Test User" },
            { "department", "Treasury" } // custom attribute -> FimUserAttribute bag
        };

        var user = await fim.AddUserAsync(attrs, "FIM_SYNC_JOB");

        Assert.True(user.UserId > 0);
        Assert.Equal("fim-test-user", user.Username);
        Assert.Equal("FIM Test User", user.DisplayName);
        Assert.True(user.IsActive);
        Assert.Equal("BCRYPT", user.PasswordAlgorithm);
        Assert.Equal("Treasury", user.Attributes["department"]);
        // No explicit password supplied -> a temporary one is generated and returned once.
        Assert.True(user.Attributes.ContainsKey("generated_temp_password"));

        var stored = await db.Context.AppUsers.FirstAsync(u => u.UserId == user.UserId);
        Assert.NotEqual(user.Attributes["generated_temp_password"], stored.PasswordHash); // never stored raw
    }

    [Fact]
    public async Task AddUserAsync_MissingMandatoryAttribute_Throws()
    {
        using var db = CreateContext();
        var fim = new FimService(db.Context);

        var attrs = new Dictionary<string, string> { { "email", "no-username@kfh.com.kw" } };

        await Assert.ThrowsAsync<ArgumentException>(() => fim.AddUserAsync(attrs, "FIM_SYNC_JOB"));
    }

    [Fact]
    public async Task AddUserAsync_DuplicateUsername_ThrowsInvalidOperation()
    {
        using var db = CreateContext();
        var fim = new FimService(db.Context);
        var attrs = new Dictionary<string, string> { { "username", "dupe" }, { "email", "a@kfh.com.kw" } };
        await fim.AddUserAsync(attrs, "SYS");

        var attrs2 = new Dictionary<string, string> { { "username", "dupe" }, { "email", "b@kfh.com.kw" } };
        await Assert.ThrowsAsync<InvalidOperationException>(() => fim.AddUserAsync(attrs2, "SYS"));
    }

    [Fact]
    public async Task AddProfileAsync_Then_AddUserToProfileAsync_BindsUser_PreventsDuplicateBinding()
    {
        using var db = CreateContext();
        var fim = new FimService(db.Context);

        var user = await fim.AddUserAsync(new Dictionary<string, string> { { "username", "u1" }, { "email", "u1@kfh.com.kw" } }, "SYS");
        var profile = await fim.AddProfileAsync(new Dictionary<string, string> { { "profileName", "FIM Test Profile" }, { "description", "Demo" } }, "SYS");

        bool firstBind = await fim.AddUserToProfileAsync(user.UserId, profile.ProfileId, "SYS");
        bool secondBind = await fim.AddUserToProfileAsync(user.UserId, profile.ProfileId, "SYS"); // already bound

        Assert.True(firstBind);
        Assert.False(secondBind);

        var usersInProfile = await fim.GetUsersFromProfileAsync(profile.ProfileId);
        Assert.Single(usersInProfile);
        Assert.Equal(user.UserId, usersInProfile.First().UserId);

        var profilesForUser = await fim.GetProfilesFromUserAsync(user.UserId);
        Assert.Contains(profilesForUser, p => p.ProfileId == profile.ProfileId);

        Assert.Equal(1, await fim.GetNumberOfUsersFromProfileAsync(profile.ProfileId));
        Assert.Equal(1, await fim.GetNumberOfProfilesFromUserAsync(user.UserId));
    }

    [Fact]
    public async Task RemoveUsersFromProfileAsync_ReleasesOnlyBoundUsers()
    {
        using var db = CreateContext();
        var fim = new FimService(db.Context);

        var u1 = await fim.AddUserAsync(new Dictionary<string, string> { { "username", "batch1" }, { "email", "batch1@kfh.com.kw" } }, "SYS");
        var u2 = await fim.AddUserAsync(new Dictionary<string, string> { { "username", "batch2" }, { "email", "batch2@kfh.com.kw" } }, "SYS");
        var profile = await fim.AddProfileAsync(new Dictionary<string, string> { { "profileName", "Batch Profile" } }, "SYS");

        await fim.AddUserToProfileAsync(u1.UserId, profile.ProfileId, "SYS");
        await fim.AddUserToProfileAsync(u2.UserId, profile.ProfileId, "SYS");

        int removed = await fim.RemoveUsersFromProfileAsync(new[] { u1.UserId, u2.UserId, 9999 }, profile.ProfileId);

        Assert.Equal(2, removed);
        Assert.Equal(0, await fim.GetNumberOfUsersFromProfileAsync(profile.ProfileId));
    }

    [Fact]
    public async Task RemoveProfileAsync_RefusesSystemProfile()
    {
        using var db = CreateContext();
        db.Context.PrivilegeGroups.Add(new PrivilegeGroup { GroupName = "System Group", Description = "Protected", IsSystem = true });
        await db.Context.SaveChangesAsync();
        var systemGroupId = db.Context.PrivilegeGroups.First().GroupId;

        var fim = new FimService(db.Context);
        bool removed = await fim.RemoveProfileAsync(systemGroupId);

        Assert.False(removed);
        Assert.NotNull(await db.Context.PrivilegeGroups.FindAsync(systemGroupId));
    }

    // ---- Access Management (Rights) ----

    [Fact]
    public async Task AddUserToRightAsync_And_RemoveUserFromRightAsync_RoundTrip()
    {
        using var db = CreateContext();
        var fim = new FimService(db.Context);

        var user = await fim.AddUserAsync(new Dictionary<string, string> { { "username", "righty" }, { "email", "righty@kfh.com.kw" } }, "SYS");
        db.Context.FimRights.Add(new FimRight { RightCode = "PO_CREATE", RightName = "Create POs", ModuleKey = "purchase_orders" });
        await db.Context.SaveChangesAsync();
        var right = await db.Context.FimRights.FirstAsync();

        bool granted = await fim.AddUserToRightAsync(user.UserId, right.RightId, "SYS");
        Assert.True(granted);
        Assert.Equal(1, await fim.GetNumberOfRightsForUserAsync(user.UserId));
        Assert.Equal(1, await fim.GetNumberOfUsersForRightAsync(right.RightId));

        bool revoked = await fim.RemoveUserFromRightAsync(user.UserId, right.RightId);
        Assert.True(revoked);
        Assert.Equal(0, await fim.GetNumberOfRightsForUserAsync(user.UserId));

        // Removing again should report "not found".
        Assert.False(await fim.RemoveUserFromRightAsync(user.UserId, right.RightId));
    }

    // ---- Password Management ----

    [Fact]
    public async Task SetPasswordAsync_Bcrypt_IsVerifiableAndNotPlaintext()
    {
        using var db = CreateContext();
        var fim = new FimService(db.Context);
        var user = await fim.AddUserAsync(new Dictionary<string, string> { { "username", "pwuser" }, { "email", "pwuser@kfh.com.kw" } }, "SYS");

        bool ok = await fim.SetPasswordAsync(user.UserId, "N3wSecureP@ss!", "BCRYPT");
        Assert.True(ok);

        var stored = await db.Context.AppUsers.FirstAsync(u => u.UserId == user.UserId);
        Assert.Equal("BCRYPT", stored.PasswordAlgorithm);
        Assert.NotEqual("N3wSecureP@ss!", stored.PasswordHash);
        Assert.True(PasswordHasher.Verify("N3wSecureP@ss!", stored.PasswordHash, stored.PasswordAlgorithm));
        Assert.False(PasswordHasher.Verify("wrong-password", stored.PasswordHash, stored.PasswordAlgorithm));
    }

    [Fact]
    public async Task SetPasswordAsync_Aes256_RoundTripsAndIsVerifiable()
    {
        using var db = CreateContext();
        var fim = new FimService(db.Context);
        var user = await fim.AddUserAsync(new Dictionary<string, string> { { "username", "aesuser" }, { "email", "aesuser@kfh.com.kw" } }, "SYS");

        bool ok = await fim.SetPasswordAsync(user.UserId, "Reversible123!", "AES256");
        Assert.True(ok);

        var stored = await db.Context.AppUsers.FirstAsync(u => u.UserId == user.UserId);
        Assert.Equal("AES256", stored.PasswordAlgorithm);
        Assert.True(PasswordHasher.Verify("Reversible123!", stored.PasswordHash, "AES256"));
    }

    [Fact]
    public async Task SetPasswordAsync_UnknownUser_ReturnsFalse()
    {
        using var db = CreateContext();
        var fim = new FimService(db.Context);
        Assert.False(await fim.SetPasswordAsync(9999, "whatever", "BCRYPT"));
    }

    // ---- Delta-sync change detection ----

    [Fact]
    public async Task DetectDeltaChangesAsync_ReturnsOnlyChangesAfterTimestamp()
    {
        using var db = CreateContext();
        var fim = new FimService(db.Context);

        var cutoff = DateTime.UtcNow;
        await Task.Delay(15); // ensure strictly-after ordering on fast test runners

        await fim.AddUserAsync(new Dictionary<string, string> { { "username", "deltauser" }, { "email", "deltauser@kfh.com.kw" } }, "SYS");

        var changes = (await fim.DetectDeltaChangesAsync(cutoff)).ToList();

        Assert.Contains(changes, c => c.EntityType == "USER" && c.ChangeType == "CREATE");
        Assert.All(changes, c => Assert.True(c.ChangedAt > cutoff));
    }

    // ---- PasswordHasher unit coverage (SHA-256 legacy path) ----

    [Fact]
    public void PasswordHasher_LegacySha256_StillVerifies()
    {
        string hash = PasswordHasher.Hash("Password123", "SHA256");
        Assert.True(PasswordHasher.Verify("Password123", hash, "SHA256"));
        Assert.False(PasswordHasher.Verify("wrong", hash, "SHA256"));
    }

    [Fact]
    public void PasswordHasher_UnsupportedAlgorithm_Throws()
    {
        Assert.Throws<NotSupportedException>(() => PasswordHasher.Hash("x", "ROT13"));
    }
}
