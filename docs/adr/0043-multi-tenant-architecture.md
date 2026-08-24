# ADR 0043 — Multi-tenant architecture: tenant boundary, RLS isolation, and org-scoped configuration

## Status

**Accepted** — 2026-08-24, by the repository owner, the same day it was drafted.
Thirteen decisions, ruled in two passes: decisions 1–7 and 10–13 before
drafting, then decisions 8 and 9 and the three sub-rulings inside decision 5
after this document derived them. **All five open questions ruled as
recommended, none against** — see *Questions resolved at the §10 gate*.

**Amended 2026-08-24** at the start of `F4.16`, before any implementation code —
see [Amendment 1](#amendment-1-2026-08-24--decision-8-needs-a-third-role-and-question-5s-placement-was-written-against-the-old-order)
at the end. Decision 8 gains a third role, `bms_auth`, and a third pool, because
neither `bms_tenant` nor `bms_fleet` can serve the pre-tenant read that chooses
between them. Question 5's **placement** is corrected — the `password_hash`
revoke lands in `F4.16` with the grant matrix, not in `E7.1`. Its substance and
decisions 1–7 and 9–13 are unchanged.

One decision changed between the owner's ruling and this draft. Decision 6 was
ruled as `asset_id NOT NULL`; drafting found that `time_window` rules
legitimately carry no asset, the finding was put back to the owner, and the
ruling was amended to `organization_id NOT NULL` with `asset_id` left nullable.

`E7.1` is Wave 4 / P1 and its `Depends` cell reads `ADR, F4.16`. This ADR
satisfies the first. **Decision 4 makes `F4.16` a hard prerequisite rather than
a parallel row**, so `E7.1` cannot start until it lands, and decision 8 adds
work neither row currently estimates.

`E7.1` is the backlog row this ADR gates. Its `Depends` cell reads
`ADR, F4.16`, and this is that ADR. It **re-opens a superseded decision**:
AGENTS.md §6 line 1107 reads *"Multi-tenancy, row-level security (org-level read
RBAC still deferred)"*, so accepting this is a **§10 promotion**, not a §9.4
dependency gate. It adds no npm package.

## Context

Two client artifacts now demand the same thing. The Ion Exchange SOW §11
requires **multi-tenant architecture**, and the reply mail of 2026-08-22 repeats
the phrase *"cloud-based multi-tenant web portal"*. Question **A6** —
*what is a tenant* — was raised in
`docs/ion-exchange-clarifications-2026-08-17.md` and asked again in
`docs/ion-exchange-response-form-2026-08-22.md:53`. **No reply has arrived.**
The backlog note of 2026-08-22 records that the ADR can frame both tenant models
without the answer; this ADR instead **rules the fork on the owner's authority**,
because the owner answered A6 directly on 2026-08-24. If Ion Exchange later
contradicts decision 1 or 2, this ADR is amended, not worked around.

Four facts about the repository as it stands shape every decision below.

**`bms.organizations` is a scope, not a boundary.** The table exists and the
seed holds two unrelated companies — `('ESKOM', 'Eskom SMOC')` and
`('PHEWB', 'Public Health Engineering — West Bengal')`
(`packages/db/src/hierarchy-seed.ts:43`). The role ladder already has six rungs
including `organization_admin` (`packages/shared/src/contracts/auth.ts:10`), and
`AccessControlService.writableOrganizationIds` already resolves an org admin's
organizations through `bms.user_organization_access`. But only **five** tables
carry `organization_id`: `locations`, `user_organization_access`, `point_keys`,
`asset_templates`, `onboarding_sessions`. Every other tenant-bearing table
inherits its tenant through a join, or not at all.

**Two configuration surfaces have no tenant at all.**
`bms.automation_rules` has no organization column and its `code` is globally
unique. `bms.notification_channels` (ADR 0041) is the same: no organization
column, `code` globally unique, and `assertAdminRole` throws unless the role is
exactly `admin` (`apps/api/src/auth/access-control.service.ts:115`), so an
`organization_admin` cannot see a channel today. Because a rule reaches a
channel through `bms.rule_notifications`, **adding `organization_id` to the
channel alone would not contain anything** — a tenantless rule could still fan
out to any tenant's webhook. This is why F3.8's admin UI is single-tenant and
why the fix is a platform decision rather than a column.

**The application connects as the database owner.** `docker-compose.yml` sets
`POSTGRES_USER: bms_app`, and `api`, `api-replica`, `migrate`, `sim` and
`ingest` all use `postgres://bms_app:...`. `apps/api/src/database/database.module.ts`
builds **one shared `pg.Pool`** from that single `DATABASE_URL`. A table owner
bypasses row-level security unless the table is set to `FORCE ROW LEVEL
SECURITY`, and a superuser bypasses it even then. **Enabling RLS against this
deployment as it stands would be theatre.** Decision 8 exists for that reason.

**`telemetry.point_values` is not shaped like the rest.** It is the hypertable,
keyed `(time, asset_id, point_key)` with **no organization column**, and ADR
0023 hangs four continuous-aggregate levels off it while ADR 0024 adds
compression and retention policies. Aggregate refresh runs as a background
worker under the table owner. A per-row policy joining to `bms.assets` would be
both a performance problem and a collision with those jobs. Decision 9 states
the exception rather than leaving it as a gap for the next agent to "fix".

## Decision

### The tenant

1. **A tenant is one end customer of Ion Exchange, and one `bms.organizations`
   row is one tenant.** Ion Exchange business units are not modelled. The
   alternative — one tenant per business unit, with end customers as locations
   beneath — is rejected: it forces a migration the first time any end customer
   asks for its own login, and the seed already holds two unrelated companies
   rather than two divisions of one.

2. **Ion Exchange holds the global `admin` role.** Ion Exchange staff create
   organizations and onboard their own customers. Euphoria Infotech operates the
   platform and holds a **separate named operator account**, also at `admin`,
   used for support and recorded in `bms.audit_log` like any other actor. No
   seventh role is introduced. A `platform_admin` rung above `admin` was
   considered and rejected as premature: it touches every guard in
   `access-control.service.ts` to express a distinction that two accounts
   already express.

3. **End-customer staff get logins in phase 1, across the full role ladder,
   including `organization_admin`.** This is the decision that makes the tenant
   boundary a **security control rather than a convenience**. A customer
   `organization_admin` can write — rules, channels, master data — inside its
   own organization. Every decision below is sized for that, not for a
   read-only customer.

### Isolation

4. **PostgreSQL row-level security enforces the boundary on `bms.*` tenant
   tables, from the start.** `F4.16` therefore becomes a **hard prerequisite of
   `E7.1`**, not a follow-up, and the `E7.1` `Depends` cell already says so.
   Application guards remain and are extended, but they are the second layer,
   not the only one: a forgotten `.where()` must return an empty set, not
   another company's alarm text. Schema-per-tenant and database-per-tenant were
   rejected — both break the single hypertable, the migration runner and every
   cross-tenant report, and they are a different product architecture rather
   than a change to this one.

5. **Every tenant-bearing `bms.*` table gains a `NOT NULL organization_id`
   column, and the policy reads that column.** No policy joins another table to
   discover the tenant. The tables that gain the column are, at minimum:
   `assets` (today via `location_id`), `asset_groups`, `asset_points`, `rtus`,
   `alarms`, `automation_rules`, `rule_executions`, `notification_channels`,
   `notification_deliveries`, `work_orders`, `maintenance_schedules`,
   `maintenance_history`, `audit_log`. Junction tables
   (`rule_notifications`, `asset_group_members`, `alarm_affected_assets`)
   inherit through their parent and take a policy that follows the parent's
   column. The lookup tables — `asset_domains`, `rule_categories`,
   `alarm_severities`, `protocol_catalog`, `notification_channel_kinds`,
   `map_locations` — are **platform vocabulary, not tenant data**: they get no
   column and no policy.

   **`bms.users` is the hard case, and it is ruled here rather than skipped.**
   Decision 3 puts end-customer staff into that table, and it holds
   `password_hash`, so leaving it uncovered would let any `bms_tenant`
   connection read every tenant's user rows. It gains
   `organization_id NOT NULL` naming the user's **home** organization, and the
   policy reads that column like every other table. `bms.user_organization_access`
   keeps its present job — granting an Ion Exchange user access to several
   customer organizations — and those users reach the other tenants through
   `bms_fleet` (decision 12), not through a policy that joins the grant table.
   A policy keyed through `user_organization_access` was considered and
   rejected: `location_admin` and `asset_group_admin` users hold no row there,
   so the join would have to cover three grant tables and would still miss them.

   `audit_log` is the one exception to `NOT NULL` in this decision. Platform
   events — "organization X was created", "user Y was created" — belong to no
   tenant, so `bms.audit_log.organization_id` is **nullable**, and a `NULL` row
   is visible only under `bms_fleet`. Every tenant-scoped action must still
   write the column; a `NULL` on an asset or rule action is a defect, not a
   platform event.

   **`password_hash` stays out of every response regardless.** RLS narrows which
   rows a connection sees, not which columns. A customer `organization_admin`
   with visibility of its own users must not read their hashes. **The migration
   that creates `bms_tenant` therefore revokes `password_hash` from it**, in the
   same grant matrix decision 8 writes, and only the login path reads the column
   through a role that still holds it. Ruled at the gate; see question 5.

6. **`bms.automation_rules` gains `organization_id NOT NULL`, and `asset_id`
   stays nullable.** The tenant comes from the new column, so the policy needs
   no join either way, and a `time_window` rule legitimately has no asset —
   `evaluateTimeWindowRule(row, new Date())` reads none
   (`apps/api/src/rules/rules.service.ts:670`), and only threshold rules
   validate `assetId` on create (`:820`). Making `asset_id NOT NULL` was
   considered and rejected: it buys nothing for isolation and removes a working
   rule kind. `code` uniqueness moves from global to
   **`(organization_id, code)`**.

7. **`bms.notification_channels` becomes org-scoped, and identity becomes
   `(organization_id, code)`** — the same shape as `asset_templates`'
   `(organizationId, code, version)`. A new
   `AccessControlService.canManageNotificationChannel(jwt, organizationId)`
   mirrors `canManagePointKey`: `admin` always true, `organization_admin`
   delegating to `canManageOrganization`, every other role false. The channel
   routes and the delivery-ledger route drop `assertAdmin` for that method.
   **The ledger route must filter by writable organization ids** —
   `bms.notification_deliveries` carries alarm text, and without the filter one
   customer's admin reads another's.

### What makes RLS real

8. **The API's request path connects as a new non-owner role, and `bms_app`
   stops being the application's runtime role.** *(Derived by this ADR. Not yet
   ruled.)*
   - `bms_app` remains the owner and is used by `migrate`, `pnpm db:seed`, the
     Timescale background jobs, `apps/sim` and `apps/ingest`.
   - A new `bms_tenant` role receives `SELECT`/`INSERT`/`UPDATE`/`DELETE` grants
     on `bms.*` and `telemetry.*` and **owns nothing**, so policies bind to it.
   - A new `bms_fleet` role holds the same grants and additionally the
     **`BYPASSRLS` role attribute** (`ALTER ROLE bms_fleet BYPASSRLS`). It
     serves decision 12. `BYPASSRLS` is a property of the role, not a policy
     exemption, and `FORCE ROW LEVEL SECURITY` does not restrain it — `FORCE`
     constrains the **table owner** only. The two mechanisms are separate and
     this ADR uses both, for different reasons.
   - Every tenant table is created with `ALTER TABLE ... ENABLE ROW LEVEL
     SECURITY` **and** `FORCE ROW LEVEL SECURITY`, so a future owner-role
     connection does not silently defeat the policy.
   - **`DatabaseModule` builds two pools, not one, and the role is chosen at
     connect time.** `DATABASE_URL` splits into `DATABASE_URL_TENANT` and
     `DATABASE_URL_FLEET`; `apps/api/src/database/database.module.ts` provides a
     `pg.Pool` and a Drizzle client for each, and a request-scoped resolver
     picks one from the **database** user record. `SET ROLE` on a single shared
     pool was considered and rejected: it puts the escalation one statement
     away inside the same transaction that decision 10 already relies on, and
     a `RESET ROLE` reaching a pooled connection would leave it privileged for
     the next caller.
   - This is a `docker-compose.yml` change, a `DATABASE_URL` split, a second
     pool in `DatabaseModule`, and a grant matrix in the migration. It is the
     whole substance of decision 4; without it, decision 4 changes nothing.

9. **RLS covers `bms.*`. `telemetry.*` is a stated exception, enforced at the
   application layer.** *(Derived by this ADR. Not yet ruled.)*
   `telemetry.point_values` keeps its `(time, asset_id, point_key)` key and gains
   **no** organization column and **no** policy. Isolation for telemetry comes
   from `AccessControlService.readableAssetIds`, which already gates every read
   path, and from the fact that a caller must name an asset id to read a row.
   The reason is ADR 0023 and ADR 0024: four continuous-aggregate levels and the
   compression and retention policies refresh under the owner, and a per-row
   join to `bms.assets` would both slow the hypertable and collide with those
   jobs. **This is a decision, not an omission.** Revisiting it means revisiting
   the aggregate ladder, and belongs in its own ADR.

10. **The tenant is set with `SET LOCAL` inside a transaction, once per
    request.** `database.module.ts` builds one shared `pg.Pool` and connections
    are reused across requests, so a plain `SET` leaks the previous request's
    tenant to the next caller on the same connection. Every tenant-scoped
    request therefore opens a transaction, issues
    `SET LOCAL app.current_organization = $1`, and runs its queries inside it —
    reads included. A read path that cannot be wrapped in a transaction is not
    permitted to touch a tenant table. A test must prove that two sequential
    requests for different organizations on the same pooled connection see
    different rows.

### Migration and operation

11. **The backfill resolves through the asset path and aborts on anything it
    cannot resolve.** Migration `00NN_tenant_columns.sql` fills
    `organization_id` from `asset_id → bms.assets.location_id →
    bms.locations.organization_id` wherever that path exists, then raises with
    the offending ids listed if any row remains `NULL` before the `NOT NULL`
    constraint is added. A default organization was considered and rejected:
    after decision 3 it attaches one tenant's rule to another tenant, which is a
    data leak rather than a tidy-up. Erasing unresolvable rows was also
    rejected — destructive steps need their own decision. Forward-only and
    idempotent, per §4. **`bms.automation_rules` rows of type `time_window`
    with no `asset_id` cannot be resolved and will abort the migration by
    design**; the seed's one such rule carries `pvAsset.id` and survives, but a
    deployment with operator-authored rules may not, and that is the human
    decision the abort exists to force.

12. **`admin` sees the whole fleet, and it does so by connecting as
    `bms_fleet`.** Ion Exchange operates its customers' plants and cannot run a
    service desk one login at a time, so one dashboard shows every tenant.
    **The bypass is pool selection at connect time, not a flag in application
    code** — the `bms_fleet` pool of decision 8, whose role carries `BYPASSRLS`.
    The API resolves the pool from the database user record,
    not from the JWT claim — the same authority `assertAdmin` was corrected to
    read during the F3.8 security review. **A customer `organization_admin` must
    never resolve to `bms_fleet`, and a test proves it.** A separate
    aggregated read model was considered and rejected for phase 1: it adds a
    job and makes the fleet view lag the live data.

### SMTP and notification configuration

13. **The SMTP transport stays platform-owned in the environment. Organizations
    own presentation and routing only.** ADR 0041 decision 8 stands unchanged:
    `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` and
    `SMTP_FROM` are read once in `notifications.config.ts`, no service body
    reads `process.env`, and none of them appears in any UI. The reason is
    deliverability, not convenience: SPF, DKIM and DMARC align with the sending
    domain, and the platform owns that domain.

    What an organization owns, in `notification_channels.config` and the
    encrypted secret columns: from-name, reply-to, recipient lists, webhook URL,
    webhook HMAC secret, and the per-channel rate limit.

    **Per-organization SMTP is deferred, and the mechanism for it already
    exists.** `secret_ciphertext`, `secret_iv` and `secret_key_version` with
    `CredentialCryptoService` (ADR 0012) would carry a per-org relay password
    the day a customer demands mail leave its own server. That is a later
    amendment, not phase 1: it makes Ion Exchange the support desk for every
    customer's mail server.

## Consequences

- **`E7.1` cannot start until `F4.16` lands.** The two rows are now one
  sequence: `F4.16` (row-level security, P2, 4–6) becomes a prerequisite of
  `E7.1` (P1, 10–14). Decision 8 is work neither row currently estimates — the
  role split, the grant matrix and the compose change are new.
- **Decisions 3 and 12 pull against each other, and decision 8 is the only thing
  between them.** A customer admin can write; `admin` reads everything; the
  connection role is the single control that separates them. That is the highest
  risk this ADR creates, and it is why decision 12 names a test rather than
  describing an intention.
- **`bms.users` needs a column-level grant as well as a policy.** RLS narrows
  rows, not columns, so a customer `organization_admin` that can see its own
  users could otherwise select `password_hash` on any connection reaching the
  table directly. The revoke lands inside `E7.1` with the grant matrix, which
  means the login path needs a role that still holds the column — one more thing
  the two-pool split of decision 8 has to account for.
- **Every tenant table gains a column and a policy.** Roughly fourteen tables in
  decision 5, plus the junctions. Existing queries keep working — the policy is
  additive — but each one must be re-verified against a non-owner role, because
  a query that passed as owner proves nothing.
- **The F3.8 admin UI splits in two.** The channel and delivery pages become
  org-scoped for `organization_admin` and fleet-wide for `admin`. The
  readiness banner stays as ADR 0041 decision 10 left it: not admin-gated, one
  boolean and one sentence per kind, because it names no host and no credential.
- **`telemetry.*` isolation stays exactly as strong as `readableAssetIds`.**
  Decision 9 makes that explicit rather than implicit. If that guard is ever
  wrong, no database layer catches it, unlike `bms.*` after decision 4.
- **What stays deferred:** per-organization SMTP relays (decision 13),
  white-label branding per tenant, a `platform_admin` rung (decision 2),
  cross-tenant reporting through a separate read model (decision 12), and the
  business-unit tenant model (decision 1). Each needs its own ADR or an
  amendment here.
- **If Ion Exchange answers A6 differently, this ADR is amended, not
  circumvented.** Decisions 1, 2 and 3 are the ones their answer can move.
  Decisions 4 through 12 hold under either tenant model.

## Questions resolved at the §10 gate

All five open questions were put to the repository owner on 2026-08-24 and all
five were ruled **as drafted**. They are recorded here because each was derived
by this document rather than chosen up front, and a later reader should be able
to tell the two apart.

1. **Decision 8 — the role split.** Ruled: `bms_tenant` and `bms_fleet`, two
   `pg.Pool` instances, `DATABASE_URL` split in two. `SET ROLE` on a single
   shared pool was offered and rejected, on the grounds that it puts escalation
   one statement inside the transaction decision 10 already opens.
2. **Decision 9 — `telemetry.*`.** Ruled: stated exception, application-layer
   enforcement through `readableAssetIds`. Denormalising `organization_id` onto
   `point_values` was offered and rejected — it widens the widest table in the
   database and forces the aggregate and compression settings to be
   re-validated.
3. **`bms.users`.** Ruled: home `organization_id NOT NULL`, policy reads the
   column. A policy joining `user_organization_access` was offered and rejected,
   because `location_admin` and `asset_group_admin` users hold no row there.
4. **`bms.audit_log`.** Ruled: `organization_id` nullable, and a `NULL` row is
   visible only under `bms_fleet`. A platform pseudo-organization was offered
   and rejected — decision 1 says Ion Exchange is not a tenant.
5. **`password_hash`.** Ruled: the column-level revoke from `bms_tenant` lands
   **inside `E7.1`**, in the same migration that writes the grant matrix — not
   as a follow-up row afterwards.

Two things the gate confirmed rather than changed:

- **Euphoria's operator account stays a named `admin` user.** Ruled: no
  `platform_admin` rung and no account-kind column. `bms.audit_log.actor_id`
  already names the actor, and separating vendor from customer administration is
  Ion Exchange's governance problem, not the platform's. If that changes, it is
  an amendment here.
- **A6 is still unanswered by the client.** This ADR proceeds on the owner's
  ruling of 2026-08-24. Recorded so the next reader does not mistake it for a
  client-confirmed decision. Decisions 1, 2 and 3 are the ones a client answer
  can still move.

## Promotion follow-ups (AGENTS.md §10, owed in a separate `chore(agents):` PR)

- **`AGENTS.md` §6** — line 1107, *"Multi-tenancy, row-level security (org-level
  read RBAC still deferred)"*, is exactly what this ADR promotes. It must be
  softened to name what is now in scope and what stays deferred (per-org SMTP,
  white-label, business-unit tenancy, `telemetry.*` RLS).
- **`AGENTS.md` §2 / status line** — a *Tenancy* row naming
  `bms.organizations` as the tenant, the
  `bms_tenant`/`bms_fleet`/`bms_auth` role split (Amendment 1),
  and the `SET LOCAL` rule from decision 10.
- **`AGENTS.md` §4** — a rule that a tenant-scoped read runs inside a
  transaction, and that no new `bms.*` table ships without
  `organization_id` and a policy.
- **`docs/roadmap.md`** — flip the `E7.1` and `F4.16` rows when they land.
- **`docs/BACKLOG.md`** — the `E7.1` note still reads *"the tenant boundary (A6)
  is still unanswered"*. Replace it with a pointer to this ADR.
- None of these edits belongs in the `E7.1` feature commit (§9.10).

## Amendment 1 (2026-08-24) — decision 8 needs a third role, and question 5's placement was written against the old order

Raised at the start of `F4.16`, **before any implementation code**. Decision 8
names two roles; neither of them can serve the read that chooses between them.

### The problem is row visibility on `bms.users`, not the `password_hash` column

Decision 5 revokes the column from `bms_tenant`, and the Consequences section
says the login path "needs a role that still holds the column". That understates
it in two ways.

**Login is pre-authentication.** Decision 10 requires every tenant-scoped read to
run inside a transaction that has issued
`SET LOCAL app.current_organization = $1`. At login there is no organization to
set — the caller has supplied an email and a password and nothing else. So
`bms_tenant` cannot read the row **at all**, with or without the column grant,
and no policy formulation fixes it. A policy keyed on the user's own id does not
help either: the lookup is by email and no principal is established yet.

**Pool selection needs the same read.** Decision 12 rules that the API resolves
the pool "from the database user record, not from the JWT claim".
`jwtPayloadSchema` (`packages/shared/src/contracts/auth.ts:20`) carries `sub`,
`email`, `name` and `role` — and no organization. The role claim is not
authority either, for the reason recorded at
`apps/api/src/auth/access-control.service.ts:100`: a token outlives a demotion by
up to `JWT_TTL`, and in OIDC mode `roleFromClaims` falls back to `viewer` when
realm roles are missing. **Every authenticated request therefore needs one
privileged read of `bms.users` before either tenant pool can serve it** — for the
role that picks the pool and the home `organization_id` that goes into
`SET LOCAL`. This is a hot path, not a login-only concession.

### Decision 8 is amended: three roles and three pools, not two

A third role **`bms_auth`** is created in the same migration as the other two. It
owns nothing, and it holds:

- `SELECT (id, email, password_hash, display_name, role, organization_id,
  last_login_at)` on `bms.users`;
- `UPDATE (last_login_at)` on `bms.users`;
- a `bms.users` policy `USING (true)` **for `bms_auth` only** — the table carries
  `FORCE ROW LEVEL SECURITY`, so an explicit permissive policy is required
  rather than an absent one;
- **no grant on any other table** in `bms.*` or `telemetry.*`, and **not** the
  `BYPASSRLS` attribute. `bms_auth` reaches one table because it was granted one
  table, and a test asserts that directly rather than trusting the intent.

`DATABASE_URL` splits **three** ways — `DATABASE_URL_AUTH`,
`DATABASE_URL_TENANT`, `DATABASE_URL_FLEET` — and
`apps/api/src/database/database.module.ts` provides three pools and three Drizzle
clients.

Exactly two call sites use the auth pool: `AuthService.login`, and the
request-scoped identity bootstrap that replaces the front half of
`AccessControlService.resolveDbUser`. Everything after the bootstrap runs on the
tenant or the fleet pool.

Three alternatives were considered and rejected.

- **Reuse `bms_fleet` for the bootstrap.** It runs the pre-authentication path
  with fleet-wide grants on every tenant table and with `BYPASSRLS`, before any
  credential is verified, and it leaves `password_hash` readable on the pool
  ordinary `admin` traffic already uses. It is not a cheaper `bms_auth`; it is a
  different risk posture, and it is the one the Consequences section already
  calls this ADR's highest risk.
- **A `SECURITY DEFINER` function owned by `bms_app`, executable by
  `bms_tenant`.** It avoids the third connection string, but it leaves
  `bms_tenant` able to obtain a password hash by calling the function. That
  narrows the surface decision 5 wanted closed rather than closing it.
- **`SET ROLE` on one shared pool**, reconsidered here and rejected again for the
  reason given at the §10 gate — it puts escalation one statement inside the
  transaction decision 10 already opens.

### Question 5 is amended in placement, not in substance

Question 5 ruled that the `password_hash` revoke lands "inside `E7.1`, in the
same migration that writes the grant matrix". Decision 4 moved the grant matrix
into `F4.16`, and the two statements cannot both hold. **The revoke lands in
`F4.16`, with the grant matrix.**

The revoke does not depend on `bms.users` having `organization_id`; it depends
only on `bms_tenant` existing. `F4.16` can therefore both make it and prove it.
`E7.1` still owns the `organization_id` column on `bms.users` and the policy that
reads it.

### Consequences of this amendment

- **The bootstrap read is on every authenticated request.** It is one query keyed
  on `id` or `email`, returning role and home organization. Caching it would
  re-introduce the demotion drift the F3.8 review corrected, so it is not cached
  in phase 1, and the auth pool is sized for request rate rather than login rate.
- **An unprovisioned principal has no home organization, and therefore no pool.**
  The bootstrap fails closed rather than defaulting. ADR 0021 Amendment 1 already
  rejects an OIDC `admin` claim with no `bms.users` row for `/admin/*`; decision
  12's pool selection must not re-open it by resolving that principal to
  `bms_fleet`. A test covers it.
- **Six services resolve the actor with their own lookup** — `admin/audit`,
  `admin/master-data-audit`, `admin/asset-templates`, `alarms`,
  `alarm-enrichment` and `maintenance` each run
  `select id from bms.users where id = ? or email = ?`. Under the tenant pool
  these succeed while the actor's home organization equals the current one, and
  **fail for an Ion Exchange `admin` operating inside a customer organization**,
  whose home organization differs. That actor runs on `bms_fleet`, which bypasses
  the policy — but the combination is a test case in `F4.16`, not an assumption.
- **The deployment gains a fourth Postgres role** alongside the owner:
  `bms_app`, `bms_tenant`, `bms_fleet`, `bms_auth`. `docker-compose.yml` gains
  one more connection string, for `api` and `api-replica` only. `migrate`,
  `pnpm db:seed`, `apps/sim` and `apps/ingest` are unchanged and stay on
  `bms_app`.
