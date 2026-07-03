using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using PMIMS.Domain;

namespace PMIMS.Application;

// ============================================================
// Dynamic Business Validation Rules Engine (RFP item 5)
// ------------------------------------------------------------
// Evaluates active BusinessRule rows of a given RuleType against a runtime
// context dictionary, without executing any stored code -- ExpressionJson is
// a structured predicate tree, walked recursively in-memory:
//   {"all": [ {"field":"weightGrams","op":"lte","value":5000}, ... ]}
//   {"any": [ ... ]}
//   leaf: {"field": "...", "op": "eq|neq|gt|gte|lt|lte|in|between", "value": ...}
// This mirrors the existing Maker-Checker workflow engine's "pluggable step"
// philosophy, but for validation rather than approval routing, and is
// ADDITIVE to (never a replacement for) existing hard-coded guards such as
// the vendor Sharia-compliance check in sp_CreatePurchaseOrder.
// ============================================================
public class RuleEngineService : IRuleEngineService
{
    private readonly IInventoryRepository _repository;

    public RuleEngineService(IInventoryRepository repository)
    {
        _repository = repository;
    }

    public Task<IEnumerable<BusinessRule>> GetRulesAsync(string? ruleType = null) =>
        _repository.GetBusinessRulesAsync(ruleType);

    public Task<BusinessRule?> GetRuleAsync(int ruleId) => _repository.GetBusinessRuleByIdAsync(ruleId);

    public Task<IEnumerable<BusinessRule>> GetRuleVersionsAsync(string ruleCode) =>
        _repository.GetBusinessRuleVersionsAsync(ruleCode);

    public async Task<BusinessRule> CreateRuleAsync(string ruleCode, string ruleName, string ruleType, string expressionJson, string severity, string createdBy)
    {
        ValidateExpression(expressionJson);
        ValidateRuleType(ruleType);
        ValidateSeverity(severity);

        if ((await _repository.GetBusinessRuleVersionsAsync(ruleCode)).Any())
            throw new InvalidOperationException($"Rule code '{ruleCode}' already exists -- use UpdateRuleAsync to create a new version instead.");

        var rule = new BusinessRule
        {
            RuleCode = ruleCode,
            RuleName = ruleName,
            RuleType = ruleType,
            ExpressionJson = expressionJson,
            Severity = severity,
            IsActive = true,
            EffectiveFrom = DateTime.UtcNow,
            CreatedBy = createdBy,
            CreatedAt = DateTime.UtcNow
        };
        return await _repository.AddBusinessRuleVersionAsync(rule);
    }

    public async Task<BusinessRule?> UpdateRuleAsync(string ruleCode, string ruleName, string expressionJson, string severity, string updatedBy)
    {
        var versions = (await _repository.GetBusinessRuleVersionsAsync(ruleCode)).ToList();
        var latest = versions.FirstOrDefault();
        if (latest == null) return null;

        ValidateExpression(expressionJson);
        ValidateSeverity(severity);

        var newVersion = new BusinessRule
        {
            RuleCode = ruleCode,
            RuleName = ruleName,
            RuleType = latest.RuleType, // rule type is immutable across versions of the same code
            ExpressionJson = expressionJson,
            Severity = severity,
            IsActive = true,
            EffectiveFrom = DateTime.UtcNow,
            CreatedBy = updatedBy,
            CreatedAt = DateTime.UtcNow
        };
        return await _repository.AddBusinessRuleVersionAsync(newVersion);
    }

    public Task<bool> SetRuleActiveAsync(int ruleId, bool isActive) => _repository.SetBusinessRuleActiveAsync(ruleId, isActive);

    public async Task<RuleEvaluationResult> EvaluateAsync(string ruleType, string entityType, string entityId, Dictionary<string, object> context)
    {
        var rules = (await _repository.GetBusinessRulesAsync(ruleType, activeOnly: true)).ToList();
        var result = new RuleEvaluationResult();

        foreach (var rule in rules)
        {
            bool matched;
            bool evaluationError = false;
            try
            {
                matched = EvaluateNode(JsonDocument.Parse(rule.ExpressionJson).RootElement, context);
            }
            catch (Exception)
            {
                // A malformed rule must never crash the calling business operation -- treat
                // it as non-blocking but surface a WARN so administrators notice and fix it.
                matched = false;
                evaluationError = true;
            }

            // A rule's predicate tree describes the CONDITION that flags a problem (e.g.
            // "weight > limit"); matched == true means the condition fired.
            string detailMessage = evaluationError
                ? $"{rule.RuleName}: could not be evaluated (malformed expression) -- treated as not-triggered."
                : matched
                    ? $"{rule.RuleName}: condition met -- {(rule.Severity == "BLOCK" ? "operation blocked." : "warning only.")}"
                    : $"{rule.RuleName}: condition not met.";

            result.Details.Add(new RuleEvaluationDetail
            {
                RuleId = rule.RuleId,
                RuleCode = rule.RuleCode,
                Result = matched ? (rule.Severity == "BLOCK" ? "FAIL" : "WARN") : "PASS",
                Severity = rule.Severity,
                Message = detailMessage
            });

            if (matched && rule.Severity == "BLOCK") result.Passed = false;

            await _repository.SaveBusinessRuleEvaluationAsync(new BusinessRuleEvaluation
            {
                RuleId = rule.RuleId,
                EntityType = entityType,
                EntityId = entityId,
                Result = matched ? (rule.Severity == "BLOCK" ? "FAIL" : "WARN") : "PASS",
                EvaluatedAt = DateTime.UtcNow,
                ContextJson = JsonSerializer.Serialize(context.ToDictionary(kv => kv.Key, kv => kv.Value?.ToString() ?? ""))
            });
        }

        return result;
    }

    // ---- predicate tree walker ----

    private static bool EvaluateNode(JsonElement node, Dictionary<string, object> context)
    {
        if (node.TryGetProperty("all", out var allArr))
            return allArr.EnumerateArray().All(child => EvaluateNode(child, context));
        if (node.TryGetProperty("any", out var anyArr))
            return anyArr.EnumerateArray().Any(child => EvaluateNode(child, context));

        string field = node.GetProperty("field").GetString() ?? throw new FormatException("Leaf node missing 'field'.");
        string op = node.GetProperty("op").GetString() ?? throw new FormatException("Leaf node missing 'op'.");
        var valueElement = node.GetProperty("value");

        if (!context.TryGetValue(field, out var actualObj) || actualObj == null) return false;

        return op.ToLowerInvariant() switch
        {
            "eq" => Compare(actualObj, valueElement) == 0,
            "neq" => Compare(actualObj, valueElement) != 0,
            "gt" => Compare(actualObj, valueElement) > 0,
            "gte" => Compare(actualObj, valueElement) >= 0,
            "lt" => Compare(actualObj, valueElement) < 0,
            "lte" => Compare(actualObj, valueElement) <= 0,
            "in" => valueElement.EnumerateArray().Any(v => Compare(actualObj, v) == 0),
            "between" => EvaluateBetween(actualObj, valueElement),
            _ => throw new NotSupportedException($"Unsupported rule operator '{op}'.")
        };
    }

    private static bool EvaluateBetween(object actual, JsonElement rangeArray)
    {
        var bounds = rangeArray.EnumerateArray().ToList();
        if (bounds.Count != 2) throw new FormatException("'between' requires exactly two values [min, max].");
        return Compare(actual, bounds[0]) >= 0 && Compare(actual, bounds[1]) <= 0;
    }

    // Numeric comparison when both sides parse as decimal; falls back to ordinal string
    // comparison otherwise (dates are compared as ISO-8601 strings, which sort correctly).
    private static int Compare(object actual, JsonElement expected)
    {
        string actualStr = actual.ToString() ?? "";
        if (decimal.TryParse(actualStr, out var actualNum) &&
            (expected.ValueKind == JsonValueKind.Number || decimal.TryParse(expected.GetString(), out _)))
        {
            decimal expectedNum = expected.ValueKind == JsonValueKind.Number ? expected.GetDecimal() : decimal.Parse(expected.GetString()!);
            return actualNum.CompareTo(expectedNum);
        }

        string expectedStr = expected.ValueKind == JsonValueKind.String ? expected.GetString()! : expected.ToString();
        return string.Compare(actualStr, expectedStr, StringComparison.OrdinalIgnoreCase);
    }

    private static void ValidateExpression(string expressionJson)
    {
        try { JsonDocument.Parse(expressionJson); }
        catch (JsonException ex) { throw new ArgumentException($"expressionJson is not valid JSON: {ex.Message}"); }
    }

    private static readonly HashSet<string> ValidRuleTypes = new(StringComparer.OrdinalIgnoreCase)
    { "TRANSFER_LIMIT", "RECEIPT_VALIDATION", "CUSTOMER_ELIGIBILITY", "RATE_THRESHOLD", "INVENTORY_CHECK" };

    private static void ValidateRuleType(string ruleType)
    {
        if (!ValidRuleTypes.Contains(ruleType))
            throw new ArgumentException($"Unsupported rule type '{ruleType}'. Must be one of: {string.Join(", ", ValidRuleTypes)}.");
    }

    private static void ValidateSeverity(string severity)
    {
        if (severity != "BLOCK" && severity != "WARN")
            throw new ArgumentException("severity must be 'BLOCK' or 'WARN'.");
    }
}
