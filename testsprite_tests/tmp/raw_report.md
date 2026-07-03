
# TestSprite AI Testing Report(MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** Gold2
- **Date:** 2026-07-04
- **Prepared by:** TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

#### Test TC001 Sign in and reach the dashboard
- **Test Code:** [TC001_Sign_in_and_reach_the_dashboard.py](./TC001_Sign_in_and_reach_the_dashboard.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/4a3be731-0f94-4b95-8d46-90144bff8bbb
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC002 Create a procurement order and submit it for approval
- **Test Code:** [TC002_Create_a_procurement_order_and_submit_it_for_approval.py](./TC002_Create_a_procurement_order_and_submit_it_for_approval.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/9b67b046-8cb5-421d-b740-fa225c8e0122
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC003 Review dashboard stock and pending authorizations after sign-in
- **Test Code:** [TC003_Review_dashboard_stock_and_pending_authorizations_after_sign_in.py](./TC003_Review_dashboard_stock_and_pending_authorizations_after_sign_in.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/0a862d82-af87-474f-9906-fce2b8cf8f00
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC004 Create an inventory transfer and submit it for approval
- **Test Code:** [TC004_Create_an_inventory_transfer_and_submit_it_for_approval.py](./TC004_Create_an_inventory_transfer_and_submit_it_for_approval.py)
- **Test Error:** TEST BLOCKED

The transfer could not be created because required source items are not available in the UI.

Observations:
- The 'Select Metal Item (Ready)' dropdown contains only the placeholder '-- Choose Bar --' (no bars available to select)
- The 'Initiate Transfer Workflow' button is disabled and cannot be submitted
- The Active Branch Transfers table shows 'No branch transfers found.'
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/3cc72297-cd35-402a-a25e-3ae6e50e21f1
- **Status:** BLOCKED
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC005 Approve a pending procurement order
- **Test Code:** [TC005_Approve_a_pending_procurement_order.py](./TC005_Approve_a_pending_procurement_order.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/ab8cb4cc-6ee7-47dd-801d-9d184a75d768
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC006 Approve a pending inventory transfer
- **Test Code:** [TC006_Approve_a_pending_inventory_transfer.py](./TC006_Approve_a_pending_inventory_transfer.py)
- **Test Error:** TEST BLOCKED

The test could not be run — there are no pending branch transfers available to open and approve.

Observations:
- The 'Active Branch Transfers' table displays 'No branch transfers found.'
- The Initiate Transfer workflow button is disabled and no transfer rows are present

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/108a80c7-2327-4a99-a4b4-ef5ac58112f1
- **Status:** BLOCKED
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC007 Sign in with Arabic selected before entering the app
- **Test Code:** [TC007_Sign_in_with_Arabic_selected_before_entering_the_app.py](./TC007_Sign_in_with_Arabic_selected_before_entering_the_app.py)
- **Test Error:** TEST FAILURE

An option to switch the interface to Arabic is not available on the sign-in screen; the language selection feature appears to be missing.

Observations:
- The sign-in page displays 'AD Username', 'Password', and the 'LDAP Corporate Authentication' button but no language selector.
- No 'Arabic' or 'عربي' option was visible in the page content or interactive elements.
- The AD Username field is prefilled with 'treasury-maker' and example credentials are shown on the page (Maker: treasury-maker | Checker: treasury-checker (Pass: Password123)).
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/51720cd7-bed9-4416-894b-8fddc81bef5a
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC008 Drill from vault zones to bar details
- **Test Code:** [TC008_Drill_from_vault_zones_to_bar_details.py](./TC008_Drill_from_vault_zones_to_bar_details.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/292245bb-18fd-4387-8e2e-08867a70cb88
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC009 Reject a pending procurement order
- **Test Code:** [TC009_Reject_a_pending_procurement_order.py](./TC009_Reject_a_pending_procurement_order.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/da8de847-7973-46e8-9f81-37bfbdae0e20
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC010 Create a customer withdrawal request
- **Test Code:** [TC010_Create_a_customer_withdrawal_request.py](./TC010_Create_a_customer_withdrawal_request.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/81d39264-2e50-48d5-a986-599e1c74cccf
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC011 Reject a pending inventory transfer
- **Test Code:** [TC011_Reject_a_pending_inventory_transfer.py](./TC011_Reject_a_pending_inventory_transfer.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/4f031afc-b9d3-44bd-b469-17492597a828
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC012 Browse shelves and slots within a vault zone
- **Test Code:** [TC012_Browse_shelves_and_slots_within_a_vault_zone.py](./TC012_Browse_shelves_and_slots_within_a_vault_zone.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/8a9f4cb2-4e73-451b-a28d-f6c06a06b997
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC013 Drill down the spatial vault map to a serialized bar record
- **Test Code:** [TC013_Drill_down_the_spatial_vault_map_to_a_serialized_bar_record.py](./TC013_Drill_down_the_spatial_vault_map_to_a_serialized_bar_record.py)
- **Test Error:** TEST BLOCKED

The test could not be run — there are no occupied slot records available to open a serialized bar detail.

Observations:
- All slot tiles in the displayed shelves (Main Vault Zone Alpha - Shelf Row 1/2/3) are labeled 'Slot N: Empty'.
- The page legend shows 'Occupied with Gold' and 'Occupied with Silver' but no slot tile on the page displays an occupied state.

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/d6d952ae-3f9f-418f-b9ca-5fd823d9d4c5
- **Status:** BLOCKED
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC014 Create and save an access control entry
- **Test Code:** [TC014_Create_and_save_an_access_control_entry.py](./TC014_Create_and_save_an_access_control_entry.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/ecaed81e-98e5-4895-8d0f-94e4e9f00bde
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC015 Review and update a custody record
- **Test Code:** [TC015_Review_and_update_a_custody_record.py](./TC015_Review_and_update_a_custody_record.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/f896577c-376b-493c-b5e3-9c493b408f6b/003df71e-69c7-4af2-8467-a4b8f9715a4a
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---


## 3️⃣ Coverage & Matching Metrics

- **73.33** of tests passed

| Requirement        | Total Tests | ✅ Passed | ❌ Failed  |
|--------------------|-------------|-----------|------------|
| ...                | ...         | ...       | ...        |
---


## 4️⃣ Key Gaps / Risks
{AI_GNERATED_KET_GAPS_AND_RISKS}
---