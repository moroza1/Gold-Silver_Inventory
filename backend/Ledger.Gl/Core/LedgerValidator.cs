namespace Ledger.Gl.Core;

// ============================================================================
// Enforces the two non-negotiable ledger invariants before anything is stored:
//   1. Double-entry: sum(debits) == sum(credits), and at least two legs.
//   2. Account existence: every leg references an active, known account.
// Also does basic event sanity (positive amount, known commodity/currency).
// ============================================================================
public sealed class LedgerValidator
{
    private readonly IReadOnlyDictionary<string, LedgerAccount> _accounts;

    public LedgerValidator(IEnumerable<LedgerAccount> accounts)
    {
        _accounts = accounts.ToDictionary(a => a.Code, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Validate an inbound event before mapping. Throws on the first problem.</summary>
    public void ValidateEvent(InventoryEvent e)
    {
        if (e.Amount <= 0)
            throw new LedgerValidationException($"Event amount must be positive (was {e.Amount}) for {e.SourceType}:{e.SourceId}.");
        if (string.IsNullOrWhiteSpace(e.Commodity))
            throw new LedgerValidationException($"Event commodity is required for {e.SourceType}:{e.SourceId}.");
        if (string.IsNullOrWhiteSpace(e.SourceType) || string.IsNullOrWhiteSpace(e.SourceId))
            throw new LedgerValidationException("Event must carry SourceType and SourceId for traceability.");
        if (string.IsNullOrWhiteSpace(e.InitiatedBy))
            throw new LedgerValidationException($"Event must carry InitiatedBy for the audit trail ({e.SourceType}:{e.SourceId}).");
    }

    /// <summary>Validate the produced lines: accounts exist/active + double-entry balances.</summary>
    public void ValidateLines(IReadOnlyList<JournalLine> lines)
    {
        if (lines.Count < 2)
            throw new LedgerValidationException("A journal entry needs at least two legs (double-entry).");

        foreach (var line in lines)
        {
            if (line.Amount <= 0)
                throw new LedgerValidationException($"Journal line amount must be positive (account {line.AccountCode}).");
            if (!_accounts.TryGetValue(line.AccountCode, out var acct))
                throw new LedgerValidationException($"Journal line references unknown account '{line.AccountCode}'.");
            if (!acct.IsActive)
                throw new LedgerValidationException($"Journal line posts to inactive account '{line.AccountCode}'.");
        }

        var debits = lines.Where(l => l.Side == PostingSide.Debit).Sum(l => l.Amount);
        var credits = lines.Where(l => l.Side == PostingSide.Credit).Sum(l => l.Amount);
        if (debits != credits)
            throw new LedgerValidationException(
                $"Entry does not balance: debits {debits} != credits {credits}.");
    }

    public bool AccountExists(string code) => _accounts.ContainsKey(code);
    public IReadOnlyDictionary<string, LedgerAccount> Accounts => _accounts;
}

public sealed class LedgerValidationException : Exception
{
    public LedgerValidationException(string message) : base(message) { }
}
