# GL Configuration screen — maker-checker admin

Lets finance/admin users view and change the chart of accounts + posting-rule
mappings from the UI — no server file edits, no code changes — with 4-eyes
approval before anything affects how money is booked.

## How it works

The config is **versioned in the database** (`gl_config_versions`). Exactly one
row is `ACTIVE`; that's the config the live GL posts against, served hot from an
in-memory provider that reloads the instant a new version is approved (no restart).

Lifecycle of a change (all transitions enforced server-side in `GlConfigService`):

```
ACTIVE ──clone──▶ DRAFT ──submit──▶ PENDING_CHECKER ──approve──▶ ACTIVE
                    │  (maker edits)      │                        (prior ACTIVE → ARCHIVED)
                    │                     └──reject──▶ REJECTED
```

- **Maker** opens a draft (a clone of the active config), edits it, and submits.
  Every save runs `GlConfiguration.Validate()` — unbalanced rules or unknown
  accounts are rejected, so the screen can't persist a broken ledger.
- **Checker** (a *different* user — segregation of duties is enforced) approves
  or rejects. Approval archives the previous active version and hot-reloads the
  live config. The maker/submitter of a change can never approve it.

## The screen (frontend/src/GlConfigScreen.tsx)

Four panels, gated by the `gl_config` module permission:

- **Chart of Accounts** — the accounts table for the active (or draft) config.
- **Posting Rules** — rules grouped by event type, showing commodity, any match
  conditions (e.g. `ownership=CUSTOMER_OWNED` custody rules), and the Dr/Cr legs.
- **Simulator** — pick an event (Purchase/Sale/…), commodity, amount, ownership,
  and dry-run the real `PostingEngine`: it shows the exact balanced journal entry
  that would be produced and whether it balances. Can run against the open draft
  to preview a change *before* submitting it. Nothing is posted.
- **Versions & Approvals** — the version history with status badges, the draft
  editor (JSON, validated on save), Submit, and Approve/Reject (checker only).

Edit/approve controls appear only when `canModify('gl_config')` is true.

## RBAC (seeded)

New admin-tier module `gl_config`. Default grants: Reconciliation Officers
`READ_WRITE` (author/propose), IT Administrators `FULL` (approve), Treasury
Checker `READ_ONLY` (review), Treasury Maker `HIDDEN`. This gives a working
4-eyes out of the box (e.g. Recon proposes → Admin approves). Grant the module to
a dedicated "GL Config" group via User & Group Admin if you want separate duties.

## API (all under /api/gl-config, gated by gl_config.read / .write)

| Method & path | Who | Purpose |
|---|---|---|
| GET `/active` | read | current ACTIVE config version |
| GET `/versions`, `/versions/{id}` | read | history / one version |
| POST `/simulate` | read | dry-run a sample event (optionally vs a draft) |
| POST `/draft` | write | open/create the editable draft |
| PUT `/draft/{id}` | write | save draft (validates) |
| POST `/draft/{id}/submit` | write (maker) | → PENDING_CHECKER |
| POST `/versions/{id}/approve` | write (checker) | → ACTIVE (SoD enforced) |
| POST `/versions/{id}/reject` | write (checker) | → REJECTED (SoD enforced) |

## Verification

The maker-checker state machine and segregation-of-duties were modelled and all
pass: seed creates exactly one ACTIVE; DRAFT→submit→PENDING→approve→ACTIVE with
the prior ACTIVE archived and the single-ACTIVE invariant preserved; makers can't
approve/reject their own change; non-draft submit and non-pending approve are
blocked; rejection leaves the active config untouched. As with the rest of the
module, run `dotnet build` and `npm run build` in your environment to confirm the
compile — no .NET/Node SDK was available where this was authored.
