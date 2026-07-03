using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PMIMS.Application;
using PMIMS.Domain;

namespace PMIMS.WebAPI.Controllers;

// Administration / Governance + Master-Data surface of the API, split out of the
// operational controller (Phase 4). Same partial class, so it shares the injected
// services and helpers declared in PMIMSControllers.cs; the split is purely about
// keeping admin endpoints (users, groups, FIM, branches, thresholds) in their own file.
public partial class PMIMSControllers
{
    // =========================================================================
    // 12. USER & GROUP PRIVILEGE MANAGEMENT
    // =========================================================================

    // -- Users --
    [Authorize(Policy = "user_admin.read")]
    [HttpGet("admin/users")]
    public async Task<IActionResult> GetAllUsers()
    {
        var users = await _repository.GetAllUsersAsync();
        return Ok(users.Select(u => new {
            u.UserId, u.Username, u.DisplayName, u.Email, u.IsActive, u.CreatedAt, u.CreatedBy,
            groups = u.Memberships.Select(m => new { m.Group!.GroupId, m.Group.GroupName }).ToList()
        }));
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpPost("admin/users")]
    public async Task<IActionResult> CreateUser([FromBody] CreateAppUserRequest req)
    {
        // Hash password with SHA-256
        string hash = ComputeSha256(req.Password);
        try
        {
            var user = await _repository.CreateUserAsync(req.Username, req.DisplayName, req.Email, hash, req.CreatedBy);

            // Assign to groups if specified
            if (req.GroupIds != null)
            {
                foreach (var gid in req.GroupIds)
                {
                    await _repository.AddUserToGroupAsync(user.UserId, gid, req.CreatedBy);
                }
            }

            return Created($"/api/admin/users/{user.UserId}", new { user.UserId, user.Username, message = "User created successfully." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpPut("admin/users/{id}")]
    public async Task<IActionResult> UpdateUser(int id, [FromBody] UpdateAppUserRequest req)
    {
        var user = await _repository.UpdateUserAsync(id, req.DisplayName, req.Email);
        if (user == null) return NotFound();
        return Ok(new { user.UserId, user.Username, user.DisplayName, user.Email });
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpPut("admin/users/{id}/toggle")]
    public async Task<IActionResult> ToggleUserActive(int id, [FromBody] ToggleActiveRequest req)
    {
        var result = await _repository.ToggleUserActiveAsync(id, req.IsActive);
        if (!result) return NotFound();
        return Ok(new { message = $"User {(req.IsActive ? "activated" : "deactivated")} successfully." });
    }

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("admin/users/{username}/permissions")]
    public async Task<IActionResult> GetUserEffectivePermissions(string username)
    {
        var perms = await _repository.GetEffectivePermissionsForUserAsync(username);
        return Ok(perms);
    }

    // -- Groups --
    [Authorize(Policy = "user_admin.read")]
    [HttpGet("admin/groups")]
    public async Task<IActionResult> GetAllGroups()
    {
        var groups = await _repository.GetAllGroupsAsync();
        return Ok(groups.Select(g => new {
            g.GroupId, g.GroupName, g.Description, g.IsSystem, g.IsActive, g.CreatedAt,
            memberCount = g.Members.Count,
            members = g.Members.Select(m => new { m.User!.UserId, m.User.Username, m.User.DisplayName }).ToList(),
            permissions = g.Permissions.Select(p => new { p.ModuleKey, p.AccessLevel }).ToList()
        }));
    }

    [Authorize(Policy = "user_admin.read")]
    [HttpGet("admin/groups/{id}")]
    public async Task<IActionResult> GetGroupById(int id)
    {
        var g = await _repository.GetGroupByIdAsync(id);
        if (g == null) return NotFound();
        return Ok(new {
            g.GroupId, g.GroupName, g.Description, g.IsSystem, g.IsActive, g.CreatedAt,
            members = g.Members.Select(m => new { m.User!.UserId, m.User.Username, m.User.DisplayName }).ToList(),
            permissions = g.Permissions.Select(p => new { p.ModuleKey, p.AccessLevel }).ToList()
        });
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpPost("admin/groups")]
    public async Task<IActionResult> CreateGroup([FromBody] CreateGroupRequest req)
    {
        try
        {
            var group = await _repository.CreateGroupAsync(req.GroupName, req.Description);
            return Created($"/api/admin/groups/{group.GroupId}", new { group.GroupId, group.GroupName });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.InnerException?.Message ?? ex.Message });
        }
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpPut("admin/groups/{id}")]
    public async Task<IActionResult> UpdateGroup(int id, [FromBody] UpdateGroupRequest req)
    {
        var group = await _repository.UpdateGroupAsync(id, req.GroupName, req.Description);
        if (group == null) return NotFound();
        return Ok(new { group.GroupId, group.GroupName, group.Description });
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpDelete("admin/groups/{id}")]
    public async Task<IActionResult> DeleteGroup(int id)
    {
        var result = await _repository.DeleteGroupAsync(id);
        if (!result) return BadRequest(new { error = "Cannot delete. Group may be a system group or not found." });
        return Ok(new { message = "Group deleted successfully." });
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpPut("admin/groups/{id}/permissions")]
    public async Task<IActionResult> SaveGroupPermissions(int id, [FromBody] SavePermissionsRequest req)
    {
        var perms = req.Permissions.Select(p => (p.ModuleKey, p.AccessLevel));
        await _repository.SaveGroupPermissionsAsync(id, perms);
        return Ok(new { message = "Group permissions updated successfully." });
    }

    // -- Membership --
    [Authorize(Policy = "user_admin.write")]
    [HttpPost("admin/groups/{groupId}/members")]
    public async Task<IActionResult> AddUserToGroup(int groupId, [FromBody] AddMemberRequest req)
    {
        var result = await _repository.AddUserToGroupAsync(req.UserId, groupId, req.AssignedBy);
        if (!result) return BadRequest(new { error = "User is already a member of this group." });
        return Ok(new { message = "User added to group successfully." });
    }

    [Authorize(Policy = "user_admin.write")]
    [HttpDelete("admin/groups/{groupId}/members/{userId}")]
    public async Task<IActionResult> RemoveUserFromGroup(int groupId, int userId)
    {
        var result = await _repository.RemoveUserFromGroupAsync(userId, groupId);
        if (!result) return NotFound();
        return Ok(new { message = "User removed from group successfully." });
    }

    // =========================================================================
    // KFH BRANCHES CRUD
    // =========================================================================

    [HttpGet("catalog/branches")]
    public async Task<IActionResult> GetBranches()
    {
        var branches = await _repository.GetBranchesAsync();
        return Ok(branches.Select(b => new {
            branch_id = b.BranchId,
            branch_code = b.BranchCode,
            branch_name = b.BranchName,
            vault_id = b.VaultId,
            vault_name = b.Vault?.VaultName ?? "Unknown Vault",
            is_active = b.IsActive
        }));
    }

    [Authorize(Policy = "master_data.write")]
    [HttpPost("catalog/branches")]
    public async Task<IActionResult> SaveBranch([FromBody] SaveBranchRequest req)
    {
        try
        {
            var branch = await _repository.SaveBranchAsync(req.BranchId, req.BranchCode, req.BranchName, req.VaultId, req.IsActive);
            return Ok(new {
                branch_id = branch.BranchId,
                branch_code = branch.BranchCode,
                branch_name = branch.BranchName,
                vault_id = branch.VaultId,
                vault_name = branch.Vault?.VaultName ?? "Unknown Vault",
                is_active = branch.IsActive,
                message = "Branch saved successfully."
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [Authorize(Policy = "master_data.write")]
    [HttpDelete("catalog/branches/{id}")]
    public async Task<IActionResult> DeleteBranch(int id)
    {
        var result = await _repository.DeleteBranchAsync(id);
        if (!result) return NotFound();
        return Ok(new { message = "Branch deleted successfully." });
    }

    // =========================================================================
    // STOCK REORDER THRESHOLDS
    // =========================================================================

    [HttpGet("inventory/reorder-thresholds")]
    public async Task<IActionResult> GetReorderThresholds()
    {
        var thresholds = await _repository.GetReorderThresholdsAsync();
        return Ok(thresholds.Select(t => new {
            threshold_id = t.ThresholdId,
            product_id = t.ProductId,
            product_code = t.Product?.ProductCode ?? "",
            product_name = $"{t.Product?.MetalType?.MetalName ?? ""} {t.Product?.Denomination?.Label ?? ""}",
            vendor_id = t.VendorId,
            vendor_name = t.Vendor?.VendorName ?? "",
            min_stock_qty = t.MinStockQty,
            reorder_qty = t.ReorderQty,
            is_active = t.IsActive
        }));
    }

    [Authorize(Policy = "master_data.write")]
    [HttpPost("inventory/reorder-thresholds")]
    public async Task<IActionResult> SaveReorderThreshold([FromBody] SaveReorderThresholdRequest req)
    {
        var threshold = await _repository.SaveReorderThresholdAsync(req.ThresholdId, req.ProductId, req.VendorId, req.MinStockQty, req.ReorderQty, req.IsActive);
        return Ok(new {
            threshold_id = threshold.ThresholdId,
            product_id = threshold.ProductId,
            product_code = threshold.Product?.ProductCode ?? "",
            vendor_id = threshold.VendorId,
            vendor_name = threshold.Vendor?.VendorName ?? "",
            min_stock_qty = threshold.MinStockQty,
            reorder_qty = threshold.ReorderQty,
            is_active = threshold.IsActive,
            message = "Threshold saved successfully."
        });
    }

    [Authorize(Policy = "master_data.write")]
    [HttpDelete("inventory/reorder-thresholds/{id}")]
    public async Task<IActionResult> DeleteReorderThreshold(int id)
    {
        var result = await _repository.DeleteReorderThresholdAsync(id);
        if (!result) return NotFound();
        return Ok(new { message = "Threshold deleted successfully." });
    }

    [HttpGet("inventory/low-stock-alerts")]
    public async Task<IActionResult> GetLowStockAlerts()
    {
        var alerts = await _repository.CheckLowStockAlertsAsync();
        return Ok(alerts);
    }

    // Was missing [Authorize] entirely -- anonymous callers could create draft purchase
    // orders. This creates a PurchaseOrder record the same way POST /api/purchase-orders
    // does, so gate it with the same policy (Maker holds FULL on purchase_orders).
    [Authorize(Policy = "purchase_orders.write")]
    [HttpPost("inventory/low-stock-alerts/{thresholdId}/draft-po")]
    public async Task<IActionResult> CreateDraftPO(int thresholdId, [FromBody] DraftPORequest req)
    {
        var (poId, result) = await _repository.CreateDraftPurchaseOrderAsync(thresholdId, req.CreatedBy);
        if (result == "THRESHOLD_NOT_FOUND") return NotFound(new { error = "Threshold not found." });
        if (result == "DRAFT_EXISTS") return Ok(new { po_id = poId, message = "A draft P.O. already exists for this supplier.", already_exists = true });
        return Created($"/api/purchase-orders/{poId}", new { po_id = poId, message = "Draft P.O. created successfully." });
    }
}
