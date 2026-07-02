# Kuwait Finance House (KFH) - Precious Metals Inventory Management System (PMIMS)

PMIMS is a production-grade, secure, and Sharia-compliant inventory ledger and tracking platform designed for the Treasury Operations and Precious Metals division of Kuwait Finance House (KFH). The platform replaces legacy spreadsheet-based operations with a serialized database ledger, vault spatial coordinate mapping, and a zero-trust Maker-Checker authorization engine.

---

## Documentation map (start here)

- **[`AGENTS.md`](./AGENTS.md)** — onboarding for AI agents & new developers: repo map, run/build/test, security model, where code lives, conventions & gotchas. **Read this first.**
- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — layers, request/auth flow, module architecture, HA/DR.
- **[`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md)** — the module catalog, access levels, role matrix, and RBAC enforcement flow.
- **[`docs/MODULE_SEGREGATION_REVIEW.md`](./docs/MODULE_SEGREGATION_REVIEW.md)** — the architecture review and phase-by-phase change log behind the current design.

---

## Key Features & Architecture

- **Clean Architecture Monolith:** Built with C# & .NET 10.0 following a decoupled modular monolithic design (Domain, Application, Infrastructure, WebAPI, and Tests).
- **Dual-Database Support:**
  - **SQL Server Mode:** Production configuration utilizing native temporal tables, schema constraints, and transactional stored procedures.
  - **Local/SQLite Fallback Mode:** Development/Verification setup emulating transactions, locks, and calculations in memory.
- **Physical serialized inventory ledger:** Atomic movements mapping metal bars (gold/silver) to branch vault coordinate grids (zone, row, shelf, slot).
- **Maker-Checker Workflow (4-eyes):** Dual-authorization filters for procurement (POs) and inventory migrations.
- **Pessimistic Reservation Locks:** 5-minute TTL locks with idempotency guards for purchase checkouts.
- **Automated GL Reconciliation:** Continuous balancing runs mapping inventory ledger to Core Banking (IMAL) and General Ledgers, automatically quarantining breaks.
- **Zero-Trust Auth & RBAC:** Signed-JWT authentication with server-side authorization policies. Permissions are modular, separating operational *view* modules from administrative *manage/setup* modules (e.g. viewing the vault map vs. creating shelves). See [`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md).
- **Islamic Finance Integrations:** Real-time rate tickers matching GMT+3 operating hours with automatic IMAL fallback.

---

## Directory Structure

```
├── database/                   # Stored Procedures & Database Schema DDL scripts
├── backend/
│   ├── PMIMS.slnx              # Visual Studio Solution File (.NET 10)
│   ├── PMIMS.Domain/           # Domain models, Enums, and Sharia invariants
│   ├── PMIMS.Application/      # Use-case services, interfaces, and validators
│   ├── PMIMS.Infrastructure/   # DBContext, seeders, AD mock, and external APIs
│   ├── PMIMS.WebAPI/           # Controllers, middlewares, and API configuration
│   └── PMIMS.Tests/            # xUnit integration and unit test suite
└── frontend/                   # React + TypeScript SPA client built with Vite & CSS
```

---

## Running the Backend Web API

1. **Prerequisites:**
   - Install .NET 10 SDK on your system.

2. **Run Application:**
   From the repository root, execute:
   ```powershell
   cd backend/PMIMS.WebAPI
   dotnet run
   ```
   On startup, the application will seed a local SQLite database file `pmims.db` with sample vaults, branches, locations, products, and initial inventory, listening on `http://localhost:8080`.

---

## Running the React Frontend

1. **Prerequisites:**
   - Install Node.js (v18+) and npm.

2. **Start Dev Server:**
   From the repository root, execute:
   ```powershell
   cd frontend
   npm run dev
   ```
   The client will compile and serve the dashboard locally at `http://localhost:5173/`. Open this URL in your web browser.

---

## Executing the Test Suite

Run the full xUnit test suite covering Sharia supplier blocks, parallel reservation locks, and migration validation:

```powershell
cd backend
dotnet test
```

---

## System Contacts & Support

- **KFH Treasury Operations:** `treasury-ops@kfh.com.kw`
- **IT Core Integration Team:** `core-integration@kfh.com.kw`
- **Sharia Supervisory Board:** `sharia-board@kfh.com.kw`
