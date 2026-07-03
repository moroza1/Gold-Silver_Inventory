using System;
using System.Collections.Generic;

namespace PMIMS.Application;

// ============================================================
// FIM Integration DTOs
// Shared shapes returned by IFimService / consumed by the FIM Web API
// controller. Kept separate from PMIMS.Domain entities so the FIM wire
// contract (what an FIM connector actually sees) can evolve independently
// of the underlying AppUser/PrivilegeGroup/FimRight persistence model.
// ============================================================

public class FimUserDto
{
    public int UserId { get; set; }
    public string Username { get; set; } = null!;
    public string DisplayName { get; set; } = null!;
    public string Email { get; set; } = null!;
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = null!;
    public string PasswordAlgorithm { get; set; } = "SHA256";
    // Mandatory + custom attributes (FimUserAttribute rows), keyed by
    // attribute name -- lets FIM push/pull arbitrary fields without a
    // schema migration for every new attribute.
    public Dictionary<string, string> Attributes { get; set; } = new();
}

public class FimProfileDto
{
    public int ProfileId { get; set; }
    public string ProfileName { get; set; } = null!;
    public string Description { get; set; } = null!;
    public bool IsSystem { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public int MemberCount { get; set; }
    // Module-key -> access-level grants carried by this profile
    // (PrivilegeGroup.Permissions), exposed as attribute values.
    public Dictionary<string, string> Permissions { get; set; } = new();
}

public class FimRightDto
{
    public int RightId { get; set; }
    public string RightCode { get; set; } = null!;
    public string RightName { get; set; } = null!;
    public string? Description { get; set; }
    public string? ModuleKey { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class FimSyncChangeDto
{
    public int SyncLogId { get; set; }
    public string EntityType { get; set; } = null!;
    public string EntityKey { get; set; } = null!;
    public string ChangeType { get; set; } = null!;
    public DateTime ChangedAt { get; set; }
    public string ChangedBy { get; set; } = null!;
    public string Source { get; set; } = null!;
    public string? DetailsJson { get; set; }
}

// Static descriptor for the "Connectivity Support" section of the RFP --
// returned by GET /api/fim/connectivity so an FIM administrator/connector
// can discover which transport modes this PMIMS deployment exposes without
// consulting separate documentation.
public class FimConnectivityDescriptor
{
    public bool DatabaseConnectivity { get; set; } = true;   // direct SQL Server connectivity (sp_FIM_* procs)
    public bool WebServiceConnectivity { get; set; } = true; // SOAP/WS-* -- see FIM_INTEGRATION.md for the WCF adapter
    public bool CommandConnectivity { get; set; } = true;    // CLI/batch -- see tools/fim-cli
    public bool Iis7Compatible { get; set; } = true;
    public string PreferredIdentitySource { get; set; } = "ACTIVE_DIRECTORY"; // ACTIVE_DIRECTORY | APPLICATION_OWN
    public string Notes { get; set; } =
        "REST/JSON is the primary transport (this API). A SOAP/WS-* facade for IIS 7-based " +
        "FIM Web Service connectivity is documented in docs/FIM_INTEGRATION.md and routes " +
        "through the same IFimService implementation.";
}
