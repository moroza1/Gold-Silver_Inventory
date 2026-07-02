using System;
using System.Linq;
using System.Threading.Tasks;
using PMIMS.Domain;

namespace PMIMS.Infrastructure;

public static class DbSeeder
{
    public static async Task SeedAsync(AppDbContext context)
    {
        // Check if database is already seeded
        if (context.MetalTypes.Any()) return;

        // 1. Status Codes
        var statuses = new[]
        {
            new StatusCodes { StatusCode = "READY", Description = "Ready for Sale / Checkout", Category = "INVENTORY" },
            new StatusCodes { StatusCode = "RESERVED", Description = "Locked for checkout reservation", Category = "INVENTORY" },
            new StatusCodes { StatusCode = "SOLD", Description = "Sold to customer portfolio", Category = "INVENTORY" },
            new StatusCodes { StatusCode = "QUARANTINED", Description = "Quarantined for discrepancy investigation", Category = "INVENTORY" },
            new StatusCodes { StatusCode = "IN_TRANSFER", Description = "In transit lock between locations", Category = "INVENTORY" },
            new StatusCodes { StatusCode = "INACTIVE", Description = "Withdrawn / Redeemed physically", Category = "INVENTORY" },
            new StatusCodes { StatusCode = "PENDING_APPROVAL", Description = "Awaiting checker approval signature", Category = "WORKFLOW" },
            new StatusCodes { StatusCode = "APPROVED", Description = "Approved by Checker", Category = "WORKFLOW" },
            new StatusCodes { StatusCode = "RECEIVED", Description = "Intake matched and closed", Category = "WORKFLOW" },
            new StatusCodes { StatusCode = "ACTIVE", Description = "Active checkout session", Category = "RESERVATION" },
            new StatusCodes { StatusCode = "COMPLETED", Description = "Reservation completed successfully", Category = "RESERVATION" },
            new StatusCodes { StatusCode = "CANCELLED", Description = "Reservation cancelled/timed out", Category = "RESERVATION" },
            new StatusCodes { StatusCode = "HELD_IN_CUSTODY", Description = "Stored under customer custody", Category = "INVENTORY" },
            new StatusCodes { StatusCode = "WITHDRAWN", Description = "Physically withdrawn from custody", Category = "INVENTORY" },
            new StatusCodes { StatusCode = "OPEN", Description = "Open investigation case", Category = "WORKFLOW" },
            new StatusCodes { StatusCode = "RESOLVED", Description = "Resolved case discrepancy", Category = "WORKFLOW" }
        };
        context.StatusCodes.AddRange(statuses);

        // 2. Reason Codes
        var reasons = new[]
        {
            new ReasonCodes { ReasonCode = "STOCK_DISCREPANCY", Description = "Mismatch between ledger and physical scan", Category = "QUARANTINE" },
            new ReasonCodes { ReasonCode = "DAMAGE", Description = "Physical damage to packaging or bar", Category = "QUARANTINE" },
            new ReasonCodes { ReasonCode = "SHARIA_AUDIT_FAIL", Description = "Refinery Sharia status suspended", Category = "REJECTION" },
            new ReasonCodes { ReasonCode = "PRICE_OVERRIDE", Description = "Adjusting cost basis basis due to FX anomalies", Category = "ADJUSTMENT" }
        };
        context.ReasonCodes.AddRange(reasons);

        // 3. Metal Types
        var gold = new MetalType { MetalName = "Gold" };
        var silver = new MetalType { MetalName = "Silver" };
        context.MetalTypes.AddRange(gold, silver);
        await context.SaveChangesAsync();

        // 4. Purity Levels
        var p9999 = new MetalPurityLevel { PurityValue = 99.99m, Description = "999.9 Fine Purity" };
        var p9990 = new MetalPurityLevel { PurityValue = 99.90m, Description = "999.0 Standard Purity" };
        context.MetalPurityLevels.AddRange(p9999, p9990);
        await context.SaveChangesAsync();

        // 5. Denominations
        var d1g = new MetalDenomination { Label = "1 Gram Bar", WeightGrams = 1.0m, WeightOunces = 0.03215m, MetalTypeId = gold.MetalTypeId };
        var d5g = new MetalDenomination { Label = "5 Gram Bar", WeightGrams = 5.0m, WeightOunces = 0.16075m, MetalTypeId = gold.MetalTypeId };
        var d10g = new MetalDenomination { Label = "10 Gram Bar", WeightGrams = 10.0m, WeightOunces = 0.3215m, MetalTypeId = gold.MetalTypeId };
        var d25g = new MetalDenomination { Label = "25 Gram Bar", WeightGrams = 25.0m, WeightOunces = 0.80375m, MetalTypeId = gold.MetalTypeId };
        var d50g = new MetalDenomination { Label = "50 Gram Bar", WeightGrams = 50.0m, WeightOunces = 1.60754m, MetalTypeId = gold.MetalTypeId };
        var d100g = new MetalDenomination { Label = "100 Gram Bar", WeightGrams = 100.0m, WeightOunces = 3.21507m, MetalTypeId = gold.MetalTypeId };
        var d1kg = new MetalDenomination { Label = "1 Kilogram Bar", WeightGrams = 1000.0m, WeightOunces = 32.1507m, MetalTypeId = gold.MetalTypeId };
        var d1oz = new MetalDenomination { Label = "1 Ounce Bar", WeightGrams = 31.1035m, WeightOunces = 1.0m, MetalTypeId = silver.MetalTypeId };
        context.MetalDenominations.AddRange(d1g, d5g, d10g, d25g, d50g, d100g, d1kg, d1oz);
        await context.SaveChangesAsync();

        // 6. Products
        var p1 = new MetalProduct { ProductCode = "AU-1KG-SWISS", MetalTypeId = gold.MetalTypeId, DenominationId = d1kg.DenominationId, PurityId = p9999.PurityId, OriginCountry = "Switzerland" };
        var p2 = new MetalProduct { ProductCode = "AU-100G-TURK", MetalTypeId = gold.MetalTypeId, DenominationId = d100g.DenominationId, PurityId = p9999.PurityId, OriginCountry = "Turkey" };
        var p3 = new MetalProduct { ProductCode = "AU-10G-SWISS", MetalTypeId = gold.MetalTypeId, DenominationId = d10g.DenominationId, PurityId = p9999.PurityId, OriginCountry = "Switzerland" };
        var p4 = new MetalProduct { ProductCode = "AG-1OZ-TURK", MetalTypeId = silver.MetalTypeId, DenominationId = d1oz.DenominationId, PurityId = p9990.PurityId, OriginCountry = "Turkey" };
        var p5 = new MetalProduct { ProductCode = "AU-50G-SWISS", MetalTypeId = gold.MetalTypeId, DenominationId = d50g.DenominationId, PurityId = p9999.PurityId, OriginCountry = "Switzerland" };
        var p6 = new MetalProduct { ProductCode = "AU-25G-SWISS", MetalTypeId = gold.MetalTypeId, DenominationId = d25g.DenominationId, PurityId = p9999.PurityId, OriginCountry = "Switzerland" };
        var p7 = new MetalProduct { ProductCode = "AU-5G-SWISS", MetalTypeId = gold.MetalTypeId, DenominationId = d5g.DenominationId, PurityId = p9999.PurityId, OriginCountry = "Switzerland" };
        var p8 = new MetalProduct { ProductCode = "AU-1G-SWISS", MetalTypeId = gold.MetalTypeId, DenominationId = d1g.DenominationId, PurityId = p9999.PurityId, OriginCountry = "Switzerland" };
        context.MetalProducts.AddRange(p1, p2, p3, p4, p5, p6, p7, p8);

        // 7. Vendors
        var v1 = new Vendor { VendorCode = "VAL-SWISS", VendorName = "Valcambi Suisse", CountryOfOrigin = "Switzerland", IsShariaCompliant = true, ContactEmail = "compliance@valcambi.ch" };
        var v2 = new Vendor { VendorCode = "NAD-TURK", VendorName = "Nadir Gold Refinery", CountryOfOrigin = "Turkey", IsShariaCompliant = true, ContactEmail = "info@nadirgold.com" };
        context.Vendors.AddRange(v1, v2);

        // 8. Vaults
        var vaultMain = new Vault { VaultName = "Main Vault", LocationDescription = "Head Office HQ Basement - Vault Room Alpha", MaxWeightCapacityKg = 5000.00m };
        var vaultBranch = new Vault { VaultName = "Branch Vault", LocationDescription = "Local Branch Vault Storage Safe", MaxWeightCapacityKg = 1000.00m };
        context.Vaults.AddRange(vaultMain, vaultBranch);
        await context.SaveChangesAsync();

        // 9. Branches
        var bMain = new Branch { BranchCode = "MAIN_HO", BranchName = "Main HO Vault Operations", VaultId = vaultMain.VaultId };
        var bFahaheel = new Branch { BranchCode = "FAHAHEEL", BranchName = "Fahaheel Branch Office", VaultId = vaultBranch.VaultId };
        var bSalmiya = new Branch { BranchCode = "SALMIYA", BranchName = "Salmiya Branch Office", VaultId = vaultBranch.VaultId };
        var bOnline = new Branch { BranchCode = "KFH_ONLINE", BranchName = "KFH Online Digital Branch", VaultId = vaultBranch.VaultId };
        context.Branches.AddRange(bMain, bFahaheel, bSalmiya, bOnline);
        await context.SaveChangesAsync();

        // 10. Channels
        var chBranch = new Channel { ChannelName = "Branch" };
        var chMobile = new Channel { ChannelName = "Mobile" };
        var chOnline = new Channel { ChannelName = "Online" };
        var chXtm = new Channel { ChannelName = "XTM" };
        var chApi = new Channel { ChannelName = "API" };
        context.Channels.AddRange(chBranch, chMobile, chOnline, chXtm, chApi);

        // 11. Spatial Coordinates Layout setup
        // Vault Main, Shelves 1-3
        for (int shelf = 1; shelf <= 3; shelf++)
        {
            for (int slot = 1; slot <= 10; slot++)
            {
                context.InventoryLocations.Add(new InventoryLocation
                {
                    VaultId = vaultMain.VaultId,
                    BranchId = bMain.BranchId,
                    ZoneRoom = "Zone Alpha",
                    ShelfRow = $"Shelf Row {shelf}",
                    SlotBin = $"Slot {slot}"
                });
            }
        }
        // Fahaheel Branch, Shelf 4
        for (int slot = 1; slot <= 10; slot++)
        {
            context.InventoryLocations.Add(new InventoryLocation
            {
                VaultId = vaultBranch.VaultId,
                BranchId = bFahaheel.BranchId,
                ZoneRoom = "Zone Alpha",
                ShelfRow = "Shelf Row 4",
                SlotBin = $"Slot {slot}"
            });
        }
        // KFH Online Branch, Shelf 5
        for (int slot = 1; slot <= 10; slot++)
        {
            context.InventoryLocations.Add(new InventoryLocation
            {
                VaultId = vaultBranch.VaultId,
                BranchId = bOnline.BranchId,
                ZoneRoom = "Digital Zone",
                ShelfRow = "Shelf Row 5",
                SlotBin = $"Slot {slot}"
            });
        }
        await context.SaveChangesAsync();

        // 12. Demo Customers & Accounts
        var customer = new Customer { CivilId = "289101201928", CustomerName = "Khalid Al-Mutairi", MobileNumber = "+96590001010", Email = "khalid@mutairi.com" };
        context.Customers.Add(customer);
        await context.SaveChangesAsync();

        var account = new CustomerAccount { CustomerId = customer.CustomerId, AccountNumber = "KWD-902910-101", Currency = "KWD" };
        context.CustomerAccounts.Add(account);
        await context.SaveChangesAsync();

        // 13-16. START FROM ZERO: no physical gold/silver stock is seeded.
        // The lot, inventory items (bars), custody holding and allocation are intentionally
        // NOT created, so the system starts with an empty inventory. Add real stock through
        // the app (Purchase Order -> Receive Shipment). All structure above remains: metal
        // catalog, denominations, products, vendors, vaults, branches, shelf locations,
        // channels, the demo customer/account, users, groups and permissions.

        // 16. Mapped Roles and Permissions Matrix
        var role1 = new UserRole { RoleName = "Operations Maker", Description = "Initiates POs and branch transfers" };
        var role2 = new UserRole { RoleName = "Operations Checker", Description = "Approves POs and intakes" };
        var role3 = new UserRole { RoleName = "Branch Operator", Description = "Teller processes retail sales/redemptions" };
        var role4 = new UserRole { RoleName = "Reconciliation Officer", Description = "Audits breaks and GL discrepancies" };
        context.UserRoles.AddRange(role1, role2, role3, role4);
        await context.SaveChangesAsync();

        var perm1 = new UserPermission { RoleId = role1.RoleId, PermissionName = "po_create" };
        var perm2 = new UserPermission { RoleId = role1.RoleId, PermissionName = "transfer_make" };
        var perm3 = new UserPermission { RoleId = role2.RoleId, PermissionName = "po_approve" };
        var perm4 = new UserPermission { RoleId = role2.RoleId, PermissionName = "intake_approve" };
        context.UserPermissions.AddRange(perm1, perm2, perm3, perm4);

        // (No initial inventory balances — starting from zero stock.)

        // 17. (No simulated reconciliation break — starting from zero stock.)

        // 18. Default Workflow Templates Seeding
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
        var step2 = new WorkflowStep
        {
            TemplateId = poWorkflow.TemplateId,
            StepOrder = 2,
            StepName = "Reconciliation Double Check",
            RequiredRole = "Reconciliation Officer",
            Description = "Validation against system ledger balances."
        };
        context.WorkflowSteps.AddRange(step1, step2);
        await context.SaveChangesAsync();

        // Seed INTAKE_SHIPMENT workflow template
        var intakeWorkflow = new WorkflowTemplate
        {
            WorkflowType = "INTAKE_SHIPMENT",
            Name = "Default Intake Shipment Workflow",
            Description = "Standard Maker-Checker verification for incoming shipments.",
            IsActive = true
        };
        context.WorkflowTemplates.Add(intakeWorkflow);
        await context.SaveChangesAsync();

        var intakeStep = new WorkflowStep
        {
            TemplateId = intakeWorkflow.TemplateId,
            StepOrder = 1,
            StepName = "Treasury Verification",
            RequiredRole = "Operations Checker",
            Description = "Verify weight, serials and coordinate shelf placement."
        };
        context.WorkflowSteps.Add(intakeStep);
        await context.SaveChangesAsync();


        // 19. Default Privilege Groups with Permission Matrices
        // NOTE: Operational *view* modules (spatial_map, workflows) are kept separate from
        // the administrative *manage/setup* modules (vault_location, master_data,
        // workflow_design). This separation is what lets an operator view the vault map
        // while being denied the authority to create/delete physical shelf locations.
        var allModules = new[] { "dashboard", "pending_actions", "purchase_orders", "spatial_map", "custody", "stocktake", "migration", "reports", "workflows", "settings", "user_admin", "vault_location", "master_data", "workflow_design", "intake" };

        var grpMaker = new PrivilegeGroup { GroupName = "Treasury Operations (Maker)", Description = "Initiates purchase orders, transfers, and branch operations.", IsSystem = true };
        var grpChecker = new PrivilegeGroup { GroupName = "Treasury Operations (Checker)", Description = "Reviews and approves purchase orders and intake verifications.", IsSystem = true };
        var grpRecon = new PrivilegeGroup { GroupName = "Reconciliation Officers", Description = "Runs audit sessions, stocktakes, and ledger reconciliation checks.", IsSystem = true };
        var grpAdmin = new PrivilegeGroup { GroupName = "IT Administrators", Description = "Full system access including user administration and configuration.", IsSystem = true };
        context.PrivilegeGroups.AddRange(grpMaker, grpChecker, grpRecon, grpAdmin);
        await context.SaveChangesAsync();

        // Permission matrices: module_key -> access_level per group
        var makerPerms = new Dictionary<string, string> {
            {"dashboard","READ_ONLY"}, {"pending_actions","READ_ONLY"}, {"purchase_orders","FULL"}, {"spatial_map","READ_ONLY"},
            {"custody","READ_ONLY"}, {"stocktake","READ_ONLY"}, {"migration","READ_WRITE"},
            {"reports","READ_ONLY"}, {"workflows","READ_ONLY"}, {"settings","HIDDEN"}, {"user_admin","HIDDEN"},
            // Operators may VIEW but never MANAGE structural/master data:
            {"vault_location","HIDDEN"}, {"master_data","HIDDEN"}, {"workflow_design","HIDDEN"},
            {"intake","FULL"} // Vault team maker has full access to receive shipments
        };
        var checkerPerms = new Dictionary<string, string> {
            {"dashboard","READ_ONLY"}, {"pending_actions","FULL"}, {"purchase_orders","READ_ONLY"}, {"spatial_map","READ_ONLY"},
            {"custody","READ_ONLY"}, {"stocktake","READ_WRITE"}, {"migration","READ_ONLY"},
            {"reports","READ_ONLY"}, {"workflows","READ_ONLY"}, {"settings","HIDDEN"}, {"user_admin","HIDDEN"},
            {"vault_location","HIDDEN"}, {"master_data","HIDDEN"}, {"workflow_design","HIDDEN"},
            {"intake","READ_ONLY"} // Vault team checker has read-only access (they approve via workflows)
        };
        var reconPerms = new Dictionary<string, string> {
            {"dashboard","READ_ONLY"}, {"pending_actions","FULL"}, {"purchase_orders","READ_ONLY"}, {"spatial_map","READ_ONLY"},
            {"custody","READ_ONLY"}, {"stocktake","FULL"}, {"migration","READ_ONLY"},
            {"reports","FULL"}, {"workflows","READ_ONLY"}, {"settings","HIDDEN"}, {"user_admin","HIDDEN"},
            {"vault_location","HIDDEN"}, {"master_data","HIDDEN"}, {"workflow_design","HIDDEN"},
            {"intake","READ_ONLY"}
        };
        var adminPerms = new Dictionary<string, string> {
            {"dashboard","FULL"}, {"pending_actions","FULL"}, {"purchase_orders","FULL"}, {"spatial_map","FULL"},
            {"custody","FULL"}, {"stocktake","FULL"}, {"migration","FULL"},
            {"reports","FULL"}, {"workflows","FULL"}, {"settings","FULL"}, {"user_admin","FULL"},
            {"vault_location","FULL"}, {"master_data","FULL"}, {"workflow_design","FULL"},
            {"intake","FULL"}
        };

        foreach (var kv in makerPerms)
            context.GroupPermissions.Add(new GroupPermission { GroupId = grpMaker.GroupId, ModuleKey = kv.Key, AccessLevel = kv.Value });
        foreach (var kv in checkerPerms)
            context.GroupPermissions.Add(new GroupPermission { GroupId = grpChecker.GroupId, ModuleKey = kv.Key, AccessLevel = kv.Value });
        foreach (var kv in reconPerms)
            context.GroupPermissions.Add(new GroupPermission { GroupId = grpRecon.GroupId, ModuleKey = kv.Key, AccessLevel = kv.Value });
        foreach (var kv in adminPerms)
            context.GroupPermissions.Add(new GroupPermission { GroupId = grpAdmin.GroupId, ModuleKey = kv.Key, AccessLevel = kv.Value });
        await context.SaveChangesAsync();

        // 20. Default Application Users
        // SHA-256 hash of "Password123" for demo purposes
        string demoHash = ComputeSha256("Password123");

        var userMaker = new AppUser { Username = "treasury-maker", DisplayName = "KFH Treasury Maker User", Email = "maker@kfh.com.kw", PasswordHash = demoHash, CreatedBy = "SYSTEM" };
        var userChecker = new AppUser { Username = "treasury-checker", DisplayName = "KFH Treasury Checker User", Email = "checker@kfh.com.kw", PasswordHash = demoHash, CreatedBy = "SYSTEM" };
        var userRecon = new AppUser { Username = "reconciliation-reconciler", DisplayName = "KFH Reconciliation Officer", Email = "reconciler@kfh.com.kw", PasswordHash = demoHash, CreatedBy = "SYSTEM" };
        var userAdmin = new AppUser { Username = "system-admin", DisplayName = "KFH IT Administrator", Email = "admin@kfh.com.kw", PasswordHash = demoHash, CreatedBy = "SYSTEM" };
        context.AppUsers.AddRange(userMaker, userChecker, userRecon, userAdmin);
        await context.SaveChangesAsync();

        // 21. User-Group Memberships
        context.UserGroupMemberships.AddRange(
            new UserGroupMembership { UserId = userMaker.UserId, GroupId = grpMaker.GroupId, AssignedBy = "SYSTEM" },
            new UserGroupMembership { UserId = userChecker.UserId, GroupId = grpChecker.GroupId, AssignedBy = "SYSTEM" },
            new UserGroupMembership { UserId = userRecon.UserId, GroupId = grpRecon.GroupId, AssignedBy = "SYSTEM" },
            new UserGroupMembership { UserId = userAdmin.UserId, GroupId = grpAdmin.GroupId, AssignedBy = "SYSTEM" }
        );
        await context.SaveChangesAsync();
    }

    private static string ComputeSha256(string input)
    {
        using var sha = System.Security.Cryptography.SHA256.Create();
        var bytes = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
