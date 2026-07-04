-- ============================================================================
-- SQL VERIFICATION SCRIPT - PO to Dashboard Workflow Test
-- ============================================================================
-- Run this script after test completion to verify database state
-- ============================================================================

-- Set this to your test lot number
SET @LOT_NUMBER = 'LOT-TEST-[YOUR_TEST_TIME]';
SET @PO_NUMBER = 'PO-TEST-[YOUR_TEST_TIME]';

-- ============================================================================
-- PHASE 5: DATABASE VERIFICATION
-- ============================================================================

-- [5.1] Check Lot Created with AcquisitionDate
-- ============================================================================
PRINT '=== [5.1] Checking Lot Created with AcquisitionDate ===';

SELECT
    lot_id,
    lot_number,
    acquisition_date,
    total_items,
    vendor_id,
    CASE WHEN acquisition_date IS NULL THEN '❌ BUG: acquisition_date is NULL!'
         ELSE '✓ OK' END as acquisition_date_status
FROM inventory_lots
WHERE lot_number = @LOT_NUMBER;

-- [5.2] Check 10 Items Created with READY Status
-- ============================================================================
PRINT '';
PRINT '=== [5.2] Checking Items Created with READY Status ===';

SELECT
    COUNT(*) as total_items,
    status_code,
    ownership_type,
    location_id,
    CASE WHEN COUNT(*) != 10 THEN '❌ BUG: Expected 10 items'
         WHEN status_code != 'READY' THEN '❌ BUG: Status not READY'
         WHEN ownership_type != 'KFH_OWNED' THEN '❌ BUG: Ownership not KFH_OWNED'
         ELSE '✓ OK' END as status
FROM inventory_items i
WHERE i.lot_id = (SELECT lot_id FROM inventory_lots WHERE lot_number = @LOT_NUMBER)
GROUP BY status_code, ownership_type, location_id;

-- Detailed item list
SELECT
    item_id,
    serial_number,
    status_code,
    ownership_type,
    product_id,
    location_id
FROM inventory_items
WHERE lot_id = (SELECT lot_id FROM inventory_lots WHERE lot_number = @LOT_NUMBER)
ORDER BY item_id;

-- [5.3] Check Product/MetalType Relationships
-- ============================================================================
PRINT '';
PRINT '=== [5.3] Checking Product/MetalType Relationships ===';

SELECT
    COUNT(*) as items_with_gold_metal,
    mt.metal_name,
    CASE WHEN COUNT(*) != 10 THEN '❌ BUG: Metal type broken'
         WHEN mt.metal_name != 'Gold' THEN '❌ BUG: Wrong metal type'
         ELSE '✓ OK' END as status
FROM inventory_items i
JOIN metal_products m ON i.product_id = m.product_id
JOIN metal_types mt ON m.metal_type_id = mt.metal_type_id
WHERE i.lot_id = (SELECT lot_id FROM inventory_lots WHERE lot_number = @LOT_NUMBER)
GROUP BY mt.metal_name;

-- ============================================================================
-- PHASE 6: PURCHASE ORDER VERIFICATION
-- ============================================================================

-- [6.1] Check PO Status Changed to RECEIVED
-- ============================================================================
PRINT '';
PRINT '=== [6.1] Checking PO Status Changed to RECEIVED ===';

SELECT
    po_id,
    po_number,
    status_code,
    total_cost,
    total_weight_grams,
    CASE WHEN status_code != 'RECEIVED' THEN '❌ BUG: Status should be RECEIVED'
         ELSE '✓ OK' END as status
FROM purchase_orders
WHERE po_number = @PO_NUMBER;

-- [6.2] Check PO Items Received Quantity
-- ============================================================================
PRINT '';
PRINT '=== [6.2] Checking PO Item Receipt Quantities ===';

SELECT
    po_id,
    product_id,
    ordered_quantity,
    received_quantity,
    CASE WHEN received_quantity < ordered_quantity THEN '⚠️ PARTIAL_RECEIPT'
         WHEN received_quantity = ordered_quantity THEN '✓ FULLY_RECEIVED'
         ELSE '❌ BUG: Received > Ordered' END as status
FROM po_items
WHERE po_id = (SELECT po_id FROM purchase_orders WHERE po_number = @PO_NUMBER);

-- ============================================================================
-- PHASE 7: BRANCH NOTIFICATIONS
-- ============================================================================

-- [7.1] Check Branch Notifications in Audit Log
-- ============================================================================
PRINT '';
PRINT '=== [7.1] Checking Branch Notifications ===';

SELECT
    action_timestamp,
    action_type,
    entity_type,
    action_taken,
    comments
FROM audit_logs
WHERE action_type = 'INVENTORY'
  AND comments LIKE CONCAT('%', @LOT_NUMBER, '%')
  AND action_timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
ORDER BY action_timestamp DESC;

-- If no results, check if notifications were created at all
IF NOT EXISTS (
    SELECT 1 FROM audit_logs
    WHERE action_type = 'INVENTORY'
      AND comments LIKE CONCAT('%', @LOT_NUMBER, '%')
)
THEN
    PRINT '⚠️ BUG: No branch notifications found in audit log';
END IF;

-- ============================================================================
-- PHASE 8: COST TRACKING & VALUATION
-- ============================================================================

-- [8.1] Check Lot Average Cost Calculation
-- ============================================================================
PRINT '';
PRINT '=== [8.1] Checking Cost Calculation ===';

SELECT
    l.lot_number,
    l.total_items,
    l.average_unit_cost,
    (l.average_unit_cost * l.total_items) as total_lot_value,
    CASE WHEN l.average_unit_cost = 0 THEN '❌ BUG: Average cost not calculated'
         ELSE '✓ OK' END as status
FROM inventory_lots l
WHERE l.lot_number = @LOT_NUMBER;

-- ============================================================================
-- PHASE 9: CHAIN OF CUSTODY
-- ============================================================================

-- [9.1] Check Chain of Custody Events
-- ============================================================================
PRINT '';
PRINT '=== [9.1] Checking Chain of Custody Events ===';

SELECT
    COUNT(*) as custody_events,
    event_type,
    CASE WHEN COUNT(*) != 10 THEN '❌ BUG: Expected 10 events'
         WHEN event_type != 'RECEIVED' THEN '❌ BUG: Event type should be RECEIVED'
         ELSE '✓ OK' END as status
FROM chain_of_custody_events
WHERE reference_number LIKE CONCAT(@LOT_NUMBER, '%')
GROUP BY event_type;

-- Detailed custody events
SELECT
    event_type,
    item_id,
    location_id,
    recorded_by,
    reference_number,
    recorded_at
FROM chain_of_custody_events
WHERE reference_number LIKE CONCAT(@LOT_NUMBER, '%')
ORDER BY recorded_at;

-- ============================================================================
-- DASHBOARD CALCULATION VERIFICATION
-- ============================================================================

-- [10.1] Calculate what Dashboard should show
-- ============================================================================
PRINT '';
PRINT '=== [10.1] Dashboard Calculation Verification ===';

SELECT
    'Proprietary Gold Stock (KG)' as metric,
    ROUND(SUM(m.denomination_id) / 1000, 2) as expected_value,
    'Should be 0.10' as note
FROM inventory_items i
JOIN metal_products m ON i.product_id = m.product_id
JOIN metal_denominations d ON m.denomination_id = d.denomination_id
WHERE i.lot_id = (SELECT lot_id FROM inventory_lots WHERE lot_number = @LOT_NUMBER)
  AND i.status_code = 'READY'
  AND i.ownership_type = 'KFH_OWNED'

UNION ALL

SELECT
    'Ready for Sale (Qty)',
    COUNT(*),
    'Should be 10'
FROM inventory_items i
WHERE i.lot_id = (SELECT lot_id FROM inventory_lots WHERE lot_number = @LOT_NUMBER)
  AND i.status_code = 'READY'
  AND i.ownership_type = 'KFH_OWNED'

UNION ALL

SELECT
    'Main Vault Qty',
    COUNT(*),
    'Should be 10'
FROM inventory_items i
WHERE i.lot_id = (SELECT lot_id FROM inventory_lots WHERE lot_number = @LOT_NUMBER)
  AND i.location_id = 1
  AND i.ownership_type = 'KFH_OWNED';

-- ============================================================================
-- FINAL SUMMARY
-- ============================================================================

PRINT '';
PRINT '=== FINAL SUMMARY ===';

SELECT
    'Database State' as check_category,
    CASE WHEN (
        SELECT COUNT(*) FROM inventory_lots WHERE lot_number = @LOT_NUMBER AND acquisition_date IS NOT NULL
    ) = 1 THEN '✓ Lot created with acquisition_date' ELSE '❌ Lot missing or NULL date' END as result

UNION ALL

SELECT
    'Database State',
    CASE WHEN (
        SELECT COUNT(*) FROM inventory_items WHERE lot_id = (SELECT lot_id FROM inventory_lots WHERE lot_number = @LOT_NUMBER) AND status_code = 'READY'
    ) = 10 THEN '✓ 10 items created with READY status' ELSE '❌ Items missing or wrong status' END

UNION ALL

SELECT
    'Database State',
    CASE WHEN (
        SELECT status_code FROM purchase_orders WHERE po_number = @PO_NUMBER
    ) = 'RECEIVED' THEN '✓ PO marked as RECEIVED' ELSE '❌ PO not marked as RECEIVED' END

UNION ALL

SELECT
    'Notifications',
    CASE WHEN (
        SELECT COUNT(*) FROM audit_logs WHERE action_type = 'INVENTORY' AND comments LIKE CONCAT('%', @LOT_NUMBER, '%')
    ) > 0 THEN '✓ Branch notifications created' ELSE '⚠️ No branch notifications found' END

UNION ALL

SELECT
    'Relationships',
    CASE WHEN (
        SELECT COUNT(*) FROM inventory_items i
        JOIN metal_products m ON i.product_id = m.product_id
        JOIN metal_types mt ON m.metal_type_id = mt.metal_type_id
        WHERE i.lot_id = (SELECT lot_id FROM inventory_lots WHERE lot_number = @LOT_NUMBER)
        AND mt.metal_name = 'Gold'
    ) = 10 THEN '✓ All items linked to GOLD metal type' ELSE '❌ Metal type relationship broken' END;

PRINT '';
PRINT 'Test verification complete!';
PRINT '';
