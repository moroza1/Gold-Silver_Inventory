# Test Execution Guide - PO to Dashboard Workflow

**Purpose:** Execute complete end-to-end test and identify/fix any bugs  
**Test Date:** 2026-07-04  
**Estimated Duration:** 10-15 minutes

---

## Prerequisites

### 1. Backend Running
```bash
cd D:\Projects\Gold2\backend\PMIMS.WebAPI
dotnet run
```
**Expected:** Backend running on http://localhost:5000

### 2. Workflows Configured
Verify BOTH workflows exist and are ACTIVE:
```
GET http://localhost:5000/api/workflows/templates
```

**Must Have:**
- ✅ PURCHASE_ORDER workflow (is_active = true)
- ✅ INTAKE_SHIPMENT workflow (is_active = true)

### 3. Python Environment
```bash
pip install requests
```

---

## Step 1: Run API Test Script

### 1.1 Start the Test
```bash
cd D:\Projects\Gold2
python test_po_intake_workflow.py
```

### 1.2 Monitor Output
The script will:
- Create a PO
- Approve PO through workflow
- Submit shipment intake
- Approve intake through workflow
- Verify items appear on dashboard

**Expected Output:**
```
============================================================
END-TO-END TEST: PO → INTAKE → DASHBOARD
============================================================

PHASE 1: CREATE PURCHASE ORDER
============================================================

[1.1] Checking PURCHASE_ORDER workflow...
✓ PASS: 1.1_workflow_exists

[1.2] Creating Purchase Order...
✓ PASS: 1.2_create_po

[1.3] Verifying PO in dashboard...
✓ PASS: 1.3_po_in_list

... (more tests)

============================================================
TEST SUMMARY
============================================================
Total Tests: 20
Passed: 20
Failed: 0
```

### 1.3 Save Test Output
```bash
python test_po_intake_workflow.py > test_results.txt 2>&1
```

---

## Step 2: Verify Database

### 2.1 Connect to Database
```bash
# For SQLite (if using SQLite)
sqlite3 pmims.db < verify_test_results.sql

# For MySQL (if using MySQL)
mysql -u root -p pmims < verify_test_results.sql
```

### 2.2 Review Results
Look for these in the output:

**[5.1] Lot Created with AcquisitionDate**
```
acquisition_date: 2026-07-04 19:XX:XX   ✓ OK
```
- ❌ **BUG IF:** acquisition_date is NULL

**[5.2] Items with READY Status**
```
total_items: 10
status_code: READY   ✓ OK
ownership_type: KFH_OWNED   ✓ OK
```
- ❌ **BUG IF:** Count != 10
- ❌ **BUG IF:** status_code != READY
- ❌ **BUG IF:** ownership_type != KFH_OWNED

**[5.3] Metal Type Relationships**
```
items_with_gold_metal: 10
metal_name: Gold   ✓ OK
```
- ❌ **BUG IF:** Count != 10
- ❌ **BUG IF:** metal_name != Gold

**[6.1] PO Status**
```
po_number: PO-TEST-XXXXXX
status_code: RECEIVED   ✓ OK
```
- ❌ **BUG IF:** status_code = APPROVED (not updated)

---

## Step 3: Check Dashboard Manually

### 3.1 Open Executive Dashboard
```
http://localhost:3000/dashboard/executive  (or your frontend URL)
```

### 3.2 Verify KPI Cards Display

**Look For:**
```
┌─────────────────────────────┐
│ Proprietary Gold Stock      │
│      0.10 KG               │  ← Should show 0.10, not 0
│ ✓ Sync OK                  │
└─────────────────────────────┘

┌─────────────────────────────┐
│ Ready for Sale (Prop)       │
│      10 bars               │  ← Should show 10, not 0
│ KFH-owned bars ready       │
└─────────────────────────────┘
```

**❌ BUG IF:** Both cards show 0 or are empty

### 3.3 Check Active Inventory Registry Table

**Scroll Down to Table:**
```
SERIAL  │ METAL │ DENOM  │ LOCATION  │ STATUS
────────┼───────┼────────┼───────────┼────────
GOLD-001│ Gold  │ 10g    │ Zone A... │ READY
GOLD-002│ Gold  │ 10g    │ Zone A... │ READY
... (8 more items)
GOLD-010│ Gold  │ 10g    │ Zone A... │ READY
```

**❌ BUG IF:** Table is empty showing "No activity to show yet"

---

## Step 4: Identify Bugs

If any tests FAIL or dashboard shows 0 values, consult this table:

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| KPI cards show 0 | acquisition_date is NULL | Apply BUG #1 fix |
| Active Inventory table empty | acquisition_date filtered out | Apply BUG #1 fix |
| Items don't show in "Ready for Sale" | status_code != READY | Check line 383 in code |
| Metal type shows NULL | Product/MetalType relationship broken | Check product_id linkage |
| PO shows APPROVED not RECEIVED | PO status not updated on intake approval | Check lines 488-496 |
| No branch notifications | NotifyBranchesOfReceivedInventoryAsync not called | Check integration in IntakeInventoryItemsAsync |

---

## Step 5: Apply Fixes

### Fix #1: Lot.AcquisitionDate NULL (ALREADY APPLIED)

**File:** `InventoryRepository.cs` - Line ~350

```csharp
// SAFEGUARD: Ensure AcquisitionDate is NEVER null
if (lot.AcquisitionDate == null)
{
    lot.AcquisitionDate = DateTime.UtcNow;
}
```

**Status:** ✅ Already implemented

### Fix #2: Verify All Other Code is Correct

Review these sections:

**InventoryRepository.cs - IntakeInventoryItemsAsync:**
- Line 383: Items created with `StatusCode = "READY"` ✓
- Line 354: Ownership set to "KFH_OWNED" ✓  
- Line 488-496: PO status updated to RECEIVED ✓
- Line 530+: Branch notification called ✓

**PMIMSControllers.cs:**
- Line 363-369: Workflow validation on CreatePO ✓
- Line 514-524: Workflow validation on IntakeShipment ✓
- Line 540-551: Workflow validation on IntakeFromCustomer ✓

---

## Step 6: Re-Test After Fixes

If you applied any fixes:

### 6.1 Rebuild Backend
```bash
cd D:\Projects\Gold2\backend\PMIMS.WebAPI
dotnet build
dotnet run
```

### 6.2 Create New Test Data
Use a different lot number (just change the timestamp in the script)

### 6.3 Re-Run Test
```bash
python test_po_intake_workflow.py
```

### 6.4 Verify Results
Compare new results with expected values

---

## Troubleshooting

### Problem: "Connection refused" when running test

**Solution:**
```bash
# Check if backend is running
curl http://localhost:5000/api/workflows/templates

# If not running, start it:
cd D:\Projects\Gold2\backend
dotnet run
```

### Problem: "PURCHASE_ORDER workflow not active"

**Solution:**
1. Go to Admin Dashboard
2. Configure Workflow Templates
3. Ensure PURCHASE_ORDER is marked ACTIVE
4. Ensure INTAKE_SHIPMENT is marked ACTIVE

### Problem: Test passes but dashboard still shows 0

**Solutions:**
1. **Clear browser cache** - Ctrl+Shift+Delete
2. **Refresh page** - Ctrl+F5 (hard refresh)
3. **Check date range** - Ensure date range includes today (2026-07-04)
4. **Check if items actually created** - Run SQL verification query

### Problem: SQL script errors

**For SQLite:**
```bash
sqlite3 pmims.db ".read verify_test_results.sql"
```

**For MySQL:**
```bash
# Edit script and replace @LOT_NUMBER with actual lot from test output
mysql -u root -p pmims < verify_test_results.sql
```

---

## Expected Timeline

| Step | Time | Status |
|------|------|--------|
| Run Python test | 2-3 min | Should all pass ✓ |
| Verify database | 2-3 min | Check for bugs |
| Manual dashboard check | 2-3 min | Verify KPI cards |
| If bugs found: Apply fixes | 5-10 min | Modify code |
| Re-test if needed | 2-3 min | Verify fixes work |
| **Total** | **15 min** | - |

---

## Success Criteria

✅ **Test passes if ALL of these are true:**

1. **Python Test Script**
   - All 18 tests pass (green checkmarks)
   - No failures
   - All 10 items created

2. **Database Verification**
   - acquisition_date is NOT NULL
   - 10 items with status = READY
   - 10 items with ownership = KFH_OWNED
   - PO status = RECEIVED
   - All 10 items have metal_type = GOLD

3. **Dashboard Display**
   - Proprietary Gold Stock: **0.10 KG** (not 0)
   - Ready for Sale: **10 bars** (not 0)
   - Active Inventory Registry: **Shows all 10 items** (not empty)
   - All items show status = READY

4. **No Bugs**
   - No NULL acquisition_date
   - No missing relationships
   - No unupdated PO status

---

## Documentation

Save the following files for your records:

1. **test_results.txt** - Python test output
2. **db_verification.txt** - SQL verification results
3. **screenshot_dashboard.png** - Dashboard KPI cards
4. **screenshot_inventory_table.png** - Active Inventory Registry

---

## Next Steps After Successful Test

Once all tests pass:

1. ✅ Commit code changes
2. ✅ Deploy to staging/production
3. ✅ Run live test with real user
4. ✅ Monitor dashboard for 24 hours
5. ✅ Close test task

---

**Test Created:** 2026-07-04  
**Status:** READY FOR EXECUTION
