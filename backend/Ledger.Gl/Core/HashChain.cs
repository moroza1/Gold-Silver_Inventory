using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Ledger.Gl.Core;

// ============================================================================
// Tamper-evident audit hashing. Each journal entry's hash is computed over its
// canonical content PLUS the previous entry's hash, forming a blockchain-style
// chain: altering any historical entry breaks every subsequent hash, which
// ILedgerReports.VerifyIntegrity detects. This gives the "transaction hash" the
// audit-trail requirement asks for, on top of the monotonic sequence number.
// ============================================================================
public static class HashChain
{
    /// <summary>
    /// Deterministic SHA-256 over the entry's identifying content. Field order and
    /// formatting are fixed here so the same logical entry always hashes the same
    /// (invariant culture, fixed decimal format) -- essential for re-verification.
    /// </summary>
    public static string ComputeEntryHash(
        long sequenceNumber,
        DateTime occurredAtUtc,
        string sourceType,
        string sourceId,
        InventoryEventType eventType,
        string commodity,
        string currency,
        string initiatedBy,
        IReadOnlyList<JournalLine> lines,
        string? previousHash)
    {
        var sb = new StringBuilder(256);
        sb.Append(sequenceNumber).Append('|');
        sb.Append(occurredAtUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture)).Append('|');
        sb.Append(sourceType).Append('|').Append(sourceId).Append('|');
        sb.Append(eventType).Append('|').Append(commodity).Append('|').Append(currency).Append('|');
        sb.Append(initiatedBy).Append('|');
        foreach (var l in lines)
        {
            sb.Append(l.AccountCode).Append(':')
              .Append(l.Side).Append(':')
              .Append(l.Amount.ToString("F6", CultureInfo.InvariantCulture)).Append(';');
        }
        sb.Append('|').Append(previousHash ?? "GENESIS");

        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString()));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    /// <summary>Recompute an existing entry's hash to check it hasn't been altered.</summary>
    public static string Recompute(JournalEntry e) => ComputeEntryHash(
        e.SequenceNumber, e.OccurredAtUtc, e.SourceType, e.SourceId,
        e.SourceEventType, e.Commodity, e.Currency, e.InitiatedBy, e.Lines, e.PreviousHash);
}
