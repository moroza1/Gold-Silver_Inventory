using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using PMIMS.Application;
using PMIMS.Domain;
using PMIMS.Infrastructure;
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
    public async Task TestWorkflowExecutionApprovalProcess()
    {
        using var setup = CreateContext();
        await SeedBasicDataAsync(setup.Context);

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
}
