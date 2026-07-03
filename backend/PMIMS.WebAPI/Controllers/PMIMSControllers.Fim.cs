using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PMIMS.Application;

namespace PMIMS.WebAPI.Controllers;

// =========================================================================
// FIM (Forefront Identity Manager) Integration Module
// -------------------------------------------------------------------------
// Full REST surface for every function mandated by the RFP's "FIM
// Integration Module": identity provisioning, access management (rights),
// password management, and delta-sync change detection. Same partial class
// as PMIMSControllers.cs / PMIMSControllers.Admin.cs -- shares the injected
// _fimService and helpers (ComputeSha256, etc.).
//
// Per docs/PERMISSIONS.md, FIM provisioning is governed by the existing
// `user_admin` module (not a separate module key) -- reads require
// user_admin.read, mutations require user_admin.write, exactly like the
// admin/users and admin/groups endpoints in PMIMSControllers.Admin.cs.
//
// This supersedes the earlier ad-hoc GET/POST fim/users and fim/profiles
// endpoints that lived in PMIMSControllers.cs (Section 9) -- those covered
// only 4 of the 29 RFP functions with mock data; this file covers all 29
// against the real AppUser/PrivilegeGroup/FimRight-backed FimService.
//
// SQL Server-side mirror for direct-database-connectivity FIM sync clients:
// database/procedures.sql, procedures prefixed sp_FIM_.
// =========================================================================
public partial class PMIMSControllers
{
    // ---- Identity Provisioning: Users ----

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/users")]
    public async Task<IActionResult> FimGetUsers() => Ok(await _fimService.GetUsersAsync());

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/users/count")]
    public async Task<IActionResult> FimGetNumberOfUsers() => Ok(new { count = await _fimService.GetNumberOfUsersAsync() });

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/users/{userId:int}")]
    public async Task<IActionResult> FimGetUserInfo(int userId)
    {
        var user = await _fimService.GetUserInfoAsync(userId);
        if (user == null) return NotFound(new { error = $"FIM user {userId} not found." });
        return Ok(user);
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpPost("fim/users")]
    public async Task<IActionResult> FimAddUser([FromBody] FimAttributesRequest req)
    {
        try
        {
            var user = await _fimService.AddUserAsync(req.Attributes ?? new Dictionary<string, string>(), req.RequestedBy ?? "FIM_INTEGRATION");
            return Created($"/api/fim/users/{user.UserId}", user);
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { error = ex.Message }); }
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpPut("fim/users/{userId:int}")]
    public async Task<IActionResult> FimUpdateUserInfo(int userId, [FromBody] FimAttributesRequest req)
    {
        var user = await _fimService.UpdateUserInfoAsync(userId, req.Attributes ?? new Dictionary<string, string>());
        if (user == null) return NotFound(new { error = $"FIM user {userId} not found." });
        return Ok(user);
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpDelete("fim/users/{userId:int}")]
    public async Task<IActionResult> FimRemoveUser(int userId)
    {
        bool removed = await _fimService.RemoveUserAsync(userId);
        if (!removed) return NotFound(new { error = $"FIM user {userId} not found." });
        return Ok(new { message = "User removed successfully.", user_id = userId });
    }

    // ---- Identity Provisioning: Profiles ----

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/profiles")]
    public async Task<IActionResult> FimGetProfiles() => Ok(await _fimService.GetProfilesAsync());

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/profiles/count")]
    public async Task<IActionResult> FimGetNumberOfProfiles() => Ok(new { count = await _fimService.GetNumberOfProfilesAsync() });

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/profiles/{profileId:int}")]
    public async Task<IActionResult> FimGetProfileInfo(int profileId)
    {
        var profile = await _fimService.GetProfileInfoAsync(profileId);
        if (profile == null) return NotFound(new { error = $"FIM profile {profileId} not found." });
        return Ok(profile);
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpPost("fim/profiles")]
    public async Task<IActionResult> FimAddProfile([FromBody] FimAttributesRequest req)
    {
        try
        {
            var profile = await _fimService.AddProfileAsync(req.Attributes ?? new Dictionary<string, string>(), req.RequestedBy ?? "FIM_INTEGRATION");
            return Created($"/api/fim/profiles/{profile.ProfileId}", profile);
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { error = ex.Message }); }
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpPut("fim/profiles/{profileId:int}")]
    public async Task<IActionResult> FimUpdateProfileInfo(int profileId, [FromBody] FimAttributesRequest req)
    {
        var profile = await _fimService.UpdateProfileInfoAsync(profileId, req.Attributes ?? new Dictionary<string, string>());
        if (profile == null) return NotFound(new { error = $"FIM profile {profileId} not found." });
        return Ok(profile);
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpDelete("fim/profiles/{profileId:int}")]
    public async Task<IActionResult> FimRemoveProfile(int profileId)
    {
        bool removed = await _fimService.RemoveProfileAsync(profileId);
        if (!removed) return BadRequest(new { error = "Profile not found, or it is a protected system profile that cannot be removed via FIM." });
        return Ok(new { message = "Profile removed successfully.", profile_id = profileId });
    }

    // ---- Identity Provisioning: User <-> Profile bindings ----

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/profiles/{profileId:int}/users")]
    public async Task<IActionResult> FimGetUsersFromProfile(int profileId) => Ok(await _fimService.GetUsersFromProfileAsync(profileId));

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/profiles/{profileId:int}/users/count")]
    public async Task<IActionResult> FimGetNumberOfUsersFromProfile(int profileId) =>
        Ok(new { count = await _fimService.GetNumberOfUsersFromProfileAsync(profileId) });

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/users/{userId:int}/profiles")]
    public async Task<IActionResult> FimGetProfilesFromUser(int userId) => Ok(await _fimService.GetProfilesFromUserAsync(userId));

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/users/{userId:int}/profiles/count")]
    public async Task<IActionResult> FimGetNumberOfProfilesFromUser(int userId) =>
        Ok(new { count = await _fimService.GetNumberOfProfilesFromUserAsync(userId) });

    [Authorize(Policy = "user_admin.write")]
    [HttpPost("fim/users/{userId:int}/profiles/{profileId:int}")]
    public async Task<IActionResult> FimAddUserToProfile(int userId, int profileId, [FromBody] FimAssignRequest? req)
    {
        bool ok = await _fimService.AddUserToProfileAsync(userId, profileId, req?.RequestedBy ?? "FIM_INTEGRATION");
        if (!ok) return BadRequest(new { error = "Unable to bind user to profile (user/profile not found, or already bound)." });
        return Ok(new { message = "User bound to profile successfully.", user_id = userId, profile_id = profileId });
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpDelete("fim/users/{userId:int}/profiles/{profileId:int}")]
    public async Task<IActionResult> FimRemoveUserFromProfile(int userId, int profileId)
    {
        bool ok = await _fimService.RemoveUserFromProfileAsync(userId, profileId);
        if (!ok) return NotFound(new { error = "Binding not found." });
        return Ok(new { message = "User released from profile successfully.", user_id = userId, profile_id = profileId });
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpPost("fim/profiles/{profileId:int}/users/remove-batch")]
    public async Task<IActionResult> FimRemoveUsersFromProfile(int profileId, [FromBody] FimBatchUserIdsRequest req)
    {
        int removed = await _fimService.RemoveUsersFromProfileAsync(req.UserIds ?? new List<int>(), profileId);
        return Ok(new { message = $"{removed} user(s) released from profile.", profile_id = profileId, removed_count = removed });
    }

    // ---- Access Management: Rights ----

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/rights")]
    public async Task<IActionResult> FimGetAllRights() => Ok(await _fimService.GetAllRightsAsync());

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/rights/count")]
    public async Task<IActionResult> FimGetNumberOfRights() => Ok(new { count = await _fimService.GetNumberOfRightsAsync() });

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/rights/{rightId:int}")]
    public async Task<IActionResult> FimGetRightInfo(int rightId)
    {
        var right = await _fimService.GetRightInfoAsync(rightId);
        if (right == null) return NotFound(new { error = $"FIM right {rightId} not found." });
        return Ok(right);
    }

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/users/{userId:int}/rights")]
    public async Task<IActionResult> FimGetAllRightsForUser(int userId) => Ok(await _fimService.GetAllRightsForUserAsync(userId));

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/users/{userId:int}/rights/count")]
    public async Task<IActionResult> FimGetNumberOfRightsForUser(int userId) =>
        Ok(new { count = await _fimService.GetNumberOfRightsForUserAsync(userId) });

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/rights/{rightId:int}/users")]
    public async Task<IActionResult> FimGetAllUsersForRight(int rightId) => Ok(await _fimService.GetAllUsersForRightAsync(rightId));

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/rights/{rightId:int}/users/count")]
    public async Task<IActionResult> FimGetNumberOfUsersForRight(int rightId) =>
        Ok(new { count = await _fimService.GetNumberOfUsersForRightAsync(rightId) });

    [Authorize(Policy = "user_admin.write")]
    [HttpPost("fim/users/{userId:int}/rights/{rightId:int}")]
    public async Task<IActionResult> FimAddUserToRight(int userId, int rightId, [FromBody] FimAssignRequest? req)
    {
        bool ok = await _fimService.AddUserToRightAsync(userId, rightId, req?.RequestedBy ?? "FIM_INTEGRATION");
        if (!ok) return BadRequest(new { error = "Unable to grant right (user/right not found, or already granted)." });
        return Ok(new { message = "Right granted to user successfully.", user_id = userId, right_id = rightId });
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpDelete("fim/users/{userId:int}/rights/{rightId:int}")]
    public async Task<IActionResult> FimRemoveUserFromRight(int userId, int rightId)
    {
        bool ok = await _fimService.RemoveUserFromRightAsync(userId, rightId);
        if (!ok) return NotFound(new { error = "Right grant not found." });
        return Ok(new { message = "Right revoked from user successfully.", user_id = userId, right_id = rightId });
    }

    // ---- Password Management ----

    [Authorize(Policy = "user_admin.write")]
    [HttpPost("fim/users/{userId:int}/password")]
    public async Task<IActionResult> FimSetPassword(int userId, [FromBody] FimSetPasswordRequest req)
    {
        try
        {
            bool ok = await _fimService.SetPasswordAsync(userId, req.Password, req.EncryptionAlgorithm ?? "BCRYPT");
            if (!ok) return NotFound(new { error = $"FIM user {userId} not found." });
            return Ok(new { message = "Password set successfully.", user_id = userId, algorithm = (req.EncryptionAlgorithm ?? "BCRYPT").ToUpperInvariant() });
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
        catch (NotSupportedException ex) { return BadRequest(new { error = ex.Message }); }
    }

    // ---- Connectivity support & delta-sync change detection ----

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/connectivity")]
    public IActionResult FimGetConnectivity() => Ok(new FimConnectivityDescriptor());

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("fim/sync/delta")]
    public async Task<IActionResult> FimDetectDeltaChanges([FromQuery] DateTime since)
    {
        var changes = await _fimService.DetectDeltaChangesAsync(since);
        return Ok(changes);
    }
}

// FIM request DTOs
public class FimAttributesRequest
{
    public Dictionary<string, string>? Attributes { get; set; }
    public string? RequestedBy { get; set; }
}

public class FimAssignRequest
{
    public string? RequestedBy { get; set; }
}

public class FimBatchUserIdsRequest
{
    public List<int>? UserIds { get; set; }
}

public class FimSetPasswordRequest
{
    public string Password { get; set; } = null!;
    public string? EncryptionAlgorithm { get; set; } = "BCRYPT"; // BCRYPT (default) | AES256
}
