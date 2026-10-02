# ADR 0089 — User, access-grant and asset-group administration (`F3.78`)

## Status

Proposed — drafted on 2026-10-02, before any implementation code, as the
`F3.78` row requires. Eleven gate questions were put to the owner one at a
time on 2026-10-02 and ruled. A security review of the first draft then found
three critical and four high defects; two of its fixes changed what a ruling
promised, so the owner ruled two more questions (Q12, Q13). Every ruling is
recorded under *Gate questions*, and *Review record* lists what the review
changed. It becomes Accepted when the owner approves this written record.

Implements row `F3.78`. Amends the `bms.users` grant matrix of migration
`0039` and the two invariants that pin it, `assertNoRoleCanInsertOrDeleteUsers`
(decision 7) and `assertAuthCanUpdateOnlyLastLogin` (decision 4), and changes
how `resolveDbUser` matches a token to a row (decision 4). It does not amend
[ADR 0043](./0043-multi-tenant-architecture.md) decision 5: the threat that
decision closes stays closed by a different grant. It narrows one clause of
`AGENTS.md` §6 (see *Promotion*).

The research for this record was read-only at `origin/main` `6008a1d9`.

## Context

**No screen or API path creates a user or an access grant, and no editor
creates an asset group or a member.** Every account and grant comes from
`packages/db/src/demo-users-seed.ts` and from
`infra/keycloak/bms-realm.json` (seven realm users), so a new site user needs
a developer. The two group writes that exist are not editors:
`PATCH /api/v1/admin/asset-group-members/:id` sets a member's role (`F3.37`),
and `F3.73`'s site-layout apply creates one group per asset domain, only on a
site with no group.

What constrains the design:

- **Identity is split across two systems, and they are joined by email.**
  Keycloak holds the credential; `bms.users` holds the role and the home
  organization. `resolveDbUser`
  (`apps/api/src/auth/access-control.service.ts:828-861`) matches
  `or(id = sub, email = jwt.email)` with `limit(1)` and no order, and the
  row's `role` then wins over the token's realm role. Seeded rows have random
  ids, so for every existing user the match is the email.
  `bms.users.oidc_subject` exists (migration `0010`) and nothing writes it.
  [ADR 0044](./0044-fail-closed-unprovisioned-admin-claim.md) refuses an
  `admin` claim that matches no row.
- **Fourteen services repeat the `sub`-or-email lookup themselves** instead of
  calling `resolveDbUser` (for example `reports/report-files.service.ts:395`,
  `reports/report-schedules.service.ts:378`).
- **`JwtAuthGuard` checks only the token.** The two Socket.IO gateways resolve
  the user once, in `handleConnection`
  (`alarms/alarms.gateway.ts:34-45`, `telemetry/telemetry.gateway.ts:38-49`),
  and then stream to the cached scope. `OIDC_AUDIENCE` is unset in Compose, so
  any token the realm issues verifies.
- **No pool role may insert or delete a `bms.users` row.** Migration `0039`
  revokes both from `bms_tenant` and `bms_fleet` (`0039:106`); `bms_auth` holds
  only `SELECT` and `UPDATE (last_login_at)`. The reason is the second half of
  ADR 0043 decision 5's `password_hash` guard: a pool role that can insert can
  write an attacker-chosen hash. `role-grants.integration.spec.ts:80-103`
  pins it. No pool role holds `UPDATE (password_hash)`.
- **`bms.users.password_hash` is `NOT NULL`** and means nothing under OIDC.
  Only the seed writes it, with `bcrypt` (cost 10). `bms.users.role` has no
  `CHECK`, and the "`NULL` organization only for `admin`" rule was checked once,
  by the `0046` backfill.
- **There is no active flag** on `bms.users` or on any grant table.
- **The realm has one client, the public `bms-web`**, no password policy, no
  brute-force detection and no SMTP server. Compose publishes Keycloak on
  `8080` with the master admin `admin`/`admin`, and imports the realm file on
  the first boot of any host; a changed realm file does not reach a realm that
  already exists (`docs/runbooks/ion-exchange-demo-organization.md:72-76`).
  Access tokens live 28800 s (8 h).
- **Two grant tables have no row-level security.**
  `bms.user_location_access` and `bms.user_asset_group_access` carry no policy
  in any migration, and `bms_tenant` holds full DML on both from the blanket
  grant. `bms.user_organization_access` has RLS and `FORCE` (`0040`, `0041`).
- **An `organization_admin` writes in every organization it is granted,** not
  only its home organization: `writableOrganizationIds` returns all its direct
  `user_organization_access` rows (`access-control.service.ts:163-165`).
- **Master-data writes already have a shape.** `requireMasterDataUser` admits
  `admin`, `organization_admin` and `location_admin`; `canManageOrganization`
  and `canManageLocation` bound the write; the write runs in `withTenant` with
  the audit row in the same transaction (`MasterDataAuditService.write`).
- **The API has no outbound HTTP package.** Global `fetch` serves the JWKS
  read and the webhook transport.

## Gate questions

Ruled by the owner on 2026-10-02, one at a time:

1. **Q1 Who manages users and grants.** Options: admin and organization
   admin; admin only; the full ladder. **Ruled: admin and organization
   admin** (decision 2).
2. **Q2 How the API reaches Keycloak.** Options: a service-account client
   over plain `fetch`; the same with `@keycloak/keycloak-admin-client`; the
   master-realm admin login. **Ruled: a service-account client over `fetch`**
   (decision 5).
3. **Q3 The first password.** Options: a temporary password typed by the
   admin; a Keycloak email link; both. **Ruled: a temporary password**
   (decision 6).
4. **Q4 The `bms.users` insert grant.** Options: a column-level insert that
   leaves out `password_hash`; a `SECURITY DEFINER` function; the full insert.
   **Ruled: an insert without the hash** (decision 7).
5. **Q5 Removing access.** Options: deactivate with an immediate stop;
   Keycloak only; delete. **Ruled: deactivate, stop now** (decision 8).
6. **Q6 The realm role.** Options: write both; the database only. **Ruled:
   write both** (decision 9).
7. **Q7 RLS on the two grant tables.** Options: add it now; app checks only;
   a separate row. **Ruled: add it now** (decision 10).
8. **Q8 Local auth mode.** Options: the user screen is read-only; local users
   too. **Ruled: read-only** (decision 11).
9. **Q9 The order of the two writes.** Options: Keycloak first with an undo;
   the database first; a repair job. **Ruled: Keycloak first, with an undo**
   (decision 3). The draft also set `bms.users.id` to the Keycloak id; Q13
   replaced that with `oidc_subject`.
10. **Q10 Deleting an asset group.** Options: no delete; delete when unused;
    an archive flag. **Ruled: no delete in `F3.78`** (decision 13).
11. **Q11 Resetting a forgotten password.** Options: in `F3.78`; a later row.
    **Ruled: in `F3.78`** (decision 6).
12. **Q12 Open sockets after a deactivation.** Asked after the review showed
    that the gateways check the user only on connect. Options: close the
    sockets too; REST at once and sockets at reconnect. **Ruled: close the
    sockets too** (decision 8).
13. **Q13 How a row links to its Keycloak account.** Asked after the review
    showed that the email join lets a failed create, or a changed Keycloak
    email, inherit another row's role. Options: link by the Keycloak id in
    `oidc_subject`; keep email matching. **Ruled: link by the Keycloak id**
    (decision 4).

## Decision

### Users

1. **Routes.** Under `/api/v1/admin/users`, all behind `JwtAuthGuard`:
   - `GET /admin/users` — the users the caller may manage (decision 2), never
     `password_hash`.
   - `POST /admin/users` — `{ email, displayName, role, organizationId,
     temporaryPassword }`.
   - `PATCH /admin/users/:id` — `{ displayName?, role?, organizationId? }`.
     `organizationId` is required, and only accepted, when the role crosses
     the `admin` boundary (to `admin` it must be `null`; from `admin` it must
     name an organization). The email is not editable; it is the Keycloak
     username.
   - `POST /admin/users/:id/deactivate` and `POST /admin/users/:id/reactivate`.
   - `POST /admin/users/:id/temporary-password` — `{ temporaryPassword }`.

   Request and response bodies are Zod schemas in
   `packages/shared/src/contracts/` (ADR 0030). The email is trimmed and
   lower-cased before every write.

2. **Who may manage whom.** `admin` manages every user. Every role other than
   `admin` and `organization_admin` is refused with 403. An
   `organization_admin` may manage a target only when **the target's whole
   reach is inside the caller's own organizations**: the target's home
   organization, its `user_organization_access` organizations, and the
   organizations of its location and asset-group grants. The service checks
   this on every write — edit, role change, deactivate, reactivate, temporary
   password, grant add and grant remove — not only on create. In addition:
   - An `organization_admin` may give any role except `admin`. **Every action
     on an `admin` target is `admin`-only**, deactivate and temporary password
     included.
   - An `admin` row has a `NULL` home organization (ADR 0043 Amendment 4) and
     every other row names one; the migration adds
     `CHECK ((role = 'admin') = (organization_id IS NULL))`.
   - No caller may change its own role or deactivate itself. A demotion or
     deactivation of an `admin` counts the other active admins and writes in
     one transaction that takes `SELECT … FOR UPDATE` on the active `admin`
     rows, so two admins cannot demote each other at once and leave none.
   - An `organization_admin` cannot see a user outside its scope, and a
     refusal does not name that user (the `F4.64` rule). The duplicate-email
     409 on create does tell any caller that an email is taken somewhere; this
     is accepted, as the owner accepted the same oracle at `F4.141`.

3. **Create writes Keycloak first, then the database, and the Keycloak
   account stays disabled until the row exists.** The sequence:
   1. A duplicate check on a pool that sees every row (`bms_fleet`): an email
      already in `bms.users` (compared lower-case) is a 409 before any write.
   2. Create the Keycloak user with username and email = the lower-cased
      email, `emailVerified: true`, **`enabled: false`**. A Keycloak 409 (the
      email exists in the realm) stops here with a 409 and no undo.
   3. Read the new id from that response's `Location` header, set the
      temporary password and map the realm role.
   4. In one transaction — `withTenant` of the target's home organization, or
      `bms_fleet` only when both the caller and the target are `admin` — insert
      the `bms.users` row with `oidc_subject` = the Keycloak id, and write the
      audit row.
   5. After the commit, set the Keycloak user `enabled: true`.

   If step 3 or 4 fails, the API deletes **only the id parsed in step 3** —
   never a user looked up by username or email — and returns the original
   error. If that undo also fails, the account is still disabled, the API logs
   the Keycloak id only (no email, no name), and the response says that a
   disabled Keycloak account remains. If step 5 fails, the row exists and the
   response says the account must be enabled with *reactivate*. Reactivate is
   idempotent: it accepts a row whose `disabled_at` is already `NULL` and still
   sets the Keycloak user `enabled: true`.

4. **A row is joined to its Keycloak account by `oidc_subject`.**
   `resolveDbUser`, and the fourteen services that repeat its lookup (which
   move onto one shared resolver), match in this order:
   - Under OIDC: `oidc_subject = sub`. If no row has that subject, and the
     token's raw `email` claim is present with `email_verified === true`, the
     row with that email and a `NULL` subject is linked once and the match
     succeeds. The link is one statement on `bms_auth`:
     `UPDATE bms.users SET oidc_subject = $sub WHERE lower(email) = $email
     AND oidc_subject IS NULL`, and it must change exactly one row. It never
     uses the guard's fallback email (`preferred_username`, then `sub`,
     `jwt-auth.guard.ts:174`); `KeycloakClaims` and `JwtPayload` gain
     `email_verified` for this.
   - Under local auth: `id = sub`, as today.

   The database holds the link fixed, not only the application:
   - `bms_auth` gains `UPDATE (oidc_subject)` — so `assertAuthCanUpdateOnlyLastLogin`
     becomes "`last_login_at` and `oidc_subject` only" — and `bms_tenant` and
     `bms_fleet` **lose** the `UPDATE (oidc_subject)` they hold today
     (`0039:86-87,96-97`), so the link is written only by the sign-in path and
     the create path (decision 7's `INSERT`).
   - A trigger on `bms.users` refuses any update that changes a non-`NULL`
     `oidc_subject`, unless the session is a superuser. The existing
     `auth_bootstrap_write` policy is `USING (true)`, so without the trigger
     `bms_auth` could re-point the `admin` row's subject. A re-link is a
     runbook operation run as the superuser.
   - `bms.users.oidc_subject` gets a unique index.

   The user screen refuses to change a row with no `oidc_subject` yet and says
   that the user must sign in once first; the seven seeded users link on their
   next sign-in. On a host whose realm was built by hand, a user whose
   Keycloak email is not verified cannot link, and an unlinked `admin` is then
   refused by ADR 0044. So the provisioning step (decision 5) lists every realm
   user whose `bms.users` row is unlinked and whose `emailVerified` is false,
   and the runbook gives a one-shot superuser link command for those users.
   The step-3 plan also proves that a Keycloak user cannot edit its own email
   in realm `bms` (or sets the user profile so that it cannot).

### Keycloak

5. **A confidential service-account client, over plain `fetch`, with no
   secret in the repository.**
   - The realm gains a client `bms-api-admin`: confidential,
     `serviceAccountsEnabled`, every browser flow off. Its service account
     holds only the `realm-management` roles needed to create, enable, disable
     and delete a user, set a password, map a realm role and end a user's
     sessions (`manage-users`, `view-users`; the step-3 plan confirms against
     Keycloak 24 whether reading realm roles also needs `view-realm`).
   - **The realm file carries no secret for it.** Each host's secret comes from
     that host's environment: a one-shot provisioning step (a Compose job and a
     runbook section, for new and existing realms alike) sets the client secret
     from `KEYCLOAK_ADMIN_CLIENT_SECRET`. A secret in the repository would be
     live on the first boot of every new host, with Keycloak published on
     `8080`.
   - **The client secret is equivalent to global admin**, because
     `manage-users` can set any realm user's password, the `admin`'s included.
     It is never logged, never returned, never in an error (§9.6).
   - An `IdentityAdminClient` in `apps/api` gets a client-credentials token,
     caches it until shortly before expiry, and makes the REST calls. It never
     logs a request body or a Keycloak response body, and maps Keycloak errors
     to a fixed set of reasons rather than echoing `error_description`.
     Configuration is a pure `buildConfig(env)`, like `notifications.config.ts`:
     `KEYCLOAK_ADMIN_URL` (`https://`, except the Compose service name
     `http://keycloak:8080`), `KEYCLOAK_ADMIN_REALM`, `KEYCLOAK_ADMIN_CLIENT_ID`,
     `KEYCLOAK_ADMIN_CLIENT_SECRET`. When any is unset, the user write routes
     answer 503 and say that user administration is not configured; the reads
     still work.
   - **`JwtAuthGuard` accepts only tokens issued to `bms-web`** (an `azp`
     check, or `OIDC_AUDIENCE` made required), so the `bms-api-admin`
     service-account token cannot call the API as a `viewer`.

6. **Passwords are temporary, and the admin sets them.** On create and on
   `temporary-password`, the API sets a Keycloak password credential with
   `temporary: true`, so Keycloak makes the user choose a new password at the
   next sign-in. `temporary-password` also ends the user's Keycloak sessions.
   No email is sent; the admin passes the password on by another channel. The
   realm gains a password policy (a minimum length, at least 12) and
   brute-force detection, in the realm file and in the provisioning step; the
   Zod schema applies the same minimum. The value is never logged, stored,
   audited or echoed.

### Database

7. **`bms.users` takes an insert that cannot carry a hash.** The migration:
   - drops `NOT NULL` from `bms.users.password_hash`. A `NULL` hash means the
     user has no local password; the local login path refuses such a row with
     401 before it calls `bcrypt.compare`, which throws on `NULL`;
   - grants `bms_tenant` and `bms_fleet` a column-level `INSERT (id,
     organization_id, email, display_name, role, oidc_subject, created_at)` on
     `bms.users`. `password_hash` is left out, so no pool role can write it.
     `DELETE` stays revoked;
   - revokes `UPDATE (email, oidc_subject)` from `bms_tenant` and `bms_fleet`.
     The email is not editable (decision 1), no code updates it today (the one
     runtime `bms.users` update is `auth.service.ts:62`, `last_login_at`), and
     the subject is decision 4's identity key;
   - adds the `CHECK` of decision 2, a unique index on `oidc_subject`, and a
     unique index on `lower(email)`, after a `DO` block that aborts with a
     clear message if existing rows collide on `lower(email)`. The `CHECK`
     breaks four integration fixtures that insert a non-`admin` user with a
     `NULL` organization as the superuser, and the build changes them:
     `dashboard-builder/dashboards.service.rls.integration.test.ts:546,669,753`
     and the "null-org user probe" in
     `notifications/channels.rls.integration.spec.ts:283`, whose subject the
     `CHECK` makes impossible;
   - rewrites `assertNoRoleCanInsertOrDeleteUsers` to assert, from
     `table_privileges` and `column_privileges`, that no pool role holds
     `DELETE` or a table-level `INSERT` and that no pool role's `INSERT` or
     `UPDATE` reaches `password_hash`, with a positive control that the
     column-level `INSERT` exists.

   This keeps the hash threat closed, and with the revoke above no pool role
   can rewrite either half of the token-to-row join. A pool role can still
   `UPDATE (role)`, as it can today; the user routes are the only code that
   does, under decision 2.

8. **Deactivation stops every surface at once.** `bms.users` gains
   `disabled_at timestamptz` (nullable). Deactivate runs in this order, so a
   failure always leaves the user blocked:
   1. In one transaction: set `disabled_at = now()`, write the audit row, and
      `NOTIFY` with the `bms.users.id`.
   2. Then disable the Keycloak user and end its Keycloak sessions. If this
      fails, the user is already refused (below), and the response says the
      Keycloak step must be retried with *deactivate*, which is idempotent.

   Reactivate clears `disabled_at` and enables the Keycloak user. Then:
   - **`JwtAuthGuard.verifyToken` refuses a disabled user** with 401, after it
     verifies the token. Every REST route and every socket handshake goes
     through it, so this covers the services that do not call
     `resolveDbUser`. The local login path refuses a disabled row too. The
     guard reads the row by `oidc_subject = sub`; a token with no linked row
     passes this check, which is safe only because decision 4 forbids changing
     an unlinked row, so an unlinked row is never disabled. `JwtAuthGuard`
     gains a database pool (`bms_auth`) in its constructor; only booting the
     app proves that DI change.
   - **Open sockets close.** Each gateway stores the resolved `bms.users.id`
     on the socket at the handshake (today it stores only `assetIds`). Each API
     process (`api`, `api-replica`) listens for the `NOTIFY` and disconnects
     the sockets with that id in both gateways.
   - **A deactivated user's report schedules pause.** A schedule whose owner is
     disabled is skipped with a recorded reason until the owner is reactivated
     or the schedule is given to another user.
   - `bms_auth` gains `SELECT (disabled_at)`; `bms_tenant` and `bms_fleet` gain
     `SELECT` and `UPDATE` on it. No user row is ever deleted.

9. **The database role is the authority, and Keycloak mirrors it.** On create
   and on each role change, the API sets the user's realm role in Keycloak to
   the one matching `bms.users.role` and removes the other five. A role change
   writes Keycloak first and the database second, and undoes the Keycloak
   mapping if the database write fails.

10. **The two grant tables get row-level security.** In the same migration,
    `bms.user_location_access` and `bms.user_asset_group_access` get `ENABLE`
    and `FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy that follows
    the parent's organization: the location's for the first, the asset group's
    for the second. `bms.asset_group_members` already uses this pattern
    (`0047:223-238`). A grant write runs in `withTenant` of the **target**
    location's or asset group's organization, not the user's home
    organization.
    - Grant reads run on `bms_fleet`, which has `BYPASSRLS`, so they do not
      change.
    - `FORCE` binds `bms_owner`. The demo-users seed runs on the superuser
      connection (`demo-users-seed.ts:22-23,93`), so it is not bound;
      `cleanupLegacyPheRtuLocations` (`hierarchy-seed.ts:456`) runs on
      `bms_owner` under `withOrganization(PHEWB)` and works while every legacy
      slug stays in PHEWB. Any other fixture that writes these tables on a
      `FORCE`-bound role must set `app.current_organization`.

11. **Local auth mode keeps the user screen read-only.** When
    `resolveAuthMode` returns `local`, the user write routes answer 409 and say
    that user administration needs Keycloak. Grants, groups and members still
    work, because they touch only the database. ADR 0003 already calls local
    auth a development fallback to retire.

### Grants

12. **Routes and rules.** `GET /admin/users/:id/grants`,
    `POST /admin/users/:id/grants` — `{ kind: "organization" | "location" |
    "asset_group", targetId }` — and
    `DELETE /admin/users/:id/grants/:kind/:grantId`. A caller manages grants
    only for a user it may manage (decision 2), only on targets inside its own
    scope (`canManageOrganization` for an organization, `canManageLocation`
    for a location or an asset group's location), and a new grant must not
    take the target's reach outside the caller's organizations. A grant to an
    organization other than the user's home organization is `admin`-only —
    that is the Ion Exchange multi-organization case
    `bms.user_organization_access` exists for. A duplicate grant is a 409 from
    the existing unique constraints.

### Asset groups and members

13. **Create and edit, add and remove; no delete.**
    - `POST /admin/asset-groups` — `{ locationId, code, name, description?,
      domain? }`; `PATCH /admin/asset-groups/:id` — `{ name?, description?,
      domain? }`. The code is fixed after create, because the site-layout
      planner matches a template tab to a group by code
      (`site-layout-planner.ts:159`) and the seed keys groups by code.
    - `POST /admin/asset-groups/:id/members` — `{ assetId, role? }`;
      `DELETE /admin/asset-group-members/:id`.
    - The gate is the existing one: `requireMasterDataUser`, then
      `canManageLocation` on the group's location. A member must be an active
      asset at the group's location and organization; a duplicate is a 409 from
      `asset_group_members_group_asset_idx`.
    - No route deletes a group. Dashboard tabs, mimic widgets and
      `user_asset_group_access` rows refer to groups, and a later row can add a
      guarded delete when someone needs it.

### Audit

14. **Every write emits one audit event in its own transaction.** Actions:
    `master.user.create`, `master.user.update`, `master.user.deactivate`,
    `master.user.reactivate`, `master.user.temporary_password.set`,
    `master.user_grant.add`, `master.user_grant.remove`,
    `master.asset_group.create` (the existing name), `master.asset_group.update`,
    `master.asset_group_member.add`, `master.asset_group_member.remove`. The
    `organizationId` is the target's organization; an `admin` user's events are
    platform events with a `NULL` organization (ADR 0043 decision 5). Payloads
    carry ids, roles and the changed field names, never a password.

### Web

15. **A "Users and access" master-data area, and an editable groups page.**
    A new `masterDataAreas` entry, visible to `admin` and
    `organization_admin`, holds a Users tab (list, create, edit, deactivate,
    reactivate, set a temporary password) and the user's grants. The existing
    `/admin/asset-groups` page gains create and edit for groups and add and
    remove for members, beside `F3.37`'s role picker. In local auth mode the
    user actions are shown disabled with the reason from decision 11, and a
    user with no `oidc_subject` shows why it cannot be changed yet.

### Design questions for the step-3 plan

- Which Keycloak user fields carry `displayName` (`firstName` only, or a
  split), and the exact `realm-management` roles (decision 5).
- What happens to a user's grants when its role changes to one that does not
  read that grant table: keep, warn, or remove.
- Whether a deactivated user owns rows other than report schedules that
  should pause too (decision 8).
- The per-request cost of decision 8's `disabled_at` read in
  `JwtAuthGuard`, and whether the fourteen repeated lookups can reuse it.
- How many pull requests, and in which order; the migration, the shared
  resolver and the `IdentityAdminClient` are the natural first unit.
- Whether the Keycloak integration spec runs against the Compose Keycloak in
  CI or skips there, and how a skip is reported.

## Review record

A security review of the first draft (commit `9135d4fb`) changed:

- **C1** — an `organization_admin` could set a temporary password on, or
  promote, a home-organization user that an `admin` had also granted another
  organization, and so reach that organization. Fixed by the *whole reach*
  rule (decisions 2 and 12).
- **C2** — a create whose database insert failed left an enabled Keycloak
  account whose email could match another row, including the seeded
  `admin`, through the email join. Fixed by the disabled-until-commit
  sequence, a duplicate check on `bms_fleet`, an undo by parsed id only
  (decision 3), and the subject link (decision 4, Q13).
- **C3** — a client secret in the committed realm file would be live on every
  new host. Fixed by per-host provisioning, and the secret is stated to be
  admin-equivalent (decision 5).
- **H1** — "stops at once" was false for open sockets and for services that do
  not call `resolveDbUser`. Fixed in `JwtAuthGuard` plus a `NOTIFY` (decision
  8, Q12).
- **H2** — the role rule had no constraint and the edit body could not express
  it. Fixed by the `CHECK`, the `organizationId` field and admin-only actions
  on admins (decisions 1, 2 and 7).
- **H3** and **H4** — existing rows could not be mapped to Keycloak safely, and
  a self-edited Keycloak email could inherit a row. Fixed by the subject link
  and the email-edit proof (decision 4).
- Medium and lower findings: the grant-assertion shape and the `bcrypt` `NULL`
  case (decision 7), the `BYPASSRLS` reason and the `bms_owner` writer
  (decision 10), the password policy and the error mapping (decisions 5 and
  6), the last-admin race (decision 2), the service-account token as a viewer
  and the `https` rule (decision 5), the `lower(email)` collision check
  (decision 7), sessions ended on a password reset (decision 6).

A second pass over the revision (commit `7215603c`) confirmed those fixes and
found eight defects in the new subject link and deactivation path:

- **N1** (high) — the `bms_auth` link write ran under a `USING (true)` policy,
  so "link only a `NULL` subject" was an application rule. Fixed by the
  single guarded statement and a trigger (decision 4).
- **N2** (high) — `bms_tenant` and `bms_fleet` already hold
  `UPDATE (oidc_subject)`, so the new key was as writable as the email. Fixed
  by revoking `UPDATE (email, oidc_subject)` (decisions 4 and 7).
- **N3** — the API did not carry `email_verified`, and its email falls back to
  `preferred_username`. Fixed: the raw claim only (decision 4).
- **N4** — the `CHECK` breaks four fixtures; they are named (decision 7).
- **N5** — an `admin` with an unverified email on a hand-built realm could
  never link. Fixed by the provisioning check and a link command (decision 4).
- **N6**, **N7**, **N8** — the socket id, the deactivate order, the unlinked-row
  dependency, the guard's new pool, and an idempotent reactivate (decisions 3
  and 8). Report schedules of a deactivated user are now decided (decision 8).

## Promotion

`AGENTS.md` §6 says that Keycloak is limited to local/pilot OIDC
authentication and that "MFA, SSO federation, and advanced identity
governance remain out of scope". This record promotes one narrow thing out of
that sentence: **account administration through the Keycloak Admin REST API**
— create, edit, deactivate, a temporary password, and the realm-role mirror.
MFA (`F4.13`), SSO federation, self-service sign-up, and identity governance
(access reviews, approval workflows, SCIM) stay out of scope.

## Dependencies

None. The Keycloak client uses global `fetch`; `bcrypt` and `nodemailer` are
not touched. The `NOTIFY` listener uses the existing `pg` driver.

## Consequences

- A new site user no longer needs a developer, and a customer's
  `organization_admin` can manage its own staff — but not a user an `admin`
  has also given access to another organization.
- `apps/api` now holds a credential equivalent to global admin. It never
  enters the repository, and the 503 path keeps the API booting without it.
- The token-to-row join moves from email to the Keycloak subject, which closes
  the email-inheritance class for every user, not only new ones. Each existing
  user links on its next sign-in, and until then the user screen cannot change
  it.
- The `password_hash` threat stays closed by a column grant instead of a table
  revoke, and the invariant test checks columns as well as tables.
- Deactivation now costs one indexed read per request in `JwtAuthGuard` and a
  `NOTIFY` listener in each API process.
- RLS on the two grant tables closes a tenant gap that existed before this
  row.
- The user feature is tied to Keycloak. If production moves to another OIDC
  provider, `IdentityAdminClient` and the subject link are what change.
- **Follow-ups owed:** a `chore(agents):` sweep for §6 (*Promotion*), §2's
  database-roles and auth rows, and the status line; the provisioning runbook
  (decision 5); the `docs/BACKLOG.md` §5 "User administration" entry closes
  when this record is accepted.
