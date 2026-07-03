# AGENTS.md — PMIMS Onboarding for AI Agents & New Developers

> **Read this first.** It is the fastest path to understanding this repository. It explains
> what the system is, where everything lives, the core security/permission model, the
> conventions you must follow, and the traps that will waste your time if you don't know
> about them. For deeper detail see [`ARCHITECTURE.md`](./ARCHITECTURE.md),
> [`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md), and
> [`docs/MODULE_SEGREGATION_REVIEW.md`](./docs/MODULE_SEGREGATION_REVIEW.md).

---

## 1. What this is

**PMIMS** (Precious Metals Inventory Management System) is a Sharia-compliant inventory
ledger for the Treasury / Precious Metals division of Kuwait Finance House (KFH). It tracks
serialized gold/silver bars across vault coordinate grids (zone → shelf → slot), with a
Maker-Checker (4-eyes) authorization workflow, pessimistic reservation locks, and automated GL
reconciliation.

- **Backend:** C# / ASP.NET Core **.NET 10**, Clean Architecture, modular monolith.
- **Frontend:** React + TypeScript (Vite), a single-page app. Bilingual **English / Arabic (RTL)**.
- **Database:** SQL Server in production; **SQLite fallback** for local dev (auto-created & seeded).

---

## 2. Repository map

```
backend/
  PMIMS.Domain/          Entities.cs (DB-mapped entities), Enums.cs, Sharia invariants. No dependencies.
  PMIMS.Application/      Use-case services + interfaces. Depends only on Domain.
                          - Interfaces.cs            (IInventoryRepository, ...)
                          - ReconciliationService.cs, BulkMigrationService.cs
  PMIMS.Infrastructure/   Implements Application interfaces. Depends on Application + Domain.
                          - AppDbContext.cs           (EF Core mappings, indexes)
                          - InventoryRepository.cs    (data access + stored-proc emulation; RBAC merge)
                          - DbSeeder.cs               (seeds vaults, products, USERS, GROUPS, PERMISSIONS)
                          - ExternalServices.cs       (ActiveDirectory/FIM/RateFeed MOCKS)
  PMIMS.WebAPI/           HTTP layer. Depends on everything.
                          - Program.cs                (DI, JWT auth, AUTHORIZATION POLICIES, pipeline)
                          - Controllers/
                              PMIMSControllers.cs        (OPERATIONAL endpoints — partial class)
                              PMIMSControllers.Admin.cs  (ADMIN/GOVERNANCE endpoints — partial class)
                              PMIMSControllers.Fim.cs    (FIM INTEGRATION MODULE endpoints — partial class)
                          - appsettings.json          (DB + JWT config; dev-only signing key)
  PMIMS.Tests/            xUnit tests (PMIMSTests.cs).
frontend/
  src/App.tsx             The entire SPA (large, ~5k lines). Sidebar nav, all screens, fetch calls.
  src/main.tsx, *.css
database/                 schema.sql, procedures.sql (reference DDL for SQL Server mode).
docs/                     ARCHITECTURE notes, PERMISSIONS reference, the segregation design review.
```

**Dependency direction (Clean Architecture):** `WebAPI → Application → Domain`, and
`Infrastructure → Application → Domain`. Never make Domain or Application depend on WebAPI/Infrastructure.

---

## 3. Run / build / test

```bash
# Backend (seeds a local SQLite pmims.db on first run, serves http://localhost:8080)
cd backend/PMIMS.WebAPI && dotnet run

# Frontend (http://localhost:5173, proxies to the API at :8080)
cd frontend && npm install && npm run dev

# Tests
cd backend && dotnet test
```

Demo logins (seeded), password `Password123` for all:
`system-admin` (IT Administrators / full), `treasury-maker`, `treasury-checker`, `reconciliation-reconciler`.

---

## 4. The security model (most important section)

Authentication and authorization were hardened and are now enforced **server-side**. Do not
regress this.

**Login → token.** `POST /api/auth/login` authenticates via the (mock) Active Directory
service, then issues a **signed JWT** (`PMIMSControllers.GenerateJwt`). The token carries the
user's roles and **every effective module permission as a claim** of the form
`perm:<moduleKey> = <accessLevel>`.

**Enforcement.** `Program.cs` registers JWT Bearer auth and a set of **authorization policies**.
Protected endpoints carry `[Authorize(Policy = "<module>.write")]` / `".read"`. A policy passes
if the user holds the required level on that module **or** is in role `IT/Admin` (superuser).
The frontend `canAccess`/`canModify` helpers are **UX only** — the API is the real boundary.

**Permission storage.** `GroupPermission(ModuleKey, AccessLevel)` where
`AccessLevel ∈ { HIDDEN, READ_ONLY, READ_WRITE, FULL }`. Users get permissions via group
membership; `GetEffectivePermissionsForUserAsync` merges across groups (**highest level wins**).

**The segregation principle (the project's defining design choice).** Operational *view*
modules are deliberately separate from administrative *manage/setup* modules, so that viewing
data and changing its structure are independently grantable:

| Operational (view)                | Administrative (manage)       | Governs                                   |
| :-------------------------------- | :---------------------------- | :---------------------------------------- |
| `spatial_map`                     | **`vault_location`**          | create/update/delete shelf locations      |
| `workflows` (act on instances)    | **`workflow_design`**         | author workflow templates                 |
| procurement/transfers views       | **`master_data`**             | branches, vendors, reorder thresholds     |

A Branch Operator can therefore **view** the vault map (`spatial_map`) but cannot
**create/delete shelves** (`vault_location`). See [`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md)
for the full 15-module catalog and the per-role matrix.

---

## 5. Where to put code (controller split)

`PMIMSControllers` is a **`partial class` split across two files** — same class, same injected
services, no behavioural difference, just organization:

- **`PMIMSControllers.cs`** — operational endpoints: auth, catalog reads, inventory, stock,
  procurement, transfers, reservations, custody, withdrawals, stocktake, reporting, and the
  workflow-instance actions. Also holds the shared helpers
  (`GenerateJwt`, `BuildPermissionMap`, `AllModuleKeys`, `ComputeSha256`) and all request DTOs.
- **`PMIMSControllers.Admin.cs`** — administration/governance: users, groups, permissions,
  branches, reorder thresholds.
- **`PMIMSControllers.Fim.cs`** — the full FIM (Forefront Identity Manager) Integration
  Module: identity provisioning (users/profiles), access management (rights), password
  management, and delta-sync change detection. All 29 RFP-mandated functions, gated by the
  same `user_admin` policy as the rest of governance (see `docs/PERMISSIONS.md` and
  `docs/FIM_INTEGRATION.md`). Backed by `FimService` (`PMIMS.Infrastructure/FimService.cs`)
  against `AppUser`/`PrivilegeGroup`/`FimRight` — real persistence, not a mock.

Put new **operational** endpoints in the first file, new **admin/setup** endpoints in the
second, and any further FIM-surface endpoints in the third.

> **Note:** this system previously included a natural-language "AI Copilot" (NL→SQL query
> assistant with a Web Speech voice mode). It has been removed — do not re-add
> `AICopilotService`, the `/api/ai/query` endpoint, the `ai_copilot` permission module, or the
> associated chat/voice UI in `App.tsx`.

---

## 6. How to add a new permission module (end-to-end checklist)

A module key must be wired in **four** places to be consistent:

1. `DbSeeder.cs` → add to `allModules` **and** to each group's permission dictionary.
2. `Program.cs` → register the policy (`Write("<key>.write", "<key>")` / `Read(...)`).
3. The relevant controller endpoint(s) → `[Authorize(Policy = "<key>.write")]`.
4. `frontend/src/App.tsx` → add to `MODULE_KEYS` (with its `tier`) and gate UI with `canAccess`/`canModify`.

(`AllModuleKeys` in `PMIMSControllers.cs` is the IT/Admin superuser list — add the key there too.)

---

## 7. Conventions & gotchas (read before you debug)

- **Database reseed:** the app uses EF Core `EnsureCreated()` (no migrations). After changing
  the schema, seed data, or permission modules, **delete `backend/PMIMS.WebAPI/pmims.db`** so it
  re-seeds. An existing DB will *not* gain new tables/permission rows.
- **Frontend `tsc` false positives:** `tsc -b` reports `TS17008`/`TS1005` "unclosed tag /
  unterminated string" errors. These are **not real** — they are a known scanner desync caused by
  the Arabic (RTL) string literals, and they vanish entirely if the Arabic characters are removed.
  The app compiles and runs fine through Vite/esbuild. **Don't chase these as bugs.**
- **Mock externals:** Active Directory (login) and the live rate feed in `ExternalServices.cs`
  are mocks/simulations for local/dev — treat them as integration seams, not real services.
  **FIM is no longer mocked:** `FimService` (`PMIMS.Infrastructure/FimService.cs`) is a real
  implementation against `AppUser`/`PrivilegeGroup`/`FimRight`/`FimUserAttribute`/
  `FimUserRight`/`FimSyncLog` — it's the "application-own identity list" scenario the RFP
  calls out as a supported fallback to a real AD-backed FIM connector, not a stub. Password
  verification (`ActiveDirectoryService.AuthenticateAsync`) is algorithm-aware
  (`AppUser.PasswordAlgorithm`) because FIM's `SetPassword` can write BCRYPT or AES-256
  credentials, not just the legacy SHA-256 demo-seed hash — don't reintroduce a hard-coded
  SHA-256 comparison there.
- **Editing a workflow template while requests are in flight.** `SaveWorkflowTemplateAsync`
  (`InventoryRepository.cs`) used to delete-and-recreate the `WorkflowTemplate` row on every
  save, which changed its `TemplateId` and silently orphaned any in-progress
  `WorkflowInstance` still pointing at the old one (its current step could no longer be
  resolved — e.g. a P.O.'s "required role" would come back wrong/blank). It now (a) updates
  the template/steps **in place**, preserving `TemplateId`, and (b) refuses to save at all —
  `InvalidOperationException` surfaced as a 400 — while any instance of that `WorkflowType`
  is still non-terminal (`StatusCode == "PENDING_MAKER"`, which covers every in-progress step,
  not just the first one). Don't reintroduce the delete/recreate pattern; if you need a true
  "retire this template" action, it still needs the same pending-request guard.
- **Dev JWT key:** `appsettings.json` → `Jwt:Key` is a development placeholder. Load it from a
  secret store / environment variable before any real deployment.
- **Auth is server-side now.** If you add an endpoint that mutates admin/master data, add the
  matching `[Authorize(Policy=...)]`. Hiding a button in the UI is not security.
- **A missing `[Authorize]` is anonymous access, not "no worse than unauthenticated."** There is
  no global `RequireAuthorization()` fallback and no class-level `[Authorize]` on the
  controllers — an endpoint with no attribute is reachable by anyone, logged in or not. This bit
  us for real: `purchase_orders` (and, it turned out, `custody`, `stocktake`, `workflows`,
  `reports`, `pending_actions`) had endpoints with no `[Authorize]` at all *and* no policy
  registered in `Program.cs`, so e.g. Treasury Operations (Checker), seeded `READ_ONLY` on
  `purchase_orders`, could still create/edit POs. All operational modules now have registered
  `.read`/`.write` policies and their endpoints are attributed — see the map below. When adding
  a new write (or sensitive read) endpoint, don't assume "it'll just 401 without a token" —
  verify the policy exists in `Program.cs` **and** the attribute is on the action.
- **Policy ↔ module map (current state, all registered in `Program.cs`):**
  `user_admin.{read,write}`, `migration.{read,write}`, `purchase_orders.{read,write}`,
  `custody.{read,write}`, `stocktake.{read,write}`, `workflows.read`, `reports.{read,write}`,
  `pending_actions.{read,write}`, `vault_location.{read,write}`, `master_data.{read,write}`,
  `workflow_design.{read,write}`, `intake.{read,write}`, `dashboard.read`,
  `rules_engine.{read,write}`, `notifications.{read,write}`, `monitoring.{read,write}`,
  `dispensing.{read,write}`, `device_integration.{read,write}`. Note `workflows.write`
  deliberately does **not** exist — approving/rejecting a workflow instance
  (`POST /api/workflows/instances/{id}/action`) is gated by `pending_actions.write`, because
  that's the module Checker/Reconciliation actually hold `FULL` on (`workflows` itself is
  `READ_ONLY` for every non-admin role — it's just the browse/list view). Don't "fix" that by
  switching it to `workflows.write`, that would lock the checker out of approvals again.
  `GET /api/dashboard/executive-board` (`dashboard.read`), `POST /api/catalog/products`
  (`master_data.write`), and `POST /api/inventory/low-stock-alerts/{id}/draft-po`
  (`purchase_orders.write`) were the three remaining endpoints with no `[Authorize]` at all —
  fixed; see `docs/PERMISSIONS.md` §4 for the full endpoint→policy map.
- **No username-pattern-based authentication or role inference, anywhere.** There used to be a
  "legacy fallback" in `ActiveDirectoryService.AuthenticateAsync` that logged in *any* username
  not present in `AppUsers` — granting `IT/Admin` for any name containing `"admin"` — as long as
  the password was the literal demo string `Password123`. There was a second, independent copy
  of the same pattern in `InventoryRepository.GetUserRoles`, which derived Maker-Checker
  approval roles from substrings in the *username* rather than real `PrivilegeGroup`
  membership. Both are removed. Roles now come exclusively from `AppUser` → `UserGroupMembership`
  → `PrivilegeGroup.GroupName`, and `WorkflowStep.RequiredRole` (seeded in `DbSeeder.cs`) is
  kept equal to the literal `PrivilegeGroup.GroupName` of the group meant to act on that step —
  if you add a new workflow step, its `RequiredRole` has to match a real group name or every
  approval attempt on that step will fail with `UNAUTHORIZED_ROLE`. Do not reintroduce any
  `username.Contains(...)`-style role or auth shortcut.

---

## 8. Pointers

- Architecture & layers → [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- Permission/module catalog, role matrix, RBAC flow → [`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md)
- Why the segregation was done + phase-by-phase change log → [`docs/MODULE_SEGREGATION_REVIEW.md`](./docs/MODULE_SEGREGATION_REVIEW.md)
