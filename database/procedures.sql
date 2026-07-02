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
