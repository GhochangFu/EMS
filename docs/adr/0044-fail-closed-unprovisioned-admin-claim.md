# ADR 0044 — Fail-closed identity resolution for an unprovisioned admin claim

## Status

Accepted (2026-08-24). Authorized by the repo owner while closing `F4.16`
(ADR 0043), via the AGENTS.md §10 gate.

## Context

`AccessControlService.resolveDbUser` (`apps/api/src/auth/access-control.service.ts`)
falls back to the **JWT claim** when no `bms.users` row matches the token's
`sub` or `email`. ADR 0021 Amendment 1 found and fixed this for exactly one
endpoint — the audit read API — after measuring that it handed the entire
audit log to any Keycloak principal holding the realm role `admin`, provisioned
or not. That amendment explicitly declined to generalize the fix: *"The
fallback itself is unchanged and out of scope here. It is pre-existing, affects
all of `/admin/*`, and is already recorded against `F4.10` in
`docs/BACKLOG.md` as belonging to its own ADR."* `docs/BACKLOG.md` records the
same deferral, and `access-control.integration.spec.ts`'s
`assertUnprovisionedTokenBehaviour` pins the current behaviour on purpose,
with a comment naming exactly this: *"Changing it is a security decision with
an ADR attached, not a drive-by edit... When it changes, this test fails and
points at the decision."* This is that decision.

`F4.16`'s closing security review re-surfaced it. ADR 0043 Amendment 1's
Consequences section claims the gap is already closed: *"An unprovisioned
principal has no home organization, and therefore no pool. The bootstrap fails
closed rather than defaulting... A test covers it."* That description matches
`apps/api/src/auth/identity-bootstrap.ts` (`readIdentity`/`selectPool`)
exactly — but that module has **zero production callers** (confirmed by grep
across `apps/api/src`; only its own two test files reference it). ADR 0043's
claim is false for the code that actually runs.

**Reassessed blast radius, not assumed.** This is pre-existing, not something
`F4.16` introduced or worsened: before `F4.16`, every read ran on the single
owner connection, which already bypassed everything for the same fallback
role; after `F4.16`, the same fallback yields the same unfiltered result via
`bms_fleet`. It is real, and not client-forgeable (the guard verifies RS256,
issuer and audience; local mode signs the DB role directly) — but a
deprovisioned admin's token still resolves to unrestricted access until
`JWT_TTL` (default 8h), because deleting the `bms.users` row removed the only
thing constraining the claim. ADR 0021 Amendment 1 named this exact shape:
*"deleting someone's `bms.users` row would have escalated them to global admin
rather than revoking them."*

**Traced precisely before deciding the fix's shape, on both surfaces a role
can reach.** On the master-data surface,
`writableOrganizationIds`/`writableLocationIds`
(`access-control.service.ts:153-195`) return `null` — the unrestricted
sentinel every caller trusts — **only** inside the `role === "admin"` branch.
Every other role's authorization walks a grant table keyed by user id:
`organization_admin` via `directOrganizationIds`, `location_admin` via
`userLocationAccess`, and `operator`/`viewer`/`asset_group_admin` via
`access-scope.ts`'s four-source precedence walk. An unprovisioned principal's
fabricated `id`/`email` matches no grant row regardless of claimed role, so
those paths already return `[]`/`"none"` today, not unrestricted access.
`canManageOrganization`/`canManagePointKey`/`canManageTemplate` were checked
the same way: each returns `true` unconditionally only inside its own
`role === "admin"` branch.

On the separate ADR 0017 operations-write surface (`alarms`, `rules`,
`maintenance`, `work-orders`), `asset_group_admin` is admitted for **both**
write classes alongside `admin`/`organization_admin`/`location_admin`
(`operations-write.ts:23-31`) — a permission level `writableOrganizationIds`
does not gate at all. That surface is closed by a different mechanism, not by
this decision's `null`-sentinel argument: `readableAssetIds` for
`asset_group_admin` never returns `null`, only an empty array, because
`readScopeSourcesForRole` routes it through the same grant-table walk — and
every consumer (`alarms.service.ts`, `maintenance.service.ts`,
`work-orders.service.ts`, `rules.service.ts`) denies on that empty array.
Confirmed for an unprovisioned `asset_group_admin` claim specifically, not
assumed from the pattern. **Only a claimed `admin` with no row escalates,
across both surfaces — and only via the `null`-sentinel path this decision
closes.**

**The fallback is load-bearing for a second, legitimate reason, and that use
must survive.** `assertUngrantedRolesFailClosed` in the same spec file depends
on the identical fallback to let a freshly-federated `operator`/`viewer`
principal reach the app — with a correctly empty scope — before a local
`bms.users` row exists for them. A blanket refusal for every unprovisioned
claim would remove that path along with the one that actually needs closing.

## Decision

1. `resolveDbUser` refuses — `ForbiddenException` — when no `bms.users` row
   matches the token **and** the token's `role` claim is `"admin"`. Every
   other claimed role keeps today's fallback-to-claim behaviour, which the
   grant-lookup walk above already resolves to no access.
2. `apps/api/src/auth/identity-bootstrap.ts` is deleted, along with its two
   test files (`identity-bootstrap.spec.ts` and any `.test.ts` wrapper). Its
   `PoolChoice`/`selectPool` design assumed a live, per-identity pool
   selection this codebase does not use — `F4.16` Task 6.6 settled on a fixed
   pool per service call site instead (`fleetDb` for RLS-table reads trusting
   an app-computed `WHERE`, `tenantDb` inside `withTenant` for writes) — and
   `selectPool`'s single-`organizationId` tenant branch cannot represent a
   multi-organization `organization_admin`, which is exactly why `F4.16` never
   wired it in. Leaving it in place after this decision would misrepresent it
   as "the" fix a second time, for the next reader who trusts ADR 0043's own
   Consequences section.
3. `access-control.integration.spec.ts`'s `assertUnprovisionedTokenBehaviour`
   is rewritten to pin the corrected behaviour: an unprovisioned `admin` claim
   is refused; an unprovisioned non-admin claim still resolves via the claim,
   with an empty/`"none"` scope proven downstream by the existing
   `assertUngrantedRolesFailClosed`.

## Dependencies

None.

## Consequences

- Closes the one path where deleting a `bms.users` row could escalate a
  principal rather than revoke them: a deprovisioned admin's token now fails
  on the next request that calls `resolveDbUser`, instead of surviving until
  `JWT_TTL` expires.
- Does **not** change `organization_admin`/`location_admin`/`operator`/
  `viewer`'s fallback-to-claim behaviour. That asymmetry is now decided and
  documented rather than left to be rediscovered as a "why does this still
  fall back" question.
- ADR 0043 Amendment 1's Consequences section asserted a property the code did
  not have; corrected there (Amendment 2), not here — this ADR is the decision
  for identity resolution, ADR 0043 is the decision for the tenant/RLS pool
  split, and they should stay separately amendable.
- Does not touch the separately-flagged question of whether `bms.*` read-side
  isolation for `organization_admin`/`location_admin` should route through
  `withTenant`-scoped connections instead of `fleetDb` plus an app-computed
  filter (ADR 0043 decision 12's stated scope vs. its shipped scope). That is
  a design question about RLS's role as a backstop, not an identity-resolution
  defect, and stays with ADR 0043.
