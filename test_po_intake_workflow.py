#!/usr/bin/env python3
"""
End-to-End Test: PO Creation → Approval → Intake → Dashboard Display
Executes complete workflow and validates each step
"""

import requests
import json
import time
import sqlite3
from datetime import datetime, timedelta
from typing import Dict, Any, Tuple

# ============================================================================
# CONFIGURATION
# ============================================================================
BASE_URL = "http://localhost:5000/api"
TIMEOUT = 10

# Test users
TREASURER_USER = "treasury-maker"
WAREHOUSE_USER = "treasury-maker"
CHECKER_USER = "treasury-checker"
RECON_USER = "reconciliation-reconciler"

# Test data
PO_NUMBER = f"PO-TEST-{datetime.now().strftime('%Y%m%d%H%M%S')}"
LOT_NUMBER = f"LOT-TEST-{datetime.now().strftime('%Y%m%d%H%M%S')}"
VENDOR_ID = 1  # Gold Supplier Inc (Valcambi Suisse)
PRODUCT_ID = 3  # Gold 10g bar (AU-10G-SWISS)
LOCATION_ID = 1  # Zone Alpha Shelf Row 1 Slot 1

# Color codes for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

# ============================================================================
# TEST RESULTS TRACKER
# ============================================================================
class TestResults:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []
        self.data = {}

    def pass_test(self, name: str):
        print(f"{GREEN}✓ PASS{RESET}: {name}")
        self.passed += 1

    def fail_test(self, name: str, error: str):
        print(f"{RED}✗ FAIL{RESET}: {name}")
        print(f"  Error: {error}")
        self.failed += 1
        self.errors.append({"test": name, "error": error})

    def summary(self):
        total = self.passed + self.failed
        print(f"\n{BLUE}{'='*60}{RESET}")
        print(f"{BLUE}TEST SUMMARY{RESET}")
        print(f"{BLUE}{'='*60}{RESET}")
        print(f"Total Tests: {total}")
        print(f"{GREEN}Passed: {self.passed}{RESET}")
        print(f"{RED}Failed: {self.failed}{RESET}")

        if self.errors:
            print(f"\n{YELLOW}FAILURES:{RESET}")
            for err in self.errors:
                print(f"  - {err['test']}: {err['error']}")

        return self.failed == 0

results = TestResults()

# ============================================================================
# API HELPER FUNCTIONS WITH AUTHENTICATION
# ============================================================================
TOKENS = {}

def get_token(username: str) -> str:
    if username in TOKENS:
        return TOKENS[username]
    url = f"{BASE_URL}/auth/login"
    resp = requests.post(url, json={"Username": username, "Password": "Password123"}, timeout=TIMEOUT)
    if resp.status_code == 200:
        token = resp.json().get("token")
        TOKENS[username] = token
        return token
    else:
        raise Exception(f"Failed to authenticate user {username}: {resp.status_code} {resp.text}")

def make_request(method: str, endpoint: str, data: Dict = None,
                params: Dict = None, username: str = None) -> Tuple[bool, Any, str]:
    """Make HTTP request and return (success, data, error_msg)"""
    url = f"{BASE_URL}{endpoint}"
    headers = {"Content-Type": "application/json"}
    if username:
        try:
            headers["Authorization"] = f"Bearer {get_token(username)}"
        except Exception as e:
            return False, None, f"Auth failed for {username}: {str(e)}"

    try:
        if method == "GET":
            resp = requests.get(url, params=params, headers=headers, timeout=TIMEOUT)
        elif method == "POST":
            resp = requests.post(url, json=data, headers=headers, timeout=TIMEOUT)
        elif method == "PUT":
            resp = requests.put(url, json=data, headers=headers, timeout=TIMEOUT)
        else:
            return False, None, f"Unknown method: {method}"

        if resp.status_code in [200, 201]:
            try:
                return True, resp.json(), None
            except Exception:
                return True, resp.text, None
        else:
            return False, None, f"HTTP {resp.status_code}: {resp.text[:200]}"

    except requests.exceptions.RequestException as e:
        return False, None, str(e)

# ============================================================================
# PHASE 1: CREATE PURCHASE ORDER
# ============================================================================
def phase_1_create_po():
    print(f"\n{BLUE}PHASE 1: CREATE PURCHASE ORDER{RESET}")
    print(f"{BLUE}{'='*60}{RESET}")

    # Test 1.1: Check workflow template exists
    print("\n[1.1] Checking PURCHASE_ORDER workflow template...")
    success, data, error = make_request("GET", "/workflows/templates", username=TREASURER_USER)

    if not success:
        results.fail_test("1.1_workflow_exists", error)
        return False

    po_workflow = next((t for t in data if t.get('workflowType') == 'PURCHASE_ORDER'), None)
    if not po_workflow or not po_workflow.get('isActive'):
        results.fail_test("1.1_workflow_exists", "PURCHASE_ORDER workflow not active")
        return False

    results.pass_test("1.1_workflow_exists")

    # Test 1.2: Create PO
    print("\n[1.2] Creating Purchase Order...")
    po_data = {
        "poNumber": PO_NUMBER,
        "vendorId": VENDOR_ID,
        "totalWeightGrams": 100,
        "totalCost": 5000,
        "currency": "USD",
        "createdBy": TREASURER_USER,
        "items": [
            {
                "product_id": PRODUCT_ID,
                "qty": 10,
                "unit_cost": 500
            }
        ],
        "supplierInvoiceNumber": f"INV-{PO_NUMBER}",
        "supplierInvoiceDate": datetime.now().strftime("%Y-%m-%d"),
        "freightCost": 100,
        "insuranceCost": 50,
        "customsDutyCost": 25,
        "otherFeesCost": 0
    }

    success, data, error = make_request("POST", "/purchase-orders", po_data, username=TREASURER_USER)

    if not success:
        results.fail_test("1.2_create_po", error)
        return False

    if "po_id" not in data:
        results.fail_test("1.2_create_po", "No po_id in response")
        return False

    results.data['po_id'] = data['po_id']
    results.pass_test("1.2_create_po")

    # Test 1.3: Verify PO in list
    print("\n[1.3] Verifying PO in list...")
    success, data, error = make_request("GET", "/purchase-orders", username=TREASURER_USER)

    if not success:
        results.fail_test("1.3_po_in_list", error)
        return False

    po = next((p for p in data if p.get('po_id') == results.data['po_id']), None)
    if not po or po.get('status_code') != 'PENDING_APPROVAL':
        results.fail_test("1.3_po_in_list", "PO not found or wrong status")
        return False

    results.pass_test("1.3_po_in_list")
    return True

# ============================================================================
# PHASE 2: APPROVE PO THROUGH WORKFLOW (STEP 1 & STEP 2)
# ============================================================================
def phase_2_approve_po():
    print(f"\n{BLUE}PHASE 2: APPROVE PO THROUGH WORKFLOW{RESET}")
    print(f"{BLUE}{'='*60}{RESET}")

    # Test 2.1: Get workflow instance
    print("\n[2.1] Getting PURCHASE_ORDER workflow instance...")
    success, data, error = make_request("GET", "/workflows/instances/active", username=CHECKER_USER)

    if not success:
        results.fail_test("2.1_get_workflow", error)
        return False

    po_workflow = next((w for w in data if w.get('workflow_type') == 'PURCHASE_ORDER' and w.get('entity_id') == results.data['po_id']), None)
    if not po_workflow:
        results.fail_test("2.1_get_workflow", "No PURCHASE_ORDER workflow found for this PO")
        return False

    results.data['po_workflow_id'] = po_workflow['instance_id']
    results.pass_test("2.1_get_workflow")

    # Test 2.2a: Approve workflow - Step 1 by Maker
    print("\n[2.2a] Approving PO workflow Step 1 (Maker)...")
    action_data = {
        "action": "APPROVED",
        "comments": "Gold verified. Approved step 1.",
        "username": TREASURER_USER
    }

    endpoint = f"/workflows/instances/{results.data['po_workflow_id']}/action"
    success, data, error = make_request("POST", endpoint, action_data, username=TREASURER_USER)

    if not success:
        results.fail_test("2.2a_approve_workflow_step1", error)
        return False

    results.pass_test("2.2a_approve_workflow_step1")

    # Test 2.2b: Approve workflow - Step 2 by Checker
    print("\n[2.2b] Approving PO workflow Step 2 (Checker)...")
    action_data = {
        "action": "APPROVED",
        "comments": "Ledger checked. Approved step 2.",
        "username": CHECKER_USER
    }

    success, data, error = make_request("POST", endpoint, action_data, username=CHECKER_USER)

    if not success:
        results.fail_test("2.2b_approve_workflow_step2", error)
        return False

    results.pass_test("2.2b_approve_workflow_step2")

    # Test 2.3: Verify PO status changed to APPROVED
    print("\n[2.3] Verifying PO status changed to APPROVED...")
    success, data, error = make_request("GET", "/purchase-orders", username=TREASURER_USER)

    if not success:
        results.fail_test("2.3_po_status_changed", error)
        return False

    po = next((p for p in data if p.get('po_id') == results.data['po_id']), None)
    if not po or po.get('status_code') != 'APPROVED':
        results.fail_test("2.3_po_status_changed", f"Status is {po.get('status_code') if po else 'PO not found'}")
        return False

    results.pass_test("2.3_po_status_changed")
    return True

# ============================================================================
# PHASE 3: INITIATE SHIPMENT INTAKE
# ============================================================================
def phase_3_initiate_intake():
    print(f"\n{BLUE}PHASE 3: INITIATE SHIPMENT INTAKE{RESET}")
    print(f"{BLUE}{'='*60}{RESET}")

    # Test 3.1: Verify intake workflow exists
    print("\n[3.1] Checking INTAKE_SHIPMENT workflow...")
    success, data, error = make_request("GET", "/workflows/templates", username=WAREHOUSE_USER)

    if not success:
        results.fail_test("3.1_intake_workflow", error)
        return False

    intake_workflow = next((t for t in data if t.get('workflowType') == 'INTAKE_SHIPMENT'), None)
    if not intake_workflow or not intake_workflow.get('isActive'):
        results.fail_test("3.1_intake_workflow", "INTAKE_SHIPMENT workflow not active")
        return False

    results.pass_test("3.1_intake_workflow")

    # Test 3.2: Submit shipment intake
    print("\n[3.2] Submitting shipment intake...")
    items = []
    for i in range(1, 11):
        items.append({
            "serial": f"GOLD-{i:03d}-{LOT_NUMBER[-6:]}",
            "product_id": PRODUCT_ID,
            "refiner_name": "Valcambi Suisse",
            "refiner_lbma_id": "LBMA-12345",
            "assay_certificate_number": f"CERT-{i:03d}-{LOT_NUMBER[-6:]}",
            "fineness_ppt": 999.9,
            "hallmark_number": "LBMA-CERT"
        })

    intake_data = {
        "poId": results.data['po_id'],
        "lotNumber": LOT_NUMBER,
        "locationId": LOCATION_ID,
        "receivedBy": WAREHOUSE_USER,
        "items": items
    }

    success, data, error = make_request("POST", "/vault/intake", intake_data, username=WAREHOUSE_USER)

    if not success:
        results.fail_test("3.2_submit_intake", error)
        return False

    if "pending_id" not in data:
        results.fail_test("3.2_submit_intake", "No pending_id in response")
        return False

    results.data['pending_id'] = data['pending_id']
    results.pass_test("3.2_submit_intake")

    # Test 3.3: Verify intake in pending list of active workflows
    print("\n[3.3] Verifying intake in pending workflow list...")
    success, data, error = make_request("GET", "/workflows/instances/active", username=CHECKER_USER)

    if not success:
        results.fail_test("3.3_intake_pending", error)
        return False

    intake_wf = next((w for w in data if w.get('workflow_type') == 'INTAKE_SHIPMENT' and w.get('entity_id') == results.data['pending_id']), None)
    if not intake_wf:
        results.fail_test("3.3_intake_pending", f"Intake workflow not found for pending ID {results.data['pending_id']}")
        return False

    results.pass_test("3.3_intake_pending")
    return True

# ============================================================================
# PHASE 4: APPROVE INTAKE THROUGH WORKFLOW
# ============================================================================
def phase_4_approve_intake():
    print(f"\n{BLUE}PHASE 4: APPROVE INTAKE THROUGH WORKFLOW{RESET}")
    print(f"{BLUE}{'='*60}{RESET}")

    # Test 4.1: Get intake workflow instance
    print("\n[4.1] Getting INTAKE_SHIPMENT workflow instance...")
    success, data, error = make_request("GET", "/workflows/instances/active", username=CHECKER_USER)

    if not success:
        results.fail_test("4.1_get_intake_workflow", error)
        return False

    intake_workflow = next((w for w in data if w.get('workflow_type') == 'INTAKE_SHIPMENT'
                           and w.get('entity_id') == results.data['pending_id']), None)
    if not intake_workflow:
        results.fail_test("4.1_get_intake_workflow", "No matching INTAKE_SHIPMENT workflow")
        return False

    results.data['intake_workflow_id'] = intake_workflow['instance_id']
    results.pass_test("4.1_get_intake_workflow")

    # Test 4.2a: Approve intake workflow - Step 1 by Maker
    print("\n[4.2a] Approving intake workflow Step 1 (Maker)...")
    action_data = {
        "action": "APPROVED",
        "comments": "Shipment verified. Submitted step 1.",
        "username": TREASURER_USER
    }

    endpoint = f"/workflows/instances/{results.data['intake_workflow_id']}/action"
    success, data, error = make_request("POST", endpoint, action_data, username=TREASURER_USER)

    if not success:
        results.fail_test("4.2a_approve_intake_step1", error)
        return False

    results.pass_test("4.2a_approve_intake_step1")

    # Test 4.2b: Approve intake workflow - Step 2 by Checker
    print("\n[4.2b] Approving intake workflow Step 2 (Checker)...")
    action_data = {
        "action": "APPROVED",
        "comments": "Shipment verified. All items confirmed.",
        "username": CHECKER_USER
    }

    success, data, error = make_request("POST", endpoint, action_data, username=CHECKER_USER)

    if not success:
        results.fail_test("4.2b_approve_intake_step2", error)
        return False

    results.pass_test("4.2b_approve_intake_step2")
    time.sleep(1)  # Wait for database processing

    # Test 4.3: Verify workflow completed (no longer active)
    print("\n[4.3] Verifying workflow completed...")
    success, data, error = make_request("GET", "/workflows/instances/active", username=CHECKER_USER)

    if not success:
        results.fail_test("4.3_workflow_completed", error)
        return False

    active_wf = next((w for w in data if w.get('instance_id') == results.data['intake_workflow_id']), None)
    if active_wf:
        results.fail_test("4.3_workflow_completed", f"Workflow {results.data['intake_workflow_id']} is still active")
        return False

    results.pass_test("4.3_workflow_completed")
    return True

# ============================================================================
# PHASE 5: VERIFY ITEMS CREATED IN DATABASE (SQLITE)
# ============================================================================
def phase_5_verify_database():
    print(f"\n{BLUE}PHASE 5: VERIFY ITEMS CREATED IN DATABASE{RESET}")
    print(f"{BLUE}{'='*60}{RESET}")

    db_path = "d:/Projects/Gold2/backend/PMIMS.WebAPI/pmims.db"
    print(f"Connecting to SQLite: {db_path}")

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        print("\n[5.1] Checking Lot created with AcquisitionDate...")
        cursor.execute("""
            SELECT lot_id, lot_number, acquisition_date, total_items
            FROM inventory_lots
            WHERE lot_number = ?
        """, (LOT_NUMBER,))

        lot = cursor.fetchone()
        if not lot:
            results.fail_test("5.1_lot_created", "Lot not found in database")
            conn.close()
            return False

        lot_id, lot_number, acq_date, total_items = lot

        if acq_date is None:
            results.fail_test("5.1_lot_created", "⚠️ BUG FOUND: acquisition_date is NULL!")
            conn.close()
            return False

        if total_items != 10:
            results.fail_test("5.1_lot_created", f"Expected 10 items, got {total_items}")
            conn.close()
            return False

        results.data['lot_id'] = lot_id
        results.pass_test("5.1_lot_created")

        print("\n[5.2] Checking 10 items created with READY status...")
        cursor.execute("""
            SELECT COUNT(*) as count, status_code, ownership_type
            FROM inventory_items
            WHERE lot_id = ?
            GROUP BY status_code, ownership_type
        """, (lot_id,))

        items = cursor.fetchall()
        if not items:
            results.fail_test("5.2_items_created", "No items found")
            conn.close()
            return False

        count, status, ownership = items[0]
        if count != 10:
            results.fail_test("5.2_items_created", f"Expected 10 items, got {count}")
            conn.close()
            return False

        if status != 'READY':
            results.fail_test("5.2_items_created", f"⚠️ BUG FOUND: Status is {status}, expected READY")
            conn.close()
            return False

        if ownership != 'KFH_OWNED':
            results.fail_test("5.2_items_created", f"⚠️ BUG FOUND: Ownership is {ownership}, expected KFH_OWNED")
            conn.close()
            return False

        results.pass_test("5.2_items_created")

        print("\n[5.3] Checking Product/MetalType relationships...")
        cursor.execute("""
            SELECT COUNT(*) as count, mt.metal_name
            FROM inventory_items i
            JOIN metal_products m ON i.product_id = m.product_id
            JOIN metal_types mt ON m.metal_type_id = mt.metal_type_id
            WHERE i.lot_id = ? AND mt.metal_name = 'Gold'
        """, (lot_id,))

        result = cursor.fetchone()
        if not result or result[0] != 10:
            results.fail_test("5.3_metal_type", "⚠️ BUG FOUND: Metal type relationship broken")
            conn.close()
            return False

        results.pass_test("5.3_metal_type")
        conn.close()
        return True

    except Exception as e:
        results.fail_test("5_database_verification", f"SQLite Error: {str(e)}")
        return False

# ============================================================================
# PHASE 6: CHECK EXECUTIVE DASHBOARD
# ============================================================================
def phase_6_check_dashboard():
    print(f"\n{BLUE}PHASE 6: CHECK EXECUTIVE DASHBOARD{RESET}")
    print(f"{BLUE}{'='*60}{RESET}")

    # Test 6.1: Get executive board KPIs
    print("\n[6.1] Getting Executive Board KPIs...")
    today = datetime.now()
    start_date = today.replace(day=1).strftime("%Y-%m-%d")
    end_date = (today.replace(day=1) + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    end_date = end_date.strftime("%Y-%m-%d")

    success, data, error = make_request("GET", "/dashboard/executive-board",
                                       params={"startDate": start_date, "endDate": end_date},
                                       username=TREASURER_USER)

    if not success:
        results.fail_test("6.1_get_kpis", error)
        return False

    # Check key metrics
    # In original dashboard, weight of Gold 10g bar is 10g * 10 = 100g = 0.10 kg
    gold_weight = data.get('total_gold_weight_kg', 0)
    available_qty = data.get('available_qty', 0)
    
    # Check if the metrics reflect the new intake (which added 100g of gold and 10 items)
    if gold_weight < 0.10:
        results.fail_test("6.1_get_kpis",
                         f"⚠️ BUG FOUND: total_gold_weight_kg = {gold_weight}, expected >= 0.10")
        return False

    if available_qty < 10:
        results.fail_test("6.1_get_kpis",
                         f"⚠️ BUG FOUND: available_qty = {available_qty}, expected >= 10")
        return False

    results.pass_test("6.1_get_kpis")

    # Test 6.2: Check PO metrics
    print("\n[6.2] Checking PO metrics...")
    po_metrics = data.get('purchase_orders', {})
    fully_received = po_metrics.get('fully_received', 0)

    if fully_received < 1:
        results.fail_test("6.2_po_metrics",
                         f"⚠️ BUG FOUND: fully_received = {fully_received}, expected >= 1")
        return False

    results.pass_test("6.2_po_metrics")

    # Test 6.3: Verify PO status changed to RECEIVED
    print("\n[6.3] Verifying PO status = RECEIVED...")
    success, data, error = make_request("GET", "/purchase-orders", username=TREASURER_USER)

    if not success:
        results.fail_test("6.3_po_received", error)
        return False

    po = next((p for p in data if p.get('po_id') == results.data['po_id']), None)
    if not po or po.get('status_code') != 'RECEIVED':
        results.fail_test("6.3_po_received",
                         f"⚠️ BUG FOUND: PO status = {po.get('status_code') if po else 'NOT FOUND'}")
        return False

    results.pass_test("6.3_po_received")
    return True

# ============================================================================
# MAIN TEST EXECUTION
# ============================================================================
def main():
    print(f"\n{BLUE}{'='*60}{RESET}")
    print(f"END-TO-END TEST: PO → INTAKE → DASHBOARD{RESET}")
    print(f"PO Number: {PO_NUMBER}")
    print(f"Lot Number: {LOT_NUMBER}")
    print(f"{BLUE}{'='*60}{RESET}")

    # Phase 1: Create PO
    if not phase_1_create_po():
        results.summary()
        return False

    time.sleep(0.5)

    # Phase 2: Approve PO
    if not phase_2_approve_po():
        results.summary()
        return False

    time.sleep(0.5)

    # Phase 3: Initiate Intake
    if not phase_3_initiate_intake():
        results.summary()
        return False

    time.sleep(0.5)

    # Phase 4: Approve Intake
    if not phase_4_approve_intake():
        results.summary()
        return False

    time.sleep(1)

    # Phase 5: Verify Database
    if not phase_5_verify_database():
        results.summary()
        return False

    # Phase 6: Check Dashboard
    if not phase_6_check_dashboard():
        results.summary()
        return False

    # Summary
    success = results.summary()

    print(f"\n{BLUE}{'='*60}{RESET}")
    print(f"{BLUE}{'='*60}{RESET}")

    if success:
        print(f"\n{GREEN}ALL TESTS PASSED! ✓{RESET}")
        return True
    else:
        print(f"\n{RED}TESTS FAILED!{RESET}")
        return False

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
