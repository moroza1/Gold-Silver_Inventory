namespace Ledger.Gl.Core;

// ============================================================================
// Query / reporting surface: account balances (as of a date), transaction
// history, trial balance, and hash-chain integrity verification. Read-only;
// computes from whatever the ILedgerStore returns.
// ============================================================================

public sealed record AccountBalance(
    string AccountCode, string AccountName, AccountType Type,
    decimal Debits, decimal Credits, decimal Balance, PostingSide NormalSide);

public sealed record TrialBalanceRow(
    string AccountCode, string AccountName, decimal DebitBalance, decimal CreditBalance);

public sealed record TrialBalance(
    DateTime AsOfUtc, IReadOnlyList<TrialBalanceRow> Rows,
    decimal TotalDebits, decimal TotalCredits)
{
    public bool IsBalanced => TotalDebits == TotalCredits;
}

public sealed record IntegrityResult(bool Ok, long EntriesChecked, string? FirstBrokenEntryId, string? Detail);

public sealed class LedgerReports
{
    private readonly ILedgerStore _store;
    public LedgerReports(ILedgerStore store) => _store = store;

    /// <summary>Signed balance of one account as of an optional date (inclusive).</summary>
    public async Task<AccountBalance> GetBalanceAsync(string accountCode, DateTime? asOfUtc = null, CancellationToken ct = default)
    {
        var accounts = await _store.GetAccountsAsync(ct);
        var acct = accounts.FirstOrDefault(a => string.Equals(a.Code, accountCode, StringComparison.OrdinalIgnoreCase))
            ?? throw new LedgerValidationException($"Unknown account '{accountCode}'.");

        var entries = await _store.GetEntriesAsync(toUtc: asOfUtc, accountCode: accountCode, ct: ct);
        decimal debits = 0, credits = 0;
        foreach (var line in entries.SelectMany(e => e.Lines)
                     .Where(l => string.Equals(l.AccountCode, accountCode, StringComparison.OrdinalIgnoreCase)))
        {
            if (line.Side == PostingSide.Debit) debits += line.Amount; else credits += line.Amount;
        }

        // Signed so a positive number always means "more of what this account
        // normally holds": debit-normal = debits - credits, credit-normal = credits - debits.
        var balance = acct.NormalSide == PostingSide.Debit ? debits - credits : credits - debits;
        return new AccountBalance(acct.Code, acct.Name, acct.Type, debits, credits, balance, acct.NormalSide);
    }

    /// <summary>Balances for every account (as of an optional date).</summary>
    public async Task<IReadOnlyList<AccountBalance>> GetAllBalancesAsync(DateTime? asOfUtc = null, CancellationToken ct = default)
    {
        var accounts = await _store.GetAccountsAsync(ct);
        var result = new List<AccountBalance>();
        foreach (var a in accounts)
            result.Add(await GetBalanceAsync(a.Code, asOfUtc, ct));
        return result;
    }

    /// <summary>
    /// Transaction history: journal entries filtered by date range, account, and/or
    /// originating inventory record. This is the "trace back to the source" view.
    /// </summary>
    public Task<IReadOnlyList<JournalEntry>> GetHistoryAsync(
        DateTime? fromUtc = null, DateTime? toUtc = null, string? accountCode = null,
        string? sourceType = null, string? sourceId = null, CancellationToken ct = default) =>
        _store.GetEntriesAsync(fromUtc, toUtc, accountCode, sourceType, sourceId, ct);

    /// <summary>
    /// Classic trial balance: each account's debit- or credit-side balance as of a
    /// date, with column totals that must be equal for the books to be in balance.
    /// </summary>
    public async Task<TrialBalance> GetTrialBalanceAsync(DateTime? asOfUtc = null, CancellationToken ct = default)
    {
        var balances = await GetAllBalancesAsync(asOfUtc, ct);
        var rows = new List<TrialBalanceRow>();
        decimal totalDr = 0, totalCr = 0;

        foreach (var b in balances)
        {
            // Net debit/credit position = raw debits - raw credits; place it in the
            // correct column by sign (this is what makes the two totals reconcile).
            var net = b.Debits - b.Credits;
            decimal dr = net > 0 ? net : 0;
            decimal cr = net < 0 ? -net : 0;
            if (dr == 0 && cr == 0 && b.Debits == 0 && b.Credits == 0) continue; // skip untouched accounts
            rows.Add(new TrialBalanceRow(b.AccountCode, b.AccountName, dr, cr));
            totalDr += dr; totalCr += cr;
        }
        return new TrialBalance(asOfUtc ?? DateTime.UtcNow, rows, totalDr, totalCr);
    }

    /// <summary>
    /// Walk the hash chain and confirm no historical entry was altered: each entry's
    /// stored hash must equal a fresh recomputation, and must reference the prior
    /// entry's hash. Returns the first break if any.
    /// </summary>
    public async Task<IntegrityResult> VerifyIntegrityAsync(CancellationToken ct = default)
    {
        var entries = await _store.GetEntriesAsync(ct: ct);
        string? prev = null;
        long checkedCount = 0;
        foreach (var e in entries.OrderBy(e => e.SequenceNumber))
        {
            checkedCount++;
            if (e.PreviousHash != prev)
                return new IntegrityResult(false, checkedCount, e.EntryId,
                    $"Entry seq {e.SequenceNumber} PreviousHash does not match prior entry's hash (chain broken).");
            if (HashChain.Recompute(e) != e.EntryHash)
                return new IntegrityResult(false, checkedCount, e.EntryId,
                    $"Entry seq {e.SequenceNumber} content hash mismatch (entry was tampered with).");
            prev = e.EntryHash;
        }
        return new IntegrityResult(true, checkedCount, null, "Chain intact.");
    }
}
