# ADR 0017 — Operations write matrix (role gate for rules, alarms, work orders, maintenance)

## Status

Accepted (2026-08-04). Amends ADR 0003 (role slugs) and extends the pattern
ADR 0009 established for master data.

Blocks `F4.11`. Fixes a hole that exists **independently** of `F4.11`.

## Context

Sixteen mutating endpoints across four controllers carry
`@UseGuards(JwtAuthGuard)` and nothing else — authentication with **no
authorization**. They authorize purely on `readableAssetIds` being non-empty:

| Controller | Mutating endpoints |
| --- | --- |
| `rules.controller.ts` | `POST evaluate` · `POST preview` · `POST /` · `PATCH :id` · `POST :id/publish` · `POST :id/duplicate` · `POST :id/archive` · `PATCH :id/enabled` |
| `alarms.controller.ts` | `POST :id/ack` |
| `work-orders.controller.ts` | `POST /` · `PATCH reorder` · `PATCH :id/status` · `POST :id/close` |
| `maintenance.controller.ts` | `POST schedules` · `POST schedules/:id/convert` · `PATCH schedules/:id` |

This is invisible today only because `scopeForUser` gives `operator` and
`viewer` an empty scope, so they are rejected for lack of *readable assets* —
not because any rule says they may not write. **Read scope is doing
authorization work it was never designed to do.**

`F4.11` exists to give those roles a read scope. The moment it lands, every
endpoint above opens to them. The security review of the `F4.11` branch
confirmed this and found it broader than first reported: `POST rules/evaluate`
persists (`rules.service.ts:496` inserts `ruleExecutions`) and can raise alarms,
so the expansion covers alarm *generation*, not just rule editing.

Two further facts make this urgent rather than theoretical:

- `infra/keycloak/bms-realm.json:127` ships `operator@bms.local` / `operator123`
  **committed to the repository**, and `access-control.service.ts:195` resolves
  a user by `or(users.id = jwt.sub, users.email = jwt.email)`. A `bms.users` row
  with that email plus one grant turns a committed password into a
  write-capable account.
- Nothing today provisions users or grants via API, so the path is currently
  unreachable. `F4.11` is the item that makes provisioning operators useful.

`ADR 0009 §20` already enumerates write roles explicitly for master data, so
naming write roles in an ADR is this repository's established practice. No ADR
covers operations writes.

## Decision

### 1. Two write classes, gated separately

Not every mutation is equal. Splitting them is what lets `operator` be useful
without handing it the rule engine.

- **Configuration writes** — change what the system *will* do, indefinitely, for
  everyone. Rule authoring and maintenance-schedule definition.
- **Operational writes** — record what *did* happen, or act on today's work.
  Alarm acknowledgement, work-order lifecycle, executing a due schedule.

### 2. The matrix

| Endpoint | Class | admin | organization_admin | location_admin | asset_group_admin | operator | viewer |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `POST rules/` · `PATCH rules/:id` · `publish` · `duplicate` · `archive` · `PATCH :id/enabled` | config | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `POST rules/evaluate` | config | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `POST rules/preview` | config | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `POST alarms/:id/ack` | ops | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `POST work-orders/` · `PATCH reorder` · `PATCH :id/status` · `POST :id/close` | ops | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `POST maintenance/schedules` · `PATCH schedules/:id` | config | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `POST maintenance/schedules/:id/convert` | ops | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

Three deliberate calls:

- **The four admin roles keep exactly what they have.** This ADR must not
  regress anyone. Their current reach is unchanged, including
  `asset_group_admin`, whose scope stays the narrowest by assets rather than by
  permission.
- **`rules/evaluate` is classified `config`, not `ops`,** despite being an
  action rather than an edit. It runs every enabled rule and can raise alarms
  across the caller's whole scope. A conservative default is correct for a
  security gate: widening it to `operator` later is a one-line change, and
  the reverse is a regression someone has to notice.
- **`rules/preview` is gated as `configuration`.** An earlier draft of this ADR
  exempted it as read-only, on the claim that it was "verified non-persisting".
  **That claim was wrong** — `rules.service.ts:274` inserts a `rule_preview`
  row into `bms.audit_log` on every successful call. Two independent reviews
  caught it. Preview is also a rule-*authoring* aid, so it takes the same class
  as the rest of rule authoring rather than a class of its own. Consequence:
  `viewer` and `operator` cannot preview. That is the correct trade — an
  endpoint that writes must be gated, and the lowest-privilege role must not be
  able to drive unbounded audit-table growth with caller-chosen payload
  strings.

### 3. Enforcement

A single `assertOperationsWriteRole(jwt, class)` on `AccessControlService`,
called at the top of each mutating handler **before** the scope check, so a
role rejection never depends on scope resolution and cannot be confused with
"no readable assets".

It resolves the role from **`bms.users`, not from the JWT claim**, matching
every other authorization decision in the service. The two sources drift: a
token outlives a demotion by up to `JWT_TTL` (8h), and in OIDC mode
`roleFromClaims` falls back to `viewer` when realm roles are missing. Reading
the claim would make the gate fail *open* on demotion and fail *closed* on a
claimless admin token.

Scope checks stay exactly as they are. This gate is **additive**: a caller must
now pass *both* the role gate and the existing asset-scope check. Nothing that
currently succeeds for the four admin roles begins to fail.

### 4. `F4.11` may then give BOTH roles a read scope

With the gate in place, `viewer` no longer has to be held at zero assets to stay
safe. `F4.11`'s branch deferred `viewer` precisely because widening it would
have granted writes — the gate removes that coupling, so `F4.11` can deliver its
full row (`operator` **and** `viewer`) rather than half of it.

## Dependencies

**None.** No new npm package. No migration — roles already exist on
`bms.users.role` and in the JWT.

## Consequences

**Positive.** Authorization stops being an emergent property of scope
resolution and becomes an explicit, greppable, testable rule. `F4.11` unblocks
and can ship whole. The committed `operator123` account stops being a latent
write vector. A future reader can answer "who may close a work order?" from one
table instead of by tracing scope propagation through four services.

**Negative.** Sixteen call sites gain a line. Two role checks now exist
(master data via `assertMasterDataRole`, operations via
`assertOperationsWriteRole`) and must not drift — mitigated by keeping both on
`AccessControlService` and testing the matrix as data.

**Neutral.** No behaviour change for any role in use today, because
`operator`/`viewer` currently resolve to zero assets and are already rejected.
This is a gate installed *ahead* of the traffic it governs — which is the only
safe order.

**Risk deliberately accepted.** The matrix is enforced by unit tests over a pure
function, not by integration tests against a live database. `F4.10` (automated
access-control integration tests, P0, unblocked by `F4.4`) is where the
end-to-end proof belongs. Until then, `scopeFromSource`'s query branches remain
runtime-unverified — a gap inherited from `F4.11`, not created here.

## Verification

- Unit tests over the matrix as data: every (role, endpoint-class) pair asserted,
  so adding a role without deciding its writes fails the suite.
- A test asserting `viewer` is rejected for every write class.
- A test asserting the four admin roles are accepted for every class — the
  no-regression guard.
- Red-then-green evidence per AGENTS.md §4.6, at the level this design admits:
  the matrix tests run against a deliberately permissive stub (reproducing the
  ungated behaviour) and must fail, then pass against the real matrix. They
  cannot "fail against the ungated controllers" — they exercise a pure
  function that did not previously exist. End-to-end proof through the
  controllers is `F4.10`'s job.
- A repository invariant (`tests/repo-invariants.test.ts`) asserts every
  `@Post`/`@Patch`/`@Put`/`@Delete` handler in the four controllers contains an
  `assertOperationsWriteRole` call, so the *next* mutating endpoint cannot ship
  ungated. Verified by removing a gate and confirming the suite names the exact
  file and line.

## Owed follow-up

Per AGENTS.md §9.10, a separate `chore(agents):` commit adds the write matrix to
`AGENTS.md` §4 alongside the existing master-data role rules, so the two role
gates are documented in one place.
