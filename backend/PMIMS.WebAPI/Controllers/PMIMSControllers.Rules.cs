using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PMIMS.Application;
using PMIMS.Domain;

namespace PMIMS.WebAPI.Controllers;

// =========================================================================
// Dynamic Business Validation Rules Engine (RFP item 5)
// Admin/governance tier -- rules_engine module, same segregation pattern as
// workflow_design vs. workflows (authoring is administrative; the engine
// itself is invoked inline from operational endpoints, e.g. transfers).
// =========================================================================
public partial class PMIMSControllers
{
    [Authorize(Policy = "rules_engine.read")]
    [HttpGet("rules")]
    public async Task<IActionResult> GetRules([FromQuery] string? ruleType)
    {
        var rules = await _ruleEngine.GetRulesAsync(ruleType);
        return Ok(rules.Select(MapRule));
    }

    [Authorize(Policy = "rules_engine.read")]
    [HttpGet("rules/{id:int}")]
    public async Task<IActionResult> GetRule(int id)
    {
        var rule = await _ruleEngine.GetRuleAsync(id);
        if (rule == null) return NotFound(new { error = "Rule not found." });
        return Ok(MapRule(rule));
    }

    [Authorize(Policy = "rules_engine.read")]
    [HttpGet("rules/{ruleCode}/versions")]
    public async Task<IActionResult> GetRuleVersions(string ruleCode)
    {
        var versions = await _ruleEngine.GetRuleVersionsAsync(ruleCode);
        return Ok(versions.Select(MapRule));
    }

    [Authorize(Policy = "rules_engine.write")]
    [HttpPost("rules")]
    public async Task<IActionResult> CreateRule([FromBody] CreateRuleRequest req)
    {
        try
        {
            var rule = await _ruleEngine.CreateRuleAsync(req.RuleCode, req.RuleName, req.RuleType, req.ExpressionJson, req.Severity, req.CreatedBy ?? "system-admin");
            return Created($"/api/rules/{rule.RuleId}", MapRule(rule));
        }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [Authorize(Policy = "rules_engine.write")]
    [HttpPut("rules/{ruleCode}")]
    public async Task<IActionResult> UpdateRule(string ruleCode, [FromBody] UpdateRuleRequest req)
    {
        try
        {
            var rule = await _ruleEngine.UpdateRuleAsync(ruleCode, req.RuleName, req.ExpressionJson, req.Severity, req.UpdatedBy ?? "system-admin");
            if (rule == null) return NotFound(new { error = $"Rule code '{ruleCode}' not found." });
            return Ok(MapRule(rule));
        }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [Authorize(Policy = "rules_engine.write")]
    [HttpPost("rules/{id:int}/activate")]
    public async Task<IActionResult> ActivateRule(int id)
    {
        bool ok = await _ruleEngine.SetRuleActiveAsync(id, true);
        if (!ok) return NotFound(new { error = "Rule not found." });
        return Ok(new { message = "Rule activated." });
    }

    [Authorize(Policy = "rules_engine.write")]
    [HttpPost("rules/{id:int}/deactivate")]
    public async Task<IActionResult> DeactivateRule(int id)
    {
        bool ok = await _ruleEngine.SetRuleActiveAsync(id, false);
        if (!ok) return NotFound(new { error = "Rule not found." });
        return Ok(new { message = "Rule deactivated." });
    }

    [Authorize(Policy = "rules_engine.read")]
    [HttpPost("rules/evaluate")]
    public async Task<IActionResult> EvaluateRules([FromBody] EvaluateRulesRequest req)
    {
        try
        {
            var context = req.Context ?? new Dictionary<string, object>();
            var result = await _ruleEngine.EvaluateAsync(req.RuleType, req.EntityType ?? "AdHocTest", req.EntityId ?? "0", context);
            return Ok(result);
        }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    private static object MapRule(BusinessRule r) => new
    {
        rule_id = r.RuleId,
        rule_code = r.RuleCode,
        rule_name = r.RuleName,
        rule_type = r.RuleType,
        expression_json = r.ExpressionJson,
        severity = r.Severity,
        version = r.Version,
        is_active = r.IsActive,
        effective_from = r.EffectiveFrom,
        created_by = r.CreatedBy,
        created_at = r.CreatedAt
    };
}

public class CreateRuleRequest
{
    public string RuleCode { get; set; } = null!;
    public string RuleName { get; set; } = null!;
    public string RuleType { get; set; } = null!;
    public string ExpressionJson { get; set; } = null!;
    public string Severity { get; set; } = "BLOCK";
    public string? CreatedBy { get; set; }
}

public class UpdateRuleRequest
{
    public string RuleName { get; set; } = null!;
    public string ExpressionJson { get; set; } = null!;
    public string Severity { get; set; } = "BLOCK";
    public string? UpdatedBy { get; set; }
}

public class EvaluateRulesRequest
{
    public string RuleType { get; set; } = null!;
    public string? EntityType { get; set; }
    public string? EntityId { get; set; }
    public Dictionary<string, object>? Context { get; set; }
}
