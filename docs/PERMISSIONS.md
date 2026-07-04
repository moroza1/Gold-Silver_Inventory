# Permissions & Module Model — PMIMS

> Single source of truth for the RBAC model: the module catalog, access levels, the role
> matrix, and the request-time enforcement flow.
> Orientation: [`AGENTS.md`](../AGENTS.md). Rationale & change log:
> [`MODULE_SEGREGATION_REVIEW.md`](./MODULE_SEGREGATION_REVIEW.md).

## 1. Core idea

Access is governed by **modules**. A user belongs to one or more **groups**; each group grants
an **access level** per module. A user's effective permission for a module is the **highest**
level across their groups (`InventoryRepository.GetEffectivePermissionsForUserAsync`).

The model deliberately splits **operational (view)** modules from **administrative
(manage/setup)** modules so the authority to *see* data is separate from the authority to
*change its structure*. Example: a Branch Operator can hold `spatial_map` (view the vault map)
without `vault_location` (create/delete shelves).

## 2. Access levels

| Level | Meaning | Passes `.read` policy | Passes `.write` policy |
| :-- | :-- | :--: | :--: |
| `HIDDEN` | no access; module hidden in UI | no | no |
| `READ_ONLY` | view only | yes | no |
| `READ_WRITE` | view + modify | yes | yes |
| `FULL` | view + modify + full control | yes | yes |

Stored in `group_permissions(group_id, module_key, access_level)` (unique on `group_id+module_key`).

## 3. Module catalog (21)

### Operational tier (day-to-day view / transactions)

| Module key | Surface |
| :-- | :-- |
| `dashboard` | Executive dashboard |
| `pending_actions` | "My pending actions" (workflow items awaiting the user) |
| `purchase_orders` | P.O. & procurement, transfers views |
| `spatial_map` | Vault spatial map — **view** of zones/shelves/slots & occupancy |
| `custody` | Customer custody holdings (PII-bearing) |
| `stocktake` | Stocktake sessions & scans |
| `reports` | Reporting & analytics (valuation, holdings, transactions, audit) |
| `workflows` | Act on workflow instances (approve/reject) |
| `intake` | Receive/verify incoming shipments (Maker-Checker) |
| `dispensing` | Gold Dispensing Machine (GDM) — view/operate dispense transactions |
| `barcode_qr_labeling` | Barcode/QR Code Tracking (RFP Section 3) — generate GS1-128 + ISO/IEC 18004 labels per item/lot |

### Administrative tier (manage / setup / governance)

| Module key | Surface | Separated from |
| :-- | :-- | :-- |
| `vault_location` | Create/update/delete shelf locations | `spatial_map` (view) |
| `workflow_design` | Author workflow templates | `workflows` (act) |
| `master_data` | Branches, vendors, reorder thresholds | procurement/transfers views |
| `migration` | Bulk Excel ingestion | — |
| `settings` | System settings screen | — |
| `user_admin` | Users, groups, permissions, FIM provisioning | — |
| `rules_engine` | Author/version Dynamic Business Validation Rules (RFP item 5) | operational workflows that the rules gate (e.g. `purchase_orders` transfer) |
| `notifications` | Configure management email distribution lists & schedules (RFP item 7) | `reports` (the data being emailed) |
| `monitoring` | KFH monitoring-tool alert-route configuration (RFP item 8) | `GET /api/health*` (anonymous, polled by external tools) |
| `device_integration` | Register/decommission physical GDM machines | `dispensing` (day-to-day dispense operation) |

## 4. Endpoint → policy map (server-side enforcement)

Declared with `[Authorize(Policy = …)]`; policies are registered in `Program.cs`.

| Endpoint(s) | Policy | Module / level |
| :-- | :-- | :-- |
| `POST/DELETE /api/catalog/locations` | `vault_location.write` | manage shelves |
| `POST /api/workflows/templates` | `workflow_design.write` | author templates |
| `POST/DELETE /api/catalog/branches` | `master_data.write` | master data |
| `POST/DELETE /api/inventory/reorder-thresholds` | `master_data.write` | master data |
| `POST /api/inventory/low-stock-alerts/{id}/draft-po` | `purchase_orders.write` | creates a `PurchaseOrder` record from a threshold alert |
| `POST /api/transfers`, `/transfers/workflow-initiate`, `/transfers/{id}/receive` | `purchase_orders.write` | initiate/receive a `BranchTransfer` — a "return to main vault" is just a transfer whose `DestinationBranchId` is the main vault branch, same endpoints in both directions |
| `POST /api/catalog/products` | `master_data.write` | create product/denomination catalog entries |
| `GET /api/dashboard/executive-board` | `dashboard.read` | executive KPIs |
| `POST /api/migration/upload`, `/commit` | `migration.write` | bulk ingestion |
| `GET /api/admin/*`, `GET /api/fim/*` | `user_admin.read` | governance (read) |
| `POST/PUT/DELETE /api/admin/*`, `POST/PUT/DELETE /api/fim/*` | `user_admin.write` | governance (write) |

`/api/fim/*` (`PMIMSControllers.Fim.cs`) is the full FIM Integration Module surface -- all
29 RFP-mandated identity-provisioning / access-management(rights) / password-management /
delta-sync functions, same `user_admin` policy as the rest of governance. See
[`FIM_INTEGRATION.md`](./FIM_INTEGRATION.md) for the function → endpoint → `sp_FIM_*`
stored-procedure mapping and connectivity support (DB / SOAP / CLI / IIS7).

Every policy also passes for role `IT/Admin` (superuser). Operational read endpoints
(e.g. `GET /api/catalog/locations`, `GET /api/catalog/branches`) are intentionally open so
dropdowns/views work; mutations are what require a grant.

### RFP items 5-8 (`PMIMSControllers.Rules.cs` / `.Audit.cs` / `.Notifications.cs` / `.Monitoring.cs`)

| Endpoint(s) | Policy | Module / level |
| :-- | :-- | :-- |
| `GET /api/rules`, `/api/rules/{id}`, `/api/rules/{ruleCode}/versions` | `rules_engine.read` | view rules & version history |
| `POST /api/rules`, `PUT /api/rules/{ruleCode}`, `POST /api/rules/{id}/activate`\|`/deactivate` | `rules_engine.write` | author/version rules (append-only) |
| `POST /api/rules/evaluate` | `rules_engine.read` | ad-hoc rule evaluation (read-only operation) |
| `GET /api/reports/audit-logs/search`, `/{id}`, `/export` | `reports.read` | tamper-evident audit search/export (extends existing `reports` module, not a new one) |
| `GET /api/notifications/subscriptions`, `/deliveries` | `notifications.read` | view distribution lists & send history |
| `POST/PUT/DELETE /api/notifications/subscriptions*`, `POST .../test-send` | `notifications.write` | manage distribution lists |
| `GET /api/notifications/unsubscribe` | *(anonymous)* | recipient self-service unsubscribe link (see hardening note in code) |
| `GET /api/health/detailed` | *(anonymous)* | matches existing anonymous `GET /api/health`; polled by external monitoring tools without a JWT |
| `GET /api/monitoring/sla-metrics`, `/events`, `/alert-routes` | `monitoring.read` | view SLA metrics & alert routing |
| `POST /api/monitoring/alert-routes` | `monitoring.write` | configure alert routing |

`TransferStockWorkflow` (`purchase_orders.write`) also runs a `TRANSFER_LIMIT`
rule pre-check via `IRuleEngineService.EvaluateAsync` before the transfer is initiated —
this is a rule *evaluation* (read of the rules module), not a change to the `purchase_orders`
policy itself. (All three transfer endpoints — initiate, workflow-initiate, and receive —
were previously gated by `custody.write` by mistake, which meant no seeded operational role
could ever complete a receive: `custody` is `READ_ONLY` for Maker/Checker/Reconciliation and
`FULL` only for IT Admin, while the frontend's "Receive" button was (correctly) gated on
`purchase_orders`. Fixed to `purchase_orders.write` on all three so the policy matches the
frontend gate and the Maker role, which is the one described in `DbSeeder.cs` as initiating
"transfers, and branch operations.")

### Gold Dispensing Machine (GDM) integration (`PMIMSControllers.Devices.cs`)

| Endpoint(s) | Policy | Module / level |
| :-- | :-- | :-- |
| `GET /api/admin/devices` | `device_integration.read` | view registered machines |
| `POST /api/admin/devices`, `DELETE /api/admin/devices/{id}` | `device_integration.write` | register/decommission machines |
| `POST /api/admin/devices/{id}/heartbeat` | `dispensing.write` | device status ping |
| `GET /api/dispensing/transactions` | `dispensing.read` | view dispense activity |
| `POST /api/dispensing/request`, `/{id}/complete`, `/{id}/fail` | `dispensing.write` | operate dispense transactions |

### Barcode/QR Code Tracking (`PMIMSControllers.Barcode.cs`, RFP Section 3)

| Endpoint(s) | Policy | Module / level |
| :-- | :-- | :-- |
| `GET /api/barcode/items/by-serial/{serialNumber}/label`, `/api/barcode/items/{itemId}/label` | `barcode_qr_labeling.read` | generate a single item's GS1-128 + QR label (computed on demand, nothing stored) |
| `GET /api/barcode/lots/{lotNumber}/labels` | `barcode_qr_labeling.read` | generate a full label sheet for every item in a lot |
| `POST /api/barcode/items/{itemId}/print-log` | `barcode_qr_labeling.write` | log a `ChainOfCustodyEvent` (`LABEL_PRINTED`) when a label is actually printed |

## 5. Seeded role → module matrix

From `DbSeeder.cs`. `F`=FULL, `RW`=READ_WRITE, `RO`=READ_ONLY, `—`=HIDDEN.
Demo users (password `Password123`): `treasury-maker`, `treasury-checker`,
`reconciliation-reconciler`, `system-admin`.

| Module | Maker | Checker | Recon | IT Admin |
| :-- | :--: | :--: | :--: | :--: |
| dashboard | RO | RO | RO | F |
| pending_actions | RO | F | F | F |
| purchase_orders | F | RO | RO | F |
| spatial_map (view) | RO | RO | RO | F |
| custody | RO | RO | RO | F |
| stocktake | RO | RW | F | F |
| reports | RO | RO | F | F |
| workflows (act) | RO | RO | RO | F |
| intake | F | RO | RO | F |
| dispensing | F | RO | RO | F |
| barcode_qr_labeling | F | RO | RO | F |
| **vault_location** (manage) | — | — | — | F |
| **master_data** (manage) | — | — | — | F |
| **workflow_design** (manage) | — | — | — | F |
| migration | RW | RO | RO | F |
| settings | — | — | — | F |
| user_admin | — | — | — | F |
| **rules_engine** (manage) | — | — | RO | F |
| **notifications** (manage) | — | — | — | F |
| **monitoring** (manage) | — | — | RO | F |
| **device_integration** (manage) | — | — | — | F |

The manage-tier modules are `HIDDEN` for Maker/Checker and `FULL` only for IT Administrators —
the concrete realization of the view-vs-manage segregation. Reconciliation Officers are the one
exception: they get `READ_ONLY` on `rules_engine` and `monitoring` (relevant to break
investigation — seeing which rule fired, checking SLA/monitoring metrics) but stay `HIDDEN` on
`notifications` (email distribution-list configuration is not part of their job).

`dashboard` now has a registered `dashboard.read` policy (`GET /api/dashboard/executive-board`)
— previously the module's seeded permission level was never enforced anywhere (the endpoint had
no `[Authorize]` attribute at all).

## 6. Request-time flow

```
login ─► AD validate ─► load effective permissions ─► GenerateJwt
        (claims: roles + perm:<module>=<level> per module)
                                  │
SPA stores token; fetch interceptor adds "Authorization: Bearer <token>"
                                  │
API ─► validate JWT ─► [Authorize(Policy)] ─► HasWrite/CanRead(user, module)
                                              (or role == IT/Admin)
```

Frontend `canAccess(module)` / `canModify(module)` mirror this for UX (hide/disable), but are
**not** the security boundary — the policy on the endpoint is.

### Maker-Checker step-level gating

The module policies above gate *which endpoints* a user can call (e.g. `pending_actions.write`
lets Checker/Reconciliation/IT-Admin call `POST /api/workflows/instances/{id}/action` at all).
A second, finer-grained check inside `InventoryRepository.ProcessWorkflowActionAsync` then asks
whether *this specific user* holds the role required by the workflow instance's *current step*
(`WorkflowStep.RequiredRole`) — this is what actually enforces 4-eyes segregation between the
PO-review step and the reconciliation step, for example. That check
(`InventoryRepository.GetUserRoles`) resolves roles solely from real `AppUser` →
`PrivilegeGroup` membership, and `WorkflowStep.RequiredRole` is seeded to match
`PrivilegeGroup.GroupName` exactly (`DbSeeder.cs`). There is intentionally no
username-pattern-based role inference anywhere in the login or role-resolution path — a
username merely containing "checker" or "admin" grants nothing; only real group membership
does.

## 7. Adding a new module (checklist)

Wire the key in all four places (see [`AGENTS.md` §6](../AGENTS.md)):

1. `DbSeeder.cs` — `allModules` + each group dictionary.
2. `Program.cs` — register `Write("<key>.write","<key>")` / `Read(...)`.
3. Controller endpoint(s) — `[Authorize(Policy="<key>.write")]`.
4. `frontend/src/App.tsx` — `MODULE_KEYS` (with `tier`) + `canAccess`/`canModify` gating.

Also add the key to `AllModuleKeys` in `PMIMSControllers.cs` (IT/Admin superuser list).
Then **delete `pmims.db`** so the seeder applies the new grants.
