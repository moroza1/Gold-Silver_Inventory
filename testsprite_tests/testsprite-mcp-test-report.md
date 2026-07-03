# TestSprite AI Testing Report (MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** Gold2 (Kuwait Finance House PMIMS)
- **Date:** 2026-07-04
- **Prepared by:** Antigravity (AI Coding Assistant) & TestSprite AI Team
- **Test Target:** Frontend SPA (React / Vite)
- **Environment:** Local Development (IPv4 127.0.0.1:5173, backend :8080)

---

## 2️⃣ Requirement Validation Summary

### 🔑 Requirement Group: User Authentication

#### Test TC001: Sign in and reach the dashboard
- **Test Code:** [TC001_Sign_in_and_reach_the_dashboard.py](./TC001_Sign_in_and_reach_the_dashboard.py)
- **Status:** ✅ Passed
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/4a3be731-0f94-4b95-8d46-90144bff8bbb)
- **Analysis / Findings:** Successfully signs in with mock AD credentials and navigates to the treasury dashboard view.

#### Test TC007: Sign in with Arabic selected before entering the app
- **Test Code:** [TC007_Sign_in_with_Arabic_selected_before_entering_the_app.py](./TC007_Sign_in_with_Arabic_selected_before_entering_the_app.py)
- **Status:** ❌ Failed
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/51720cd7-bed9-4416-894b-8fddc81bef5a)
- **Analysis / Findings:** Language switcher (Arabic) is missing on the login page screen. The UI only provides LDAP username and password fields.

---

### 📊 Requirement Group: Treasury Dashboard

#### Test TC003: Review dashboard stock and pending authorizations after sign-in
- **Test Code:** [TC003_Review_dashboard_stock_and_pending_authorizations_after_sign_in.py](./TC003_Review_dashboard_stock_and_pending_authorizations_after_sign_in.py)
- **Status:** ✅ Passed
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/0a862d82-af87-474f-9906-fce2b8cf8f00)
- **Analysis / Findings:** Dashboard displays stock summary metrics and pending authorization counts as expected.

---

### 🗺️ Requirement Group: Spatial Vault Map

#### Test TC008: Drill from vault zones to bar details
- **Test Code:** [TC008_Drill_from_vault_zones_to_bar_details.py](./TC008_Drill_from_vault_zones_to_bar_details.py)
- **Status:** ✅ Passed
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/292245bb-18fd-4387-8e2e-08867a70cb88)
- **Analysis / Findings:** Navigates vault zones grid successfully and drills down to individual vault rows.

#### Test TC012: Browse shelves and slots within a vault zone
- **Test Code:** [TC012_Browse_shelves_and_slots_within_a_vault_zone.py](./TC012_Browse_shelves_and_slots_within_a_vault_zone.py)
- **Status:** ✅ Passed
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/8a9f4cb2-4e73-451b-a28d-f6c06a06b997)
- **Analysis / Findings:** Verifies ability to browse empty slots and shelves inside a selected vault zone.

#### Test TC013: Drill down the spatial vault map to a serialized bar record
- **Test Code:** [TC013_Drill_down_the_spatial_vault_map_to_a_serialized_bar_record.py](./TC013_Drill_down_the_spatial_vault_map_to_a_serialized_bar_record.py)
- **Status:** ⚠️ Blocked
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/d6d952ae-3f9f-418f-b9ca-5fd823d9d4c5)
- **Analysis / Findings:** Blocked because all slots in the database are currently empty. No occupied slots were available to drill down to a serialized bar.

---

### 📦 Requirement Group: Procurement Workflow

#### Test TC002: Create a procurement order and submit it for approval
- **Test Code:** [TC002_Create_a_procurement_order_and_submit_it_for_approval.py](./TC002_Create_a_procurement_order_and_submit_it_for_approval.py)
- **Status:** ✅ Passed
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/9b67b046-8cb5-421d-b740-fa225c8e0122)
- **Analysis / Findings:** Successfully initiates procurement request as a Maker, fills in order parameters, and submits it.

#### Test TC005: Approve a pending procurement order
- **Test Code:** [TC005_Approve_a_pending_procurement_order.py](./TC005_Approve_a_pending_procurement_order.py)
- **Status:** ✅ Passed
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/ab8cb4cc-6ee7-47dd-801d-9d184a75d768)
- **Analysis / Findings:** A Checker successfully logs in and approves a pending procurement order.

#### Test TC009: Reject a pending procurement order
- **Test Code:** [TC009_Reject_a_pending_procurement_order.py](./TC009_Reject_a_pending_procurement_order.py)
- **Status:** ✅ Passed
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/da8de847-7973-46e8-9f81-37bfbdae0e20)
- **Analysis / Findings:** A Checker successfully logs in and rejects a pending procurement order.

---

### 🚚 Requirement Group: Inventory Transfers

#### Test TC004: Create an inventory transfer and submit it for approval
- **Test Code:** [TC004_Create_an_inventory_transfer_and_submit_it_for_approval.py](./TC004_Create_an_inventory_transfer_and_submit_it_for_approval.py)
- **Status:** ⚠️ Blocked
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/3cc72297-cd35-402a-a25e-3ae6e50e21f1)
- **Analysis / Findings:** Blocked because the dropdown to select a bar is empty (no gold/silver bars are in 'Ready' state in the vault to transfer).

#### Test TC006: Approve a pending inventory transfer
- **Test Code:** [TC006_Approve_a_pending_inventory_transfer.py](./TC006_Approve_a_pending_inventory_transfer.py)
- **Status:** ⚠️ Blocked
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/108a80c7-2327-4a99-a4b4-ef5ac58112f1)
- **Analysis / Findings:** Blocked because there are no pending transfers in the system to approve (due to TC004 blockage).

#### Test TC011: Reject a pending inventory transfer
- **Test Code:** [TC011_Reject_a_pending_inventory_transfer.py](./TC011_Reject_a_pending_inventory_transfer.py)
- **Status:** ✅ Passed
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/4f031afc-b9d3-44bd-b469-17492597a828)
- **Analysis / Findings:** A Checker successfully rejects a pending transfer (when one is present or simulated in the table).

---

### 🛡️ Requirement Group: Custody Management

#### Test TC015: Review and update a custody record
- **Test Code:** [TC015_Review_and_update_a_custody_record.py](./TC015_Review_and_update_a_custody_record.py)
- **Status:** ✅ Passed
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/003df71e-69c7-4af2-8467-a4b8f9715a4a)
- **Analysis / Findings:** Reviewing custody records and updating details works as designed.

---

### 🏦 Requirement Group: Customer Withdrawals

#### Test TC010: Create a customer withdrawal request
- **Test Code:** [TC010_Create_a_customer_withdrawal_request.py](./TC010_Create_a_customer_withdrawal_request.py)
- **Status:** ✅ Passed
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/81d39264-2e50-48d5-a986-599e1c74cccf)
- **Analysis / Findings:** Maker can create and submit customer withdrawals.

---

### ⚙️ Requirement Group: Admin Setup & Governance

#### Test TC014: Create and save an access control entry
- **Test Code:** [TC014_Create_and_save_an_access_control_entry.py](./TC014_Create_and_save_an_access_control_entry.py)
- **Status:** ✅ Passed
- **Test Visualization and Result:** [Link](https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/ecaed81e-98e5-4895-8d0f-94e4e9f00bde)
- **Analysis / Findings:** Access control rules and privileges can be created and saved successfully in the Admin panel.

---

## 3️⃣ Coverage & Matching Metrics

- **Success Rate:** 73.33% of tests passed (11/15)

| Requirement Group | Total Tests | ✅ Passed | ❌ Failed | ⚠️ Blocked |
|-------------------|-------------|-----------|-----------|------------|
| User Authentication | 2 | 1 | 1 | 0 |
| Treasury Dashboard  | 1 | 1 | 0 | 0 |
| Spatial Vault Map   | 3 | 2 | 0 | 1 |
| Procurement         | 3 | 3 | 0 | 0 |
| Inventory Transfers | 3 | 1 | 0 | 2 |
| Custody Management  | 1 | 1 | 0 | 0 |
| Customer Withdrawals| 1 | 1 | 0 | 0 |
| Admin Setup & Gov   | 1 | 1 | 0 | 0 |
| **Total**           | **15** | **11** | **1** | **3** |

---

## 4️⃣ Key Gaps / Risks

- **Gap 1: Missing Language Selection on Login Screen.** TC007 failed because the sign-in screen does not provide the language selection option to switch the interface to Arabic. Language switching is currently only available inside the app header after authentication.
- **Gap 2: Missing Seed Data for Transfer and Vault Maps.** TC004, TC006, and TC013 are blocked due to the lack of pre-seeded occupied slots and transfer-ready gold/silver bars in the local database. The database seeder must be updated to seed active vault bar records for complete test coverage.
