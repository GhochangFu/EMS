# ADR 0046 — An `organization_admin` reads its own organization's audit log, and `NULL` is never in scope

## Status

**Accepted** — 2026-08-28, by the repository owner, at the `E7.1e` gate and
**before any implementation code**.

The owner was offered two readings and **ruled (b), the wider one**, against the
row's own recommendation of (a). That is recorded here rather than smoothed
over: the backlog row for `E7.1e`, `AGENTS.md` §6 and the drafting note at the
`E7.1c` gate all recommended the minimal option — keep the endpoint
global-admin-only and merely make the column consulted. The owner chose to widen
the reader. This ADR therefore exists to settle the one thing that ruling makes
load-bearing and (a) would have left dormant: **what a tenant-scoped reader does
with `organization_id IS NULL`.**

This **amends [ADR 0021](0021-audit-read-api.md) decision 1**, which restricted
read access to the global admin and deferred scoped reads explicitly — *"Scoped
audit reads for `organization_admin`, `location_admin` and `asset_group_admin`
are deferred, not silently omitted"*. The deferral is now lifted for
`organization_admin` only. It does **not** re-open ADR 0021's other decisions;
the two endpoints, the export cap and the refusal contract are untouched.

It is a **new ADR rather than an ADR 0043 amendment**, following the precedent
of [ADR 0044](0044-fail-closed-unprovisioned-admin-claim.md) and
[ADR 0045](0045-non-superuser-table-owner.md), both split out of ADR 0043 for
the same reason: this is an *authorization* decision about one endpoint, with
its own future amendment surface (the two roles still refused, and the pre-`0048`
history question), separable from ADR 0043's decisions about the tenant
boundary.

## Context

`bms.audit_log.organization_id` has had **a writer and no reader** since
`E7.1c`. The write half shipped in full — 17 direct `insert(auditLog)` sites and
38 `MasterDataAuditService.write` call sites stamp an organization, and migration
`0048` role-scoped the `NULL` `WITH CHECK` branch `TO bms_fleet` (ADR 0043
Amendment 5). `apps/api/src/admin/audit/audit.service.ts` was never touched:
both read methods call `requireGlobalAdmin` (`:49`, `:60`) and `buildWhere`
(`:129`) never mentions the column.

Nothing is broken today, and this was never a security gap — only the global
admin reaches the endpoint at all, so an unfiltered global-admin read is
correct. The cost is that every audit row written since `0046` carries an
attribution nothing consults.

**The problem the wider reading creates.** `organization_id IS NULL` means two
different things in this table, and only a date bound separates them:

- **Before `0048`** — un-attributed history. The column existed from `0046` but
  the population landed with `E7.1c`; rows older than that carry `NULL` because
  nothing was stamping them, not because they belong to nobody.
- **From `0048`** — genuine platform events. ADR 0043 decision 5 and `E7.1c`
  item D route platform-level events to `fleetDb` with a `NULL` organization
  **by design**.

A tenant-scoped reader that treats `NULL` as *"not mine"* hides history. One
that treats it as *"platform, show it"* leaks nothing secret but discloses fleet
activity to a tenant — and would contradict the posture the notification
`list()` already takes, where fleet-managed rows are withheld from an
`organization_admin` because *"a fleet-managed row is fleet business"*. `E7.1g`
is being decided in the same pass on exactly that principle.

## Decision

1. **An `organization_admin` may read and export audit rows whose
   `organization_id` is one of its own organizations.** The endpoint pair from
   ADR 0021 decision 2 is unchanged; only the gate and the `WHERE` change.

2. **`organization_id IS NULL` is never in a scoped reader's result set.** Not
   as history, not as platform events. This is the decision the owner's ruling
   forced and it is deliberately blunt: a date bound that silently reclassifies
   the same `NULL` on either side of a migration is a rule nobody can hold in
   their head at 3 a.m., and the failure mode of getting it wrong is a
   cross-tenant disclosure. The global admin's view is unfiltered and loses
   nothing, so no row becomes unreadable — only unreadable *by a tenant*.

3. **The gate keeps both checks it has today and adds one branch.** The ADR 0044
   provisioned-account probe stays first and unchanged, `requireMasterDataUser`
   stays, and then `writableOrganizationIds(jwt)` decides:
   `null` → unfiltered (global admin, exactly as now); a non-empty array →
   `inArray(auditLog.organizationId, ids)` conjoined into `buildWhere`. The
   method is renamed from `requireGlobalAdmin` to a name that states what it now
   returns, because a gate called `requireGlobalAdmin` that admits a tenant is
   the kind of stale name this repo has been bitten by.

4. **`location_admin` and `asset_group_admin` stay refused**, and ADR 0021's
   deferral stands for them. Their scope is *sub*-organizational; an audit row
   carries an organization and nothing finer, so there is no honest way to filter
   for them. Refusing is correct; returning their organization's rows would
   silently widen them to `organization_admin`.

5. **Both reads stay on `fleetDb`**, with the ADR 0043 Amendment 3 named reason
   recorded at the call site: the tenant filter is explicit in the `WHERE` and
   is the same predicate for `list` and `export`, so a GUC-bound `tenantDb` read
   would add a second, invisible filter that could only ever disagree with the
   first. An `admin` row is itself `NULL`-org and invisible to a no-GUC tenant
   read, which is the same reason the existing provisioned-account probe uses
   this pool.

6. **Export inherits the scope before the cap is counted.** ADR 0021 decision 5
   refuses an over-cap export rather than truncating it; the count must therefore
   be of the *scoped* set, or a tenant admin is refused an export on the size of
   rows it cannot see.

## Consequences

- **Pre-`0048` audit history becomes invisible to tenant admins**, permanently
  under this ADR. It stays fully visible to the global admin. If the product
  later wants that history attributed, that is a backfill with its own row and
  its own ADR — not a reader change, and explicitly not in scope here.
- **A tenant admin cannot see platform events.** Consistent with `E7.1g` and
  with `list()`'s existing posture. A tenant that notices "something changed and
  no audit row explains it" is seeing a platform event, and the answer is to ask
  the operator.
- **`AGENTS.md` §6 and §2 are now wrong** and must be corrected in a separate
  `chore(agents):` PR (§9.10) — §6's multi-tenancy bullet lists *"org-level read
  RBAC on `bms.audit_log`"* under **Still deferred**, and §2's *Audit read* row
  states the global-admin restriction as current. `docs/roadmap.md` needs the
  matching entry. **Do not fold either into the implementation PR.**
- **ADR 0029's OpenAPI document changes**: the two audit routes' role
  descriptions widen. No schema shape moves.
- The two refused roles remain the obvious amendment surface for this ADR.

## Amendment 1 (2026-08-28) — decision 3's array test is subordinate to decision 4's role list

Ruled by the repository owner after the `E7.1e` implementation review, on a
conflict all three reviewers found independently. **No decision is reversed and
no behaviour changes**; this amendment corrects wording that, read literally,
contradicts decision 4 of this same ADR.

**The conflict.** Decision 3 says the gate branches on
`writableOrganizationIds(jwt)`: *"`null` → unfiltered … a non-empty array →
`inArray(auditLog.organizationId, ids)`"*. Decision 4 says `location_admin`
stays refused. Those two cannot both be implemented as written, because
`AccessControlService.writableOrganizationIds` resolves a `location_admin`
through `locationDerivedOrganizationIds` — which returns **the organizations
implied by its location grants**, that is, the whole organization, not the
granted locations. A `location_admin` therefore produces a *non-empty array*
and, under decision 3's literal wording, would be admitted to every audit row
its organization owns.

That is precisely the read-gate-wider-than-write-gate defect `E7.1c`'s review
found on `ChannelsService.list()`, recorded in AGENTS.md §4.7, on a more
sensitive endpoint.

**The ruling.** Decision 4 governs. The gate branches on the **role resolved
from `bms.users`**, not on the shape of the scope array:

1. the ADR 0044 provisioned-account probe, unchanged and still first;
2. `requireMasterDataUser`, which refuses `asset_group_admin`;
3. `role === "admin" || role === "organization_admin"`, and everything else is
   refused. Only then is `writableOrganizationIds` consulted, for the scope
   alone and never for the authorization decision.

Two properties of that ordering are load-bearing and are stated here so a later
reader does not rediscover them:

- **The role comes from the database, not from `jwt.role`.** A token outlives a
  demotion by up to `JWT_TTL`, and in OIDC mode `roleFromClaims` falls back to
  `viewer` when realm roles are absent. Every other gate in
  `AccessControlService` reads the database role for the same reason.
- **An empty array is not the unrestricted `null`** (AGENTS.md §4.7). An
  `organization_admin` holding no `user_organization_access` grant resolves to
  `[]`, which must match no row. Decision 3 did not enumerate this case;
  `inArray(column, [])` compiles to the literal SQL `false` in the pinned
  `drizzle-orm@0.38.4`, which is the required behaviour, and
  `audit.integration.spec.ts` asserts it directly rather than trusting the
  compiler.

**Why an amendment rather than a silent implementation.** ADR 0021's own
Amendment 1 exists because that ADR's original wording asserted a property the
code did not have. Leaving decision 3 as written would repeat exactly that: the
next person to implement against this ADR reads "non-empty array" and reopens
the hole. Recording the subordination costs one section and closes it.

## Amendment 2 (2026-08-28) — a scoped reader sees the actor's email, never the acting operator's `oidcSubject`

Ruled by the repository owner after the `E7.1e` implementation review, raised
independently by the security and compliance reviewers. **This is a projection
rule, on the same pattern as [ADR 0043 Amendment
6](0043-multi-tenant-architecture.md#amendment-6-2026-08-28--a-fleet-managed-channels-failure-detail-is-redacted-in-a-tenants-ledger-its-code-is-not),
and it changes no policy, grant or migration.**

**What decision 2 did not cover.** Decisions 1–6 settle *which rows* a scoped
reader sees. They say nothing about *which columns*, and the projection is the
other half of the gate whenever the audience widens — the rule AGENTS.md §4.7
records from ADR 0043 Amendment 6. `E7.1e` changed no column in
`AuditAdminService.selectRows`; it changed who reads them.

**The disclosure.** Two channels carry the acting operator's identity to a
tenant admin:

- `actorEmail`, resolved through the `bms.users` left join; and
- `oidcSubject`, which **16 write sites across six services** place at the top
  level of the audit `payload` — `rules.service.ts`, `work-orders.service.ts`,
  `maintenance.service.ts`, `alarms.service.ts`,
  `alarm-enrichment.service.ts` and `channels.service.ts`. ADR 0021 returns
  `payload` verbatim, so they are returned with it.

A global `admin` — the Euphoria/Ion Exchange operator — is org-less and acts on
tenant data by design, so a fleet operator acknowledging an alarm for PHEWB
leaves rows that `phe-admin@bms.local` can now read.

**The ruling.** `actorEmail` stays; `oidcSubject` is blanked for any
non-`admin` caller.

An email in an audit trail is the answer to *"who changed this"*, and a tenant
is entitled to it for actions on its own data — withholding it would make the
ledger unable to do the job ADR 0021 built it for. An IdP subject identifier is
an internal credential of the identity provider; it answers no tenant question
and belongs to the operator's own account, not to the tenant's record.

Three implementation constraints, all inherited from ADR 0043 Amendment 6 and
stated so the follow-up does not re-derive them:

1. **Redact in SQL, not in the `.map()`.** The value must never leave Postgres
   for a tenant — a row that crosses the wire can reach a query log or an error
   dump. `payload - 'oidcSubject'` is the jsonb key removal; every one of the
   16 sites writes the key at the top level, so no recursive scrub is needed.
2. **Key it on the caller's `role`, not on `scope === null`.** Amendment 6
   settled this: should a future role ever resolve to a null scope, the
   role-keyed test still redacts and a scope-keyed one would silently stop.
3. **The redaction applies to the export as well as the list**, which share
   `selectRows` — decision 6's structure makes this automatic and
   `tests/e7.1e-audit-read-scope-guard.test.ts` pins it.

**Not in scope here.** This does not narrow what the writers record. The
`oidcSubject` stays in the stored row, because the global admin's view is the
forensic record and removing it there would destroy evidence to solve a
disclosure problem that a projection solves. Nor does it touch `payload`'s
verbatim return in general — the unbounded `z.record(z.unknown())` value spaces
that ADR 0021 decision 6 makes a standing obligation are a separate matter,
tracked against `E8.3`.
