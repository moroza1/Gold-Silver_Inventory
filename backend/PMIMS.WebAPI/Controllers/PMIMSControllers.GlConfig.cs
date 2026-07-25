using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Ledger.Gl.EfCore;

namespace PMIMS.WebAPI.Controllers;

// ============================================================================
// GL Configuration admin API (backs the "GL Configuration" screen). Governs the
// chart of accounts + posting-rule mappings through a maker-checker workflow:
// a maker edits a DRAFT and submits it; a *different* user (checker) approves it,
// at which point it becomes the ACTIVE config the live GL posts against.
//
// GlConfigService is injected per-action via [FromServices] so this partial does
// not need to touch the shared PMIMSControllers constructor. Segregation-of-duties
// and all state-transition rules live in the service; here we just map HTTP + the
// current user (from the JWT) and translate service errors to 400s.
// ============================================================================
public partial class PMIMSControllers
{
    private string GlCurrentUser => User.Identity?.Name ?? "unknown";

    // ----- reads (gl_config.read) -------------------------------------------

    [Authorize(Policy = "gl_config.read")]
    [HttpGet("gl-config/active")]
    public async Task<IActionResult> GetActiveGlConfig([FromServices] GlConfigService svc)
    {
        var active = await svc.GetActiveAsync();
        return active is null ? NotFound(new { error = "No active GL configuration." }) : Ok(active);
    }

    [Authorize(Policy = "gl_config.read")]
    [HttpGet("gl-config/versions")]
    public async Task<IActionResult> ListGlConfigVersions([FromServices] GlConfigService svc)
        => Ok(await svc.ListVersionsAsync());

    [Authorize(Policy = "gl_config.read")]
    [HttpGet("gl-config/versions/{id:long}")]
    public async Task<IActionResult> GetGlConfigVersion(long id, [FromServices] GlConfigService svc)
    {
        var v = await svc.GetVersionAsync(id);
        return v is null ? NotFound() : Ok(v);
    }

    /// <summary>Dry-run: preview the journal entry a sample event would produce (no persistence).</summary>
    [Authorize(Policy = "gl_config.read")]
    [HttpPost("gl-config/simulate")]
    public IActionResult SimulateGlPosting([FromBody] GlSimulationRequest req, [FromServices] GlConfigService svc)
        => Ok(svc.Simulate(req));

    // ----- maker path (gl_config.write) -------------------------------------

    /// <summary>Open (or create) the current editable DRAFT, cloned from the ACTIVE config.</summary>
    [Authorize(Policy = "gl_config.write")]
    [HttpPost("gl-config/draft")]
    public async Task<IActionResult> GetOrCreateGlDraft([FromServices] GlConfigService svc)
        => Ok(await svc.GetOrCreateDraftAsync(GlCurrentUser));

    [Authorize(Policy = "gl_config.write")]
    [HttpPut("gl-config/draft/{id:long}")]
    public async Task<IActionResult> SaveGlDraft(long id, [FromBody] SaveGlDraftRequest req, [FromServices] GlConfigService svc)
    {
        try { return Ok(await svc.SaveDraftAsync(id, req.ConfigJson, req.ChangeSummary, GlCurrentUser)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [Authorize(Policy = "gl_config.write")]
    [HttpPost("gl-config/draft/{id:long}/submit")]
    public async Task<IActionResult> SubmitGlDraft(long id, [FromServices] GlConfigService svc)
    {
        try { return Ok(await svc.SubmitAsync(id, GlCurrentUser)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    // ----- checker path (gl_config.write + segregation of duties) -----------

    [Authorize(Policy = "gl_config.write")]
    [HttpPost("gl-config/versions/{id:long}/approve")]
    public async Task<IActionResult> ApproveGlConfig(long id, [FromServices] GlConfigService svc)
    {
        try { return Ok(await svc.ApproveAsync(id, GlCurrentUser)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [Authorize(Policy = "gl_config.write")]
    [HttpPost("gl-config/versions/{id:long}/reject")]
    public async Task<IActionResult> RejectGlConfig(long id, [FromBody] RejectGlConfigRequest req, [FromServices] GlConfigService svc)
    {
        try { return Ok(await svc.RejectAsync(id, req.Comments ?? "", GlCurrentUser)); }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }
}

public sealed class SaveGlDraftRequest
{
    public string ConfigJson { get; set; } = "";
    public string? ChangeSummary { get; set; }
}

public sealed class RejectGlConfigRequest
{
    public string? Comments { get; set; }
}
