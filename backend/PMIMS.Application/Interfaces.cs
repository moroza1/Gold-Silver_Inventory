using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using PMIMS.Domain;

namespace PMIMS.Application;

public interface IInventoryRepository
{
    // Stored Procedure operations
    // supplierInvoiceNumber/supplierInvoiceDate + the four fee fields are the Cost Tracking &
    // Valuation purchase-cost-detail additions (see PurchaseOrder.LandedCost) -- appended as
    // optional params so every existing positional call site keeps compiling unchanged.
    Task<(int poId, string result)> CreatePurchaseOrderAsync(string poNumber, int vendorId, decimal totalWeightGrams, decimal totalCost, string currency, string createdBy, string poItemJsonList,
        string? supplierInvoiceNumber = null, DateTime? supplierInvoiceDate = null, decimal freightCost = 0, decimal insuranceCost = 0, decimal customsDutyCost = 0, decimal otherFeesCost = 0, string? otherFeesDescription = null);
    Task<bool> UpdatePurchaseOrderAsync(int poId, int vendorId, decimal totalWeightGrams, decimal totalCost, string currency, string username, string poItemJsonList,
        string? supplierInvoiceNumber = null, DateTime? supplierInvoiceDate = null, decimal freightCost = 0, decimal insuranceCost = 0, decimal customsDutyCost = 0, decimal otherFeesCost = 0, string? otherFeesDescription = null);
    // sourceType: "SUPPLIER" (default, requires poId) or "CUSTOMER" (requires customerId;
    // receiptReason of BUYBACK/RETURN -> KFH_OWNED, CUSTODY_DEPOSIT -> CUSTOMER_OWNED + custody holding).
    Task<string> IntakeInventoryItemsAsync(int? poId, string lotNumber, int locationId, string receivedBy, string serialsJsonList,
        string sourceType = "SUPPLIER", int? customerId = null, int? accountId = null, string? receiptReason = null,
        int? vendorId = null, string? shipmentReference = null, string? deliveryNoteNumber = null, string? airwayBillNumber = null,
        string? supportingDocumentUrl = null, string? discrepancyNotes = null, DateTime? receivingDate = null, string ownershipType = "KFH_OWNED");
    Task<IEnumerable<dynamic>> QueryAvailableStockAsync(int? branchId, int? metalTypeId, string? originCountry, int? denominationId);
    Task<Guid?> ReserveStockAsync(int customerId, int productId, int branchId, int channelId, string idempotencyKey, int ttlSeconds);
    Task<string> ConfirmPurchaseWithCustodyAsync(Guid reservationToken, int accountId, decimal salePrice, decimal markupAmount, string invoiceNumber, string? custodyAgreementNumber);
    Task CancelReservationAsync(Guid reservationToken);
    Task<string> InitiateBranchTransferAsync(int itemId, int destLocationId, string courierInfo, string initiatedBy);
    Task<string> ExecuteBranchWithdrawalAsync(int holdingId, int branchId, string otp, string signature, string withdrawnBy);
    Task<(int sessionId, string result)> StartStocktakeSessionAsync(string sessionCode, int vaultId, string initiatedBy, string freezeLocationIdJsonList);
    Task<string> ImportMigrationDataAsync(int migrationLogID, string approvedBy);

    // Metadata management & seed records
    // Reference lookup for the Reporting Requirements Gap Analysis's Item 8 cost-budget
    // admin form (metal type picker) -- no dedicated metal-type listing endpoint existed
    // before (GetProductsAsync's DTO exposes metal_name but not the underlying MetalTypeId).
    Task<IEnumerable<MetalType>> GetMetalTypesAsync();
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

    // Standard CRUD helpers for configs & Master Data Brands
    Task<IEnumerable<MetalBrand>> GetBrandsAsync();
    Task<MetalBrand?> GetBrandByIdAsync(int brandId);
    Task<MetalBrand> CreateBrandAsync(string brandCode, string brandName, string countryOfOrigin, string? lbmaRefinerId = null, bool isLbmaCertified = true, string? description = null);
    Task<MetalBrand?> UpdateBrandAsync(int brandId, string brandCode, string brandName, string countryOfOrigin, string? lbmaRefinerId = null, bool isLbmaCertified = true, string? description = null);
    Task<bool> DeleteBrandAsync(int brandId);

    Task AddVendorAsync(Vendor vendor);
    Task AddProductAsync(MetalProduct product);
    Task AddDenominationAsync(MetalDenomination denomination);
    Task<MetalProduct> CreateDenominationProductAsync(string label, string metalName, decimal weightGrams, string? originCountry = null, int? brandId = null);
    Task SaveAuditLogAsync(string username, string ipAddress, string moduleName, string actionDescription, string? sqlExecuted = null, string? entityType = null, string? entityId = null);
    
    // Workflow Engine
    Task<IEnumerable<WorkflowTemplate>> GetWorkflowTemplatesAsync();
    Task<WorkflowTemplate?> GetWorkflowTemplateByTypeAsync(string workflowType);
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
        string sourceType = "SUPPLIER", int? customerId = null, int? accountId = null, string? receiptReason = null,
        int? vendorId = null, string? shipmentReference = null, string? deliveryNoteNumber = null, string? airwayBillNumber = null,
        string? supportingDocumentUrl = null, string? discrepancyNotes = null, DateTime? receivingDate = null, string ownershipType = "KFH_OWNED");
    Task<string> NotifyBranchesOfReceivedInventoryAsync(int lotId, string lotNumber, int totalItemsReceived, decimal totalWeightGrams, string metalType, DateTime acquisitionDate, string notifiedBy);
    Task<IEnumerable<PendingIntake>> GetPendingIntakesAsync();

    // Turkey Consignment & Purchase Operations
    Task<PendingTurkeyPurchase> InitiateTurkeyPurchaseWorkflowAsync(List<string> serialNumbers, decimal unitPricePerGram, string requestedBy, string? notes);
    Task<string> ApproveTurkeyPurchaseAsync(int pendingPurchaseId, string approvedBy);
    Task<IEnumerable<InventoryItem>> GetTurkeyInventoryAsync();
    Task<IEnumerable<PendingTurkeyPurchase>> GetPendingTurkeyPurchasesAsync();

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
    // Sidebar Menu Layout (admin-arrangeable navigation order)
    // =========================================================================
    Task<SidebarMenuLayout?> GetSidebarMenuLayoutAsync();
    Task<SidebarMenuLayout> SaveSidebarMenuLayoutAsync(string orderJson, string updatedBy);

    // =========================================================================
    // Barcode/QR Code Tracking (RFP Section 3) -- single-item/lot lookups with the
    // Product/Lot/Location include chain BarcodeLabelService needs to build a label.
    // =========================================================================
    Task<InventoryItem?> GetItemBySerialNumberAsync(string serialNumber);
    Task<InventoryItem?> GetItemByIdWithDetailsAsync(int itemId);
    Task<InventoryLot?> GetLotByNumberAsync(string lotNumber);
    Task<IEnumerable<InventoryItem>> GetItemsByLotIdAsync(int lotId);

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
    // Cost Tracking & Valuation -- Core Banking (IMAL) GL Integration
    // =========================================================================
    // Every GL posting PMIMS has pushed (or attempted to push) to Core Banking,
    // newest first -- see CoreBankingLedgerPosting and ICoreBankingLedgerService.
    Task<IEnumerable<CoreBankingLedgerPosting>> GetCoreBankingPostingsAsync();

    // =========================================================================
    // KFHOnline Customer Portal - Inventory Integration
    // =========================================================================
    // Get available inventory for customer purchases (status = READY, not reserved/sold)
    Task<IEnumerable<InventoryItem>> GetAvailableInventoryForKfhAsync(string? metalName = null, string? purity = null, int limit = 50);
    // Get customer's custody holdings (bars they've purchased, status = CUSTOMER_CUSTODY)
    Task<IEnumerable<InventoryItem>> GetCustomerCustodyBarsAsync(int customerId);
    // Mark bars as customer custody when purchased
    Task<bool> PurchaseBarsAsync(string customerRim, string customerName, List<int> itemIds);
    // Mark bars as available again when customer sells
    Task<bool> SellBarsAsync(string customerRim, List<int> itemIds);
    // Transfer gold bars as a gift from sender customer to recipient customer
    Task<bool> TransferGiftBarsAsync(string senderRim, string senderName, string recipientRim, string recipientName, List<int> itemIds, string occasion, string giftMessage);
    // Get all customers with accounts and custody holdings for GFS portal
    Task<IEnumerable<dynamic>> GetCustomersWithDetailsAsync();
    // Log all KFHOnline transactions (buy, sell, delivery, gift) - both successes and failures
    Task LogKFHOnlineTransactionAsync(KFHOnlineTransactionLog logEntry);
    // Get transaction logs for monitoring/audit
    Task<IEnumerable<KFHOnlineTransactionLog>> GetKFHOnlineTransactionLogsAsync(int? customerId = null, string? status = null, DateTime? from = null, DateTime? to = null, int limit = 1000);

    // =========================================================================
    // Reporting Requirements Gap Analysis -- read-side aggregation support for
    // KPIs (Item 4), the Exceptions report (Item 5), Cost Analysis & Variance
    // (Item 8), and the Movement report (Item 9). Purely additive: every method
    // here is a new read (or, for cost budgets, a small new admin-configured
    // table) layered on data every other module already writes -- no existing
    // write path changes. See docs/PMIMS_Reporting_Requirements_Gap_Analysis.docx.
    // =========================================================================

    // Rule Engine evaluation history (Item 4's error-rate KPI, Item 5's rule-block
    // exceptions feed). SaveBusinessRuleEvaluationAsync above is write-only today --
    // this is the first read path over business_rule_evaluations.
    Task<IEnumerable<BusinessRuleEvaluation>> GetBusinessRuleEvaluationsAsync(DateTime? from = null, DateTime? to = null, string? result = null);

    // Every Maker-Checker decision across every user/instance (GetApprovalActionsByUserAsync
    // is scoped to one user; GetApprovalActionsForInstanceAsync to one instance) -- needed to
    // compute Item 4's approval-cycle-time KPI across the whole workflow population.
    Task<IEnumerable<ApprovalAction>> GetAllApprovalActionsAsync(DateTime? from = null, DateTime? to = null);

    // Cost Analysis & Variance (Item 8) -- budgeted/standard unit cost per metal type per
    // period, configured by Finance/Treasury (master_data tier, same as reorder thresholds).
    Task<IEnumerable<CostBudget>> GetCostBudgetsAsync();
    Task<CostBudget> SaveCostBudgetAsync(CostBudget budget);
    Task<bool> DeleteCostBudgetAsync(int budgetId);

    // =========================================================================
    // Admin SQL Query Tool (Development/Debugging Only)
    // =========================================================================
    Task<List<Dictionary<string, object?>>> ExecuteRawSqlQueryAsync(string sqlQuery);

    // =========================================================================
    // GFS & Damaged Bar Operations (BRD UC02, UC12)
    // =========================================================================
    Task<InventoryItem?> ScanBarWithGfsLookupAsync(string serialOrQr);
    Task<string> MarkBarDamagedAsync(int itemId, string reason, string desc, string docId, string user);
    Task<string> ProcessDamagedBarActionAsync(int itemId, string action, string approvedBy);
    Task<IEnumerable<InventoryItem>> GetDamagedBarsAsync();

    // =========================================================================
    // GFS Branch Delivery & Courier Handover (BRD UC04, UC05)
    // =========================================================================
    Task<GfsDeliveryRequest> CreateGfsDeliveryRequestAsync(string gfsRefNumber, int barId, string? customerAccountNumber, int destinationBranchId, string routeDetails);
    Task<IEnumerable<GfsDeliveryRequest>> GetGfsDeliveryRequestsAsync();
    Task<GfsDeliveryRequest?> GetGfsDeliveryRequestByIdAsync(int requestId);
    Task<string> DispatchGfsBranchDeliveryAsync(int requestId, string courierCompany, string courierRepName, string courierCivilId, string vehiclePlate, string securitySealNumber, string dispatchedBy);
    Task<string> ReceiveGfsBranchDeliveryAsync(int requestId, string scannedSerial, int destinationBranchId, string receivedBy, bool manualOverride = false, string? overrideReason = null);

    // =========================================================================
    // Home Delivery Lifecycle (BRD UC07)
    // =========================================================================
    Task<HomeDeliveryRequest> CreateHomeDeliveryRequestAsync(string deliveryNumber, int barId, string customerAccountNumber, string customerCivilId, string customerName, string customerPhone, string governorate, string area, string block, string street, string buildingHouse, string? floorFlat, string? specialInstructions, string createdBy);
    Task<IEnumerable<HomeDeliveryRequest>> GetHomeDeliveryRequestsAsync();
    Task<HomeDeliveryRequest?> GetHomeDeliveryRequestByIdAsync(int requestId);
    Task<string> DispatchHomeDeliveryAsync(int requestId, string courierCompany, string courierRepName, string courierCivilId, string vehiclePlate, string securitySealNumber, string dispatchedBy);
    Task<string> ConfirmHomeDeliveryHandoverAsync(int requestId, string verificationOtp, string recipientCivilId, string recipientSignature, string confirmedBy);

    // =========================================================================
    // GFS EOD Sync (BRD UC08)
    // =========================================================================
    Task<GfsSyncLog> SyncGfsEodAsync(string executedBy);
    Task<IEnumerable<GfsSyncLog>> GetGfsSyncLogsAsync();

    // =========================================================================
    // Enterprise Stock Cutoff Thresholds (BRD UC09, UC10, UC11)
    // =========================================================================
    Task<IEnumerable<StockCutoffThreshold>> GetStockCutoffThresholdsAsync();
    Task<StockCutoffThreshold> SaveStockCutoffThresholdAsync(StockCutoffThreshold threshold);
    Task<string> ProcessStockCutoffThresholdActionAsync(int thresholdId, string username, string action);
    Task<IEnumerable<dynamic>> EvaluateEnterpriseStockAlertsAsync();

    // =========================================================================
    // Kuwait Regulatory / PACI Civil ID Validation
    // =========================================================================
    bool ValidateKuwaitCivilId(string civilId);
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

// ============================================================
// Cost Tracking & Valuation -- Core Banking (IMAL) GL Integration adapter.
// Same "adapter, not vendor lock-in" shape as IMonitoringAdapter -- posts one
// journal entry and returns the durable local record of the attempt
// (CoreBankingLedgerPosting), so callers (InventoryRepository) don't need to
// know whether the entry was actually accepted by a live Core Banking
// endpoint or simulated locally (no endpoint configured yet). Optional/
// nullable at every injection point, same pattern as IRateFeedService, so
// this is purely additive -- a caller/test that never supplies an
// implementation just doesn't get GL postings.
// ============================================================
public interface ICoreBankingLedgerService
{
    Task<CoreBankingLedgerPosting> PostLedgerEntryAsync(string sourceType, int sourceId, string debitAccount, string creditAccount, decimal amount, string currency, string initiatedBy, string? memo = null);
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

// ============================================================
// GFS Live Integration Service (KFH Branch Core & Fulfillment)
// ============================================================
public interface IGfsService
{
    Task<(bool success, string? customerAccount, decimal averageCost)> LookupBarAsync(string serialNumber);
    Task<PMIMS.Domain.GfsDeliveryRequest?> GetDeliveryRequestAsync(string gfsRefNumber);
    Task<PMIMS.Domain.HomeDeliveryRequest?> GetHomeDeliveryRequestAsync(string deliveryNumber);
    Task<(bool success, string? customerName, string? rim, string? accountNo, decimal goldHoldingGrams)> LookupCustomerProfileAsync(string civilIdOrAccount);
    Task<bool> SyncEodDataAsync(List<PMIMS.Domain.InventoryItem> items);
}

