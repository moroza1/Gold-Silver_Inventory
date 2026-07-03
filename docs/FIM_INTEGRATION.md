# FIM Integration Module — PMIMS

> RFP-mandated Forefront Identity Manager (FIM) integration layer. Orientation:
> [`AGENTS.md`](../AGENTS.md). Permission model: [`PERMISSIONS.md`](./PERMISSIONS.md).

## 1. Scope

PMIMS exposes every function the RFP's "FIM Integration Module" section mandates —
identity provisioning, access management (rights), password management, and delta-sync
change detection — against its own identity store (`app_users` / `privilege_groups`), which
is the RFP's explicitly-supported "application-own identity list" fallback scenario (Active
Directory remains the preferred source for a production FIM deployment; this module is the
sync target/source either way).

| FIM concept | PMIMS entity | Table |
| :-- | :-- | :-- |
| User | `AppUser` | `app_users` |
| Profile | `PrivilegeGroup` | `privilege_groups` (+ `group_permissions` for module grants) |
| Right | `FimRight` | `fim_rights`, bound via `fim_user_rights` |
| User attribute bag | `FimUserAttribute` | `fim_user_attributes` |
| Delta-sync ledger | `FimSyncLog` | `fim_sync_logs` |

Rights are intentionally a separate, finer-grained layer from Profile module grants —
`AddUserToRight`/`RemoveUserFromRight` bind a right straight to a user, independent of which
profiles (privilege groups) they belong to.

## 2. Architecture

```
                    ┌─────────────────────────────┐
   FIM Server  ───► │  REST API (this doc)         │ ───► FimService (PMIMS.Infrastructure)
  (sync agent)      │  /api/fim/*  (JSON)           │        │
                    │  PMIMSControllers.Fim.cs      │        ▼
                    └─────────────────────────────┘   AppDbContext (EF Core)
                                                          │
   FIM Server  ───► Direct SQL Server connectivity ───────┤
  (DB connector)     sp_FIM_* stored procedures           │
                                                          ▼
   FIM Server  ───► SOAP/WS-* facade (IIS 7 compatible) ─►│  same FimService, adapted via a
  (Web Service)      see §5                                  WCF BasicHttpBinding endpoint

   Batch/CLI   ───► tools/fim-cli (command connectivity, §5) ─► calls the REST API
```

All four connectivity modes converge on the same `IFimService` implementation
(`PMIMS.Infrastructure/FimService.cs`) or its SQL Server mirror (`database/procedures.sql`),
so behavior — validation, audit trail, delta-sync logging — is identical regardless of
transport. `GET /api/fim/connectivity` returns a machine-readable descriptor of what's
enabled on a given deployment.

## 3. Function → REST endpoint → stored procedure map

All REST endpoints are under `/api/fim` and gated by the existing `user_admin` policy
(`user_admin.read` for GET, `user_admin.write` for mutations) — see
[`PERMISSIONS.md`](./PERMISSIONS.md#4-endpoint--policy-map-server-side-enforcement).

### Identity Provisioning

| RFP function | REST endpoint | Stored procedure |
| :-- | :-- | :-- |
| `GetUsers()` | `GET /fim/users` | `sp_FIM_GetUsers` |
| `GetNumberOfUsers()` | `GET /fim/users/count` | `sp_FIM_GetNumberOfUsers` |
| `GetUserInfo(userId)` | `GET /fim/users/{userId}` | `sp_FIM_GetUserInfo` |
| `GetProfiles()` | `GET /fim/profiles` | `sp_FIM_GetProfiles` |
| `GetNumberOfProfiles()` | `GET /fim/profiles/count` | `sp_FIM_GetNumberOfProfiles` |
| `GetProfileInfo(profileId)` | `GET /fim/profiles/{profileId}` | `sp_FIM_GetProfileInfo` |
| `GetUsersFromProfile(profileId)` | `GET /fim/profiles/{profileId}/users` | `sp_FIM_GetUsersFromProfile` |
| `GetNumberOfUsersFromProfile(profileId)` | `GET /fim/profiles/{profileId}/users/count` | `sp_FIM_GetNumberOfUsersFromProfile` |
| `GetProfilesFromUser(userId)` | `GET /fim/users/{userId}/profiles` | `sp_FIM_GetProfilesFromUser` |
| `GetNumberOfProfilesFromUser(userId)` | `GET /fim/users/{userId}/profiles/count` | `sp_FIM_GetNumberOfProfilesFromUser` |
| `AddUser(userAttributes)` | `POST /fim/users` | `sp_FIM_AddUser` |
| `AddProfile(profileAttributes)` | `POST /fim/profiles` | `sp_FIM_AddProfile` |
| `AddUserToProfile(userId, profileId)` | `POST /fim/users/{userId}/profiles/{profileId}` | `sp_FIM_AddUserToProfile` |
| `UpdateProfileInfo(profileId, attrs)` | `PUT /fim/profiles/{profileId}` | `sp_FIM_UpdateProfileInfo` |
| `UpdateUserInfo(userId, attrs)` | `PUT /fim/users/{userId}` | `sp_FIM_UpdateUserInfo` |
| `RemoveUser(userId)` | `DELETE /fim/users/{userId}` | `sp_FIM_RemoveUser` |
| `RemoveProfile(profileId)` | `DELETE /fim/profiles/{profileId}` | `sp_FIM_RemoveProfile` |
| `RemoveUserFromProfile(userId, profileId)` | `DELETE /fim/users/{userId}/profiles/{profileId}` | `sp_FIM_RemoveUserFromProfile` |
| `RemoveUsersFromProfile(userIds[], profileId)` | `POST /fim/profiles/{profileId}/users/remove-batch` | `sp_FIM_RemoveUsersFromProfile` |

### Access Management (Rights)

| RFP function | REST endpoint | Stored procedure |
| :-- | :-- | :-- |
| `GetAllRights()` | `GET /fim/rights` | `sp_FIM_GetAllRights` |
| `GetNumberOfRights()` | `GET /fim/rights/count` | `sp_FIM_GetNumberOfRights` |
| `GetRightInfo(rightId)` | `GET /fim/rights/{rightId}` | `sp_FIM_GetRightInfo` |
| `GetAllRightsForUser(userId)` | `GET /fim/users/{userId}/rights` | `sp_FIM_GetAllRightsForUser` |
| `GetNumberOfRightsForUser(userId)` | `GET /fim/users/{userId}/rights/count` | `sp_FIM_GetNumberOfRightsForUser` |
| `GetAllUsersForRight(rightId)` | `GET /fim/rights/{rightId}/users` | `sp_FIM_GetAllUsersForRight` |
| `GetNumberOfUsersForRight(rightId)` | `GET /fim/rights/{rightId}/users/count` | `sp_FIM_GetNumberOfUsersForRight` |
| `AddUserToRight(userId, rightId)` | `POST /fim/users/{userId}/rights/{rightId}` | `sp_FIM_AddUserToRight` |
| `RemoveUserFromRight(userId, rightId)` | `DELETE /fim/users/{userId}/rights/{rightId}` | `sp_FIM_RemoveUserFromRight` |

### Password Management

| RFP function | REST endpoint | Stored procedure |
| :-- | :-- | :-- |
| `SetPassword(userId, password, encryptionAlgorithm)` | `POST /fim/users/{userId}/password` | `sp_FIM_SetPassword` |

Body: `{ "password": "...", "encryptionAlgorithm": "BCRYPT" }`. `encryptionAlgorithm` is
`BCRYPT` (default, one-way, `BCrypt.Net-Next`) or `AES256` (reversible, AES-256-CBC, key from
`Fim:AesKey` configuration). Hashing/encryption happens in
`PMIMS.Infrastructure/PasswordHasher.cs`; the stored procedure only ever receives/stores the
already-hashed value — plaintext never reaches the database layer.

### Connectivity & Sync

| Purpose | REST endpoint | Stored procedure |
| :-- | :-- | :-- |
| Connectivity descriptor | `GET /fim/connectivity` | — |
| Delta change detection | `GET /fim/sync/delta?since={ISO8601}` | `sp_FIM_DetectDeltaChanges` |

## 4. Delta change detection

Every mutating FIM function writes one row to `fim_sync_logs` (`entity_type`, `entity_key`,
`change_type` ∈ `CREATE/UPDATE/DELETE`, `changed_at`, `changed_by`, `source`). An FIM sync job
calls `DetectDeltaChanges(lastSyncTime)` (REST: `GET /fim/sync/delta?since=...`; DB:
`sp_FIM_DetectDeltaChanges`) to pull only what changed since its last successful run, instead
of re-scanning the full user/profile/right catalog on every cycle. Every mutating call also
writes a normal `audit_logs` entry so the change is visible in the standard PMIMS audit trail
alongside every other administrative action.

## 5. Connectivity support

- **Database connectivity.** Direct SQL Server access via the `sp_FIM_*` procedures
  (`database/procedures.sql`) — no application tier in the loop. Recommended for high-volume
  batch sync from FIM's own SQL Server management agent.
- **Web Service connectivity (SOAP/WS-\*, IIS 7-compatible).** The REST API
  (`PMIMSControllers.Fim.cs`) is the primary transport. Where KFH's FIM deployment requires
  classic SOAP/WS-\* (matching FIM's native Web Service connector and older IIS 7-hosted
  consumers), stand up a thin WCF `BasicHttpBinding` service (hosted under IIS 7 in-process,
  or self-hosted and IIS-proxied) whose operation contract mirrors the function table in §3
  and delegates directly to the same `IFimService`. This keeps validation/audit/delta-log
  behavior identical to the REST path — the SOAP layer is a protocol adapter only, not a
  parallel implementation. (Tracked for implementation alongside the KFH Integration
  Middleware SOAP layer — see the RFP compliance design document, item 3 — since both need
  the same WCF hosting setup.)
- **Command-based (CLI/batch) connectivity.** For FIM batch jobs that shell out rather than
  call a service, a thin CLI wrapper (`tools/fim-cli`, one subcommand per function in §3)
  authenticates with a service-account JWT and calls the REST API, returning JSON on stdout
  and a non-zero exit code on failure — suitable for FIM's Windows PowerShell/Command
  connectivity model.
- **IIS 7 compatibility.** The REST API itself runs behind ASP.NET Core's Kestrel with an IIS
  reverse-proxy module, which is compatible with an IIS 7 front end (classic pipeline mode
  supported via `httpPlatformHandler`/`ANCM`). The SOAP facade above is what actually needs
  IIS 7-native (non-Core) hosting compatibility, since FIM's own Web Service connector
  expects a classic ASMX/WCF-under-IIS7 endpoint shape — that's why it's called out as a
  separate hosting target rather than folded into the Kestrel/ASP.NET Core process.

## 6. Error handling, logging, audit

- Validation failures (missing mandatory attributes, duplicate username/email/profile name)
  return `400 Bad Request` / `409 Conflict` from the REST layer, or `THROW` a custom error
  number (510xx range) from the stored procedures, inside a `TRY/CATCH` with
  `ROLLBACK TRANSACTION`.
- Every mutation writes both a `fim_sync_logs` row (machine-readable delta feed) and an
  `audit_logs` row (human-readable trail, consistent with every other PMIMS administrative
  action) — see `FimService.LogSyncAsync` / `WriteAuditLogAsync` and
  `sp_FIM_LogSyncChange` / the inline `audit_logs` inserts in each procedure.
- Password values are never written to `fim_sync_logs.details_json` or `audit_logs` —
  only the algorithm tag.

## 7. OpenAPI/Swagger

The endpoints in §3 are `[ApiController]`-attributed ASP.NET Core Web API actions and are
therefore automatically included in the project's OpenAPI document once Swashbuckle/
`Microsoft.AspNetCore.OpenApi` is enabled on `PMIMS.WebAPI` (`app.MapOpenApi()` /
`AddSwaggerGen()` in `Program.cs`); no separate spec file to hand-maintain. Request/response
shapes are the DTOs in `PMIMS.Application/FimModels.cs`
(`FimUserDto`, `FimProfileDto`, `FimRightDto`, `FimSyncChangeDto`,
`FimConnectivityDescriptor`) and `PMIMSControllers.Fim.cs`
(`FimAttributesRequest`, `FimAssignRequest`, `FimBatchUserIdsRequest`, `FimSetPasswordRequest`).
