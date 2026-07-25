using Ledger.Gl.Core;

namespace Ledger.Gl.Integration;

// ============================================================================
// EXAMPLE ADAPTER for the PMIMS precious-metals inventory system.
// ----------------------------------------------------------------------------
// This shows how to map an existing inventory transaction onto the standardized
// InventoryEvent WITHOUT the GL core ever referencing the inventory schema.
//
// It is written against a small local `InventoryTransactionSnapshot` DTO rather
// than PMIMS.Domain.InventoryTransaction directly, so this module stays a
// standalone package with no project reference to PMIMS. To wire it to the real
// system you have two equally valid options:
//
//   (A) Add a ProjectReference to PMIMS.Domain and change the adapter's TSource
//       to PMIMS.Domain.InventoryTransaction, reading the same fields.
//   (B) Keep this module dependency-free and, in PMIMS.Infrastructure, project
//       an InventoryTransaction into this snapshot at the point you post it
//       (recommended -- preserves the plug-and-play property).
//
// The PMIMS transaction fields used below all exist today on
// PMIMS.Domain.InventoryTransaction: TransactionType, InitiatedBy, ApprovedBy,
// TransactionTimestamp, RateUsed, FeesApplied, SourceOwnership, TransactionNumber.
// Commodity is derived from the item's MetalType (join Item -> Product ->
// MetalType.MetalName) and the amount from RateUsed * quantity (+ fees), which is
// exactly the landed/settled value PMIMS already computes for CoreBankingLedgerPosting.
// ============================================================================

/// <summary>
/// Minimal, host-agnostic projection of a PMIMS InventoryTransaction. Populate
/// this from the real entity at the call site; the adapter maps it to the GL.
/// </summary>
public sealed record InventoryTransactionSnapshot
{
    public required string TransactionNumber { get; init; }  // -> ExternalKey / SourceId
    public required string TransactionType { get; init; }     // PMIMS TransactionType enum name
    public required string Commodity { get; init; }           // e.g. "GOLD" / "SILVER" from MetalType.MetalName
    public required decimal Amount { get; init; }             // settled value in Currency
    public string Currency { get; init; } = "KWD";
    public required string InitiatedBy { get; init; }
    public string? ApprovedBy { get; init; }
    public DateTime OccurredAtUtc { get; init; } = DateTime.UtcNow;
    public string? Note { get; init; }
    public int? SourceLocationId { get; init; }
    public int? DestinationLocationId { get; init; }

    /// <summary>
    /// PMIMS OwnershipType: "KFH_OWNED" or "CUSTOMER_OWNED". Drives custody
    /// segregation via ownership-conditioned rules -- customer metal must not book to
    /// KFH's inventory-asset/revenue accounts. Source: InventoryTransaction.Source/
    /// DestinationOwnership (or the item's OwnershipType).
    /// </summary>
    public string Ownership { get; init; } = "KFH_OWNED";

    /// <summary>
    /// PMIMS ReceiptReason where relevant (e.g. "CUSTODY_DEPOSIT", "BUYBACK"). Lets the
    /// adapter tell a customer custody deposit apart from a KFH purchase.
    /// </summary>
    public string? ReceiptReason { get; init; }
}

/// <summary>
/// Maps PMIMS transaction types onto the module's canonical InventoryEventType.
/// PMIMS enum: RECEIPT, TRANSFER, SALE, PURCHASE, REDEMPTION, DISPATCH, ADJUSTMENT.
/// Anything that shouldn't hit the GL (e.g. a pure internal transfer you don't
/// want journaled) returns null and is silently skipped by the listener.
/// </summary>
public sealed class PmimsInventoryAdapter : IInventoryEventAdapter<InventoryTransactionSnapshot>
{
    public InventoryEvent? ToInventoryEvent(InventoryTransactionSnapshot t)
    {
        var eventType = t.TransactionType.ToUpperInvariant() switch
        {
            "PURCHASE" or "RECEIPT" => InventoryEventType.Purchase, // metal into KFH vaults
            "SALE" or "DISPATCH"    => InventoryEventType.Sale,     // metal out to a customer
            "REDEMPTION"            => InventoryEventType.Sale,      // customer redeems -> treated as sale-side
            "TRANSFER"              => InventoryEventType.Transfer,  // location move (GL-neutral)
            "ADJUSTMENT"            => InventoryEventType.Adjustment,
            _                        => (InventoryEventType?)null    // unknown -> skip
        };
        if (eventType is null) return null;

        return new InventoryEvent
        {
            EventType = eventType.Value,
            Commodity = t.Commodity,
            Amount = t.Amount,
            Currency = t.Currency,
            SourceType = "INVENTORY_TRANSACTION",              // origin traceability
            SourceId = t.TransactionNumber,
            InitiatedBy = t.ApprovedBy ?? t.InitiatedBy,        // prefer the checker (4-eyes) as GL principal
            Description = t.Note ?? $"{t.TransactionType} {t.TransactionNumber}",
            OccurredAtUtc = t.OccurredAtUtc,
            ExternalKey = $"INVENTORY_TRANSACTION:{t.TransactionNumber}", // idempotent re-posts
            Metadata = new Dictionary<string, string>
            {
                // "ownership" is read by the custody rules in the config to segregate
                // CUSTOMER_OWNED metal from KFH_OWNED metal at the account level.
                ["ownership"] = t.Ownership,
                ["receiptReason"] = t.ReceiptReason ?? "",
                ["transactionType"] = t.TransactionType,
                ["sourceLocationId"] = t.SourceLocationId?.ToString() ?? "",
                ["destinationLocationId"] = t.DestinationLocationId?.ToString() ?? "",
                ["initiatedBy"] = t.InitiatedBy,
                ["approvedBy"] = t.ApprovedBy ?? ""
            }
        };
    }
}
