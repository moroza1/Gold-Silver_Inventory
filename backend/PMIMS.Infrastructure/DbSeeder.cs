using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using PMIMS.Domain;

namespace PMIMS.Infrastructure;

public static class DbSeeder
{
    /// <summary>
    /// Idempotently ensures all table columns required by domain entities exist on existing databases
    /// (e.g. SQLite databases created before certain columns were added, avoiding missing column exceptions).
    /// </summary>
    public static async Task EnsureSchemaUpToDateAsync(AppDbContext context)
    {
        try
        {
            var connection = context.Database.GetDbConnection();
            bool wasOpen = connection.State == System.Data.ConnectionState.Open;
            if (!wasOpen) await connection.OpenAsync();

            try
            {
                if (context.Database.IsSqlite())
                {
                    // 1. Ensure pending_turkey_purchases has exact snake_case schema
                    using (var checkCmd = connection.CreateCommand())
                    {
                        checkCmd.CommandText = "PRAGMA table_info(pending_turkey_purchases);";
                        var rawCols = new HashSet<string>();
                        using (var reader = await checkCmd.ExecuteReaderAsync())
                        {
                            while (await reader.ReadAsync())
                            {
                                var n = reader["name"]?.ToString();
                                if (!string.IsNullOrEmpty(n)) rawCols.Add(n);
                            }
                        }

                        // If table exists but lacks required snake_case columns, drop and recreate cleanly
                        if (rawCols.Count > 0 && (!rawCols.Contains("batch_reference") || !rawCols.Contains("approved_at") || !rawCols.Contains("approved_by")))
                        {
                            using var dropCmd = connection.CreateCommand();
                            dropCmd.CommandText = "DROP TABLE IF EXISTS pending_turkey_purchases;";
                            await dropCmd.ExecuteNonQueryAsync();
                        }
                    }

                    using (var createTableCmd = connection.CreateCommand())
                    {
                        createTableCmd.CommandText = @"
                            CREATE TABLE IF NOT EXISTS pending_turkey_purchases (
                                pending_purchase_id INTEGER NOT NULL CONSTRAINT PK_pending_turkey_purchases PRIMARY KEY AUTOINCREMENT,
                                batch_reference TEXT NOT NULL,
                                serials_json_list TEXT NOT NULL,
                                total_items INTEGER NOT NULL,
                                total_weight_grams TEXT NOT NULL,
                                unit_price_per_gram TEXT NOT NULL,
                                total_cost TEXT NOT NULL,
                                requested_by TEXT NOT NULL,
                                notes TEXT,
                                status_code TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
                                created_at TEXT NOT NULL,
                                approved_by TEXT,
                                approved_at TEXT
                            );
                            CREATE INDEX IF NOT EXISTS IX_pending_turkey_purchases_status_code ON pending_turkey_purchases (status_code);
                            CREATE INDEX IF NOT EXISTS IX_pending_turkey_purchases_created_at ON pending_turkey_purchases (created_at);
                        ";
                        await createTableCmd.ExecuteNonQueryAsync();
                    }

                    // 1b. Ensure inventory_items has composite unique index on (product_id, serial_number)
                    using (var idxCmd = connection.CreateCommand())
                    {
                        idxCmd.CommandText = @"
                            DROP INDEX IF EXISTS IX_inventory_items_serial_number;
                            CREATE UNIQUE INDEX IF NOT EXISTS IX_inventory_items_product_id_serial_number ON inventory_items (product_id, serial_number);
                        ";
                        try { await idxCmd.ExecuteNonQueryAsync(); } catch { }
                    }

                    // 2. Ensure columns on pending_intakes
                    using var cmd = connection.CreateCommand();
                    cmd.CommandText = "PRAGMA table_info(pending_intakes);";
                    var existingCols = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    using (var reader = await cmd.ExecuteReaderAsync())
                    {
                        while (await reader.ReadAsync())
                        {
                            var colName = reader["name"]?.ToString();
                            if (!string.IsNullOrEmpty(colName)) existingCols.Add(colName);
                        }
                    }

                    if (existingCols.Count > 0)
                    {
                        var colsToAdd = new List<(string Name, string Def)>
                        {
                            ("ownership_type", "TEXT NOT NULL DEFAULT 'KFH_OWNED'"),
                            ("source_type", "TEXT NOT NULL DEFAULT 'SUPPLIER'"),
                            ("receipt_reason", "TEXT"),
                            ("vendor_id", "INTEGER"),
                            ("shipment_reference", "TEXT"),
                            ("delivery_note_number", "TEXT"),
                            ("airway_bill_number", "TEXT"),
                            ("supporting_document_url", "TEXT"),
                            ("discrepancy_notes", "TEXT"),
                            ("receiving_date", "TEXT"),
                            ("customer_id", "INTEGER"),
                            ("account_id", "INTEGER")
                        };

                        foreach (var (col, def) in colsToAdd)
                        {
                            if (!existingCols.Contains(col))
                            {
                                try
                                {
                                    using var alterCmd = connection.CreateCommand();
                                    alterCmd.CommandText = $"ALTER TABLE pending_intakes ADD COLUMN {col} {def};";
                                    await alterCmd.ExecuteNonQueryAsync();
                                    existingCols.Add(col);
                                }
                                catch
                                {
                                    // Ignore if already added with different casing
                                }
                            }
                        }
                    }

                    // Check and update reorder_thresholds
                    var thCols = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    using (var pragmaCmd = connection.CreateCommand())
                    {
                        pragmaCmd.CommandText = "PRAGMA table_info(reorder_thresholds);";
                        using var reader = await pragmaCmd.ExecuteReaderAsync();
                        while (await reader.ReadAsync())
                        {
                            var colName = reader["name"]?.ToString();
                            if (!string.IsNullOrEmpty(colName)) thCols.Add(colName);
                        }
                    }
                    if (thCols.Count > 0)
                    {
                        if (!thCols.Contains("threshold_type"))
                        {
                            try
                            {
                                using var alterCmd = connection.CreateCommand();
                                alterCmd.CommandText = "ALTER TABLE reorder_thresholds ADD COLUMN threshold_type TEXT NOT NULL DEFAULT 'LOW_STOCK';";
                                await alterCmd.ExecuteNonQueryAsync();
                            }
                            catch { }
                        }
                        if (!thCols.Contains("max_stock_qty"))
                        {
                            try
                            {
                                using var alterCmd = connection.CreateCommand();
                                alterCmd.CommandText = "ALTER TABLE reorder_thresholds ADD COLUMN max_stock_qty INTEGER NULL;";
                                await alterCmd.ExecuteNonQueryAsync();
                            }
                            catch { }
                        }
                    }

                    // Ensure pending_threshold_changes table exists and is up to date
                    using (var createThresholdTableCmd = connection.CreateCommand())
                    {
                        createThresholdTableCmd.CommandText = @"
                            CREATE TABLE IF NOT EXISTS pending_threshold_changes (
                                pending_change_id INTEGER NOT NULL CONSTRAINT PK_pending_threshold_changes PRIMARY KEY AUTOINCREMENT,
                                change_type TEXT NOT NULL DEFAULT 'CREATE',
                                threshold_type TEXT NOT NULL DEFAULT 'LOW_STOCK',
                                threshold_id INTEGER,
                                product_id INTEGER NOT NULL,
                                vendor_id INTEGER NOT NULL,
                                min_stock_qty INTEGER NOT NULL,
                                max_stock_qty INTEGER,
                                reorder_qty INTEGER NOT NULL,
                                is_active INTEGER NOT NULL DEFAULT 1,
                                status_code TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
                                requested_by TEXT NOT NULL,
                                approved_by TEXT,
                                created_at TEXT NOT NULL,
                                comments TEXT
                            );
                            CREATE INDEX IF NOT EXISTS IX_pending_threshold_changes_status_code ON pending_threshold_changes (status_code);
                            CREATE INDEX IF NOT EXISTS IX_pending_threshold_changes_threshold_type ON pending_threshold_changes (threshold_type);
                        ";
                        await createThresholdTableCmd.ExecuteNonQueryAsync();
                    }

                    var pthCols = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    using (var pragmaCmd = connection.CreateCommand())
                    {
                        pragmaCmd.CommandText = "PRAGMA table_info(pending_threshold_changes);";
                        using var reader = await pragmaCmd.ExecuteReaderAsync();
                        while (await reader.ReadAsync())
                        {
                            var colName = reader["name"]?.ToString();
                            if (!string.IsNullOrEmpty(colName)) pthCols.Add(colName);
                        }
                    }
                    if (pthCols.Count > 0)
                    {
                        if (!pthCols.Contains("threshold_type"))
                        {
                            try
                            {
                                using var alterCmd = connection.CreateCommand();
                                alterCmd.CommandText = "ALTER TABLE pending_threshold_changes ADD COLUMN threshold_type TEXT NOT NULL DEFAULT 'LOW_STOCK';";
                                await alterCmd.ExecuteNonQueryAsync();
                            }
                            catch { }
                        }
                        if (!pthCols.Contains("max_stock_qty"))
                        {
                            try
                            {
                                using var alterCmd = connection.CreateCommand();
                                alterCmd.CommandText = "ALTER TABLE pending_threshold_changes ADD COLUMN max_stock_qty INTEGER NULL;";
                                await alterCmd.ExecuteNonQueryAsync();
                            }
                            catch { }
                        }
                    }
                }
                else if (context.Database.IsSqlServer())
                {
                    await context.Database.ExecuteSqlRawAsync(@"
                        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'pending_turkey_purchases')
                        BEGIN
                            CREATE TABLE pending_turkey_purchases (
                                PendingPurchaseId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_pending_turkey_purchases PRIMARY KEY,
                                BatchReference NVARCHAR(MAX) NOT NULL,
                                SerialsJsonList NVARCHAR(MAX) NOT NULL,
                                TotalItems INT NOT NULL,
                                TotalWeightGrams DECIMAL(18,3) NOT NULL,
                                UnitPricePerGram DECIMAL(18,4) NOT NULL,
                                TotalCost DECIMAL(18,4) NOT NULL,
                                RequestedBy NVARCHAR(MAX) NOT NULL,
                                Notes NVARCHAR(MAX) NULL,
                                StatusCode NVARCHAR(50) NOT NULL CONSTRAINT DF_pending_turkey_purchases_StatusCode DEFAULT 'PENDING_APPROVAL',
                                CreatedAt DATETIME2 NOT NULL,
                                ApprovedBy NVARCHAR(MAX) NULL,
                                ApprovedAt DATETIME2 NULL
                            );
                            CREATE NONCLUSTERED INDEX IX_pending_turkey_purchases_StatusCode ON pending_turkey_purchases(StatusCode);
                            CREATE NONCLUSTERED INDEX IX_pending_turkey_purchases_CreatedAt ON pending_turkey_purchases(CreatedAt);
                        END

                        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('pending_intakes') AND name = 'ownership_type')
                        BEGIN
                            ALTER TABLE pending_intakes ADD ownership_type VARCHAR(30) NOT NULL CONSTRAINT DF_pending_intakes_ownership_type DEFAULT 'KFH_OWNED';
                        END

                        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('reorder_thresholds') AND name = 'threshold_type')
                        BEGIN
                            ALTER TABLE reorder_thresholds ADD threshold_type VARCHAR(30) NOT NULL CONSTRAINT DF_reorder_thresholds_threshold_type DEFAULT 'LOW_STOCK';
                        END

                        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('reorder_thresholds') AND name = 'max_stock_qty')
                        BEGIN
                            ALTER TABLE reorder_thresholds ADD max_stock_qty INT NULL;
                        END

                        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('pending_threshold_changes') AND name = 'threshold_type')
                        BEGIN
                            ALTER TABLE pending_threshold_changes ADD threshold_type VARCHAR(30) NOT NULL CONSTRAINT DF_pending_threshold_changes_threshold_type DEFAULT 'LOW_STOCK';
                        END

                        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('pending_threshold_changes') AND name = 'max_stock_qty')
                        BEGIN
                            ALTER TABLE pending_threshold_changes ADD max_stock_qty INT NULL;
                        END
                    ");
                }

                // 3. Ensure all default workflow templates and Maker-Checker steps exist
                await EnsureWorkflowTemplatesAsync(context);

                // 4. Ensure default reorder thresholds exist if empty
                if (!await context.ReorderThresholds.AnyAsync())
                {
                    var products = await context.MetalProducts.ToListAsync();
                    var defaultVendor = await context.Vendors.FirstOrDefaultAsync(v => v.VendorCode == "VAL-SWISS")
                                     ?? await context.Vendors.FirstOrDefaultAsync();
                    if (products.Count > 0 && defaultVendor != null)
                    {
                        foreach (var prod in products.Take(4))
                        {
                            context.ReorderThresholds.Add(new ReorderThreshold
                            {
                                ThresholdType = "LOW_STOCK",
                                ProductId = prod.ProductId,
                                VendorId = defaultVendor.VendorId,
                                MinStockQty = 5,
                                MaxStockQty = 50,
                                ReorderQty = 10,
                                IsActive = true,
                                CreatedAt = DateTime.UtcNow,
                                UpdatedAt = DateTime.UtcNow
                            });
                            context.ReorderThresholds.Add(new ReorderThreshold
                            {
                                ThresholdType = "HIGH_STOCK",
                                ProductId = prod.ProductId,
                                VendorId = defaultVendor.VendorId,
                                MinStockQty = 50,
                                MaxStockQty = 100,
                                ReorderQty = 0,
                                IsActive = true,
                                CreatedAt = DateTime.UtcNow,
                                UpdatedAt = DateTime.UtcNow
                            });
                        }
                        await context.SaveChangesAsync();
                    }
                }
            }
            finally
            {
                if (!wasOpen) await connection.CloseAsync();
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"⚠️ Schema update check warning: {ex.Message}");
        }
    }

    /// <summary>
    /// Ensures all 6 core workflows have active workflow template definitions with Maker and Checker steps.
    /// Step 1: Treasury Operations (Maker) verification.
    /// Step 2: Treasury Operations (Checker) approval.
    /// </summary>
    public static async Task EnsureWorkflowTemplatesAsync(AppDbContext context)
    {
        var workflows = new[]
        {
            new
            {
                WorkflowType = "PURCHASE_ORDER",
                Name = "Default Purchase Order Workflow",
                Description = "Standard Maker-Checker approval for procurement purchase orders.",
                MakerStepName = "Purchase Order Maker Creation",
                MakerDesc = "Maker drafts purchase order, assigns supplier, quantities, and agreed prices.",
                CheckerStepName = "Purchase Order Checker Approval",
                CheckerDesc = "Checker reviews PO terms, budget, and authorizes supplier procurement."
            },
            new
            {
                WorkflowType = "INTAKE_SHIPMENT",
                Name = "Default Intake Shipment Workflow",
                Description = "Standard Maker-Checker verification for incoming shipments.",
                MakerStepName = "Intake Shipment Maker Verification",
                MakerDesc = "Maker inspects shipment package, logs serials, and reviews delivery documentation.",
                CheckerStepName = "Intake Shipment Checker Approval",
                CheckerDesc = "Checker validates weight, serial counts, and authorizes vault shelf placement."
            },
            new
            {
                WorkflowType = "BRANCH_TRANSFER",
                Name = "Default Branch Transfer Workflow",
                Description = "Standard Maker-Checker verification for branch transfers.",
                MakerStepName = "Branch Transfer Maker Verification",
                MakerDesc = "Maker confirms transfer request items, destination vault, and courier dispatch details.",
                CheckerStepName = "Branch Transfer Checker Approval",
                CheckerDesc = "Checker validates transfer routing and authorizes vault transfer movement."
            },
            new
            {
                WorkflowType = "TURKEY_PURCHASE",
                Name = "Default Turkey Gold Purchase Workflow",
                Description = "Maker-Checker verification for purchasing consignment gold from Turkey.",
                MakerStepName = "Turkey Purchase Maker Verification",
                MakerDesc = "Maker checks consignment serials, gold purity certification, and agreed buy rate.",
                CheckerStepName = "Turkey Purchase Checker Approval",
                CheckerDesc = "Checker verifies serials and agreed buy rate, approving ownership transfer to KFH."
            },
            new
            {
                WorkflowType = "DAMAGE_BAR",
                Name = "Default Damage Bar Workflow",
                Description = "Standard Maker-Checker verification for marking gold bars as damaged.",
                MakerStepName = "Damage Bar Maker Verification",
                MakerDesc = "Maker inspects damaged bar, records defect report, and attaches visual evidence.",
                CheckerStepName = "Damage Bar Checker Approval",
                CheckerDesc = "Checker reviews damage evidence and approves quarantine status change."
            },
            new
            {
                WorkflowType = "CUSTODY_WITHDRAWAL",
                Name = "Default Customer Gold Custody Withdrawal Workflow",
                Description = "Maker-Checker verification for client physical gold withdrawal and delivery handover.",
                MakerStepName = "Custody Handover Maker Verification",
                MakerDesc = "Maker checks withdrawal request, customer civil ID, and staging of custody bars.",
                CheckerStepName = "Custody Checker Handover Authorization",
                CheckerDesc = "Checker validates customer civil ID, PACI handover OTP, and authorizes vault dispatch."
            },
            new
            {
                WorkflowType = "THRESHOLD_CONFIG",
                Name = "Default Cut-Off Threshold Configuration Workflow",
                Description = "Maker-Checker verification for creation, amendment, activation, deactivation, or deletion of stock cut-off thresholds.",
                MakerStepName = "Threshold Configuration Maker Verification",
                MakerDesc = "Maker configures product denomination, vendor, min stock cut-off, reorder level, and active state.",
                CheckerStepName = "Threshold Configuration Checker Authorization",
                CheckerDesc = "Checker reviews threshold parameters against enterprise stock policy and authorizes threshold activation or removal."
            },
            new
            {
                WorkflowType = "HOME_DELIVERY",
                Name = "Default Home Delivery Fulfillment Workflow",
                Description = "Standard Maker-Checker verification for client residential gold home delivery dispatch.",
                MakerStepName = "Home Delivery Maker Verification & Bar Scanning",
                MakerDesc = "Maker selects GFS delivery request, scans matching gold bar serial number and product type, and initiates dispatch authorization.",
                CheckerStepName = "Home Delivery Checker Authorization",
                CheckerDesc = "Checker verifies customer PACI Civil ID, delivery address, scanned bar serial/product match, and authorizes armored courier dispatch."
            }
        };

        foreach (var def in workflows)
        {
            var template = await context.WorkflowTemplates
                .Include(t => t.Steps)
                .FirstOrDefaultAsync(t => t.WorkflowType == def.WorkflowType);

            if (template == null)
            {
                template = new WorkflowTemplate
                {
                    WorkflowType = def.WorkflowType,
                    Name = def.Name,
                    Description = def.Description,
                    IsActive = true
                };
                context.WorkflowTemplates.Add(template);
                await context.SaveChangesAsync();

                var step1 = new WorkflowStep
                {
                    TemplateId = template.TemplateId,
                    StepOrder = 1,
                    StepName = def.MakerStepName,
                    RequiredRole = "Treasury Operations (Maker)",
                    Description = def.MakerDesc
                };
                var step2 = new WorkflowStep
                {
                    TemplateId = template.TemplateId,
                    StepOrder = 2,
                    StepName = def.CheckerStepName,
                    RequiredRole = "Treasury Operations (Checker)",
                    Description = def.CheckerDesc
                };
                context.WorkflowSteps.AddRange(step1, step2);
                await context.SaveChangesAsync();
            }
            else
            {
                if (template.Steps == null || template.Steps.Count < 2)
                {
                    bool hasPending = await context.WorkflowInstances.AnyAsync(i => i.TemplateId == template.TemplateId && i.StatusCode == "PENDING_MAKER");
                    if (!hasPending)
                    {
                        if (template.Steps != null && template.Steps.Any())
                        {
                            context.WorkflowSteps.RemoveRange(template.Steps);
                            await context.SaveChangesAsync();
                        }

                        var step1 = new WorkflowStep
                        {
                            TemplateId = template.TemplateId,
                            StepOrder = 1,
                            StepName = def.MakerStepName,
                            RequiredRole = "Treasury Operations (Maker)",
                            Description = def.MakerDesc
                        };
                        var step2 = new WorkflowStep
                        {
                            TemplateId = template.TemplateId,
                            StepOrder = 2,
                            StepName = def.CheckerStepName,
                            RequiredRole = "Treasury Operations (Checker)",
                            Description = def.CheckerDesc
                        };
                        context.WorkflowSteps.AddRange(step1, step2);
                        await context.SaveChangesAsync();
                    }
                }
            }
        }
    }
    // Single source of truth for system-group module permissions, shared by the fresh
    // seed (SeedAsync) and the top-up (EnsureModulePermissionsAsync). Keyed by group
    // NAME so both paths can resolve the right PrivilegeGroup. When you add a new module,
    // add its grant to each group here once -- existing databases get it on next startup.
    private static Dictionary<string, Dictionary<string, string>> BuildPermissionMatrix() => new()
    {
        ["Treasury Operations (Maker)"] = new()
        {
            {"dashboard","READ_ONLY"}, {"pending_actions","READ_WRITE"}, {"spatial_map","READ_ONLY"},
            {"custody","READ_ONLY"}, {"stocktake","READ_ONLY"}, {"migration","HIDDEN"}, {"reports","READ_ONLY"},
            {"workflows","READ_ONLY"}, {"settings","HIDDEN"}, {"user_admin","HIDDEN"}, {"vault_location","HIDDEN"},
            {"master_data","HIDDEN"}, {"workflow_design","READ_ONLY"}, {"intake","FULL"}, {"rules_engine","HIDDEN"},
            {"monitoring","HIDDEN"}, {"barcode_qr_labeling","FULL"}, {"purchase_orders","FULL"},
            {"dispensing","FULL"}, {"device_integration","HIDDEN"}, {"notifications","READ_ONLY"},
        },
        ["Treasury Operations (Checker)"] = new()
        {
            {"dashboard","READ_ONLY"}, {"pending_actions","FULL"}, {"spatial_map","READ_ONLY"},
            {"custody","READ_ONLY"}, {"stocktake","READ_WRITE"}, {"migration","HIDDEN"}, {"reports","READ_ONLY"},
            {"workflows","READ_ONLY"}, {"settings","HIDDEN"}, {"user_admin","HIDDEN"}, {"vault_location","HIDDEN"},
            {"master_data","HIDDEN"}, {"workflow_design","READ_ONLY"}, {"intake","READ_ONLY"}, {"rules_engine","HIDDEN"},
            {"monitoring","HIDDEN"}, {"barcode_qr_labeling","READ_ONLY"}, {"purchase_orders","READ_ONLY"},
            {"dispensing","READ_ONLY"}, {"device_integration","HIDDEN"}, {"notifications","READ_ONLY"},
        },
        ["Reconciliation Officers"] = new()
        {
            {"dashboard","READ_ONLY"}, {"pending_actions","FULL"}, {"spatial_map","READ_ONLY"},
            {"custody","READ_ONLY"}, {"stocktake","FULL"}, {"migration","HIDDEN"}, {"reports","FULL"},
            {"workflows","READ_ONLY"}, {"settings","HIDDEN"}, {"user_admin","HIDDEN"}, {"vault_location","HIDDEN"},
            {"master_data","HIDDEN"}, {"workflow_design","READ_ONLY"}, {"intake","READ_ONLY"}, {"rules_engine","HIDDEN"},
            {"monitoring","HIDDEN"}, {"barcode_qr_labeling","READ_ONLY"}, {"purchase_orders","READ_ONLY"},
            {"dispensing","READ_ONLY"}, {"device_integration","HIDDEN"}, {"notifications","READ_ONLY"},
        },
        ["IT Administrators"] = new()
        {
            {"dashboard","FULL"}, {"pending_actions","FULL"}, {"spatial_map","FULL"},
            {"custody","FULL"}, {"stocktake","FULL"}, {"migration","FULL"}, {"reports","FULL"},
            {"workflows","FULL"}, {"settings","FULL"}, {"user_admin","FULL"}, {"vault_location","FULL"},
            {"master_data","FULL"}, {"workflow_design","FULL"}, {"intake","FULL"}, {"rules_engine","FULL"},
            {"monitoring","FULL"}, {"barcode_qr_labeling","FULL"}, {"purchase_orders","FULL"},
            {"dispensing","FULL"}, {"device_integration","FULL"}, {"notifications","FULL"},
        },
    };

    /// <summary>
    /// Idempotently ensures every built-in system group has a GroupPermission row for every
    /// module in the shared matrix. Runs on EVERY startup -- including already-seeded
    /// databases, which SeedAsync skips -- so grants for a newly-added module appear after a
    /// restart without a full reseed. Only the four system groups are touched; admin-created
    /// custom groups are left alone. Users must re-login to pick up new permission claims.
    /// </summary>
    public static async Task EnsureModulePermissionsAsync(AppDbContext context)
    {
        var groups = context.PrivilegeGroups.ToList();
        if (groups.Count == 0) return; // brand-new DB: SeedAsync will populate everything
        var matrix = BuildPermissionMatrix();
        bool added = false;
        foreach (var grp in groups)
        {
            if (!matrix.TryGetValue(grp.GroupName, out var perms)) continue;
            foreach (var kv in perms)
            {
                var existing = context.GroupPermissions.FirstOrDefault(p => p.GroupId == grp.GroupId && p.ModuleKey == kv.Key);
                if (existing == null)
                {
                    context.GroupPermissions.Add(new GroupPermission { GroupId = grp.GroupId, ModuleKey = kv.Key, AccessLevel = kv.Value });
                    added = true;
                }
                else if (existing.AccessLevel != kv.Value && grp.IsSystem)
                {
                    existing.AccessLevel = kv.Value;
                    added = true;
                }
            }
        }
        if (added) await context.SaveChangesAsync();
    }

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
            new StatusCodes { StatusCode = "PARTIAL_RECEIPT", Description = "Partial shipment received, awaiting remaining items", Category = "WORKFLOW" },
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

        // 5b. Refiner / Mint Brands (Master Data Lookup)
        var bValcambi = new MetalBrand { BrandCode = "VALCAMBI", BrandName = "Valcambi Suisse", CountryOfOrigin = "Switzerland", LbmaRefinerId = "VALC-CH", IsLbmaCertified = true, Description = "LBMA Good Delivery Refiner - Balerna, Switzerland" };
        var bPamp = new MetalBrand { BrandCode = "PAMP", BrandName = "PAMP Suisse", CountryOfOrigin = "Switzerland", LbmaRefinerId = "PAMP-CH", IsLbmaCertified = true, Description = "LBMA Good Delivery Refiner - Castel San Pietro, Switzerland" };
        var bArgor = new MetalBrand { BrandCode = "ARGOR", BrandName = "Argor-Heraeus", CountryOfOrigin = "Switzerland", LbmaRefinerId = "ARGH-CH", IsLbmaCertified = true, Description = "LBMA Good Delivery Refiner - Mendrisio, Switzerland" };
        var bNadir = new MetalBrand { BrandCode = "NADIR", BrandName = "Nadir Gold Refinery", CountryOfOrigin = "Turkey", LbmaRefinerId = "NADR-TR", IsLbmaCertified = true, Description = "LBMA Good Delivery Refiner - Istanbul, Turkey" };
        var bIgr = new MetalBrand { BrandCode = "IGR", BrandName = "Istanbul Gold Refinery (IGR)", CountryOfOrigin = "Turkey", LbmaRefinerId = "IGRE-TR", IsLbmaCertified = true, Description = "LBMA Good Delivery Refiner - Istanbul, Turkey" };
        var bEmirates = new MetalBrand { BrandCode = "EMIRATES", BrandName = "Emirates Gold", CountryOfOrigin = "United Arab Emirates", LbmaRefinerId = "EMIR-AE", IsLbmaCertified = true, Description = "DMCC / UAE Good Delivery - Dubai, UAE" };
        var bPerth = new MetalBrand { BrandCode = "PERTH", BrandName = "Perth Mint Australia", CountryOfOrigin = "Australia", LbmaRefinerId = "PERTH-AU", IsLbmaCertified = true, Description = "LBMA Good Delivery - Perth, Australia" };
        var bKfh = new MetalBrand { BrandCode = "KFH_MINT", BrandName = "KFH Custom Mint Gold", CountryOfOrigin = "Kuwait", LbmaRefinerId = "KFH-KW", IsLbmaCertified = true, Description = "Kuwait Finance House Investment Bullion Mint" };
        context.Brands.AddRange(bValcambi, bPamp, bArgor, bNadir, bIgr, bEmirates, bPerth, bKfh);
        await context.SaveChangesAsync();

        // 6. Products
        var p1 = new MetalProduct { ProductCode = "AU-1KG-SWISS", MetalTypeId = gold.MetalTypeId, DenominationId = d1kg.DenominationId, PurityId = p9999.PurityId, OriginCountry = "Switzerland", BrandId = bValcambi.BrandId, BrandName = bValcambi.BrandName };
        var p2 = new MetalProduct { ProductCode = "AU-100G-TURK", MetalTypeId = gold.MetalTypeId, DenominationId = d100g.DenominationId, PurityId = p9999.PurityId, OriginCountry = "Turkey", BrandId = bNadir.BrandId, BrandName = bNadir.BrandName };
        var p3 = new MetalProduct { ProductCode = "AU-10G-SWISS", MetalTypeId = gold.MetalTypeId, DenominationId = d10g.DenominationId, PurityId = p9999.PurityId, OriginCountry = "Switzerland", BrandId = bValcambi.BrandId, BrandName = bValcambi.BrandName };
        var p4 = new MetalProduct { ProductCode = "AG-1OZ-TURK", MetalTypeId = silver.MetalTypeId, DenominationId = d1oz.DenominationId, PurityId = p9990.PurityId, OriginCountry = "Turkey", BrandId = bNadir.BrandId, BrandName = bNadir.BrandName };
        var p5 = new MetalProduct { ProductCode = "AU-50G-SWISS", MetalTypeId = gold.MetalTypeId, DenominationId = d50g.DenominationId, PurityId = p9999.PurityId, OriginCountry = "Switzerland", BrandId = bPamp.BrandId, BrandName = bPamp.BrandName };
        var p6 = new MetalProduct { ProductCode = "AU-25G-SWISS", MetalTypeId = gold.MetalTypeId, DenominationId = d25g.DenominationId, PurityId = p9999.PurityId, OriginCountry = "Switzerland", BrandId = bValcambi.BrandId, BrandName = bValcambi.BrandName };
        var p7 = new MetalProduct { ProductCode = "AU-5G-SWISS", MetalTypeId = gold.MetalTypeId, DenominationId = d5g.DenominationId, PurityId = p9999.PurityId, OriginCountry = "Switzerland", BrandId = bValcambi.BrandId, BrandName = bValcambi.BrandName };
        var p8 = new MetalProduct { ProductCode = "AU-1G-SWISS", MetalTypeId = gold.MetalTypeId, DenominationId = d1g.DenominationId, PurityId = p9999.PurityId, OriginCountry = "Switzerland", BrandId = bKfh.BrandId, BrandName = bKfh.BrandName };
        context.MetalProducts.AddRange(p1, p2, p3, p4, p5, p6, p7, p8);

        // 7. Vendors
        var v1 = new Vendor { VendorCode = "VAL-SWISS", VendorName = "Valcambi Suisse", CountryOfOrigin = "Switzerland", IsShariaCompliant = true, ContactEmail = "compliance@valcambi.ch" };
        var v2 = new Vendor { VendorCode = "NAD-TURK", VendorName = "Nadir Gold Refinery", CountryOfOrigin = "Turkey", IsShariaCompliant = true, ContactEmail = "info@nadirgold.com" };
        // Not a real supplier -- stands in for "no vendor" on lots received directly from a
        // customer (buyback/custody deposit/return), since InventoryLot.VendorId is required.
        // See InventoryRepository.GetOrCreateWalkInVendorIdAsync, which also creates this
        // defensively if a database was seeded before this row existed.
        var vWalkIn = new Vendor { VendorCode = "WALK-IN", VendorName = "Walk-In Customer (Receipt Source)", CountryOfOrigin = "KWT", IsShariaCompliant = true, ContactEmail = "n/a@kfh.internal" };
        context.Vendors.AddRange(v1, v2, vWalkIn);

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


        // 12. Demo Customers & Accounts
        // Create test customers for KFHOnline with specific IDs (1, 2, 3)
        var testCust1 = new Customer
        {
            CustomerId = 1,
            CivilId = "123456789001",
            CustomerName = "Ahmed Al-Sabah",
            MobileNumber = "+96590001001",
            Email = "ahmed@example.com"
        };
        var testCust2 = new Customer
        {
            CustomerId = 2,
            CivilId = "123456789002",
            CustomerName = "Fatima Al-Dosari",
            MobileNumber = "+96590001002",
            Email = "fatima@example.com"
        };
        var testCust3 = new Customer
        {
            CustomerId = 3,
            CivilId = "123456789003",
            CustomerName = "Mohammed Al-Ajmi",
            MobileNumber = "+96590001003",
            Email = "mohammed@example.com"
        };
        context.Customers.AddRange(testCust1, testCust2, testCust3);
        await context.SaveChangesAsync();

        // Add main demo customer
        var customer = new Customer { CivilId = "289101201928", CustomerName = "Khalid Al-Mutairi", MobileNumber = "+96590001010", Email = "khalid@mutairi.com" };
        context.Customers.Add(customer);
        await context.SaveChangesAsync();

        // Create accounts for test customers
        var account1 = new CustomerAccount { CustomerId = testCust1.CustomerId, AccountNumber = "KWD-000001-001", Currency = "KWD" };
        var account2 = new CustomerAccount { CustomerId = testCust2.CustomerId, AccountNumber = "KWD-000002-001", Currency = "KWD" };
        var account3 = new CustomerAccount { CustomerId = testCust3.CustomerId, AccountNumber = "KWD-000003-001", Currency = "KWD" };
        context.CustomerAccounts.AddRange(account1, account2, account3);
        await context.SaveChangesAsync();

        var account = new CustomerAccount { CustomerId = customer.CustomerId, AccountNumber = "KWD-902910-101", Currency = "KWD" };
        context.CustomerAccounts.Add(account);
        await context.SaveChangesAsync();

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

        // 18. Default Active Workflow Templates Seeding (Maker and Checker Steps)
        await EnsureWorkflowTemplatesAsync(context);


        // 19. Default Privilege Groups with Permission Matrices
        // NOTE: Operational *view* modules (spatial_map, workflows) are kept separate from
        // the administrative *manage/setup* modules (vault_location, master_data,
        // workflow_design). This separation is what lets an operator view the vault map
        // while being denied the authority to create/delete physical shelf locations.
        // RFP items 5-8 (rules_engine, notifications, monitoring) are new admin-tier
        // modules, same governance tier as vault_location/master_data/workflow_design.
        var allModules = new[] { "dashboard", "pending_actions", "spatial_map", "custody", "stocktake", "migration", "reports", "workflows", "settings", "user_admin", "vault_location", "master_data", "workflow_design", "intake", "rules_engine", "monitoring", "barcode_qr_labeling", "purchase_orders", "dispensing", "device_integration", "notifications" };

        var grpMaker = new PrivilegeGroup { GroupName = "Treasury Operations (Maker)", Description = "Initiates purchase orders, transfers, and branch operations.", IsSystem = true };
        var grpChecker = new PrivilegeGroup { GroupName = "Treasury Operations (Checker)", Description = "Reviews and approves purchase orders and intake verifications.", IsSystem = true };
        var grpRecon = new PrivilegeGroup { GroupName = "Reconciliation Officers", Description = "Runs audit sessions, stocktakes, and ledger reconciliation checks.", IsSystem = true };
        var grpAdmin = new PrivilegeGroup { GroupName = "IT Administrators", Description = "Full system access including user administration and configuration.", IsSystem = true };
        context.PrivilegeGroups.AddRange(grpMaker, grpChecker, grpRecon, grpAdmin);
        await context.SaveChangesAsync();

        // Apply the shared permission matrix (single source of truth -- see
        // BuildPermissionMatrix / EnsureModulePermissionsAsync above).
        var permMatrix = BuildPermissionMatrix();
        var groupsByName = new Dictionary<string, PrivilegeGroup>
        {
            [grpMaker.GroupName] = grpMaker,
            [grpChecker.GroupName] = grpChecker,
            [grpRecon.GroupName] = grpRecon,
            [grpAdmin.GroupName] = grpAdmin,
        };
        foreach (var (groupName, perms) in permMatrix)
            if (groupsByName.TryGetValue(groupName, out var grp))
                foreach (var kv in perms)
                    context.GroupPermissions.Add(new GroupPermission { GroupId = grp.GroupId, ModuleKey = kv.Key, AccessLevel = kv.Value });
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

        // 22. FIM Integration Module -- fine-grained Rights catalog.
        // These are the "Right" objects the RFP's FIM AddUserToRight /
        // RemoveUserFromRight / GetAllRightsForUser functions operate on --
        // independent of (finer-grained than) the module-level Profile
        // (PrivilegeGroup) permission grants above. Mirrors the legacy
        // UserPermission names already used for the demo Maker/Checker roles.
        var rightPoCreate = new FimRight { RightCode = "PO_CREATE", RightName = "Create Purchase Orders", Description = "Initiate new purchase orders for precious metals procurement.", ModuleKey = "purchase_orders" };
        var rightPoApprove = new FimRight { RightCode = "PO_APPROVE", RightName = "Approve Purchase Orders", Description = "Checker-level approval of pending purchase orders.", ModuleKey = "purchase_orders" };
        var rightIntakeVerify = new FimRight { RightCode = "INTAKE_VERIFY", RightName = "Verify Shipment Intake", Description = "Verify weight/serials and approve incoming shipment intake.", ModuleKey = "intake" };
        var rightTransferMake = new FimRight { RightCode = "TRANSFER_MAKE", RightName = "Initiate Branch Transfer", Description = "Initiate inter-branch/vault transfer of inventory items.", ModuleKey = "purchase_orders" };
        var rightStocktakeExec = new FimRight { RightCode = "STOCKTAKE_EXECUTE", RightName = "Execute Stocktake Session", Description = "Start and scan a physical stocktake reconciliation session.", ModuleKey = "stocktake" };
        var rightUserProvision = new FimRight { RightCode = "USER_PROVISION", RightName = "Provision Users & Profiles", Description = "Create/update/remove users, profiles and rights via FIM.", ModuleKey = "user_admin" };
        var rightWorkflowDesign = new FimRight { RightCode = "WORKFLOW_DESIGN", RightName = "Author Workflow Templates", Description = "Design/modify Maker-Checker workflow templates and steps.", ModuleKey = "workflow_design" };
        var rightVaultManage = new FimRight { RightCode = "VAULT_MANAGE", RightName = "Manage Vault Locations", Description = "Create/update/delete physical vault shelf/slot locations.", ModuleKey = "vault_location" };
        context.FimRights.AddRange(rightPoCreate, rightPoApprove, rightIntakeVerify, rightTransferMake, rightStocktakeExec, rightUserProvision, rightWorkflowDesign, rightVaultManage);
        await context.SaveChangesAsync();

        // Demo direct user->right bindings (independent of the Profile/module
        // grants above), so GetAllRightsForUser/AddUserToRight are exercisable
        // out of the box.
        context.FimUserRights.AddRange(
            new FimUserRight { UserId = userMaker.UserId, RightId = rightPoCreate.RightId, GrantedBy = "SYSTEM" },
            new FimUserRight { UserId = userMaker.UserId, RightId = rightTransferMake.RightId, GrantedBy = "SYSTEM" },
            new FimUserRight { UserId = userChecker.UserId, RightId = rightPoApprove.RightId, GrantedBy = "SYSTEM" },
            new FimUserRight { UserId = userChecker.UserId, RightId = rightIntakeVerify.RightId, GrantedBy = "SYSTEM" },
            new FimUserRight { UserId = userRecon.UserId, RightId = rightStocktakeExec.RightId, GrantedBy = "SYSTEM" },
            new FimUserRight { UserId = userAdmin.UserId, RightId = rightUserProvision.RightId, GrantedBy = "SYSTEM" },
            new FimUserRight { UserId = userAdmin.UserId, RightId = rightWorkflowDesign.RightId, GrantedBy = "SYSTEM" },
            new FimUserRight { UserId = userAdmin.UserId, RightId = rightVaultManage.RightId, GrantedBy = "SYSTEM" }
        );
        await context.SaveChangesAsync();

        // 23. RFP items 5-8 demo data -- one example row per module so the
        // feature is exercisable/demonstrable immediately after a fresh seed,
        // without shipping fictitious "real" business thresholds.
        // 23. Business Rules Engine Demo Rules - Examples for every supported rule type
        var ruleTransferLimit = new BusinessRule
        {
            RuleCode = "RULE_TRANSFER_MAX_WEIGHT",
            RuleName = "Max Branch Transfer Weight Limit (5kg)",
            RuleType = "TRANSFER_LIMIT",
            ExpressionJson = "{\"all\":[{\"field\":\"weightGrams\",\"op\":\"gt\",\"value\":5000}]}",
            Severity = "BLOCK",
            Version = 1,
            IsActive = true,
            CreatedBy = "SYSTEM"
        };

        var ruleReceiptValidation = new BusinessRule
        {
            RuleCode = "RULE_INTAKE_BATCH_QTY_WARN",
            RuleName = "Large Shipment Intake Quantity Alert (>100 Items)",
            RuleType = "RECEIPT_VALIDATION",
            ExpressionJson = "{\"all\":[{\"field\":\"quantity\",\"op\":\"gt\",\"value\":100}]}",
            Severity = "WARN",
            Version = 1,
            IsActive = true,
            CreatedBy = "SYSTEM"
        };

        var ruleCustomerEligibility = new BusinessRule
        {
            RuleCode = "RULE_CUST_RESIDENCY_CHECK",
            RuleName = "Customer Non-Resident Verification Block",
            RuleType = "CUSTOMER_ELIGIBILITY",
            ExpressionJson = "{\"all\":[{\"field\":\"isResident\",\"op\":\"eq\",\"value\":false}]}",
            Severity = "BLOCK",
            Version = 1,
            IsActive = true,
            CreatedBy = "SYSTEM"
        };

        var ruleRateThreshold = new BusinessRule
        {
            RuleCode = "RULE_GOLD_RATE_SPIKE_WARN",
            RuleName = "Gold Market Rate Ceiling Alert (>30 KWD/g)",
            RuleType = "RATE_THRESHOLD",
            ExpressionJson = "{\"all\":[{\"field\":\"rate\",\"op\":\"gt\",\"value\":30}]}",
            Severity = "WARN",
            Version = 1,
            IsActive = true,
            CreatedBy = "SYSTEM"
        };

        var ruleInventoryCheck = new BusinessRule
        {
            RuleCode = "RULE_VAULT_MIN_STOCK_ALERT",
            RuleName = "Minimum Vault Stock Level Warning (<10 Items)",
            RuleType = "INVENTORY_CHECK",
            ExpressionJson = "{\"all\":[{\"field\":\"availableQty\",\"op\":\"lt\",\"value\":10}]}",
            Severity = "WARN",
            Version = 1,
            IsActive = true,
            CreatedBy = "SYSTEM"
        };

        context.BusinessRules.AddRange(
            ruleTransferLimit,
            ruleReceiptValidation,
            ruleCustomerEligibility,
            ruleRateThreshold,
            ruleInventoryCheck
        );


        var demoAlertRoute = new MonitoringAlertRoute
        {
            EventType = "ALERT",
            Severity = "CRITICAL",
            Destination = "kfh-monitoring-webhook", // maps to Monitoring:WebhookUrl in configuration
            IsActive = true
        };
        context.MonitoringAlertRoutes.Add(demoAlertRoute);



        // 25. Reporting Requirements Gap Analysis -- Cost Analysis & Variance (Item 8) demo
        // budget baseline, current calendar month, so the cost-variance report has a
        // comparison figure out of the box instead of showing "no budget configured" on a
        // freshly seeded database. Gold/Silver per-gram figures are illustrative KWD placeholders
        // for demo purposes only -- Finance/Treasury owns the real figures via the
        // master_data.write-gated cost-budgets endpoint.
        string currentPeriod = DateTime.UtcNow.ToString("yyyy-MM");
        context.CostBudgets.AddRange(
            new CostBudget { MetalTypeId = gold.MetalTypeId, Period = currentPeriod, BudgetedUnitCostPerGram = 24.50m, Currency = "KWD", CreatedBy = "SYSTEM" },
            new CostBudget { MetalTypeId = silver.MetalTypeId, Period = currentPeriod, BudgetedUnitCostPerGram = 0.30m, Currency = "KWD", CreatedBy = "SYSTEM" }
        );

        // 26. System Settings & Configuration (e.g. Reservation Checkout Lock TTL)
        context.SystemSettings.AddRange(
            new SystemSetting 
            { 
                SettingKey = "ReservationTTLSeconds", 
                SettingValue = "300", 
                Category = "RESERVATIONS", 
                Description = "Duration (in seconds) that physical gold bars remain locked in pessimistic reservation during checkout before auto-release",
                UpdatedBy = "SYSTEM",
                UpdatedAt = DateTime.UtcNow
            }
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
