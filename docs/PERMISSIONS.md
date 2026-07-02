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

## 3. Module catalog (14)

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

### Administrative tier (manage / setup / governance)

| Module key | Surface | Separated from |
| :-- | :-- | :-- |
| `vault_location` | Create/update/delete shelf locations | `spatial_map` (view) |
| `workflow_design` | Author workflow templates | `workflows` (act) |
| `master_data` | Branches, vendors, reorder thresholds | procurement/transfers views |
| `migration` | Bulk Excel ingestion | — |
| `settings` | System settings screen | — |
| `user_admin` | Users, groups, permissions, FIM provisioning | — |

## 4. Endpoint → policy map (server-side enforcement)

Declared with `[Authorize(Policy = …)]`; policies are registered in `Program.cs`.

| Endpoint(s) | Policy | Module / level |
| :-- | :-- | :-- |
| `POST/DELETE /api/catalog/locations` | `vault_location.write` | manage shelves |
| `POST /api/workflows/templates` | `workflow_design.write` | author templates |
| `POST/DELETE /api/catalog/branches` | `master_data.write` | master data |
| `POST/DELETE /api/inventory/reorder-thresholds` | `master_data.write` | master data |
| `POST /api/migration/upload`, `/commit` | `migration.write` | bulk ingestion |
| `GET /api/admin/*`, `GET /api/fim/*` | `user_admin.read` | governance (read) |
| `POST/PUT/DELETE /api/admin/*`, `POST /api/fim/*` | `user_admin.write` | governance (write) |

Every policy also passes for role `IT/Admin` (superuser). Operational read endpoints
(e.g. `GET /api/catalog/locations`, `GET /api/catalog/branches`) are intentionally open so
dropdowns/views work; mutations are what require a grant.

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
| **vault_location** (manage) | — | — | — | F |
| **master_data** (manage) | — | — | — | F |
| **workflow_design** (manage) | — | — | — | F |
| migration | RW | RO | RO | F |
| settings | — | — | — | F |
| user_admin | — | — | — | F |

The three manage modules are `HIDDEN` for all operational roles and `FULL` only for IT
Administrators — this is the concrete realization of the view-vs-manage segregation.

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

## 7. Adding a new module (checklist)

Wire the key in all four places (see [`AGENTS.md` §6](../AGENTS.md)):

1. `DbSeeder.cs` — `allModules` + each group dictionary.
2. `Program.cs` — register `Write("<key>.write","<key>")` / `Read(...)`.
3. Controller endpoint(s) — `[Authorize(Policy="<key>.write")]`.
4. `frontend/src/App.tsx` — `MODULE_KEYS` (with `tier`) + `canAccess`/`canModify` gating.

Also add the key to `AllModuleKeys` in `PMIMSControllers.cs` (IT/Admin superuser list).
Then **delete `pmims.db`** so the seeder applies the new grants.
