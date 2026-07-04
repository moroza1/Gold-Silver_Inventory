using Microsoft.EntityFrameworkCore;
using PMIMS.Application;
using PMIMS.Domain;

namespace PMIMS.Infrastructure;

public class AppDbContext : DbContext
{
    // Optional/nullable (default null) so every existing `new AppDbContext(options)` call
    // site -- test fixtures included -- keeps compiling unchanged. When resolved through DI
    // (Program.cs), the real-time monitoring notifier is supplied automatically.
    private readonly IInventoryMonitoringNotifier? _monitoringNotifier;

    public AppDbContext(DbContextOptions<AppDbContext> options, IInventoryMonitoringNotifier? monitoringNotifier = null) : base(options)
    {
        _monitoringNotifier = monitoringNotifier;
    }

    // =========================================================================
    // Real-Time Inventory Monitoring
    // ------------------------------------------------------------------------
    // Single choke point for pushing live movement/balance-change events, instead
    // of instrumenting every call site in InventoryRepository.cs that creates an
    // InventoryTransaction or updates an InventoryBalance (there are many, across
    // intake, transfers, withdrawals, sales, GDM dispense, and reconciliation).
    // Every one of those call sites already ends in `await _dbContext.SaveChangesAsync()`,
    // so capturing newly-tracked entities here before the save, then notifying
    // after, covers all of them for free and can't drift out of sync as new
    // movement types are added later.
    // =========================================================================
    public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        var newTransactions = _monitoringNotifier == null
            ? null
            : ChangeTracker.Entries<InventoryTransaction>()
                .Where(e => e.State == EntityState.Added)
                .Select(e => e.Entity)
                .ToList();

        var changedBalances = _monitoringNotifier == null
            ? null
            : ChangeTracker.Entries<InventoryBalance>()
                .Where(e => e.State == EntityState.Added || e.State == EntityState.Modified)
                .Select(e => e.Entity)
                .ToList();

        int result = await base.SaveChangesAsync(cancellationToken);

        if (_monitoringNotifier != null)
        {
            if (newTransactions != null)
            {
                foreach (var tx in newTransactions)
                {
                    await _monitoringNotifier.NotifyMovementAsync(tx);
                }
            }
            if (changedBalances != null)
            {
                foreach (var balance in changedBalances)
                {
                    await _monitoringNotifier.NotifyBalanceChangedAsync(balance);
                }
            }
        }

        return result;
    }

    public DbSet<StatusCodes> StatusCodes { get; set; } = null!;
    public DbSet<ReasonCodes> ReasonCodes { get; set; } = null!;
    public DbSet<MetalType> MetalTypes { get; set; } = null!;
    public DbSet<MetalPurityLevel> MetalPurityLevels { get; set; } = null!;
    public DbSet<MetalDenomination> MetalDenominations { get; set; } = null!;
    public DbSet<MetalProduct> MetalProducts { get; set; } = null!;
    public DbSet<Vendor> Vendors { get; set; } = null!;
    public DbSet<Vault> Vaults { get; set; } = null!;
    public DbSet<Branch> Branches { get; set; } = null!;
    public DbSet<Channel> Channels { get; set; } = null!;
    public DbSet<InventoryLocation> InventoryLocations { get; set; } = null!;
    public DbSet<Customer> Customers { get; set; } = null!;
    public DbSet<CustomerAccount> CustomerAccounts { get; set; } = null!;
    public DbSet<PurchaseOrder> PurchaseOrders { get; set; } = null!;
    public DbSet<POItem> POItems { get; set; } = null!;
    public DbSet<InventoryLot> InventoryLots { get; set; } = null!;
    public DbSet<InventoryItem> InventoryItems { get; set; } = null!;
    public DbSet<InventoryBalance> InventoryBalances { get; set; } = null!;
    public DbSet<CustomerHolding> CustomerHoldings { get; set; } = null!;
    public DbSet<CustomerAllocation> CustomerAllocations { get; set; } = null!;
    public DbSet<ReservationRequest> ReservationRequests { get; set; } = null!;
    public DbSet<InventoryTransaction> InventoryTransactions { get; set; } = null!;
    public DbSet<MovementTransaction> MovementTransactions { get; set; } = null!;
    public DbSet<SalesOrder> SalesOrders { get; set; } = null!;
    public DbSet<RedemptionRequest> RedemptionRequests { get; set; } = null!;
    public DbSet<WithdrawalRequest> WithdrawalRequests { get; set; } = null!;
    public DbSet<StocktakeSession> StocktakeSessions { get; set; } = null!;
    public DbSet<StocktakeFreeze> StocktakeFreezes { get; set; } = null!;
    public DbSet<StocktakeScan> StocktakeScans { get; set; } = null!;
    public DbSet<ReconciliationRun> ReconciliationRuns { get; set; } = null!;
    public DbSet<ReconciliationItem> ReconciliationItems { get; set; } = null!;
    public DbSet<MismatchCase> MismatchCases { get; set; } = null!;
    public DbSet<ExchangeRate> ExchangeRates { get; set; } = null!;
    public DbSet<ValuationSnapshot> ValuationSnapshots { get; set; } = null!;
    public DbSet<WorkflowInstance> WorkflowInstances { get; set; } = null!;
    public DbSet<ApprovalAction> ApprovalActions { get; set; } = null!;
    public DbSet<AuditLog> AuditLogs { get; set; } = null!;
    public DbSet<DocumentUpload> DocumentUploads { get; set; } = null!;
    public DbSet<ExtractedDocumentField> ExtractedDocumentFields { get; set; } = null!;
    public DbSet<UserRole> UserRoles { get; set; } = null!;
    public DbSet<UserPermission> UserPermissions { get; set; } = null!;
    public DbSet<MigrationStagingItem> MigrationStagingItems { get; set; } = null!;
    public DbSet<WorkflowTemplate> WorkflowTemplates { get; set; } = null!;
    public DbSet<WorkflowStep> WorkflowSteps { get; set; } = null!;
    public DbSet<AppUser> AppUsers { get; set; } = null!;
    public DbSet<PrivilegeGroup> PrivilegeGroups { get; set; } = null!;
    public DbSet<GroupPermission> GroupPermissions { get; set; } = null!;
    public DbSet<UserGroupMembership> UserGroupMemberships { get; set; } = null!;
    public DbSet<ReorderThreshold> ReorderThresholds { get; set; } = null!;
    public DbSet<BranchTransfer> BranchTransfers { get; set; } = null!;
    public DbSet<PendingIntake> PendingIntakes { get; set; } = null!;

    // FIM Integration Module
    public DbSet<FimUserAttribute> FimUserAttributes { get; set; } = null!;
    public DbSet<FimRight> FimRights { get; set; } = null!;
    public DbSet<FimUserRight> FimUserRights { get; set; } = null!;
    public DbSet<FimSyncLog> FimSyncLogs { get; set; } = null!;

    // Dynamic Business Validation Rules Engine
    public DbSet<BusinessRule> BusinessRules { get; set; } = null!;
    public DbSet<BusinessRuleEvaluation> BusinessRuleEvaluations { get; set; } = null!;

    // Automatic Management Email Notifications
    public DbSet<NotificationSubscription> NotificationSubscriptions { get; set; } = null!;
    public DbSet<NotificationDelivery> NotificationDeliveries { get; set; } = null!;

    // KFH Existing Monitoring Tool Integration
    public DbSet<MonitoringEvent> MonitoringEvents { get; set; } = null!;
    public DbSet<MonitoringAlertRoute> MonitoringAlertRoutes { get; set; } = null!;

    // LBMA Chain-of-Custody & IFRS Valuation Disclosures
    public DbSet<ChainOfCustodyEvent> ChainOfCustodyEvents { get; set; } = null!;
    public DbSet<IfrsValuationDisclosure> IfrsValuationDisclosures { get; set; } = null!;

    // Gold Dispensing Machine (GDM) Integration -- scalability hook
    public DbSet<DispensingDevice> DispensingDevices { get; set; } = null!;
    public DbSet<DispenseTransaction> DispenseTransactions { get; set; } = null!;

    // Cost Tracking & Valuation -- Core Banking (IMAL) GL Integration
    public DbSet<CoreBankingLedgerPosting> CoreBankingLedgerPostings { get; set; } = null!;

    // Reporting Requirements Gap Analysis -- Cost Analysis & Variance (Item 8)
    public DbSet<CostBudget> CostBudgets { get; set; } = null!;

    // Sidebar Menu Layout -- admin-arrangeable navigation order (single global row)
    public DbSet<SidebarMenuLayout> SidebarMenuLayouts { get; set; } = null!;

    // KFHOnline Transaction Audit Log
    public DbSet<KFHOnlineTransactionLog> KFHOnlineTransactionLogs { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // StatusCodes Configuration
        modelBuilder.Entity<StatusCodes>(entity =>
        {
            entity.HasKey(e => e.StatusCode);
            entity.ToTable("status_codes");
        });

        // ReasonCodes Configuration
        modelBuilder.Entity<ReasonCodes>(entity =>
        {
            entity.HasKey(e => e.ReasonCode);
            entity.ToTable("reason_codes");
        });

        // MetalType Configuration
        modelBuilder.Entity<MetalType>(entity =>
        {
            entity.HasKey(e => e.MetalTypeId);
            entity.ToTable("metal_types");
            entity.HasIndex(e => e.MetalName).IsUnique();
        });

        // MetalPurityLevel Configuration
        modelBuilder.Entity<MetalPurityLevel>(entity =>
        {
            entity.HasKey(e => e.PurityId);
            entity.ToTable("metal_purity_levels");
            entity.HasIndex(e => e.PurityValue).IsUnique();
        });

        // MetalDenomination Configuration
        modelBuilder.Entity<MetalDenomination>(entity =>
        {
            entity.HasKey(e => e.DenominationId);
            entity.ToTable("metal_denominations");
            entity.HasIndex(e => e.Label).IsUnique();
            entity.HasOne(e => e.MetalType)
                  .WithMany()
                  .HasForeignKey(e => e.MetalTypeId);
        });

        // MetalProduct Configuration
        modelBuilder.Entity<MetalProduct>(entity =>
        {
            entity.HasKey(e => e.ProductId);
            entity.ToTable("metal_products");
            entity.HasIndex(e => e.ProductCode).IsUnique();
            entity.HasOne(e => e.MetalType).WithMany().HasForeignKey(e => e.MetalTypeId);
            entity.HasOne(e => e.Denomination).WithMany().HasForeignKey(e => e.DenominationId);
            entity.HasOne(e => e.Purity).WithMany().HasForeignKey(e => e.PurityId);
        });

        // Vendor Configuration
        modelBuilder.Entity<Vendor>(entity =>
        {
            entity.HasKey(e => e.VendorId);
            entity.ToTable("vendors");
            entity.HasIndex(e => e.VendorCode).IsUnique();
        });

        // Vault Configuration
        modelBuilder.Entity<Vault>(entity =>
        {
            entity.HasKey(e => e.VaultId);
            entity.ToTable("vaults");
        });

        // Branch Configuration
        modelBuilder.Entity<Branch>(entity =>
        {
            entity.HasKey(e => e.BranchId);
            entity.ToTable("branches");
            entity.HasIndex(e => e.BranchCode).IsUnique();
            entity.HasOne(e => e.Vault).WithMany().HasForeignKey(e => e.VaultId);
        });

        // Channel Configuration
        modelBuilder.Entity<Channel>(entity =>
        {
            entity.HasKey(e => e.ChannelId);
            entity.ToTable("channels");
            entity.HasIndex(e => e.ChannelName).IsUnique();
        });

        // InventoryLocation Configuration
        modelBuilder.Entity<InventoryLocation>(entity =>
        {
            entity.HasKey(e => e.LocationId);
            entity.ToTable("inventory_locations");
            entity.HasOne(e => e.Vault).WithMany().HasForeignKey(e => e.VaultId);
            entity.HasOne(e => e.Branch).WithMany().HasForeignKey(e => e.BranchId);
            
            // Map computed persisted description column or ignore it in sqlite
            if (Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
            {
                entity.Property(e => e.Description).HasComputedColumnSql("[zone_room] || ' - ' || [shelf_row] || ' - ' || [slot_bin]", stored: true);
            }
            else
            {
                entity.Property(e => e.Description).HasComputedColumnSql("[zone_room] + ' - ' + [shelf_row] + ' - ' + [slot_bin]", stored: true);
            }
        });

        // Customer Configuration
        modelBuilder.Entity<Customer>(entity =>
        {
            entity.HasKey(e => e.CustomerId);
            entity.ToTable("customers");
            entity.HasIndex(e => e.CivilId).IsUnique();
        });

        // CustomerAccount Configuration
        modelBuilder.Entity<CustomerAccount>(entity =>
        {
            entity.HasKey(e => e.AccountId);
            entity.ToTable("customer_accounts");
            entity.HasIndex(e => e.AccountNumber).IsUnique();
            entity.HasOne(e => e.Customer).WithMany().HasForeignKey(e => e.CustomerId);
        });

        // PurchaseOrder Configuration
        modelBuilder.Entity<PurchaseOrder>(entity =>
        {
            entity.HasKey(e => e.PoId);
            entity.ToTable("purchase_orders");
            entity.HasIndex(e => e.PoNumber).IsUnique();
            entity.HasOne(e => e.Vendor).WithMany().HasForeignKey(e => e.VendorId);
            // Computed in C# from other mapped columns (TotalCost + fees) -- not its own column.
            entity.Ignore(e => e.LandedCost);
        });

        // POItem Configuration
        modelBuilder.Entity<POItem>(entity =>
        {
            entity.HasKey(e => e.PoItemId);
            entity.ToTable("po_items");
            entity.HasOne(e => e.Product).WithMany().HasForeignKey(e => e.ProductId);
            // Configure the relationship between POItem and PurchaseOrder so Items are properly loaded
            entity.HasOne<PurchaseOrder>().WithMany(p => p.Items).HasForeignKey(e => e.PoId);
        });

        // InventoryLot Configuration
        modelBuilder.Entity<InventoryLot>(entity =>
        {
            entity.HasKey(e => e.LotId);
            entity.ToTable("inventory_lots");
            entity.HasIndex(e => e.LotNumber).IsUnique();
            entity.HasOne(e => e.PurchaseOrder).WithMany().HasForeignKey(e => e.PoId);
            entity.HasOne(e => e.Vendor).WithMany().HasForeignKey(e => e.VendorId);
        });

        // InventoryItem Configuration
        modelBuilder.Entity<InventoryItem>(entity =>
        {
            entity.HasKey(e => e.ItemId);
            entity.ToTable("inventory_items");
            entity.HasIndex(e => e.SerialNumber).IsUnique();
            entity.HasOne(e => e.Product).WithMany().HasForeignKey(e => e.ProductId);
            entity.HasOne(e => e.Lot).WithMany().HasForeignKey(e => e.LotId);
            entity.HasOne(e => e.Location).WithMany().HasForeignKey(e => e.LocationId);
            entity.Property(e => e.RowVersion).IsRowVersion();
        });

        // InventoryBalance Configuration
        modelBuilder.Entity<InventoryBalance>(entity =>
        {
            entity.HasKey(e => e.BalanceId);
            entity.ToTable("inventory_balances");
            entity.HasIndex(e => new { e.LocationId, e.ProductId, e.OwnershipType }).IsUnique();
            entity.HasOne(e => e.Location).WithMany().HasForeignKey(e => e.LocationId);
            entity.HasOne(e => e.Product).WithMany().HasForeignKey(e => e.ProductId);
        });

        // CustomerHolding Configuration
        modelBuilder.Entity<CustomerHolding>(entity =>
        {
            entity.HasKey(e => e.HoldingId);
            entity.ToTable("customer_holdings");
            // CustomerId is optional - external customers may not exist in the Customer table
            entity.HasOne(e => e.Customer).WithMany().HasForeignKey(e => e.CustomerId).IsRequired(false);
            // AccountId is optional - external customers may not have internal accounts
            entity.HasOne(e => e.Account).WithMany().HasForeignKey(e => e.AccountId).IsRequired(false);
            entity.HasOne(e => e.Item).WithOne().HasForeignKey<CustomerHolding>(e => e.ItemId);
            // Index for fast lookup by external customer RIM
            entity.HasIndex(e => e.CustomerRim);
        });

        // CustomerAllocation Configuration
        modelBuilder.Entity<CustomerAllocation>(entity =>
        {
            entity.HasKey(e => e.AllocationId);
            entity.ToTable("customer_allocations");
            entity.HasOne(e => e.CustomerHolding).WithMany().HasForeignKey(e => e.HoldingId);
            entity.HasOne(e => e.AssignedLocation).WithMany().HasForeignKey(e => e.AssignedLocationId);
        });

        // ReservationRequest Configuration
        modelBuilder.Entity<ReservationRequest>(entity =>
        {
            entity.HasKey(e => e.ReservationId);
            entity.ToTable("reservation_requests");
            entity.HasIndex(e => e.ReservationToken).IsUnique();
            entity.HasIndex(e => e.IdempotencyKey).IsUnique();
            entity.HasOne(e => e.Customer).WithMany().HasForeignKey(e => e.CustomerId);
            entity.HasOne(e => e.Item).WithMany().HasForeignKey(e => e.ItemId);
            entity.HasOne(e => e.Channel).WithMany().HasForeignKey(e => e.ChannelId);
        });

        // InventoryTransaction Configuration
        modelBuilder.Entity<InventoryTransaction>(entity =>
        {
            entity.HasKey(e => e.TransactionId);
            entity.ToTable("inventory_transactions");
            entity.HasIndex(e => e.TransactionNumber).IsUnique();
            entity.HasOne(e => e.Item).WithMany().HasForeignKey(e => e.ItemId);
            entity.HasOne(e => e.SourceLocation).WithMany().HasForeignKey(e => e.SourceLocationId);
            entity.HasOne(e => e.DestinationLocation).WithMany().HasForeignKey(e => e.DestinationLocationId);
        });

        // MovementTransaction Configuration
        modelBuilder.Entity<MovementTransaction>(entity =>
        {
            entity.HasKey(e => e.MovementId);
            entity.ToTable("movement_transactions");
            entity.HasOne(e => e.Transaction).WithMany().HasForeignKey(e => e.TransactionId);
        });

        // SalesOrder Configuration
        modelBuilder.Entity<SalesOrder>(entity =>
        {
            entity.HasKey(e => e.OrderId);
            entity.ToTable("sales_orders");
            entity.HasIndex(e => e.OrderNumber).IsUnique();
            entity.HasIndex(e => e.InvoiceNumber).IsUnique();
            entity.HasOne(e => e.Customer).WithMany().HasForeignKey(e => e.CustomerId);
            entity.HasOne(e => e.Account).WithMany().HasForeignKey(e => e.AccountId);
            entity.HasOne(e => e.Item).WithMany().HasForeignKey(e => e.ItemId);
            entity.HasOne(e => e.Channel).WithMany().HasForeignKey(e => e.ChannelId);
        });

        // RedemptionRequest Configuration
        modelBuilder.Entity<RedemptionRequest>(entity =>
        {
            entity.HasKey(e => e.RedemptionId);
            entity.ToTable("redemption_requests");
            entity.HasIndex(e => e.RedemptionNumber).IsUnique();
            entity.HasOne(e => e.Holding).WithMany().HasForeignKey(e => e.HoldingId);
        });

        // WithdrawalRequest Configuration
        modelBuilder.Entity<WithdrawalRequest>(entity =>
        {
            entity.HasKey(e => e.WithdrawalId);
            entity.ToTable("withdrawal_requests");
            entity.HasOne(e => e.Redemption).WithMany().HasForeignKey(e => e.RedemptionId);
            entity.HasOne(e => e.Holding).WithMany().HasForeignKey(e => e.HoldingId);
            entity.HasOne(e => e.DestinationBranch).WithMany().HasForeignKey(e => e.DestinationBranchId);
        });

        // StocktakeSession Configuration
        modelBuilder.Entity<StocktakeSession>(entity =>
        {
            entity.HasKey(e => e.SessionId);
            entity.ToTable("stocktake_sessions");
            entity.HasIndex(e => e.SessionCode).IsUnique();
            entity.HasOne(e => e.Vault).WithMany().HasForeignKey(e => e.VaultId);
        });

        // StocktakeFreeze Configuration
        modelBuilder.Entity<StocktakeFreeze>(entity =>
        {
            entity.HasKey(e => e.FreezeId);
            entity.ToTable("stocktake_freezes");
            entity.HasOne(e => e.Session).WithMany().HasForeignKey(e => e.SessionId);
            entity.HasOne(e => e.Location).WithMany().HasForeignKey(e => e.LocationId);
        });

        // StocktakeScan Configuration
        modelBuilder.Entity<StocktakeScan>(entity =>
        {
            entity.HasKey(e => e.ScanId);
            entity.ToTable("stocktake_scans");
            entity.HasOne(e => e.Session).WithMany().HasForeignKey(e => e.SessionId);
            entity.HasOne(e => e.Location).WithMany().HasForeignKey(e => e.LocationId);
        });

        // ReconciliationRun Configuration
        modelBuilder.Entity<ReconciliationRun>(entity =>
        {
            entity.HasKey(e => e.RunId);
            entity.ToTable("reconciliation_runs");
        });

        // ReconciliationItem Configuration
        modelBuilder.Entity<ReconciliationItem>(entity =>
        {
            entity.HasKey(e => e.ReconItemId);
            entity.ToTable("reconciliation_items");
            entity.HasOne(e => e.Run).WithMany().HasForeignKey(e => e.RunId);
            entity.HasOne(e => e.Item).WithMany().HasForeignKey(e => e.ItemId);
        });

        // MismatchCase Configuration
        modelBuilder.Entity<MismatchCase>(entity =>
        {
            entity.HasKey(e => e.CaseId);
            entity.ToTable("mismatch_cases");
            entity.HasOne(e => e.ReconItem).WithMany().HasForeignKey(e => e.ReconItemId);
        });

        // ExchangeRate Configuration
        modelBuilder.Entity<ExchangeRate>(entity =>
        {
            entity.HasKey(e => e.RateId);
            entity.ToTable("exchange_rates");
            entity.HasOne(e => e.MetalType).WithMany().HasForeignKey(e => e.MetalTypeId);
        });

        // ValuationSnapshot Configuration
        modelBuilder.Entity<ValuationSnapshot>(entity =>
        {
            entity.HasKey(e => e.SnapshotId);
            entity.ToTable("valuation_snapshots");
        });

        // WorkflowInstance Configuration
        modelBuilder.Entity<WorkflowInstance>(entity =>
        {
            entity.HasKey(e => e.InstanceId);
            entity.ToTable("workflow_instances");
        });

        // WorkflowTemplate Configuration
        modelBuilder.Entity<WorkflowTemplate>(entity =>
        {
            entity.HasKey(e => e.TemplateId);
            entity.ToTable("workflow_templates");
        });

        // WorkflowStep Configuration
        modelBuilder.Entity<WorkflowStep>(entity =>
        {
            entity.HasKey(e => e.StepId);
            entity.ToTable("workflow_steps");
            entity.HasOne<WorkflowTemplate>()
                  .WithMany(t => t.Steps)
                  .HasForeignKey(e => e.TemplateId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        // ApprovalAction Configuration
        modelBuilder.Entity<ApprovalAction>(entity =>
        {
            entity.HasKey(e => e.ActionId);
            entity.ToTable("approval_actions");
            entity.HasOne(e => e.Instance).WithMany().HasForeignKey(e => e.InstanceId);
        });

        // AuditLog Configuration
        modelBuilder.Entity<AuditLog>(entity =>
        {
            entity.HasKey(e => e.LogId);
            entity.ToTable("audit_logs");
        });

        // DocumentUpload Configuration
        modelBuilder.Entity<DocumentUpload>(entity =>
        {
            entity.HasKey(e => e.DocumentId);
            entity.ToTable("document_uploads");
        });

        // ExtractedDocumentField Configuration
        modelBuilder.Entity<ExtractedDocumentField>(entity =>
        {
            entity.HasKey(e => e.FieldId);
            entity.ToTable("extracted_document_fields");
            entity.HasOne(e => e.Document).WithMany().HasForeignKey(e => e.DocumentId);
        });

        // UserRole Configuration
        modelBuilder.Entity<UserRole>(entity =>
        {
            entity.HasKey(e => e.RoleId);
            entity.ToTable("user_roles");
            entity.HasIndex(e => e.RoleName).IsUnique();
        });

        // UserPermission Configuration
        modelBuilder.Entity<UserPermission>(entity =>
        {
            entity.HasKey(e => e.PermissionId);
            entity.ToTable("user_permissions");
            entity.HasOne(e => e.Role).WithMany().HasForeignKey(e => e.RoleId);
        });

        // MigrationStagingItem Configuration
        modelBuilder.Entity<MigrationStagingItem>(entity =>
        {
            entity.HasKey(e => e.StagingId);
            entity.ToTable("migration_staging_items");
        });

        // AppUser Configuration
        modelBuilder.Entity<AppUser>(entity =>
        {
            entity.HasKey(e => e.UserId);
            entity.ToTable("app_users");
            entity.HasIndex(e => e.Username).IsUnique();
            entity.HasIndex(e => e.Email).IsUnique();
        });

        // PrivilegeGroup Configuration
        modelBuilder.Entity<PrivilegeGroup>(entity =>
        {
            entity.HasKey(e => e.GroupId);
            entity.ToTable("privilege_groups");
            entity.HasIndex(e => e.GroupName).IsUnique();
        });

        // GroupPermission Configuration
        modelBuilder.Entity<GroupPermission>(entity =>
        {
            entity.HasKey(e => e.PermissionId);
            entity.ToTable("group_permissions");
            entity.HasIndex(e => new { e.GroupId, e.ModuleKey }).IsUnique();
            entity.HasOne(e => e.Group)
                  .WithMany(g => g.Permissions)
                  .HasForeignKey(e => e.GroupId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        // UserGroupMembership Configuration
        modelBuilder.Entity<UserGroupMembership>(entity =>
        {
            entity.HasKey(e => e.MembershipId);
            entity.ToTable("user_group_memberships");
            entity.HasIndex(e => new { e.UserId, e.GroupId }).IsUnique();
            entity.HasOne(e => e.User)
                  .WithMany(u => u.Memberships)
                  .HasForeignKey(e => e.UserId)
                  .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Group)
                  .WithMany(g => g.Members)
                  .HasForeignKey(e => e.GroupId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        // Loop over all entities and convert property/column names to snake_case
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            foreach (var property in entity.GetProperties())
            {
                var columnName = ConvertToSnakeCase(property.Name);
                property.SetColumnName(columnName);

                // Configure RowVersion for SQLite if running on SQLite
                if (property.Name == "RowVersion" && Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
                {
                    property.SetDefaultValueSql("randomblob(8)");
                    property.ValueGenerated = Microsoft.EntityFrameworkCore.Metadata.ValueGenerated.OnAddOrUpdate;
                }
            }

            foreach (var key in entity.GetKeys())
            {
                key.SetName(ConvertToSnakeCase(key.GetName()));
            }

            foreach (var key in entity.GetForeignKeys())
            {
                key.SetConstraintName(ConvertToSnakeCase(key.GetConstraintName()));
            }

            foreach (var index in entity.GetIndexes())
            {
                index.SetDatabaseName(ConvertToSnakeCase(index.GetDatabaseName()));
            }
        }

        // ReorderThreshold Configuration
        modelBuilder.Entity<ReorderThreshold>(entity =>
        {
            entity.HasKey(e => e.ThresholdId);
            entity.ToTable("reorder_thresholds");
            entity.HasOne(e => e.Product).WithMany().HasForeignKey(e => e.ProductId);
            entity.HasOne(e => e.Vendor).WithMany().HasForeignKey(e => e.VendorId);
        });

        // BranchTransfer Configuration
        modelBuilder.Entity<BranchTransfer>(entity =>
        {
            entity.HasKey(e => e.TransferId);
            entity.ToTable("branch_transfers");
            entity.HasOne(e => e.Item).WithMany().HasForeignKey(e => e.ItemId);
            entity.HasOne(e => e.SourceBranch).WithMany().HasForeignKey(e => e.SourceBranchId);
            entity.HasOne(e => e.DestinationBranch).WithMany().HasForeignKey(e => e.DestinationBranchId);
        });

        // PendingIntake Configuration
        modelBuilder.Entity<PendingIntake>(entity =>
        {
            entity.HasKey(e => e.PendingIntakeId);
            entity.ToTable("pending_intakes");
            // Optional now -- a CUSTOMER-sourced receipt (buyback/custody deposit/return) has
            // no Purchase Order at all. SUPPLIER receipts still always set PoId.
            entity.HasOne(e => e.PurchaseOrder).WithMany().HasForeignKey(e => e.PoId).IsRequired(false);
            entity.HasOne(e => e.Location).WithMany().HasForeignKey(e => e.LocationId);
            entity.HasOne(e => e.Customer).WithMany().HasForeignKey(e => e.CustomerId).IsRequired(false);
        });

        // ============================================================
        // FIM Integration Module Configuration
        // ============================================================

        // FimUserAttribute Configuration
        modelBuilder.Entity<FimUserAttribute>(entity =>
        {
            entity.HasKey(e => e.AttributeId);
            entity.ToTable("fim_user_attributes");
            entity.HasIndex(e => new { e.UserId, e.AttributeName }).IsUnique();
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        // FimRight Configuration
        modelBuilder.Entity<FimRight>(entity =>
        {
            entity.HasKey(e => e.RightId);
            entity.ToTable("fim_rights");
            entity.HasIndex(e => e.RightCode).IsUnique();
        });

        // FimUserRight Configuration
        modelBuilder.Entity<FimUserRight>(entity =>
        {
            entity.HasKey(e => e.UserRightId);
            entity.ToTable("fim_user_rights");
            entity.HasIndex(e => new { e.UserId, e.RightId }).IsUnique();
            entity.HasOne(e => e.User).WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Right).WithMany().HasForeignKey(e => e.RightId).OnDelete(DeleteBehavior.Cascade);
        });

        // FimSyncLog Configuration
        modelBuilder.Entity<FimSyncLog>(entity =>
        {
            entity.HasKey(e => e.SyncLogId);
            entity.ToTable("fim_sync_logs");
            entity.HasIndex(e => e.ChangedAt);
        });

        // ============================================================
        // Dynamic Business Validation Rules Engine Configuration
        // ============================================================

        modelBuilder.Entity<BusinessRule>(entity =>
        {
            entity.HasKey(e => e.RuleId);
            entity.ToTable("business_rules");
            entity.HasIndex(e => new { e.RuleCode, e.Version }).IsUnique();
            entity.HasIndex(e => e.RuleType);
        });

        modelBuilder.Entity<BusinessRuleEvaluation>(entity =>
        {
            entity.HasKey(e => e.EvaluationId);
            entity.ToTable("business_rule_evaluations");
            entity.HasOne(e => e.Rule).WithMany().HasForeignKey(e => e.RuleId).OnDelete(DeleteBehavior.Cascade);
        });

        // ============================================================
        // Automatic Management Email Notifications Configuration
        // ============================================================

        modelBuilder.Entity<NotificationSubscription>(entity =>
        {
            entity.HasKey(e => e.SubscriptionId);
            entity.ToTable("notification_subscriptions");
        });

        modelBuilder.Entity<NotificationDelivery>(entity =>
        {
            entity.HasKey(e => e.DeliveryId);
            entity.ToTable("notification_deliveries");
            entity.HasOne(e => e.Subscription).WithMany().HasForeignKey(e => e.SubscriptionId).OnDelete(DeleteBehavior.Cascade);
        });

        // ============================================================
        // KFH Existing Monitoring Tool Integration Configuration
        // ============================================================

        modelBuilder.Entity<MonitoringEvent>(entity =>
        {
            entity.HasKey(e => e.EventId);
            entity.ToTable("monitoring_events");
            entity.HasIndex(e => e.OccurredAt);
        });

        modelBuilder.Entity<MonitoringAlertRoute>(entity =>
        {
            entity.HasKey(e => e.RouteId);
            entity.ToTable("monitoring_alert_routes");
        });

        // ============================================================
        // Cost Tracking & Valuation -- Core Banking (IMAL) GL Integration
        // ============================================================
        modelBuilder.Entity<CoreBankingLedgerPosting>(entity =>
        {
            entity.HasKey(e => e.PostingId);
            entity.ToTable("core_banking_ledger_postings");
            entity.HasIndex(e => new { e.SourceType, e.SourceId });
            entity.HasIndex(e => e.CreatedAt);
        });

        // ============================================================
        // LBMA Chain-of-Custody Configuration
        // ============================================================
        modelBuilder.Entity<ChainOfCustodyEvent>(entity =>
        {
            entity.HasKey(e => e.CustodyEventId);
            entity.ToTable("chain_of_custody_events");
            entity.HasIndex(e => e.ItemId);
            entity.HasOne(e => e.Item).WithMany().HasForeignKey(e => e.ItemId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Location).WithMany().HasForeignKey(e => e.LocationId).OnDelete(DeleteBehavior.Restrict);
        });

        // ============================================================
        // IFRS Valuation Disclosure Configuration
        // ============================================================
        modelBuilder.Entity<IfrsValuationDisclosure>(entity =>
        {
            entity.HasKey(e => e.DisclosureId);
            entity.ToTable("ifrs_valuation_disclosures");
            entity.HasIndex(e => e.SnapshotDate);
            entity.HasOne(e => e.MetalType).WithMany().HasForeignKey(e => e.MetalTypeId);
        });

        // ============================================================
        // Gold Dispensing Machine (GDM) Integration Configuration
        // ============================================================
        modelBuilder.Entity<DispensingDevice>(entity =>
        {
            entity.HasKey(e => e.DeviceId);
            entity.ToTable("dispensing_devices");
            entity.HasIndex(e => e.DeviceCode).IsUnique();
            entity.HasOne(e => e.Location).WithMany().HasForeignKey(e => e.LocationId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Branch).WithMany().HasForeignKey(e => e.BranchId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<DispenseTransaction>(entity =>
        {
            entity.HasKey(e => e.DispenseId);
            entity.ToTable("dispense_transactions");
            entity.HasIndex(e => e.IdempotencyKey).IsUnique();
            entity.HasOne(e => e.Device).WithMany().HasForeignKey(e => e.DeviceId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Product).WithMany().HasForeignKey(e => e.ProductId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Item).WithMany().HasForeignKey(e => e.ItemId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Customer).WithMany().HasForeignKey(e => e.CustomerId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.Channel).WithMany().HasForeignKey(e => e.ChannelId).OnDelete(DeleteBehavior.Restrict);
        });

        // ============================================================
        // Reporting Requirements Gap Analysis -- Cost Analysis & Variance (Item 8)
        // ============================================================
        modelBuilder.Entity<CostBudget>(entity =>
        {
            entity.HasKey(e => e.BudgetId);
            entity.ToTable("cost_budgets");
            entity.HasIndex(e => new { e.MetalTypeId, e.Period }).IsUnique();
            entity.HasOne(e => e.MetalType).WithMany().HasForeignKey(e => e.MetalTypeId);
        });

        // SidebarMenuLayout Configuration -- singleton row (Id always 1)
        modelBuilder.Entity<SidebarMenuLayout>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.ToTable("sidebar_menu_layout");
        });

        // ============================================================
        // KFHOnline Transaction Audit Log Configuration
        // ============================================================
        modelBuilder.Entity<KFHOnlineTransactionLog>(entity =>
        {
            entity.HasKey(e => e.LogId);
            entity.ToTable("kfhonline_transaction_logs");
            entity.HasIndex(e => e.TransactionType);
            entity.HasIndex(e => e.CustomerId);
            entity.HasIndex(e => e.StatusCode);
            entity.HasIndex(e => e.CreatedAt);
        });
    }

    private static string ConvertToSnakeCase(string? input)
    {
        if (string.IsNullOrEmpty(input)) return "";
        return string.Concat(input.Select((x, i) => i > 0 && char.IsUpper(x) ? "_" + x.ToString() : x.ToString())).ToLower();
    }
}
