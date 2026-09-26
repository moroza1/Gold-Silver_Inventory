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
        var branchSalmiya = new Branch { BranchId = 2, BranchCode = "SALMIYA", BranchName = "Salmiya Branch Vault Operations", VaultId = 1 };
        context.Branches.AddRange(branchMain, branchSalmiya);

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

        // Seed DAMAGED_EXPORT workflow template (3 levels: Maker, Checker, Senior Manager)
        var damagedExportWf = new WorkflowTemplate
        {
            WorkflowType = "DAMAGED_EXPORT",
            Name = "Default Damaged Gold Export Workflow",
            Description = "Three-level Maker-Checker-SeniorManager approval process for exporting damaged precious metals to manufacturer/refiner.",
            IsActive = true
        };
        context.WorkflowTemplates.Add(damagedExportWf);
        await context.SaveChangesAsync();

        context.WorkflowSteps.AddRange(
            new WorkflowStep { TemplateId = damagedExportWf.TemplateId, StepOrder = 1, StepName = "Maker Verification", RequiredRole = "Treasury Operations (Maker)", Description = "Maker verifies damaged bar" },
            new WorkflowStep { TemplateId = damagedExportWf.TemplateId, StepOrder = 2, StepName = "Checker Review", RequiredRole = "Treasury Operations (Checker)", Description = "Checker reviews damage and Turkey ownership" },
            new WorkflowStep { TemplateId = damagedExportWf.TemplateId, StepOrder = 3, StepName = "Senior Manager Authorization", RequiredRole = "Senior Treasury Manager", Description = "Senior Manager authorizes export" }
        );
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
    // fees) feeding the Average Cost Method, and the Core Banking (Phoenix) GL Integration
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
        await EnsureExportUsersAndGroupsAsync(setup.Context);
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

        setup.Context.InventoryItems.Add(new InventoryItem
        {
            ItemId = 101,
            SerialNumber = "DEPOSIT-WF-01",
            ProductId = 1,
            LotId = 1,
            LocationId = null,
            OwnershipType = "CUSTOMER_OWNED",
            StatusCode = "WITHDRAWN"
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
            OwnershipType = "CUSTOMER_OWNED"
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
            OwnershipType = "CUSTOMER_OWNED",
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
        await DbSeeder.EnsureWorkflowTemplatesAsync(setup.Context);

        var groupMaker = new PrivilegeGroup { GroupName = "Treasury Operations (Maker)", Description = "Maker group", IsSystem = true };
        var groupChecker = new PrivilegeGroup { GroupName = "Treasury Operations (Checker)", Description = "Checker group", IsSystem = true };
        setup.Context.PrivilegeGroups.AddRange(groupMaker, groupChecker);
        await setup.Context.SaveChangesAsync();

        var userMaker = new AppUser { Username = "treasury-maker", DisplayName = "Maker", Email = "maker@test.local", PasswordHash = "test-hash" };
        var userChecker = new AppUser { Username = "treasury-checker", DisplayName = "Checker", Email = "checker@test.local", PasswordHash = "test-hash" };
        setup.Context.AppUsers.AddRange(userMaker, userChecker);
        await setup.Context.SaveChangesAsync();

        setup.Context.UserGroupMemberships.AddRange(
            new UserGroupMembership { UserId = userMaker.UserId, GroupId = groupMaker.GroupId, AssignedBy = "TEST" },
            new UserGroupMembership { UserId = userChecker.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" }
        );
        await setup.Context.SaveChangesAsync();

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

        // 1. Create Home Delivery Request (UC07) - Initiates Maker-Checker HOME_DELIVERY workflow
        var hd = await repo.CreateHomeDeliveryRequestAsync(
            "HD-KFH-2026-9001", 205, "KWD-902910-101", "290011501239",
            "Fatima Al-Kandari", "+96590001234", "Hawalli", "Jabriya", "4", "Street 10", "House 12", "Flat 3", "Call before arrival", "maker-user");

        Assert.NotNull(hd);
        Assert.Equal("PENDING_APPROVAL", hd.Status);
        Assert.False(string.IsNullOrWhiteSpace(hd.VerificationOtp));

        var barReserved = await setup.Context.InventoryItems.FindAsync(205);
        Assert.Equal("RESERVED", barReserved!.StatusCode);

        // 1.1 Checker Approves Home Delivery Workflow
        var wfs = await repo.GetActiveWorkflowInstancesAsync();
        var wfInstance = wfs.FirstOrDefault(w => w.WorkflowType == "HOME_DELIVERY" && w.EntityId == hd.RequestId);
        if (wfInstance != null)
        {
            var step1 = await repo.ProcessWorkflowActionAsync(wfInstance.InstanceId, "treasury-maker", "APPROVED", "Maker verification");
            Assert.Equal("SUCCESS", step1);
            var step2 = await repo.ProcessWorkflowActionAsync(wfInstance.InstanceId, "treasury-checker", "APPROVED", "Checker authorization");
            Assert.Equal("SUCCESS", step2);
        }

        var hdApproved = await repo.GetHomeDeliveryRequestByIdAsync(hd.RequestId);
        Assert.Equal("PENDING_DISPATCH", hdApproved!.Status);

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
    public async Task DamageBar_MakerChecker_Workflow_Lifecycle_IsDamagedEffectiveOnlyOnCheckerApproval()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        await DbSeeder.EnsureWorkflowTemplatesAsync(setup.Context);

        var groupMaker = new PrivilegeGroup { GroupName = "Treasury Operations (Maker)", Description = "Maker group", IsSystem = true };
        var groupChecker = new PrivilegeGroup { GroupName = "Treasury Operations (Checker)", Description = "Checker group", IsSystem = true };
        setup.Context.PrivilegeGroups.AddRange(groupMaker, groupChecker);
        await setup.Context.SaveChangesAsync();

        var userMaker = new AppUser { Username = "treasury-maker", DisplayName = "Test Maker", Email = "maker@test.local", PasswordHash = "test-hash" };
        var userChecker = new AppUser { Username = "treasury-checker", DisplayName = "Test Checker", Email = "checker@test.local", PasswordHash = "test-hash" };
        setup.Context.AppUsers.AddRange(userMaker, userChecker);
        await setup.Context.SaveChangesAsync();

        setup.Context.UserGroupMemberships.AddRange(
            new UserGroupMembership { UserId = userMaker.UserId, GroupId = groupMaker.GroupId, AssignedBy = "TEST" },
            new UserGroupMembership { UserId = userChecker.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" }
        );

        var item = new InventoryItem
        {
            ItemId = 301,
            SerialNumber = "SN-DAMAGE-WF-TEST-001",
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

        // 1. Maker reports damage -> creates DAMAGE_BAR workflow instance
        await repo.MarkBarDamagedAsync(301, "DENTED_CORNER", "Corner chipped during transport", "DOC-CHIP-01", "treasury-maker");

        // Verify IsDamaged is STILL FALSE before workflow approval
        var itemBeforeApproval = await setup.Context.InventoryItems.FindAsync(301);
        Assert.NotNull(itemBeforeApproval);
        Assert.False(itemBeforeApproval.IsDamaged);
        Assert.Equal("PENDING_APPROVAL", itemBeforeApproval.DamageApprovalStatus);

        // Retrieve active workflow instance for DAMAGE_BAR
        var instances = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        var wfInst = instances.FirstOrDefault(i => i.WorkflowType == "DAMAGE_BAR" && i.EntityId == 301);
        Assert.NotNull(wfInst);

        // Step 1: Maker Verification
        var step1Result = await repo.ProcessWorkflowActionAsync(
            instanceId: wfInst.InstanceId,
            username: "treasury-maker",
            action: "APPROVED",
            comments: "Maker verified physical damage"
        );
        Assert.Equal("SUCCESS", step1Result);

        // Verify IsDamaged is STILL FALSE after Step 1 (only Maker verified, Checker has not authorized yet)
        var itemAfterStep1 = await setup.Context.InventoryItems.FindAsync(301);
        Assert.NotNull(itemAfterStep1);
        Assert.False(itemAfterStep1.IsDamaged);

        // Step 2: Checker Authorization (Terminal Step)
        var step2Result = await repo.ProcessWorkflowActionAsync(
            instanceId: wfInst.InstanceId,
            username: "treasury-checker",
            action: "APPROVED",
            comments: "Checker authorized quarantine"
        );
        Assert.Equal("SUCCESS", step2Result);

        // Verify IsDamaged is NOW TRUE and status is DAMAGED
        var itemAfterStep2 = await setup.Context.InventoryItems.FindAsync(301);
        Assert.NotNull(itemAfterStep2);
        Assert.True(itemAfterStep2.IsDamaged);
        Assert.Equal("APPROVED", itemAfterStep2.DamageApprovalStatus);
        Assert.Equal("DAMAGED", itemAfterStep2.StatusCode);
        Assert.Equal("treasury-checker", itemAfterStep2.DamageApprovedBy);
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

        // 5. Delete Brand (hard-deletes and nullifies product references)
        var deleted = await repo.DeleteBrandAsync(brand.BrandId);
        Assert.True(deleted);
        var brandAfterDelete = await repo.GetBrandByIdAsync(brand.BrandId);
        Assert.Null(brandAfterDelete);
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

    [Fact]
    public async Task EnsureSchemaUpToDateAsync_Successfully_Adds_ApprovedAt_Column_To_Existing_Table()
    {
        using var setup = CreateContext();
        var conn = setup.Connection;

        // Drop and recreate table without approved_at
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                DROP TABLE IF EXISTS pending_turkey_purchases;
                CREATE TABLE pending_turkey_purchases (
                    pending_purchase_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    batch_reference TEXT NOT NULL,
                    serials_json_list TEXT NOT NULL,
                    total_items INTEGER NOT NULL,
                    total_weight_grams TEXT NOT NULL,
                    unit_price_per_gram TEXT NOT NULL,
                    total_cost TEXT NOT NULL,
                    requested_by TEXT NOT NULL,
                    status_code TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
                    created_at TEXT NOT NULL
                );
            ";
            await cmd.ExecuteNonQueryAsync();
        }

        // Run schema migration
        await DbSeeder.EnsureSchemaUpToDateAsync(setup.Context);

        // Verify column approved_at exists
        using (var checkCmd = conn.CreateCommand())
        {
            checkCmd.CommandText = "PRAGMA table_info(pending_turkey_purchases);";
            var cols = new List<string>();
            using (var reader = await checkCmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    cols.Add(reader["name"]?.ToString() ?? "");
                }
            }

            Assert.Contains("approved_at", cols, StringComparer.OrdinalIgnoreCase);
            Assert.Contains("approved_by", cols, StringComparer.OrdinalIgnoreCase);
            Assert.Contains("notes", cols, StringComparer.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task ThresholdConfig_MakerChecker_FullLifecycle_CreatesAmendsAndDeletesOnlyOnApproval()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        await DbSeeder.EnsureWorkflowTemplatesAsync(setup.Context);

        var groupMaker = new PrivilegeGroup { GroupName = "Treasury Operations (Maker)", Description = "Maker group", IsSystem = true };
        var groupChecker = new PrivilegeGroup { GroupName = "Treasury Operations (Checker)", Description = "Checker group", IsSystem = true };
        setup.Context.PrivilegeGroups.AddRange(groupMaker, groupChecker);
        await setup.Context.SaveChangesAsync();

        var userMaker = new AppUser { Username = "treasury-maker", DisplayName = "Test Maker", Email = "maker@test.local", PasswordHash = "test-hash" };
        var userChecker = new AppUser { Username = "treasury-checker", DisplayName = "Test Checker", Email = "checker@test.local", PasswordHash = "test-hash" };
        setup.Context.AppUsers.AddRange(userMaker, userChecker);
        await setup.Context.SaveChangesAsync();

        setup.Context.UserGroupMemberships.AddRange(
            new UserGroupMembership { UserId = userMaker.UserId, GroupId = groupMaker.GroupId, AssignedBy = "TEST" },
            new UserGroupMembership { UserId = userChecker.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" }
        );
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // 1. Maker submits creation request
        var createRequest = await repo.SubmitThresholdChangeRequestAsync(
            thresholdType: "LOW_STOCK",
            thresholdId: null,
            productId: 1,
            vendorId: 1,
            minStockQty: 10,
            maxStockQty: null,
            reorderQty: 25,
            isActive: true,
            requestedBy: "treasury-maker",
            comments: "Initial cut-off threshold for gold kilobars"
        );

        Assert.NotNull(createRequest);
        Assert.Equal("CREATE", createRequest.ChangeType);
        Assert.Equal("LOW_STOCK", createRequest.ThresholdType);
        Assert.Equal("PENDING_APPROVAL", createRequest.StatusCode);

        // Verify threshold NOT active in ReorderThresholds yet
        var thresholdsBeforeApproval = await repo.GetReorderThresholdsAsync();
        Assert.DoesNotContain(thresholdsBeforeApproval, t => t.ProductId == 1 && t.MinStockQty == 10);

        // Get workflow instance for THRESHOLD_CONFIG
        var instances = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        var wfInst = instances.FirstOrDefault(i => i.WorkflowType == "THRESHOLD_CONFIG" && i.EntityId == createRequest.PendingChangeId);
        Assert.NotNull(wfInst);

        // 2a. Maker verifies creation (Step 1)
        var makerStepResult = await repo.ProcessWorkflowActionAsync(
            instanceId: wfInst.InstanceId,
            username: "treasury-maker",
            action: "APPROVED",
            comments: "Maker verified threshold configuration parameters"
        );
        Assert.Equal("SUCCESS", makerStepResult);

        // 2b. Checker approves creation (Step 2 - Terminal)
        var actionResult = await repo.ProcessWorkflowActionAsync(
            instanceId: wfInst.InstanceId,
            username: "treasury-checker",
            action: "APPROVED",
            comments: "Authorized threshold addition"
        );
        Assert.Equal("SUCCESS", actionResult);

        // Threshold should now exist in ReorderThresholds
        var thresholdsAfterApproval = (await repo.GetReorderThresholdsAsync()).ToList();
        var createdTh = thresholdsAfterApproval.FirstOrDefault(t => t.ProductId == 1 && t.MinStockQty == 10);
        Assert.NotNull(createdTh);
        Assert.Equal("LOW_STOCK", createdTh.ThresholdType);
        Assert.Equal(25, createdTh.ReorderQty);
        Assert.True(createdTh.IsActive);

        // 3. Maker submits amendment request
        var amendRequest = await repo.SubmitThresholdChangeRequestAsync(
            thresholdType: "LOW_STOCK",
            thresholdId: createdTh.ThresholdId,
            productId: 1,
            vendorId: 1,
            minStockQty: 15,
            maxStockQty: null,
            reorderQty: 30,
            isActive: true,
            requestedBy: "treasury-maker",
            comments: "Adjusted min stock to 15 pcs"
        );

        Assert.Equal("AMEND", amendRequest.ChangeType);
        Assert.Equal("PENDING_APPROVAL", amendRequest.StatusCode);

        // Old values still in effect before approval
        var thBeforeAmendApproval = (await repo.GetReorderThresholdsAsync()).First(t => t.ThresholdId == createdTh.ThresholdId);
        Assert.Equal(10, thBeforeAmendApproval.MinStockQty);

        // Maker verifies Step 1 & Checker approves Step 2
        var amendInstances = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        var amendWf = amendInstances.First(i => i.WorkflowType == "THRESHOLD_CONFIG" && i.EntityId == amendRequest.PendingChangeId);
        await repo.ProcessWorkflowActionAsync(
            instanceId: amendWf.InstanceId,
            username: "treasury-maker",
            action: "APPROVED",
            comments: "Maker verified amendment"
        );
        await repo.ProcessWorkflowActionAsync(
            instanceId: amendWf.InstanceId,
            username: "treasury-checker",
            action: "APPROVED",
            comments: "Approved 15 pcs limit"
        );

        var thAfterAmendApproval = (await repo.GetReorderThresholdsAsync()).First(t => t.ThresholdId == createdTh.ThresholdId);
        Assert.Equal(15, thAfterAmendApproval.MinStockQty);
        Assert.Equal(30, thAfterAmendApproval.ReorderQty);

        // 4. Maker submits deletion request
        var deleteRequest = await repo.SubmitThresholdDeleteRequestAsync(
            thresholdId: createdTh.ThresholdId,
            requestedBy: "treasury-maker",
            comments: "Retiring threshold"
        );

        Assert.Equal("DELETE", deleteRequest.ChangeType);
        Assert.Equal("PENDING_APPROVAL", deleteRequest.StatusCode);

        // Still exists prior to approval
        var thBeforeDeleteApproval = (await repo.GetReorderThresholdsAsync()).FirstOrDefault(t => t.ThresholdId == createdTh.ThresholdId);
        Assert.NotNull(thBeforeDeleteApproval);

        // Maker verifies Step 1 & Checker approves Step 2
        var deleteInstances = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        var deleteWf = deleteInstances.First(i => i.WorkflowType == "THRESHOLD_CONFIG" && i.EntityId == deleteRequest.PendingChangeId);
        await repo.ProcessWorkflowActionAsync(
            instanceId: deleteWf.InstanceId,
            username: "treasury-maker",
            action: "APPROVED",
            comments: "Maker verified deletion"
        );
        await repo.ProcessWorkflowActionAsync(
            instanceId: deleteWf.InstanceId,
            username: "treasury-checker",
            action: "APPROVED",
            comments: "Approved threshold deletion"
        );

        var thAfterDeleteApproval = (await repo.GetReorderThresholdsAsync()).FirstOrDefault(t => t.ThresholdId == createdTh.ThresholdId);
        Assert.Null(thAfterDeleteApproval);
    }

    [Fact]
    public async Task ThresholdConfig_MakerChecker_Rejection_DoesNotApplyChanges()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        await DbSeeder.EnsureWorkflowTemplatesAsync(setup.Context);

        var groupMaker = new PrivilegeGroup { GroupName = "Treasury Operations (Maker)", Description = "Maker group", IsSystem = true };
        var groupChecker = new PrivilegeGroup { GroupName = "Treasury Operations (Checker)", Description = "Checker group", IsSystem = true };
        setup.Context.PrivilegeGroups.AddRange(groupMaker, groupChecker);
        await setup.Context.SaveChangesAsync();

        var userMaker = new AppUser { Username = "treasury-maker", DisplayName = "Test Maker", Email = "maker@test.local", PasswordHash = "test-hash" };
        var userChecker = new AppUser { Username = "treasury-checker", DisplayName = "Test Checker", Email = "checker@test.local", PasswordHash = "test-hash" };
        setup.Context.AppUsers.AddRange(userMaker, userChecker);
        await setup.Context.SaveChangesAsync();

        setup.Context.UserGroupMemberships.AddRange(
            new UserGroupMembership { UserId = userMaker.UserId, GroupId = groupMaker.GroupId, AssignedBy = "TEST" },
            new UserGroupMembership { UserId = userChecker.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" }
        );
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // Maker submits creation request
        var createRequest = await repo.SubmitThresholdChangeRequestAsync(
            thresholdType: "LOW_STOCK",
            thresholdId: null,
            productId: 1,
            vendorId: 1,
            minStockQty: 50,
            maxStockQty: null,
            reorderQty: 100,
            isActive: true,
            requestedBy: "treasury-maker",
            comments: "Excessive threshold test"
        );

        var instances = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        var wfInst = instances.First(i => i.WorkflowType == "THRESHOLD_CONFIG" && i.EntityId == createRequest.PendingChangeId);

        // Maker verifies Step 1
        await repo.ProcessWorkflowActionAsync(
            instanceId: wfInst.InstanceId,
            username: "treasury-maker",
            action: "APPROVED",
            comments: "Forwarded to checker"
        );

        // Checker rejects Step 2
        var actionResult = await repo.ProcessWorkflowActionAsync(
            instanceId: wfInst.InstanceId,
            username: "treasury-checker",
            action: "REJECTED",
            comments: "Quantity violates risk policy"
        );

        Assert.Equal("SUCCESS", actionResult);

        // Verify request is rejected and no threshold created
        var pending = await repo.GetPendingThresholdChangeByIdAsync(createRequest.PendingChangeId);
        Assert.NotNull(pending);
        Assert.Equal("REJECTED", pending.StatusCode);

        var thresholds = await repo.GetReorderThresholdsAsync();
        Assert.DoesNotContain(thresholds, t => t.ProductId == 1 && t.MinStockQty == 50);
    }

    [Fact]
    public async Task Independent_LowStock_And_HighStock_Thresholds_EvaluatedCorrectly()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var repo = new InventoryRepository(setup.Context);

        // Save Low-Stock Threshold: min 5 pcs
        await repo.SaveReorderThresholdAsync(
            thresholdId: null,
            productId: 1,
            vendorId: 1,
            minStockQty: 5,
            maxStockQty: null,
            reorderQty: 10,
            isActive: true,
            thresholdType: "LOW_STOCK"
        );

        // Save High-Stock Threshold: max 20 pcs
        await repo.SaveReorderThresholdAsync(
            thresholdId: null,
            productId: 1,
            vendorId: 1,
            minStockQty: 0,
            maxStockQty: 20,
            reorderQty: 0,
            isActive: true,
            thresholdType: "HIGH_STOCK"
        );

        // Query thresholds by type
        var lowThresholds = (await repo.GetReorderThresholdsAsync("LOW_STOCK")).ToList();
        var highThresholds = (await repo.GetReorderThresholdsAsync("HIGH_STOCK")).ToList();

        Assert.Single(lowThresholds);
        Assert.Equal(5, lowThresholds[0].MinStockQty);

        Assert.Single(highThresholds);
        Assert.Equal(20, highThresholds[0].MaxStockQty);

        // Initial check: product 1 has 0 items in setup -> triggers LOW_STOCK alert
        var alerts = (await repo.CheckStockAlertsAsync()).ToList();
        Assert.Contains(alerts, a => ((string)a.alert_type) == "LOW_STOCK" && ((int)a.product_id) == 1);
        Assert.DoesNotContain(alerts, a => ((string)a.alert_type) == "HIGH_STOCK" && ((int)a.product_id) == 1);

        // Add 25 ready items for product 1 to breach high-stock ceiling
        for (int i = 1; i <= 25; i++)
        {
            setup.Context.InventoryItems.Add(new InventoryItem
            {
                ProductId = 1,
                SerialNumber = $"BAR-HIGH-TEST-{i:D3}",
                StatusCode = "READY",
                LotId = 1,
                LocationId = 1,
                OwnershipType = "KFH_OWNED",
                RowVersion = new byte[8]
            });
        }
        await setup.Context.SaveChangesAsync();

        var alertsAfterAdd = (await repo.CheckStockAlertsAsync()).ToList();
        // Low stock is no longer breached (25 > 5), but high stock is breached (25 >= 20)
        Assert.DoesNotContain(alertsAfterAdd, a => a.alert_type == "LOW_STOCK" && a.product_id == 1);
        Assert.Contains(alertsAfterAdd, a => a.alert_type == "HIGH_STOCK" && a.product_id == 1 && a.excess_qty == 5);
    }

    [Fact]
    public async Task OutboundMovement_DamagedBar_IsRejectedAndLocationUnchanged()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        await DbSeeder.EnsureWorkflowTemplatesAsync(setup.Context);

        var groupMaker = new PrivilegeGroup { GroupName = "Treasury Operations (Maker)", Description = "Maker group", IsSystem = true };
        var groupChecker = new PrivilegeGroup { GroupName = "Treasury Operations (Checker)", Description = "Checker group", IsSystem = true };
        setup.Context.PrivilegeGroups.AddRange(groupMaker, groupChecker);
        await setup.Context.SaveChangesAsync();

        var userMaker = new AppUser { Username = "treasury-maker", DisplayName = "Test Maker", Email = "maker@test.local", PasswordHash = "test-hash" };
        var userChecker = new AppUser { Username = "treasury-checker", DisplayName = "Test Checker", Email = "checker@test.local", PasswordHash = "test-hash" };
        setup.Context.AppUsers.AddRange(userMaker, userChecker);
        await setup.Context.SaveChangesAsync();

        setup.Context.UserGroupMemberships.AddRange(
            new UserGroupMembership { UserId = userMaker.UserId, GroupId = groupMaker.GroupId, AssignedBy = "TEST" },
            new UserGroupMembership { UserId = userChecker.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" }
        );

        // Bar physically located in Main Vault (LocationId = 1) and marked DAMAGED
        var damagedBar = new InventoryItem
        {
            ItemId = 401,
            SerialNumber = "SN-DAMAGED-OUTBOUND-001",
            ProductId = 1,
            LotId = 1,
            LocationId = 1, // Main Vault
            OwnershipType = "CUSTOMER_OWNED",
            StatusCode = "DAMAGED",
            IsDamaged = true,
            DamageApprovalStatus = "APPROVED",
            AveragePurchaseCost = 19.25m,
            RowVersion = new byte[8]
        };
        setup.Context.InventoryItems.Add(damagedBar);
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // 1. Direct transfer attempt is blocked immediately
        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateBranchTransferAsync(401, 2, "Test Courier", "treasury-maker");
        });

        // 2. Workflow initiation for branch transfer is blocked immediately
        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateWorkflowBranchTransferAsync(401, 2, "Test Courier", "treasury-maker");
        });

        // 3. If a workflow instance somehow exists, approving it validates IsDamaged, rejects the workflow, and leaves LocationId unchanged
        var transfer = new BranchTransfer
        {
            ItemId = 401,
            SourceBranchId = 1,
            DestinationBranchId = 2,
            CourierInfo = "Test Courier",
            StatusCode = "PENDING_APPROVAL",
            CreatedBy = "treasury-maker"
        };
        setup.Context.BranchTransfers.Add(transfer);
        await setup.Context.SaveChangesAsync();

        var wfInst = await repo.StartWorkflowInstanceAsync("BRANCH_TRANSFER", transfer.TransferId, "treasury-maker");

        // Step 1: Maker Verification
        var step1Result = await repo.ProcessWorkflowActionAsync(wfInst.InstanceId, "treasury-maker", "APPROVED", "Maker transfer verification");
        Assert.Equal("SUCCESS", step1Result);

        // Step 2: Checker Authorization (Terminal Step) attempts transfer -> validates IsDamaged, throws, cancels/rejects workflow, and preserves LocationId = 1
        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.ProcessWorkflowActionAsync(wfInst.InstanceId, "treasury-checker", "APPROVED", "Attempting transfer of damaged bar");
        });

        var barAfter = await setup.Context.InventoryItems.FindAsync(401);
        Assert.NotNull(barAfter);
        Assert.Equal(1, barAfter.LocationId); // Location MUST remain strictly unchanged (Main Vault)
        Assert.True(barAfter.IsDamaged);
        Assert.Equal("DAMAGED", barAfter.StatusCode);

        var transferAfter = await setup.Context.BranchTransfers.FindAsync(transfer.TransferId);
        Assert.NotNull(transferAfter);
        Assert.Equal("REJECTED", transferAfter.StatusCode);
    }

    [Fact]
    public async Task MarkingBarAsDamaged_PreservesOwnership_AveragePurchaseCost_Denomination_ProductType_Location()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        await DbSeeder.EnsureWorkflowTemplatesAsync(setup.Context);

        var groupMaker = new PrivilegeGroup { GroupName = "Treasury Operations (Maker)", Description = "Maker group", IsSystem = true };
        var groupChecker = new PrivilegeGroup { GroupName = "Treasury Operations (Checker)", Description = "Checker group", IsSystem = true };
        setup.Context.PrivilegeGroups.AddRange(groupMaker, groupChecker);
        await setup.Context.SaveChangesAsync();

        var userMaker = new AppUser { Username = "treasury-maker", DisplayName = "Test Maker", Email = "maker@test.local", PasswordHash = "test-hash" };
        var userChecker = new AppUser { Username = "treasury-checker", DisplayName = "Test Checker", Email = "checker@test.local", PasswordHash = "test-hash" };
        setup.Context.AppUsers.AddRange(userMaker, userChecker);
        await setup.Context.SaveChangesAsync();

        setup.Context.UserGroupMemberships.AddRange(
            new UserGroupMembership { UserId = userMaker.UserId, GroupId = groupMaker.GroupId, AssignedBy = "TEST" },
            new UserGroupMembership { UserId = userChecker.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" }
        );

        // Initial pristine bar
        var originalBar = new InventoryItem
        {
            ItemId = 501,
            SerialNumber = "SN-INVARIANT-TEST-501",
            ProductId = 1, // 1KG Gold Bar
            LotId = 1,
            LocationId = 1, // Zone Alpha, Shelf Row 1, Slot 1
            OwnershipType = "KFH_OWNED",
            AveragePurchaseCost = 21.750m,
            CustomerAccountNumber = "KFH-ACC-88899",
            StatusCode = "READY",
            IsDamaged = false,
            RowVersion = new byte[8]
        };
        setup.Context.InventoryItems.Add(originalBar);
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // 1. Report damage via Maker-Checker workflow
        await repo.MarkBarDamagedAsync(501, "SCRATCHED_SURFACE", "Deep scratch across serial", "DOC-501", "treasury-maker");

        // Verify attributes preserved while pending approval
        var barPending = await setup.Context.InventoryItems.FindAsync(501);
        Assert.NotNull(barPending);
        Assert.Equal("KFH_OWNED", barPending.OwnershipType);
        Assert.Equal(21.750m, barPending.AveragePurchaseCost);
        Assert.Equal(1, barPending.ProductId);
        Assert.Equal(1, barPending.LocationId);
        Assert.False(barPending.IsDamaged); // Not effective yet

        // 2. Maker step verified & Checker step approved
        var instances = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        var wfInst = instances.First(i => i.WorkflowType == "DAMAGE_BAR" && i.EntityId == 501);

        await repo.ProcessWorkflowActionAsync(wfInst.InstanceId, "treasury-maker", "APPROVED", "Maker inspection");
        await repo.ProcessWorkflowActionAsync(wfInst.InstanceId, "treasury-checker", "APPROVED", "Checker authorization");

        // Verify attributes strictly preserved after becoming effective as Damaged
        var barDamaged = await setup.Context.InventoryItems.FindAsync(501);
        Assert.NotNull(barDamaged);
        Assert.True(barDamaged.IsDamaged);
        Assert.Equal("DAMAGED", barDamaged.StatusCode);
        Assert.Equal("APPROVED", barDamaged.DamageApprovalStatus);

        // CRITICAL INVARIANTS:
        Assert.Equal("KFH_OWNED", barDamaged.OwnershipType); // Ownership must NOT change
        Assert.Equal(21.750m, barDamaged.AveragePurchaseCost); // Average purchase cost must NOT change
        Assert.Equal(1, barDamaged.ProductId); // Product type and denomination must NOT change
        Assert.Equal(1, barDamaged.LocationId); // Physical vault location must NOT change
        Assert.Equal("KFH-ACC-88899", barDamaged.CustomerAccountNumber);
    }

    [Fact]
    public async Task DamagedStatus_VisibleIn_BarcodeScan_MovementValidation_AndReporting()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var damagedBar = new InventoryItem
        {
            ItemId = 601,
            SerialNumber = "SN-SCAN-DAMAGED-601",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "DAMAGED",
            IsDamaged = true,
            DamageApprovalStatus = "APPROVED",
            DamageReason = "CRACKED_CORNER",
            DamageDescription = "Severe structural crack found during audit",
            RowVersion = new byte[8]
        };
        setup.Context.InventoryItems.Add(damagedBar);
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);
        var barcodeService = new BarcodeLabelService(repo);

        // 1. QR Scan / Barcode generation reflects DAMAGED status
        var label = await barcodeService.GenerateItemLabelAsync("SN-SCAN-DAMAGED-601");
        Assert.NotNull(label);
        Assert.True(label.IsDamaged);
        Assert.Equal("APPROVED", label.DamageApprovalStatus);
        Assert.Equal("CRACKED_CORNER", label.DamageReason);
        Assert.Contains("DAMAGED - QUARANTINE", label.Gs1HumanReadable);

        // 2. Outbound movement validation confirms blocked status
        var items = await repo.GetItemsAsync();
        var item = items.First(i => i.ItemId == 601);
        bool canMove = !item.IsDamaged && item.StatusCode == "READY";
        Assert.False(canMove);
        Assert.True(item.IsDamaged);

        // 3. Audit trail / reporting reflects damaged state
        var damagedBars = await repo.GetDamagedBarsAsync();
        Assert.Contains(damagedBars, b => b.ItemId == 601 && b.IsDamaged);
    }

    [Fact]
    public async Task UC01_AddBarcodeQr_AttributeValidation_ReprintReason_AndBulkGeneration()
    {
        using var setup = CreateContext();
        var repo = new InventoryRepository(setup.Context);
        var barcodeService = new BarcodeLabelService(repo);

        // 1. Mandatory Attribute Validation (Exception E2)
        var (invalidNoSerial, error1, _) = await barcodeService.GenerateCustomLabelAsync(new CustomBarcodeLabelRequest
        {
            SerialNumber = "",
            WeightGrams = 1000,
            PurityValue = 999.9m
        });
        Assert.False(invalidNoSerial);
        Assert.Contains("E2", error1);

        var (invalidWeight, error2, _) = await barcodeService.GenerateCustomLabelAsync(new CustomBarcodeLabelRequest
        {
            SerialNumber = "KFH-AU-1KG-009",
            WeightGrams = -5,
            PurityValue = 999.9m
        });
        Assert.False(invalidWeight);
        Assert.Contains("E2", error2);

        // 2. Main Flow - Generate Unique GS1-128 & QR Code
        var (valid, err, label) = await barcodeService.GenerateCustomLabelAsync(new CustomBarcodeLabelRequest
        {
            SerialNumber = "KFH-AU-1KG-009",
            MetalName = "Gold",
            WeightGrams = 1000,
            PurityValue = 999.9m,
            LotNumber = "LOT-2026-AUG",
            RefinerBrand = "Valcambi Suisse"
        });
        Assert.True(valid);
        Assert.Null(err);
        Assert.NotNull(label);
        Assert.Contains("(01)", label.Gs1HumanReadable);
        Assert.Contains("(21)KFH-AU-1KG-009", label.Gs1HumanReadable);
        Assert.Contains("(10)LOT-2026-AUG", label.Gs1HumanReadable);
        Assert.Contains("<svg", label.BarcodeSvg);
        Assert.Contains("<svg", label.QrCodeSvg);

        // 3. Bulk Label Generation (Alternative Flow A2)
        var bulk = await barcodeService.GenerateBulkLabelsAsync(new[] { "KFH-AU-1KG-009", "KFH-AU-1KG-010", "KFH-AU-1KG-011" });
        Assert.Equal(3, bulk.Count);
        Assert.All(bulk, b => Assert.False(string.IsNullOrEmpty(b.QrCodeSvg)));
    }

    [Fact]
    public async Task TestBarPassportAndChronologicalMovementHistory()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var item = new InventoryItem
        {
            ItemId = 777,
            SerialNumber = "AU-PASSPORT-TEST-001",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY",
            AveragePurchaseCost = 21500m
        };
        setup.Context.InventoryItems.Add(item);

        // Add 2 chronological transactions
        var tx1 = new InventoryTransaction
        {
            TransactionNumber = "RCPT-LOT-01-777",
            ItemId = 777,
            TransactionType = "RECEIPT",
            SourceLocationId = null,
            DestinationLocationId = 1,
            SourceOwnership = "TURKEY_OWNED",
            DestinationOwnership = "TURKEY_OWNED",
            InitiatedBy = "supplier-agent",
            TransactionTimestamp = DateTime.UtcNow.AddHours(-10)
        };
        var tx2 = new InventoryTransaction
        {
            TransactionNumber = "TX-PUR-777-001",
            ItemId = 777,
            TransactionType = "PURCHASE",
            SourceLocationId = 1,
            DestinationLocationId = 1,
            SourceOwnership = "TURKEY_OWNED",
            DestinationOwnership = "KFH_OWNED",
            InitiatedBy = "treasury-maker",
            ApprovedBy = "treasury-checker",
            TransactionTimestamp = DateTime.UtcNow.AddHours(-2)
        };
        setup.Context.InventoryTransactions.AddRange(tx1, tx2);

        var coc = new ChainOfCustodyEvent
        {
            ItemId = 777,
            EventType = "RECEIVED",
            RecordedBy = "treasury-maker",
            LocationId = 1,
            RecordedAt = DateTime.UtcNow.AddHours(-10),
            Notes = "Intake into vault ledger"
        };
        setup.Context.ChainOfCustodyEvents.Add(coc);
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // Query by serial
        var passport = await repo.GetBarPassportAndHistoryAsync("AU-PASSPORT-TEST-001");
        Assert.NotNull(passport);

        // Verify bar details
        var barProp = passport.GetType().GetProperty("bar")?.GetValue(passport);
        Assert.NotNull(barProp);
        var serialProp = barProp.GetType().GetProperty("serial_number")?.GetValue(barProp)?.ToString();
        Assert.Equal("AU-PASSPORT-TEST-001", serialProp);
        var ownerProp = barProp.GetType().GetProperty("ownership_type")?.GetValue(barProp)?.ToString();
        Assert.Equal("KFH_OWNED", ownerProp);
        var statusProp = barProp.GetType().GetProperty("status")?.GetValue(barProp)?.ToString();
        Assert.Equal("READY", statusProp);

        // Verify movements
        var movsProp = passport.GetType().GetProperty("movements")?.GetValue(passport) as System.Collections.IEnumerable;
        Assert.NotNull(movsProp);
        var movList = movsProp.Cast<object>().ToList();
        Assert.Equal(2, movList.Count);
    }

    [Fact]
    public async Task TestCustomsOwnerIntakeStage_CreatesCustomsOwnedItems_AndClearsToKfhOwned()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var intakeWorkflow = new WorkflowTemplate
        {
            WorkflowType = "INTAKE_SHIPMENT",
            Name = "Intake Workflow",
            Description = "Intake verification",
            IsActive = true
        };
        setup.Context.WorkflowTemplates.Add(intakeWorkflow);
        await setup.Context.SaveChangesAsync();

        setup.Context.WorkflowSteps.Add(
            new WorkflowStep { TemplateId = intakeWorkflow.TemplateId, StepOrder = 1, StepName = "Intake Verification", RequiredRole = "Operations Checker", Description = "Verify serials" }
        );
        await setup.Context.SaveChangesAsync();

        var groupChecker = new PrivilegeGroup { GroupName = "Operations Checker", Description = "Test checker group", IsSystem = true };
        setup.Context.PrivilegeGroups.Add(groupChecker);
        await setup.Context.SaveChangesAsync();

        var checkerUser = new AppUser { Username = "checker-customs", DisplayName = "Customs Checker", Email = "checker@customs.test", PasswordHash = "test-hash" };
        setup.Context.AppUsers.Add(checkerUser);
        await setup.Context.SaveChangesAsync();

        setup.Context.UserGroupMemberships.Add(new UserGroupMembership { UserId = checkerUser.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" });
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // 1. Intake shipment with OwnershipType = "CUSTOMS_OWNED" and Customs metadata
        string serialsJson = "[{\"serial\":\"CUSTOMS-AU-001\",\"product_id\":1},{\"serial\":\"CUSTOMS-AU-002\",\"product_id\":1}]";
        var pendingIntake = await repo.InitiateWorkflowIntakeAsync(
            null, "LOT-CUSTOMS-2026-001", 1, "customs_maker", serialsJson,
            sourceType: "SUPPLIER", vendorId: 1, ownershipType: "CUSTOMS_OWNED",
            customsDeclarationNumber: "BAYAN-KWT-2026-9912",
            customsDutyAmount: 1250.50m,
            portOfEntry: "Kuwait Int'l Airport Cargo");

        Assert.Equal("CUSTOMS_OWNED", pendingIntake.OwnershipType);
        Assert.Equal("BAYAN-KWT-2026-9912", pendingIntake.CustomsDeclarationNumber);
        Assert.Equal(1250.50m, pendingIntake.CustomsDutyAmount);
        Assert.Equal("Kuwait Int'l Airport Cargo", pendingIntake.PortOfEntry);

        // 2. Approve intake via Maker-Checker workflow
        var instances = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        var intakeInstance = instances.First(i => i.WorkflowType == "INTAKE_SHIPMENT" && i.EntityId == pendingIntake.PendingIntakeId);
        var intakeResult = await repo.ProcessWorkflowActionAsync(intakeInstance.InstanceId, "checker-customs", "APPROVED", "Approved customs bonded shipment");
        Assert.Equal("SUCCESS", intakeResult);

        // Verify items created with CUSTOMS_OWNED
        var customsItems = await setup.Context.InventoryItems
            .Where(i => i.SerialNumber == "CUSTOMS-AU-001" || i.SerialNumber == "CUSTOMS-AU-002")
            .ToListAsync();
        Assert.Equal(2, customsItems.Count);
        Assert.All(customsItems, item => Assert.Equal("CUSTOMS_OWNED", item.OwnershipType));

        // Verify lot metadata
        var lot = await setup.Context.InventoryLots.FirstOrDefaultAsync(l => l.LotNumber == "LOT-CUSTOMS-2026-001");
        Assert.NotNull(lot);
        Assert.Equal("BAYAN-KWT-2026-9912", lot.CustomsDeclarationNumber);
        Assert.Equal("Kuwait Int'l Airport Cargo", lot.PortOfEntry);

        // 3. Clear customs shipment and transition ownership to KFH_OWNED
        var clearanceResult = await repo.ClearCustomsShipmentAsync(
            pendingIntake.PendingIntakeId,
            "KFH_OWNED",
            "customs_agent",
            "Cleared by Kuwait Customs; duty paid under receipt #88192");
        Assert.Equal("SUCCESS", clearanceResult);

        // 4. Verify items transitioned to KFH_OWNED
        var clearedItems = await setup.Context.InventoryItems
            .Where(i => i.SerialNumber == "CUSTOMS-AU-001" || i.SerialNumber == "CUSTOMS-AU-002")
            .ToListAsync();
        Assert.Equal(2, clearedItems.Count);
        Assert.All(clearedItems, item => Assert.Equal("KFH_OWNED", item.OwnershipType));

        // Verify inventory transaction was logged
        var clrTx = await setup.Context.InventoryTransactions
            .FirstOrDefaultAsync(t => t.SourceOwnership == "CUSTOMS_OWNED" && t.DestinationOwnership == "KFH_OWNED");
        Assert.NotNull(clrTx);
        Assert.Equal("ADJUSTMENT", clrTx.TransactionType);
    }

    [Fact]
    public async Task CustomsOwnershipTransfer_MakerCheckerWorkflow_TransfersToTurkeyOwned()
    {
        // Arrange
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        // Seed groups and users
        var makerGroup = new PrivilegeGroup { GroupName = "Treasury Operations (Maker)", Description = "Maker", IsSystem = true };
        var checkerGroup = new PrivilegeGroup { GroupName = "Treasury Operations (Checker)", Description = "Checker", IsSystem = true };
        setup.Context.PrivilegeGroups.AddRange(makerGroup, checkerGroup);
        await setup.Context.SaveChangesAsync();

        var makerUser = new AppUser { Username = "maker-xfr", DisplayName = "Maker User", Email = "maker@kfh.com", PasswordHash = "test-hash", IsActive = true };
        var checkerUser = new AppUser { Username = "checker-xfr", DisplayName = "Checker User", Email = "checker@kfh.com", PasswordHash = "test-hash", IsActive = true };
        setup.Context.AppUsers.AddRange(makerUser, checkerUser);
        await setup.Context.SaveChangesAsync();

        setup.Context.UserGroupMemberships.AddRange(
            new UserGroupMembership { UserId = makerUser.UserId, GroupId = makerGroup.GroupId, AssignedBy = "TEST" },
            new UserGroupMembership { UserId = checkerUser.UserId, GroupId = checkerGroup.GroupId, AssignedBy = "TEST" }
        );
        await setup.Context.SaveChangesAsync();

        // Seed CUSTOMS_TRANSFER workflow template
        var transferWf = new WorkflowTemplate
        {
            WorkflowType = "CUSTOMS_TRANSFER",
            Name = "Customs Transfer Workflow",
            Description = "Maker-Checker customs clearance to Turkey ownership",
            IsActive = true
        };
        setup.Context.WorkflowTemplates.Add(transferWf);
        await setup.Context.SaveChangesAsync();

        var step1 = new WorkflowStep
        {
            TemplateId = transferWf.TemplateId,
            StepOrder = 1,
            StepName = "Customs Transfer Maker Verification",
            RequiredRole = "Treasury Operations (Maker)",
            Description = "Maker verification"
        };
        var step2 = new WorkflowStep
        {
            TemplateId = transferWf.TemplateId,
            StepOrder = 2,
            StepName = "Customs Transfer Checker Authorization",
            RequiredRole = "Treasury Operations (Checker)",
            Description = "Checker authorization"
        };
        setup.Context.WorkflowSteps.AddRange(step1, step2);
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // Intake items directly with CUSTOMS_OWNED
        string serialsJson = "[{\"serial\":\"TR-CUSTOMS-BAR-01\",\"product_id\":1},{\"serial\":\"TR-CUSTOMS-BAR-02\",\"product_id\":1}]";
        var intakeRes = await repo.IntakeInventoryItemsAsync(
            null, "LOT-BONDED-TR-99", 1, "customs_agent", serialsJson,
            sourceType: "SUPPLIER", vendorId: 1, ownershipType: "CUSTOMS_OWNED",
            customsDeclarationNumber: "BAYAN-TR-2026-110",
            portOfEntry: "Shuwaikh Port Customs");
        Assert.Equal("SUCCESS", intakeRes);

        var lot = await setup.Context.InventoryLots.FirstOrDefaultAsync(l => l.LotNumber == "LOT-BONDED-TR-99");
        Assert.NotNull(lot);

        // Act 1: Maker initiates customs transfer targeting TURKEY_OWNED
        var pendingTransfer = await repo.InitiateCustomsTransferWorkflowAsync(
            lotId: lot.LotId,
            itemId: null,
            targetOwnership: "TURKEY_OWNED",
            requestedBy: "maker-xfr",
            clearanceNotes: "Duty paid, transferring bonded gold to Kuveyt Turk portfolio",
            customsDeclarationNumber: "BAYAN-TR-2026-110",
            customsDutyAmount: 450.500m,
            portOfEntry: "Shuwaikh Port Customs"
        );

        Assert.NotNull(pendingTransfer);
        Assert.Equal("PENDING_APPROVAL", pendingTransfer.StatusCode);
        Assert.Equal("TURKEY_OWNED", pendingTransfer.TargetOwnership);

        // Find active workflow instance
        var instances = await repo.GetActiveWorkflowInstancesAsync();
        var wfInstance = instances.FirstOrDefault(i => i.WorkflowType == "CUSTOMS_TRANSFER" && i.EntityId == pendingTransfer.PendingTransferId);
        Assert.NotNull(wfInstance);
        Assert.Equal(1, wfInstance.CurrentStepOrder);

        // Act 2: Step 1 maker sign-off
        var step1Result = await repo.ProcessWorkflowActionAsync(wfInstance.InstanceId, "maker-xfr", "APPROVED", "Maker docs verified");
        Assert.Equal("SUCCESS", step1Result);

        // Act 3: Step 2 checker authorization
        var step2Result = await repo.ProcessWorkflowActionAsync(wfInstance.InstanceId, "checker-xfr", "APPROVED", "Checker duty receipt verified and transfer authorized");
        Assert.Equal("SUCCESS", step2Result);

        // Assert: Items transferred from CUSTOMS_OWNED to TURKEY_OWNED
        var updatedItems = await setup.Context.InventoryItems
            .Where(i => i.SerialNumber == "TR-CUSTOMS-BAR-01" || i.SerialNumber == "TR-CUSTOMS-BAR-02")
            .ToListAsync();
        Assert.Equal(2, updatedItems.Count);
        Assert.All(updatedItems, item => Assert.Equal("TURKEY_OWNED", item.OwnershipType));

        // Assert: Pending customs transfer marked APPROVED
        var finalTransfer = await setup.Context.PendingCustomsTransfers.FindAsync(pendingTransfer.PendingTransferId);
        Assert.NotNull(finalTransfer);
        Assert.Equal("APPROVED", finalTransfer.StatusCode);
        Assert.Equal("checker-xfr", finalTransfer.ApprovedBy);

        // Assert: Inventory transactions recorded
        var txList = await setup.Context.InventoryTransactions
            .Where(t => t.SourceOwnership == "CUSTOMS_OWNED" && t.DestinationOwnership == "TURKEY_OWNED")
            .ToListAsync();
        Assert.Equal(2, txList.Count);
    }

    [Fact]
    public async Task TestCheckerCannotInitiateWorkflowUnlessStartPoint()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        // 1. Provision real Maker and Checker groups and users
        var groupMaker = new PrivilegeGroup { GroupName = "Treasury Operations (Maker)", Description = "Maker operations", IsSystem = true };
        var groupChecker = new PrivilegeGroup { GroupName = "Treasury Operations (Checker)", Description = "Checker operations", IsSystem = true };
        setup.Context.PrivilegeGroups.AddRange(groupMaker, groupChecker);
        await setup.Context.SaveChangesAsync();

        var userMaker = new AppUser { Username = "real-maker", DisplayName = "Maker Person", Email = "maker@test.local", PasswordHash = "hash" };
        var userChecker = new AppUser { Username = "real-checker", DisplayName = "Checker Person", Email = "checker@test.local", PasswordHash = "hash" };
        setup.Context.AppUsers.AddRange(userMaker, userChecker);
        await setup.Context.SaveChangesAsync();

        setup.Context.UserGroupMemberships.AddRange(
            new UserGroupMembership { UserId = userMaker.UserId, GroupId = groupMaker.GroupId, AssignedBy = "TEST" },
            new UserGroupMembership { UserId = userChecker.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" }
        );
        await setup.Context.SaveChangesAsync();

        var repo = new InventoryRepository(setup.Context);

        // 2. Configure workflow where Step 1 is Maker, Step 2 is Checker
        string stepsJson = "[{\"step_name\":\"Maker Draft\",\"required_role\":\"Treasury Operations (Maker)\",\"description\":\"Maker creation\"},{\"step_name\":\"Checker Approval\",\"required_role\":\"Treasury Operations (Checker)\",\"description\":\"Checker review\"}]";
        await repo.SaveWorkflowTemplateAsync("PURCHASE_ORDER", "PO Workflow", "Maker to Checker flow", stepsJson);

        // 3. Checker tries to initiate workflow -> MUST BE REJECTED
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.CreatePurchaseOrderAsync("PO-CHECKER-BLOCKED-01", 1, 1000m, 73000m, "USD", "real-checker", "[]");
        });
        Assert.Contains("not authorized to initiate", ex.Message);
        Assert.Contains("Treasury Operations (Maker)", ex.Message);

        // 4. Maker initiates workflow -> MUST SUCCEED (Maker IS the start point)
        var (poId, result) = await repo.CreatePurchaseOrderAsync("PO-MAKER-ALLOWED-01", 1, 1000m, 73000m, "USD", "real-maker", "[]");
        Assert.Equal("SUCCESS", result);
        Assert.True(poId > 0);

        // 5. Test reverse workflow where Checker IS configured as the start point (Step 1 = Checker)
        string checkerStartSteps = "[{\"step_name\":\"Checker Audit First\",\"required_role\":\"Treasury Operations (Checker)\",\"description\":\"Checker start\"}]";
        await repo.SaveWorkflowTemplateAsync("BRANCH_TRANSFER", "Transfer Audit Flow", "Checker starting flow", checkerStartSteps);

        var item = new InventoryItem { SerialNumber = "BAR-WF-CHK-01", ProductId = 1, LocationId = 1, LotId = 1, StatusCode = "READY", OwnershipType = "CUSTOMER_OWNED" };
        setup.Context.InventoryItems.Add(item);
        await setup.Context.SaveChangesAsync();

        // Checker CAN initiate when he IS the start point
        var transfer = await repo.InitiateWorkflowBranchTransferAsync(item.ItemId, 2, "Escort", "real-checker");
        Assert.NotNull(transfer);
        Assert.True(transfer.TransferId > 0);
    }

    [Fact]
    public async Task TurkeyConsignment_QrCodeRequirementSetting_EnforcesOrAllowsTransfer()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        // 1. Setup TURKEY_PURCHASE workflow template and item
        var trWorkflow = new WorkflowTemplate
        {
            WorkflowType = "TURKEY_PURCHASE",
            Name = "Turkey Purchase Workflow",
            Description = "Consignment purchase verification",
            IsActive = true
        };
        setup.Context.WorkflowTemplates.Add(trWorkflow);
        await setup.Context.SaveChangesAsync();

        setup.Context.WorkflowSteps.Add(
            new WorkflowStep { TemplateId = trWorkflow.TemplateId, StepOrder = 1, StepName = "Purchase Approval", RequiredRole = "Operations Checker", Description = "Approve Turkey purchase" }
        );
        await setup.Context.SaveChangesAsync();

        var trItem = new InventoryItem
        {
            SerialNumber = "TR-BAR-TEST-001",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "TURKEY_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.Add(trItem);
        await setup.Context.SaveChangesAsync();

        // 2. By default or when disabled, transfer should succeed even without QR printed
        await repo.SetQrCodeRequiredForTurkeyTransferAsync(false, "admin");
        Assert.False(await repo.IsQrCodeRequiredForTurkeyTransferAsync());

        var pending1 = await repo.InitiateTurkeyPurchaseWorkflowAsync(
            new List<string> { "TR-BAR-TEST-001" },
            24.50m,
            "maker1",
            "Initial test purchase");
        Assert.NotNull(pending1);
        Assert.Equal("PENDING_APPROVAL", pending1.StatusCode);

        // Clean up pending for next test
        setup.Context.PendingTurkeyPurchases.Remove(pending1);
        await setup.Context.SaveChangesAsync();

        // 3. Enable QR requirement setting
        await repo.SetQrCodeRequiredForTurkeyTransferAsync(true, "admin");
        Assert.True(await repo.IsQrCodeRequiredForTurkeyTransferAsync());

        // 4. Maker attempts to initiate transfer without QR printed -> MUST THROW
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateTurkeyPurchaseWorkflowAsync(
                new List<string> { "TR-BAR-TEST-001" },
                24.50m,
                "maker1",
                "Purchase blocked without QR");
        });
        Assert.Contains("QR Code has not been printed", ex.Message);
        Assert.Contains("TR-BAR-TEST-001", ex.Message);

        // 5. Print the QR label (record ChainOfCustodyEvent LABEL_PRINTED)
        await repo.RecordChainOfCustodyEventAsync(trItem.ItemId, "LABEL_PRINTED", "operator", notes: "QR printed for testing");

        // 6. Maker attempts to initiate transfer after QR printed -> MUST SUCCEED
        var pending2 = await repo.InitiateTurkeyPurchaseWorkflowAsync(
            new List<string> { "TR-BAR-TEST-001" },
            24.50m,
            "maker1",
            "Purchase after QR printed");
        Assert.NotNull(pending2);
        Assert.Equal("PENDING_APPROVAL", pending2.StatusCode);

        // 7. Checker approves -> ownership changes to KFH_OWNED
        var approveResult = await repo.ApproveTurkeyPurchaseAsync(pending2.PendingPurchaseId, "checker1");
        Assert.Equal("SUCCESS", approveResult);

        var updatedItem = await setup.Context.InventoryItems.FindAsync(trItem.ItemId);
        Assert.NotNull(updatedItem);
        Assert.Equal("KFH_OWNED", updatedItem.OwnershipType);

        // 8. Can disable setting again
        await repo.SetQrCodeRequiredForTurkeyTransferAsync(false, "admin");
        Assert.False(await repo.IsQrCodeRequiredForTurkeyTransferAsync());
    }

    [Fact]
    public async Task QrCodeReprintPrivilege_SettingsAndValidation_WorkCorrectly()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        // 1. Defaults to ADMIN_ONLY
        var defaultPriv = await repo.GetQrCodeReprintPrivilegeAsync();
        Assert.Equal("ADMIN_ONLY", defaultPriv);

        // 2. Set to valid levels
        await repo.SetQrCodeReprintPrivilegeAsync("CHECKER_AND_ADMIN", "admin");
        Assert.Equal("CHECKER_AND_ADMIN", await repo.GetQrCodeReprintPrivilegeAsync());

        await repo.SetQrCodeReprintPrivilegeAsync("ALL_OPERATORS", "admin");
        Assert.Equal("ALL_OPERATORS", await repo.GetQrCodeReprintPrivilegeAsync());

        await repo.SetQrCodeReprintPrivilegeAsync("DISABLED", "admin");
        Assert.Equal("DISABLED", await repo.GetQrCodeReprintPrivilegeAsync());

        await repo.SetQrCodeReprintPrivilegeAsync("ADMIN_ONLY", "admin");
        Assert.Equal("ADMIN_ONLY", await repo.GetQrCodeReprintPrivilegeAsync());

        // 3. Invalid level throws ArgumentException
        await Assert.ThrowsAsync<ArgumentException>(async () =>
        {
            await repo.SetQrCodeReprintPrivilegeAsync("SUPERUSER_ONLY", "admin");
        });
    }

    [Fact]
    public async Task QrCodeContent_ContainsDenomination_SerialNo_AndProductTypeSwissOrTurkey()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);
        var barcodeService = new BarcodeLabelService(repo);

        // 1. Swiss Gold Bar (p1 seeded with AU-1KG-SWISS, Switzerland, 1kg)
        var swissItem = new InventoryItem
        {
            ItemId = 881,
            SerialNumber = "KFH-AU-SWISS-001",
            ProductId = 1, // AU-1KG-SWISS, Switzerland
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.Add(swissItem);

        // 2. Turkey Gold Bar (AU-100G-TURK, Turkey, 100g)
        var d100g = new MetalDenomination { DenominationId = 2, Label = "100g", WeightGrams = 100m, WeightOunces = 3.215m, MetalTypeId = 1 };
        setup.Context.MetalDenominations.Add(d100g);

        var pTurk = new MetalProduct
        {
            ProductId = 92,
            ProductCode = "AU-100G-TURK",
            MetalTypeId = 1,
            DenominationId = 2, // 100g
            PurityId = 1,
            OriginCountry = "Turkey",
            BrandName = "Nadir Gold Refinery"
        };
        setup.Context.MetalProducts.Add(pTurk);

        var turkItem = new InventoryItem
        {
            ItemId = 882,
            SerialNumber = "TR-BAR-TEST-777",
            ProductId = 92,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "TURKEY_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.Add(turkItem);
        await setup.Context.SaveChangesAsync();

        // 3. Generate Label for Swiss Bar
        var swissLabel = await barcodeService.GenerateItemLabelAsync("KFH-AU-SWISS-001");
        Assert.NotNull(swissLabel);
        Assert.Equal("KFH-AU-SWISS-001", swissLabel.SerialNumber);
        Assert.NotNull(swissLabel.QrCodeContent);
        Assert.Contains("Serial No: KFH-AU-SWISS-001", swissLabel.QrCodeContent);
        Assert.Contains("Denomination: 1 Kilogram Bar", swissLabel.QrCodeContent);
        Assert.Contains("Product Type: Gold Swiss", swissLabel.QrCodeContent);
        Assert.Contains("<svg", swissLabel.QrCodeSvg);

        // 4. Generate Label for Turkey Bar
        var turkLabel = await barcodeService.GenerateItemLabelAsync("TR-BAR-TEST-777");
        Assert.NotNull(turkLabel);
        Assert.Equal("TR-BAR-TEST-777", turkLabel.SerialNumber);
        Assert.NotNull(turkLabel.QrCodeContent);
        Assert.Contains("Serial No: TR-BAR-TEST-777", turkLabel.QrCodeContent);
        Assert.Contains("Denomination: 100g", turkLabel.QrCodeContent);
        Assert.Contains("Product Type: Gold Turkey", turkLabel.QrCodeContent);
        Assert.Contains("<svg", turkLabel.QrCodeSvg);

        // 5. Custom Barcode Label with Turkey origin
        var (valid, _, customLabel) = await barcodeService.GenerateCustomLabelAsync(new CustomBarcodeLabelRequest
        {
            SerialNumber = "CUSTOM-TR-001",
            MetalName = "Gold",
            WeightGrams = 50,
            DenominationLabel = "50g",
            RefinerBrand = "Nadir Turkey",
            OwnershipType = "TURKEY_OWNED"
        });
        Assert.True(valid);
        Assert.NotNull(customLabel);
        Assert.Contains("Serial No: CUSTOM-TR-001", customLabel.QrCodeContent);
        Assert.Contains("Denomination: 50g", customLabel.QrCodeContent);
        Assert.Contains("Product Type: Gold Turkey", customLabel.QrCodeContent);
    }

    [Fact]
    public async Task Test_VipStockAllocationAndDispense_Workflow()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        // 0. Seed VIP workflow templates
        var vipAllocWf = new WorkflowTemplate { WorkflowType = "VIP_ALLOCATION", Name = "VIP Alloc", Description = "VIP Allocation Workflow", IsActive = true };
        setup.Context.WorkflowTemplates.Add(vipAllocWf);
        var vipDispWf = new WorkflowTemplate { WorkflowType = "VIP_DISPENSE", Name = "VIP Disp", Description = "VIP Dispensation Workflow", IsActive = true };
        setup.Context.WorkflowTemplates.Add(vipDispWf);
        await setup.Context.SaveChangesAsync();

        setup.Context.WorkflowSteps.Add(new WorkflowStep { TemplateId = vipAllocWf.TemplateId, StepOrder = 1, StepName = "Alloc Checker", RequiredRole = "Operations Checker", Description = "Checker approve" });
        setup.Context.WorkflowSteps.Add(new WorkflowStep { TemplateId = vipDispWf.TemplateId, StepOrder = 1, StepName = "Disp Checker", RequiredRole = "Operations Checker", Description = "Checker approve" });
        await setup.Context.SaveChangesAsync();

        // 1. Setup KFH owned bar (after purchase from Turkey)
        var product = await setup.Context.MetalProducts.Include(p => p.Denomination).FirstAsync();
        var kfhBar = new InventoryItem
        {
            SerialNumber = "KFH-VIP-TEST-001",
            ProductId = product.ProductId,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.Add(kfhBar);
        await setup.Context.SaveChangesAsync();

        // 2. Maker initiates VIP allocation
        var allocation = await repo.InitiateVipAllocationWorkflowAsync(
            new List<string> { "KFH-VIP-TEST-001" },
            "treasury-maker",
            "Allocating high grade bar to VIP reserve",
            "Private Banking / VIP Exclusive");

        Assert.NotNull(allocation);
        Assert.Equal("PENDING_APPROVAL", allocation.StatusCode);
        Assert.Equal(1, allocation.TotalItems);
        Assert.Equal(product.Denomination?.WeightGrams ?? 0, allocation.TotalWeightGrams);

        // 3. Checker approves VIP allocation
        var approveAllocResult = await repo.ApproveVipAllocationAsync(allocation.PendingAllocationId, "treasury-checker");
        Assert.Equal("SUCCESS", approveAllocResult);

        var barAfterAlloc = await setup.Context.InventoryItems.FindAsync(kfhBar.ItemId);
        Assert.NotNull(barAfterAlloc);
        Assert.Equal("KFH_OWNED", barAfterAlloc.OwnershipType);
        Assert.Equal("OFFLINE", barAfterAlloc.ChannelStatus);
        Assert.Equal("READY", barAfterAlloc.StatusCode);

        // 4. Verify VIP inventory contains this item, and KFH online available excludes it
        var vipItems = (await repo.GetVipInventoryAsync()).ToList();
        Assert.Contains(vipItems, i => i.SerialNumber == "KFH-VIP-TEST-001");

        var kfhAvailable = (await repo.GetKfhAvailableInventoryAsync()).ToList();
        Assert.DoesNotContain(kfhAvailable, i => i.SerialNumber == "KFH-VIP-TEST-001");

        // 5. Test Return from VIP (Offline) to KFH Online via Workflow
        var vipDeallocWf = new WorkflowTemplate { WorkflowType = "VIP_DEALLOCATION", Name = "VIP Deallocation", Description = "VIP Deallocation Workflow", IsActive = true };
        setup.Context.WorkflowTemplates.Add(vipDeallocWf);
        await setup.Context.SaveChangesAsync();

        var dstep1 = new WorkflowStep { TemplateId = vipDeallocWf.TemplateId, StepOrder = 1, StepName = "Maker Request", RequiredRole = "Operations Maker", Description = "Maker submit" };
        var dstep2 = new WorkflowStep { TemplateId = vipDeallocWf.TemplateId, StepOrder = 2, StepName = "Checker Approval", RequiredRole = "Operations Checker", Description = "Checker approve" };
        setup.Context.WorkflowSteps.AddRange(dstep1, dstep2);
        await setup.Context.SaveChangesAsync();

        var dealloc = await repo.InitiateVipDeallocationWorkflowAsync(
            new List<string> { "KFH-VIP-TEST-001" },
            "treasury-maker",
            "Retail Replenishment",
            "Rebalancing to online e-commerce catalogue");
        Assert.NotNull(dealloc);
        Assert.Equal("PENDING_APPROVAL", dealloc.StatusCode);

        var approveDeallocResult = await repo.ApproveVipDeallocationAsync(dealloc.PendingDeallocationId, "treasury-checker");
        Assert.Equal("SUCCESS", approveDeallocResult);

        var barAfterDealloc = await setup.Context.InventoryItems.FindAsync(kfhBar.ItemId);
        Assert.NotNull(barAfterDealloc);
        Assert.Equal("KFH_OWNED", barAfterDealloc.OwnershipType);
        Assert.Equal("ONLINE", barAfterDealloc.ChannelStatus);

        // Re-allocate to VIP for dispensation test
        await repo.ApproveVipAllocationAsync((await repo.InitiateVipAllocationWorkflowAsync(new List<string> { "KFH-VIP-TEST-001" }, "treasury-maker", "Re-allocating for VIP client")).PendingAllocationId, "treasury-checker");

        // 6. Maker initiates VIP dispensation to VIP client
        var dispense = await repo.InitiateVipDispenseWorkflowAsync(
            new List<string> { "KFH-VIP-TEST-001" },
            "Sheikha Al-Sabah",
            "290010101234",
            "ACC-VIP-999888",
            "VIP Private Vault Handover",
            "vip-specialist",
            "Client requested physical collection");

        Assert.NotNull(dispense);
        Assert.Equal("PENDING_APPROVAL", dispense.StatusCode);

        // 7. Checker approves VIP dispensation
        var approveDispResult = await repo.ApproveVipDispenseAsync(dispense.PendingDispenseId, "treasury-checker");
        Assert.Equal("SUCCESS", approveDispResult);

        var barAfterDisp = await setup.Context.InventoryItems.FindAsync(kfhBar.ItemId);
        Assert.NotNull(barAfterDisp);
        Assert.Equal("CUSTOMER_OWNED", barAfterDisp.OwnershipType);
        Assert.Equal("DELIVERED", barAfterDisp.StatusCode);
    }

    [Fact]
    public async Task Test_TurkeyReturn_ConsignmentReversion_Workflow()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        var turkeyReturnWf = new WorkflowTemplate { WorkflowType = "TURKEY_RETURN", Name = "Turkey Return", Description = "Turkey Return Workflow", IsActive = true };
        setup.Context.WorkflowTemplates.Add(turkeyReturnWf);
        await setup.Context.SaveChangesAsync();

        var step1 = new WorkflowStep { TemplateId = turkeyReturnWf.TemplateId, StepOrder = 1, StepName = "Maker Request", RequiredRole = "Operations Maker", Description = "Maker submit" };
        var step2 = new WorkflowStep { TemplateId = turkeyReturnWf.TemplateId, StepOrder = 2, StepName = "Checker Approval", RequiredRole = "Operations Checker", Description = "Checker approve" };
        setup.Context.WorkflowSteps.AddRange(step1, step2);
        await setup.Context.SaveChangesAsync();

        var product = await setup.Context.MetalProducts.Include(p => p.Denomination).FirstAsync();
        var kfhBar = new InventoryItem
        {
            ProductId = product.ProductId,
            LotId = 1,
            LocationId = 1,
            SerialNumber = "KFH-RET-TEST-001",
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY"
        };
        var vipBar = new InventoryItem
        {
            ProductId = product.ProductId,
            LotId = 1,
            LocationId = 1,
            SerialNumber = "VIP-RET-TEST-002",
            OwnershipType = "VIP_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.AddRange(kfhBar, vipBar);
        await setup.Context.SaveChangesAsync();

        // 1. Maker initiates return from KFH and VIP to Turkey consignment
        var returnReq = await repo.InitiateTurkeyReturnWorkflowAsync(
            new List<string> { "KFH-RET-TEST-001", "VIP-RET-TEST-002" },
            "treasury-maker",
            "Consignment Rebalancing Agreement TR-2026",
            "Return unallocated bullion to Nadir custody");

        Assert.NotNull(returnReq);
        Assert.Equal("PENDING_APPROVAL", returnReq.StatusCode);
        Assert.Equal(2, returnReq.TotalItems);
        Assert.Equal("MIXED", returnReq.SourceOwnership);

        // 2. Checker approves return
        var approveResult = await repo.ApproveTurkeyReturnAsync(returnReq.PendingReturnId, "treasury-checker");
        Assert.Equal("SUCCESS", approveResult);

        // 3. Verify bars reverted to TURKEY_OWNED
        var bar1 = await setup.Context.InventoryItems.FindAsync(kfhBar.ItemId);
        var bar2 = await setup.Context.InventoryItems.FindAsync(vipBar.ItemId);
        Assert.NotNull(bar1);
        Assert.NotNull(bar2);
        Assert.Equal("TURKEY_OWNED", bar1.OwnershipType);
        Assert.Equal("TURKEY_OWNED", bar2.OwnershipType);
        Assert.Equal("READY", bar1.StatusCode);
        Assert.Equal("READY", bar2.StatusCode);

        // 4. Verify in Turkey inventory list and excluded from KFH / VIP lists
        var turkeyItems = (await repo.GetTurkeyInventoryAsync()).ToList();
        Assert.Contains(turkeyItems, i => i.SerialNumber == "KFH-RET-TEST-001");
        Assert.Contains(turkeyItems, i => i.SerialNumber == "VIP-RET-TEST-002");

        var vipItems = (await repo.GetVipInventoryAsync()).ToList();
        Assert.DoesNotContain(vipItems, i => i.SerialNumber == "VIP-RET-TEST-002");

        var kfhItems = (await repo.GetKfhAvailableInventoryAsync()).ToList();
        Assert.DoesNotContain(kfhItems, i => i.SerialNumber == "KFH-RET-TEST-001");
    }

    [Fact]
    public async Task MissingItemsWorkflow_InitiateAndApprove_ReducesTurkeyBalance()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        // Setup workflow template for MISSING_ITEMS
        var missingWf = new WorkflowTemplate { WorkflowType = "MISSING_ITEMS", Name = "Missing Items", Description = "Missing Items Workflow", IsActive = true };
        setup.Context.WorkflowTemplates.Add(missingWf);
        await setup.Context.SaveChangesAsync();

        var step1 = new WorkflowStep { TemplateId = missingWf.TemplateId, StepOrder = 1, StepName = "Maker Request", RequiredRole = "Operations Maker", Description = "Maker submit" };
        var step2 = new WorkflowStep { TemplateId = missingWf.TemplateId, StepOrder = 2, StepName = "Checker Approval", RequiredRole = "Operations Checker", Description = "Checker approve" };
        setup.Context.WorkflowSteps.AddRange(step1, step2);
        await setup.Context.SaveChangesAsync();

        var product = await setup.Context.MetalProducts.FirstAsync();
        var lot = new InventoryLot
        {
            LotId = 10,
            LotNumber = "LOT-TURKEY-MISSING-TEST-01",
            VendorId = 1,
            TotalItems = 3,
            AverageUnitCost = 15000,
            CreatedAt = DateTime.UtcNow
        };
        setup.Context.InventoryLots.Add(lot);

        var items = new List<InventoryItem>
        {
            new InventoryItem
            {
                ProductId = product.ProductId,
                LotId = lot.LotId,
                LocationId = 1,
                SerialNumber = "TR-MISS-001",
                OwnershipType = "TURKEY_OWNED",
                StatusCode = "READY"
            },
            new InventoryItem
            {
                ProductId = product.ProductId,
                LotId = lot.LotId,
                LocationId = 1,
                SerialNumber = "TR-MISS-002",
                OwnershipType = "TURKEY_OWNED",
                StatusCode = "READY"
            },
            new InventoryItem
            {
                ProductId = product.ProductId,
                LotId = lot.LotId,
                LocationId = 1,
                SerialNumber = "TR-MISS-003",
                OwnershipType = "TURKEY_OWNED",
                StatusCode = "READY"
            }
        };
        setup.Context.InventoryItems.AddRange(items);

        var initialBalance = new InventoryBalance
        {
            ProductId = product.ProductId,
            LocationId = 1,
            OwnershipType = "TURKEY_OWNED",
            ReadyForSaleQty = 3
        };
        setup.Context.InventoryBalances.Add(initialBalance);
        await setup.Context.SaveChangesAsync();

        // 1. Initiate Missing Items report for 2 items: TR-MISS-001 and TR-MISS-002
        var pendingReport = await repo.InitiateMissingItemsWorkflowAsync(
            new List<string> { "TR-MISS-001", "TR-MISS-002" },
            "treasury-maker",
            "Discrepancy at Nadir Vault hand-off",
            "Lot box arrived with seal intact but missing 2 bars inside sleeve",
            lot.LotId,
            "TURKEY_OWNED");

        Assert.NotNull(pendingReport);
        Assert.Equal("PENDING_APPROVAL", pendingReport.StatusCode);
        Assert.Equal(2, pendingReport.TotalItems);
        Assert.Equal(2000m, pendingReport.TotalWeightGrams);
        Assert.Equal(lot.LotId, pendingReport.LotId);

        // Check workflow instance created
        var wf = await setup.Context.WorkflowInstances
            .FirstOrDefaultAsync(w => w.WorkflowType == "MISSING_ITEMS" && w.EntityId == pendingReport.PendingReportId);
        Assert.NotNull(wf);
        Assert.Equal("PENDING_MAKER", wf.StatusCode);

        // 2. Checker approves the Missing Items report
        var approveRes = await repo.ApproveMissingItemsAsync(pendingReport.PendingReportId, "treasury-checker");
        Assert.Equal("SUCCESS", approveRes);

        // 3. Verify items status transitioned to MISSING
        var item1 = await setup.Context.InventoryItems.FirstOrDefaultAsync(i => i.SerialNumber == "TR-MISS-001");
        var item2 = await setup.Context.InventoryItems.FirstOrDefaultAsync(i => i.SerialNumber == "TR-MISS-002");
        var item3 = await setup.Context.InventoryItems.FirstOrDefaultAsync(i => i.SerialNumber == "TR-MISS-003");
        Assert.NotNull(item1);
        Assert.NotNull(item2);
        Assert.NotNull(item3);
        Assert.Equal("MISSING", item1.StatusCode);
        Assert.Equal("MISSING", item2.StatusCode);
        Assert.Equal("READY", item3.StatusCode);

        // 4. Verify Turkey available stock excludes missing items
        var turkeyStock = (await repo.GetTurkeyInventoryAsync()).ToList();
        Assert.DoesNotContain(turkeyStock, i => i.SerialNumber == "TR-MISS-001");
        Assert.DoesNotContain(turkeyStock, i => i.SerialNumber == "TR-MISS-002");
        Assert.Contains(turkeyStock, i => i.SerialNumber == "TR-MISS-003");

        // 5. Verify Turkey missing items list includes missing items
        var missingStock = (await repo.GetTurkeyMissingItemsAsync()).ToList();
        Assert.Contains(missingStock, i => i.SerialNumber == "TR-MISS-001");
        Assert.Contains(missingStock, i => i.SerialNumber == "TR-MISS-002");
        Assert.DoesNotContain(missingStock, i => i.SerialNumber == "TR-MISS-003");

        // 6. Verify Turkey inventory balance was decremented from 3 to 1
        var updatedBalance = await setup.Context.InventoryBalances
            .FirstOrDefaultAsync(b => b.ProductId == product.ProductId && b.LocationId == 1 && b.OwnershipType == "TURKEY_OWNED");
        Assert.NotNull(updatedBalance);
        Assert.Equal(1, updatedBalance.ReadyForSaleQty);

        // 7. Verify audit transaction
        var txs = await setup.Context.InventoryTransactions
            .Where(t => t.TransactionType == "ADJUSTMENT")
            .ToListAsync();
        Assert.Equal(2, txs.Count);
    }

    [Fact]
    public async Task MissingItemsWorkflow_RejectOrInvalidSerials_HandledSafely()
    {
        using var setup = CreateContext();
        await DbSeeder.SeedAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        // 1. Validation test: Non-existent serial should throw InvalidOperationException
        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateMissingItemsWorkflowAsync(
                new List<string> { "NON_EXISTENT_SERIAL_999" },
                "treasury-maker",
                "Reason",
                null,
                null,
                "TURKEY_OWNED");
        });

        // 2. Rejection test
        var product = await setup.Context.MetalProducts.FirstAsync();
        var vendor = await setup.Context.Vendors.FirstAsync();
        var lot = new InventoryLot
        {
            LotNumber = "LOT-TURKEY-REJECT-01",
            VendorId = vendor.VendorId,
            TotalItems = 1,
            AverageUnitCost = 15000,
            CreatedAt = DateTime.UtcNow
        };
        setup.Context.InventoryLots.Add(lot);
        await setup.Context.SaveChangesAsync();

        var item = new InventoryItem
        {
            ProductId = product.ProductId,
            LotId = lot.LotId,
            LocationId = 1,
            SerialNumber = "TR-REJECT-001",
            OwnershipType = "TURKEY_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.Add(item);
        await setup.Context.SaveChangesAsync();

        var pendingReport = await repo.InitiateMissingItemsWorkflowAsync(
            new List<string> { "TR-REJECT-001" },
            "treasury-maker",
            "Counting mistake check",
            null,
            null,
            "TURKEY_OWNED");

        var wf = await setup.Context.WorkflowInstances
            .FirstAsync(w => w.WorkflowType == "MISSING_ITEMS" && w.EntityId == pendingReport.PendingReportId);

        // Act: Reject workflow
        var res = await repo.ProcessWorkflowActionAsync(wf.InstanceId, "treasury-maker", "REJECTED", "Found bars in second tray");
        Assert.Equal("SUCCESS", res);

        // Verify status is REJECTED and item remains READY
        var updatedReport = await setup.Context.PendingMissingItemReports.FindAsync(pendingReport.PendingReportId);
        Assert.NotNull(updatedReport);
        Assert.Equal("REJECTED", updatedReport.StatusCode);

        var refreshedItem = await setup.Context.InventoryItems.FindAsync(item.ItemId);
        Assert.NotNull(refreshedItem);
        Assert.Equal("READY", refreshedItem.StatusCode);
    }

    [Fact]
    public async Task TestInventoryHierarchyDrillDownAndInTransitCustody()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        // Seed 3 items with known denominations & weights
        // Item 1: Gold 1kg (1000g = 1.0 kg), KFH_OWNED, Main Vault
        // Item 2: Gold 100g (100g = 0.1 kg), KFH_OWNED, IN_TRANSFER (In Transit with Courier)
        // Item 3: Silver 1kg (1000g = 1.0 kg), TURKEY_OWNED, Main Vault
        var silverProd = new MetalProduct { ProductId = 2, ProductCode = "AG-1KG-VAL", MetalTypeId = 2, DenominationId = 1, PurityId = 1, OriginCountry = "Switzerland" };
        setup.Context.MetalProducts.Add(silverProd);
        await setup.Context.SaveChangesAsync();

        var lot = new InventoryLot { LotNumber = "LOT-HIERARCHY-01", VendorId = 1, AcquisitionDate = DateTime.UtcNow };
        setup.Context.InventoryLots.Add(lot);
        await setup.Context.SaveChangesAsync();

        var itemKfhVault = new InventoryItem
        {
            SerialNumber = "HIER-KFH-01",
            ProductId = 1, // 1000g Gold
            LotId = lot.LotId,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY",
            RowVersion = new byte[8]
        };
        var itemKfhTransit = new InventoryItem
        {
            SerialNumber = "HIER-KFH-02",
            ProductId = 1, // 1000g Gold
            LotId = lot.LotId,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "IN_TRANSFER",
            RowVersion = new byte[8]
        };
        var itemTurkeyVault = new InventoryItem
        {
            SerialNumber = "HIER-TR-01",
            ProductId = 2, // 1000g Silver
            LotId = lot.LotId,
            LocationId = 1,
            OwnershipType = "TURKEY_OWNED",
            StatusCode = "READY",
            RowVersion = new byte[8]
        };
        setup.Context.InventoryItems.AddRange(itemKfhVault, itemKfhTransit, itemTurkeyVault);
        await setup.Context.SaveChangesAsync();

        // Add an active BranchTransfer with courier
        var transfer = new BranchTransfer
        {
            ItemId = itemKfhTransit.ItemId,
            SourceBranchId = 1,
            DestinationBranchId = 2,
            CourierInfo = "KFH Armored Express Logistics",
            StatusCode = "IN_TRANSIT",
            CreatedBy = "treasury-maker",
            CreatedAt = DateTime.UtcNow
        };
        setup.Context.BranchTransfers.Add(transfer);
        await setup.Context.SaveChangesAsync();

        var rateFeedMock = new RateFeedService();
        var controller = new PMIMSControllers(
            repo, null!, null!, rateFeedMock, null!, null!, null!, null!, null!, null!, null!
        );

        // Execute GetInventoryHierarchy
        var result = await controller.GetInventoryHierarchy(null, null) as OkObjectResult;
        var val = result!.Value!;
        var totalWeight = (decimal)GetPropValue(val, "total_weight_kg");
        var inTransitWeight = (decimal)GetPropValue(val, "total_in_transit_weight_kg");

        Assert.True(totalWeight >= 2.000m);
        Assert.True(inTransitWeight >= 1.000m);

        var hierarchy = (IEnumerable<object>)GetPropValue(val, "hierarchy");
        var kfhGroup = hierarchy.FirstOrDefault(h => (string)GetPropValue(h, "owner_code") == "KFH_OWNED");
        Assert.NotNull(kfhGroup);
        var kfhWeight = (decimal)GetPropValue(kfhGroup!, "total_weight_kg");
        var kfhTransit = (decimal)GetPropValue(kfhGroup!, "in_transit_weight_kg");
        Assert.True(kfhWeight >= 2.000m);
        Assert.True(kfhTransit >= 1.000m);

        var metals = (IEnumerable<object>)GetPropValue(kfhGroup!, "metals");
        var goldMetal = metals.FirstOrDefault(m => (string)GetPropValue(m, "metal_name") == "Gold");
        Assert.NotNull(goldMetal);

        var locations = (IEnumerable<object>)GetPropValue(goldMetal!, "locations");
        var transitLoc = locations.FirstOrDefault(l => (bool)GetPropValue(l, "is_in_transit") == true);
        Assert.NotNull(transitLoc);
        var transitLabel = (string)GetPropValue(transitLoc!, "location_label");
        Assert.Contains("Courier: KFH Armored Express Logistics", transitLabel);
    }

    private async Task SeedIntakeWorkflowAsync(AppDbContext context)
    {
        var intakeWorkflow = new WorkflowTemplate
        {
            WorkflowType = "INTAKE_SHIPMENT",
            Name = "Intake Workflow",
            Description = "Intake verification",
            IsActive = true
        };
        context.WorkflowTemplates.Add(intakeWorkflow);
        await context.SaveChangesAsync();

        var step1 = new WorkflowStep
        {
            TemplateId = intakeWorkflow.TemplateId,
            StepOrder = 1,
            StepName = "Intake Verification",
            RequiredRole = "Treasury Operations (Maker)",
            Description = "Verify serials"
        };
        var step2 = new WorkflowStep
        {
            TemplateId = intakeWorkflow.TemplateId,
            StepOrder = 2,
            StepName = "Intake Checker Authorization",
            RequiredRole = "Treasury Operations (Checker)",
            Description = "Checker authorization"
        };
        context.WorkflowSteps.AddRange(step1, step2);
        await context.SaveChangesAsync();

        var groupMaker = new PrivilegeGroup { GroupName = "Treasury Operations (Maker)", Description = "Maker group", IsSystem = true };
        var groupChecker = new PrivilegeGroup { GroupName = "Treasury Operations (Checker)", Description = "Checker group", IsSystem = true };
        context.PrivilegeGroups.AddRange(groupMaker, groupChecker);
        await context.SaveChangesAsync();

        var makerUser = new AppUser { Username = "treasury-maker", DisplayName = "Treasury Maker", Email = "maker@test.com", PasswordHash = "hash" };
        var checkerUser = new AppUser { Username = "treasury-checker", DisplayName = "Treasury Checker", Email = "checker@test.com", PasswordHash = "hash" };
        context.AppUsers.AddRange(makerUser, checkerUser);
        await context.SaveChangesAsync();

        context.UserGroupMemberships.AddRange(
            new UserGroupMembership { UserId = makerUser.UserId, GroupId = groupMaker.GroupId, AssignedBy = "TEST" },
            new UserGroupMembership { UserId = checkerUser.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" }
        );
        await context.SaveChangesAsync();
    }

    [Fact]
    public async Task TestMakerSerialValidation_RejectsDuplicatesSynchronously()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        await SeedIntakeWorkflowAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        // 1. Duplicate within batch should fail at Maker submission
        string dupBatchSerials = "[{\"serial\":\"DUP-BATCH-01\",\"product_id\":1},{\"serial\":\"DUP-BATCH-01\",\"product_id\":1}]";
        string prodCosts = "[{\"metalTypeId\":1,\"denominationId\":1,\"productionCostKwd\":15.500}]";

        var ex1 = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateWorkflowIntakeAsync(
                null, "LOT-FAIL-DUP-01", 1, "treasury-maker", dupBatchSerials,
                sourceType: "SUPPLIER", vendorId: 1, productionCostsJson: prodCosts);
        });
        Assert.Contains("Duplicate serial number", ex1.Message);

        // 2. Duplicate against existing inventory should fail at Maker submission
        var existingItem = new InventoryItem
        {
            SerialNumber = "EXISTING-VAULT-BAR-99",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.Add(existingItem);
        await setup.Context.SaveChangesAsync();

        string existingDupSerials = "[{\"serial\":\"EXISTING-VAULT-BAR-99\",\"product_id\":1}]";
        var ex2 = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateWorkflowIntakeAsync(
                null, "LOT-FAIL-DUP-02", 1, "treasury-maker", existingDupSerials,
                sourceType: "SUPPLIER", vendorId: 1, productionCostsJson: prodCosts);
        });
        Assert.Contains("already exists in inventory records", ex2.Message);

        // 3. Duplicate against in-flight pending intake should fail at Maker submission
        string validSerials1 = "[{\"serial\":\"INFLIGHT-BAR-01\",\"product_id\":1}]";
        var pending1 = await repo.InitiateWorkflowIntakeAsync(
            null, "LOT-INFLIGHT-01", 1, "treasury-maker", validSerials1,
            sourceType: "SUPPLIER", vendorId: 1, productionCostsJson: prodCosts);
        Assert.NotNull(pending1);

        string inflightDupSerials = "[{\"serial\":\"INFLIGHT-BAR-01\",\"product_id\":1}]";
        var ex3 = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateWorkflowIntakeAsync(
                null, "LOT-FAIL-DUP-03", 1, "treasury-maker", inflightDupSerials,
                sourceType: "SUPPLIER", vendorId: 1, productionCostsJson: prodCosts);
        });
        Assert.Contains("already pending approval in another intake request", ex3.Message);
    }

    [Fact]
    public async Task TestShipmentProductionCost_MandatoryAndPerShipmentVariation()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        await SeedIntakeWorkflowAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        // 1. Missing / 0 production cost in KWD should fail
        string serialsJson1 = "[{\"serial\":\"SHIP-COST-BAR-01\",\"product_id\":1}]";
        string zeroCosts = "[{\"metalTypeId\":1,\"denominationId\":1,\"productionCostKwd\":0}]";

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateWorkflowIntakeAsync(
                null, "LOT-COST-ZERO", 1, "treasury-maker", serialsJson1,
                sourceType: "SUPPLIER", vendorId: 1, productionCostsJson: zeroCosts);
        });
        Assert.Contains("Mandatory Production Cost in KWD is required", ex.Message);

        // 2. Shipment A with Production Cost = 12.500 KWD
        string validCostsA = "[{\"metalTypeId\":1,\"denominationId\":1,\"productionCostKwd\":12.500}]";
        var pendingA = await repo.InitiateWorkflowIntakeAsync(
            null, "LOT-SHIPMENT-A", 1, "treasury-maker", serialsJson1,
            sourceType: "SUPPLIER", vendorId: 1, shipmentReference: "SHIP-REF-2026-A",
            productionCostsJson: validCostsA);
        Assert.NotNull(pendingA);

        var costRecordsA = (await repo.GetShipmentProductionCostsAsync(pendingIntakeId: pendingA.PendingIntakeId)).ToList();
        Assert.Single(costRecordsA);
        Assert.Equal(12.500m, costRecordsA[0].ProductionCostKwd);
        Assert.Equal("SHIP-REF-2026-A", costRecordsA[0].ShipmentReference);

        // 3. Shipment B with SAME metal type & denomination, but DIFFERENT Production Cost = 18.750 KWD
        string serialsJson2 = "[{\"serial\":\"SHIP-COST-BAR-02\",\"product_id\":1}]";
        string validCostsB = "[{\"metalTypeId\":1,\"denominationId\":1,\"productionCostKwd\":18.750}]";
        var pendingB = await repo.InitiateWorkflowIntakeAsync(
            null, "LOT-SHIPMENT-B", 1, "treasury-maker", serialsJson2,
            sourceType: "SUPPLIER", vendorId: 1, shipmentReference: "SHIP-REF-2026-B",
            productionCostsJson: validCostsB);
        Assert.NotNull(pendingB);

        var costRecordsB = (await repo.GetShipmentProductionCostsAsync(pendingIntakeId: pendingB.PendingIntakeId)).ToList();
        Assert.Single(costRecordsB);
        Assert.Equal(18.750m, costRecordsB[0].ProductionCostKwd);
        Assert.Equal("SHIP-REF-2026-B", costRecordsB[0].ShipmentReference);

        // 4. Checker approves Shipment A
        var instances = await repo.GetActiveWorkflowInstancesAsync();
        var wfA = instances.First(i => i.WorkflowType == "INTAKE_SHIPMENT" && i.EntityId == pendingA.PendingIntakeId);
        
        // Pass step 1 (Maker verification) and step 2 (Checker authorization)
        await repo.ProcessWorkflowActionAsync(wfA.InstanceId, "treasury-maker", "APPROVED", "Maker docs verified");
        await repo.ProcessWorkflowActionAsync(wfA.InstanceId, "treasury-checker", "APPROVED", "Checker authorized intake");

        // Verify bar from Shipment A has stamped ProductionCostKwd = 12.500
        var itemA = await setup.Context.InventoryItems.FirstOrDefaultAsync(i => i.SerialNumber == "SHIP-COST-BAR-01");
        Assert.NotNull(itemA);
        Assert.Equal(12.500m, itemA.ProductionCostKwd);

        // 5. Checker approves Shipment B
        var instancesAfter = await repo.GetActiveWorkflowInstancesAsync();
        var wfB = instancesAfter.First(i => i.WorkflowType == "INTAKE_SHIPMENT" && i.EntityId == pendingB.PendingIntakeId);
        await repo.ProcessWorkflowActionAsync(wfB.InstanceId, "treasury-maker", "APPROVED", "Maker docs verified");
        await repo.ProcessWorkflowActionAsync(wfB.InstanceId, "treasury-checker", "APPROVED", "Checker authorized intake");

        // Verify bar from Shipment B has stamped ProductionCostKwd = 18.750
        var itemB = await setup.Context.InventoryItems.FirstOrDefaultAsync(i => i.SerialNumber == "SHIP-COST-BAR-02");
        Assert.NotNull(itemB);
        Assert.Equal(18.750m, itemB.ProductionCostKwd);
    }

    // =========================================================================
    // Requirement 3 & 4 Tests: QR Printing & Damaged-Bar Replacement
    // =========================================================================

    [Fact]
    public async Task TestQrPrinting_SingleAndBatchManualPrinting_LogsChainOfCustodyAndAuditTrail()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        var item1 = new InventoryItem
        {
            SerialNumber = "QR-BAR-TEST-01",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY"
        };
        var item2 = new InventoryItem
        {
            SerialNumber = "QR-BAR-TEST-02",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.AddRange(item1, item2);
        await setup.Context.SaveChangesAsync();

        // 1. Initial unprinted check
        var unprinted = (await repo.GetUnprintedMainVaultBarsAsync()).ToList();
        Assert.Contains(unprinted, i => i.SerialNumber == "QR-BAR-TEST-01");
        Assert.Contains(unprinted, i => i.SerialNumber == "QR-BAR-TEST-02");

        // 2. Single QR print
        var printLog = await repo.RecordQrPrintAsync(item1.ItemId, "INITIAL_SINGLE", "treasury-maker", "New inbound bar");
        Assert.NotNull(printLog);
        Assert.Equal("INITIAL_SINGLE", printLog.PrintType);
        Assert.Equal("QR-BAR-TEST-01", printLog.SerialNumber);

        // Verify chain of custody for single print
        var item1Events = (await repo.GetChainOfCustodyEventsAsync(item1.ItemId)).ToList();
        Assert.Contains(item1Events, e => e.EventType == "LABEL_PRINTED");

        // 3. Batch QR print
        var batchLogs = (await repo.RecordBatchQrPrintAsync(new List<int> { item2.ItemId }, "INITIAL_BATCH", "treasury-maker")).ToList();
        Assert.Single(batchLogs);
        Assert.Equal("INITIAL_BATCH", batchLogs[0].PrintType);

        // 4. Unprinted list should now exclude both printed bars
        var unprintedAfter = (await repo.GetUnprintedMainVaultBarsAsync()).ToList();
        Assert.DoesNotContain(unprintedAfter, i => i.SerialNumber == "QR-BAR-TEST-01");
        Assert.DoesNotContain(unprintedAfter, i => i.SerialNumber == "QR-BAR-TEST-02");
    }

    [Fact]
    public async Task TestQrReprinting_MakerCheckerWorkflow_AllowsReprintAndPreventsSelfApproval()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        var item = new InventoryItem
        {
            SerialNumber = "QR-REPRINT-BAR-01",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.Add(item);
        await setup.Context.SaveChangesAsync();

        // 1. Maker initiates reprint request
        var pending = await repo.InitiateQrReprintAsync("SINGLE", new List<int> { item.ItemId }, "Label scratched during audit", "https://docs.kfh.com/evidence1.pdf", "treasury-maker");
        Assert.NotNull(pending);
        Assert.Equal("PENDING_APPROVAL", pending.Status);
        Assert.Equal(1, pending.ItemCount);

        // 2. Maker cannot self-approve
        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.ApproveQrReprintAsync(pending.ReprintRequestId, "treasury-maker");
        });

        // 3. Checker approves reprint
        var approveResult = await repo.ApproveQrReprintAsync(pending.ReprintRequestId, "treasury-checker");
        Assert.Equal("SUCCESS", approveResult);

        var updatedPending = await setup.Context.PendingQrReprints.FindAsync(pending.ReprintRequestId);
        Assert.NotNull(updatedPending);
        Assert.Equal("APPROVED", updatedPending.Status);
        Assert.Equal("treasury-checker", updatedPending.ApprovedBy);

        // 4. Verify chain of custody logged LABEL_REPRINTED
        var events = (await repo.GetChainOfCustodyEventsAsync(item.ItemId)).ToList();
        Assert.Contains(events, e => e.EventType == "LABEL_REPRINTED" && e.Notes!.Contains("Label scratched during audit"));
    }

    [Fact]
    public async Task TestDamagedBarReplacement_KfhOwnedBar_SwapsOwnershipAndLinksSerials()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        // 1. Setup damaged KFH bar and pristine Turkey bar
        var damagedKfhBar = new InventoryItem
        {
            SerialNumber = "KFH-DAMAGED-BAR-01",
            ProductId = 1, // Gold 1kg
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY",
            IsDamaged = true,
            DamageApprovalStatus = "APPROVED"
        };
        var turkeyBar = new InventoryItem
        {
            SerialNumber = "TURKEY-PRISTINE-BAR-01",
            ProductId = 1, // Gold 1kg
            LotId = 1,
            LocationId = 1,
            OwnershipType = "TURKEY_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.AddRange(damagedKfhBar, turkeyBar);
        await setup.Context.SaveChangesAsync();

        // 2. Query eligible Turkey replacements
        var eligible = (await repo.GetEligibleTurkeyReplacementsAsync(damagedKfhBar.ItemId)).ToList();
        Assert.Contains(eligible, i => i.SerialNumber == "TURKEY-PRISTINE-BAR-01");

        // 3. Maker initiates replacement
        var replacement = await repo.InitiateDamagedBarReplacementAsync(
            damagedKfhBar.ItemId, turkeyBar.ItemId, "Corner dent during vault transfer", null, "treasury-maker");

        Assert.NotNull(replacement);
        Assert.Equal("PENDING_APPROVAL", replacement.Status);
        Assert.Equal("KFH_OWNED", replacement.DamagedOriginalOwner);

        // Verify Turkey bar locked
        var lockedTurkey = await setup.Context.InventoryItems.FindAsync(turkeyBar.ItemId);
        Assert.NotNull(lockedTurkey);
        Assert.Equal("RESERVED_FOR_REPLACEMENT", lockedTurkey.StatusCode);

        // 4. Maker cannot self-approve
        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.ApproveDamagedBarReplacementAsync(replacement.ReplacementId, "treasury-maker");
        });

        // 5. Checker approves replacement
        var result = await repo.ApproveDamagedBarReplacementAsync(replacement.ReplacementId, "treasury-checker");
        Assert.Equal("SUCCESS", result);

        // 6. Verify damaged bar became TURKEY_OWNED and linked to replacement
        var finalDamaged = await setup.Context.InventoryItems.FindAsync(damagedKfhBar.ItemId);
        Assert.NotNull(finalDamaged);
        Assert.Equal("TURKEY_OWNED", finalDamaged.OwnershipType);
        Assert.Equal("DAMAGED", finalDamaged.StatusCode);
        Assert.Equal(turkeyBar.ItemId, finalDamaged.ReplacedByItemId);
        Assert.NotNull(finalDamaged.ReplacementDate);

        // 7. Verify replacement bar became KFH_OWNED and linked to damaged
        var finalReplacement = await setup.Context.InventoryItems.FindAsync(turkeyBar.ItemId);
        Assert.NotNull(finalReplacement);
        Assert.Equal("KFH_OWNED", finalReplacement.OwnershipType);
        Assert.Equal("READY", finalReplacement.StatusCode);
        Assert.Equal(damagedKfhBar.ItemId, finalReplacement.ReplacesItemId);
        Assert.NotNull(finalReplacement.ReplacementDate);

        // 8. Verify Chain of Custody events on both bars
        var damagedCustody = (await repo.GetChainOfCustodyEventsAsync(damagedKfhBar.ItemId)).ToList();
        Assert.Contains(damagedCustody, e => e.EventType == "DAMAGE_EXCHANGE_OUT");

        var replacementCustody = (await repo.GetChainOfCustodyEventsAsync(turkeyBar.ItemId)).ToList();
        Assert.Contains(replacementCustody, e => e.EventType == "DAMAGE_EXCHANGE_IN");
    }

    [Fact]
    public async Task TestDamagedBarReplacement_CustomerOwnedBar_SwapsOwnershipRepointsHoldingAndLinksSerials()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        // 1. Setup Customer, Account, CustomerHolding with damaged bar
        var customer = new Customer
        {
            CustomerId = 101,
            CustomerName = "Sheikh Nasser Al-Sabah",
            CivilId = "285010112345",
            MobileNumber = "+96599112233"
        };
        var account = new CustomerAccount
        {
            AccountId = 201,
            CustomerId = 101,
            AccountNumber = "KFH-GOLD-ACC-9901"
        };
        var damagedCustomerBar = new InventoryItem
        {
            SerialNumber = "CUST-DAMAGED-BAR-99",
            ProductId = 1, // Gold 1kg
            LotId = 1,
            LocationId = 1,
            OwnershipType = "CUSTOMER_OWNED",
            CustomerAccountNumber = "KFH-GOLD-ACC-9901",
            StatusCode = "READY",
            IsDamaged = true,
            DamageApprovalStatus = "APPROVED"
        };
        var turkeyBar = new InventoryItem
        {
            SerialNumber = "TURKEY-REP-BAR-99",
            ProductId = 1, // Gold 1kg
            LotId = 1,
            LocationId = 1,
            OwnershipType = "TURKEY_OWNED",
            StatusCode = "READY"
        };
        setup.Context.Customers.Add(customer);
        setup.Context.CustomerAccounts.Add(account);
        setup.Context.InventoryItems.AddRange(damagedCustomerBar, turkeyBar);
        await setup.Context.SaveChangesAsync();

        var holding = new CustomerHolding
        {
            HoldingId = 301,
            CustomerId = 101,
            AccountId = 201,
            ItemId = damagedCustomerBar.ItemId,
            StatusCode = "HELD_IN_CUSTODY"
        };
        setup.Context.CustomerHoldings.Add(holding);
        await setup.Context.SaveChangesAsync();

        // 2. Maker initiates replacement
        var replacement = await repo.InitiateDamagedBarReplacementAsync(
            damagedCustomerBar.ItemId, turkeyBar.ItemId, "Customer reported deep scratch upon inspection", null, "treasury-maker");

        Assert.Equal("CUSTOMER_OWNED", replacement.DamagedOriginalOwner);
        Assert.Equal(101, replacement.CustomerId);
        Assert.Equal(201, replacement.AccountId);

        // 3. Checker approves
        var result = await repo.ApproveDamagedBarReplacementAsync(replacement.ReplacementId, "treasury-checker");
        Assert.Equal("SUCCESS", result);

        // 4. Verify customer holding repointed to replacement bar
        var updatedHolding = await setup.Context.CustomerHoldings.FindAsync(holding.HoldingId);
        Assert.NotNull(updatedHolding);
        Assert.Equal(turkeyBar.ItemId, updatedHolding.ItemId);

        // 5. Verify replacement bar ownership is CUSTOMER_OWNED with customer account stamped
        var finalReplacement = await setup.Context.InventoryItems.FindAsync(turkeyBar.ItemId);
        Assert.NotNull(finalReplacement);
        Assert.Equal("CUSTOMER_OWNED", finalReplacement.OwnershipType);
        Assert.Equal("HELD_IN_CUSTODY", finalReplacement.StatusCode);
        Assert.Equal("KFH-GOLD-ACC-9901", finalReplacement.CustomerAccountNumber);
        Assert.Equal(damagedCustomerBar.ItemId, finalReplacement.ReplacesItemId);

        // 6. Verify damaged bar became TURKEY_OWNED
        var finalDamaged = await setup.Context.InventoryItems.FindAsync(damagedCustomerBar.ItemId);
        Assert.NotNull(finalDamaged);
        Assert.Equal("TURKEY_OWNED", finalDamaged.OwnershipType);
        Assert.Equal("DAMAGED", finalDamaged.StatusCode);
        Assert.Equal(turkeyBar.ItemId, finalDamaged.ReplacedByItemId);
    }

    [Fact]
    public async Task TestDamagedBarReplacement_MismatchWeightOrMetal_RejectsReplacement()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        var dSilver1kg = new MetalDenomination { DenominationId = 2, Label = "1kg Silver Bar", WeightGrams = 1000.0m, WeightOunces = 32.1507m, MetalTypeId = 2 };
        var pSilver = new MetalProduct { ProductId = 2, ProductCode = "AG-1KG-SWISS", MetalTypeId = 2, DenominationId = 2, PurityId = 1, OriginCountry = "Switzerland" };
        setup.Context.MetalDenominations.Add(dSilver1kg);
        setup.Context.MetalProducts.Add(pSilver);
        await setup.Context.SaveChangesAsync();

        // Setup Gold 1kg bar and Silver 1kg bar
        var goldDamagedBar = new InventoryItem
        {
            SerialNumber = "GOLD-DAMAGED-01",
            ProductId = 1, // Gold 1kg
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY"
        };
        var silverTurkeyBar = new InventoryItem
        {
            SerialNumber = "SILVER-TURKEY-01",
            ProductId = 2, // Silver 1kg (different metal)
            LotId = 1,
            LocationId = 1,
            OwnershipType = "TURKEY_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.AddRange(goldDamagedBar, silverTurkeyBar);
        await setup.Context.SaveChangesAsync();

        // Mismatched metal should be rejected
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateDamagedBarReplacementAsync(goldDamagedBar.ItemId, silverTurkeyBar.ItemId, "Exchange attempt", null, "treasury-maker");
        });
        Assert.Contains("Metal type mismatch", ex.Message);
    }

    // =========================================================================
    // Requirement 6: Damaged Gold High-Stock Alert & Manufacturer Export Tests
    // =========================================================================

    [Fact]
    public async Task TestDamagedHighStockAlert_UnderAndOverThreshold_CalculatesCorrectly()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        // 1. Configure Damaged Gold High-Stock threshold: 3.000 KG
        await repo.SaveReorderThresholdAsync(
            thresholdId: null,
            productId: null,
            vendorId: 1,
            minStockQty: 0,
            maxStockQty: null,
            reorderQty: 0,
            isActive: true,
            thresholdType: "DAMAGED_HIGH_STOCK",
            metalTypeId: 1,
            thresholdWeightKg: 3.0m
        );

        // 2. Add 2 damaged gold bars (1kg each = 2.000 KG total) -> below 3.000 KG threshold
        var bar1 = new InventoryItem
        {
            SerialNumber = "DAM-GOLD-001",
            ProductId = 1, // 1000g Gold
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "DAMAGED",
            IsDamaged = true,
            DamageReason = "DEEP_SCRATCH",
            DamageDescription = "Deep surface gouge found during intake",
            DamageApprovalStatus = "APPROVED",
            DamageApprovedBy = "treasury-checker"
        };
        var bar2 = new InventoryItem
        {
            SerialNumber = "DAM-GOLD-002",
            ProductId = 1, // 1000g Gold
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "DAMAGED",
            IsDamaged = true,
            DamageReason = "DEFORMITY",
            DamageDescription = "Corner edge chipped",
            DamageApprovalStatus = "APPROVED",
            DamageApprovedBy = "treasury-checker"
        };
        setup.Context.InventoryItems.AddRange(bar1, bar2);
        await setup.Context.SaveChangesAsync();

        // 3. Evaluate Damaged High-Stock Alert -> Should be NORMAL (2.000 KG < 3.000 KG)
        var alertsUnder = (await repo.GetDamagedHighStockAlertsAsync(1)).ToList();
        Assert.Single(alertsUnder);
        var goldAlertUnder = alertsUnder[0];
        Assert.Equal(1, goldAlertUnder.MetalTypeId);
        Assert.Equal("Gold", goldAlertUnder.MetalName);
        Assert.Equal(2000.0m, goldAlertUnder.TotalDamagedWeightGrams);
        Assert.Equal(2.0m, goldAlertUnder.TotalDamagedWeightKg);
        Assert.Equal(2, goldAlertUnder.TotalDamagedBarsCount);
        Assert.Equal(3.0m, goldAlertUnder.ThresholdWeightKg);
        Assert.False(goldAlertUnder.IsBreached);
        Assert.Equal("NORMAL", goldAlertUnder.AlertStatus);
        Assert.Equal(2, goldAlertUnder.CandidateBars.Count);

        // 4. Add 2 more damaged bars (1kg each -> Total 4.000 KG) -> breaches 3.000 KG threshold
        var bar3 = new InventoryItem
        {
            SerialNumber = "DAM-GOLD-003",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "DAMAGED",
            IsDamaged = true,
            DamageReason = "ASSAY_FLAW",
            DamageDescription = "Purity test variance",
            DamageApprovalStatus = "APPROVED",
            DamageApprovedBy = "treasury-checker"
        };
        var bar4 = new InventoryItem
        {
            SerialNumber = "DAM-GOLD-004",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "DAMAGED",
            IsDamaged = true,
            DamageReason = "SEAL_BROKEN",
            DamageDescription = "Protective blister packaging ripped",
            DamageApprovalStatus = "APPROVED",
            DamageApprovedBy = "treasury-checker"
        };
        setup.Context.InventoryItems.AddRange(bar3, bar4);
        await setup.Context.SaveChangesAsync();

        // 5. Evaluate Damaged High-Stock Alert -> Should be ALERT_BREACHED (4.000 KG >= 3.000 KG)
        var alertsOver = (await repo.GetDamagedHighStockAlertsAsync(1)).ToList();
        Assert.Single(alertsOver);
        var goldAlertOver = alertsOver[0];
        Assert.Equal(4000.0m, goldAlertOver.TotalDamagedWeightGrams);
        Assert.Equal(4.0m, goldAlertOver.TotalDamagedWeightKg);
        Assert.Equal(4, goldAlertOver.TotalDamagedBarsCount);
        Assert.True(goldAlertOver.IsBreached);
        Assert.Equal("ALERT_BREACHED", goldAlertOver.AlertStatus);
        Assert.Equal(1.0m, goldAlertOver.ExcessWeightKg);
        Assert.Contains("High-Stock Alert", goldAlertOver.Message);
        Assert.Equal(4, goldAlertOver.CandidateBars.Count);
        Assert.Contains(goldAlertOver.CandidateBars, c => c.SerialNumber == "DAM-GOLD-001");
        Assert.Contains(goldAlertOver.CandidateBars, c => c.SerialNumber == "DAM-GOLD-004");
    }

    [Fact]
    public async Task TestDamagedExportCandidates_AndGenerateManifest_TracksCustodyChain()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        // 1. Add damaged gold bars
        var bar1 = new InventoryItem
        {
            SerialNumber = "DAM-EXP-001",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "DAMAGED",
            IsDamaged = true,
            DamageReason = "IMPERFECTION",
            DamageApprovalStatus = "APPROVED"
        };
        var bar2 = new InventoryItem
        {
            SerialNumber = "DAM-EXP-002",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "DAMAGED",
            IsDamaged = true,
            DamageReason = "SURFACE_BLEMISH",
            DamageApprovalStatus = "APPROVED"
        };
        setup.Context.InventoryItems.AddRange(bar1, bar2);
        await setup.Context.SaveChangesAsync();

        // 2. Query export candidates for Gold (MetalTypeId = 1)
        var candidates = (await repo.GetDamagedExportCandidatesAsync(1)).ToList();
        Assert.Equal(2, candidates.Count);
        Assert.Contains(candidates, c => c.SerialNumber == "DAM-EXP-001");
        Assert.Contains(candidates, c => c.SerialNumber == "DAM-EXP-002");

        // 3. Generate manufacturer export manifest
        dynamic manifest = await repo.GenerateDamagedExportManifestAsync(
            metalTypeId: 1,
            vendorId: 1,
            itemIds: new List<int> { bar1.ItemId, bar2.ItemId },
            generatedBy: "treasury-maker",
            notes: "Damaged gold batch exported to Valcambi Suisse for re-smelting"
        );

        Assert.NotNull(manifest);
        string manifestNumber = manifest.manifest_number;
        Assert.StartsWith("MANIF-EXP-", manifestNumber);
        Assert.Equal(2, manifest.total_items_count);
        Assert.Equal(2.0m, manifest.total_weight_kg);

        // 4. Verify custody chain events recorded for both bars
        var custody1 = (await repo.GetChainOfCustodyEventsAsync(bar1.ItemId)).ToList();
        var exportEvent1 = custody1.FirstOrDefault(e => e.EventType == "EXPORT_MANIFEST_GENERATED");
        Assert.NotNull(exportEvent1);
        Assert.Equal(manifestNumber, exportEvent1.ReferenceNumber);
        Assert.Contains("Manufacturer Export Manifest", exportEvent1.Notes);
    }

    private async Task EnsureExportUsersAndGroupsAsync(AppDbContext context)
    {
        var grpMaker = await context.PrivilegeGroups.FirstOrDefaultAsync(g => g.GroupName == "Treasury Operations (Maker)");
        if (grpMaker == null)
        {
            grpMaker = new PrivilegeGroup { GroupName = "Treasury Operations (Maker)", Description = "Maker", IsSystem = true };
            context.PrivilegeGroups.Add(grpMaker);
        }
        var grpChecker = await context.PrivilegeGroups.FirstOrDefaultAsync(g => g.GroupName == "Treasury Operations (Checker)");
        if (grpChecker == null)
        {
            grpChecker = new PrivilegeGroup { GroupName = "Treasury Operations (Checker)", Description = "Checker", IsSystem = true };
            context.PrivilegeGroups.Add(grpChecker);
        }
        var grpSenior = await context.PrivilegeGroups.FirstOrDefaultAsync(g => g.GroupName == "Senior Treasury Manager");
        if (grpSenior == null)
        {
            grpSenior = new PrivilegeGroup { GroupName = "Senior Treasury Manager", Description = "Senior Manager", IsSystem = true };
            context.PrivilegeGroups.Add(grpSenior);
        }
        await context.SaveChangesAsync();

        var userMaker = await context.AppUsers.FirstOrDefaultAsync(u => u.Username == "treasury-maker");
        if (userMaker == null)
        {
            userMaker = new AppUser { Username = "treasury-maker", DisplayName = "Maker User", Email = "maker@kfh.com.kw", PasswordHash = "hash", CreatedBy = "SYSTEM" };
            context.AppUsers.Add(userMaker);
            await context.SaveChangesAsync();
            context.UserGroupMemberships.Add(new UserGroupMembership { UserId = userMaker.UserId, GroupId = grpMaker.GroupId, AssignedBy = "SYSTEM" });
        }

        var userChecker = await context.AppUsers.FirstOrDefaultAsync(u => u.Username == "treasury-checker");
        if (userChecker == null)
        {
            userChecker = new AppUser { Username = "treasury-checker", DisplayName = "Checker User", Email = "checker@kfh.com.kw", PasswordHash = "hash", CreatedBy = "SYSTEM" };
            context.AppUsers.Add(userChecker);
            await context.SaveChangesAsync();
            context.UserGroupMemberships.Add(new UserGroupMembership { UserId = userChecker.UserId, GroupId = grpChecker.GroupId, AssignedBy = "SYSTEM" });
        }

        var userSenior = await context.AppUsers.FirstOrDefaultAsync(u => u.Username == "treasury-manager");
        if (userSenior == null)
        {
            userSenior = new AppUser { Username = "treasury-manager", DisplayName = "Senior Manager", Email = "manager@kfh.com.kw", PasswordHash = "hash", CreatedBy = "SYSTEM" };
            context.AppUsers.Add(userSenior);
            await context.SaveChangesAsync();
            context.UserGroupMemberships.Add(new UserGroupMembership { UserId = userSenior.UserId, GroupId = grpSenior.GroupId, AssignedBy = "SYSTEM" });
        }

        await context.SaveChangesAsync();
    }

    [Fact]
    public async Task TestDamagedExport_PreExportValidations_EnforcesDamagedTurkeyOwnedAndNoActiveMovement()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        // 1. Bar not marked damaged -> rejected
        var nonDamagedBar = new InventoryItem
        {
            SerialNumber = "NON-DAM-TURK-01",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "TURKEY_OWNED",
            StatusCode = "READY",
            IsDamaged = false
        };
        setup.Context.InventoryItems.Add(nonDamagedBar);
        await setup.Context.SaveChangesAsync();

        var ex1 = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateDamagedExportAsync(nonDamagedBar.ItemId, "treasury-maker", "Export test", null, null);
        });
        Assert.Contains("must be marked as damaged", ex1.Message);

        // 2. Damaged bar but KFH_OWNED (not Turkey owned) -> rejected
        var kfhDamagedBar = new InventoryItem
        {
            SerialNumber = "DAM-KFH-01",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "DAMAGED",
            IsDamaged = true,
            DamageReason = "CRACKED"
        };
        setup.Context.InventoryItems.Add(kfhDamagedBar);
        await setup.Context.SaveChangesAsync();

        var ex2 = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateDamagedExportAsync(kfhDamagedBar.ItemId, "treasury-maker", "Export test", null, null);
        });
        Assert.Contains("Ownership must be KFH-Turkey", ex2.Message);

        // 3. Damaged Turkey bar but IN_TRANSFER -> rejected
        var inTransferBar = new InventoryItem
        {
            SerialNumber = "DAM-TURK-TRANSFER",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "TURKEY_OWNED",
            StatusCode = "IN_TRANSFER",
            IsDamaged = true,
            DamageReason = "SCRATCHED"
        };
        setup.Context.InventoryItems.Add(inTransferBar);
        await setup.Context.SaveChangesAsync();

        var ex3 = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateDamagedExportAsync(inTransferBar.ItemId, "treasury-maker", "Export test", null, null);
        });
        Assert.Contains("involved in an active movement", ex3.Message);
    }

    [Fact]
    public async Task TestDamagedExport_ThreeLevelWorkflow_MakerCheckerSeniorManager_AdvancesCorrectly()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        await EnsureExportUsersAndGroupsAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        var bar = new InventoryItem
        {
            SerialNumber = "DAM-TURK-3LVL-01",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "TURKEY_OWNED",
            StatusCode = "DAMAGED",
            IsDamaged = true,
            DamageReason = "HALLMARK_DEFECT"
        };
        setup.Context.InventoryItems.Add(bar);
        await setup.Context.SaveChangesAsync();

        // 1. Level 1: Maker initiates export
        var export = await repo.InitiateDamagedExportAsync(bar.ItemId, "treasury-maker", "Overseas export to Nadir Istanbul", 1, "BAYAN-2026-9901");
        Assert.NotNull(export);
        Assert.Equal("PENDING_APPROVAL", export.StatusCode);
        Assert.StartsWith("EXP-DMG-", export.ExportReference);

        // Verify bar is reserved/locked
        var lockedBar = await setup.Context.InventoryItems.FindAsync(bar.ItemId);
        Assert.Equal("RESERVED", lockedBar!.StatusCode);

        // Check workflow instance is at Step 2 (Checker)
        var wf = await setup.Context.WorkflowInstances.FirstOrDefaultAsync(w => w.WorkflowType == "DAMAGED_EXPORT" && w.EntityId == export.ExportId);
        Assert.NotNull(wf);
        Assert.Equal(2, wf.CurrentStepOrder);

        // 2. Level 2: Checker approves -> advances to Step 3 (Senior Manager)
        var checkAction = await repo.ProcessWorkflowActionAsync(wf.InstanceId, "treasury-checker", "APPROVE", "Checker verified Turkey serial and assay");
        Assert.Equal("SUCCESS", checkAction);

        var wfAfterChecker = await setup.Context.WorkflowInstances.FindAsync(wf.InstanceId);
        Assert.Equal(3, wfAfterChecker!.CurrentStepOrder);

        var exportAfterChecker = await setup.Context.PendingDamagedExports.FindAsync(export.ExportId);
        Assert.Equal("treasury-checker", exportAfterChecker!.CheckerApprovedBy);
        Assert.Equal("PENDING_APPROVAL", exportAfterChecker.StatusCode);

        // 3. Level 3: Senior Manager gives final authorization -> workflow completes
        var smAction = await repo.ProcessWorkflowActionAsync(wf.InstanceId, "treasury-manager", "APPROVE", "Senior Manager executive authorization granted");
        Assert.Equal("SUCCESS", smAction);

        var finalExport = await setup.Context.PendingDamagedExports.FindAsync(export.ExportId);
        Assert.Equal("APPROVED", finalExport!.StatusCode);
        Assert.Equal("treasury-manager", finalExport.SeniorManagerApprovedBy);
        Assert.NotNull(finalExport.ApprovedAt);
    }

    [Fact]
    public async Task TestDamagedExport_CourierHandover_SetsStatusToExportedAndLogsCustody()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        await EnsureExportUsersAndGroupsAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        var bar = new InventoryItem
        {
            SerialNumber = "DAM-TURK-COURIER-01",
            ProductId = 1,
            LotId = 1,
            LocationId = 1,
            OwnershipType = "TURKEY_OWNED",
            StatusCode = "DAMAGED",
            IsDamaged = true,
            DamageReason = "PURITY_DEVIATION"
        };
        setup.Context.InventoryItems.Add(bar);
        await setup.Context.SaveChangesAsync();

        // 1. Initiate and approve through 3 levels
        var export = await repo.InitiateDamagedExportAsync(bar.ItemId, "treasury-maker", "Return to refiner", 1, "BAYAN-1002");
        var wf = await setup.Context.WorkflowInstances.FirstOrDefaultAsync(w => w.WorkflowType == "DAMAGED_EXPORT" && w.EntityId == export.ExportId);
        await repo.ProcessWorkflowActionAsync(wf!.InstanceId, "treasury-checker", "APPROVE", "Checker ok");
        await repo.ProcessWorkflowActionAsync(wf.InstanceId, "treasury-manager", "APPROVE", "Manager ok");

        // 2. Courier handover
        var completedExport = await repo.HandoverDamagedExportToCourierAsync(
            exportId: export.ExportId,
            courierCompany: "Brinks Global Services",
            courierRep: "Tariq Al-Sabah",
            trackingNumber: "BGS-KW-889922",
            securitySeal: "SEAL-KFH-0909",
            handedOverBy: "treasury-maker",
            notes: "Handed over at Kuwait Airport cargo terminal"
        );

        Assert.Equal("EXPORTED", completedExport.StatusCode);
        Assert.Equal("Brinks Global Services", completedExport.CourierCompany);
        Assert.Equal("BGS-KW-889922", completedExport.CourierTrackingNumber);
        Assert.NotNull(completedExport.ExportedAt);

        // 3. Verify bar status changed to EXPORTED and LocationId cleared
        var exportedBar = await setup.Context.InventoryItems.FindAsync(bar.ItemId);
        Assert.Equal("EXPORTED", exportedBar!.StatusCode);
        Assert.Null(exportedBar.LocationId);

        // 4. Verify Chain of Custody Event
        var custodyEvents = (await repo.GetChainOfCustodyEventsAsync(bar.ItemId)).ToList();
        var handoverEvent = custodyEvents.FirstOrDefault(e => e.EventType == "COURIER_EXPORT_HANDOVER");
        Assert.NotNull(handoverEvent);
        Assert.Contains("Brinks Global Services", handoverEvent.Notes);
    }

    [Fact]
    public async Task TestExportedSerialNumber_CanBeReusedInNewShipment_WithDistinctItemId()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        string reusedSerial = "REUSED-GOLD-BAR-888";

        // 1. First bar with this serial number was received and later EXPORTED
        var historicalBar = new InventoryItem
        {
            SerialNumber = reusedSerial,
            ProductId = 1,
            LotId = 1,
            LocationId = null,
            OwnershipType = "TURKEY_OWNED",
            StatusCode = "EXPORTED",
            IsDamaged = true,
            DamageReason = "MOCI_ASSAY_FAIL"
        };
        setup.Context.InventoryItems.Add(historicalBar);
        await setup.Context.SaveChangesAsync();
        int historicalItemId = historicalBar.ItemId;

        // 2. Validate new supplier shipment intake containing the SAME serial number -> MUST PASS because previous was EXPORTED
        var valResult = await repo.ValidateIntakeSerialsAsync(
            serialNumbers: new List<string> { reusedSerial },
            sourceType: "SUPPLIER",
            productId: 1
        );

        Assert.True(valResult.IsValid);
        Assert.Empty(valResult.Errors);

        // 3. Intake the new shipment with the reused serial number
        string serialsJson = System.Text.Json.JsonSerializer.Serialize(new[]
        {
            new { serial = reusedSerial, product_id = 1, weight_grams = 1000m, purity = 999.9m }
        });

        string intakeResult = await repo.IntakeInventoryItemsAsync(
            poId: null,
            lotNumber: "LOT-REUSE-2026-01",
            locationId: 1,
            receivedBy: "treasury-maker",
            serialsJsonList: serialsJson,
            sourceType: "SUPPLIER",
            customerId: null,
            accountId: null,
            receiptReason: null,
            ownershipType: "KFH_OWNED"
        );

        Assert.Equal("SUCCESS", intakeResult);

        // 4. Verify new bar has its own distinct ItemId (Bar Record ID)
        var newlyReceivedBar = await setup.Context.InventoryItems.FirstOrDefaultAsync(i => i.SerialNumber == reusedSerial && i.StatusCode == "READY");
        Assert.NotNull(newlyReceivedBar);
        Assert.NotEqual(historicalItemId, newlyReceivedBar.ItemId);
        Assert.Equal(reusedSerial, newlyReceivedBar.SerialNumber);
        Assert.Equal("READY", newlyReceivedBar.StatusCode);
        Assert.Equal("KFH_OWNED", newlyReceivedBar.OwnershipType);

        // 5. Verify both historical and current bars exist independently in serial history query
        var fullHistory = (await repo.GetItemHistoryBySerialNumberAsync(reusedSerial)).ToList();
        Assert.Equal(2, fullHistory.Count);

        var activeRecord = fullHistory.FirstOrDefault(i => i.StatusCode == "READY");
        var historicalRecord = fullHistory.FirstOrDefault(i => i.StatusCode == "EXPORTED");

        Assert.NotNull(activeRecord);
        Assert.NotNull(historicalRecord);
        Assert.Equal(newlyReceivedBar.ItemId, activeRecord.ItemId);
        Assert.Equal(historicalItemId, historicalRecord.ItemId);
    }

    [Fact]
    public async Task Test_EnsureLiveDatabaseHasAllQrAndCustomsTables_AndCanRecordPrint()
    {
        var dbPath = @"D:\Projects\Gold2\backend\PMIMS.WebAPI\pmims.db";
        if (System.IO.File.Exists(dbPath))
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseSqlite($"Data Source={dbPath}")
                .Options;

            using var context = new AppDbContext(options);
            await DbSeeder.SeedAsync(context);

            var connection = context.Database.GetDbConnection();
            if (connection.State != System.Data.ConnectionState.Open)
                await connection.OpenAsync();

            using var cmd = connection.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM qr_print_logs;";
            var count = await cmd.ExecuteScalarAsync();
            Assert.NotNull(count);

            using var cmdReprint = connection.CreateCommand();
            cmdReprint.CommandText = "SELECT COUNT(*) FROM pending_qr_reprints;";
            var countReprint = await cmdReprint.ExecuteScalarAsync();
            Assert.NotNull(countReprint);
        }
    }

    [Fact]
    public async Task BranchTransfers_EnforcesCustomerOwnedOnly_And_SupportsReturnToVaultWorkflowWithReason()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

        var repo = new InventoryRepository(setup.Context);

        // 1. Setup Branch 2 (Fahaheel) and locations
        var branchFahaheel = new Branch { BranchCode = "FAHAHEEL", BranchName = "Fahaheel Branch", VaultId = 1 };
        setup.Context.Branches.Add(branchFahaheel);
        await setup.Context.SaveChangesAsync();

        var destLocBranch2 = new InventoryLocation
        {
            VaultId = 1,
            BranchId = branchFahaheel.BranchId,
            ZoneRoom = "Fahaheel Safe",
            ShelfRow = "Row 1",
            SlotBin = "Slot 1"
        };
        setup.Context.InventoryLocations.Add(destLocBranch2);

        // 2. Setup Workflow Template for Branch Transfers
        var transferWorkflow = new WorkflowTemplate
        {
            WorkflowType = "BRANCH_TRANSFER",
            Name = "Branch Transfer Workflow",
            Description = "Approval for transfers between vaults and branches.",
            IsActive = true
        };
        setup.Context.WorkflowTemplates.Add(transferWorkflow);
        await setup.Context.SaveChangesAsync();

        var step1 = new WorkflowStep
        {
            TemplateId = transferWorkflow.TemplateId,
            StepOrder = 1,
            StepName = "Checker Approval",
            RequiredRole = "Operations Checker",
            Description = "Review and approve metal movement."
        };
        setup.Context.WorkflowSteps.Add(step1);
        await setup.Context.SaveChangesAsync();

        // 3. Create a KFH_OWNED bar and verify that transferring it is blocked
        var kfhBar = new InventoryItem
        {
            ItemId = 7701,
            LotId = 1,
            ProductId = 1,
            LocationId = 1,
            SerialNumber = "KFH-PROP-BAR-001",
            StatusCode = "READY",
            OwnershipType = "KFH_OWNED"
        };
        setup.Context.InventoryItems.Add(kfhBar);
        await setup.Context.SaveChangesAsync();

        var exKfhDirect = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateBranchTransferAsync(kfhBar.ItemId, destLocBranch2.LocationId, "Secured Courier", "treasury-maker");
        });
        Assert.Contains("customer-owned bars only", exKfhDirect.Message, StringComparison.OrdinalIgnoreCase);

        var exKfhWf = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            await repo.InitiateWorkflowBranchTransferAsync(kfhBar.ItemId, branchFahaheel.BranchId, "Secured Courier", "treasury-maker");
        });
        Assert.Contains("customer-owned bars only", exKfhWf.Message, StringComparison.OrdinalIgnoreCase);

        // 4. Create a CUSTOMER_OWNED bar and initiate OUTBOUND transfer from Main Vault to Fahaheel Branch
        var customerBar = new InventoryItem
        {
            ItemId = 7702,
            LotId = 1,
            ProductId = 1,
            LocationId = 1, // Main Vault (Branch 1)
            SerialNumber = "CUST-GOLD-BAR-888",
            StatusCode = "READY",
            OwnershipType = "CUSTOMER_OWNED"
        };
        setup.Context.InventoryItems.Add(customerBar);
        await setup.Context.SaveChangesAsync();

        var outboundTransfer = await repo.InitiateWorkflowBranchTransferAsync(
            customerBar.ItemId,
            branchFahaheel.BranchId,
            "Armored Van #4",
            "treasury-maker",
            transferType: "OUTBOUND_TO_BRANCH",
            returnReason: null,
            notes: "Customer scheduled for pickup at Fahaheel"
        );

        Assert.NotNull(outboundTransfer);
        Assert.Equal("OUTBOUND_TO_BRANCH", outboundTransfer.TransferType);
        Assert.Equal("PENDING_APPROVAL", outboundTransfer.StatusCode);
        Assert.Equal("RESERVED", customerBar.StatusCode);

        // Approve outbound transfer
        var groupChecker = new PrivilegeGroup { GroupName = "Operations Checker", Description = "Checker group", IsSystem = true };
        setup.Context.PrivilegeGroups.Add(groupChecker);
        await setup.Context.SaveChangesAsync();

        var userChecker = new AppUser { Username = "branch-xfr-checker", DisplayName = "Transfer Checker", Email = "xfr-checker@test.local", PasswordHash = "test-hash" };
        setup.Context.AppUsers.Add(userChecker);
        await setup.Context.SaveChangesAsync();
        setup.Context.UserGroupMemberships.Add(new UserGroupMembership { UserId = userChecker.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" });
        await setup.Context.SaveChangesAsync();

        var activeInstances = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        var outboundWf = activeInstances.First(i => i.EntityId == outboundTransfer.TransferId && i.WorkflowType == "BRANCH_TRANSFER");
        var approveOutbound = await repo.ProcessWorkflowActionAsync(outboundWf.InstanceId, "branch-xfr-checker", "APPROVED", "Approved transfer to Fahaheel");
        Assert.Equal("SUCCESS", approveOutbound);

        // Receive at Fahaheel Branch
        var receiveOutbound = await repo.ReceiveBranchTransferAsync(outboundTransfer.TransferId, "fahaheel-vault-mgr");
        Assert.Equal("SUCCESS", receiveOutbound);
        Assert.Equal("READY", customerBar.StatusCode);
        Assert.Equal(destLocBranch2.LocationId, customerBar.LocationId);

        // 5. Customer did not pickup -> Initiate RETURN_TO_VAULT from Fahaheel Branch back to Main Vault
        var returnTransfer = await repo.InitiateWorkflowBranchTransferAsync(
            customerBar.ItemId,
            destinationBranchId: 1, // Main HO central vault
            courierInfo: "Armored Van #2",
            initiatedBy: "fahaheel-maker",
            transferType: "RETURN_TO_VAULT",
            returnReason: "Customer did not pickup within SLA (Unclaimed)",
            notes: "Customer failed to claim within 14 days, returning to Central Vault"
        );

        Assert.NotNull(returnTransfer);
        Assert.Equal("RETURN_TO_VAULT", returnTransfer.TransferType);
        Assert.Equal("Customer did not pickup within SLA (Unclaimed)", returnTransfer.ReturnReason);
        Assert.Equal(branchFahaheel.BranchId, returnTransfer.SourceBranchId);
        Assert.Equal(1, returnTransfer.DestinationBranchId);
        Assert.Equal("RESERVED", customerBar.StatusCode);

        // Approve return transfer
        var activeReturnInstances = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        var returnWf = activeReturnInstances.First(i => i.EntityId == returnTransfer.TransferId && i.WorkflowType == "BRANCH_TRANSFER");
        var approveReturn = await repo.ProcessWorkflowActionAsync(returnWf.InstanceId, "branch-xfr-checker", "APPROVED", "Approved return back to main vault");
        Assert.Equal("SUCCESS", approveReturn);

        // Receive return transfer at Main Central Vault
        var receiveReturn = await repo.ReceiveBranchTransferAsync(returnTransfer.TransferId, "main-vault-receptionist");
        Assert.Equal("SUCCESS", receiveReturn);
        Assert.Equal("RECEIVED", returnTransfer.StatusCode);
        Assert.Equal("READY", customerBar.StatusCode);
        Assert.Equal(1, customerBar.LocationId); // Successfully back in main vault location
    }

    [Fact]
    public async Task CustomerReceipt_CustodyDeposit_ValidatesPriorKfhHistory_AndTransfersToMainVaultByCourier()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);
        var repo = new InventoryRepository(setup.Context);

        // 1. Setup Customer and Account
        var cust = new Customer { CustomerId = 10, CustomerName = "Zaid Al-Kuwaiti", CivilId = "290010101010", Email = "zaid@test.local", MobileNumber = "96590001010", IsActive = true };
        var acc = new CustomerAccount { AccountId = 20, CustomerId = 10, AccountNumber = "ACC-ZAID-01", Currency = "KWD" };
        setup.Context.Customers.Add(cust);
        setup.Context.CustomerAccounts.Add(acc);

        // Branch 2 (Salmiya) and location
        var branchSalmiya = await setup.Context.Branches.FindAsync(2);
        var branch2Loc = new InventoryLocation { LocationId = 102, VaultId = 1, BranchId = 2, ZoneRoom = "Salmiya Vault", ShelfRow = "R1", SlotBin = "S1" };
        setup.Context.InventoryLocations.Add(branch2Loc);

        // Prior KFH bar sold to customer (was in KFH stock, now status DISPENSED / CUSTOMER_OWNED)
        var priorBar = new InventoryItem
        {
            ItemId = 55,
            LotId = 1,
            SerialNumber = "KFH-GOLD-PRIOR-01",
            ProductId = 1,
            LocationId = null,
            OwnershipType = "CUSTOMER_OWNED",
            StatusCode = "DISPENSED"
        };
        // Active KFH bar in vault
        var activeKfhBar = new InventoryItem
        {
            ItemId = 56,
            LotId = 1,
            SerialNumber = "KFH-GOLD-ACTIVE-01",
            ProductId = 1,
            LocationId = 1,
            OwnershipType = "KFH_OWNED",
            StatusCode = "READY"
        };
        setup.Context.InventoryItems.AddRange(priorBar, activeKfhBar);
        await setup.Context.SaveChangesAsync();

        // 2. Validation Checks
        // A. Bar never in KFH records must fail
        var nonExistentVal = await repo.ValidateIntakeSerialsAsync(new List<string> { "UNKNOWN-NON-KFH-999" }, sourceType: "CUSTOMER", productId: 1);
        Assert.False(nonExistentVal.IsValid);
        Assert.Contains(nonExistentVal.Errors, e => e.Contains("never recorded in KFH stock history"));

        // B. Active KFH bar currently in vault must fail
        var activeKfhVal = await repo.ValidateIntakeSerialsAsync(new List<string> { "KFH-GOLD-ACTIVE-01" }, sourceType: "CUSTOMER", productId: 1);
        Assert.False(activeKfhVal.IsValid);
        Assert.Contains(activeKfhVal.Errors, e => e.Contains("Customer receipt is not permitted while actively owned by KFH"));

        // C. Customer-owned prior KFH bar must pass validation
        var validCustVal = await repo.ValidateIntakeSerialsAsync(new List<string> { "KFH-GOLD-PRIOR-01" }, sourceType: "CUSTOMER", productId: 1);
        Assert.True(validCustVal.IsValid);

        // 3. Setup INTAKE_SHIPMENT and BRANCH_TRANSFER workflow templates
        var intakeTemplate = new WorkflowTemplate { TemplateId = 201, WorkflowType = "INTAKE_SHIPMENT", Name = "Intake Verification Workflow", Description = "Verification", IsActive = true };
        intakeTemplate.Steps.Add(new WorkflowStep { StepId = 201, StepOrder = 1, StepName = "Operations Approval", RequiredRole = "Operations Checker", Description = "Checker step" });

        var transferTemplate = new WorkflowTemplate { TemplateId = 202, WorkflowType = "BRANCH_TRANSFER", Name = "Branch Transfer Workflow", Description = "Transfer", IsActive = true };
        transferTemplate.Steps.Add(new WorkflowStep { StepId = 202, StepOrder = 1, StepName = "Transfer Approval", RequiredRole = "Operations Checker", Description = "Checker step" });

        setup.Context.WorkflowTemplates.AddRange(intakeTemplate, transferTemplate);
        await setup.Context.SaveChangesAsync();

        // 4. Initiate Customer Custody Deposit at Salmiya Branch (Location 102) with TransferToMainVault = true
        var itemsJson = JsonSerializer.Serialize(new[] { new { serial = "KFH-GOLD-PRIOR-01", product_id = 1 } });
        var pendingIntake = await repo.InitiateWorkflowIntakeAsync(
            poId: null,
            lotNumber: "LOT-CUST-DEPOSIT-01",
            locationId: 102,
            receivedBy: "salmiya-officer",
            serialsJsonList: itemsJson,
            sourceType: "CUSTOMER",
            customerId: 10,
            accountId: 20,
            receiptReason: "CUSTODY_DEPOSIT",
            transferToMainVault: true,
            courierInfo: "Armored Courier Service & Security Escort #77",
            destinationBranchId: 1
        );

        Assert.NotNull(pendingIntake);
        Assert.True(pendingIntake.TransferToMainVault);
        Assert.Equal(1, pendingIntake.DestinationBranchId);
        Assert.Equal("Armored Courier Service & Security Escort #77", pendingIntake.CourierInfo);

        // 5. Checker approves the INTAKE_SHIPMENT workflow
        var groupChecker = new PrivilegeGroup { GroupName = "Operations Checker", Description = "Checker group", IsSystem = true };
        setup.Context.PrivilegeGroups.Add(groupChecker);
        await setup.Context.SaveChangesAsync();

        var userChecker = new AppUser { Username = "custody-checker", DisplayName = "Custody Checker", Email = "checker@test.local", PasswordHash = "test-hash" };
        setup.Context.AppUsers.Add(userChecker);
        await setup.Context.SaveChangesAsync();
        setup.Context.UserGroupMemberships.Add(new UserGroupMembership { UserId = userChecker.UserId, GroupId = groupChecker.GroupId, AssignedBy = "TEST" });
        await setup.Context.SaveChangesAsync();

        var activeInstances = (await repo.GetActiveWorkflowInstancesAsync()).ToList();
        var intakeWf = activeInstances.First(i => i.EntityId == pendingIntake.PendingIntakeId && i.WorkflowType == "INTAKE_SHIPMENT");
        var approveResult = await repo.ProcessWorkflowActionAsync(intakeWf.InstanceId, "custody-checker", "APPROVED", "Approved custody receipt from customer Zaid");
        Assert.Equal("SUCCESS", approveResult);

        // Verify holding and customer allocation created
        var holding = await setup.Context.CustomerHoldings.FirstOrDefaultAsync(h => h.ItemId == 55 && h.CustomerId == 10);
        Assert.NotNull(holding);
        Assert.Equal("HELD_IN_CUSTODY", holding.StatusCode);

        // 6. Verify automatic branch transfer created with courier info to Main Vault
        var autoTransfer = await setup.Context.BranchTransfers.FirstOrDefaultAsync(t => t.ItemId == 55);
        Assert.NotNull(autoTransfer);
        Assert.Equal("RETURN_TO_VAULT", autoTransfer.TransferType);
        Assert.Equal(2, autoTransfer.SourceBranchId);
        Assert.Equal(1, autoTransfer.DestinationBranchId);
        Assert.Equal("Armored Courier Service & Security Escort #77", autoTransfer.CourierInfo);
        Assert.Equal("PENDING_APPROVAL", autoTransfer.StatusCode);

        // 7. Approve the automatic courier transfer and receive at Main Central Vault
        var transferWf = (await repo.GetActiveWorkflowInstancesAsync()).First(i => i.EntityId == autoTransfer.TransferId && i.WorkflowType == "BRANCH_TRANSFER");
        var approveTransfer = await repo.ProcessWorkflowActionAsync(transferWf.InstanceId, "custody-checker", "APPROVED", "Approved courier transport to Main Vault");
        Assert.Equal("SUCCESS", approveTransfer);

        var receiveResult = await repo.ReceiveBranchTransferAsync(autoTransfer.TransferId, "main-vault-custodian");
        Assert.Equal("SUCCESS", receiveResult);

        // Bar is now located at Main Vault (location 1), status is HELD_IN_CUSTODY, and customer allocation updated
        var itemFinal = await setup.Context.InventoryItems.FindAsync(55);
        Assert.NotNull(itemFinal);
        Assert.Equal(1, itemFinal.LocationId);
        Assert.Equal("CUSTOMER_OWNED", itemFinal.OwnershipType);
        Assert.Equal("HELD_IN_CUSTODY", itemFinal.StatusCode);

        var allocation = await setup.Context.CustomerAllocations.FirstOrDefaultAsync(a => a.HoldingId == holding.HoldingId);
        Assert.NotNull(allocation);
        Assert.Equal(1, allocation.AssignedLocationId);
    }
}


