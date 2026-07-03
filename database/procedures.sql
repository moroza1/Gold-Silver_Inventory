-- ============================================================================
-- KFH Precious Metals Inventory Management System (PMIMS)
-- Stored Procedures for Critical Inventory Operations
-- ============================================================================

USE KFH_PMIMS;
GO

-- ============================================================================
-- 1. UTILITY: UPDATE INVENTORY BALANCE TRIGGER REPLACEMENT
-- Stored procedure to recalculate cache table balances for a specific node
-- ============================================================================
CREATE OR ALTER PROCEDURE sp_RecalculateInventoryBalance
    @LocationID INT,
    @ProductID INT,
    @OwnershipType VARCHAR(30)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ReadyQty INT = 0;
    DECLARE @ReservedQty INT = 0;
    DECLARE @SoldQty INT = 0;
    DECLARE @QuarantinedQty INT = 0;
    DECLARE @InTransitQty INT = 0;

    -- Count items directly from ledger
    SELECT 
        @ReadyQty = SUM(CASE WHEN status_code = 'READY' THEN 1 ELSE 0 END),
        @ReservedQty = SUM(CASE WHEN status_code = 'RESERVED' THEN 1 ELSE 0 END),
        @SoldQty = SUM(CASE WHEN status_code = 'SOLD' THEN 1 ELSE 0 END),
        @QuarantinedQty = SUM(CASE WHEN status_code = 'QUARANTINED' THEN 1 ELSE 0 END),
        @InTransitQty = SUM(CASE WHEN status_code = 'IN_TRANSFER' THEN 1 ELSE 0 END)
    FROM inventory_items
    WHERE location_id = @LocationID 
      AND product_id = @ProductID 
      AND ownership_type = @OwnershipType;

    -- Merge counts into cache summary table
    MERGE INTO inventory_balances AS target
    USING (SELECT @LocationID AS location_id, @ProductID AS product_id, @OwnershipType AS ownership_type) AS source
    ON (target.location_id = source.location_id AND target.product_id = source.product_id AND target.ownership_type = source.ownership_type)
    WHEN MATCHED THEN
        UPDATE SET 
            ready_for_sale_qty = ISNULL(@ReadyQty, 0),
            reserved_qty = ISNULL(@ReservedQty, 0),
            sold_qty = ISNULL(@SoldQty, 0),
            quarantined_qty = ISNULL(@QuarantinedQty, 0),
            in_transit_qty = ISNULL(@InTransitQty, 0),
            last_updated = GETDATE()
    WHEN NOT MATCHED THEN
        INSERT (location_id, product_id, ownership_type, ready_for_sale_qty, reserved_qty, sold_qty, quarantined_qty, in_transit_qty, last_updated)
        VALUES (source.location_id, source.product_id, source.ownership_type, ISNULL(@ReadyQty,0), ISNULL(@ReservedQty,0), ISNULL(@SoldQty,0), ISNULL(@QuarantinedQty,0), ISNULL(@InTransitQty,0), GETDATE());
END;
GO

-- ============================================================================
-- 2. CREATE PURCHASE ORDER (P.O.)
-- ============================================================================
CREATE OR ALTER PROCEDURE sp_CreatePurchaseOrder
    @PONumber VARCHAR(50),
    @VendorID INT,
    @TotalWeightGrams DECIMAL(12,3),
    @TotalCost DECIMAL(18,3),
    @Currency CHAR(3),
    @CreatedBy VARCHAR(100),
    @POItemIDList NVARCHAR(MAX) -- Pass JSON array of items: [{"product_id": 1, "qty": 10, "unit_cost": 25.0}]
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        -- Verify vendor Sharia compliance
        IF NOT EXISTS (SELECT 1 FROM vendors WHERE vendor_id = @VendorID AND is_sharia_compliant = 1)
        BEGIN
            THROW 50001, 'Selected vendor is not approved for Sharia transactions.', 16;
        END

        -- Insert P.O. Master record
        INSERT INTO purchase_orders (po_number, vendor_id, order_date, total_weight_grams, total_cost, currency, status_code, created_by)
        VALUES (@PONumber, @VendorID, GETDATE(), @TotalWeightGrams, @TotalCost, @Currency, 'PENDING_APPROVAL', @CreatedBy);

        DECLARE @POID INT = SCOPE_IDENTITY();

        -- Insert PO Item details from JSON
        INSERT INTO po_items (po_id, product_id, ordered_quantity, unit_cost)
        SELECT 
            @POID,
            JSON_VALUE(value, '$.product_id') AS product_id,
            JSON_VALUE(value, '$.qty') AS ordered_quantity,
            JSON_VALUE(value, '$.unit_cost') AS unit_cost
        FROM OPENJSON(@POItemIDList);

        -- Log audit trail
        INSERT INTO audit_logs (username, ip_address, module_name, action_description)
        VALUES (@CreatedBy, 'SYSTEM', 'PROCUREMENT', 'Created Purchase Order ID: ' + CAST(@POID AS VARCHAR(10)));

        COMMIT TRANSACTION;
        SELECT @POID AS po_id, 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- ============================================================================
-- 3. INTAKE INVENTORY ITEMS
-- ============================================================================
CREATE OR ALTER PROCEDURE sp_IntakeInventoryItems
    @POID INT,
    @LotNumber VARCHAR(100),
    @LocationID INT,
    @ReceivedBy VARCHAR(100),
    @SerialsList NVARCHAR(MAX) -- JSON Array: [{"serial": "AU100-999-1", "product_id": 1}]
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        -- Create Lot Record
        DECLARE @VendorID INT;
        DECLARE @AvgUnitCost DECIMAL(18,3);
        SELECT @VendorID = vendor_id, @AvgUnitCost = (total_cost / NULLIF(total_weight_grams, 0)) FROM purchase_orders WHERE po_id = @POID;

        DECLARE @TotalItems INT;
        SELECT @TotalItems = COUNT(1) FROM OPENJSON(@SerialsList);

        INSERT INTO inventory_lots (lot_number, po_id, vendor_id, acquisition_date, total_items, average_unit_cost)
        VALUES (@LotNumber, @POID, @VendorID, GETDATE(), @TotalItems, @AvgUnitCost);

        DECLARE @LotID INT = SCOPE_IDENTITY();

        -- Insert Serialized Items
        INSERT INTO inventory_items (serial_number, product_id, lot_id, location_id, ownership_type, status_code)
        SELECT 
            JSON_VALUE(value, '$.serial') AS serial_number,
            JSON_VALUE(value, '$.product_id') AS product_id,
            @LotID,
            @LocationID,
            'KFH_OWNED',
            'READY'
        FROM OPENJSON(@SerialsList);

        -- Recalculate cache table counts for all affected products
        DECLARE @ProdID INT;
        DECLARE prod_cursor CURSOR FOR 
        SELECT DISTINCT JSON_VALUE(value, '$.product_id') FROM OPENJSON(@SerialsList);

        OPEN prod_cursor;
        FETCH NEXT FROM prod_cursor INTO @ProdID;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            EXEC sp_RecalculateInventoryBalance @LocationID, @ProdID, 'KFH_OWNED';
            FETCH NEXT FROM prod_cursor INTO @ProdID;
        END
        CLOSE prod_cursor;
        DEALLOCATE prod_cursor;

        -- Update PO Status to RECEIVED
        UPDATE purchase_orders SET status_code = 'RECEIVED' WHERE po_id = @POID;

        -- Log Audit
        INSERT INTO audit_logs (username, ip_address, module_name, action_description)
        VALUES (@ReceivedBy, 'SYSTEM', 'VAULT_OPS', 'Received and spatialized ' + CAST(@TotalItems AS VARCHAR(10)) + ' bars in Lot: ' + @LotNumber);

        COMMIT TRANSACTION;
        SELECT 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- ============================================================================
-- 4. QUERY AVAILABLE STOCK
-- ============================================================================
CREATE OR ALTER PROCEDURE sp_QueryAvailableStock
    @BranchID INT = NULL,
    @MetalTypeID INT = NULL,
    @OriginCountry NVARCHAR(100) = NULL,
    @DenominationID INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT 
        b.branch_name,
        l.zone_room,
        l.shelf_row,
        l.slot_bin,
        t.metal_name,
        p.origin_country,
        d.label AS denomination,
        d.weight_grams,
        ib.ready_for_sale_qty
    FROM inventory_balances ib
    INNER JOIN inventory_locations l ON ib.location_id = l.location_id
    INNER JOIN vaults v ON l.vault_id = v.vault_id
    LEFT JOIN branches b ON l.branch_id = b.branch_id
    INNER JOIN metal_products p ON ib.product_id = p.product_id
    INNER JOIN metal_types t ON p.metal_type_id = t.metal_type_id
    INNER JOIN metal_denominations d ON p.denomination_id = d.denomination_id
    WHERE ib.ownership_type = 'KFH_OWNED'
      AND ib.ready_for_sale_qty > 0
      AND (@BranchID IS NULL OR l.branch_id = @BranchID)
      AND (@MetalTypeID IS NULL OR p.metal_type_id = @MetalTypeID)
      AND (@OriginCountry IS NULL OR p.origin_country = @OriginCountry)
      AND (@DenominationID IS NULL OR p.denomination_id = @DenominationID);
END;
GO

-- ============================================================================
-- 5. RESERVE STOCK (Pessimistic Lock & Idempotency)
-- ============================================================================
CREATE OR ALTER PROCEDURE sp_ReserveStock
    @CustomerID INT,
    @ProductID INT,
    @BranchID INT,
    @ChannelID INT,
    @IdempotencyKey VARCHAR(255),
    @TTLSeconds INT = 300,
    @ReservationToken UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

    BEGIN TRY
        -- Check idempotency
        IF EXISTS (SELECT 1 FROM reservation_requests WHERE idempotency_key = @IdempotencyKey)
        BEGIN
            SELECT @ReservationToken = reservation_token FROM reservation_requests WHERE idempotency_key = @IdempotencyKey;
            RETURN;
        END

        BEGIN TRANSACTION;

        DECLARE @AllocatedItemID INT = NULL;

        -- Find and Pessimistically Lock 1 available item
        SELECT TOP 1 @AllocatedItemID = item_id
        FROM inventory_items WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
        WHERE product_id = @ProductID
          AND status_code = 'READY'
          AND ownership_type = 'KFH_OWNED'
          AND location_id IN (SELECT location_id FROM inventory_locations WHERE branch_id = @BranchID);

        -- If no stock is available
        IF @AllocatedItemID IS NULL
        BEGIN
            THROW 50002, 'Requested metal denomination is out of stock in this branch.', 16;
        END

        -- Set state to RESERVED
        UPDATE inventory_items 
        SET status_code = 'RESERVED' 
        WHERE item_id = @AllocatedItemID;

        -- Create Reservation Record
        SET @ReservationToken = NEWID();
        DECLARE @ExpiresAt DATETIME2 = DATEADD(SECOND, @TTLSeconds, GETDATE());

        INSERT INTO reservation_requests (reservation_token, customer_id, item_id, channel_id, reserved_at, expires_at, idempotency_key, status_code)
        VALUES (@ReservationToken, @CustomerID, @AllocatedItemID, @ChannelID, GETDATE(), @ExpiresAt, @IdempotencyKey, 'ACTIVE');

        -- Update cache balances
        DECLARE @LocationID INT;
        SELECT @LocationID = location_id FROM inventory_items WHERE item_id = @AllocatedItemID;
        EXEC sp_RecalculateInventoryBalance @LocationID, @ProductID, 'KFH_OWNED';

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- ============================================================================
-- 6. CONFIRM PURCHASE WITH CUSTODY
-- ============================================================================
CREATE OR ALTER PROCEDURE sp_ConfirmPurchaseWithCustody
    @ReservationToken UNIQUEIDENTIFIER,
    @AccountID INT,
    @SalePrice DECIMAL(18,3),
    @MarkupAmount DECIMAL(18,3),
    @InvoiceNumber VARCHAR(100),
    @CustodyAgreementNumber VARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @ItemID INT;
        DECLARE @CustomerID INT;
        DECLARE @ProductID INT;
        DECLARE @LocationID INT;
        DECLARE @ChannelID INT;

        -- Retrieve and validate reservation details
        SELECT 
            @ItemID = item_id, 
            @CustomerID = customer_id,
            @ChannelID = channel_id
        FROM reservation_requests WITH (UPDLOCK, HOLDLOCK)
        WHERE reservation_token = @ReservationToken 
          AND status_code = 'ACTIVE';

        IF @ItemID IS NULL
        BEGIN
            THROW 50003, 'Invalid or expired reservation token.', 16;
        END

        SELECT @ProductID = product_id, @LocationID = location_id FROM inventory_items WHERE item_id = @ItemID;

        -- Finalize sales record
        INSERT INTO sales_orders (order_number, customer_id, account_id, item_id, channel_id, sale_price, markup_amount, invoice_number)
        VALUES (CAST(NEWID() AS VARCHAR(100)), @CustomerID, @AccountID, @ItemID, @ChannelID, @SalePrice, @MarkupAmount, @InvoiceNumber);

        -- Update Inventory Item ownership (physical location stays pinned, logical ownership transitions)
        UPDATE inventory_items
        SET ownership_type = 'CUSTOMER_OWNED', status_code = 'READY'
        WHERE item_id = @ItemID;

        -- Create customer holdings portfolio entry
        INSERT INTO customer_holdings (customer_id, account_id, item_id, allocation_date, custody_agreement_number, status_code)
        VALUES (@CustomerID, @AccountID, @ItemID, GETDATE(), @CustodyAgreementNumber, 'HELD_IN_CUSTODY');

        -- Add holding log allocation coordinates
        INSERT INTO customer_allocations (holding_id, assigned_location_id)
        VALUES (SCOPE_IDENTITY(), @LocationID);

        -- Close Reservation Record
        UPDATE reservation_requests 
        SET status_code = 'COMPLETED' 
        WHERE reservation_token = @ReservationToken;

        -- Recalculate balances
        EXEC sp_RecalculateInventoryBalance @LocationID, @ProductID, 'KFH_OWNED';
        EXEC sp_RecalculateInventoryBalance @LocationID, @ProductID, 'CUSTOMER_OWNED';

        -- Log transaction details
        INSERT INTO inventory_transactions (transaction_number, item_id, transaction_type, source_location_id, destination_location_id, source_ownership, destination_ownership, rate_used, initiated_by)
        VALUES (CAST(NEWID() AS VARCHAR(100)), @ItemID, 'SALE', @LocationID, @LocationID, 'KFH_OWNED', 'CUSTOMER_OWNED', @SalePrice, 'CHANNEL_API');

        COMMIT TRANSACTION;
        SELECT 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- ============================================================================
-- 7. CANCEL RESERVATION (TTL Expiration / Explicit Cancel)
-- ============================================================================
CREATE OR ALTER PROCEDURE sp_CancelReservation
    @ReservationToken UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @ItemID INT;
        DECLARE @ProductID INT;
        DECLARE @LocationID INT;

        SELECT @ItemID = item_id FROM reservation_requests WHERE reservation_token = @ReservationToken AND status_code = 'ACTIVE';

        IF @ItemID IS NOT NULL
        BEGIN
            SELECT @ProductID = product_id, @LocationID = location_id FROM inventory_items WHERE item_id = @ItemID;

            -- Revert item status to READY
            UPDATE inventory_items SET status_code = 'READY' WHERE item_id = @ItemID;

            -- Update reservation record
            UPDATE reservation_requests SET status_code = 'CANCELLED' WHERE reservation_token = @ReservationToken;

            -- Recalculate balances
            EXEC sp_RecalculateInventoryBalance @LocationID, @ProductID, 'KFH_OWNED';
        END

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- ============================================================================
-- 8. INITIATE BRANCH TRANSFER
-- ============================================================================
CREATE OR ALTER PROCEDURE sp_InitiateBranchTransfer
    @ItemID INT,
    @DestLocationID INT,
    @CourierInfo NVARCHAR(255),
    @InitiatedBy VARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @SrcLocationID INT;
        DECLARE @ProductID INT;
        DECLARE @Ownership VARCHAR(30);

        SELECT 
            @SrcLocationID = location_id, 
            @ProductID = product_id, 
            @Ownership = ownership_type 
        FROM inventory_items WITH (UPDLOCK, ROWLOCK)
        WHERE item_id = @ItemID AND status_code = 'READY';

        IF @SrcLocationID IS NULL
        BEGIN
            THROW 50004, 'Selected item is not ready for transfer.', 16;
        END

        -- Set status to IN_TRANSFER (Apply Transit Lock)
        UPDATE inventory_items 
        SET status_code = 'IN_TRANSFER' 
        WHERE item_id = @ItemID;

        -- Create transaction record
        DECLARE @TxNum VARCHAR(100) = CAST(NEWID() AS VARCHAR(100));
        INSERT INTO inventory_transactions (transaction_number, item_id, transaction_type, source_location_id, destination_location_id, source_ownership, destination_ownership, initiated_by)
        VALUES (@TxNum, @ItemID, 'TRANSFER', @SrcLocationID, @DestLocationID, @Ownership, @Ownership, @InitiatedBy);

        DECLARE @TxID INT = SCOPE_IDENTITY();

        -- Log courier movement
        INSERT INTO movement_transactions (transaction_id, courier_details, departure_time)
        VALUES (@TxID, @CourierInfo, GETDATE());

        -- Recalculate source balances
        EXEC sp_RecalculateInventoryBalance @SrcLocationID, @ProductID, @Ownership;

        COMMIT TRANSACTION;
        SELECT 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- ============================================================================
-- 9. EXECUTE BRANCH WITHDRAWAL (Customer physical pickup)
-- ============================================================================
CREATE OR ALTER PROCEDURE sp_ExecuteBranchWithdrawal
    @HoldingID INT,
    @BranchID INT,
    @OTP VARCHAR(10),
    @Signature NVARCHAR(255),
    @WithdrawnBy VARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @ItemID INT;
        DECLARE @ProductID INT;
        DECLARE @CurrentLocationID INT;
        DECLARE @CustomerAccountID INT;

        -- Validate holding, status, and target branch location
        SELECT 
            @ItemID = h.item_id, 
            @CustomerAccountID = h.account_id,
            @CurrentLocationID = i.location_id,
            @ProductID = i.product_id
        FROM customer_holdings h
        INNER JOIN inventory_items i ON h.item_id = i.item_id
        INNER JOIN inventory_locations l ON i.location_id = l.location_id
        WHERE h.holding_id = @HoldingID 
          AND h.status_code = 'HELD_IN_CUSTODY'
          AND l.branch_id = @BranchID;

        IF @ItemID IS NULL
        BEGIN
            THROW 50005, 'gold item portfolio cannot be found or is not currently stored at this branch.', 16;
        END

        -- Execute pickup withdrawal
        INSERT INTO withdrawal_requests (holding_id, destination_branch_id, verification_otp, withdrawn_at, recipient_signature, status_code)
        VALUES (@HoldingID, @BranchID, @OTP, GETDATE(), @Signature, 'COMPLETED');

        -- Update Inventory Item coordinates to 'Withdrawn' (logical status)
        UPDATE inventory_items
        SET status_code = 'INACTIVE', location_id = NULL -- Removed from physical slots mapping
        WHERE item_id = @ItemID;

        -- Update customer holdings portfolio entry
        UPDATE customer_holdings 
        SET status_code = 'WITHDRAWN' 
        WHERE holding_id = @HoldingID;

        -- Recalculate branch balances
        EXEC sp_RecalculateInventoryBalance @CurrentLocationID, @ProductID, 'CUSTOMER_OWNED';

        -- Log transaction details
        INSERT INTO inventory_transactions (transaction_number, item_id, transaction_type, source_location_id, destination_location_id, source_ownership, destination_ownership, initiated_by)
        VALUES (CAST(NEWID() AS VARCHAR(100)), @ItemID, 'REDEMPTION', @CurrentLocationID, NULL, 'CUSTOMER_OWNED', 'CUSTOMER_OWNED', @WithdrawnBy);

        COMMIT TRANSACTION;
        SELECT 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- ============================================================================
-- 10. STOCKTAKE: START SESSION & FREEZE LOCATIONS
-- ============================================================================
CREATE OR ALTER PROCEDURE sp_StartStocktakeSession
    @SessionCode VARCHAR(50),
    @VaultID INT,
    @InitiatedBy VARCHAR(100),
    @FreezeLocationIDList NVARCHAR(MAX) -- JSON Array: [1, 2, 15]
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        -- Create audit session
        INSERT INTO stocktake_sessions (session_code, vault_id, started_at, initiated_by, status_code)
        VALUES (@SessionCode, @VaultID, GETDATE(), @InitiatedBy, 'ACTIVE');

        DECLARE @SessionID INT = SCOPE_IDENTITY();

        -- Insert location freeze entries
        INSERT INTO stocktake_freezes (session_id, location_id, frozen_at)
        SELECT @SessionID, value, GETDATE()
        FROM OPENJSON(@FreezeLocationIDList);

        -- Set corresponding items in locations to quarantined/audit stage state
        UPDATE inventory_items
        SET status_code = 'QUARANTINED'
        WHERE location_id IN (SELECT location_id FROM stocktake_freezes WHERE session_id = @SessionID);

        -- Update balance summaries for quarantined states
        DECLARE @LocID INT;
        DECLARE @ProdID INT;
        DECLARE @Own VARCHAR(30);

        DECLARE balance_cursor CURSOR FOR 
        SELECT DISTINCT location_id, product_id, ownership_type 
        FROM inventory_items 
        WHERE location_id IN (SELECT location_id FROM stocktake_freezes WHERE session_id = @SessionID);

        OPEN balance_cursor;
        FETCH NEXT FROM balance_cursor INTO @LocID, @ProdID, @Own;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            EXEC sp_RecalculateInventoryBalance @LocID, @ProdID, @Own;
            FETCH NEXT FROM balance_cursor INTO @LocID, @ProdID, @Own;
        END
        CLOSE balance_cursor;
        DEALLOCATE balance_cursor;

        COMMIT TRANSACTION;
        SELECT @SessionID AS session_id, 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- ============================================================================
-- 11. DATA MIGRATION: COMMIT STAGED MIGRATION DATA
-- ============================================================================
CREATE OR ALTER PROCEDURE sp_ImportMigrationData
    @MigrationLogID INT,
    @ApprovedBy VARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        -- Verify log state
        IF NOT EXISTS (SELECT 1 FROM migration_logs WHERE migration_id = @MigrationLogID AND status_code = 'PENDING_APPROVAL')
        BEGIN
            THROW 50006, 'Selected migration run cannot be executed or is already processed.', 16;
        END

        -- 1. Insert any missing metal products
        -- (Assumed product codes exist in metal_products or staging entries match DB products)

        -- 2. Create historical staging lot reference
        INSERT INTO inventory_lots (lot_number, po_id, vendor_id, acquisition_date, total_items, average_unit_cost)
        SELECT 
            'MIG-LOT-' + CAST(@MigrationLogID AS VARCHAR(10)),
            NULL,
            (SELECT TOP 1 vendor_id FROM vendors), -- Fallback default vendor
            GETDATE(),
            COUNT(1),
            0.000 -- Initial setup valuation fallback
        FROM migration_staging_items;

        DECLARE @LotID INT = SCOPE_IDENTITY();

        -- 3. Insert inventory items from staging
        INSERT INTO inventory_items (serial_number, product_id, lot_id, location_id, ownership_type, status_code)
        SELECT 
            s.serial_number,
            p.product_id,
            @LotID,
            l.location_id,
            s.ownership_type,
            'READY'
        FROM migration_staging_items s
        INNER JOIN metal_products p ON s.product_code = p.product_code
        INNER JOIN vaults v ON s.vault_name = v.vault_name
        INNER JOIN inventory_locations l ON v.vault_id = l.vault_id 
                                         AND s.zone_room = l.zone_room 
                                         AND s.shelf_row = l.shelf_row 
                                         AND s.slot_bin = l.slot_bin
        WHERE s.is_valid = 1;

        -- 4. Re-calculate balances for affected nodes
        DECLARE @LocID INT;
        DECLARE @ProdID INT;
        DECLARE @Own VARCHAR(30);

        DECLARE calc_cursor CURSOR FOR 
        SELECT DISTINCT l.location_id, p.product_id, s.ownership_type
        FROM migration_staging_items s
        INNER JOIN metal_products p ON s.product_code = p.product_code
        INNER JOIN vaults v ON s.vault_name = v.vault_name
        INNER JOIN inventory_locations l ON v.vault_id = l.vault_id 
                                         AND s.zone_room = l.zone_room 
                                         AND s.shelf_row = l.shelf_row 
                                         AND s.slot_bin = l.slot_bin
        WHERE s.is_valid = 1;

        OPEN calc_cursor;
        FETCH NEXT FROM calc_cursor INTO @LocID, @ProdID, @Own;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            EXEC sp_RecalculateInventoryBalance @LocID, @ProdID, @Own;
            FETCH NEXT FROM calc_cursor INTO @LocID, @ProdID, @Own;
        END
        CLOSE calc_cursor;
        DEALLOCATE calc_cursor;

        -- 5. Clear staging records and finalize log
        DELETE FROM migration_staging_items;

        UPDATE migration_logs
        SET status_code = 'COMPLETED', approved_by = @ApprovedBy, completed_at = GETDATE()
        WHERE migration_id = @MigrationLogID;

        -- Log Audit
        INSERT INTO audit_logs (username, ip_address, module_name, action_description)
        VALUES (@ApprovedBy, 'SYSTEM', 'DATA_MIGRATION', 'Completed data migration run ID: ' + CAST(@MigrationLogID AS VARCHAR(10)));

        COMMIT TRANSACTION;
        SELECT 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- ============================================================================
-- FIM (FOREFRONT IDENTITY MANAGER) INTEGRATION MODULE
-- ----------------------------------------------------------------------------
-- SQL Server-side mirror of every function in IFimService / PMIMSControllers.
-- Fim.cs, for FIM sync scenarios that use direct database connectivity
-- instead of (or in addition to) the REST API. "User" = app_users,
-- "Profile" = privilege_groups, "Right" = fim_rights (see schema.sql,
-- section 8a/8b). Every mutating procedure appends a fim_sync_logs row via
-- sp_FIM_LogSyncChange so DetectDeltaChanges (sp_FIM_DetectDeltaChanges) can
-- report "what changed since @LastSyncTime" without scanning audit_logs.
--
-- NOTE on passwords: bcrypt/AES-256 are intentionally NOT implemented in
-- T-SQL (no native primitive, and rolling a custom one in a stored
-- procedure is a security anti-pattern). sp_FIM_SetPassword accepts an
-- already-hashed/encrypted value computed by PMIMS.Infrastructure.
-- PasswordHasher (the .NET side, used by both FimService and this proc's
-- REST equivalent) and simply persists it + the algorithm tag. Direct-DB
-- FIM connectors that cannot call the REST API must replicate the same
-- BCrypt.Net-Next / AES-256-CBC scheme before calling this procedure.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Internal helper: append one change-ledger row. Not itself an RFP function;
-- called from every mutating sp_FIM_* procedure below.
-- ----------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE sp_FIM_LogSyncChange
    @EntityType VARCHAR(30),
    @EntityKey  VARCHAR(100),
    @ChangeType VARCHAR(20),
    @ChangedBy  VARCHAR(100),
    @DetailsJson NVARCHAR(MAX) = NULL,
    @Source     VARCHAR(20) = 'APPLICATION'
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO fim_sync_logs (entity_type, entity_key, change_type, changed_by, changed_at, source, details_json)
    VALUES (@EntityType, @EntityKey, @ChangeType, @ChangedBy, GETDATE(), @Source, @DetailsJson);
END;
GO

-- ============================================================================
-- Identity Provisioning Functions
-- ============================================================================

-- GetUsers()
CREATE OR ALTER PROCEDURE sp_FIM_GetUsers
AS
BEGIN
    SET NOCOUNT ON;
    SELECT user_id, username, display_name, email, password_algorithm, is_active, created_at, created_by
    FROM app_users
    ORDER BY username;
END;
GO

-- GetNumberOfUsers()
CREATE OR ALTER PROCEDURE sp_FIM_GetNumberOfUsers
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(*) AS user_count FROM app_users;
END;
GO

-- GetUserInfo(userId) -- full attribute values: core columns + fim_user_attributes bag
CREATE OR ALTER PROCEDURE sp_FIM_GetUserInfo
    @UserID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT user_id, username, display_name, email, password_algorithm, is_active, created_at, created_by
    FROM app_users WHERE user_id = @UserID;

    SELECT attribute_name, attribute_value, updated_at
    FROM fim_user_attributes WHERE user_id = @UserID;
END;
GO

-- GetProfiles()
CREATE OR ALTER PROCEDURE sp_FIM_GetProfiles
AS
BEGIN
    SET NOCOUNT ON;
    SELECT g.group_id, g.group_name, g.description, g.is_system, g.is_active, g.created_at,
           (SELECT COUNT(*) FROM user_group_memberships m WHERE m.group_id = g.group_id) AS member_count
    FROM privilege_groups g
    ORDER BY g.group_name;
END;
GO

-- GetNumberOfProfiles()
CREATE OR ALTER PROCEDURE sp_FIM_GetNumberOfProfiles
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(*) AS profile_count FROM privilege_groups;
END;
GO

-- GetProfileInfo(profileId) -- full attribute values: core columns + module permission grants
CREATE OR ALTER PROCEDURE sp_FIM_GetProfileInfo
    @ProfileID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT g.group_id, g.group_name, g.description, g.is_system, g.is_active, g.created_at,
           (SELECT COUNT(*) FROM user_group_memberships m WHERE m.group_id = g.group_id) AS member_count
    FROM privilege_groups g WHERE g.group_id = @ProfileID;

    SELECT module_key, access_level
    FROM group_permissions WHERE group_id = @ProfileID;
END;
GO

-- GetUsersFromProfile(profileId)
CREATE OR ALTER PROCEDURE sp_FIM_GetUsersFromProfile
    @ProfileID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.user_id, u.username, u.display_name, u.email, u.is_active
    FROM user_group_memberships m
    INNER JOIN app_users u ON u.user_id = m.user_id
    WHERE m.group_id = @ProfileID
    ORDER BY u.username;
END;
GO

-- GetNumberOfUsersFromProfile(profileId)
CREATE OR ALTER PROCEDURE sp_FIM_GetNumberOfUsersFromProfile
    @ProfileID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(*) AS user_count FROM user_group_memberships WHERE group_id = @ProfileID;
END;
GO

-- GetProfilesFromUser(userId)
CREATE OR ALTER PROCEDURE sp_FIM_GetProfilesFromUser
    @UserID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT g.group_id, g.group_name, g.description, g.is_system, g.is_active
    FROM user_group_memberships m
    INNER JOIN privilege_groups g ON g.group_id = m.group_id
    WHERE m.user_id = @UserID
    ORDER BY g.group_name;
END;
GO

-- GetNumberOfProfilesFromUser(userId)
CREATE OR ALTER PROCEDURE sp_FIM_GetNumberOfProfilesFromUser
    @UserID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(*) AS profile_count FROM user_group_memberships WHERE user_id = @UserID;
END;
GO

-- AddUser(userAttributes) -- mandatory: @Username, @Email. @PasswordHash/@PasswordAlgorithm
-- pre-computed by the caller (PasswordHasher). @ExtraAttributesJson: JSON array of
-- {"name":"...","value":"..."} for any additional mandatory/custom attributes.
CREATE OR ALTER PROCEDURE sp_FIM_AddUser
    @Username VARCHAR(100),
    @DisplayName NVARCHAR(255),
    @Email VARCHAR(255),
    @PasswordHash VARCHAR(512),
    @PasswordAlgorithm VARCHAR(20) = 'BCRYPT',
    @CreatedBy VARCHAR(100) = 'FIM_INTEGRATION',
    @ExtraAttributesJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF EXISTS (SELECT 1 FROM app_users WHERE username = @Username OR email = @Email)
        BEGIN
            THROW 51001, 'A user with this username or email already exists.', 16;
        END

        INSERT INTO app_users (username, display_name, email, password_hash, password_algorithm, is_active, created_at, created_by)
        VALUES (@Username, ISNULL(NULLIF(@DisplayName, ''), @Username), @Email, @PasswordHash, @PasswordAlgorithm, 1, GETDATE(), @CreatedBy);

        DECLARE @NewUserID INT = SCOPE_IDENTITY();

        IF @ExtraAttributesJson IS NOT NULL
        BEGIN
            INSERT INTO fim_user_attributes (user_id, attribute_name, attribute_value, updated_at)
            SELECT @NewUserID, JSON_VALUE(value, '$.name'), JSON_VALUE(value, '$.value'), GETDATE()
            FROM OPENJSON(@ExtraAttributesJson);
        END

        EXEC sp_FIM_LogSyncChange @EntityType = 'USER', @EntityKey = @NewUserID, @ChangeType = 'CREATE', @ChangedBy = @CreatedBy;

        INSERT INTO audit_logs (username, ip_address, module_name, action_description)
        VALUES (@CreatedBy, 'SYSTEM', 'FIM_INTEGRATION', 'FIM AddUser: created user ''' + @Username + '''.');

        COMMIT TRANSACTION;
        SELECT @NewUserID AS user_id, 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- AddProfile(profileAttributes) -- mandatory: @ProfileName
CREATE OR ALTER PROCEDURE sp_FIM_AddProfile
    @ProfileName NVARCHAR(150),
    @Description NVARCHAR(500) = '',
    @CreatedBy VARCHAR(100) = 'FIM_INTEGRATION'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF EXISTS (SELECT 1 FROM privilege_groups WHERE group_name = @ProfileName)
        BEGIN
            THROW 51002, 'A profile with this name already exists.', 16;
        END

        INSERT INTO privilege_groups (group_name, description, is_system, is_active, created_at)
        VALUES (@ProfileName, ISNULL(@Description, ''), 0, 1, GETDATE());

        DECLARE @NewProfileID INT = SCOPE_IDENTITY();

        EXEC sp_FIM_LogSyncChange @EntityType = 'PROFILE', @EntityKey = @NewProfileID, @ChangeType = 'CREATE', @ChangedBy = @CreatedBy;

        INSERT INTO audit_logs (username, ip_address, module_name, action_description)
        VALUES (@CreatedBy, 'SYSTEM', 'FIM_INTEGRATION', 'FIM AddProfile: created profile ''' + @ProfileName + '''.');

        COMMIT TRANSACTION;
        SELECT @NewProfileID AS profile_id, 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- AddUserToProfile(userId, profileId)
CREATE OR ALTER PROCEDURE sp_FIM_AddUserToProfile
    @UserID INT,
    @ProfileID INT,
    @AssignedBy VARCHAR(100) = 'FIM_INTEGRATION'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM app_users WHERE user_id = @UserID)
            THROW 51003, 'User not found.', 16;
        IF NOT EXISTS (SELECT 1 FROM privilege_groups WHERE group_id = @ProfileID)
            THROW 51004, 'Profile not found.', 16;

        IF NOT EXISTS (SELECT 1 FROM user_group_memberships WHERE user_id = @UserID AND group_id = @ProfileID)
        BEGIN
            INSERT INTO user_group_memberships (user_id, group_id, assigned_at, assigned_by)
            VALUES (@UserID, @ProfileID, GETDATE(), @AssignedBy);

            DECLARE @EntityKey_UP VARCHAR(100) = CAST(@UserID AS VARCHAR(20)) + ':' + CAST(@ProfileID AS VARCHAR(20));
            EXEC sp_FIM_LogSyncChange @EntityType = 'USER_PROFILE', @EntityKey = @EntityKey_UP, @ChangeType = 'CREATE', @ChangedBy = @AssignedBy;
        END

        COMMIT TRANSACTION;
        SELECT 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- UpdateProfileInfo(profileId, attributes)
CREATE OR ALTER PROCEDURE sp_FIM_UpdateProfileInfo
    @ProfileID INT,
    @ProfileName NVARCHAR(150) = NULL,
    @Description NVARCHAR(500) = NULL,
    @UpdatedBy VARCHAR(100) = 'FIM_INTEGRATION'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM privilege_groups WHERE group_id = @ProfileID)
            THROW 51005, 'Profile not found.', 16;

        UPDATE privilege_groups
        SET group_name = ISNULL(NULLIF(@ProfileName, ''), group_name),
            description = ISNULL(@Description, description)
        WHERE group_id = @ProfileID;

        EXEC sp_FIM_LogSyncChange @EntityType = 'PROFILE', @EntityKey = @ProfileID, @ChangeType = 'UPDATE', @ChangedBy = @UpdatedBy;

        COMMIT TRANSACTION;
        SELECT 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- UpdateUserInfo(userId, attributes)
CREATE OR ALTER PROCEDURE sp_FIM_UpdateUserInfo
    @UserID INT,
    @DisplayName NVARCHAR(255) = NULL,
    @Email VARCHAR(255) = NULL,
    @IsActive BIT = NULL,
    @ExtraAttributesJson NVARCHAR(MAX) = NULL,
    @UpdatedBy VARCHAR(100) = 'FIM_INTEGRATION'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM app_users WHERE user_id = @UserID)
            THROW 51006, 'User not found.', 16;

        UPDATE app_users
        SET display_name = ISNULL(NULLIF(@DisplayName, ''), display_name),
            email = ISNULL(NULLIF(@Email, ''), email),
            is_active = ISNULL(@IsActive, is_active)
        WHERE user_id = @UserID;

        IF @ExtraAttributesJson IS NOT NULL
        BEGIN
            MERGE INTO fim_user_attributes AS target
            USING (
                SELECT @UserID AS user_id, JSON_VALUE(value, '$.name') AS attribute_name, JSON_VALUE(value, '$.value') AS attribute_value
                FROM OPENJSON(@ExtraAttributesJson)
            ) AS source
            ON target.user_id = source.user_id AND target.attribute_name = source.attribute_name
            WHEN MATCHED THEN UPDATE SET attribute_value = source.attribute_value, updated_at = GETDATE()
            WHEN NOT MATCHED THEN INSERT (user_id, attribute_name, attribute_value, updated_at)
                VALUES (source.user_id, source.attribute_name, source.attribute_value, GETDATE());
        END

        EXEC sp_FIM_LogSyncChange @EntityType = 'USER', @EntityKey = @UserID, @ChangeType = 'UPDATE', @ChangedBy = @UpdatedBy;

        COMMIT TRANSACTION;
        SELECT 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- RemoveUser(userId)
CREATE OR ALTER PROCEDURE sp_FIM_RemoveUser
    @UserID INT,
    @RemovedBy VARCHAR(100) = 'FIM_INTEGRATION'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM app_users WHERE user_id = @UserID)
            THROW 51007, 'User not found.', 16;

        DELETE FROM fim_user_attributes WHERE user_id = @UserID;
        DELETE FROM fim_user_rights WHERE user_id = @UserID;
        DELETE FROM user_group_memberships WHERE user_id = @UserID;
        DELETE FROM app_users WHERE user_id = @UserID;

        EXEC sp_FIM_LogSyncChange @EntityType = 'USER', @EntityKey = @UserID, @ChangeType = 'DELETE', @ChangedBy = @RemovedBy;

        INSERT INTO audit_logs (username, ip_address, module_name, action_description)
        VALUES (@RemovedBy, 'SYSTEM', 'FIM_INTEGRATION', 'FIM RemoveUser: deleted user id ' + CAST(@UserID AS VARCHAR(10)) + '.');

        COMMIT TRANSACTION;
        SELECT 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- RemoveProfile(profileId) -- refuses to remove protected system profiles (is_system = 1)
CREATE OR ALTER PROCEDURE sp_FIM_RemoveProfile
    @ProfileID INT,
    @RemovedBy VARCHAR(100) = 'FIM_INTEGRATION'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM privilege_groups WHERE group_id = @ProfileID)
            THROW 51008, 'Profile not found.', 16;
        IF EXISTS (SELECT 1 FROM privilege_groups WHERE group_id = @ProfileID AND is_system = 1)
            THROW 51009, 'Cannot remove a protected system profile via FIM.', 16;

        DELETE FROM group_permissions WHERE group_id = @ProfileID;
        DELETE FROM user_group_memberships WHERE group_id = @ProfileID;
        DELETE FROM privilege_groups WHERE group_id = @ProfileID;

        EXEC sp_FIM_LogSyncChange @EntityType = 'PROFILE', @EntityKey = @ProfileID, @ChangeType = 'DELETE', @ChangedBy = @RemovedBy;

        COMMIT TRANSACTION;
        SELECT 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- RemoveUserFromProfile(userId, profileId)
CREATE OR ALTER PROCEDURE sp_FIM_RemoveUserFromProfile
    @UserID INT,
    @ProfileID INT,
    @RemovedBy VARCHAR(100) = 'FIM_INTEGRATION'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM user_group_memberships WHERE user_id = @UserID AND group_id = @ProfileID)
            THROW 51010, 'Binding not found.', 16;

        DELETE FROM user_group_memberships WHERE user_id = @UserID AND group_id = @ProfileID;

        DECLARE @EntityKey_UP VARCHAR(100) = CAST(@UserID AS VARCHAR(20)) + ':' + CAST(@ProfileID AS VARCHAR(20));
        EXEC sp_FIM_LogSyncChange @EntityType = 'USER_PROFILE', @EntityKey = @EntityKey_UP, @ChangeType = 'DELETE', @ChangedBy = @RemovedBy;

        COMMIT TRANSACTION;
        SELECT 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- RemoveUsersFromProfile(userIds[], profileId) -- @UserIDListJson: JSON array of ints, e.g. [12,15,19]
CREATE OR ALTER PROCEDURE sp_FIM_RemoveUsersFromProfile
    @UserIDListJson NVARCHAR(MAX),
    @ProfileID INT,
    @RemovedBy VARCHAR(100) = 'FIM_INTEGRATION'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @RemovedCount INT;

        SELECT @RemovedCount = COUNT(*)
        FROM user_group_memberships m
        INNER JOIN OPENJSON(@UserIDListJson) j ON m.user_id = CAST(j.value AS INT)
        WHERE m.group_id = @ProfileID;

        DELETE m
        FROM user_group_memberships m
        INNER JOIN OPENJSON(@UserIDListJson) j ON m.user_id = CAST(j.value AS INT)
        WHERE m.group_id = @ProfileID;

        EXEC sp_FIM_LogSyncChange @EntityType = 'USER_PROFILE', @EntityKey = @ProfileID, @ChangeType = 'DELETE',
             @ChangedBy = @RemovedBy, @DetailsJson = @UserIDListJson;

        COMMIT TRANSACTION;
        SELECT ISNULL(@RemovedCount, 0) AS removed_count, 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- ============================================================================
-- Access Management Functions
-- ============================================================================

-- GetAllRights()
CREATE OR ALTER PROCEDURE sp_FIM_GetAllRights
AS
BEGIN
    SET NOCOUNT ON;
    SELECT right_id, right_code, right_name, description, module_key, is_active, created_at
    FROM fim_rights
    ORDER BY right_code;
END;
GO

-- GetNumberOfRights()
CREATE OR ALTER PROCEDURE sp_FIM_GetNumberOfRights
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(*) AS right_count FROM fim_rights;
END;
GO

-- GetRightInfo(rightId)
CREATE OR ALTER PROCEDURE sp_FIM_GetRightInfo
    @RightID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT right_id, right_code, right_name, description, module_key, is_active, created_at
    FROM fim_rights WHERE right_id = @RightID;
END;
GO

-- GetAllRightsForUser(userId)
CREATE OR ALTER PROCEDURE sp_FIM_GetAllRightsForUser
    @UserID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT r.right_id, r.right_code, r.right_name, r.description, r.module_key, r.is_active
    FROM fim_user_rights ur
    INNER JOIN fim_rights r ON r.right_id = ur.right_id
    WHERE ur.user_id = @UserID
    ORDER BY r.right_code;
END;
GO

-- GetNumberOfRightsForUser(userId)
CREATE OR ALTER PROCEDURE sp_FIM_GetNumberOfRightsForUser
    @UserID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(*) AS right_count FROM fim_user_rights WHERE user_id = @UserID;
END;
GO

-- GetAllUsersForRight(rightId)
CREATE OR ALTER PROCEDURE sp_FIM_GetAllUsersForRight
    @RightID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.user_id, u.username, u.display_name, u.email, u.is_active
    FROM fim_user_rights ur
    INNER JOIN app_users u ON u.user_id = ur.user_id
    WHERE ur.right_id = @RightID
    ORDER BY u.username;
END;
GO

-- GetNumberOfUsersForRight(rightId)
CREATE OR ALTER PROCEDURE sp_FIM_GetNumberOfUsersForRight
    @RightID INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT COUNT(*) AS user_count FROM fim_user_rights WHERE right_id = @RightID;
END;
GO

-- AddUserToRight(userId, rightId)
CREATE OR ALTER PROCEDURE sp_FIM_AddUserToRight
    @UserID INT,
    @RightID INT,
    @GrantedBy VARCHAR(100) = 'FIM_INTEGRATION'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM app_users WHERE user_id = @UserID)
            THROW 51011, 'User not found.', 16;
        IF NOT EXISTS (SELECT 1 FROM fim_rights WHERE right_id = @RightID)
            THROW 51012, 'Right not found.', 16;

        IF NOT EXISTS (SELECT 1 FROM fim_user_rights WHERE user_id = @UserID AND right_id = @RightID)
        BEGIN
            INSERT INTO fim_user_rights (user_id, right_id, granted_at, granted_by)
            VALUES (@UserID, @RightID, GETDATE(), @GrantedBy);

            DECLARE @EntityKey_UR VARCHAR(100) = CAST(@UserID AS VARCHAR(20)) + ':' + CAST(@RightID AS VARCHAR(20));
            EXEC sp_FIM_LogSyncChange @EntityType = 'USER_RIGHT', @EntityKey = @EntityKey_UR, @ChangeType = 'CREATE', @ChangedBy = @GrantedBy;
        END

        COMMIT TRANSACTION;
        SELECT 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- RemoveUserFromRight(userId, rightId)
CREATE OR ALTER PROCEDURE sp_FIM_RemoveUserFromRight
    @UserID INT,
    @RightID INT,
    @RemovedBy VARCHAR(100) = 'FIM_INTEGRATION'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM fim_user_rights WHERE user_id = @UserID AND right_id = @RightID)
            THROW 51013, 'Right grant not found.', 16;

        DELETE FROM fim_user_rights WHERE user_id = @UserID AND right_id = @RightID;

        DECLARE @EntityKey_UR VARCHAR(100) = CAST(@UserID AS VARCHAR(20)) + ':' + CAST(@RightID AS VARCHAR(20));
        EXEC sp_FIM_LogSyncChange @EntityType = 'USER_RIGHT', @EntityKey = @EntityKey_UR, @ChangeType = 'DELETE', @ChangedBy = @RemovedBy;

        COMMIT TRANSACTION;
        SELECT 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- ============================================================================
-- Password Management Functions
-- ============================================================================

-- SetPassword(userId, password, encryptionAlgorithm) -- @PasswordHash is the
-- already-hashed/encrypted value (BCrypt.Net-Next hash, or AES-256-CBC
-- ciphertext base64) computed by PMIMS.Infrastructure.PasswordHasher; this
-- procedure never sees or stores a plaintext password.
CREATE OR ALTER PROCEDURE sp_FIM_SetPassword
    @UserID INT,
    @PasswordHash VARCHAR(512),
    @PasswordAlgorithm VARCHAR(20) = 'BCRYPT', -- BCRYPT (default) | AES256
    @ChangedBy VARCHAR(100) = 'FIM_INTEGRATION'
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM app_users WHERE user_id = @UserID)
            THROW 51014, 'User not found.', 16;
        IF @PasswordAlgorithm NOT IN ('BCRYPT', 'AES256', 'SHA256')
            THROW 51015, 'Unsupported password encryption algorithm.', 16;

        UPDATE app_users
        SET password_hash = @PasswordHash, password_algorithm = @PasswordAlgorithm
        WHERE user_id = @UserID;

        EXEC sp_FIM_LogSyncChange @EntityType = 'PASSWORD', @EntityKey = @UserID, @ChangeType = 'UPDATE',
             @ChangedBy = @ChangedBy, @DetailsJson = N'{"algorithm":"' + @PasswordAlgorithm + '"}';

        INSERT INTO audit_logs (username, ip_address, module_name, action_description)
        VALUES (@ChangedBy, 'SYSTEM', 'FIM_INTEGRATION', 'FIM SetPassword: credential reset for user id ' + CAST(@UserID AS VARCHAR(10)) + ' using ' + @PasswordAlgorithm + '.');

        COMMIT TRANSACTION;
        SELECT 'SUCCESS' AS result;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- ============================================================================
-- Connectivity Support & Delta-Sync Change Detection
-- ============================================================================

-- DetectDeltaChanges(lastSyncTime)
CREATE OR ALTER PROCEDURE sp_FIM_DetectDeltaChanges
    @LastSyncTime DATETIME2
AS
BEGIN
    SET NOCOUNT ON;
    SELECT sync_log_id, entity_type, entity_key, change_type, changed_at, changed_by, source, details_json
    FROM fim_sync_logs
    WHERE changed_at > @LastSyncTime
    ORDER BY changed_at ASC;
END;
GO

-- ============================================================================
-- RFP ITEMS 5-8: RULES ENGINE, AUDIT TRAIL, NOTIFICATIONS, MONITORING
-- ----------------------------------------------------------------------------
-- The live application path for these features runs through EF Core LINQ in
-- InventoryRepository.cs (the "stored-proc emulation" pattern this codebase
-- already uses for AppUser/PrivilegeGroup-style admin CRUD -- see AGENTS.md).
-- The procedures below are the SQL Server-side reference/direct-DB-access
-- mirror for scenarios that need to bypass the application tier entirely
-- (batch jobs, DBA tooling, a future FIM-style direct sync client).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enhanced Audit Trail UI (item 6): parameterized, dynamic-but-safe search.
-- Every predicate is bound via sp_executesql parameters -- never string-
-- concatenated values -- which is exactly the pattern Item 11 (Remove Inline
-- Queries) asks every remaining ad-hoc query in the app tier to converge on.
-- ----------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE sp_SearchAuditLogs
    @Query NVARCHAR(200) = NULL,
    @Username VARCHAR(100) = NULL,
    @ModuleName VARCHAR(100) = NULL,
    @EntityType VARCHAR(50) = NULL,
    @FromDate DATETIME2 = NULL,
    @ToDate DATETIME2 = NULL,
    @Page INT = 1,
    @PageSize INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Offset INT = (CASE WHEN @Page < 1 THEN 0 ELSE @Page - 1 END) * (CASE WHEN @PageSize < 1 THEN 50 ELSE @PageSize END);
    DECLARE @Take INT = CASE WHEN @PageSize < 1 THEN 50 ELSE @PageSize END;

    DECLARE @Sql NVARCHAR(MAX) = N'
        SELECT log_id, timestamp, username, ip_address, module_name, action_description,
               entity_type, entity_id, row_hash,
               COUNT(*) OVER() AS total_count
        FROM audit_logs
        WHERE (@Query IS NULL OR action_description LIKE ''%'' + @Query + ''%'')
          AND (@Username IS NULL OR username = @Username)
          AND (@ModuleName IS NULL OR module_name = @ModuleName)
          AND (@EntityType IS NULL OR entity_type = @EntityType)
          AND (@FromDate IS NULL OR timestamp >= @FromDate)
          AND (@ToDate IS NULL OR timestamp <= @ToDate)
        ORDER BY timestamp DESC
        OFFSET @Offset ROWS FETCH NEXT @Take ROWS ONLY;';

    EXEC sp_executesql @Sql,
        N'@Query NVARCHAR(200), @Username VARCHAR(100), @ModuleName VARCHAR(100), @EntityType VARCHAR(50), @FromDate DATETIME2, @ToDate DATETIME2, @Offset INT, @Take INT',
        @Query, @Username, @ModuleName, @EntityType, @FromDate, @ToDate, @Offset, @Take;
END;
GO

-- ----------------------------------------------------------------------------
-- Dynamic Business Validation Rules Engine (item 5): direct-DB evaluation for
-- the common case -- a single numeric field compared against a threshold,
-- e.g. {"field":"weightGrams","op":"lte","value":5000}. Composite {"all"/
-- "any"} predicate trees are evaluated by RuleEngineService (C#) at the
-- application tier; this proc covers the majority "one threshold" case for
-- callers that only have direct database connectivity.
-- ----------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE sp_EvaluateBusinessRule
    @RuleId INT,
    @ActualValue DECIMAL(18,4),
    @EntityType VARCHAR(50),
    @EntityId VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ExpressionJson NVARCHAR(MAX), @Severity VARCHAR(10);
    SELECT @ExpressionJson = expression_json, @Severity = severity
    FROM business_rules WHERE rule_id = @RuleId AND is_active = 1;

    IF @ExpressionJson IS NULL
    BEGIN
        THROW 52001, 'Rule not found or not active.', 16;
    END

    DECLARE @Op VARCHAR(10) = JSON_VALUE(@ExpressionJson, '$.op');
    DECLARE @Threshold DECIMAL(18,4) = TRY_CAST(JSON_VALUE(@ExpressionJson, '$.value') AS DECIMAL(18,4));

    DECLARE @Matched BIT = 0;
    IF @Threshold IS NOT NULL
    BEGIN
        SET @Matched = CASE @Op
            WHEN 'eq'  THEN CASE WHEN @ActualValue = @Threshold THEN 1 ELSE 0 END
            WHEN 'neq' THEN CASE WHEN @ActualValue <> @Threshold THEN 1 ELSE 0 END
            WHEN 'gt'  THEN CASE WHEN @ActualValue > @Threshold THEN 1 ELSE 0 END
            WHEN 'gte' THEN CASE WHEN @ActualValue >= @Threshold THEN 1 ELSE 0 END
            WHEN 'lt'  THEN CASE WHEN @ActualValue < @Threshold THEN 1 ELSE 0 END
            WHEN 'lte' THEN CASE WHEN @ActualValue <= @Threshold THEN 1 ELSE 0 END
            ELSE 0
        END;
    END

    DECLARE @Result VARCHAR(10) = CASE WHEN @Matched = 1 THEN (CASE WHEN @Severity = 'BLOCK' THEN 'FAIL' ELSE 'WARN' END) ELSE 'PASS' END;

    INSERT INTO business_rule_evaluations (rule_id, entity_type, entity_id, result, evaluated_at, context_json)
    VALUES (@RuleId, @EntityType, @EntityId, @Result, GETDATE(), N'{"actualValue":' + CAST(@ActualValue AS NVARCHAR(50)) + '}');

    SELECT @Result AS result, @Severity AS severity;
END;
GO

-- ----------------------------------------------------------------------------
-- Automatic Management Email Notifications (item 7): due-subscription lookup
-- for a direct-DB scheduler (the live app instead uses NotificationSchedulerService
-- + the Cronos library for cron evaluation, since T-SQL has no native cron parser).
-- This proc covers the simple "hours since last run" cadence case.
-- ----------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE sp_GetDueNotificationSubscriptions
    @MinHoursSinceLastRun INT = 24
AS
BEGIN
    SET NOCOUNT ON;
    SELECT subscription_id, distribution_list_email, report_type, schedule_cron, format, last_run_at
    FROM notification_subscriptions
    WHERE is_active = 1
      AND (last_run_at IS NULL OR last_run_at <= DATEADD(HOUR, -@MinHoursSinceLastRun, GETDATE()));
END;
GO

-- ----------------------------------------------------------------------------
-- KFH Existing Monitoring Tool Integration (item 8): SLA snapshot for direct-DB
-- polling by the external monitoring tool (mirrors GET /api/monitoring/sla-metrics).
-- ----------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE sp_GetSlaMetricsSnapshot
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Cutoff24h DATETIME2 = DATEADD(HOUR, -24, GETDATE());

    SELECT
        (SELECT COUNT(*) FROM workflow_instances WHERE status_code = 'PENDING_MAKER') AS pending_workflow_instances,
        (SELECT COUNT(*) FROM mismatch_cases WHERE status_code = 'OPEN') AS open_mismatch_cases,
        (SELECT ISNULL(SUM(total_discrepancies), 0) FROM reconciliation_runs WHERE run_timestamp >= @Cutoff24h) AS reconciliation_breaks_last_24h,
        (SELECT COUNT(*) FROM monitoring_events WHERE event_type = 'ALERT' AND occurred_at >= @Cutoff24h) AS alert_events_last_24h;
END;
GO
