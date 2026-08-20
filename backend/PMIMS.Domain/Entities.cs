using System;
using System.Collections.Generic;

namespace PMIMS.Domain;

public class StatusCodes
{
    public string StatusCode { get; set; } = null!;
    public string Description { get; set; } = null!;
    public string Category { get; set; } = null!;
}

public class ReasonCodes
{
    public string ReasonCode { get; set; } = null!;
    public string Description { get; set; } = null!;
    public string Category { get; set; } = null!;
}

public class MetalType
{
    public int MetalTypeId { get; set; }
    public string MetalName { get; set; } = null!;
}

public class MetalPurityLevel
{
    public int PurityId { get; set; }
    public decimal PurityValue { get; set; }
    public string? Description { get; set; }
}

public class MetalDenomination
{
    public int DenominationId { get; set; }
    public decimal WeightGrams { get; set; }
    public decimal WeightOunces { get; set; }
    public string Label { get; set; } = null!;
    public int MetalTypeId { get; set; }
    public MetalType? MetalType { get; set; }
}

public class MetalBrand
{
    public int BrandId { get; set; }
    public string BrandCode { get; set; } = null!;
    public string BrandName { get; set; } = null!;
    public string CountryOfOrigin { get; set; } = "Switzerland";
    public string? LbmaRefinerId { get; set; }
    public bool IsLbmaCertified { get; set; } = true;
    public bool IsActive { get; set; } = true;
    public string? Description { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class MetalProduct
{
    public int ProductId { get; set; }
    public string ProductCode { get; set; } = null!;
    public int MetalTypeId { get; set; }
    public int DenominationId { get; set; }
    public int PurityId { get; set; }
    public string OriginCountry { get; set; } = null!;
    public int? BrandId { get; set; }
    public string? BrandName { get; set; }
    public bool IsActive { get; set; } = true;

    public MetalType? MetalType { get; set; }
    public MetalDenomination? Denomination { get; set; }
    public MetalPurityLevel? Purity { get; set; }
    public MetalBrand? Brand { get; set; }
}

public class Vendor
{
    public int VendorId { get; set; }
    public string VendorCode { get; set; } = null!;
    public string VendorName { get; set; } = null!;
    public string CountryOfOrigin { get; set; } = null!;
    public bool IsShariaCompliant { get; set; } = true;
    public string ContactEmail { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Vault
{
    public int VaultId { get; set; }
    public string VaultName { get; set; } = null!;
    public string LocationDescription { get; set; } = null!;
    public decimal MaxWeightCapacityKg { get; set; }
    public bool IsActive { get; set; } = true;
}

public class Branch
{
    public int BranchId { get; set; }
    public string BranchCode { get; set; } = null!;
    public string BranchName { get; set; } = null!;
    public int VaultId { get; set; }
    public bool IsActive { get; set; } = true;

    public Vault? Vault { get; set; }
}

public class Channel
{
    public int ChannelId { get; set; }
    public string ChannelName { get; set; } = null!;
    public bool IsActive { get; set; } = true;
}

public class InventoryLocation
{
    public int LocationId { get; set; }
    public int VaultId { get; set; }
    public int? BranchId { get; set; }
    public string ZoneRoom { get; set; } = null!;
    public string ShelfRow { get; set; } = null!;
    public string SlotBin { get; set; } = null!;
    public string Description { get; set; } = null!; // Computed persisted column in SQL, read-only in C#

    public Vault? Vault { get; set; }
    public Branch? Branch { get; set; }
}

public class Customer
{
    public int CustomerId { get; set; }
    public string CivilId { get; set; } = null!;
    public string CustomerName { get; set; } = null!;
    public string MobileNumber { get; set; } = null!;
    public string? Email { get; set; }
    public bool IsActive { get; set; } = true;
}

public class CustomerAccount
{
    public int AccountId { get; set; }
    public int CustomerId { get; set; }
    public string AccountNumber { get; set; } = null!;
    public string Currency { get; set; } = "KWD";

    public Customer? Customer { get; set; }
}

public class PurchaseOrder
{
    public int PoId { get; set; }
    public string PoNumber { get; set; } = null!;
    public int VendorId { get; set; }
    public DateTime OrderDate { get; set; } = DateTime.UtcNow;
    public DateTime? ExpectedDeliveryDate { get; set; }
    public decimal TotalWeightGrams { get; set; }
    public decimal TotalCost { get; set; }
    public string Currency { get; set; } = "USD";
    public string StatusCode { get; set; } = "PENDING_APPROVAL";
    public string CreatedBy { get; set; } = null!;
    public string? ApprovedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // ============================================================
    // Cost Tracking & Valuation -- purchase cost detail (RFP: "Record purchase
    // cost details (supplier, invoice, fees)"). Supplier is already captured
    // via VendorId/Vendor; these add the supplier invoice reference and the
    // landed-cost fee breakdown (freight/insurance/customs/other) that a real
    // acquisition incurs on top of the line-item cost (TotalCost). All
    // nullable/defaulted to 0 so this is purely additive -- every existing PO
    // (seeded or created before this field set existed) just has no fees.
    // ============================================================
    public string? SupplierInvoiceNumber { get; set; }
    public DateTime? SupplierInvoiceDate { get; set; }
    public decimal FreightCost { get; set; } = 0;
    public decimal InsuranceCost { get; set; } = 0;
    public decimal CustomsDutyCost { get; set; } = 0;
    public decimal OtherFeesCost { get; set; } = 0;
    public string? OtherFeesDescription { get; set; }

    // Total acquisition ("landed") cost = line-item cost plus every acquisition
    // fee above. This -- not the bare TotalCost -- is what actually flows into
    // InventoryLot.AverageUnitCost at intake (see
    // InventoryRepository.IntakeInventoryItemsAsync), so the Average Cost
    // Method valuation reflects the true cost of getting the metal into the
    // vault, not just what the vendor invoiced for the metal itself. Computed,
    // not persisted (see AppDbContext: Ignore(e => e.LandedCost)).
    public decimal LandedCost => TotalCost + FreightCost + InsuranceCost + CustomsDutyCost + OtherFeesCost;

    public Vendor? Vendor { get; set; }
    public List<POItem> Items { get; set; } = new();
}

public class POItem
{
    public int PoItemId { get; set; }
    public int PoId { get; set; }
    public int ProductId { get; set; }
    public int OrderedQuantity { get; set; }
    public int ReceivedQuantity { get; set; }
    public decimal UnitCost { get; set; }

    public MetalProduct? Product { get; set; }
}

public class InventoryLot
{
    public int LotId { get; set; }
    public string LotNumber { get; set; } = null!;
    public int? PoId { get; set; }
    public int VendorId { get; set; }
    public DateTime AcquisitionDate { get; set; } = DateTime.UtcNow;
    public int TotalItems { get; set; }
    public decimal AverageUnitCost { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // UC03: Receipt of Precious Metals from Supplier attributes
    public string? ShipmentReference { get; set; }
    public string? DeliveryNoteNumber { get; set; }
    public string? AirwayBillNumber { get; set; }
    public string? SupportingDocumentUrl { get; set; }
    public string? DiscrepancyNotes { get; set; }
    public DateTime? ReceivingDate { get; set; }

    public PurchaseOrder? PurchaseOrder { get; set; }
    public Vendor? Vendor { get; set; }
}

public class InventoryItem
{
    public int ItemId { get; set; }
    public string SerialNumber { get; set; } = null!;
    public int ProductId { get; set; }
    public int LotId { get; set; }
    public int? LocationId { get; set; }
    public string OwnershipType { get; set; } = "KFH_OWNED";
    public string StatusCode { get; set; } = "READY";
    public byte[] RowVersion { get; set; } = null!; // Concurrency lock

    // ============================================================
    // LBMA Good Delivery attributes (per-bar) -- captured at intake so every
    // serialized bar carries the refiner/assay/fineness/hallmark data the LBMA
    // Good Delivery List rules require for physical settlement and audit.
    // Nullable/optional so existing rows (seeded or intake'd before this field
    // existed) don't need a backfill migration -- GetLbmaComplianceReportAsync
    // (IInventoryRepository) surfaces bars missing this data as a gap to close,
    // rather than silently treating them as compliant.
    // ============================================================
    public string? RefinerName { get; set; }
    public string? RefinerLbmaId { get; set; }          // LBMA-assigned Good Delivery refiner reference
    public string? AssayCertificateNumber { get; set; }
    public decimal? FinenessPpt { get; set; }            // Fineness in parts-per-thousand, e.g. 999.9
    public string? HallmarkNumber { get; set; }
    // NOT_ASSESSED (no data yet) | GDL_LISTED (refiner is on the current LBMA
    // Good Delivery List) | NOT_LISTED (assessed and found not GDL-eligible)
    public string GoodDeliveryStatus { get; set; } = "NOT_ASSESSED";

    // GFS & Damaged fields
    public string? CustomerAccountNumber { get; set; }
    public decimal? AveragePurchaseCost { get; set; }
    public DateTime? GfsLastSyncAt { get; set; }
    public bool IsDamaged { get; set; } = false;
    public string? DamageReason { get; set; }
    public string? DamageDescription { get; set; }
    public DateTime? InspectionDate { get; set; }
    public string? DamageEvidenceDocId { get; set; }
    public string DamageApprovalStatus { get; set; } = "NONE"; // NONE, PENDING_APPROVAL, APPROVED, REJECTED
    public string? DamageReportedBy { get; set; }
    public string? DamageApprovedBy { get; set; }
    public DateTime? DamageApprovedAt { get; set; }

    // Kuwait MOCI Assay (إدارة المعادن الثمينة - وسم وزارة التجارة والصناعة)
    public string? MociAssayNumber { get; set; }
    public DateTime? MociInspectionDate { get; set; }

    public int? BrandId { get; set; }
    public MetalBrand? Brand { get; set; }

    public MetalProduct? Product { get; set; }
    public InventoryLot? Lot { get; set; }
    public InventoryLocation? Location { get; set; }
}

// ============================================================
// LBMA Chain-of-Custody Log
// ------------------------------------------------------------
// Append-only ledger of every custody-relevant event for a serialized bar
// (received, assayed, transferred, reserved, sold, withdrawn, dispensed via a
// Gold Dispensing Machine, quarantined). This is distinct from the general
// AuditLog (which is about "who did what in the system") and from
// InventoryTransaction (which is about ledger postings) -- ChainOfCustodyEvent
// is the LBMA-facing physical-custody narrative for a single bar, suitable for
// an examiner or auditor to read top-to-bottom for one SerialNumber.
// ============================================================
public class ChainOfCustodyEvent
{
    public int CustodyEventId { get; set; }
    public int ItemId { get; set; }
    // RECEIVED, ASSAYED, TRANSFERRED, RESERVED, SOLD, WITHDRAWN, DISPENSED_GDM, QUARANTINED, RELEASED
    public string EventType { get; set; } = null!;
    public int? LocationId { get; set; }
    public string RecordedBy { get; set; } = null!;
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;
    public string? ReferenceNumber { get; set; } // PO number, transfer/withdrawal/dispense number, etc.
    public string? Notes { get; set; }

    public InventoryItem? Item { get; set; }
    public InventoryLocation? Location { get; set; }
}

// ============================================================
// IFRS Valuation Disclosure Snapshot
// ------------------------------------------------------------
// Point-in-time accounting disclosure record, computed alongside (not instead
// of) the existing per-item /reports/valuation view. Captures the IAS 2
// "lower of cost and net realizable value" test and an IFRS 13 fair-value
// hierarchy classification for the live spot-price mark, per metal type, so
// Finance can attach a reproducible snapshot to the period-end GL package
// without re-deriving it from raw item rows later.
// ============================================================
public class IfrsValuationDisclosure
{
    public int DisclosureId { get; set; }
    public DateTime SnapshotDate { get; set; } = DateTime.UtcNow;
    public int MetalTypeId { get; set; }
    public string Currency { get; set; } = "KWD";
    public decimal TotalWeightGrams { get; set; }
    // IAS 2 cost: weighted-average acquisition cost of on-hand inventory.
    public decimal CostBasisTotal { get; set; }
    // Estimated selling price less costs to sell (IAS 2 para 6/28-33). This
    // implementation uses live bid rate as a proxy for NRV in absence of a
    // separately configured selling-cost rate -- see gap-analysis doc.
    public decimal NetRealizableValueTotal { get; set; }
    // IFRS 13 fair value (mark-to-market at spot/ask).
    public decimal FairValueTotal { get; set; }
    // IFRS 13 fair value hierarchy: 1 = quoted price in active market (LBMA
    // spot), 2 = observable inputs, 3 = unobservable inputs. Physical bullion
    // priced off the LBMA/360T live feed is Level 1.
    public int FairValueHierarchyLevel { get; set; } = 1;
    public decimal LowerOfCostOrNrvTotal { get; set; }
    public decimal ImpairmentLossRecognized { get; set; }
    public string GeneratedBy { get; set; } = null!;
    public DateTime GeneratedAt { get; set; } = DateTime.UtcNow;

    public MetalType? MetalType { get; set; }
}

// ============================================================


public class InventoryBalance
{
    public int BalanceId { get; set; }
    public int LocationId { get; set; }
    public int ProductId { get; set; }
    public string OwnershipType { get; set; } = "KFH_OWNED";
    public int ReadyForSaleQty { get; set; }
    public int ReservedQty { get; set; }
    public int SoldQty { get; set; }
    public int QuarantinedQty { get; set; }
    public int InTransitQty { get; set; }
    public DateTime LastUpdated { get; set; } = DateTime.UtcNow;

    public InventoryLocation? Location { get; set; }
    public MetalProduct? Product { get; set; }
}

public class CustomerHolding
{
    public int HoldingId { get; set; }
    public int? CustomerId { get; set; }  // Internal customer ID (nullable for external customers from KFHOnline)
    public string? CustomerRim { get; set; }  // External customer RIM from KFHOnline or other systems
    public string? CustomerName { get; set; }  // Customer name from external system
    public int? AccountId { get; set; }  // Nullable - external customers may not have internal accounts
    public int ItemId { get; set; }
    public DateTime AllocationDate { get; set; } = DateTime.UtcNow;
    public string? CustodyAgreementNumber { get; set; }
    public decimal CustodyFeeRate { get; set; }
    public string StatusCode { get; set; } = "HELD_IN_CUSTODY";

    public Customer? Customer { get; set; }
    public CustomerAccount? Account { get; set; }
    public InventoryItem? Item { get; set; }
}

public class CustomerAllocation
{
    public int AllocationId { get; set; }
    public int HoldingId { get; set; }
    public int AssignedLocationId { get; set; }
    public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReleasedAt { get; set; }

    public CustomerHolding? CustomerHolding { get; set; }
    public InventoryLocation? AssignedLocation { get; set; }
}

public class ReservationRequest
{
    public int ReservationId { get; set; }
    public Guid ReservationToken { get; set; } = Guid.NewGuid();
    public int CustomerId { get; set; }
    public int ItemId { get; set; }
    public int ChannelId { get; set; }
    public DateTime ReservedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public string IdempotencyKey { get; set; } = null!;
    public string StatusCode { get; set; } = "ACTIVE";

    public Customer? Customer { get; set; }
    public InventoryItem? Item { get; set; }
    public Channel? Channel { get; set; }
}

public class InventoryTransaction
{
    public int TransactionId { get; set; }
    public string TransactionNumber { get; set; } = null!;
    public int ItemId { get; set; }
    public string TransactionType { get; set; } = null!;
    public int? SourceLocationId { get; set; }
    public int? DestinationLocationId { get; set; }
    public string SourceOwnership { get; set; } = null!;
    public string DestinationOwnership { get; set; } = null!;
    public decimal? RateUsed { get; set; }
    public decimal? FeesApplied { get; set; }
    public string InitiatedBy { get; set; } = null!;
    public string? ApprovedBy { get; set; }
    public DateTime TransactionTimestamp { get; set; } = DateTime.UtcNow;

    public InventoryItem? Item { get; set; }
    public InventoryLocation? SourceLocation { get; set; }
    public InventoryLocation? DestinationLocation { get; set; }
}

public class MovementTransaction
{
    public int MovementId { get; set; }
    public int TransactionId { get; set; }
    public string? CourierDetails { get; set; }
    public string? SecurityEscortName { get; set; }
    public string? ShipmentRefNumber { get; set; }
    public DateTime? DepartureTime { get; set; }
    public DateTime? ArrivalTime { get; set; }

    public InventoryTransaction? Transaction { get; set; }
}

public class SalesOrder
{
    public int OrderId { get; set; }
    public string OrderNumber { get; set; } = null!;
    public int CustomerId { get; set; }
    public int AccountId { get; set; }
    public int ItemId { get; set; }
    public int ChannelId { get; set; }
    public decimal SalePrice { get; set; }
    public decimal MarkupAmount { get; set; }
    public string? InvoiceNumber { get; set; }
    public DateTime SoldAt { get; set; } = DateTime.UtcNow;

    public Customer? Customer { get; set; }
    public CustomerAccount? Account { get; set; }
    public InventoryItem? Item { get; set; }
    public Channel? Channel { get; set; }
}

public class RedemptionRequest
{
    public int RedemptionId { get; set; }
    public string RedemptionNumber { get; set; } = null!;
    public int HoldingId { get; set; }
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;
    public string StatusCode { get; set; } = "PENDING";
    public string? ApprovedBy { get; set; }

    public CustomerHolding? Holding { get; set; }
}

public class WithdrawalRequest
{
    public int WithdrawalId { get; set; }
    public int? RedemptionId { get; set; }
    public int HoldingId { get; set; }
    public int DestinationBranchId { get; set; }
    public string VerificationOtp { get; set; } = null!;
    public DateTime? WithdrawnAt { get; set; }
    public string? RecipientSignature { get; set; }
    public string StatusCode { get; set; } = "PENDING";

    public RedemptionRequest? Redemption { get; set; }
    public CustomerHolding? Holding { get; set; }
    public Branch? DestinationBranch { get; set; }
}

public class StocktakeSession
{
    public int SessionId { get; set; }
    public string SessionCode { get; set; } = null!;
    public int VaultId { get; set; }
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
    public string InitiatedBy { get; set; } = null!;
    public string? ApprovedBy { get; set; }
    public string StatusCode { get; set; } = "ACTIVE";

    public Vault? Vault { get; set; }
}

public class StocktakeFreeze
{
    public int FreezeId { get; set; }
    public int SessionId { get; set; }
    public int LocationId { get; set; }
    public DateTime FrozenAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReleasedAt { get; set; }

    public StocktakeSession? Session { get; set; }
    public InventoryLocation? Location { get; set; }
}

public class StocktakeScan
{
    public int ScanId { get; set; }
    public int SessionId { get; set; }
    public string ScannedSerial { get; set; } = null!;
    public int LocationId { get; set; }
    public string ScannedBy { get; set; } = null!;
    public DateTime ScannedAt { get; set; } = DateTime.UtcNow;

    public StocktakeSession? Session { get; set; }
    public InventoryLocation? Location { get; set; }
}

public class ReconciliationRun
{
    public int RunId { get; set; }
    public DateTime RunTimestamp { get; set; } = DateTime.UtcNow;
    public string ExecutedBy { get; set; } = null!;
    public int TotalItemsChecked { get; set; }
    public int TotalDiscrepancies { get; set; }
    public string StatusCode { get; set; } = "COMPLETED";
}

public class ReconciliationItem
{
    public int ReconItemId { get; set; }
    public int RunId { get; set; }
    public int? ItemId { get; set; }
    public int PmimsBalance { get; set; }
    public int CoreBalance { get; set; }
    public bool MismatchDetected { get; set; }

    public ReconciliationRun? Run { get; set; }
    public InventoryItem? Item { get; set; }
}

public class MismatchCase
{
    public int CaseId { get; set; }
    public int ReconItemId { get; set; }
    public string? InvestigatorComments { get; set; }
    public string? ReasonCode { get; set; }
    public string? ResolvedBy { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public string StatusCode { get; set; } = "OPEN";

    public ReconciliationItem? ReconItem { get; set; }
}

public class ExchangeRate
{
    public int RateId { get; set; }
    public int MetalTypeId { get; set; }
    public string RateSource { get; set; } = "360T";
    public decimal BidRate { get; set; }
    public decimal AskRate { get; set; }
    public DateTime CapturedAt { get; set; } = DateTime.UtcNow;

    public MetalType? MetalType { get; set; }
}

public class ValuationSnapshot
{
    public int SnapshotId { get; set; }
    public DateTime SnapshotTimestamp { get; set; } = DateTime.UtcNow;
    public decimal TotalGoldWeightGrams { get; set; }
    public decimal TotalSilverWeightGrams { get; set; }
    public decimal GoldValuationKwd { get; set; }
    public decimal SilverValuationKwd { get; set; }
    public string CalculatedBy { get; set; } = null!;
}

public class WorkflowInstance
{
    public int InstanceId { get; set; }
    public string WorkflowType { get; set; } = null!;
    public int EntityId { get; set; }
    public string StatusCode { get; set; } = "PENDING_MAKER";
    public int CurrentStepOrder { get; set; } = 1;
    public int? TemplateId { get; set; }
    public string InitiatedBy { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class ApprovalAction
{
    public int ActionId { get; set; }
    public int InstanceId { get; set; }
    public string ApproverUsername { get; set; } = null!;
    public string ActionTaken { get; set; } = null!; // APPROVED, REJECTED, RETURNED_WITH_COMMENTS
    public string? Comments { get; set; }
    public DateTime ActionTimestamp { get; set; } = DateTime.UtcNow;

    public WorkflowInstance? Instance { get; set; }
}

public class AuditLog
{
    public int LogId { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public string Username { get; set; } = null!;
    public string IpAddress { get; set; } = null!;
    public string ModuleName { get; set; } = null!;
    public string ActionDescription { get; set; } = null!;
    public string? SqlExecuted { get; set; }

    // Enhanced Audit Trail UI (RFP item 6) -- optional, backward-compatible with every
    // existing SaveAuditLogAsync call site. EntityType/EntityId support drill-down from a
    // search result to the specific record it concerns; RowHash is a SHA-256 tamper-detection
    // fingerprint computed over the row's other fields at insert time (see
    // AuditExportService.ComputeRowHash) -- recomputed on read and compared, a mismatch means
    // the row was altered in place after insert. Rows written before this column existed have
    // RowHash == null and are reported as "Unverified (pre-dates hashing)", not a false tamper flag.
    public string? EntityType { get; set; }
    public string? EntityId { get; set; }
    public string? RowHash { get; set; }
}

// ============================================================
// Dynamic Business Validation Rules Engine (RFP item 5)
// ------------------------------------------------------------
// Rules are stored as a structured predicate tree (ExpressionJson), never as executable code,
// so there is no code-injection surface: {"all":[{"field":"weightGrams","op":"lte","value":5000}]}
// or {"any":[...]} with leaf nodes {"field","op","value"}. Supported ops: eq, neq, gt, gte, lt,
// lte, in, between. See IRuleEngineService / RuleEngineService.
//
// Versioning is append-only: UpdateRuleAsync inserts a new row with the same RuleCode and
// Version+1, and marks the previous version's IsActive=false ("superseded") rather than
// mutating it in place -- so GetRuleVersionsAsync always has a real history to show.
// ============================================================
public class BusinessRule
{
    public int RuleId { get; set; }
    public string RuleCode { get; set; } = null!;
    public string RuleName { get; set; } = null!;
    public string RuleType { get; set; } = null!; // TRANSFER_LIMIT, RECEIPT_VALIDATION, CUSTOMER_ELIGIBILITY, RATE_THRESHOLD, INVENTORY_CHECK
    public string ExpressionJson { get; set; } = null!;
    public string Severity { get; set; } = "BLOCK"; // BLOCK (fails the operation) | WARN (logged only)
    public int Version { get; set; } = 1;
    public bool IsActive { get; set; } = true;
    public DateTime EffectiveFrom { get; set; } = DateTime.UtcNow;
    public DateTime? EffectiveTo { get; set; }
    public string CreatedBy { get; set; } = "SYSTEM";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class BusinessRuleEvaluation
{
    public int EvaluationId { get; set; }
    public int RuleId { get; set; }
    public string EntityType { get; set; } = null!;
    public string EntityId { get; set; } = null!;
    public string Result { get; set; } = null!; // PASS, FAIL, WARN
    public DateTime EvaluatedAt { get; set; } = DateTime.UtcNow;
    public string? ContextJson { get; set; }

    public BusinessRule? Rule { get; set; }
}

// ============================================================
// Automatic Management Email Notifications (RFP item 7)
// ============================================================
public class NotificationSubscription
{
    public int SubscriptionId { get; set; }
    public string DistributionListEmail { get; set; } = null!;
    // Cron-scheduled batch: INVENTORY_BALANCE, LOW_STOCK, HIGH_VALUE_MOVEMENT.
    // Event-triggered (immediate, ScheduleCron unused): TRANSFER_COMPLETED, INVENTORY_DISCREPANCY.
    public string ReportType { get; set; } = null!;
    public string ScheduleCron { get; set; } = null!; // e.g. "0 7 * * *" (daily 07:00)
    public string Format { get; set; } = "PDF"; // PDF, XLSX, BOTH
    public bool IsActive { get; set; } = true;
    public DateTime? LastRunAt { get; set; }
    public DateTime? UnsubscribedAt { get; set; }
    public string CreatedBy { get; set; } = "SYSTEM";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class NotificationDelivery
{
    public int DeliveryId { get; set; }
    public int SubscriptionId { get; set; }
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
    public string StatusCode { get; set; } = "SENT"; // SENT, FAILED, BOUNCED
    public string? MessageId { get; set; }
    public string? FailureReason { get; set; }

    public NotificationSubscription? Subscription { get; set; }
}

// ============================================================
// KFH Existing Monitoring Tool Integration (RFP item 8)
// ------------------------------------------------------------
// Generic adapter model (IMonitoringAdapter) so PMIMS can push to whichever tool KFH already
// runs without a vendor SDK baked into the core -- monitoring_events is the local
// buffer/audit of everything pushed, independent of whether the push itself succeeded.
// ============================================================
public class MonitoringEvent
{
    public int EventId { get; set; }
    public string EventType { get; set; } = null!; // HEALTH_CHECK, SLA_METRIC, ALERT
    public string ServiceName { get; set; } = "PMIMS";
    public string MetricName { get; set; } = null!;
    public string MetricValue { get; set; } = null!;
    public string Severity { get; set; } = "INFO"; // INFO, WARNING, CRITICAL
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
    public DateTime? PushedAt { get; set; }
    public string PushStatus { get; set; } = "PENDING"; // PENDING, SENT, FAILED, DISABLED
}

public class MonitoringAlertRoute
{
    public int RouteId { get; set; }
    public string EventType { get; set; } = null!;
    public string Severity { get; set; } = null!;
    public string Destination { get; set; } = null!; // webhook URL, on-call group name, etc.
    public bool IsActive { get; set; } = true;
}

public class DocumentUpload
{
    public int DocumentId { get; set; }
    public string FileName { get; set; } = null!;
    public string FilePath { get; set; } = null!;
    public string Sha256Hash { get; set; } = null!;
    public string UploadedBy { get; set; } = null!;
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
}

public class ExtractedDocumentField
{
    public int FieldId { get; set; }
    public int DocumentId { get; set; }
    public string FieldName { get; set; } = null!;
    public string ExtractedValue { get; set; } = null!;
    public decimal ConfidenceScore { get; set; }

    public DocumentUpload? Document { get; set; }
}

public class UserRole
{
    public int RoleId { get; set; }
    public string RoleName { get; set; } = null!;
    public string? Description { get; set; }
}

public class UserPermission
{
    public int PermissionId { get; set; }
    public int RoleId { get; set; }
    public string PermissionName { get; set; } = null!;
    public bool IsGranted { get; set; } = true;

    public UserRole? Role { get; set; }
}

public class MigrationStagingItem
{
    public int StagingId { get; set; }
    public string SerialNumber { get; set; } = null!;
    public string ProductCode { get; set; } = null!;
    public decimal AcquisitionCost { get; set; }
    public string VaultName { get; set; } = null!;
    public string ZoneRoom { get; set; } = null!;
    public string ShelfRow { get; set; } = null!;
    public string SlotBin { get; set; } = null!;
    public string OwnershipType { get; set; } = null!;
    public string? CustomerCivilId { get; set; }
    public string? ValidationErrors { get; set; }
    public bool IsValid { get; set; } = true;
}

public class WorkflowTemplate
{
    public int TemplateId { get; set; }
    public string WorkflowType { get; set; } = null!;
    public string Name { get; set; } = null!;
    public string Description { get; set; } = null!;
    public bool IsActive { get; set; } = true;
    public List<WorkflowStep> Steps { get; set; } = new();
}

public class WorkflowStep
{
    public int StepId { get; set; }
    public int TemplateId { get; set; }
    public int StepOrder { get; set; }
    public string StepName { get; set; } = null!;
    public string RequiredRole { get; set; } = null!;
    public string Description { get; set; } = null!;
}

// ============================================================
// Group-Based User Onboarding & Privilege Management
// ============================================================

public class AppUser
{
    public int UserId { get; set; }
    public string Username { get; set; } = null!;
    public string DisplayName { get; set; } = null!;
    public string Email { get; set; } = null!;
    public string PasswordHash { get; set; } = null!;
    // Algorithm used to produce PasswordHash: "SHA256" (legacy demo default),
    // "BCRYPT" (FIM SetPassword default per RFP), or "AES256" (reversible,
    // FIM-requested alternate). ActiveDirectoryService.AuthenticateAsync and
    // PasswordHasher dispatch on this value -- never assume SHA256.
    public string PasswordAlgorithm { get; set; } = "SHA256";
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = "SYSTEM";

    public List<UserGroupMembership> Memberships { get; set; } = new();
}

public class PrivilegeGroup
{
    public int GroupId { get; set; }
    public string GroupName { get; set; } = null!;
    public string Description { get; set; } = null!;
    public bool IsSystem { get; set; } = false;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<GroupPermission> Permissions { get; set; } = new();
    public List<UserGroupMembership> Members { get; set; } = new();
}

public class GroupPermission
{
    public int PermissionId { get; set; }
    public int GroupId { get; set; }
    public string ModuleKey { get; set; } = null!;  // e.g. "dashboard", "purchase_orders", "user_admin"
    public string AccessLevel { get; set; } = "HIDDEN"; // FULL, READ_WRITE, READ_ONLY, HIDDEN

    public PrivilegeGroup? Group { get; set; }
}

public class UserGroupMembership
{
    public int MembershipId { get; set; }
    public int UserId { get; set; }
    public int GroupId { get; set; }
    public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
    public string AssignedBy { get; set; } = "SYSTEM";

    public AppUser? User { get; set; }
    public PrivilegeGroup? Group { get; set; }
}

// ============================================================
// Stock Reorder Threshold (Low-Stock Alarm & Auto-Draft P.O.)
// ============================================================

public class ReorderThreshold
{
    public int ThresholdId { get; set; }
    public int ProductId { get; set; }
    public int VendorId { get; set; }
    public int MinStockQty { get; set; }
    public int ReorderQty { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public MetalProduct? Product { get; set; }
    public Vendor? Vendor { get; set; }
}

public class BranchTransfer
{
    public int TransferId { get; set; }
    public int ItemId { get; set; }
    public int SourceBranchId { get; set; }
    public int DestinationBranchId { get; set; }
    public string CourierInfo { get; set; } = null!;
    public string StatusCode { get; set; } = "PENDING_APPROVAL"; // PENDING_APPROVAL, APPROVED, REJECTED, IN_TRANSIT, COMPLETED
    public string CreatedBy { get; set; } = null!;
    public string? ApprovedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public InventoryItem? Item { get; set; }
    public Branch? SourceBranch { get; set; }
    public Branch? DestinationBranch { get; set; }
}

// ============================================================
// Receipt of precious metals -- supplier or customer sourced
// ------------------------------------------------------------
// A PendingIntake represents one Maker-initiated "receipt" request awaiting
// Maker-Checker sign-off, regardless of where the metal is coming from:
//   SourceType == "SUPPLIER" (the original/default flow): tied to an
//   approved PurchaseOrder (PoId required). Received bars become KFH_OWNED.
//   SourceType == "CUSTOMER": no Purchase Order -- CustomerId (required)
//   identifies who physically presented the metal. ReceiptReason drives
//   what happens to ownership once approved (see IntakeInventoryItemsAsync):
//     BUYBACK        -- KFH purchases the customer's metal outright; bars
//                        become KFH_OWNED, same as a supplier receipt.
//     CUSTODY_DEPOSIT-- the customer's own metal is placed into vault
//                        safekeeping; bars stay CUSTOMER_OWNED and a
//                        CustomerHolding/CustomerAllocation pair is created,
//                        mirroring ConfirmPurchaseWithCustodyAsync. Requires
//                        AccountId (which CustomerAccount holds the metal).
//     RETURN         -- a previously withdrawn/dispensed bar physically
//                        comes back into KFH custody; treated like BUYBACK
//                        (KFH_OWNED) for ledger purposes.
// ============================================================
public class PendingIntake
{
    public int PendingIntakeId { get; set; }
    public int? PoId { get; set; }
    public string SourceType { get; set; } = "SUPPLIER"; // SUPPLIER | CUSTOMER
    public int? VendorId { get; set; }
    public string? ShipmentReference { get; set; }
    public string? DeliveryNoteNumber { get; set; }
    public string? AirwayBillNumber { get; set; }
    public string? SupportingDocumentUrl { get; set; }
    public string? DiscrepancyNotes { get; set; }
    public DateTime? ReceivingDate { get; set; }
    public int? CustomerId { get; set; }
    public int? AccountId { get; set; } // CustomerAccount -- only meaningful when ReceiptReason == CUSTODY_DEPOSIT
    public string? ReceiptReason { get; set; } // BUYBACK | CUSTODY_DEPOSIT | RETURN -- customer receipts only
    public string LotNumber { get; set; } = null!;
    public int LocationId { get; set; }
    public string ReceivedBy { get; set; } = null!;
    public string SerialsJsonList { get; set; } = null!;
    public string OwnershipType { get; set; } = "KFH_OWNED"; // KFH_OWNED, TURKEY_OWNED, CUSTOMER_OWNED
    public string StatusCode { get; set; } = "PENDING_APPROVAL"; // PENDING_APPROVAL, APPROVED, REJECTED
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public PurchaseOrder? PurchaseOrder { get; set; }
    public Vendor? Vendor { get; set; }
    public InventoryLocation? Location { get; set; }
    public Customer? Customer { get; set; }
}

public class PendingTurkeyPurchase
{
    public int PendingPurchaseId { get; set; }
    public string BatchReference { get; set; } = null!;
    public string SerialsJsonList { get; set; } = null!;
    public int TotalItems { get; set; }
    public decimal TotalWeightGrams { get; set; }
    public decimal UnitPricePerGram { get; set; }
    public decimal TotalCost { get; set; }
    public string RequestedBy { get; set; } = null!;
    public string? Notes { get; set; }
    public string StatusCode { get; set; } = "PENDING_APPROVAL"; // PENDING_APPROVAL, APPROVED, REJECTED
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? ApprovedBy { get; set; }
    public DateTime? ApprovedAt { get; set; }
}

// ============================================================
// FIM (Forefront Identity Manager) Integration Module
// ------------------------------------------------------------
// RFP-mandated identity provisioning / access management surface. Maps FIM's
// "User" / "Profile" / "Right" concepts onto PMIMS's own identity store
// (AppUser / PrivilegeGroup) so the module works standalone against the
// "application-own identity list" scenario, while remaining swappable for a
// real Active-Directory-backed FIM connector later (AD is preferred per RFP;
// this is the fallback/local scenario). See IFimService (PMIMS.Application)
// and FimService (PMIMS.Infrastructure) for the sync/provisioning logic, and
// database/schema.sql + database/procedures.sql (sp_FIM_*) for the SQL
// Server-side mirror of every function below.
// ============================================================

// Extension attribute bag for AppUser -- lets FIM push/pull arbitrary
// mandatory/custom attributes (EmployeeId, Department, ADDistinguishedName,
// CostCenter, ...) beyond the fixed AppUser columns, without a schema change
// per new attribute. (AttributeName, UserId) is unique -- see AppDbContext.
public class FimUserAttribute
{
    public int AttributeId { get; set; }
    public int UserId { get; set; }
    public string AttributeName { get; set; } = null!;
    public string AttributeValue { get; set; } = null!;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public AppUser? User { get; set; }
}

// A fine-grained "Right" in FIM terms: a named system privilege that can be
// bound directly to a user (FimUserRight), independent of PrivilegeGroup/
// GroupPermission ("Profile") membership. This is the layer RFP functions
// AddUserToRight/RemoveUserFromRight/GetAllRightsForUser operate on.
public class FimRight
{
    public int RightId { get; set; }
    public string RightCode { get; set; } = null!;  // e.g. "PO_APPROVE", "USER_PROVISION"
    public string RightName { get; set; } = null!;
    public string? Description { get; set; }
    public string? ModuleKey { get; set; }           // optional link to a PMIMS permission module
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class FimUserRight
{
    public int UserRightId { get; set; }
    public int UserId { get; set; }
    public int RightId { get; set; }
    public DateTime GrantedAt { get; set; } = DateTime.UtcNow;
    public string GrantedBy { get; set; } = "SYSTEM";

    public AppUser? User { get; set; }
    public FimRight? Right { get; set; }
}

// Change-tracking ledger consumed by DetectDeltaChangesAsync: every FIM
// provisioning mutation (user/profile/right create-update-delete, and
// profile/right bindings) writes one row here, independent of the general
// AuditLog table, so sync connectors can cheaply query
// "WHERE changed_at > @LastSyncTime" without scanning free-text audit
// descriptions.
public class FimSyncLog
{
    public int SyncLogId { get; set; }
    public string EntityType { get; set; } = null!;   // USER, PROFILE, RIGHT, USER_PROFILE, USER_RIGHT, PASSWORD
    public string EntityKey { get; set; } = null!;     // e.g. the affected UserId/ProfileId as string
    public string ChangeType { get; set; } = null!;    // CREATE, UPDATE, DELETE
    public DateTime ChangedAt { get; set; } = DateTime.UtcNow;
    public string ChangedBy { get; set; } = "SYSTEM";
    public string Source { get; set; } = "APPLICATION"; // APPLICATION or FIM (which system originated the change)
    public string? DetailsJson { get; set; }
}

// ============================================================
// Cost Tracking & Valuation -- Core Banking (IMAL) GL Integration
// ------------------------------------------------------------
// A CoreBankingLedgerPosting is PMIMS's local, durable record of every
// journal entry it has pushed (or attempted to push) to the Core Banking
// System's general ledger -- e.g. "Debit Inventory-Precious Metals / Credit
// Accounts Payable-Vendor" for the landed cost of a purchase-order receipt.
// It is written PENDING *before* the outbound call and then updated to
// POSTED/FAILED after, mirroring the MonitoringEvent adapter philosophy
// (GenericWebhookMonitoringAdapter) so this table is a reliable local audit
// of what was (attempted to be) posted even if Core Banking/IMAL is
// unreachable. Adapter: ICoreBankingLedgerService (PMIMS.Application),
// implemented by CoreBankingGlAdapter (PMIMS.Infrastructure/ExternalServices.cs).
// This is distinct from ReconciliationService's existing (read-only,
// simulated) comparison against Core Banking GL balances -- that reads Core
// Banking's expected state to find breaks; this pushes PMIMS-originated
// postings to it.
// ============================================================
public class CoreBankingLedgerPosting
{
    public int PostingId { get; set; }
    // What PMIMS event caused this posting, e.g. "PURCHASE_ORDER_RECEIPT",
    // "VALUATION_SNAPSHOT", "INVENTORY_ADJUSTMENT" -- and the PMIMS-native
    // entity id it corresponds to (PoId, DisclosureId, ItemId, ...).
    public string SourceType { get; set; } = null!;
    public int SourceId { get; set; }
    public string DebitAccount { get; set; } = null!;
    public string CreditAccount { get; set; } = null!;
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "KWD";
    public string? Memo { get; set; }
    // PENDING (queued locally, not yet sent) -> POSTED (Core Banking accepted
    // it, or -- with no live endpoint configured -- accepted in simulation,
    // same fallback posture as RateFeedService's live-feed-with-simulated-
    // fallback pattern) | FAILED (Core Banking rejected it or was unreachable).
    public string StatusCode { get; set; } = "PENDING";
    // Core Banking's own confirmation/reference number for a POSTED entry.
    public string? CoreBankingReference { get; set; }
    public string? ResponseMessage { get; set; }
    public string InitiatedBy { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? PostedAt { get; set; }
}

// ============================================================
// Reporting Requirements Gap Analysis -- Cost Analysis & Variance (Item 8)
// ------------------------------------------------------------
// A budgeted/standard unit cost per metal type per period, so "variance" can
// mean what Finance/Treasury actually needs it to mean (budget vs. actual),
// not just cost drift over time. Actual cost is read from the existing
// InventoryLot.AverageUnitCost (already captured at intake, itself derived
// from PurchaseOrder.LandedCost) -- this table adds only the missing half of
// the comparison, the planned/budgeted figure, which had no representation
// anywhere in the schema before. See
// docs/PMIMS_Reporting_Requirements_Gap_Analysis.docx, Item 8.
// ============================================================
public class CostBudget
{
    public int BudgetId { get; set; }
    public int MetalTypeId { get; set; }
    // yyyy-MM (calendar month) -- matches the granularity Treasury budgets at;
    // a metal type has at most one budget row per period (enforced by a
    // unique index on MetalTypeId+Period, see AppDbContext).
    public string Period { get; set; } = null!;
    public decimal BudgetedUnitCostPerGram { get; set; }
    public string Currency { get; set; } = "KWD";
    public string CreatedBy { get; set; } = "SYSTEM";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public MetalType? MetalType { get; set; }
}

// ============================================================
// Sidebar Menu Layout (admin-arrangeable navigation order)
// ------------------------------------------------------------
// A single global singleton row (Id is always 1). OrderJson holds a JSON array of
// stable sidebar node keys -- both section headers (e.g. "section:operations") and
// individual menu items (e.g. "item:screen-po") -- in the order they should render,
// front to back, with no distinction enforced between sections at the storage layer.
// This lets an IT/Admin drag/​nudge an item's position past a section boundary, which
// is exactly what the frontend's "Edit Menu" up/down controls do. Every authenticated
// user reads the same row so the whole org sees one consistent menu; only holders of
// FULL/READ_WRITE on the `settings` module (or IT/Admin) may write it.
// ============================================================
public class SidebarMenuLayout
{
    public int Id { get; set; } = 1;
    public string OrderJson { get; set; } = null!;
    public string UpdatedBy { get; set; } = "SYSTEM";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

// ============================================================
// KFHOnline Transaction Audit Log
// ============================================================
// Comprehensive audit trail for all KFHOnline customer transactions
// (buy/sell/delivery). Every operation -- success and failure -- is
// logged here with full context: serial numbers, weights, prices,
// status codes, and any error messages. This allows system monitoring
// to track all transaction issues, failures, and their root causes.
// ============================================================
public class KFHOnlineTransactionLog
{
    public int LogId { get; set; }
    public string TransactionType { get; set; } = null!; // BUY, SELL, DELIVERY_REQUEST
    public int CustomerId { get; set; }
    public string CustomerName { get; set; } = null!;
    public decimal WeightGrams { get; set; }
    public string? SerialsJson { get; set; } // JSON array of serial numbers
    public string StatusCode { get; set; } = "PENDING"; // PENDING, CONFIRMED, FAILED, REJECTED
    public string? FailureReason { get; set; } // Error message if StatusCode == FAILED
    public decimal? PricePerGram { get; set; }
    public decimal? TotalAmount { get; set; }
    public string? Purity { get; set; } // 99.99%, etc
    public string? Denomination { get; set; } // 1000g, 100g, 10g, etc
    public string? Notes { get; set; }
    public string? ResponseJson { get; set; } // Full API response (success or error)
    public string? RequestJson { get; set; } // Full incoming request
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = "KFHOnline"; // Source: KFHOnline, API, WebUI, etc
}

// ============================================================
// GFS Delivery Request (Branch Fulfillment)
// ============================================================
public class GfsDeliveryRequest
{
    public int RequestId { get; set; }
    public string GfsRefNumber { get; set; } = null!;
    public int BarId { get; set; }
    public string? CustomerAccountNumber { get; set; }
    public int DestinationBranchId { get; set; }
    public string Status { get; set; } = "PENDING_DISPATCH"; // PENDING_DISPATCH, DISPATCHED, RECEIVED, CANCELLED, RETURN_TO_COURIER
    public string? RouteDetails { get; set; }

    // Courier Logistics & Handover Details (KFH Secure Transport)
    public string? CourierCompany { get; set; }
    public string? CourierRepName { get; set; }
    public string? CourierCivilId { get; set; }
    public string? VehiclePlate { get; set; }
    public string? SecuritySealNumber { get; set; }
    public string? HandoverVoucherRef { get; set; }
    public DateTime? DispatchedAt { get; set; }
    public string? DispatchedBy { get; set; }
    public DateTime? ReceivedAt { get; set; }
    public string? ReceivedBy { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public InventoryItem? Bar { get; set; }
    public Branch? DestinationBranch { get; set; }
}

// ============================================================
// Home Delivery Request (UC07: Main Vault to Home Delivery Courier)
// ============================================================
public class HomeDeliveryRequest
{
    public int RequestId { get; set; }
    public string DeliveryNumber { get; set; } = null!;
    public int BarId { get; set; }
    public string CustomerAccountNumber { get; set; } = null!;
    public string CustomerCivilId { get; set; } = null!;
    public string CustomerName { get; set; } = null!;
    public string CustomerPhone { get; set; } = null!;
    
    // Residential Address in Kuwait
    public string Governorate { get; set; } = null!; // Capital, Hawalli, Farwaniya, Ahmadi, Jahra, Mubarak Al-Kabeer
    public string Area { get; set; } = null!;
    public string Block { get; set; } = null!;
    public string Street { get; set; } = null!;
    public string BuildingHouse { get; set; } = null!;
    public string? FloorFlat { get; set; }
    public string? SpecialInstructions { get; set; }

    // Security Handover Verification
    public string VerificationOtp { get; set; } = null!;
    public string Status { get; set; } = "PENDING_DISPATCH"; // PENDING_DISPATCH, DISPATCHED_TO_COURIER, DELIVERED_TO_CUSTOMER, FAILED_RETURNED

    // Courier Handover Details
    public string? CourierCompany { get; set; }
    public string? CourierRepName { get; set; }
    public string? CourierCivilId { get; set; }
    public string? VehiclePlate { get; set; }
    public string? SecuritySealNumber { get; set; }

    // Customer Handover Confirmation
    public string? RecipientCivilId { get; set; }
    public string? RecipientSignature { get; set; }
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = "GFS";
    public DateTime? DispatchedAt { get; set; }
    public string? DispatchedBy { get; set; }
    public DateTime? DeliveredAt { get; set; }
    public string? DeliveredBy { get; set; }

    public InventoryItem? Bar { get; set; }
}

// ============================================================
// Stock Cut-off Threshold
// ============================================================
public class StockCutoffThreshold
{
    public int ThresholdId { get; set; }
    public string AlertType { get; set; } = null!; // LOW_STOCK or HIGH_STOCK
    public int ProductId { get; set; }
    public int DenominationId { get; set; }
    public decimal CutoffValueKg { get; set; }
    public string StatusCode { get; set; } = "PENDING_MAKER"; // PENDING_MAKER, APPROVED
    public string CreatedBy { get; set; } = null!;
    public string? ApprovedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ApprovedAt { get; set; }

    public MetalProduct? Product { get; set; }
    public MetalDenomination? Denomination { get; set; }
}

// ============================================================
// GFS Sync Log
// ============================================================
public class GfsSyncLog
{
    public int SyncLogId { get; set; }
    public DateTime SyncTimestamp { get; set; } = DateTime.UtcNow;
    public string ExecutedBy { get; set; } = null!;
    public int TotalRecordsSynced { get; set; }
    public int TotalRecordsRejected { get; set; }
    public string Status { get; set; } = "SUCCESS"; // SUCCESS, FAILED
    public string? SyncDetails { get; set; } // logs old vs new values, etc.
}

