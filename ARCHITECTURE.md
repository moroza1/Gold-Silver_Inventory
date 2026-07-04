# Architecture — KFH PMIMS

> Reference architecture for the Precious Metals Inventory Management System.
> For a task-oriented orientation read [`AGENTS.md`](./AGENTS.md) first; for the full
> permission/module catalog see [`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md).

## 1. System overview

PMIMS is a Clean-Architecture modular monolith. A React/TypeScript SPA talks over HTTPS to an
ASP.NET Core (.NET 10) Web API. The API is layered into a pure Domain, an Application core of
use-case services, an Infrastructure layer for persistence and external integrations, and the
WebAPI host. Persistence is SQL Server in production with a SQLite fallback for local dev.

```
        +---------------------------------------------+
        |             React + TS SPA (Vite)           |
        +---------------------------------------------+
                   | HTTPS + JWT (Bearer)
                   v
        +---------------------------------------------+
        |        ASP.NET Core Web API (.NET 10)        |
        |  Program.cs: JWT auth + authorization policies|
        |  Controllers (partial class):                |
        |   - PMIMSControllers.cs        (operational)  |
        |   - PMIMSControllers.Admin.cs  (admin/govern) |
        +---------------------------------------------+
                   v
        +---------------------------------------------+
        |            Application Core                 |
        |  Interfaces + services (Reconciliation,     |
        |  Bulk Migration)                            |
        +---------------------------------------------+
           /                |                 \
          v                 v                  v
   +-------------+  +-------------------+  +---------------+
   | Domain Core |  |   Infrastructure  |  | External APIs |
   | Entities,   |  | EF Core DbContext,|  | AD / FIM /    |
   | Enums,      |  | Repository,       |  | rate feed     |
   | invariants  |  | Seeder, mocks     |  | (mocked)      |
   +-------------+  +-------------------+  +---------------+
                            |
                            v
                  +-----------------------+
                  | SQL Server / SQLite   |
                  +-----------------------+
```

## 2. Layers & responsibilities

- **PMIMS.Domain** — Entities (`Entities.cs`) mapped 1:1 to tables, operational enums
  (`Enums.cs`), and Sharia-compliance invariants. No outward dependencies.
- **PMIMS.Application** — Use-case services and the interfaces that decouple them from
  infrastructure (`Interfaces.cs`): `IInventoryRepository`,
  `IReconciliationService`, `IBulkMigrationService`, `IActiveDirectoryService`, `IFimService`,
  `IRateFeedService`. Houses `ReconciliationService`, `BulkMigrationService`.
- **PMIMS.Infrastructure** — `AppDbContext` (column mappings, indexes, the unique
  `(GroupId, ModuleKey)` permission index), `InventoryRepository` (data access, stored-proc
  emulation, and `GetEffectivePermissionsForUserAsync` permission merge), `DbSeeder` (vaults,
  products, demo users/groups/permissions), and `ExternalServices` (AD/FIM/rate-feed **mocks**).
- **PMIMS.WebAPI** — `Program.cs` wires DI, JWT authentication, authorization policies, CORS,
  session, and seeding-on-startup. Controllers map routes to repository/service calls.

Dependencies always point inward: `WebAPI → Application → Domain` and
`Infrastructure → Application → Domain`.

## 3. Authentication & authorization (request flow)

1. `POST /api/auth/login` → `IActiveDirectoryService` validates credentials (mock: DB users +
   legacy demo accounts).
2. The controller loads the user's **effective module permissions** and calls `GenerateJwt`,
   producing a signed JWT whose claims include each role and one `perm:<moduleKey>=<level>`
   claim per granted module.
3. The SPA stores the token and a one-time `fetch` interceptor attaches
   `Authorization: Bearer <token>` to every API call.
4. `Program.cs` validates the JWT and evaluates **authorization policies**. Protected endpoints
   declare `[Authorize(Policy = "<module>.write")]` (or `".read"`). A policy passes when the
   caller holds `FULL`/`READ_WRITE` (write) or any non-`HIDDEN` level (read) on the module, or
   is in role `IT/Admin` (superuser).

The frontend `canAccess`/`canModify` only shape the UI; the API is the enforcement boundary.

## 4. Permission & module architecture

Permissions are stored as `GroupPermission(ModuleKey, AccessLevel)` with
`AccessLevel ∈ {HIDDEN, READ_ONLY, READ_WRITE, FULL}`. Users inherit permissions from their
groups; multiple groups merge with **highest level wins**.

The defining design decision is **separation of operational (view) modules from administrative
(manage/setup) modules** so the two can be granted independently:

| Operational (view) | Administrative (manage) | Authority |
| :-- | :-- | :-- |
| `spatial_map` | `vault_location` | create/update/delete shelf locations |
| `workflows` | `workflow_design` | author workflow templates |
| (procurement / transfers views) | `master_data` | branches, vendors, reorder thresholds |
| — | `user_admin` | users, groups, permissions, FIM provisioning |
| — | `migration` | bulk Excel ingestion |

The full 21-module catalog and the per-role grant matrix are in
[`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md).

## 5. Controller organization

`PMIMSControllers` is a single logical controller implemented as a **partial class**:

- `PMIMSControllers.cs` — operational surface (auth, catalog reads, inventory/stock,
  procurement, transfers, reservations, custody, withdrawals, stocktake, reporting, workflow
  actions) plus shared helpers and DTOs.
- `PMIMSControllers.Admin.cs` — administration/governance (users, groups, permissions, FIM,
  branches, reorder thresholds).

This mirrors the operational/administrative tiering at the file level without changing DI or behaviour.

## 6. Domain mechanics worth knowing

- **Serialized ledger:** each bar (`inventory_items`) maps to a vault coordinate
  (`inventory_locations`: zone → shelf → slot) with a `row_version` concurrency token.
- **Maker-Checker:** purchase orders and transfers route through a configurable workflow engine
  (`workflow_templates` / `workflow_instances` / `approval_actions`).
- **Reservations:** pessimistic locks with a 5-minute TTL and an idempotency key to prevent
  double-submits.
- **Reconciliation:** balancing runs map the ledger to core banking / GL and quarantine breaks
  as `mismatch_cases`.

## 7. Data dictionary (selected)

| Table | Column | Notes |
| :-- | :-- | :-- |
| `inventory_locations` | `description` | computed `zone_room + shelf_row + slot_bin` |
| `inventory_items` | `serial_number` / `row_version` | unique stamp / concurrency token |
| `reservation_requests` | `expires_at` / `idempotency_key` | 5-min TTL lock / double-submit guard |
| `group_permissions` | `(group_id, module_key)` | unique; `access_level` ∈ HIDDEN/READ_ONLY/READ_WRITE/FULL |
| `mismatch_cases` | `status_code` | reconciliation break workflow (`OPEN` → `RESOLVED`) |

Full DDL is in [`database/schema.sql`](./database/schema.sql) and
[`database/procedures.sql`](./database/procedures.sql).

## 8. High availability & disaster recovery (production target)

- **Web tier:** Active-Active behind an F5 BIG-IP LTM across KFH HQ and secondary sites.
- **Database:** SQL Server **AlwaysOn Availability Groups**, synchronous-commit in the primary
  datacenter for zero-data-loss failover; asynchronous replication to the DR site (RPO < 5 min).
- **Failover:** Windows Server Failover Clustering (WSFC) + AlwaysOn listeners route the API to
  the active instance automatically.

## 9. Local development notes

- SQLite is created and seeded automatically on first run via EF Core `EnsureCreated()` — there
  are **no migrations**, so delete `pmims.db` to pick up schema/seed/permission changes.
- The JWT signing key in `appsettings.json` is a development placeholder; replace it in production.
- AD/FIM/rate-feed are mocks; swap the implementations behind their interfaces for real integration.
