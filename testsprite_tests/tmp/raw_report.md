
# TestSprite AI Testing Report(MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** Gold2
- **Date:** 2026-06-29
- **Prepared by:** TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

#### Test TC001 Sign in and reach the dashboard
- **Test Code:** [TC001_Sign_in_and_reach_the_dashboard.py](./TC001_Sign_in_and_reach_the_dashboard.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/63acdb00-3bc9-4cd5-a1cc-4001c0c0f98b
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC002 Create a procurement order and submit it for approval
- **Test Code:** [TC002_Create_a_procurement_order_and_submit_it_for_approval.py](./TC002_Create_a_procurement_order_and_submit_it_for_approval.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/796eaa70-955e-4c66-829e-eb25ab511afa
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC003 Review dashboard stock and pending authorizations after sign-in
- **Test Code:** [TC003_Review_dashboard_stock_and_pending_authorizations_after_sign_in.py](./TC003_Review_dashboard_stock_and_pending_authorizations_after_sign_in.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/a50b126a-a458-457a-b858-86bb276088de
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC004 Create an inventory transfer and submit it for approval
- **Test Code:** [TC004_Create_an_inventory_transfer_and_submit_it_for_approval.py](./TC004_Create_an_inventory_transfer_and_submit_it_for_approval.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/eb7de680-64a8-4612-8c35-1b947ea9eb54
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC005 Approve a pending procurement order
- **Test Code:** [TC005_Approve_a_pending_procurement_order.py](./TC005_Approve_a_pending_procurement_order.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/ac4bd73b-f161-4767-992e-7ccf26b6d841
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC006 Approve a pending inventory transfer
- **Test Code:** [TC006_Approve_a_pending_inventory_transfer.py](./TC006_Approve_a_pending_inventory_transfer.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/5bd83466-38d7-423e-ae04-c86034263f95
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC007 Sign in with Arabic selected before entering the app
- **Test Code:** [TC007_Sign_in_with_Arabic_selected_before_entering_the_app.py](./TC007_Sign_in_with_Arabic_selected_before_entering_the_app.py)
- **Test Error:** TEST BLOCKED

The Arabic language selector is not present on the sign-in screen, so the requested verification (switch to Arabic on sign-in and still log in) cannot be completed.

Observations:
- The sign-in card shows English labels only: 'AD USERNAME', 'PASSWORD', and the 'LDAP Corporate Authentication' button.
- Page searches for 'Arabic' and Arabic script ('عرب', 'عربي') returned no matches and no language selector control is visible in the DOM or screenshot.

Because the Arabic language switch is missing from the sign-in screen, the step to change the interface language before login cannot be executed. If confirmation of an Arabic sign-in option is required, a UI change or feature addition on the sign-in page is needed to proceed.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/592d8e25-ca7f-4435-8c2b-74649909f46e
- **Status:** BLOCKED
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC008 Drill from vault zones to bar details
- **Test Code:** [TC008_Drill_from_vault_zones_to_bar_details.py](./TC008_Drill_from_vault_zones_to_bar_details.py)
- **Test Error:** TEST FAILURE

Clicking the shelf row did not open the serialized bar inventory details as expected.

Observations:
- The Shelf details modal for 'Main Vault Zone Alpha - Shelf Row 1' is visible and the 'CH-88371-93' row highlights when clicked.
- Repeated clicks on the bar serial cell, denomination cell, and the entire table row do not reveal any additional details or a details panel.
- No alternative 'View' or 'Details' action is present in the row (the only action available is 'Delete').
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/060172c6-cf28-49a2-b3b2-0675d18d8aca
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC009 Reject a pending procurement order
- **Test Code:** [TC009_Reject_a_pending_procurement_order.py](./TC009_Reject_a_pending_procurement_order.py)
- **Test Error:** TEST BLOCKED

The test could not be run to completion because the procurement request is no longer in a pending state and there is no visible way to perform a rejection from the UI that was available during this session.

Observations:
- The purchase order PO-KFH-2026-002 was changed to status APPROVED (multiple approval alerts were shown) before the reject action could be executed.
- The 'Verify & Intake Shipment (Scan)' modal opened and contains inputs and the buttons 'Verify & Complete Intake' and 'Cancel', but no 'Reject' option.
- No other purchase orders in PENDING_APPROVAL state were available in the listing to attempt a reject.

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/d90249f4-65d8-4af1-a404-a9f9164e653d
- **Status:** BLOCKED
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC010 Create a customer withdrawal request
- **Test Code:** [TC010_Create_a_customer_withdrawal_request.py](./TC010_Create_a_customer_withdrawal_request.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/c1692133-1861-4d7b-8845-09578881e7fc
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC011 Reject a pending inventory transfer
- **Test Code:** [TC011_Reject_a_pending_inventory_transfer.py](./TC011_Reject_a_pending_inventory_transfer.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/4eb12aba-fcc3-4fb9-9c73-2d20b4ec7a23
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC012 Browse shelves and slots within a vault zone
- **Test Code:** [TC012_Browse_shelves_and_slots_within_a_vault_zone.py](./TC012_Browse_shelves_and_slots_within_a_vault_zone.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/bfd36a00-24c6-4188-8108-25355e6965ce
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC013 Drill down the spatial vault map to a serialized bar record
- **Test Code:** [TC013_Drill_down_the_spatial_vault_map_to_a_serialized_bar_record.py](./TC013_Drill_down_the_spatial_vault_map_to_a_serialized_bar_record.py)
- **Test Error:** TEST FAILURE

Opening the serialized bar details from the shelf details modal did not work — clicks on the serial cell and the slot row did not open a details panel.

Observations:
- The shelf details modal for 'Main Vault Zone Alpha - Shelf Row 1' is visible and lists Slot 2 with bar serial CH-88371-92, but no serialized-bar detail panel is displayed.
- Clicking the bar serial number cell (three attempts) and the Slot 2 table row (one attempt) produced no visible detail view; the modal remained and only the row was highlighted.
- The modal's Action column shows only a Delete button for each row; no 'View' or 'Open' control is present to access detailed inventory in this UI state.

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/a4334c4f-87af-4e24-8564-069c00d2801a
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC014 Create and save an access control entry
- **Test Code:** [TC014_Create_and_save_an_access_control_entry.py](./TC014_Create_and_save_an_access_control_entry.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/1f650fe0-e26c-4366-a07c-0a470c3b1e46
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC015 Review and update a custody record
- **Test Code:** [TC015_Review_and_update_a_custody_record.py](./TC015_Review_and_update_a_custody_record.py)
- **Test Error:** TEST FAILURE

The Customer Custody list could not be loaded — no customer custody records appear and the table remains empty after multiple search and refresh attempts.

Observations:
- The Customer Custody page displays only the table headers (Customer Civil ID, Customer Name, Gold Serial Number, Metal / weight, Physical vault coordinates, Status, Action) with no data rows visible.
- The Search Customer ID input (inside an open shadow DOM) and the 'Search Portfolio' button were used repeatedly (8+ attempts), including explicit clears and reloading the view, but no custody rows appeared.
- DOM scans found multiple <tr> elements (25) which appear to be placeholders/skeleton rows; no row text/content representing actual custody records was present in the UI.

Result: The requested flow (open a custody record, review its bars, update and save custody information) could not be executed because no custody records were accessible in the UI. Marking the test as failed.
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/68a05cd6-a3ea-4929-8993-572046d31963/cdd82f44-73ec-4a1e-a1b9-5bf3148cfd43
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---


## 3️⃣ Coverage & Matching Metrics

- **66.67** of tests passed

| Requirement        | Total Tests | ✅ Passed | ❌ Failed  |
|--------------------|-------------|-----------|------------|
| ...                | ...         | ...       | ...        |
---


## 4️⃣ Key Gaps / Risks
{AI_GNERATED_KET_GAPS_AND_RISKS}
---