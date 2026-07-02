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
    Task<string> IntakeInventoryItemsAsync(int poId, string lotNumber, int locationId, string receivedBy, string serialsJsonList);
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
    Task SaveAuditLogAsync(string username, string ipAddress, string moduleName, string actionDescription, string? sqlExecuted = null);
    
    // Workflow Engine
    Task<IEnumerable<WorkflowTemplate>> GetWorkflowTemplatesAsync();
    Task<WorkflowTemplate?> SaveWorkflowTemplateAsync(string workflowType, string name, string description, string stepsJson);
    Task<WorkflowInstance> StartWorkflowInstanceAsync(string workflowType, int entityId, string username);
    Task<string> ProcessWorkflowActionAsync(int instanceId, string username, string action, string? comments);
    Task<IEnumerable<WorkflowInstance>> GetActiveWorkflowInstancesAsync();
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
    Task<BranchTransfer> InitiateWorkflowBranchTransferAsync(int itemId, int destinationBranchId, string courierInfo, string initiatedBy);
    Task<string> ReceiveBranchTransferAsync(int transferId, string receivedBy);
    Task<PendingIntake> InitiateWorkflowIntakeAsync(int poId, string lotNumber, int locationId, string receivedBy, string serialsJsonList);
    Task<IEnumerable<PendingIntake>> GetPendingIntakesAsync();
}

public interface IActiveDirectoryService
{
    Task<(bool success, string? displayName, List<string> roles)> AuthenticateAsync(string username, string password);
}

public interface IFimService
{
    // Identity Provisioning Functions
    Task<IEnumerable<string>> GetUsersAsync();
    Task<int> GetNumberOfUsersAsync();
    Task<dynamic> GetUserInfoAsync(string username);
    Task<IEnumerable<string>> GetProfilesAsync();
    Task<int> GetNumberOfProfilesAsync();
    Task<dynamic> GetProfileInfoAsync(string profileName);
    Task<IEnumerable<string>> GetUsersFromProfileAsync(string profileName);
    Task<int> GetNumberOfUsersFromProfileAsync(string profileName);
    Task<IEnumerable<string>> GetProfilesFromUserAsync(string username);
    Task<int> GetNumberOfProfilesFromUserAsync(string username);
    Task<bool> AddUserAsync(string username, string email, string passwordHash);
    Task<bool> AddProfileAsync(string profileName, string description);
    Task<bool> AddUserToProfileAsync(string username, string profileName);
    Task<bool> UpdateProfileInfoAsync(string profileName, string description);
    Task<bool> UpdateUserInfoAsync(string username, string email);
    Task<bool> RemoveUserAsync(string username);
    Task<bool> RemoveProfileAsync(string profileName);
    Task<bool> RemoveUserFromProfileAsync(string username, string profileName);

    // Access Management Functions
    Task<IEnumerable<string>> GetAllRightsAsync();
    Task<int> GetNumberOfRightsAsync();
    Task<dynamic> GetRightInfoAsync(string rightName);
    Task<IEnumerable<string>> GetAllRightsForUserAsync(string username);
    Task<int> GetNumberOfRightsForUserAsync(string username);
    Task<IEnumerable<string>> GetAllUsersForRightAsync(string rightName);
    Task<int> GetNumberOfUsersForRightAsync(string rightName);
    Task<bool> AddUserToRightAsync(string username, string rightName);
    Task<bool> RemoveUserFromRightAsync(string username, string rightName);

    // Connection support & Sync change detection
    Task<IEnumerable<dynamic>> DetectDeltaChangesAsync(DateTime lastSyncTime);
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
