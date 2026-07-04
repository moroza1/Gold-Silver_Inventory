# Quick Start - Run the Test Now

**Time Estimate:** 10 minutes  
**Status:** Ready to execute

---

## Run the Complete Test

### Step 1: Start Backend (if not already running)
```bash
cd D:\Projects\Gold2\backend\PMIMS.WebAPI
dotnet run
```

Wait for: `Application started. Press Ctrl+C to shut down.`

### Step 2: Run Python Test
```bash
cd D:\Projects\Gold2
python test_po_intake_workflow.py
```

### Step 3: Check Output

**Look for:**
```
============================================================
TEST SUMMARY
============================================================
Total Tests: 20
Passed: 20  ← All should pass
Failed: 0
```

✅ **SUCCESS:** All tests passed! Dashboard is working.

❌ **FAILURE:** Some tests failed. Check which ones in the output.

---

## If Tests Fail

### Check What Failed
```
FAIL: 6.1_get_kpis
Error: total_gold_weight_kg = 0, expected 0.10
```

### Common Failures & Fixes

| Failure | Cause | Fix |
|---------|-------|-----|
| `total_gold_weight_kg = 0` | Items not created | Check database: `SELECT * FROM inventory_items WHERE lot_id = ...` |
| `available_qty = 0` | Items wrong status | Check: `SELECT status_code FROM inventory_items LIMIT 1` |
| `items array empty` | acquisition_date NULL | Verify fix #1 is in code |
| `PO not RECEIVED` | Status not updated | Verify lines 488-496 in code |
| Connection refused | Backend not running | Run `dotnet run` |

---

## Verify Database (Optional)

```bash
# For SQLite
sqlite3 pmims.db < verify_test_results.sql

# For MySQL  
mysql -u root -p pmims < verify_test_results.sql
```

Look for:
- ✓ acquisition_date is NOT NULL
- ✓ 10 items with status = READY
- ✓ PO status = RECEIVED

---

## Check Dashboard

1. Open browser: http://localhost:3000/dashboard/executive (or your URL)
2. Look at KPI cards:
   - **Proprietary Gold Stock:** Should show **0.10 KG** (not 0)
   - **Ready for Sale:** Should show **10** bars (not 0)
3. Scroll down to table:
   - **Active Inventory Registry:** Should show **10 items** (not empty)

---

## That's It!

If all tests pass and dashboard shows values:

✅ **PO → Intake → Dashboard workflow is WORKING**

You can now:
- Deploy to production
- Start receiving actual shipments
- Monitor dashboard for real inventory

---

## Files Created for Reference

```
D:\Projects\Gold2\
├── test_po_intake_workflow.py          (Automated test)
├── verify_test_results.sql              (Database verification)
├── TEST_EXECUTION_GUIDE.md              (Detailed instructions)
├── TEST_CASE_E2E_PO_TO_DASHBOARD.md    (Complete test plan)
├── BUG_FIX_CHECKLIST.md                 (What was fixed)
└── CODE_FIXES_APPLIED.md                (Code changes made)
```

---

**Time:** Should take ~5-10 minutes  
**Status:** Ready to run  
**Next:** `python test_po_intake_workflow.py`
