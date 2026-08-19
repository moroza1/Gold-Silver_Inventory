#!/usr/bin/env python3
"""
End-to-End Test: Direct Intake (No PO) -> Approval -> Dashboard Display
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
LOT_NUMBER = f"LOT-DIRECT-{datetime.now().strftime('%Y%m%d%H%M%S')}"
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
# PHASE 1: INITIATE DIRECT INTAKE (NO PO)
# ============================================================================
def phase_1_initiate_intake():
    print(f"\n{BLUE}PHASE 1: INITIATE DIRECT INTAKE (NO PO){RESET}")
    print(f"{BLUE}{'='*60}{RESET}")

    # Test 1.1: Verify intake workflow template exists
    print("\n[1.1] Checking INTAKE_SHIPMENT workflow...")
    success, data, error = make_request("GET", "/workflows/templates", username=WAREHOUSE_USER)

    if not success:
        results.fail_test("1.1_intake_workflow", error)
        return False

    intake_workflow = next((t for t in data if t.get('workflowType') == 'INTAKE_SHIPMENT'), None)
    if not intake_workflow or not intake_workflow.get('isActive'):
        results.fail_test("1.1_intake_workflow", "INTAKE_SHIPMENT workflow not active")
        return False

    results.pass_test("1.1_intake_workflow")

    # Test 1.2: Submit direct intake (poId = None)
    print("\n[1.2] Submitting direct shipment intake...")
    items = []
    for i in range(1, 6):
        items.append({
            "serial": f"DIR-{i:03d}-{LOT_NUMBER[-6:]}",
            "product_id": PRODUCT_ID,
            "refiner_name": "Valcambi Suisse",
            "refiner_lbma_id": "LBMA-12345",
            "assay_certificate_number": f"CERT-DIR-{i:03d}-{LOT_NUMBER[-6:]}",
            "fineness_ppt": 999.9,
            "hallmark_number": "LBMA-CERT"
        })

    intake_data = {
        "poId": None,
        "lotNumber": LOT_NUMBER,
        "locationId": LOCATION_ID,
        "receivedBy": WAREHOUSE_USER,
        "items": items
    }

    success, data, error = make_request("POST", "/vault/intake", intake_data, username=WAREHOUSE_USER)

    if not success:
        results.fail_test("1.2_submit_direct_intake", error)
        return False

    if "pending_id" not in data:
        results.fail_test("1.2_submit_direct_intake", "No pending_id in response")
        return False

    results.data['pending_id'] = data['pending_id']
    results.pass_test("1.2_submit_direct_intake")

    # Test 1.3: Verify intake in pending list of active workflows
    print("\n[1.3] Verifying direct intake in pending workflow list...")
    success, data, error = make_request("GET", "/workflows/instances/active", username=CHECKER_USER)

    if not success:
        results.fail_test("1.3_direct_intake_pending", error)
        return False

    intake_wf = next((w for w in data if w.get('workflow_type') == 'INTAKE_SHIPMENT' and w.get('entity_id') == results.data['pending_id']), None)
    if not intake_wf:
        results.fail_test("1.3_direct_intake_pending", f"Intake workflow not found for pending ID {results.data['pending_id']}")
        return False

    results.data['intake_workflow_id'] = intake_wf['instance_id']
    results.pass_test("1.3_direct_intake_pending")
    return True

# ============================================================================
# PHASE 2: APPROVE INTAKE THROUGH WORKFLOW
# ============================================================================
def phase_2_approve_intake():
    print(f"\n{BLUE}PHASE 2: APPROVE DIRECT INTAKE{RESET}")
    print(f"{BLUE}{'='*60}{RESET}")

    endpoint = f"/workflows/instances/{results.data['intake_workflow_id']}/action"

    # Test 2.1: Approve intake workflow - Step 1 by Maker
    print("\n[2.1] Approving direct intake workflow Step 1 (Maker)...")
    action_data = {
        "action": "APPROVED",
        "comments": "Direct shipment verified. Submitted step 1.",
        "username": TREASURER_USER
    }

    success, data, error = make_request("POST", endpoint, action_data, username=TREASURER_USER)

    if not success:
        results.fail_test("2.1_approve_intake_step1", error)
        return False

    results.pass_test("2.1_approve_intake_step1")

    # Test 2.2: Approve intake workflow - Step 2 by Checker
    print("\n[2.2] Approving direct intake workflow Step 2 (Checker)...")
    action_data = {
        "action": "APPROVED",
        "comments": "Direct shipment verified. All items confirmed.",
        "username": CHECKER_USER
    }

    success, data, error = make_request("POST", endpoint, action_data, username=CHECKER_USER)

    if not success:
        results.fail_test("2.2_approve_intake_step2", error)
        return False

    results.pass_test("2.2_approve_intake_step2")
    time.sleep(1)  # Wait for database processing

    # Test 2.3: Verify workflow completed (no longer active)
    print("\n[2.3] Verifying workflow completed...")
    success, data, error = make_request("GET", "/workflows/instances/active", username=CHECKER_USER)

    if not success:
        results.fail_test("2.3_workflow_completed", error)
        return False

    active_wf = next((w for w in data if w.get('instance_id') == results.data['intake_workflow_id']), None)
    if active_wf:
        results.fail_test("2.3_workflow_completed", f"Workflow {results.data['intake_workflow_id']} is still active")
        return False

    results.pass_test("2.3_workflow_completed")
    return True

# ============================================================================
# PHASE 3: VERIFY ITEMS IN SQLITE DATABASE
# ============================================================================
def phase_3_verify_database():
    print(f"\n{BLUE}PHASE 3: VERIFY ITEMS IN DATABASE{RESET}")
    print(f"{BLUE}{'='*60}{RESET}")

    db_path = "d:/Projects/Gold2/backend/PMIMS.WebAPI/pmims.db"
    print(f"Connecting to SQLite: {db_path}")

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        print("\n[3.1] Checking Lot created for direct intake...")
        cursor.execute("""
            SELECT lot_id, lot_number, acquisition_date, total_items, po_id
            FROM inventory_lots
            WHERE lot_number = ?
        """, (LOT_NUMBER,))

        lot = cursor.fetchone()
        if not lot:
            results.fail_test("3.1_lot_created", "Lot not found in database")
            conn.close()
            return False

        lot_id, lot_number, acq_date, total_items, po_id = lot

        if acq_date is None:
            results.fail_test("3.1_lot_created", "acquisition_date is NULL!")
            conn.close()
            return False

        if total_items != 5:
            results.fail_test("3.1_lot_created", f"Expected 5 items, got {total_items}")
            conn.close()
            return False

        if po_id is not None:
            results.fail_test("3.1_lot_created", f"Expected po_id to be NULL, got {po_id}")
            conn.close()
            return False

        results.data['lot_id'] = lot_id
        results.pass_test("3.1_lot_created")

        print("\n[3.2] Checking 5 items created with READY status and KFH_OWNED ownership...")
        cursor.execute("""
            SELECT COUNT(*) as count, status_code, ownership_type
            FROM inventory_items
            WHERE lot_id = ?
            GROUP BY status_code, ownership_type
        """, (lot_id,))

        items = cursor.fetchall()
        if not items:
            results.fail_test("3.2_items_created", "No items found")
            conn.close()
            return False

        count, status, ownership = items[0]
        if count != 5:
            results.fail_test("3.2_items_created", f"Expected 5 items, got {count}")
            conn.close()
            return False

        if status != 'READY':
            results.fail_test("3.2_items_created", f"Status is {status}, expected READY")
            conn.close()
            return False

        if ownership != 'KFH_OWNED':
            results.fail_test("3.2_items_created", f"Ownership is {ownership}, expected KFH_OWNED")
            conn.close()
            return False

        results.pass_test("3.2_items_created")
        conn.close()
        return True

    except Exception as e:
        results.fail_test("3_database_verification", f"SQLite Error: {str(e)}")
        return False

# ============================================================================
# MAIN TEST EXECUTION
# ============================================================================
def main():
    print(f"\n{BLUE}{'='*60}{RESET}")
    print(f"END-TO-END TEST: DIRECT INTAKE (NO PO) -> DASHBOARD{RESET}")
    print(f"Lot Number: {LOT_NUMBER}")
    print(f"{BLUE}{'='*60}{RESET}")

    # Phase 1: Initiate direct intake
    if not phase_1_initiate_intake():
        results.summary()
        return False

    time.sleep(0.5)

    # Phase 2: Approve Intake
    if not phase_2_approve_intake():
        results.summary()
        return False

    time.sleep(0.5)

    # Phase 3: Verify Database
    if not phase_3_verify_database():
        results.summary()
        return False

    # Summary
    success = results.summary()

    print(f"\n{BLUE}{'='*60}{RESET}")
    if success:
        print(f"\n{GREEN}ALL DIRECT INTAKE TESTS PASSED! ✓{RESET}")
        return True
    else:
        print(f"\n{RED}DIRECT INTAKE TESTS FAILED!{RESET}")
        return False

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
