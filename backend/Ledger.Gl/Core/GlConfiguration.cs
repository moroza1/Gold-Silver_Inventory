using System.Text.Json;
using System.Text.Json.Serialization;

namespace Ledger.Gl.Core;

// ============================================================================
// CONFIGURATION LAYER
// ----------------------------------------------------------------------------
// Everything that varies per project lives here and is loadable from a JSON file
// (or built in code, or hydrated from a DB row) -- NO code changes required to
// re-map accounts, add a commodity, or change which account a purchase debits.
//
// A configuration is: a chart of accounts + a set of posting rules. A posting
// rule says "for THIS event type and (optionally) THIS commodity, debit account
// X and credit account Y for the event amount." Rules are matched most-specific
// first (commodity-specific rule beats a wildcard rule).
// ============================================================================

/// <summary>A single debit/credit target within a posting rule.</summary>
public sealed class PostingRuleLeg
{
    [JsonPropertyName("account")]
    public string Account { get; set; } = "";

    /// <summary>"Debit" or "Credit".</summary>
    [JsonPropertyName("side")]
    public PostingSide Side { get; set; }

    /// <summary>
    /// Fraction of the event amount posted to this leg (default 1.0 = full
    /// amount). Lets a rule split an amount across accounts (e.g. a sale that
    /// books revenue plus a separate fee). The debit legs and credit legs must
    /// each still sum to the full amount for the entry to balance.
    /// </summary>
    [JsonPropertyName("amountFactor")]
    public decimal AmountFactor { get; set; } = 1.0m;

    [JsonPropertyName("memo")]
    public string? Memo { get; set; }
}

/// <summary>
/// Maps one inventory event (optionally scoped to a commodity) to the set of GL
/// legs it produces. A rule with Commodity = null/"*" is the fallback for any
/// commodity of that event type.
/// </summary>
public sealed class PostingRule
{
    [JsonPropertyName("eventType")]
    public InventoryEventType EventType { get; set; }

    /// <summary>Commodity key this rule applies to, or null/"*" for any commodity.</summary>
    [JsonPropertyName("commodity")]
    public string? Commodity { get; set; }

    /// <summary>
    /// Optional extra match conditions on the event's Metadata (case-insensitive
    /// key AND value). A rule only applies when EVERY condition here is satisfied by
    /// the event. This is how ownership-aware custody segregation works, e.g.
    /// { "ownership": "CUSTOMER_OWNED" } routes a customer's metal to custody
    /// accounts instead of KFH's inventory accounts -- without a new event type.
    /// Generalizes to any dimension you put in InventoryEvent.Metadata (location,
    /// channel, counterparty class, ...). Empty/null = matches any event.
    /// </summary>
    [JsonPropertyName("match")]
    public Dictionary<string, string>? Match { get; set; }

    [JsonPropertyName("legs")]
    public List<PostingRuleLeg> Legs { get; set; } = new();

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    public bool IsWildcardCommodity =>
        string.IsNullOrWhiteSpace(Commodity) || Commodity == "*";
}

/// <summary>The whole configuration: chart of accounts + mapping rules + defaults.</summary>
public sealed class GlConfiguration
{
    [JsonPropertyName("baseCurrency")]
    public string BaseCurrency { get; set; } = "KWD";

    /// <summary>Chart of accounts.</summary>
    [JsonPropertyName("accounts")]
    public List<LedgerAccountConfig> Accounts { get; set; } = new();

    /// <summary>Event-to-account posting rules.</summary>
    [JsonPropertyName("rules")]
    public List<PostingRule> Rules { get; set; } = new();

    // ----- Loading helpers ---------------------------------------------------

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        Converters = { new JsonStringEnumConverter() }
    };

    public static GlConfiguration FromJson(string json) =>
        JsonSerializer.Deserialize<GlConfiguration>(json, JsonOpts)
        ?? throw new InvalidOperationException("GL configuration JSON deserialized to null.");

    public static GlConfiguration FromFile(string path) =>
        FromJson(File.ReadAllText(path));

    public string ToJson() => JsonSerializer.Serialize(this, new JsonSerializerOptions(JsonOpts) { WriteIndented = true });

    /// <summary>Materialize the configured chart of accounts into domain accounts.</summary>
    public IReadOnlyList<LedgerAccount> BuildAccounts() =>
        Accounts.Select(a => new LedgerAccount
        {
            Code = a.Code,
            Name = a.Name,
            Type = a.Type,
            Currency = string.IsNullOrWhiteSpace(a.Currency) ? BaseCurrency : a.Currency!,
            IsActive = a.IsActive
        }).ToList();

    /// <summary>
    /// Resolve the best rule for an event. A rule is ELIGIBLE only if its event type
    /// matches, its commodity is wildcard or an exact match, AND every one of its
    /// <see cref="PostingRule.Match"/> conditions is satisfied by <paramref name="attributes"/>
    /// (the event's Metadata). Among eligible rules the most SPECIFIC wins:
    /// more matched conditions beat fewer, then an exact commodity beats a wildcard.
    /// This lets an ownership-conditioned custody rule override the generic commodity
    /// rule. Returns null if nothing is eligible.
    /// </summary>
    public PostingRule? ResolveRule(
        InventoryEventType eventType,
        string commodity,
        IReadOnlyDictionary<string, string>? attributes = null)
    {
        PostingRule? best = null;
        int bestScore = -1;
        foreach (var r in Rules)
        {
            if (r.EventType != eventType) continue;

            bool exactCommodity = !r.IsWildcardCommodity &&
                string.Equals(r.Commodity, commodity, StringComparison.OrdinalIgnoreCase);
            if (!r.IsWildcardCommodity && !exactCommodity) continue; // commodity mismatch

            if (!ConditionsSatisfied(r.Match, attributes)) continue; // unmet match condition

            // Specificity: each satisfied condition is more decisive than commodity.
            int score = (r.Match?.Count ?? 0) * 10 + (exactCommodity ? 1 : 0);
            if (score > bestScore) { bestScore = score; best = r; }
        }
        return best;
    }

    private static bool ConditionsSatisfied(
        Dictionary<string, string>? conditions,
        IReadOnlyDictionary<string, string>? attributes)
    {
        if (conditions is null || conditions.Count == 0) return true;
        if (attributes is null) return false;
        foreach (var (key, expected) in conditions)
        {
            if (!attributes.TryGetValue(key, out var actual) ||
                !string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
                return false;
        }
        return true;
    }

    /// <summary>
    /// Structural validation of the config itself (run once at startup). Confirms
    /// every rule leg references a declared account and that each rule's debit and
    /// credit legs can balance. Throws with a readable message on the first fault.
    /// </summary>
    public void Validate()
    {
        var codes = new HashSet<string>(Accounts.Select(a => a.Code), StringComparer.OrdinalIgnoreCase);
        if (codes.Count != Accounts.Count)
            throw new GlConfigurationException("Duplicate account codes in chart of accounts.");

        foreach (var rule in Rules)
        {
            if (rule.Legs.Count == 0)
                throw new GlConfigurationException($"Rule {rule.EventType}/{rule.Commodity ?? "*"} has no legs.");

            foreach (var leg in rule.Legs)
            {
                if (!codes.Contains(leg.Account))
                    throw new GlConfigurationException(
                        $"Rule {rule.EventType}/{rule.Commodity ?? "*"} references unknown account '{leg.Account}'.");
                if (leg.AmountFactor <= 0)
                    throw new GlConfigurationException(
                        $"Rule {rule.EventType}/{rule.Commodity ?? "*"} leg for '{leg.Account}' has non-positive amountFactor.");
            }

            var debitFactor = rule.Legs.Where(l => l.Side == PostingSide.Debit).Sum(l => l.AmountFactor);
            var creditFactor = rule.Legs.Where(l => l.Side == PostingSide.Credit).Sum(l => l.AmountFactor);
            if (debitFactor != creditFactor)
                throw new GlConfigurationException(
                    $"Rule {rule.EventType}/{rule.Commodity ?? "*"} is unbalanced: debit factors sum to {debitFactor} but credit factors sum to {creditFactor}.");
        }
    }
}

/// <summary>Chart-of-accounts entry as it appears in configuration JSON.</summary>
public sealed class LedgerAccountConfig
{
    [JsonPropertyName("code")] public string Code { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("type")] public AccountType Type { get; set; }
    [JsonPropertyName("currency")] public string? Currency { get; set; }
    [JsonPropertyName("isActive")] public bool IsActive { get; set; } = true;
}

public sealed class GlConfigurationException : Exception
{
    public GlConfigurationException(string message) : base(message) { }
}
