# PMIMS — Module & Function Segregation Review

**System:** KFH Precious Metals Inventory Management System (PMIMS)
**Scope:** Separating administrative functions from operational (normal‑user) functions; redesigning the module/permission model; impact on the AI Copilot.
**Date:** 2026‑06‑29

> **Update (2026‑07‑01):** the AI Copilot feature discussed throughout this review (§8, the
> `ai_copilot` module, `AICopilotService`, `/api/ai/query`) has since been removed from the
> codebase entirely, including its chat/voice UI in `App.tsx`. The sections below are kept as a
> historical record of the segregation work; they no longer describe live functionality.

---

## 1. Executive summary

PMIMS calls itself a "Clean Architecture modular monolith," but in practice it is **layered, not modular**. Every operational, configuration, and administrative concern is collapsed into:

- **One backend controller** — `PMIMSControllers.cs` (1,155 lines) holding auth, catalog, shelves, stock, procurement, custody, withdrawals, stocktake, migration, reporting, the workflow engine, branches, reorder thresholds, FIM provisioning, **and** user/group/permission administration.
- **One frontend file** — `App.tsx` (5,308 lines) holding all twelve screens.
- **One flat permission list** — `MODULE_KEYS` (12 entries), each carrying a single access level (`HIDDEN` / `READ_ONLY` / `READ_WRITE` / `FULL`).

The concern you raised — that *displaying* shelves and *creating/managing* shelves should not live in the same place — is correct, and it is a symptom of a broader pattern: **operational reads and administrative writes share the same module boundary**, so a single grant exposes both. This document proposes a clean separation into bounded modules, a verb‑level permission model, server‑side enforcement, and the matching changes the AI Copilot needs.

The single most important finding sits underneath all of this: **there is no server‑side authorization at all.** `app.UseAuthorization()` is in the pipeline, but no policies are registered and no `[Authorize]` attribute exists on any endpoint. All RBAC today is the frontend hiding UI. Any authenticated caller can `POST /api/catalog/locations` or `DELETE /api/admin/groups/{id}` directly. Segregation only becomes real once it is enforced at the API.

---

## 2. The core problem, in your words

> "the shelves as display and creating shelves … should be segregated between the location of them."

Concretely, in `PMIMSControllers.cs`:

| Endpoint | Nature | Who should use it | Today's module key |
| :--- | :--- | :--- | :--- |
| `GET /api/catalog/locations` | Operational read — view the vault grid & occupancy | Branch operator, teller, auditor | `spatial_map` |
| `POST /api/catalog/locations` | **Configuration write** — define a new shelf/slot | Vault administrator only | `spatial_map` (same key) |
| `DELETE /api/catalog/locations/{id}` | **Configuration write** — remove a physical slot | Vault administrator only | `spatial_map` (same key) |

All three are gated by the *same* module. Granting an operator `READ_WRITE` on `spatial_map` so they can do their job hands them the power to **delete physical vault locations**. The access *level* is binary (read vs write); it cannot express "may view the map but may not alter its structure." This same collapse repeats across the system: branches, reorder thresholds, vendors, workflow templates, and user/group admin are all "write = full control."

---

## 3. Segregation principles

Four rules drive every recommendation below.

1. **Separate by intent, not just by data.** A shelf has a *view* surface (operational) and a *definition* surface (administrative). They are different modules even though they touch the same table.
2. **Configuration is not operation.** Defining the structure the business runs on (locations, branches, vaults, thresholds, workflow templates, users, permissions) is "Setup/Admin." Running daily transactions against that structure is "Operations." These are different bounded contexts with different audiences and different blast radius.
3. **Permissions are `resource:action`, not `module:level`.** Replace one access level per screen with explicit verbs (`view`, `create`, `update`, `delete`, `approve`). This is what makes "view shelves without editing shelves" expressible.
4. **The boundary is enforced server‑side.** A module split that only hides buttons is cosmetic. Each module maps to an authorization policy checked at the controller.

---

## 4. Proposed module map (bounded contexts)

Group the existing ~40 endpoints into **eight modules in two tiers**.

### Tier A — Operations (normal users)

| Module | Responsibility | Current endpoints it absorbs |
| :--- | :--- | :--- |
| **Inventory & Vault Map** | View stock registry, available stock, the vault spatial map (read‑only), intake received shipments | `stock/items`, `stock/available`, `catalog/locations` (GET), `vault/intake` |
| **Procurement** | Raise/amend POs, act on low‑stock alerts, create draft POs | `purchase-orders` (POST/PUT/GET), `inventory/low-stock-alerts*` |
| **Transfers** | Initiate and receive branch transfers | `transfers*` |
| **Sales & Custody** | Reservations, purchase confirmation, customer holdings, withdrawals/redemption | `reservations*`, `purchases`, `custody/holdings`, `withdrawals/*` |
| **Stocktake & Controls** | Run stocktake sessions, log scans, view reconciliation discrepancies | `stocktake/*`, `reconciliation/discrepancies` |
| **Reporting & AI** | Valuation/holdings/transaction reports, audit‑log report, AI Copilot | `reports/*`, `ai/query`, `copilot/query`, live `rates` |

### Tier B — Administration / Setup (privileged users)

| Module | Responsibility | Current endpoints it absorbs |
| :--- | :--- | :--- |
| **Master Data Setup** | **Define** shelf locations, branches, vaults, vendors, products, reorder thresholds | `catalog/locations` (POST/DELETE), `catalog/branches*`, `catalog/vendors` (write), `inventory/reorder-thresholds*` |
| **Governance & Identity** | Users, groups, permissions, FIM provisioning, workflow‑template design, bulk data migration | `admin/users*`, `admin/groups*`, `fim/*`, `workflows/templates*`, `migration/*` |

> **Note on the workflow engine.** Distinguish *designing* a workflow (template authoring → Governance, admin) from *acting on* a workflow instance (approve/reject → stays with the operational module the entity belongs to, e.g. Procurement, Transfers). Today both live under one `workflows` key.

---

## 5. Function‑level segregation — the shelf example, generalized

For each entity, split the **operational view** from the **administrative definition**. The shelf case becomes the template for all of them:

```
BEFORE                                   AFTER
spatial_map (READ_WRITE)                 vault.map        : view            ← Operations
  ├─ view grid + occupancy               vault.location   : create/update/delete ← Master Data Setup (Admin)
  ├─ create slot
  └─ delete slot
```

Applied across the system:

| Entity | Operational module → action | Admin module → action |
| :--- | :--- | :--- |
| Shelves / locations | `vault.map:view` | `vault.location:create / update / delete` |
| Branches | `transfers:view` (as dropdown source) | `branch:create / update / delete` |
| Vendors | `procurement:view` (selectable supplier) | `vendor:create / update / delete` |
| Reorder thresholds | `procurement:view` (alerts) | `reorder_threshold:create / update / delete` |
| Workflow | `workflow.instance:act` (approve/reject) | `workflow.template:create / update` |
| Users & groups | *(none — operators never see this)* | `iam.user:*`, `iam.group:*`, `iam.permission:assign` |

This directly answers your requirement: the **display** of a shelf lives in an Operations module, the **creation/management** of a shelf lives in a Master Data Setup (Admin) module, and the two are governed by separate permissions even though they read/write the same `inventory_locations` table.

---

## 6. Redesigned permission model

### From `module:level` to `resource:action`

Today (`MODULE_KEYS` + access level):

```jsonc
// one level governs view AND write for the whole screen
{ "spatial_map": "READ_WRITE" }   // = can view map AND delete physical slots
```

Proposed (verb‑scoped grants):

```jsonc
{
  "vault.map":      ["view"],
  "vault.location": ["view"]          // operator: sees structure, cannot change it
}
// vs an administrator:
{
  "vault.location": ["view", "create", "update", "delete"]
}
```

`GroupPermission` (today `ModuleKey` + `AccessLevel`) gains an `Action` dimension — either a third column, or `AccessLevel` becomes a bitmask/CSV of verbs. `GetEffectivePermissionsForUserAsync` keeps its "highest wins" merge, but merges **verb sets** (union) rather than picking the strongest single level.

### Example role → permission matrix

| Permission (`resource:action`) | Teller | Ops Maker | Ops Checker | Recon Officer | Vault Admin | IT/Admin |
| :--- | :-: | :-: | :-: | :-: | :-: | :-: |
| `vault.map:view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `vault.location:create/update/delete` | | | | | ✓ | ✓ |
| `procurement:create` (raise PO) | | ✓ | | | | ✓ |
| `workflow.instance:act` | | | ✓ | ✓ | | ✓ |
| `sales.custody:create` | ✓ | | | | | ✓ |
| `branch:manage` | | | | | ✓ | ✓ |
| `iam.user:manage` | | | | | | ✓ |
| `ai.copilot:query` | | ✓ | ✓ | ✓ | ✓ | ✓ |

(Cells left blank = no grant. This is illustrative; the matrix is owned by the business.)

---

## 7. Closing the enforcement gap (critical)

Segregation is meaningless until the server enforces it. Recommended path:

1. **Issue a real token at login.** `auth/login` currently returns `"JWT-MOCK-TOKEN-KFH"` and the effective permissions as JSON. Replace with a signed JWT whose claims carry the user's merged `resource:action` grants (and `branch_id` — see §8).
2. **Register one authorization policy per resource/action** and decorate endpoints:
   ```csharp
   [HttpPost("catalog/locations")]
   [Authorize(Policy = "vault.location:create")]
   public Task<IActionResult> CreateLocation(...)
   ```
3. **Split the god‑controller** so the policy boundaries are obvious and reviewable:
   ```
   Controllers/
     Operations/   InventoryController, ProcurementController, TransfersController,
                   SalesCustodyController, StocktakeController, ReportingController
     Admin/        MasterDataController, GovernanceController, IamController
     AiCopilotController
   ```
   Mirror the same split in the frontend (`src/modules/operations/*`, `src/modules/admin/*`) so `App.tsx` stops being a 5k‑line monolith and the admin bundle can even be route‑lazy‑loaded and hidden from operator builds.
4. **Keep `canAccess` / `canModify` in the UI**, but treat them strictly as UX (hide what the user can't do). They are no longer the security boundary.

---

## 8. Impact on the AI Copilot

This is where segregation has the largest hidden payoff — and the largest current risk. Findings from `AICopilotService.cs` and the two AI endpoints:

### 8.1 The Copilot ignores the new module boundaries entirely
Its only access control is one hardcoded string check:
```csharp
if (string.Equals(userRole, "Branch Officer", ...)) return "Access Denied";
```
Everyone else gets the **full schema** — all 24 table mappings, including `customers` (`civil_id`, `mobile_number`, `email`), `customer_holdings`, and `sales_orders`. A user with no custody or customer module grant can still ask the Copilot "show all customers" and receive PII. **The AI is a side‑channel around the very segregation we are building.**

**Fix:** make the Copilot's reachable schema a function of the caller's permissions. Tag every `TableMapping` with the module that owns it, then at query time intersect the mapping set with the user's granted modules:

```csharp
// pseudo
var allowedTables = TableMappings
    .Where(m => userPermissions.Can($"{m.Module}:view"));
// GenerateDynamicSql + JoinRules operate ONLY over allowedTables
```
If a generated JOIN would traverse into a table the user can't see (e.g. `customers`), drop the join or refuse. This makes the AI inherit segregation for free instead of bypassing it.

### 8.2 Two AI endpoints, inconsistent and spoofable
There are **two** query paths: `POST /api/ai/query` (in PMIMSControllers) and `POST /api/copilot/query` (dedicated controller). The dedicated one defaults `UserRole` to `"Guest"` and trusts the role **from the request body**. A caller simply sends `{"userRole":"IT/Admin"}` to defeat the Branch‑Officer block. Consolidate to one endpoint and derive `userId`/role/permissions **from the auth token**, never from the DTO.

### 8.3 No row‑level (branch) scope
The engine has no notion of "this user only sees their branch." It even hardcodes `vault_id = 1` for location queries as a display hack. Once `branch_id` is a token claim, inject a mandatory predicate for operational roles:
```sql
... WHERE br.branch_id = @callerBranchId   -- parameterized, forced for non-HQ roles
```

### 8.4 Harden the generator while you're in there
- **Parameterize.** Filters are built by string interpolation (`mt.metal_name = '{metalFilter}'`). Values come from a fixed whitelist today, so it isn't directly injectable, but the architecture should move to parameters so it stays safe as filters grow.
- **Allow‑list, then deny‑list.** `IsMaliciousSql` is a deny‑list (blocks `drop|delete|...`). Pair it with the schema allow‑list from §8.1 so the model can only ever name approved, permitted tables/columns.
- **Audit already logs prompt + generated SQL** — keep that; add the resolved permission scope to the log line so denials are explainable.

**Net:** the same `resource:action` permission set that drives the UI and the controllers should also drive the Copilot's schema and row scope. One source of truth, no side‑channels.

---

## 9. Suggested phasing

1. **Phase 1 — Enforcement first (highest risk reduction).** Real JWT with permission claims; add `[Authorize]` policies to existing endpoints as‑is. No new modules yet — just stop trusting the client.
2. **Phase 2 — Permission model.** Add the `Action` dimension to `GroupPermission`; migrate the 12 flat keys to `resource:action`; update the admin UI's permission matrix.
3. **Phase 3 — Split the shelf‑style pairs.** Separate view vs setup for locations, branches, vendors, thresholds, workflow templates. This is the concrete answer to your request and is low‑risk once Phase 2 exists.
4. **Phase 4 — Physically split controllers and `App.tsx`** into Operations/Admin modules; lazy‑load the admin bundle.
5. **Phase 5 — AI alignment.** Consolidate to one Copilot endpoint, derive identity from the token, scope schema + rows by permissions.

Phases 1, 2 and 5 are the security‑critical ones; 3 and 4 are the structural cleanup that delivers the segregation you asked for.

---

## 10. Quick wins (do this week, independent of the big refactor)

- Add `[Authorize]` to the `admin/*`, `catalog/locations` write, `catalog/branches` write, and `workflows/templates` endpoints — they are unprotected today.
- Delete or disable the duplicate `POST /api/ai/query` so there is a single, controlled Copilot entry point.
- Stop trusting `UserRole` from the Copilot request body; until tokens land, look it up server‑side from the username.
- Remove `customers`/`customer_holdings`/`sales_orders` from the Copilot schema for any role that lacks a custody grant.

---

## 11. Implementation status (all phases applied)

All five phases have been implemented in the codebase. Summary of what changed:

**Phase 1 — Authentication & server‑side enforcement.** `auth/login` now issues a signed JWT (`GenerateJwt`) carrying the user's roles and effective module permissions as `perm:<moduleKey>` claims. `Program.cs` registers JWT Bearer auth + `UseAuthentication()` and an authorization‑policy set; the open admin/setup endpoints now carry `[Authorize(Policy=…)]`. The frontend attaches the token via a one‑time `fetch` interceptor. (`appsettings.json` carries a **dev‑only** signing key — replace it from a secret store before deployment.)

**Phase 5 — AI alignment.** The Copilot service takes the caller's permission map (not a spoofable role string); `/api/ai/query` reads identity from the token; the duplicate `/api/copilot/query` controller was removed. Each Copilot table is tagged with an owning module and the generated SQL is scoped to the caller's grants, so customer PII requires a `custody` grant.

**Phases 2 & 3 — Manage/view segregation.** Rather than a schema migration, the flat module list was extended with dedicated **administrative manage/setup modules** that are independent of their operational view counterparts:

| Operational (view) | Administrative (manage) | Governs |
| :--- | :--- | :--- |
| `spatial_map` | **`vault_location`** | create/update/delete shelf locations |
| `workflows` (act on instances) | **`workflow_design`** | author workflow templates |
| (procurement/transfers view) | **`master_data`** | branches, vendors, reorder thresholds |

These are wired end‑to‑end: seeded per group (operators get them `HIDDEN`, IT Administrators `FULL`), enforced by policies (`vault_location.write`, `master_data.write`, `workflow_design.write`), and surfaced in the frontend permission matrix and gating. This is the concrete answer to the original request — an operator can **view** the vault map but cannot **create/delete** shelves.

**Phase 4 — Structural split.** The backend controller is now a `partial class`: operational endpoints remain in `PMIMSControllers.cs`, while users/groups/FIM/branches/thresholds moved to `PMIMSControllers.Admin.cs` (same class, zero behavioural change). The frontend sidebar is reorganised into **Operations** and **Administration & Setup** tiers. A full physical extraction of the 5,300‑line `App.tsx` into separate module files remains a larger follow‑up best done with a build/IDE in the loop.

### Residual / deployment notes
- **Reseed the database.** The app uses `EnsureCreated` (no migrations), so an existing `pmims.db` will not gain the new permission rows/modules. Delete `pmims.db` (or run against a fresh DB) so the seeder grants the new `vault_location` / `master_data` / `workflow_design` modules. Demo logins: `system-admin` / `treasury-maker` / `treasury-checker` / `reconciliation-reconciler`, password `Password123`.
- **Replace the JWT signing key** in `appsettings.json` with a secret‑store/environment value.
- **Build & test locally.** The backend wasn't compiled in this environment (no .NET SDK); run `dotnet build` + `dotnet test` (the Copilot test now also covers the permission‑scope block). The frontend was verified to parse cleanly — the only `tsc` diagnostics are pre‑existing false positives caused by right‑to‑left Arabic text in the source (they disappear entirely when the Arabic characters are stripped), and the app builds/runs via Vite.
