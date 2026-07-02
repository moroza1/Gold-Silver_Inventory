# Precious Metals Inventory Management System (PMIMS) - Product Requirements Document

## 1. Overview
PMIMS (Precious Metals Inventory Management System) is a Sharia-compliant inventory ledger for the Treasury / Precious Metals division of Kuwait Finance House (KFH). It tracks serialized gold and silver bars across vault coordinate grids.

## 2. Core Functional Requirements
- **Vault Location & Grid Tracking:** Track bars using coordinate grids: Zone -> Shelf -> Slot.
- **Maker-Checker Workflow (4-Eyes Principle):** Financial and stock transactions must be created by a Maker and authorized by a Checker.
- **Pessimistic Reservation Locks:** Lock stock during transfer/procurement processing to prevent double-allocation.
- **General Ledger (GL) Reconciliation:** Automated/manual reconciliation of inventory with the general ledger.
- **Bilingual Interface:** Support English and Arabic (Right-to-Left RTL) layout and localization.
- **Security & Authorization:** Role-based access control (RBAC) enforced via JWT claims. Core roles are:
  - `system-admin` (IT Administrators / Full Access)
  - `treasury-maker` (Can initiate transactions)
  - `treasury-checker` (Can approve/check transactions)
  - `reconciliation-reconciler` (Can reconcile GL)

## 3. UI/UX Pages & Features
- **Login screen:** Authentication utilizing mock Active Directory credentials.
- **Dashboard:** Overview of stock holdings, value, and pending authorizations.
- **Spatial Map:** Interactive visualization of vault zones, shelves, and slots.
- **Procurement & Transfers:** Initiate bar purchases and transfers between vaults.
- **Custody & Withdrawals:** Manage bar custody release and customer withdrawals.
- **Stocktake:** Perform physical inventory audits.
- **Reporting:** Export inventory and valuation reports.
