using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using PMIMS.Domain;

namespace PMIMS.Application;

public interface IInventoryRepository
{
    // Stored Procedure operations
    Task<(int poId, string result)> CreatePurchaseOrderAsync(string poNumber, int vendorId, decimal totalWeightGrams, decimal totalCost, string currency, string createdBy, string poItemJsonList);
    Task<bool> UpdatePurchaseOrderAsync(int poId, int vendorId, decimal totalWeightGrams, decimal totalCost, string currency, string username, string poItemJsonList);
    // sourceType: "SUPPLIER" (default, requires poId) or "CUSTOMER" (requires customerId;
    // receiptReason of BUYBACK/RETURN -> KFH_OWNED, CUSTODY_DEPOSIT -> CUSTOMER_OWNED + custody holding).
    Task<string> IntakeInventoryItemsAsync(int? poId, string lotNumber, int locationId, string receivedBy, string serialsJsonList,
        string sourceType = "SUPPLIER", int? customerId = null, int? accountId = null, string? receiptReason = null);
    Task<IEnumerable<dynamic>> QueryAvailableStockAsync(int? branchId, int? metalTypeId, string? originCountry, int? denominationId);
    Task<Guid?> ReserveStockAsync(int customerId, int productId, int branchId, int channelId, string idempotencyKey, int ttlSeconds);
    Task<string> ConfirmPurchaseWithCustodyAsync(Guid reservationToken, int accountId, decimal salePrice, decimal markupAmount, string invoiceNumber, string? custodyAgreementNumber);
    Task CancelReservationAsync(Guid reservationToken);
    Task<string> InitiateBranchTransferAsync(int itemId, int destLocationId, string courierInfo, string initiatedBy);
    Task<string> ExecuteBranchWithdrawalAsync(int holdingId, int branchId, string otp, string signature, string withdrawnBy);
    Task<(int sessionId, string result)> StartStocktakeSessionAsync(string sessionCode, int vaultId, string initiatedBy, string freezeLocationIdJsonList);
    Task<string> ImportMigrationDataAsync(int migrationLogID, string approvedBy);

    // Metadata management & seed records
    Task<IEnumerable<MetalProduct>> GetProductsAsync();
    Task<IEnumerable<Vendor>> GetVendorsAsync();
    Task<IEnumerable<InventoryLocation>> GetLocationsAsync();
    Task<InventoryLocation> AddLocationAsync(int vaultId, int? branchId, string zoneRoom, string shelfRow, string slotBin);
    Task<bool> DeleteLocationAsync(int locationId);
    Task<IEnumerable<InventoryItem>> GetItemsAsync();
    Task<IEnumerable<PurchaseOrder>> GetPurchaseOrdersAsync();
    Task<string> DeletePurchaseOrderAsync(int poId, string username);
    Task<IEnumerable<CustomerHolding>> GetCustomerHoldingsAsync(int customerId);
    Task<IEnumerable<CustomerHolding>> GetAllCustomerHoldingsAsync();
    Task<IEnumerable<InventoryTransaction>> GetTransactionsAsync();
    Task<IEnumerable<StocktakeSession>> GetStocktakeSessionsAsync();
    Task<IEnumerable<MismatchCase>> GetMismatchCasesAsync();
    Task<IEnumerable<AuditLog>> GetAuditLogsAsync();
    Task<IEnumerable<ReconciliationRun>> GetReconciliationRunsAsync();

    // Standard CRUD helpers for configs
    Task AddVendorAsync(Vendor vendor);
    Task AddProductAsync(MetalProduct product);
    Task AddDenominationAsync(MetalDenomination denomination);
    Task<MetalProduct> CreateDenominationProductAsync(string label, string metalName, decimal weightGrams);
    Task SaveAuditLogAsync(string username, string ipAddress, string moduleName, string actionDescription, string? sqlExecuted = null, string? entityType = null, string? entityId = null);
    
    // Workflow Engine
    Task<IEnumerable<WorkflowTemplate>> GetWorkflowTemplatesAsync();
    Task<WorkflowTemplate?> SaveWorkflowTemplateAsync(string workflowType, string name, string description, string stepsJson);
    Task<WorkflowInstance> StartWorkflowInstanceAsync(string workflowType, int entityId, string username);
    Task<string> ProcessWorkflowActionAsync(int instanceId, string username, string action, string? comments);
    Task<IEnumerable<WorkflowInstance>> GetActiveWorkflowInstancesAsync();
    // Post-hoc lookup for a single instance -- used by the controller after
    // ProcessWorkflowActionAsync succeeds, to detect a just-completed BRANCH_TRANSFER and
    // fire a TRANSFER_COMPLETED notification (see PMIMSControllers.Notifications.cs). Kept
    // separate from ProcessWorkflowActionAsync's own "SUCCESS"/error-string return contract
    // so existing callers/tests are unaffected.
    Task<WorkflowInstance?> GetWorkflowInstanceByIdAsync(int instanceId);
    Task<IEnumerable<ApprovalAction>> GetApprovalActionsForInstanceAsync(int instanceId);

    // Per-user activity dashboard: every approve/reject/return decision the user has made,
    // and every currently-pending request sitting at a step whose required role the user
    // holds (IT/Admin sees every pending request, mirroring the superuser bypass in
    // ProcessWorkflowActionAsync).
    Task<IEnumerable<ApprovalAction>> GetApprovalActionsByUserAsync(string username);
    Task<IEnumerable<WorkflowInstance>> GetPendingWorkflowInstancesForUserAsync(string username);
    
    // =========================================================================
    // User & Group Privilege Management
    // =========================================================================
    // User Management
    Task<IEnumerable<AppUser>> GetAllUsersAsync();
    Task<AppUser?> GetUserByIdAsync(int userId);
    Task<AppUser?> GetUserByUsernameAsync(string username);
    Task<AppUser> CreateUserAsync(string username, string displayName, string email, string passwordHash, string createdBy);
    Task<AppUser?> UpdateUserAsync(int userId, string displayName, string email);
    Task<bool> ToggleUserActiveAsync(int userId, bool isActive);

    // Group Management
    Task<IEnumerable<PrivilegeGroup>> GetAllGroupsAsync();
    Task<PrivilegeGroup?> GetGroupByIdAsync(int groupId);
    Task<PrivilegeGroup> CreateGroupAsync(string groupName, string description);
    Task<PrivilegeGroup?> UpdateGroupAsync(int groupId, string groupName, string description);
    Task<bool> DeleteGroupAsync(int groupId);

    // Group Permissions
    Task<IEnumerable<GroupPermission>> GetGroupPermissionsAsync(int groupId);
    Task SaveGroupPermissionsAsync(int groupId, IEnumerable<(string moduleKey, string accessLevel)> permissions);

    // User-Group Membership
    Task<bool> AddUserToGroupAsync(int userId, int groupId, string assignedBy);
    Task<bool> RemoveUserFromGroupAsync(int userId, int groupId);

    // Effective Permissions (merged from all groups — highest wins)
    Task<Dictionary<string, string>> GetEffectivePermissionsForUserAsync(string username);

    // Stock Reorder Thresholds
    Task<IEnumerable<ReorderThreshold>> GetReorderThresholdsAsync();
    Task<ReorderThreshold> SaveReorderThresholdAsync(int? thresholdId, int productId, int vendorId, int minStockQty, int reorderQty, bool isActive);
    Task<bool> DeleteReorderThresholdAsync(int thresholdId);
    Task<IEnumerable<dynamic>> CheckLowStockAlertsAsync();
    Task<(int poId, string result)> CreateDraftPurchaseOrderAsync(int thresholdId, string createdBy);

    // KFH Branch settings CRUD & Workflow Transfers
    Task<IEnumerable<Branch>> GetBranchesAsync();
    Task<Branch> SaveBranchAsync(int? branchId, string branchCode, string branchName, int vaultId, bool isActive);
    Task<bool> DeleteBranchAsync(int branchId);
    Task<IEnumerable<BranchTransfer>> GetBranchTransfersAsync();
    Task<BranchTransfer?> GetBranchTransferByIdAsync(int transferId);
    Task<BranchTransfer> InitiateWorkflowBranchTransferAsync(int itemId, int destinationBranchId, string courierInfo, string initiatedBy);
    Task<string> ReceiveBranchTransferAsync(int transferId, string receivedBy);
    Task<PendingIntake> InitiateWorkflowIntakeAsync(int? poId, string lotNumber, int locationId, string receivedBy, string serialsJsonList,
        string sourceType = "SUPPLIER", int? customerId = null, int? accountId = null, string? receiptReason = null);
    Task<IEnumerable<PendingIntake>> GetPendingIntakesAsync();

    // =========================================================================
    // Dynamic Business Validation Rules Engine (RFP item 5) -- pure data access;
    // predicate-tree evaluation logic lives in IRuleEngineService.
    // =========================================================================
    Task<IEnumerable<BusinessRule>> GetBusinessRulesAsync(string? ruleType = null, bool activeOnly = false);
    Task<BusinessRule?> GetBusinessRuleByIdAsync(int ruleId);
    Task<IEnumerable<BusinessRule>> GetBusinessRuleVersionsAsync(string ruleCode);
    Task<BusinessRule> AddBusinessRuleVersionAsync(BusinessRule rule);
    Task<bool> SetBusinessRuleActiveAsync(int ruleId, bool isActive);
    Task SaveBusinessRuleEvaluationAsync(BusinessRuleEvaluation evaluation);

    // =========================================================================
    // Enhanced Audit Trail UI (RFP item 6)
    // =========================================================================
    Task<AuditLogSearchResult> SearchAuditLogsAsync(AuditLogFilter filter);
    Task<AuditLogSearchResultItem?> GetAuditLogByIdAsync(int logId);

    // =========================================================================
    // Automatic Management Email Notifications (RFP item 7)
    // =========================================================================
    Task<IEnumerable<NotificationSubscription>> GetNotificationSubscriptionsAsync();
    Task<NotificationSubscription?> GetNotificationSubscriptionByIdAsync(int subscriptionId);
    Task<NotificationSubscription> SaveNotificationSubscriptionAsync(NotificationSubscription subscription);
    Task<bool> DeleteNotificationSubscriptionAsync(int subscriptionId);
    Task<bool> UnsubscribeAsync(int subscriptionId);
    Task RecordNotificationDeliveryAsync(NotificationDelivery delivery);
    Task<IEnumerable<NotificationDelivery>> GetNotificationDeliveriesAsync(int? subscriptionId = null);

    // =========================================================================
    // KFH Existing Monitoring Tool Integration (RFP item 8)
    // =========================================================================
    Task<IEnumerable<MonitoringAlertRoute>> GetMonitoringAlertRoutesAsync();
    Task<MonitoringAlertRoute> SaveMonitoringAlertRouteAsync(MonitoringAlertRoute route);
    Task<MonitoringEvent> RecordMonitoringEventAsync(MonitoringEvent evt);
    Task<IEnumerable<MonitoringEvent>> GetRecentMonitoringEventsAsync(int hours = 24);

    // =========================================================================
    // Real-Time Inventory Monitoring -- initial snapshot (live patches arrive over
    // InventoryMonitoringHub's "BalanceChanged"/"MovementOccurred" events; this is
    // just what the frontend fetches once on mount to seed its state before those
    // patches start arriving).
    // =========================================================================
    Task<IEnumerable<InventoryBalance>> GetAllInventoryBalancesAsync();

    // =========================================================================
    // LBMA Good Delivery / Chain-of-Custody
    // =========================================================================
    Task<ChainOfCustodyEvent> RecordChainOfCustodyEventAsync(int itemId, string eventType, string recordedBy, int? locationId = null, string? referenceNumber = null, string? notes = null);
    Task<IEnumerable<ChainOfCustodyEvent>> GetChainOfCustodyEventsAsync(int itemId);
    // Bars missing refiner/assay/fineness data, or explicitly NOT_LISTED -- the
    // gap list LBMA/internal audit would want ahead of a Good Delivery review.
    Task<IEnumerable<dynamic>> GetLbmaComplianceReportAsync();

    // =========================================================================
    // Auditable, traceable movement records
    // ------------------------------------------------------------------------
    // Every status-changing adjustment to an item that ISN'T already a
    // sale/transfer/withdrawal/receipt (i.e. reconciliation quarantine and
    // resolution) gets a proper ADJUSTMENT InventoryTransaction row, a
    // chain-of-custody event, and a cross-referenced AuditLog entry -- instead
    // of the previous approach of silently recalculating the balance with no
    // ledger trace at all.
    // =========================================================================
    Task<InventoryTransaction> RecordInventoryAdjustmentAsync(int itemId, string reasonCode, string performedBy, string? notes = null);

    // Assembles one InventoryTransaction with everything needed to trace it end-to-end:
    // its matched AuditLog entry (tamper-status included), courier/MovementTransaction
    // detail if it's a TRANSFER, and the full chain-of-custody timeline for the item.
    Task<dynamic?> GetTransactionTraceAsync(int transactionId);

    // =========================================================================
    // IFRS Valuation Disclosures (IAS 2 lower-of-cost-or-NRV, IFRS 13 fair value)
    // =========================================================================
    Task<IfrsValuationDisclosure> GenerateIfrsValuationDisclosureAsync(string generatedBy);
    Task<IEnumerable<IfrsValuationDisclosure>> GetIfrsValuationDisclosuresAsync();

    // =========================================================================
    // Gold Dispensing Machine (GDM) Integration -- scalability hook
    // =========================================================================
    Task<IEnumerable<DispensingDevice>> GetDispensingDevicesAsync();
    Task<DispensingDevice> SaveDispensingDeviceAsync(DispensingDevice device);
    Task<bool> DeleteDispensingDeviceAsync(int deviceId);
    Task<DispensingDevice?> RecordDeviceHeartbeatAsync(int deviceId, string statusCode);
    Task<IEnumerable<DispenseTransaction>> GetDispenseTransactionsAsync(int? deviceId = null);
    Task<(DispenseTransaction? txn, string result)> RequestDispenseAsync(int deviceId, int productId, int? customerId, int channelId, string idempotencyKey, string initiatedBy);
    Task<(bool success, string result)> CompleteDispenseAsync(int dispenseId, string completedBy);
    Task<bool> FailDispenseAsync(int dispenseId, string reason);
}

public interface IActiveDirectoryService
{
    Task<(bool success, string? displayName, List<string> roles)> AuthenticateAsync(string username, string password);
}

// FIM (Forefront Identity Manager) integration surface -- implements every
// function mandated by the RFP's "FIM Integration Module" section. IDs are
// the PMIMS-native primary keys (AppUser.UserId as "userId", PrivilegeGroup.
// GroupId as "profileId", FimRight.RightId as "rightId") since this
// implementation targets the "application-own identity list" scenario;
// swapping in real Active-Directory-backed identifiers (SIDs/DNs) is a
// same-shape change confined to FimService. See PMIMS.Domain.FimUserAttribute/
// FimRight/FimUserRight/FimSyncLog and database/procedures.sql (sp_FIM_*).
public interface IFimService
{
    // ---- Identity Provisioning Functions ----
    Task<IEnumerable<FimUserDto>> GetUsersAsync();
    Task<int> GetNumberOfUsersAsync();
    Task<FimUserDto?> GetUserInfoAsync(int userId);
    Task<IEnumerable<FimProfileDto>> GetProfilesAsync();
    Task<int> GetNumberOfProfilesAsync();
    Task<FimProfileDto?> GetProfileInfoAsync(int profileId);
    Task<IEnumerable<FimUserDto>> GetUsersFromProfileAsync(int profileId);
    Task<int> GetNumberOfUsersFromProfileAsync(int profileId);
    Task<IEnumerable<FimProfileDto>> GetProfilesFromUserAsync(int userId);
    Task<int> GetNumberOfProfilesFromUserAsync(int userId);
    Task<FimUserDto> AddUserAsync(Dictionary<string, string> attributes, string createdBy);
    Task<FimProfileDto> AddProfileAsync(Dictionary<string, string> attributes, string createdBy);
    Task<bool> AddUserToProfileAsync(int userId, int profileId, string assignedBy);
    Task<FimProfileDto?> UpdateProfileInfoAsync(int profileId, Dictionary<string, string> attributes);
    Task<FimUserDto?> UpdateUserInfoAsync(int userId, Dictionary<string, string> attributes);
    Task<bool> RemoveUserAsync(int userId);
    Task<bool> RemoveProfileAsync(int profileId);
    Task<bool> RemoveUserFromProfileAsync(int userId, int profileId);
    Task<int> RemoveUsersFromProfileAsync(IEnumerable<int> userIds, int profileId);

    // ---- Access Management Functions ----
    Task<IEnumerable<FimRightDto>> GetAllRightsAsync();
    Task<int> GetNumberOfRightsAsync();
    Task<FimRightDto?> GetRightInfoAsync(int rightId);
    Task<IEnumerable<FimRightDto>> GetAllRightsForUserAsync(int userId);
    Task<int> GetNumberOfRightsForUserAsync(int userId);
    Task<IEnumerable<FimUserDto>> GetAllUsersForRightAsync(int rightId);
    Task<int> GetNumberOfUsersForRightAsync(int rightId);
    Task<bool> AddUserToRightAsync(int userId, int rightId, string grantedBy);
    Task<bool> RemoveUserFromRightAsync(int userId, int rightId);

    // ---- Password Management Functions ----
    // encryptionAlgorithm: "BCRYPT" (default, one-way hash) or "AES256"
    // (reversible, for scenarios where FIM needs to push a recoverable
    // credential into a downstream system). Unknown values throw.
    Task<bool> SetPasswordAsync(int userId, string password, string encryptionAlgorithm = "BCRYPT");

    // ---- Connectivity support & delta-sync change detection ----
    Task<IEnumerable<FimSyncChangeDto>> DetectDeltaChangesAsync(DateTime lastSyncTime);
}

public interface IRateFeedService
{
    Task<(decimal bid, decimal ask, string source)> GetLiveRatesAsync(string metalName);
}

public interface IReconciliationService
{
    Task<ReconciliationRun> RunReconciliationAsync(string executedBy);
    Task<bool> ResolveMismatchAsync(int caseId, string comments, string reasonCode, string resolvedBy);
}

public interface IBulkMigrationService
{
    Task<dynamic> StageMigrationExcelAsync(string fileName, string fileContentBase64, string uploadedBy);
    Task<string> CommitMigrationAsync(int migrationId, string approvedBy);
}

// =========================================================================
// Real-Time Inventory Monitoring -- push notifications for precious-metal
// quantity/movement changes (to/from main vault, between branches, and with
// customers). Implemented as a DIP boundary: PMIMS.Infrastructure (AppDbContext)
// raises these events from a single choke point (SaveChangesAsync) without
// knowing or caring that PMIMS.WebAPI's SignalRInventoryMonitoringNotifier is
// what actually pushes them over a Hub -- Infrastructure only depends on this
// Application-layer interface, same as every other service abstraction here.
// Optional (nullable) at every injection point so this is purely additive: a
// caller/test that never supplies an implementation just doesn't get pushes.
// =========================================================================
public interface IInventoryMonitoringNotifier
{
    Task NotifyMovementAsync(PMIMS.Domain.InventoryTransaction transaction);
    Task NotifyBalanceChangedAsync(PMIMS.Domain.InventoryBalance balance);
}
