using System;
using System.Collections.Generic;
using Microsoft.AspNetCore.Mvc;
using System.Data;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using PMIMS.Application;
using PMIMS.Domain;
using PMIMS.Infrastructure;
using PMIMS.WebAPI.Controllers;
using Xunit;

namespace PMIMS.Tests;

public class PMIMSTests
{
    private class DbSetup : IDisposable
    {
        public AppDbContext Context { get; }
        public SqliteConnection Connection { get; }

        public DbSetup(AppDbContext context, SqliteConnection connection)
        {
            Context = context;
            Connection = connection;
        }

        public void Dispose()
        {
            Context.Dispose();
            Connection.Dispose();
        }
    }

    private DbSetup CreateContext()
    {
        var conn = new SqliteConnection("DataSource=:memory:");
        conn.Open();
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(conn)
            .Options;
        
        var context = new AppDbContext(options);
        context.Database.EnsureDeleted();
        context.Database.EnsureCreated();
        return new DbSetup(context, conn);
    }

    private async Task SeedBasicDataAsync(AppDbContext context)
    {
        // Add minimal metadata required by services
        var vendorSharia = new Vendor
        {
            VendorId = 1,
            VendorCode = "VAL-SWISS",
            VendorName = "Valcambi Suisse",
            CountryOfOrigin = "Switzerland",
            IsShariaCompliant = true,
            ContactEmail = "compliance@valcambi.ch"
        };
        var vendorNonSharia = new Vendor
        {
            VendorId = 2,
            VendorCode = "BAD-SUPP",
            VendorName = "Non-Sharia Supplier",
            CountryOfOrigin = "Unknown",
            IsShariaCompliant = false,
            ContactEmail = "bad@supplier.com"
        };
        context.Vendors.AddRange(vendorSharia, vendorNonSharia);

        var gold = new MetalType { MetalTypeId = 1, MetalName = "Gold" };
        var silver = new MetalType { MetalTypeId = 2, MetalName = "Silver" };
        context.MetalTypes.AddRange(gold, silver);

        var p9999 = new MetalPurityLevel { PurityId = 1, PurityValue = 99.99m, Description = "999.9 Fine Purity" };
        context.MetalPurityLevels.Add(p9999);

        var d1kg = new MetalDenomination { DenominationId = 1, Label = "1 Kilogram Bar", WeightGrams = 1000.0m, WeightOunces = 32.1507m, MetalTypeId = 1 };
        context.MetalDenominations.Add(d1kg);

        var p1 = new MetalProduct { ProductId = 1, ProductCode = "AU-1KG-SWISS", MetalTypeId = 1, DenominationId = 1, PurityId = 1, OriginCountry = "Switzerland" };
        context.MetalProducts.Add(p1);

        var vaultMain = new Vault { VaultId = 1, VaultName = "Main Vault", LocationDescription = "HQ Vault Room Alpha", MaxWeightCapacityKg = 5000.00m };
        context.Vaults.Add(vaultMain);

        var branchMain = new Branch { BranchId = 1, BranchCode = "MAIN_HO", BranchName = "Main HO Vault Operations", VaultId = 1 };
        context.Branches.Add(branchMain);

        var loc1 = new InventoryLocation
        {
            LocationId = 1,
            VaultId = 1,
            BranchId = 1,
            ZoneRoom = "Zone Alpha",
            ShelfRow = "Shelf Row 1",
            SlotBin = "Slot 1"
        };
        var loc2 = new InventoryLocation
        {
            LocationId = 2,
            VaultId = 1,
            BranchId = 1,
            ZoneRoom = "Zone Alpha",
            ShelfRow = "Shelf Row 1",
            SlotBin = "Slot 2"
        };
        var loc3 = new InventoryLocation
        {
            LocationId = 3,
            VaultId = 1,
            BranchId = 1,
            ZoneRoom = "Zone Alpha",
            ShelfRow = "Shelf Row 1",
            SlotBin = "Slot 3"
        };
        var loc4 = new InventoryLocation
        {
            LocationId = 4,
            VaultId = 1,
            BranchId = 1,
            ZoneRoom = "Zone Alpha",
            ShelfRow = "Shelf Row 1",
            SlotBin = "Slot 4"
        };
        var loc5 = new InventoryLocation
        {
            LocationId = 5,
            VaultId = 1,
            BranchId = 1,
            ZoneRoom = "Zone Alpha",
            ShelfRow = "Shelf Row 1",
            SlotBin = "Slot 5"
        };
        context.InventoryLocations.AddRange(loc1, loc2, loc3, loc4, loc5);

        var customer = new Customer { CustomerId = 1, CivilId = "289101201928", CustomerName = "Khalid Al-Mutairi", MobileNumber = "+96590001010", Email = "khalid@mutairi.com" };
        context.Customers.Add(customer);

        var account = new CustomerAccount { AccountId = 1, CustomerId = 1, AccountNumber = "KWD-902910-101", Currency = "KWD" };
        context.CustomerAccounts.Add(account);

        var lot = new InventoryLot
        {
            LotId = 1,
            LotNumber = "LOT-KFH-INIT-01",
            PoId = null,
            VendorId = 1,
            AcquisitionDate = DateTime.UtcNow,
            TotalItems = 1,
            AverageUnitCost = 73000m,
            CreatedAt = DateTime.UtcNow
        };
        context.InventoryLots.Add(lot);

        var channel = new Channel { ChannelId = 1, ChannelName = "Branch" };
        context.Channels.Add(channel);

        var poWorkflow = new WorkflowTemplate
        {
            WorkflowType = "PURCHASE_ORDER",
            Name = "Default PO Approval Workflow",
            Description = "Standard 2-step verification process for purchase orders.",
            IsActive = true
        };
        context.WorkflowTemplates.Add(poWorkflow);
        await context.SaveChangesAsync();

        var step1 = new WorkflowStep
        {
            TemplateId = poWorkflow.TemplateId,
            StepOrder = 1,
            StepName = "Risk & Treasury Review",
            RequiredRole = "Operations Checker",
            Description = "Initial review of cost and provider accreditation."
        };
        context.WorkflowSteps.Add(step1);

        await context.SaveChangesAsync();
    }

    [Fact]
    public async Task TestShariaSupplierVerification()
    {
        // Verify that procurement validation blocks non-Sharia refiners
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var repo = new InventoryRepository(setup.Context);

        // Attempting to create a PO for compliant supplier should succeed
        var (poId, result) = await repo.CreatePurchaseOrderAsync("PO-COMPLIANT-01", 1, 1000m, 73000m, "USD", "maker_user", "[]");
        Assert.Equal("SUCCESS", result);
        Assert.True(poId > 0);

        // Attempting to create a PO for non-compliant supplier should fail
        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.CreatePurchaseOrderAsync("PO-NON-COMPLIANT-01", 2, 1000m, 73000m, "USD", "maker_user", "[]");
        });
    }

    [Fact]
    public async Task TestParallelReservationLocks()
    {
        // Seed exactly one gold bar
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        // Seed 1 ready item
        var item = new InventoryItem
        {
            ItemId = 100,
            SerialNumber = "CH-88371-92",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.Add(item);
        
        // Seed inventory balance
        var balance = new InventoryBalance
        {
            LocationId = 1,
            ProductId = 1,
            OwnershipType = "KFH_OWNED",
            ReadyForSaleQty = 1,
            ReservedQty = 0,
            SoldQty = 0,
            QuarantinedQty = 0,
            InTransitQty = 0,
            LastUpdated = DateTime.UtcNow
        };
        setup.Context.InventoryBalances.Add(balance);
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // First reserve request should succeed
        var token1 = await repo.ReserveStockAsync(1, 1, 1, 1, "IDEM-KEY-001", 300);
        Assert.NotNull(token1);
        Assert.NotEqual(Guid.Empty, token1);

        // Second reserve request should return null because the only item is now RESERVED
        var token2 = await repo.ReserveStockAsync(1, 1, 1, 1, "IDEM-KEY-002", 300);
        Assert.Null(token2);

        // Checking idempotency: same key should return the existing token
        var token1Retry = await repo.ReserveStockAsync(1, 1, 1, 1, "IDEM-KEY-001", 300);
        Assert.Equal(token1, token1Retry);
    }

    [Fact]
    public async Task TestDataMigrationValidator()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        // Seed 1 active item with serial number "DUP-100" and location 1
        var item = new InventoryItem
        {
            ItemId = 101,
            SerialNumber = "DUP-100",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.Add(item);
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);
        var migration = new BulkMigrationService(repo);

        // Create CSV with:
        // Row 1: Valid
        // Row 2: Duplicate serial number "DUP-100"
        // Row 3: Invalid product code "BAD-PROD"
        // Row 4: Duplicate coordinate slot occupation (slot 1 is already occupied by DUP-100)
        // Row 5: Invalid ownership type "SOME_OWNER"
        var csvBuilder = new System.Text.StringBuilder();
        csvBuilder.AppendLine("Serial Number,Product Code,Cost,Vault,Zone,Shelf,Slot,Owner,CivilID");
        csvBuilder.AppendLine("NEW-101,AU-1KG-SWISS,73000,Main Vault,Zone Alpha,Shelf Row 1,Slot 2,KFH_OWNED,"); // Valid (different slot)
        csvBuilder.AppendLine("DUP-100,AU-1KG-SWISS,73000,Main Vault,Zone Alpha,Shelf Row 1,Slot 3,KFH_OWNED,"); // Duplicate Serial
        csvBuilder.AppendLine("NEW-102,BAD-PROD,73000,Main Vault,Zone Alpha,Shelf Row 1,Slot 4,KFH_OWNED,"); // Invalid Product
        csvBuilder.AppendLine("NEW-103,AU-1KG-SWISS,73000,Main Vault,Zone Alpha,Shelf Row 1,Slot 1,KFH_OWNED,"); // Occupied Slot
        csvBuilder.AppendLine("NEW-104,AU-1KG-SWISS,73000,Main Vault,Zone Alpha,Shelf Row 1,Slot 5,SOME_OWNER,"); // Invalid Owner

        string csvBase64 = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(csvBuilder.ToString()));

        var result = await migration.StageMigrationExcelAsync("test_mig.csv", csvBase64, "maker_user");

        // Parse result using JSON serialization to avoid cross-assembly dynamic binding failure
        var json = JsonSerializer.Serialize(result);
        var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Equal(5, root.GetProperty("total_records").GetInt32());
        Assert.Equal(1, root.GetProperty("valid_records").GetInt32());
        Assert.Equal(4, root.GetProperty("failed_records").GetInt32());
        Assert.False(root.GetProperty("is_valid").GetBoolean());

        var errors = new List<string>();
        foreach (var err in root.GetProperty("errors").EnumerateArray())
        {
            errors.Add(err.GetString() ?? "");
        }

        Assert.Contains(errors, (string e) => e.Contains("already exists in active ledger"));
        Assert.Contains(errors, (string e) => e.Contains("is not registered in catalog"));
        Assert.Contains(errors, (string e) => e.Contains("is already occupied by another item"));
        Assert.Contains(errors, (string e) => e.Contains("Ownership type must be"));
    }

    [Fact]
    public async Task TestAverageCostValuation()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var repo = new InventoryRepository(setup.Context);

        // Test intake average cost calculation
        // Create PO: Total weight = 2000g, total cost = 146000 USD (avg cost = 73 USD/gram)
        var (poId, result) = await repo.CreatePurchaseOrderAsync("PO-VAL-01", 1, 2000m, 146000m, "USD", "maker_user", "[]");
        Assert.Equal("SUCCESS", result);

        var po = await setup.Context.PurchaseOrders.FindAsync(poId);
        if (po != null)
        {
            po.StatusCode = "APPROVED";
            await setup.Context.SaveChangesAsync();
        }

        // Intake items: 2 items, total weight = 2000g
        string intakeSerials = "[{\"serial\":\"BAR-VAL-01\",\"product_id\":1},{\"serial\":\"BAR-VAL-02\",\"product_id\":1}]";
        string intakeResult = await repo.IntakeInventoryItemsAsync(poId, "LOT-VAL-01", 1, "checker_user", intakeSerials);
        Assert.Equal("SUCCESS", intakeResult);

        // Assert average cost is stored correctly on the items' lot
        var items = (await repo.GetItemsAsync()).ToList();
        Assert.Contains(items, i => i.SerialNumber == "BAR-VAL-01");
        
        var lot = setup.Context.InventoryLots.FirstOrDefault(l => l.LotNumber == "LOT-VAL-01");
        Assert.NotNull(lot);
        Assert.Equal(73.00m, lot.AverageUnitCost);
    }

    [Fact]
    public async Task TestFifoLifoValuation()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var repo = new InventoryRepository(setup.Context);

        // 1. Create two purchase orders representing different times/prices
        // PO 1 (Oldest): 1000g, 50,000 USD (50 USD/g)
        var (poId1, res1) = await repo.CreatePurchaseOrderAsync("PO-FIFO-01", 1, 1000m, 50000m, "USD", "maker_user", "[]");
        Assert.Equal("SUCCESS", res1);
        var po1 = await setup.Context.PurchaseOrders.FindAsync(poId1);
        po1!.StatusCode = "APPROVED";

        // PO 2 (Newest): 1000g, 60,000 USD (60 USD/g)
        var (poId2, res2) = await repo.CreatePurchaseOrderAsync("PO-FIFO-02", 1, 1000m, 60000m, "USD", "maker_user", "[]");
        Assert.Equal("SUCCESS", res2);
        var po2 = await setup.Context.PurchaseOrders.FindAsync(poId2);
        po2!.StatusCode = "APPROVED";
        await setup.Context.SaveChangesAsync();

        // 2. Intake items for both lots (each lot has 1 item of product 1)
        string serial1 = "[{\"serial\":\"BAR-FIFO-OLD\",\"product_id\":1}]";
        await repo.IntakeInventoryItemsAsync(poId1, "LOT-FIFO-OLD", 1, "checker_user", serial1);

        string serial2 = "[{\"serial\":\"BAR-FIFO-NEW\",\"product_id\":1}]";
        await repo.IntakeInventoryItemsAsync(poId2, "LOT-FIFO-NEW", 1, "checker_user", serial2);

        // Manually adjust the second lot's acquisition date to make it newer
        var lotOld = setup.Context.InventoryLots.First(l => l.LotNumber == "LOT-FIFO-OLD");
        lotOld.AcquisitionDate = DateTime.UtcNow.AddDays(-5);
        var lotNew = setup.Context.InventoryLots.First(l => l.LotNumber == "LOT-FIFO-NEW");
        lotNew.AcquisitionDate = DateTime.UtcNow;
        await setup.Context.SaveChangesAsync();

        // 3. Instantiate the controller directly to query reports
        var rateFeedMock = new RateFeedService(); // Implicit parameterless constructor
        var controller = new PMIMSControllers(
            repo,
            null!,
            null!,
            rateFeedMock,
            null!,
            null!,
            null!,
            null!,
            null!,
            null!,
            null!
        );

        // Test FIFO Valuation Report (FIFO assumes remaining items are from the NEWEST lots: LOT-FIFO-NEW @ $60/g, then LOT-FIFO-OLD @ $50/g)
        var fifoResult = await controller.GetValuationReport("FIFO") as OkObjectResult;
        Assert.NotNull(fifoResult);
        var fifoList = fifoResult!.Value as IEnumerable<object>;
        Assert.NotNull(fifoList);
        // Under FIFO: The item from the newest lot is valued first
        var fifoItems = fifoList!.ToList();
        // Product 1 has weight 1000g, so cost basis = 1000g * 60 = 60000
        var oldItemFifo = fifoItems.FirstOrDefault(i => GetPropValue(i, "serial_number")?.ToString() == "BAR-FIFO-NEW");
        Assert.NotNull(oldItemFifo);
        Assert.Equal(60000m, (decimal)GetPropValue(oldItemFifo!, "cost_basis"));

        // Test LIFO Valuation Report (LIFO assumes remaining items are from the OLDEST lots: LOT-FIFO-OLD @ $50/g, then LOT-FIFO-NEW @ $60/g)
        var lifoResult = await controller.GetValuationReport("LIFO") as OkObjectResult;
        Assert.NotNull(lifoResult);
        var lifoList = lifoResult!.Value as IEnumerable<object>;
        Assert.NotNull(lifoList);
        var lifoItems = lifoList!.ToList();
        // Under LIFO: The item from the oldest lot is valued first
        // Cost basis = 1000g * 50 = 50000
        var oldItemLifo = lifoItems.FirstOrDefault(i => GetPropValue(i, "serial_number")?.ToString() == "BAR-FIFO-OLD");
        Assert.NotNull(oldItemLifo);
        Assert.Equal(50000m, (decimal)GetPropValue(oldItemLifo!, "cost_basis"));
    }

    private static object GetPropValue(object src, string propName)
    {
        return src.GetType().GetProperty(propName)!.GetValue(src, null)!;
    }

    // ============================================================
    // Cost Tracking & Valuation -- purchase cost detail (supplier invoice + acquisition
    // fees) feeding the Average Cost Method, and the Core Banking (IMAL) GL Integration
    // adapter hook fired on a supplier receipt.
    // ============================================================

    [Fact]
    public async Task TestLandedCostFeedsAverageCostValuation()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var repo = new InventoryRepository(setup.Context);

        // Line-item cost 50,000 USD for 1000g (50.00 USD/g), plus 4,000 USD in acquisition
        // fees (freight 2000 + insurance 500 + customs 1000 + other 500) => landed cost
        // 54,000 USD, landed average cost 54.00 USD/g. This is what should end up on the
        // lot -- not the bare 50.00 the vendor invoiced for the metal itself.
        var (poId, result) = await repo.CreatePurchaseOrderAsync("PO-LANDED-01", 1, 1000m, 50000m, "USD", "maker_user", "[]",
            supplierInvoiceNumber: "INV-VAL-001", freightCost: 2000m, insuranceCost: 500m, customsDutyCost: 1000m, otherFeesCost: 500m);
        Assert.Equal("SUCCESS", result);

        var po = await setup.Context.PurchaseOrders.FindAsync(poId);
        Assert.NotNull(po);
        Assert.Equal("INV-VAL-001", po!.SupplierInvoiceNumber);
        Assert.Equal(54000m, po.LandedCost);
        po.StatusCode = "APPROVED";
        await setup.Context.SaveChangesAsync();

        string intakeSerials = "[{\"serial\":\"BAR-LANDED-01\",\"product_id\":1}]";
        string intakeResult = await repo.IntakeInventoryItemsAsync(poId, "LOT-LANDED-01", 1, "checker_user", intakeSerials);
        Assert.Equal("SUCCESS", intakeResult);

        var lot = setup.Context.InventoryLots.FirstOrDefault(l => l.LotNumber == "LOT-LANDED-01");
        Assert.NotNull(lot);
        Assert.Equal(54.00m, lot!.AverageUnitCost);
    }

    // Records every call it receives and persists a CoreBankingLedgerPosting exactly like
    // the real CoreBankingGlAdapter (PMIMS.Infrastructure/ExternalServices.cs) does, so this
    // exercises InventoryRepository's trigger logic without needing network/config.
    private class StubCoreBankingLedgerService : ICoreBankingLedgerService
    {
        private readonly AppDbContext _dbContext;
        public List<(string sourceType, int sourceId, decimal amount, string currency)> Calls { get; } = new();

        public StubCoreBankingLedgerService(AppDbContext dbContext) { _dbContext = dbContext; }

        public async Task<CoreBankingLedgerPosting> PostLedgerEntryAsync(string sourceType, int sourceId, string debitAccount, string creditAccount, decimal amount, string currency, string initiatedBy, string? memo = null)
        {
            Calls.Add((sourceType, sourceId, amount, currency));
            var posting = new CoreBankingLedgerPosting
            {
                SourceType = sourceType,
                SourceId = sourceId,
                DebitAccount = debitAccount,
                CreditAccount = creditAccount,
                Amount = amount,
                Currency = currency,
                Memo = memo,
                InitiatedBy = initiatedBy,
                StatusCode = "POSTED",
                CoreBankingReference = "TEST-REF",
                CreatedAt = DateTime.UtcNow,
                PostedAt = DateTime.UtcNow
            };
            _dbContext.CoreBankingLedgerPostings.Add(posting);
            await _dbContext.SaveChangesAsync();
            return posting;
        }
    }

    [Fact]
    public async Task TestCoreBankingGlPostingOnSupplierReceipt()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var stubGl = new StubCoreBankingLedgerService(setup.Context);
        var repo = new InventoryRepository(setup.Context, rateFeed: null, coreBanking: stubGl);

        var (poId, result) = await repo.CreatePurchaseOrderAsync("PO-GL-01", 1, 1000m, 50000m, "USD", "maker_user", "[]",
            freightCost: 1000m, insuranceCost: 500m, customsDutyCost: 500m);
        Assert.Equal("SUCCESS", result);

        var po = await setup.Context.PurchaseOrders.FindAsync(poId);
        po!.StatusCode = "APPROVED";
        await setup.Context.SaveChangesAsync();

        string serials = "[{\"serial\":\"BAR-GL-01\",\"product_id\":1}]";
        var intakeResult = await repo.IntakeInventoryItemsAsync(poId, "LOT-GL-01", 1, "checker_user", serials);
        Assert.Equal("SUCCESS", intakeResult);

        // 50,000 + 1,000 + 500 + 500 = 52,000 landed cost -- exactly what should have been
        // posted Debit Inventory-Precious Metals / Credit Accounts Payable-Vendor.
        Assert.Single(stubGl.Calls);
        Assert.Equal("PURCHASE_ORDER_RECEIPT", stubGl.Calls[0].sourceType);
        Assert.Equal(poId, stubGl.Calls[0].sourceId);
        Assert.Equal(52000m, stubGl.Calls[0].amount);
        Assert.Equal("USD", stubGl.Calls[0].currency);

        var postings = (await repo.GetCoreBankingPostingsAsync()).ToList();
        Assert.Single(postings);
        Assert.Equal("POSTED", postings[0].StatusCode);
        Assert.Equal(52000m, postings[0].Amount);
    }

    [Fact]
    public async Task TestNoGlPostingWithoutCoreBankingAdapterConfigured()
    {
        // Backward-compat guard: a repository constructed without the optional adapter
        // (every pre-existing call site, including every other test in this file) must
        // behave exactly as it did before this feature existed -- intake succeeds, no GL
        // postings table entry appears.
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var repo = new InventoryRepository(setup.Context);

        var (poId, result) = await repo.CreatePurchaseOrderAsync("PO-NOGL-01", 1, 1000m, 50000m, "USD", "maker_user", "[]", freightCost: 1000m);
        Assert.Equal("SUCCESS", result);
        var po = await setup.Context.PurchaseOrders.FindAsync(poId);
        po!.StatusCode = "APPROVED";
        await setup.Context.SaveChangesAsync();

        string serials = "[{\"serial\":\"BAR-NOGL-01\",\"product_id\":1}]";
        var intakeResult = await repo.IntakeInventoryItemsAsync(poId, "LOT-NOGL-01", 1, "checker_user", serials);
        Assert.Equal("SUCCESS", intakeResult);

        Assert.Empty(await repo.GetCoreBankingPostingsAsync());
    }

    [Fact]
    public async Task TestWorkflowExecutionApprovalProcess()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        // Maker-Checker step gating (InventoryRepository.GetUserRoles / ProcessWorkflowActionAsync)
        // resolves a user's roles purely from real AppUser -> PrivilegeGroup membership --
        // there is no username-pattern fallback (that was a security hole and has been
        // removed). So this test has to provision real group membership for the
        // checker/reconciler personas rather than relying on their usernames merely
        // containing "checker"/"reconciler".
        var groupChecker = new PrivilegeGroup { GroupName = "Operations Checker", Description = "Test checker group", IsSystem = true };
        var groupRecon = new PrivilegeGroup { GroupName = "Reconciliation Officer", Description = "Test reconciliation group", IsSystem = true };
        setup.Context.PrivilegeGroups.AddRange(groupChecker, groupRecon);
        await setup.Context.SaveChangesAsync();

        var userChecker = new AppUser { Username = "treasury-checker", DisplayName = "Test Checker", Email = "checker@test.local", PasswordHash = "test-hash" };
        var userRecon = new AppUser { Username = "reconciliation-reconciler", DisplayName = "Test Reconciler", Email = "reconciler@test.local", PasswordHash = "test-hash" };
        setup.Context.AppUsers.AddRange(userChecker, userRecon);
        await setup.Context.SaveChangesAsync();

        setup.Context.UserGroupMemberships.AddRange(
            new UserGroupMembership { UserId = userChecker.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" },
            new UserGroupMembership { UserId = userRecon.UserId, GroupId = groupRecon.GroupId, AssignedBy = "TEST" }
        );
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // 1. Create a custom template with 2 steps
        string stepsJson = "[{\"step_name\":\"Step 1\",\"required_role\":\"Operations Checker\",\"description\":\"Initial check\"},{\"step_name\":\"Step 2\",\"required_role\":\"Reconciliation Officer\",\"description\":\"Audit reconciliation\"}]";
        var template = await repo.SaveWorkflowTemplateAsync("PURCHASE_ORDER", "Custom PO Flow", "2-step approval test template", stepsJson);
        Assert.NotNull(template);
        Assert.Equal(2, template.Steps.Count);

        // 2. Create PO (should auto-start workflow because template is active)
        var (poId, result) = await repo.CreatePurchaseOrderAsync("PO-WF-TEST-01", 1, 1000m, 73000m, "USD", "treasury-maker", "[]");
        Assert.Equal("SUCCESS", result);

        var po = await setup.Context.PurchaseOrders.FindAsync(poId);
        Assert.NotNull(po);
        Assert.Equal("PENDING_APPROVAL", po.StatusCode);

        // Find active instance
        var activeInstances = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        var instance = activeInstances.FirstOrDefault(i => i.EntityId == poId && i.WorkflowType == "PURCHASE_ORDER");
        Assert.NotNull(instance);
        Assert.Equal("PENDING_MAKER", instance.StatusCode);
        Assert.Equal(1, instance.CurrentStepOrder);

        // 3. Attempt approval with unauthorized user (maker) -> should fail
        var failResult = await repo.ProcessWorkflowActionAsync(instance.InstanceId, "treasury-maker", "APPROVED", "Signoff by maker");
        Assert.Equal("UNAUTHORIZED_ROLE", failResult);

        // 4. Approve Step 1 with Operations Checker -> should succeed
        var step1Result = await repo.ProcessWorkflowActionAsync(instance.InstanceId, "treasury-checker", "APPROVED", "Approved step 1");
        Assert.Equal("SUCCESS", step1Result);

        // Current step should increment
        Assert.Equal(2, instance.CurrentStepOrder);
        var poRefreshed = await setup.Context.PurchaseOrders.FindAsync(poId);
        Assert.Equal("PENDING_APPROVAL", poRefreshed!.StatusCode);

        // 5. Approve Step 2 with Reconciliation Officer -> should succeed and finalize the PO
        var step2Result = await repo.ProcessWorkflowActionAsync(instance.InstanceId, "reconciliation-reconciler", "APPROVED", "Approved step 2");
        Assert.Equal("SUCCESS", step2Result);

        // Workflow instance status should be APPROVED
        Assert.Equal("APPROVED", instance.StatusCode);
        
        // PO status should update to APPROVED
        var poFinal = await setup.Context.PurchaseOrders.FindAsync(poId);
        Assert.Equal("APPROVED", poFinal!.StatusCode);
        Assert.Equal("reconciliation-reconciler", poFinal.ApprovedBy);
    }

    // =========================================================================
    // Receipt of precious metals from a customer (buyback / custody deposit / return) --
    // the mirror of the supplier PO-based intake flow above, exercised directly through
    // IntakeInventoryItemsAsync (same level TestAverageCostValuation exercises the
    // supplier path at) and through InitiateWorkflowIntakeAsync's validation surface.
    // =========================================================================

    [Fact]
    public async Task TestCustomerBuyback_ReceivesAsKfhOwned_UsesWalkInVendor()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        string serials = "[{\"serial\":\"BUYBACK-01\",\"product_id\":1}]";
        string result = await repo.IntakeInventoryItemsAsync(null, "LOT-BUYBACK-01", 1, "checker_user", serials,
            sourceType: "CUSTOMER", customerId: 1, accountId: null, receiptReason: "BUYBACK");
        Assert.Equal("SUCCESS", result);

        var item = setup.Context.InventoryItems.FirstOrDefault(i => i.SerialNumber == "BUYBACK-01");
        Assert.NotNull(item);
        Assert.Equal("KFH_OWNED", item!.OwnershipType);
        Assert.Equal("READY", item.StatusCode);

        // The lot should be tagged to the internal walk-in vendor, not a real supplier, and
        // carry no Purchase Order.
        var lot = await setup.Context.InventoryLots.FindAsync(item.LotId);
        Assert.NotNull(lot);
        Assert.Null(lot!.PoId);
        var vendor = await setup.Context.Vendors.FindAsync(lot.VendorId);
        Assert.Equal("WALK-IN", vendor!.VendorCode);

        // No custody holding should be created for a buyback -- KFH owns the bar outright.
        Assert.False(await setup.Context.CustomerHoldings.AnyAsync(h => h.ItemId == item.ItemId));
    }

    [Fact]
    public async Task TestCustomerCustodyDeposit_StaysCustomerOwned_CreatesHoldingAndAllocation()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        string serials = "[{\"serial\":\"DEPOSIT-01\",\"product_id\":1}]";
        string result = await repo.IntakeInventoryItemsAsync(null, "LOT-DEPOSIT-01", 1, "checker_user", serials,
            sourceType: "CUSTOMER", customerId: 1, accountId: 1, receiptReason: "CUSTODY_DEPOSIT");
        Assert.Equal("SUCCESS", result);

        var item = setup.Context.InventoryItems.FirstOrDefault(i => i.SerialNumber == "DEPOSIT-01");
        Assert.NotNull(item);
        Assert.Equal("CUSTOMER_OWNED", item!.OwnershipType);
        Assert.Equal("HELD_IN_CUSTODY", item.StatusCode);

        var holding = await setup.Context.CustomerHoldings.FirstOrDefaultAsync(h => h.ItemId == item.ItemId);
        Assert.NotNull(holding);
        Assert.Equal(1, holding!.CustomerId);
        Assert.Equal(1, holding.AccountId);
        Assert.Equal("HELD_IN_CUSTODY", holding.StatusCode);

        var allocation = await setup.Context.CustomerAllocations.FirstOrDefaultAsync(a => a.HoldingId == holding.HoldingId);
        Assert.NotNull(allocation);
        Assert.Equal(1, allocation!.AssignedLocationId);
    }

    [Fact]
    public async Task TestCustomerCustodyDeposit_MissingAccountId_Throws()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        string serials = "[{\"serial\":\"DEPOSIT-NOACCT\",\"product_id\":1}]";
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            repo.IntakeInventoryItemsAsync(null, "LOT-DEPOSIT-02", 1, "checker_user", serials,
                sourceType: "CUSTOMER", customerId: 1, accountId: null, receiptReason: "CUSTODY_DEPOSIT"));
    }

    [Fact]
    public async Task TestCustomerReceipt_UnknownCustomer_Throws()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        string serials = "[{\"serial\":\"BUYBACK-BADCUST\",\"product_id\":1}]";
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            repo.IntakeInventoryItemsAsync(null, "LOT-BADCUST-01", 1, "checker_user", serials,
                sourceType: "CUSTOMER", customerId: 9999, accountId: null, receiptReason: "BUYBACK"));
    }

    [Fact]
    public async Task TestInitiateWorkflowIntake_CustomerReceiptWithoutCustomer_Throws()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            repo.InitiateWorkflowIntakeAsync(null, "LOT-X", 1, "maker_user", "[]", sourceType: "CUSTOMER"));
    }

    [Fact]
    public async Task TestInitiateWorkflowIntake_SupplierReceiptWithoutPo_Throws()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            repo.InitiateWorkflowIntakeAsync(null, "LOT-X", 1, "maker_user", "[]"));
    }

    [Fact]
    public async Task TestInitiateWorkflowIntake_CustomerReceipt_CreatesPendingIntakeAndWorkflowInstance()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        // InitiateWorkflowIntakeAsync spawns an INTAKE_SHIPMENT workflow instance, which
        // requires an active template + at least one step -- SeedBasicDataAsync only seeds a
        // PURCHASE_ORDER template, so provision the intake one here (same pattern the PO
        // workflow test uses to add extra role groups on top of the shared basic seed).
        var intakeWorkflow = new WorkflowTemplate
        {
            WorkflowType = "INTAKE_SHIPMENT",
            Name = "Default Intake Verification Workflow",
            Description = "Single-step verification for received precious metals.",
            IsActive = true
        };
        setup.Context.WorkflowTemplates.Add(intakeWorkflow);
        await setup.Context.SaveChangesAsync();
        setup.Context.WorkflowSteps.Add(new WorkflowStep
        {
            TemplateId = intakeWorkflow.TemplateId,
            StepOrder = 1,
            StepName = "Vault Verification",
            RequiredRole = "Operations Checker",
            Description = "Verify scanned serials against the declared receipt."
        });
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);
        string serials = "[{\"serial\":\"DEPOSIT-WF-01\",\"product_id\":1}]";
        var pending = await repo.InitiateWorkflowIntakeAsync(null, "LOT-WF-01", 1, "maker_user", serials,
            sourceType: "CUSTOMER", customerId: 1, accountId: 1, receiptReason: "CUSTODY_DEPOSIT");

        Assert.True(pending.PendingIntakeId > 0);
        Assert.Equal("CUSTOMER", pending.SourceType);
        Assert.Null(pending.PoId);
        Assert.Equal(1, pending.CustomerId);
        Assert.Equal("PENDING_APPROVAL", pending.StatusCode);

        var instances = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        Assert.Contains(instances, i => i.WorkflowType == "INTAKE_SHIPMENT" && i.EntityId == pending.PendingIntakeId);

        // Approving it should run IntakeInventoryItemsAsync with the customer/account/reason
        // carried over from the PendingIntake row, ending up CUSTOMER_OWNED + held in custody.
        var groupChecker = new PrivilegeGroup { GroupName = "Operations Checker", Description = "Test checker group", IsSystem = true };
        setup.Context.PrivilegeGroups.Add(groupChecker);
        await setup.Context.SaveChangesAsync();
        var checkerUser = new AppUser { Username = "treasury-checker2", DisplayName = "Checker Two", Email = "checker2@test.local", PasswordHash = "test-hash" };
        setup.Context.AppUsers.Add(checkerUser);
        await setup.Context.SaveChangesAsync();
        setup.Context.UserGroupMemberships.Add(new UserGroupMembership { UserId = checkerUser.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" });
        await setup.Context.SaveChangesAsync();

        var instance = instances.First(i => i.WorkflowType == "INTAKE_SHIPMENT" && i.EntityId == pending.PendingIntakeId);
        var approveResult = await repo.ProcessWorkflowActionAsync(instance.InstanceId, "treasury-checker2", "APPROVED", "Verified customer deposit");
        Assert.Equal("SUCCESS", approveResult);

        var item = setup.Context.InventoryItems.FirstOrDefault(i => i.SerialNumber == "DEPOSIT-WF-01");
        Assert.NotNull(item);
        Assert.Equal("CUSTOMER_OWNED", item!.OwnershipType);
        Assert.True(await setup.Context.CustomerHoldings.AnyAsync(h => h.ItemId == item.ItemId));
    }

    [Fact]
    public async Task TestBranchTransferWorkflowProcess()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        // 1. Setup a second branch and a destination location
        var branchFahaheel = new Branch { BranchCode = "FAHAHEEL", BranchName = "Fahaheel Branch", VaultId = 1 };
        setup.Context.Branches.Add(branchFahaheel);
        await setup.Context.SaveChangesAsync();

        var destLoc = new InventoryLocation
        {
            VaultId = 1,
            BranchId = branchFahaheel.BranchId,
            ZoneRoom = "Fahaheel Zone",
            ShelfRow = "Row 1",
            SlotBin = "Slot 1"
        };
        setup.Context.InventoryLocations.Add(destLoc);
        await setup.Context.SaveChangesAsync();

        // 2. Setup workflow template for BRANCH_TRANSFER
        var transferWorkflow = new WorkflowTemplate
        {
            WorkflowType = "BRANCH_TRANSFER",
            Name = "Default Transfer Workflow",
            Description = "Standard approval for branch transfers.",
            IsActive = true
        };
        setup.Context.WorkflowTemplates.Add(transferWorkflow);
        await setup.Context.SaveChangesAsync();

        var step1 = new WorkflowStep
        {
            TemplateId = transferWorkflow.TemplateId,
            StepOrder = 1,
            StepName = "Risk & Treasury Review",
            RequiredRole = "Operations Checker",
            Description = "Initial review of transfer."
        };
        setup.Context.WorkflowSteps.Add(step1);
        await setup.Context.SaveChangesAsync();

        // 3. Create a ready metal item to transfer
        var item = new InventoryItem
        {
            ItemId = 10,
            LotId = 1,
            ProductId = 1,
            LocationId = 1, // Branch 1
            SerialNumber = "SN-TRANSFER-TEST",
            StatusCode = "READY",
            OwnershipType = "KFH_OWNED"
        };
        setup.Context.InventoryItems.Add(item);
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // 4. Initiate the branch transfer workflow (Maker action)
        var transfer = await repo.InitiateWorkflowBranchTransferAsync(item.ItemId, branchFahaheel.BranchId, "Secured Escort", "treasury-maker");
        Assert.NotNull(transfer);
        Assert.Equal("PENDING_APPROVAL", transfer.StatusCode);
        Assert.Equal("RESERVED", item.StatusCode); // Locked during approval

        // 5. Setup checker credentials
        var groupChecker = new PrivilegeGroup { GroupName = "Operations Checker", Description = "Test checker group", IsSystem = true };
        setup.Context.PrivilegeGroups.Add(groupChecker);
        await setup.Context.SaveChangesAsync();

        var userChecker = new AppUser { Username = "treasury-checker-transfer", DisplayName = "Transfer Checker", Email = "checker-transfer@test.local", PasswordHash = "test-hash" };
        setup.Context.AppUsers.Add(userChecker);
        await setup.Context.SaveChangesAsync();

        setup.Context.UserGroupMemberships.Add(
            new UserGroupMembership { UserId = userChecker.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" }
        );
        await setup.Context.SaveChangesAsync();

        // 6. Verify and approve the workflow (Checker action)
        var activeInstances = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        var instance = activeInstances.FirstOrDefault(i => i.EntityId == transfer.TransferId && i.WorkflowType == "BRANCH_TRANSFER");
        Assert.NotNull(instance);
        Assert.Equal("PENDING_MAKER", instance.StatusCode);

        var approveResult = await repo.ProcessWorkflowActionAsync(instance.InstanceId, "treasury-checker-transfer", "APPROVED", "Approved transfer");
        Assert.Equal("SUCCESS", approveResult);

        // 7. Verify item is in transit
        Assert.Equal("APPROVED", transfer.StatusCode);
        Assert.Equal("IN_TRANSFER", item.StatusCode);
        Assert.Equal(destLoc.LocationId, item.LocationId); // Now points to the destination location in Fahaheel

        // 8. Receive the transfer (Destination Branch action)
        var receiveResult = await repo.ReceiveBranchTransferAsync(transfer.TransferId, "fahaheel-manager");
        Assert.Equal("SUCCESS", receiveResult);

        // 9. Verify completion
        Assert.Equal("RECEIVED", transfer.StatusCode);
        Assert.Equal("READY", item.StatusCode);
        Assert.Equal(destLoc.LocationId, item.LocationId);
    }

    [Fact]
    public async Task TestCustomerSalesAndRedemptionProcess()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        // 1. Seed 1 ready item
        var item = new InventoryItem
        {
            ItemId = 100,
            SerialNumber = "SN-CUSTOMER-TX-TEST",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.Add(item);

        // Seed inventory balance
        var balance = new InventoryBalance
        {
            LocationId = 1,
            ProductId = 1,
            OwnershipType = "KFH_OWNED",
            ReadyForSaleQty = 1,
            ReservedQty = 0,
            SoldQty = 0,
            QuarantinedQty = 0,
            InTransitQty = 0,
            LastUpdated = DateTime.UtcNow
        };
        setup.Context.InventoryBalances.Add(balance);
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // 2. Reserve the item (Simulate sales checkout)
        var token = await repo.ReserveStockAsync(customerId: 1, productId: 1, branchId: 1, channelId: 1, idempotencyKey: "IDEM-CUSTOMER-TX", 300);
        Assert.NotNull(token);
        Assert.NotEqual(Guid.Empty, token.Value);

        // 3. Confirm Purchase (Sales transaction)
        var purchaseResult = await repo.ConfirmPurchaseWithCustodyAsync(
            reservationToken: token.Value,
            accountId: 1,
            salePrice: 75000m,
            markupAmount: 200m,
            invoiceNumber: "INV-CUST-001",
            custodyAgreementNumber: "AGR-CUST-001"
        );
        Assert.Equal("SUCCESS", purchaseResult);

        // Verify Sales order and Custody Holding exist
        var saleOrder = await setup.Context.SalesOrders.FirstOrDefaultAsync(s => s.InvoiceNumber == "INV-CUST-001");
        Assert.NotNull(saleOrder);
        Assert.Equal(item.ItemId, saleOrder!.ItemId);

        var holding = await setup.Context.CustomerHoldings.FirstOrDefaultAsync(h => h.ItemId == item.ItemId);
        Assert.NotNull(holding);
        Assert.Equal("HELD_IN_CUSTODY", holding!.StatusCode);
        Assert.Equal("CUSTOMER_OWNED", item.OwnershipType);

        // 4. Physical Redemption (Withdrawal)
        var withdrawalResult = await repo.ExecuteBranchWithdrawalAsync(
            holdingId: holding.HoldingId,
            branchId: 1,
            otp: "123456",
            signature: "Signature Customer",
            withdrawnBy: "TELLER_USER"
        );
        Assert.Equal("SUCCESS", withdrawalResult);

        // Verify withdrawal completed
        Assert.Equal("WITHDRAWN", holding.StatusCode);
        Assert.Equal("INACTIVE", item.StatusCode);
        Assert.Null(item.LocationId);

        var tx = await setup.Context.InventoryTransactions.FirstOrDefaultAsync(t => t.ItemId == item.ItemId && t.TransactionType == "REDEMPTION");
        Assert.NotNull(tx);
        Assert.Equal("CUSTOMER_OWNED", tx!.SourceOwnership);
        Assert.Null(tx.DestinationLocationId);
    }

    [Fact]
    public async Task TestGfsQrScanAndLookup()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var item = new InventoryItem
        {
            ItemId = 200,
            SerialNumber = "SN-GFS-SCAN-TEST",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.Add(item);
        await setup.Context.SaveChangesAsync();

        var gfsService = new GfsService(setup.Context);
        var repo = new InventoryRepository(setup.Context, gfsService: gfsService);

        var scannedItem = await repo.ScanBarWithGfsLookupAsync("SN-GFS-SCAN-TEST");
        Assert.NotNull(scannedItem);
        Assert.Equal("GFS-CUST-88771122", scannedItem!.CustomerAccountNumber);
        Assert.Equal(62.50m, scannedItem.AveragePurchaseCost);
        Assert.Equal("CUSTOMER_OWNED", scannedItem.OwnershipType);
    }

    [Fact]
    public async Task TestDamagedBarBlocking()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var item = new InventoryItem
        {
            ItemId = 201,
            SerialNumber = "SN-DAMAGED-TEST",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY",
            IsDamaged = true
        };
        setup.Context.InventoryItems.Add(item);
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateBranchTransferAsync(201, 2, "Courier", "test-user");
        });

        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateWorkflowBranchTransferAsync(201, 2, "Courier", "test-user");
        });
    }

    [Fact]
    public async Task TestKuwaitCivilIdValidation()
    {
        using var setup = CreateContext();
        var repo = new InventoryRepository(setup.Context);

        // Valid Kuwait PACI Civil IDs (tested with real PACI Modulus-11 checksums)
        // Format: CYYMMDDGSSSC
        // 289101201928: C=2 (1989), YY=89, MM=10, DD=12, GSSSC...
        // Let's compute a valid one:
        // C=2, YY=90, MM=01, DD=15 (1990-01-15) -> "2900115" + "0123" + check digit
        // Weights: [2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
        // 2*2 + 9*1 + 0*6 + 0*3 + 1*7 + 1*9 + 5*10 + 0*5 + 1*8 + 2*4 + 3*2 = 4 + 9 + 0 + 0 + 7 + 9 + 50 + 0 + 8 + 8 + 6 = 101
        // 101 % 11 = 2 -> 11 - 2 = 9. Check digit = 9.
        // Valid Civil ID: "290011501239"
        Assert.True(repo.ValidateKuwaitCivilId("290011501239"));

        // Invalid cases
        Assert.False(repo.ValidateKuwaitCivilId(""));
        Assert.False(repo.ValidateKuwaitCivilId("12345")); // too short
        Assert.False(repo.ValidateKuwaitCivilId("290011501238")); // wrong check digit
        Assert.False(repo.ValidateKuwaitCivilId("190011501239")); // invalid century (must be 2 or 3)
        Assert.False(repo.ValidateKuwaitCivilId("290131501239")); // invalid month 13
        Assert.False(repo.ValidateKuwaitCivilId("290013201239")); // invalid day 32
    }

    [Fact]
    public async Task TestHomeDeliveryLifecycle()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var item = new InventoryItem
        {
            ItemId = 205,
            SerialNumber = "SN-HD-TEST-001",
            ProductId = 1,
            LotId = 1,
            LocationId = 1, // Main Vault
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.Add(item);
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // 1. Create Home Delivery Request (UC07)
        var hd = await repo.CreateHomeDeliveryRequestAsync(
            "HD-KFH-2026-9001", 205, "KWD-902910-101", "290011501239",
            "Fatima Al-Kandari", "+96590001234", "Hawalli", "Jabriya", "4", "Street 10", "House 12", "Flat 3", "Call before arrival", "maker-user");

        Assert.NotNull(hd);
        Assert.Equal("PENDING_DISPATCH", hd.Status);
        Assert.False(string.IsNullOrWhiteSpace(hd.VerificationOtp));

        // 2. Dispatch Home Delivery to Courier
        var dispatchResult = await repo.DispatchHomeDeliveryAsync(
            hd.RequestId, "KFH Express Logistics", "Saad Al-Azmi", "290011501239", "KWT-55-1234", "SEAL-HD-9988", "maker-user");

        Assert.Equal("SUCCESS", dispatchResult);

        var itemAfterDispatch = await setup.Context.InventoryItems.FindAsync(205);
        Assert.Equal("IN_TRANSFER", itemAfterDispatch!.StatusCode);

        // 3. Confirm Handover with Customer OTP & Civil ID
        var confirmResult = await repo.ConfirmHomeDeliveryHandoverAsync(
            hd.RequestId, hd.VerificationOtp, "290011501239", "data:image/png;base64,signature_data", "courier-app");

        Assert.Equal("SUCCESS", confirmResult);

        var itemAfterDelivered = await setup.Context.InventoryItems.FindAsync(205);
        Assert.Equal("SOLD", itemAfterDelivered!.StatusCode);
        Assert.Equal("CUSTOMER_OWNED", itemAfterDelivered.OwnershipType);
        Assert.Null(itemAfterDelivered.LocationId); // Physically in customer possession
    }

    [Fact]
    public async Task TestDamagedBarMakerCheckerWorkflow()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var item = new InventoryItem
        {
            ItemId = 206,
            SerialNumber = "SN-DAMAGE-MC-001",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY",
            IsDamaged = false
        };
        setup.Context.InventoryItems.Add(item);
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // 1. Maker reports damage (UC12)
        await repo.MarkBarDamagedAsync(206, "SCRATCHED_SURFACE", "Deep scratch across hallmark", "DOC-EVID-101", "treasury-maker");

        var itemReported = await setup.Context.InventoryItems.FindAsync(206);
        Assert.Equal("PENDING_APPROVAL", itemReported!.DamageApprovalStatus);
        Assert.Equal("treasury-maker", itemReported.DamageReportedBy);
        Assert.False(itemReported.IsDamaged); // Not yet officially damaged

        // 2. Maker cannot approve their own report (4-eyes invariant)
        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.ProcessDamagedBarActionAsync(206, "APPROVE", "treasury-maker");
        });

        // 3. Checker approves
        var approveResult = await repo.ProcessDamagedBarActionAsync(206, "APPROVE", "treasury-checker");
        Assert.Equal("SUCCESS", approveResult);

        var itemApproved = await setup.Context.InventoryItems.FindAsync(206);
        Assert.True(itemApproved!.IsDamaged);
        Assert.Equal("APPROVED", itemApproved.DamageApprovalStatus);
        Assert.Equal("DAMAGED", itemApproved.StatusCode);
        Assert.Equal("treasury-checker", itemApproved.DamageApprovedBy);
    }

    [Fact]
    public async Task TestGfsDeliveryRequestValidationAndCourierReturn()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var item = new InventoryItem
        {
            ItemId = 202,
            SerialNumber = "SN-GFS-DELIVERY-TEST",
            ProductId = 1,
            LotId = 1,
            LocationId = 1, // Main Vault
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY",
            IsDamaged = false
        };
        setup.Context.InventoryItems.Add(item);

        var request = new GfsDeliveryRequest
        {
            RequestId = 10,
            GfsRefNumber = "GFS-REF-12345",
            BarId = 202,
            CustomerAccountNumber = null,
            DestinationBranchId = 1,
            Status = "PENDING_DISPATCH"
        };
        setup.Context.GfsDeliveryRequests.Add(request);
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // 1. Dispatch
        var dispatchResult = await repo.DispatchGfsBranchDeliveryAsync(
            10, "KFH Trans", "Ahmad", "290011501239", "KWT-11", "SEAL-01", "maker");
        Assert.Equal("SUCCESS", dispatchResult);

        // 2. Receive with serial mismatch -> Return to Courier
        var receiveFailResult = await repo.ReceiveGfsBranchDeliveryAsync(
            10, "WRONG-SERIAL-SCANNED", 1, "branch-checker");
        Assert.Contains("RETURN_TO_COURIER", receiveFailResult);

        var reqInDb = await setup.Context.GfsDeliveryRequests.FindAsync(10);
        Assert.Equal("RETURN_TO_COURIER", reqInDb!.Status);
    }

    [Fact]
    public async Task TestEnterpriseStockCutoffThresholds()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var threshold = new StockCutoffThreshold
        {
            ThresholdId = 5,
            AlertType = "LOW_STOCK",
            ProductId = 1,
            DenominationId = 1,
            CutoffValueKg = 100m,
            StatusCode = "APPROVED",
            CreatedBy = "maker"
        };
        setup.Context.StockCutoffThresholds.Add(threshold);
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);
        var alerts = await repo.EvaluateEnterpriseStockAlertsAsync();
        
        Assert.NotEmpty(alerts);
    }

    [Fact]
    public async Task TestBrandMasterDataAndProductLookup()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var repo = new InventoryRepository(setup.Context);

        // 1. Create Brand
        var brand = await repo.CreateBrandAsync("VALCAMBI", "Valcambi Suisse", "Switzerland", "VALC-CH", true, "Swiss LBMA refiner");
        Assert.NotNull(brand);
        Assert.True(brand.BrandId > 0);

        // 2. Retrieve Brands
        var allBrands = (await repo.GetBrandsAsync()).ToList();
        Assert.Contains(allBrands, b => b.BrandCode == "VALCAMBI");

        // 3. Create Product with Brand reference
        var product = await repo.CreateDenominationProductAsync("100 Gram Gold Bar", "Gold", 100.0m, "Switzerland", brand.BrandId);
        Assert.NotNull(product);
        Assert.Equal(brand.BrandId, product.BrandId);
        Assert.Contains("VALCAMBI", product.ProductCode);

        // 4. Update Brand
        var updated = await repo.UpdateBrandAsync(brand.BrandId, "VALCAMBI-CH", "Valcambi SA Suisse", "Switzerland", "VALC-CH-01", true, "Updated description");
        Assert.NotNull(updated);
        Assert.Equal("VALCAMBI-CH", updated.BrandCode);

        // 5. Delete Brand (soft-deletes when referenced)
        var deleted = await repo.DeleteBrandAsync(brand.BrandId);
        Assert.True(deleted);
        var brandAfterDelete = await repo.GetBrandByIdAsync(brand.BrandId);
        Assert.NotNull(brandAfterDelete);
        Assert.False(brandAfterDelete.IsActive);
    }

    [Fact]
    public async Task TestTurkeyConsignmentIntake_And_KfhPurchaseWorkflow()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        // 1. Setup INTAKE_SHIPMENT and TURKEY_PURCHASE workflow templates
        var intakeWorkflow = new WorkflowTemplate
        {
            WorkflowType = "INTAKE_SHIPMENT",
            Name = "Intake Workflow",
            Description = "Intake verification",
            IsActive = true
        };
        var turkeyPurchaseWorkflow = new WorkflowTemplate
        {
            WorkflowType = "TURKEY_PURCHASE",
            Name = "Turkey Purchase Workflow",
            Description = "Consignment purchase verification",
            IsActive = true
        };
        setup.Context.WorkflowTemplates.AddRange(intakeWorkflow, turkeyPurchaseWorkflow);
        await setup.Context.SaveChangesAsync();

        setup.Context.WorkflowSteps.AddRange(
            new WorkflowStep { TemplateId = intakeWorkflow.TemplateId, StepOrder = 1, StepName = "Intake Verification", RequiredRole = "Operations Checker", Description = "Verify serials" },
            new WorkflowStep { TemplateId = turkeyPurchaseWorkflow.TemplateId, StepOrder = 1, StepName = "Purchase Approval", RequiredRole = "Operations Checker", Description = "Approve Turkey purchase" }
        );
        await setup.Context.SaveChangesAsync();

        var groupChecker = new PrivilegeGroup { GroupName = "Operations Checker", Description = "Test checker group", IsSystem = true };
        setup.Context.PrivilegeGroups.Add(groupChecker);
        await setup.Context.SaveChangesAsync();
        var checkerUser = new AppUser { Username = "checker-turkey", DisplayName = "Checker Turkey", Email = "checker@turkey.test", PasswordHash = "test-hash" };
        setup.Context.AppUsers.Add(checkerUser);
        await setup.Context.SaveChangesAsync();
        setup.Context.UserGroupMemberships.Add(new UserGroupMembership { UserId = checkerUser.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" });
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // 2. Intake shipment with OwnershipType = "TURKEY_OWNED"
        string serialsJson = "[{\"serial\":\"TR-GOLD-001\",\"product_id\":1},{\"serial\":\"TR-GOLD-002\",\"product_id\":1}]";
        var pendingIntake = await repo.InitiateWorkflowIntakeAsync(
            null, "LOT-TR-001", 1, "maker_user", serialsJson,
            sourceType: "SUPPLIER", vendorId: 1, ownershipType: "TURKEY_OWNED");

        Assert.Equal("TURKEY_OWNED", pendingIntake.OwnershipType);

        // Approve intake
        var instances = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        var intakeInstance = instances.First(i => i.WorkflowType == "INTAKE_SHIPMENT" && i.EntityId == pendingIntake.PendingIntakeId);
        var intakeResult = await repo.ProcessWorkflowActionAsync(intakeInstance.InstanceId, "checker-turkey", "APPROVED", "Approved Turkey shipment");
        Assert.Equal("SUCCESS", intakeResult);

        // Verify items created with TURKEY_OWNED
        var turkeyStock = (await repo.GetTurkeyInventoryAsync()).ToList();
        Assert.Equal(2, turkeyStock.Count);
        Assert.All(turkeyStock, item => Assert.Equal("TURKEY_OWNED", item.OwnershipType));

        // 3. Initiate KFH Purchase from Turkey
        var purchasePending = await repo.InitiateTurkeyPurchaseWorkflowAsync(
            new List<string> { "TR-GOLD-001", "TR-GOLD-002" },
            unitPricePerGram: 25.5m,
            requestedBy: "maker_user",
            notes: "Purchasing 2 bars for retail demand");

        Assert.NotNull(purchasePending);
        Assert.Equal(2, purchasePending.TotalItems);
        Assert.Equal("PENDING_APPROVAL", purchasePending.StatusCode);

        // Verify purchase workflow instance created
        var activeWorkflows = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        var purchaseInstance = activeWorkflows.First(w => w.WorkflowType == "TURKEY_PURCHASE" && w.EntityId == purchasePending.PendingPurchaseId);
        Assert.NotNull(purchaseInstance);

        // 4. Checker Approves Purchase
        var purchaseApproveResult = await repo.ProcessWorkflowActionAsync(purchaseInstance.InstanceId, "checker-turkey", "APPROVED", "Price verified against market rate");
        Assert.Equal("SUCCESS", purchaseApproveResult);

        // 5. Verify ownership transitioned to KFH_OWNED and READY
        var item1 = await setup.Context.InventoryItems.FirstOrDefaultAsync(i => i.SerialNumber == "TR-GOLD-001");
        var item2 = await setup.Context.InventoryItems.FirstOrDefaultAsync(i => i.SerialNumber == "TR-GOLD-002");
        Assert.NotNull(item1);
        Assert.NotNull(item2);
        Assert.Equal("KFH_OWNED", item1!.OwnershipType);
        Assert.Equal("KFH_OWNED", item2!.OwnershipType);
        Assert.Equal("READY", item1.StatusCode);

        // Verify Turkey inventory is now 0
        var remainingTurkeyStock = (await repo.GetTurkeyInventoryAsync()).ToList();
        Assert.Empty(remainingTurkeyStock);

        // Verify purchase ledger transaction was logged
        var txs = await setup.Context.InventoryTransactions.Where(t => t.TransactionType == "PURCHASE" && t.DestinationOwnership == "KFH_OWNED").ToListAsync();
        Assert.True(txs.Count >= 2);
    }
}

