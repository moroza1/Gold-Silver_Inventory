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

public class MetalProduct
{
    public int ProductId { get; set; }
    public string ProductCode { get; set; } = null!;
    public int MetalTypeId { get; set; }
    public int DenominationId { get; set; }
    public int PurityId { get; set; }
    public string OriginCountry { get; set; } = null!;
    public bool IsActive { get; set; } = true;

    public MetalType? MetalType { get; set; }
    public MetalDenomination? Denomination { get; set; }
    public MetalPurityLevel? Purity { get; set; }
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

    public MetalProduct? Product { get; set; }
    public InventoryLot? Lot { get; set; }
    public InventoryLocation? Location { get; set; }
}

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
    public int CustomerId { get; set; }
    public int AccountId { get; set; }
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

public class PendingIntake
{
    public int PendingIntakeId { get; set; }
    public int PoId { get; set; }
    public string LotNumber { get; set; } = null!;
    public int LocationId { get; set; }
    public string ReceivedBy { get; set; } = null!;
    public string SerialsJsonList { get; set; } = null!;
    public string StatusCode { get; set; } = "PENDING_APPROVAL"; // PENDING_APPROVAL, APPROVED, REJECTED
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public PurchaseOrder? PurchaseOrder { get; set; }
    public InventoryLocation? Location { get; set; }
}

