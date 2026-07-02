# TestSprite AI Testing Report (MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** Gold2
- **Date:** 2026-06-29
- **Prepared by:** Antigravity (AI Coding Assistant) & TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

### 📂 User Authentication & Localization
Governs user entry, Active Directory validation, and language selection.

#### Test TC001: Sign in and reach the dashboard
- **Test Code:** [TC001_Sign_in_and_reach_the_dashboard.py](./TC001_Sign_in_and_reach_the_dashboard.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/63acdb00-3bc9-4cd5-a1cc-4001c0c0f98b)
- **Status:** ✅ Passed
- **Analysis / Findings:** Successfully logged in using valid AD credentials and LDAP Corporate Authentication, transitioning directly to the treasury dashboard view.

#### Test TC007: Sign in with Arabic selected before entering the app
- **Test Code:** [TC007_Sign_in_with_Arabic_selected_before_entering_the_app.py](./TC007_Sign_in_with_Arabic_selected_before_entering_the_app.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/592d8e25-ca7f-4435-8c2b-74649909f46e)
- **Status:** ⚠️ Blocked
- **Analysis / Findings:** The Arabic language selector is missing from the login screen. While the application is localized, a user cannot switch to the Arabic interface prior to authentication.

---

### 📂 Dashboard & Metrics
Overview of total stock valuation, holdings, and pending maker-checker actions.

#### Test TC003: Review dashboard stock and pending authorizations after sign-in
- **Test Code:** [TC003_Review_dashboard_stock_and_pending_authorizations_after_sign_in.py](./TC003_Review_dashboard_stock_and_pending_authorizations_after_sign_in.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/a50b126a-a458-457a-b858-86bb276088de)
- **Status:** ✅ Passed
- **Analysis / Findings:** Verified that the dashboard successfully displays overall precious metal holdings summary cards and lists outstanding pending actions requiring review.

---

### 📂 Procurement Workflow (Maker-Checker)
Governs creation, verification, intake, and approval/rejection of purchase orders.

#### Test TC002: Create a procurement order and submit it for approval
- **Test Code:** [TC002_Create_a_procurement_order_and_submit_it_for_approval.py](./TC002_Create_a_procurement_order_and_submit_it_for_approval.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/796eaa70-955e-4c66-829e-eb25ab511afa)
- **Status:** ✅ Passed
- **Analysis / Findings:** A Maker successfully filled out a new procurement request with vendor, metal specifications, purity, serial numbers, and submitted it to the checking queue.

#### Test TC005: Approve a pending procurement order
- **Test Code:** [TC005_Approve_a_pending_procurement_order.py](./TC005_Approve_a_pending_procurement_order.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/ac4bd73b-f161-4767-992e-7ccf26b6d841)
- **Status:** ✅ Passed
- **Analysis / Findings:** A Checker successfully logged in, selected the pending procurement order PO-KFH-2026-002, and approved it, which successfully moved the order to the APPROVED state.

#### Test TC009: Reject a pending procurement order
- **Test Code:** [TC009_Reject_a_pending_procurement_order.py](./TC009_Reject_a_pending_procurement_order.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/d90249f4-65d8-4af1-a404-a9f9164e653d)
- **Status:** ⚠️ Blocked
- **Analysis / Findings:** Blocked because the target purchase order PO-KFH-2026-002 was already approved during the execution session, and no other pending orders were available for rejection testing.

---

### 📂 Inventory Transfers & Reservations
Governs vault transfers and locking mechanisms to prevent double allocation.

#### Test TC004: Create an inventory transfer and submit it for approval
- **Test Code:** [TC004_Create_an_inventory_transfer_and_submit_it_for_approval.py](./TC004_Create_an_inventory_transfer_and_submit_it_for_approval.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/eb7de680-64a8-4612-8c35-1b947ea9eb54)
- **Status:** ✅ Passed
- **Analysis / Findings:** Maker successfully selected specific serialized bars and created a transfer order between source and destination vaults, holding pessimistic locks on the bars.

#### Test TC006: Approve a pending inventory transfer
- **Test Code:** [TC006_Approve_a_pending_inventory_transfer.py](./TC006_Approve_a_pending_inventory_transfer.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/5bd83466-38d7-423e-ae04-c86034263f95)
- **Status:** ✅ Passed
- **Analysis / Findings:** Checker approved the transfer request, committing the bars to the new vault coordinates and releasing the transaction lock.

#### Test TC011: Reject a pending inventory transfer
- **Test Code:** [TC011_Reject_a_pending_inventory_transfer.py](./TC011_Reject_a_pending_inventory_transfer.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/4eb12aba-fcc3-4fb9-9c73-2d20b4ec7a23)
- **Status:** ✅ Passed
- **Analysis / Findings:** Checker rejected a pending transfer request. The lock on the selected gold/silver bars was successfully released, returning them to active inventory.

---

### 📂 Spatial Vault Map & Navigation
Visualization of vault zone coordinates (zone -> shelf -> slot).

#### Test TC012: Browse shelves and slots within a vault zone
- **Test Code:** [TC012_Browse_shelves_and_slots_within_a_vault_zone.py](./TC012_Browse_shelves_and_slots_within_a_vault_zone.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/bfd36a00-24c6-4188-8108-25355e6965ce)
- **Status:** ✅ Passed
- **Analysis / Findings:** Successfully navigated through vault zones, displaying the coordinate grids of shelves and slots.

#### Test TC008: Drill from vault zones to bar details
- **Test Code:** [TC008_Drill_from_vault_zones_to_bar_details.py](./TC008_Drill_from_vault_zones_to_bar_details.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/060172c6-cf28-49a2-b3b2-0675d18d8aca)
- **Status:** ❌ Failed
- **Analysis / Findings:** Clicking a shelf row failed to show detailed bar inventory (e.g. weight, purity, serial). The table row only highlights and provides a "Delete" action in that context, without an inspection view.

#### Test TC013: Drill down the spatial vault map to a serialized bar record
- **Test Code:** [TC013_Drill_down_the_spatial_vault_map_to_a_serialized_bar_record.py](./TC013_Drill_down_the_spatial_vault_map_to_a_serialized_bar_record.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/a4334c4f-87af-4e24-8564-069c00d2801a)
- **Status:** ❌ Failed
- **Analysis / Findings:** Clicks on the serial number cell or slot row in the shelf modal did not display a serialized bar details view. The UI remains in the modal state and lacks a dedicated detail panel.

---

### 📂 Access Control & Permissions
Governs configuration of users, groups, and permission policies.

#### Test TC014: Create and save an access control entry
- **Test Code:** [TC014_Create_and_save_an_access_control_entry.py](./TC014_Create_and_save_an_access_control_entry.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/1f650fe0-e26c-4366-a07c-0a470c3b1e46)
- **Status:** ✅ Passed
- **Analysis / Findings:** Successfully created, modified, and saved a permission mapping/group permission rule within the admin control screen.

---

### 📂 Custody Management & Withdrawals
Governs customer gold holdings, custody releases, and customer withdrawals.

#### Test TC010: Create a customer withdrawal request
- **Test Code:** [TC010_Create_a_customer_withdrawal_request.py](./TC010_Create_a_customer_withdrawal_request.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/c1692133-1861-4d7b-8845-09578881e7fc)
- **Status:** ✅ Passed
- **Analysis / Findings:** Successfully initiated a customer withdrawal request for allocated vault holdings.

#### Test TC015: Review and update a custody record
- **Test Code:** [TC015_Review_and_update_a_custody_record.py](./TC015_Review_and_update_a_custody_record.py)
- **Test Visualization and Result:** [View on TestSprite](https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/cdd82f44-73ec-4a1e-a1b9-5bf3148cfd43)
- **Status:** ❌ Failed
- **Analysis / Findings:** The customer custody portfolio table failed to load data, showing only skeleton placeholder rows. Repeated search attempts and refreshes did not fetch custody records.

---

## 3️⃣ Coverage & Matching Metrics

### 📊 Summary Dashboard
- **Total Test Cases:** 15
- **Passed:** 10
- **Failed:** 3
- **Blocked:** 2
- **Pass Rate:** **66.67%** (10/15)

| Requirement / Feature Group | Total Tests | ✅ Passed | ❌ Failed | ⚠️ Blocked | Pass Rate |
|:---|:---:|:---:|:---:|:---:|:---:|
| **User Authentication & Localization** | 2 | 1 | 0 | 1 | 50.0% |
| **Dashboard & Metrics** | 1 | 1 | 0 | 0 | 100.0% |
| **Procurement Workflow (Maker-Checker)** | 3 | 2 | 0 | 1 | 66.7% |
| **Inventory Transfers & Reservations** | 3 | 3 | 0 | 0 | 100.0% |
| **Spatial Vault Map & Navigation** | 3 | 1 | 2 | 0 | 33.3% |
| **Access Control & Permissions** | 1 | 1 | 0 | 0 | 100.0% |
| **Custody Management & Withdrawals** | 2 | 1 | 1 | 0 | 50.0% |
| **Total** | **15** | **10** | **3** | **2** | **66.7%** |

---

## 4️⃣ Key Gaps / Risks

1. **Spatial Vault Map Drilling (Usability Risk):**
   * **Issue:** Clicking on vault shelves/slots or serialized bar cells inside the vault visualizer does not load the bar's detailed inspection card.
   * **Risk:** Vault managers and auditors cannot drill down to confirm specific metal weights, purity levels, or individual serial logs from the interactive map.

2. **Customer Custody Load Defect (Functional Risk):**
   * **Issue:** The customer custody records fail to load under search operations, showing empty table states.
   * **Risk:** Branch officers cannot review or release precious metals held under custody since portfolio data remains inaccessible.

3. **Login Localization Selector (UX Gap):**
   * **Issue:** The landing/sign-in page lacks the language switch control.
   * **Risk:** Although the dashboard is translated, users cannot start their workflow in Arabic directly from the sign-in screen, forcing English initialization.

4. **Test Interference / DB Resetting (Testing Risk):**
   * **Issue:** TC009 (Procurement Reject) was blocked because a previous test step approved the target purchase order.
   * **Risk:** Tests run sequentially interfere with each other's state, highlighting the need for automatic state resetting (e.g. seeding SQLite database anew) prior to test execution.
