# End-to-End Test Case: PO Issuance → Intake → Dashboard Display

**Test Date:** 2026-07-04  
**Tester Role:** Business User (Treasurer)  
**Objective:** Verify complete workflow from PO creation through dashboard display of received inventory

---

## Test Setup

### Prerequisites
- ✅ PURCHASE_ORDER workflow template exists and is ACTIVE
- ✅ INTAKE_SHIPMENT workflow template exists and is ACTIVE  
- ✅ Maker-Checker user roles are configured
- ✅ Main Vault location exists with vault_id = 1
- ✅ Gold product exists (metal_type = "GOLD", denomination = "10g bar")
- ✅ Vendor "Gold Supplier Inc" exists with vendor_id = 1

**Current Date/Time:** 2026-07-04 19:30 UTC

---

## Phase 1: Create Purchase Order

### Test 1.1: Validate Workflow Exists Before PO Creation

**Request:**
```
GET /api/workflows/templates
```

**Expected Response:**
```json
{
  "workflow_type": "PURCHASE_ORDER",
  "is_active": true,
  "steps": [...]
}
```

**Status:** ⏳ PENDING

---

### Test 1.2: Create Purchase Order

**Request:**
```
POST /api/purchase-orders
Content-Type: application/json

{
  "poNumber": "PO-20260704-001",
  "vendorId": 1,
  "totalWeightGrams": 100,
  "totalCost": 5000,
  "currency": "USD",
  "createdBy": "treasurer-user",
  "items": [
    {
      "productId": 1,
      "orderedQuantity": 10,
      "unitCost": 500
    }
  ],
  "supplierInvoiceNumber": "INV-2026-0704",
  "supplierInvoiceDate": "2026-07-04",
  "freightCost": 100,
  "insuranceCost": 50,
  "customsDutyCost": 25,
  "otherFeesCost": 0
}
```

**Expected Response:**
```json
{
  "po_id": 1,
  "message": "Purchase Order created and staged under Maker-Checker review."
}
```

**Checks:**
- ✅ PO created with status = "PENDING_APPROVAL"
- ✅ Workflow instance created
- ✅ po_id captured for next steps

**Status:** ⏳ PENDING

---

### Test 1.3: Verify PO in Dashboard

**Request:**
```
GET /api/purchase-orders
```

**Expected Response:**
```json
[
  {
    "po_id": 1,
    "po_number": "PO-20260704-001",
    "status_code": "PENDING_APPROVAL",
    "vendor_name": "Gold Supplier Inc",
    "total_cost": 5000,
    "total_weight_grams": 100
  }
]
```

**Checks:**
- ✅ PO appears in list with PENDING_APPROVAL status
- ✅ Correct vendor name
- ✅ Cost and weight match

**Status:** ⏳ PENDING

---

## Phase 2: Approve PO Through Workflow

### Test 2.1: Get Active Workflow Instances

**Request:**
```
GET /api/workflows/instances?status=PENDING_MAKER
```

**Expected Response:**
```json
[
  {
    "instance_id": 1,
    "workflow_type": "PURCHASE_ORDER",
    "entity_id": 1,
    "status_code": "PENDING_MAKER",
    "initiated_by": "treasurer-user",
    "created_at": "2026-07-04T19:35:00Z"
  }
]
```

**Checks:**
- ✅ Workflow instance exists
- ✅ Status = PENDING_MAKER
- ✅ instance_id captured (needed for approval)

**Status:** ⏳ PENDING

---

### Test 2.2: Approve PO Workflow

**Request:**
```
POST /api/workflows/instances/1/action
Content-Type: application/json

{
  "action": "APPROVED",
  "comments": "Gold quality verified. Approved for receipt.",
  "username": "checker-user"
}
```

**Expected Response:**
```json
{
  "message": "SUCCESS"
}
```

**Checks:**
- ✅ Workflow approves without errors
- ✅ PO status changes to "APPROVED"

**Status:** ⏳ PENDING

---

### Test 2.3: Verify PO Status Changed to APPROVED

**Request:**
```
GET /api/purchase-orders?po_id=1
```

**Expected Response:**
```json
{
  "po_id": 1,
  "status_code": "APPROVED",
  ...
}
```

**Checks:**
- ✅ PO status = "APPROVED" (not PENDING_APPROVAL anymore)

**Status:** ⏳ PENDING

---

## Phase 3: Initiate Shipment Intake

### Test 3.1: Validate Intake Workflow Exists

**Request:**
```
GET /api/workflows/templates?type=INTAKE_SHIPMENT
```

**Expected Response:**
```json
{
  "workflow_type": "INTAKE_SHIPMENT",
  "is_active": true
}
```

**Status:** ⏳ PENDING

---

### Test 3.2: Submit Shipment for Intake

**Request:**
```
POST /api/vault/intake
Content-Type: application/json

{
  "poId": 1,
  "lotNumber": "LOT-20260704-GOLD-001",
  "locationId": 1,
  "receivedBy": "warehouse-user",
  "items": [
    {
      "serial": "GOLD-001",
      "product_id": 1,
      "refiner_name": "LBMA Certified Refiner",
      "refiner_lbma_id": "LBMA-12345",
      "assay_certificate_number": "CERT-2026-07-001",
      "fineness_ppt": 999.9,
      "hallmark_number": "LBMA-CERT"
    },
    {
      "serial": "GOLD-002",
      "product_id": 1,
      "refiner_name": "LBMA Certified Refiner",
      "refiner_lbma_id": "LBMA-12345",
      "assay_certificate_number": "CERT-2026-07-002",
      "fineness_ppt": 999.9,
      "hallmark_number": "LBMA-CERT"
    },
    ... (8 more items for total of 10)
  ]
}
```

**Expected Response:**
```json
{
  "pending_id": 1,
  "message": "Intake shipment verification request initiated and routed to the Maker-Checker workflow approval."
}
```

**Checks:**
- ✅ PendingIntake created with status = "PENDING_APPROVAL"
- ✅ Workflow instance created for intake
- ✅ pending_id captured

**Status:** ⏳ PENDING

---

### Test 3.3: Verify Intake in Dashboard

**Request:**
```
GET /api/pending-intakes
```

**Expected Response:**
```json
[
  {
    "pending_intake_id": 1,
    "po_id": 1,
    "lot_number": "LOT-20260704-GOLD-001",
    "status_code": "PENDING_APPROVAL",
    "location_name": "Main Vault",
    "received_by": "warehouse-user",
    "created_at": "2026-07-04T19:40:00Z"
  }
]
```

**Checks:**
- ✅ Intake appears in pending list
- ✅ Correct lot number
- ✅ Status = PENDING_APPROVAL

**Status:** ⏳ PENDING

---

## Phase 4: Approve Intake Through Workflow

### Test 4.1: Get Intake Workflow Instance

**Request:**
```
GET /api/workflows/instances?type=INTAKE_SHIPMENT&status=PENDING_MAKER
```

**Expected Response:**
```json
[
  {
    "instance_id": 2,
    "workflow_type": "INTAKE_SHIPMENT",
    "entity_id": 1,
    "status_code": "PENDING_MAKER",
    "initiated_by": "warehouse-user"
  }
]
```

**Checks:**
- ✅ Intake workflow instance exists
- ✅ instance_id = 2 (different from PO workflow)

**Status:** ⏳ PENDING

---

### Test 4.2: Approve Intake Workflow

**Request:**
```
POST /api/workflows/instances/2/action
Content-Type: application/json

{
  "action": "APPROVED",
  "comments": "Shipment verified against PO. All items accounted for and quality confirmed.",
  "username": "checker-user"
}
```

**Expected Response:**
```json
{
  "message": "SUCCESS"
}
```

**Checks:**
- ✅ Workflow approves successfully
- ✅ No errors during item creation
- ✅ Lot created with AcquisitionDate set

**Status:** ⏳ PENDING

---

### Test 4.3: Verify Intake Workflow Completed

**Request:**
```
GET /api/workflows/instances/2
```

**Expected Response:**
```json
{
  "instance_id": 2,
  "status_code": "COMPLETED",
  ...
}
```

**Checks:**
- ✅ Workflow status = "COMPLETED" (not PENDING_MAKER)

**Status:** ⏳ PENDING

---

## Phase 5: Verify Items Created in Database

### Test 5.1: Check Lot Created with Correct AcquisitionDate

**Query:**
```sql
SELECT 
  lot_id, lot_number, acquisition_date, total_items, vendor_id
FROM inventory_lots
WHERE lot_number = 'LOT-20260704-GOLD-001'
```

**Expected Result:**
```
lot_id=1, lot_number='LOT-20260704-GOLD-001', 
acquisition_date='2026-07-04 19:41:30Z', total_items=10, vendor_id=1
```

**Checks:**
- ✅ Lot exists
- ✅ **acquisition_date is NOT NULL** (THIS IS THE BUG FIX)
- ✅ acquisition_date = TODAY (2026-07-04)
- ✅ total_items = 10

**Status:** ⏳ PENDING

---

### Test 5.2: Check Inventory Items Created

**Query:**
```sql
SELECT 
  item_id, serial_number, product_id, lot_id, 
  status_code, ownership_type, location_id
FROM inventory_items
WHERE lot_id = 1
ORDER BY item_id
LIMIT 10
```

**Expected Result:**
```
item_id=1-10, serial_number=GOLD-001-GOLD-010,
product_id=1, lot_id=1,
status_code='READY', ownership_type='KFH_OWNED', location_id=1
```

**Checks:**
- ✅ 10 items created (matching ordered quantity)
- ✅ All items have serial numbers
- ✅ All items linked to correct lot_id
- ✅ **status_code = 'READY'** (not QUARANTINED or other)
- ✅ **ownership_type = 'KFH_OWNED'** (not CUSTOMER_OWNED)
- ✅ location_id = 1 (Main Vault)

**Status:** ⏳ PENDING

---

### Test 5.3: Check Product/MetalType Relationships

**Query:**
```sql
SELECT 
  i.item_id, i.serial_number,
  m.product_id, m.metal_type_id,
  mt.metal_name
FROM inventory_items i
JOIN metal_products m ON i.product_id = m.product_id
JOIN metal_types mt ON m.metal_type_id = mt.metal_type_id
WHERE i.lot_id = 1
```

**Expected Result:**
```
All 10 items should have metal_name = 'Gold'
```

**Checks:**
- ✅ All items have metal_type.metal_name = 'GOLD'
- ✅ No NULL values in metal type chain

**Status:** ⏳ PENDING

---

## Phase 6: Check Executive Dashboard

### Test 6.1: Get Executive Board KPIs

**Request:**
```
GET /api/dashboard/executive-board?startDate=2026-07-01&endDate=2026-07-31
```

**Expected Response:**
```json
{
  "total_gold_weight_kg": 0.10,
  "reserved_qty": 0,
  "custody_qty": 0,
  "main_vault_qty": 10,
  "main_vault_weight_kg": 0.10,
  "sold_qty": 0,
  "sold_weight_kg": 0,
  "available_qty": 10,
  "available_weight_kg": 0.10,
  "purchase_orders": {
    "total": 1,
    "pending_approval": 0,
    "approved": 1,
    "partial_receipt": 0,
    "fully_received": 1
  },
  "items": [
    {
      "item_id": 1,
      "serial_number": "GOLD-001",
      "status_code": "READY",
      "ownership_type": "KFH_OWNED",
      "lot_number": "LOT-20260704-GOLD-001",
      "acquisition_date": "2026-07-04"
    },
    ... (9 more items)
  ]
}
```

**Checks:**
- ✅ **total_gold_weight_kg = 0.10** (10 × 10g bars = 100g = 0.1kg)
- ✅ **available_qty = 10** (all items ready for sale)
- ✅ **available_weight_kg = 0.10**
- ✅ **main_vault_qty = 10** (location = Main Vault)
- ✅ **purchase_orders.fully_received = 1** (PO marked as received)
- ✅ **items array has 10 entries** (not empty!)
- ✅ All items have correct status, ownership, lot info

**Status:** ⏳ PENDING

---

### Test 6.2: Check KPI Cards Display Values

**UI Check - Executive Dashboard Page:**

Expected Display:
```
┌─────────────────────────────────────────────────────┐
│ EXECUTIVE DASHBOARD                                 │
├─────────────────────────────────────────────────────┤
│ [Date Range: 2026-07-01 to 2026-07-31]             │
├─────────────────────────────────────────────────────┤
│
│ ┌───────────────────┐  ┌───────────────────┐
│ │ Proprietary Stock │  │ Ready for Sale    │
│ │     0.10 KG       │  │     10 bars       │
│ │ ✓ Sync OK         │  │ KFH-owned bars    │
│ └───────────────────┘  └───────────────────┘
│
│ ┌───────────────────┐  ┌───────────────────┐
│ │ Reserved Orders   │  │ Client Custody    │
│ │     0 bars        │  │     0 bars        │
│ │ Checkout sessions │  │ Customer holdings │
│ └───────────────────┘  └───────────────────┘
│
├─────────────────────────────────────────────────────┤
│ ACTIVE INVENTORY REGISTRY                           │
├─────────────────────────────────────────────────────┤
│ Serial #  │ Metal │ Denom  │ Location  │ Status    │
├─────────────────────────────────────────────────────┤
│ GOLD-001  │ Gold  │ 10g    │ Zone A... │ READY     │
│ GOLD-002  │ Gold  │ 10g    │ Zone A... │ READY     │
│ ...       │ ...   │ ...    │ ...       │ ...       │
│ GOLD-010  │ Gold  │ 10g    │ Zone A... │ READY     │
└─────────────────────────────────────────────────────┘
```

**Checks:**
- ✅ KPI "Proprietary Stock" shows **0.10 KG** (NOT 0.00)
- ✅ KPI "Ready for Sale" shows **10** bars
- ✅ Both KPI cards are **NOT empty**
- ✅ Active Inventory Registry table **NOT empty**
- ✅ All 10 items appear in the table
- ✅ Status column shows "READY"

**Status:** ⏳ PENDING

---

### Test 6.3: Check Purchase Order Metrics

**Expected Display on Dashboard:**
```
PURCHASE ORDERS
├─ Total: 1
├─ Pending Approval: 0
├─ Approved: 1
└─ Fully Received: 1 ✓
```

**Checks:**
- ✅ PO count = 1
- ✅ Fully Received count = 1
- ✅ PO status shows as "RECEIVED" (not APPROVED)

**Status:** ⏳ PENDING

---

## Phase 7: Verify Branch Notifications

### Test 7.1: Check Audit Log for Branch Notifications

**Query:**
```sql
SELECT action_timestamp, action_type, entity_type, action_taken, comments
FROM audit_logs
WHERE action_type = 'INVENTORY' 
  AND action_taken LIKE '%notified%'
  AND action_timestamp >= '2026-07-04 19:40:00'
```

**Expected Result:**
```
action_taken='SYSTEM', comments like:
"Branch Main Vault notified: New inventory received: Lot LOT-20260704-GOLD-001, 
10 items (100g Gold) on 2026-07-04. Available for branch transfer requests."
```

**Checks:**
- ✅ Audit log entries created for branch notifications
- ✅ Lot number mentioned
- ✅ Item count mentioned (10)
- ✅ Metal type mentioned (Gold)
- ✅ Timestamp = intake approval time

**Status:** ⏳ PENDING

---

## Phase 8: Additional Functional Tests

### Test 8.1: Cost Tracking & Valuation

**Query:**
```sql
SELECT 
  lot_id, lot_number, average_unit_cost, 
  (average_unit_cost * total_items) as total_lot_value
FROM inventory_lots
WHERE lot_number = 'LOT-20260704-GOLD-001'
```

**Expected Result:**
```
average_unit_cost = 515.5  
  (5000 + 100 freight + 50 insurance + 25 duties) / 100g = 51.55 per gram
  51.55 × 10g = 515.50 per bar
  
total_lot_value = 5155 (515.5 × 10 bars)
```

**Checks:**
- ✅ Average cost includes landed costs (freight, insurance, duties)
- ✅ Cost is calculated correctly

**Status:** ⏳ PENDING

---

### Test 8.2: Check PO Status Changed to RECEIVED

**Query:**
```sql
SELECT po_id, po_number, status_code
FROM purchase_orders
WHERE po_id = 1
```

**Expected Result:**
```
po_id=1, po_number='PO-20260704-001', status_code='RECEIVED'
```

**Checks:**
- ✅ PO status changed from APPROVED to RECEIVED
- ✅ Not stuck in PARTIAL_RECEIPT

**Status:** ⏳ PENDING

---

### Test 8.3: Verify Chain of Custody Events

**Query:**
```sql
SELECT 
  event_type, item_id, location_id, recorded_by, reference_number
FROM chain_of_custody_events
WHERE reference_number LIKE 'LOT-20260704-GOLD-001%'
ORDER BY recorded_at
```

**Expected Result:**
```
event_type='RECEIVED', item_id=1-10, location_id=1,
recorded_by='warehouse-user', reference_number='LOT-20260704-GOLD-001'
```

**Checks:**
- ✅ 10 custody events created (one per item)
- ✅ Event type = 'RECEIVED'
- ✅ All items linked to correct location
- ✅ Reference number = lot number

**Status:** ⏳ PENDING

---

## Phase 9: Bug Identification & Fixes

### Potential Bugs to Watch For:

**BUG #1: Lot.AcquisitionDate is NULL** ❌ FIXED IN CODE
- **Symptom:** Items don't appear on dashboard even though they exist
- **Root Cause:** acquisition_date not set when Lot created
- **Fix Applied:** Safeguard added in IntakeInventoryItemsAsync()
- **Status:** ✅ FIXED

**BUG #2: Items created with wrong status** ⏳ TBD
- **Symptom:** Items don't show in "Ready for Sale" KPI
- **Likely Cause:** status_code not set to "READY"
- **Expected Fix:** Verify line 383 sets "READY"
- **Status:** ⏳ TESTING

**BUG #3: Product/MetalType relationship broken** ⏳ TBD
- **Symptom:** Metal type shows as NULL or wrong type
- **Likely Cause:** product_id not linked correctly
- **Expected Fix:** Verify item creation links product correctly
- **Status:** ⏳ TESTING

**BUG #4: PO not marked as RECEIVED** ⏳ TBD
- **Symptom:** PO stays in APPROVED status after intake approval
- **Likely Cause:** IntakeInventoryItemsAsync() doesn't update PO status
- **Expected Fix:** Verify PO status update logic (lines 488-496)
- **Status:** ⏳ TESTING

**BUG #5: Branch notifications not created** ⏳ TBD
- **Symptom:** No audit log entries for branch notifications
- **Likely Cause:** NotifyBranchesOfReceivedInventoryAsync() not called
- **Expected Fix:** Verify it's called in IntakeInventoryItemsAsync()
- **Status:** ⏳ TESTING

---

## Test Execution Summary

| Phase | Description | Status | Notes |
|-------|-------------|--------|-------|
| 1.1 | Workflow validation before PO | ⏳ | Should block if no PURCHASE_ORDER workflow |
| 1.2 | Create PO | ⏳ | Should succeed if workflow exists |
| 1.3 | Verify PO in list | ⏳ | Should show PENDING_APPROVAL status |
| 2.1 | Get workflow instance | ⏳ | Should find INTAKE_SHIPMENT workflow |
| 2.2 | Approve PO workflow | ⏳ | Should change status to APPROVED |
| 2.3 | Verify PO approved | ⏳ | Should show APPROVED status |
| 3.1 | Validate intake workflow | ⏳ | Should find INTAKE_SHIPMENT template |
| 3.2 | Submit shipment intake | ⏳ | Should create PendingIntake |
| 3.3 | Verify intake pending | ⏳ | Should show in pending list |
| 4.1 | Get intake workflow | ⏳ | Should find workflow instance |
| 4.2 | Approve intake | ⏳ | Should succeed and create items |
| 4.3 | Verify intake completed | ⏳ | Should show COMPLETED status |
| 5.1 | Check Lot created | ⏳ | **acquisition_date MUST NOT be NULL** |
| 5.2 | Check items created | ⏳ | 10 items with READY status |
| 5.3 | Check metal type | ⏳ | All items metal_type = GOLD |
| 6.1 | Get dashboard KPIs | ⏳ | Should show values (not 0) |
| 6.2 | Check KPI cards | ⏳ | Should display 0.10 KG and 10 bars |
| 6.3 | Check PO metrics | ⏳ | Should show fully_received = 1 |
| 7.1 | Check branch notifications | ⏳ | Should have audit log entries |
| 8.1 | Check cost calculation | ⏳ | Should include landed costs |
| 8.2 | Check PO status | ⏳ | Should be RECEIVED, not APPROVED |
| 8.3 | Check custody events | ⏳ | Should have 10 RECEIVED events |

---

## Expected Outcomes

### If ALL Tests Pass ✅
- PO workflow works end-to-end
- Intake workflow works end-to-end
- Items created with correct properties
- Dashboard displays received inventory
- KPI cards show accurate values
- All functions integrated properly

### If Tests FAIL ❌
- Identify which phase failed
- Document error messages
- Apply fixes to codebase
- Re-run failed tests

---

## Test Data Summary

**Final State After All Tests:**

```
PURCHASE ORDER
├─ PO Number: PO-20260704-001
├─ Status: RECEIVED
├─ Total Weight: 100g (0.10 kg)
├─ Total Cost: 5000 USD (+ 175 fees = 5175 landed cost)
└─ Items: 10

SHIPMENT/LOT
├─ Lot Number: LOT-20260704-GOLD-001
├─ Metal: Gold
├─ Total Items: 10
├─ Acquisition Date: 2026-07-04 19:41:30 UTC (NOT NULL!)
├─ Status: All READY
└─ Location: Main Vault

DASHBOARD SHOULD SHOW
├─ Proprietary Gold Stock: 0.10 KG ✓
├─ Ready for Sale: 10 bars ✓
├─ Available Weight: 0.10 KG ✓
└─ Active Inventory Registry: 10 items listed ✓
```

---

## How to Run This Test

1. **Prepare:** Verify all prerequisites met
2. **Execute:** Run each phase in order (1 → 9)
3. **Document:** Record actual vs expected results
4. **Report:** Document any failures
5. **Fix:** Apply code fixes for bugs found
6. **Re-test:** Re-run failed tests after fixes

---

**Test Case Version:** 1.0  
**Created:** 2026-07-04  
**Status:** READY FOR EXECUTION
