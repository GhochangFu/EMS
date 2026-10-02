# ADR 0089 — User, access-grant and asset-group administration (`F3.78`)

## Status

Proposed — drafted on 2026-10-02, before any implementation code, as the
`F3.78` row requires. Eleven gate questions were put to the owner one at a
time on 2026-10-02; all were ruled, and each ruling is recorded under *Gate
questions*. It becomes Accepted when the owner approves this written record.

Implements row `F3.78`. Amends the grant matrix of migration `0039` and the
`assertNoRoleCanInsertOrDeleteUsers` invariant that pins it (decision 6), and
narrows one clause of `AGENTS.md` §6 (see *Promotion*). It does not amend
[ADR 0043](./0043-multi-tenant-architecture.md) decision 5: the threat that
decision closes stays closed by a different grant.

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

- **Identity is split across two systems.** Keycloak holds the credential;
  `bms.users` holds the role and the home organization. `resolveDbUser`
  (`apps/api/src/auth/access-control.service.ts:828`) matches a token to a row
  by `id = sub` or by `email`, the row's `role` then wins over the token's
  realm role, and [ADR 0044](./0044-fail-closed-unprovisioned-admin-claim.md)
  refuses an `admin` claim that matches no row. The web app also replaces the
  token's role with the database role from `GET /api/v1/auth/me`.
- **No pool role may insert or delete a `bms.users` row.** Migration `0039`
  revokes both from `bms_tenant` and `bms_fleet` (`0039:106`); `bms_auth` holds
  only `SELECT` and `UPDATE (last_login_at)`. The reason is the second half of
  ADR 0043 decision 5's `password_hash` guard: a pool role that can insert can
  write an attacker-chosen hash. `role-grants.integration.spec.ts:80-103`
  pins it.
- **`bms.users.password_hash` is `NOT NULL`** and means nothing under OIDC.
  Only the seed writes it, with `bcrypt` (cost 10).
- **There is no active flag** on `bms.users` or on any grant table.
- **The realm has one client, the public `bms-web`.** No client can call the
  Keycloak Admin REST API, the realm has no SMTP server, and the realm file is
  imported only when realm `bms` does not exist yet
  (`docs/runbooks/ion-exchange-demo-organization.md:72-76`). Access tokens live
  28800 s (8 h).
- **Two grant tables have no row-level security.** `bms.user_location_access`
  and `bms.user_asset_group_access` carry no policy in any migration, and
  `bms_tenant` holds full DML on both from the blanket grant. Their reads run
  on `bms_fleet`, filtered by the caller's own user id. `bms.user_organization_access`
  has RLS and `FORCE` (`0040`, `0041`).
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
   (decision 4).
3. **Q3 The first password.** Options: a temporary password typed by the
   admin; a Keycloak email link; both. **Ruled: a temporary password**
   (decision 5).
4. **Q4 The `bms.users` insert grant.** Options: a column-level insert that
   leaves out `password_hash`; a `SECURITY DEFINER` function; the full insert.
   **Ruled: an insert without the hash** (decision 6).
5. **Q5 Removing access.** Options: deactivate with an immediate stop;
   Keycloak only; delete. **Ruled: deactivate, stop now** (decision 7).
6. **Q6 The realm role.** Options: write both; the database only. **Ruled:
   write both** (decision 8).
7. **Q7 RLS on the two grant tables.** Options: add it now; app checks only;
   a separate row. **Ruled: add it now** (decision 9).
8. **Q8 Local auth mode.** Options: the user screen is read-only; local users
   too. **Ruled: read-only** (decision 10).
9. **Q9 The order of the two writes.** Options: Keycloak first with an undo;
   the database first; a repair job. **Ruled: Keycloak first, with an undo**
   (decision 3).
10. **Q10 Deleting an asset group.** Options: no delete; delete when unused;
    an archive flag. **Ruled: no delete in `F3.78`** (decision 12).
11. **Q11 Resetting a forgotten password.** Options: in `F3.78`; a later row.
    **Ruled: in `F3.78`** (decision 5).

## Decision

### Users

1. **Routes.** Under `/api/v1/admin/users`, all behind `JwtAuthGuard`:
   - `GET /admin/users` — the users the caller may manage (decision 2), never
     `password_hash`.
   - `POST /admin/users` — `{ email, displayName, role, organizationId,
     temporaryPassword }`.
   - `PATCH /admin/users/:id` — `{ displayName?, role? }`. The email is not
     editable; it is the Keycloak username.
   - `POST /admin/users/:id/deactivate` and `POST /admin/users/:id/reactivate`.
   - `POST /admin/users/:id/temporary-password` — `{ temporaryPassword }`.

   Request and response bodies are Zod schemas in
   `packages/shared/src/contracts/` (ADR 0030). The email is trimmed and
   lower-cased before every write, and the migration adds a unique index on
   `lower(email)` beside the existing case-sensitive one.

2. **Who may manage whom.** `admin` manages every user. `organization_admin`
   manages users whose home organization is one of its own
   `user_organization_access` organizations, and may give any role except
   `admin`. Every other role is refused with 403. In addition:
   - An `admin` user has a `NULL` home organization (ADR 0043 Amendment 4);
     every other role must name one. Only an `admin` creates, promotes or
     edits an `admin`.
   - No caller may change its own role, deactivate itself, or deactivate or
     demote the last active `admin`.
   - An `organization_admin` cannot see or touch a user outside its
     organizations, and the refusal does not name that user (the `F4.64` rule).

3. **Create writes Keycloak first, then the database, and undoes Keycloak on
   failure.** The sequence: create the Keycloak user (username and email = the
   lower-cased email, `enabled`, `emailVerified`), set the temporary password,
   map the realm role; then, in one `withTenant` transaction (or `bms_fleet`
   for an `admin` with no home organization), insert the `bms.users` row with
   **`id` = the Keycloak user id**, so `resolveDbUser` matches on `sub`, and
   write the audit row. If any step after the Keycloak create fails, the API
   deletes the new Keycloak user and returns the original error. If that undo
   also fails, the API logs the Keycloak user id only (no email, no name) and
   the response says that the Keycloak account remains and must be removed by
   hand. An email that already exists in either system is a 409 before any
   write.

### Keycloak

4. **A confidential service-account client, over plain `fetch`.** The realm
   gains a client `bms-api-admin`: confidential, `serviceAccountsEnabled`,
   every browser flow off, and its service account holds only the
   `realm-management` roles needed to create a user, set a password, map a
   realm role and enable or disable a user (`manage-users`, `view-users`; the
   step-3 plan confirms against Keycloak 24 whether reading realm roles also
   needs `view-realm`). No new package: an `IdentityAdminClient` in `apps/api`
   gets a client-credentials token, caches it until shortly before expiry, and
   makes the REST calls. Configuration is a pure `buildConfig(env)`, like
   `notifications.config.ts`:
   - `KEYCLOAK_ADMIN_URL` (for example `http://keycloak:8080`),
     `KEYCLOAK_ADMIN_REALM` (`bms`), `KEYCLOAK_ADMIN_CLIENT_ID`,
     `KEYCLOAK_ADMIN_CLIENT_SECRET`.
   - When any of them is unset, the user write routes answer 503 and say that
     user administration is not configured; the reads still work. The secret
     is never logged and never returned (§9.6).
   - The committed realm file carries a development secret for local use
     only, and a runbook step adds the client to an existing realm, because a
     changed realm file does not reach a realm that already exists.

5. **Passwords are temporary, and the admin sets them.** On create and on
   `temporary-password`, the API sets a Keycloak password credential with
   `temporary: true`, so Keycloak makes the user choose a new password at the
   next sign-in. No email is sent; the admin passes the password on by another
   channel. The temporary password is validated for a minimum length in the
   Zod schema, a Keycloak password-policy refusal is a 400 with Keycloak's
   reason, and the value is never logged, stored, audited or echoed.

### Database

6. **`bms.users` takes an insert that cannot carry a hash.** The migration:
   - drops `NOT NULL` from `bms.users.password_hash`. A `NULL` hash means the
     user has no local password, and the local login path refuses such a row
     before it calls `bcrypt.compare`;
   - grants `bms_tenant` and `bms_fleet` a column-level `INSERT (id,
     organization_id, email, display_name, role, created_at)` on `bms.users`.
     `password_hash` is left out, so no pool role can write it. `DELETE` stays
     revoked;
   - rewrites `assertNoRoleCanInsertOrDeleteUsers` to assert that no pool role
     holds `DELETE` and that no pool role's `INSERT` reaches `password_hash`,
     with a positive control that the column-level `INSERT` exists.

7. **Deactivation is a column, and it stops a live token at once.**
   `bms.users` gains `disabled_at timestamptz` (nullable). Deactivate sets
   `enabled = false` in Keycloak and `disabled_at = now()`; reactivate reverses
   both. `resolveDbUser` refuses a row with `disabled_at` set with 403, and so
   does the local login path, so an access token that is still valid stops
   working on its next request rather than after 8 h. `bms_auth` gains
   `SELECT (disabled_at)`; `bms_tenant` and `bms_fleet` gain `SELECT` and
   `UPDATE` on it. No user row is ever deleted.

8. **The database role is the authority, and Keycloak mirrors it.** On create
   and on each role change, the API sets the user's realm role in Keycloak to
   the one matching `bms.users.role` and removes the other five. A role change
   writes Keycloak first and the database second, with the same undo rule as
   decision 3. `resolveDbUser` is not changed: the row still wins.

9. **The two grant tables get row-level security.** In the same migration,
   `bms.user_location_access` and `bms.user_asset_group_access` get `ENABLE`
   and `FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy that follows
   the parent's organization: the location's for the first, the asset group's
   for the second. `bms.asset_group_members` already uses this pattern
   (`0047:223-238`). Grant reads run on `bms_fleet` and do not change. The seed
   that writes these rows already runs on the superuser connection
   (`demo-users-seed.ts:22-23,93`, under ADR 0045), so `FORCE` does not bind
   it; any other fixture that writes them must set `app.current_organization`.

10. **Local auth mode keeps the user screen read-only.** When
    `resolveAuthMode` returns `local`, the user write routes answer 409 and say
    that user administration needs Keycloak. Grants, groups and members still
    work, because they touch only the database. ADR 0003 already calls local
    auth a development fallback to retire.

### Grants

11. **Routes and rules.** `GET /admin/users/:id/grants`,
    `POST /admin/users/:id/grants` — `{ kind: "organization" | "location" |
    "asset_group", targetId }` — and
    `DELETE /admin/users/:id/grants/:kind/:grantId`. A caller manages grants
    only for a user it may manage (decision 2), and only on targets inside its
    own scope (`canManageOrganization` for an organization, `canManageLocation`
    for a location or an asset group's location). A grant to an organization
    other than the user's home organization is `admin`-only — that is the Ion
    Exchange multi-organization case `bms.user_organization_access` exists for.
    A duplicate grant is a 409 from the existing unique constraints.

### Asset groups and members

12. **Create and edit, add and remove; no delete.**
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

13. **Every write emits one audit event in its own transaction.** Actions:
    `master.user.create`, `master.user.update`, `master.user.deactivate`,
    `master.user.reactivate`, `master.user.temporary_password.set`,
    `master.user_grant.add`, `master.user_grant.remove`,
    `master.asset_group.create` (the existing name), `master.asset_group.update`,
    `master.asset_group_member.add`, `master.asset_group_member.remove`. The
    `organizationId` is the target's organization; an `admin` user's events are
    platform events with a `NULL` organization (ADR 0043 decision 5). Payloads
    carry ids, roles and the changed field names, never a password.

### Web

14. **A "Users and access" master-data area, and an editable groups page.**
    A new `masterDataAreas` entry, visible to `admin` and
    `organization_admin`, holds a Users tab (list, create, edit, deactivate,
    reactivate, set a temporary password) and the user's grants. The existing
    `/admin/asset-groups` page gains create and edit for groups and add and
    remove for members, beside `F3.37`'s role picker. In local auth mode the
    user actions are shown disabled with the reason from decision 10.

### Design questions for the step-3 plan

- Which Keycloak user fields carry `displayName` (`firstName` only, or a
  split), and the exact `realm-management` roles (decision 4).
- What happens to a user's grants when its role changes to one that does not
  read that grant table: keep, warn, or remove.
- How many pull requests, and in which order; the migration and the
  `IdentityAdminClient` are the natural first unit.
- Whether the Keycloak integration spec runs against the compose Keycloak in
  CI or skips there, and how a skip is reported.

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
not touched.

## Consequences

- A new site user no longer needs a developer, and a customer's
  `organization_admin` can manage its own staff.
- `apps/api` now holds a credential that can create Keycloak users in realm
  `bms`. Its blast radius is that realm's users, and the 503 path keeps the
  API booting without it.
- The `password_hash` threat stays closed by a column grant instead of a table
  revoke; the invariant test changes shape, not strength.
- Deactivation is immediate because every request already resolves the
  database user; it costs one column read in a query that already runs.
- RLS on the two grant tables closes a tenant gap that existed before this
  row, and every test fixture that writes those tables on a `FORCE`-bound role
  must now set the organization.
- The user feature is tied to Keycloak. If production moves to another OIDC
  provider, `IdentityAdminClient` is the one class to replace.
- **Follow-ups owed:** a `chore(agents):` sweep for §6 (*Promotion*), §2's
  database-roles and auth rows, and the status line; the runbook step for an
  existing realm (decision 4); the `docs/BACKLOG.md` §5 "User administration"
  entry closes when this record is accepted.
