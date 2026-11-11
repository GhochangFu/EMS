# ADR 0128 — A new organization admin gets its home organization's grant (`F4.340`)

## Status

**Accepted — 2026-11-11** (owner, in chat: "record the rulings and accept
ADR 0128"; proposed the same day). Drafted by an agent for backlog row
`F4.340` (P1 defect). The owner ruled the six questions one at a time on
2026-11-11 and **chose the recommended option on every one**, so every line
marked *(recommended)* below is now a ruling, and each question under *Open
questions* carries its ruling. The step-3 plan is
[`docs/plans/f4.340-org-admin-default-scope.md`](../plans/f4.340-org-admin-default-scope.md).
Accepting this record does not approve the plan: no code is written before
the owner says "yes" to the plan.

Amends [ADR 0089](./0089-user-access-and-asset-group-administration.md)
decision 3 (what the create transaction writes), decision 14 (one audit event
per write) and answers one of its *Design questions for the step-3 plan* for
the promotion case. It does **not** change how scope is resolved
([ADR 0043](./0043-multi-tenant-architecture.md), ADR 0089 decision 12): an
`organization_admin`'s scope stays exactly its `bms.user_organization_access`
rows.

## Context

On 2026-11-08 the owner created `bcpl-admin@bms.local` on the demo (Users &
Access → Create user, role Organization admin, organization BCPL). Its first
sign-in showed "No sites in your access scope"
(`apps/web/src/pages/control-room/organizations-page.tsx:82`). It worked only
after the owner added an Organization grant for BCPL in the Grants drawer.

Read from `main` at `9c8c6f1`:

- `UsersService.create` (`apps/api/src/admin/users/users.service.ts:389-404`)
  writes the `bms.users` row (with `organization_id`) and one
  `master.user.create` audit row in `withTenant(organizationId)`. It writes no
  grant. That is exactly ADR 0089 decision 3 step 4 and decision 14.
- An `organization_admin`'s scope comes only from `user_organization_access`:
  `directOrganizationIds` (`apps/api/src/auth/access-scope-sources.ts:59-66`)
  feeds `writableOrganizationIds` (`access-control.service.ts:216-217`),
  `writableLocationIds` (`:245`), `isOrganizationLevelAdmin` (`:307`), the
  read scope (`access-scope-sources.ts:152`, via
  `readScopeSourcesForRole("organization_admin") === ["organization"]`,
  `access-scope.ts:92-93`) and the report-file read scope
  (`report-file-read-scope.ts:64`). `bms.users.organization_id` is read by none
  of them.
- So a fresh `organization_admin` has an empty read scope, an empty write
  scope and cannot manage users (`requireManager` →
  `writableOrganizationIds` = `[]`, `users.service.ts:691`).
- The same gap opens when `PATCH /admin/users/:id` promotes a user to
  `organization_admin` (`users.service.ts:473-492`) and it has no
  organization grant.
- The F3.78 plan (D2, owner ruling 2026-10-03) keeps grants on a role change
  and keeps a removed grant removed on re-seed: **"a grant an admin removed
  stays removed."**

## Decision

1. **Create writes the home-organization grant** *(recommended, Q1)*. When
   `POST /admin/users` creates an `organization_admin`, the same transaction
   that inserts the `bms.users` row also inserts
   `bms.user_organization_access (user_id, organization_id = home)`. The
   transaction already runs in `withTenant(home)`, so the `0040` tenant policy
   on that table admits the insert, and no grant or policy changes. The
   caller's checks are unchanged and sufficient: the home organization is
   already checked against the caller's writable organizations
   (`users.service.ts:344-349`), so the grant cannot widen anyone.
   The alternative — treating `users.organization_id` as an implicit scope in
   `directOrganizationIds` — is **rejected**: it changes six readers, makes a
   revoked home grant ineffective (breaking the "removed stays removed"
   ruling and ADR 0089 decision 12's model), and moves the authority for scope
   off the grant tables.
2. **Promotion writes it too** *(recommended, Q2)*. A `PATCH` that changes the
   role to `organization_admin` inserts the same row in the same transaction
   when it does not exist (`ON CONFLICT DO NOTHING` on
   `user_organization_access_user_org_unique`). A demotion keeps the row (F3.78
   D2 unchanged).
3. **Two audit rows, one transaction** *(recommended, Q3)*. The create (or
   update) writes its `master.user.create` / `master.user.update` row and a
   `master.user_grant.add` row with `payload.reason = "home_organization"`, so
   the grant history shows the grant like any other. This amends ADR 0089
   decision 14's "one audit event per write" for these two routes only.
4. **Other scoped roles are warned, not granted** *(recommended, Q4)*.
   `location_admin`, `asset_group_admin`, `operator` and `viewer` get no
   automatic grant: which location or group is a choice the creator must
   make. The wizard's Review step says the user will see nothing until a grant
   is added, and the Users list flags an active user whose role needs grants
   and who has no grant in effect.
5. **Existing users: a one-off, owner-run backfill, not a migration**
   *(recommended, Q5)*. A runbook section lists active `organization_admin`
   rows with no `user_organization_access` row, and the owner decides per user
   on each host. A migration would run on every host and would re-add a grant
   an admin deliberately removed, against the F3.78 ruling.

## Open questions — all ruled as recommended (owner, 2026-11-11)

1. **Q1 — Where the fix lives.** Options: (a) the server writes the
   home-organization grant in the create transaction; (b) the home
   organization is an implicit scope in `directOrganizationIds`; (c) the
   wizard sends a second `POST …/grants` after create. **Recommended: (a).** **Ruled: (a)** — the server adds the grant.
   (b) is rejected above; (c) is two requests, so a failed second call leaves
   the same defect, and the copilot's `user.create` path would not get it.
2. **Q2 — Promotion.** Should a role change to `organization_admin` also add
   the home grant? **Recommended: yes**, same transaction, idempotent.
   **Ruled: yes.**
3. **Q3 — Audit shape.** Options: (a) two rows (`master.user.create` +
   `master.user_grant.add`); (b) one row with the grant in its payload.
   **Recommended: (a)** — anyone reading grant history finds it where every
   other grant is. **Ruled: (a)**, two audit rows.
4. **Q4 — Other roles.** Warn only (Review line + Users-list flag), or also
   auto-grant something? **Recommended: warn only.** **Ruled: warn only.**
5. **Q5 — Existing org admins on AWS.** Options: (a) a one-off runbook SQL
   the owner runs after reading the listing; (b) a data migration that grants
   every `organization_admin` without one. **Recommended: (a).** On the demo
   the one known case (`bcpl-admin`) was already fixed by hand, so the listing
   is expected to be empty. **Ruled: (a)**, runbook listing + Grants screen.
6. **Q6 — The Users-list flag needs data.** Add `hasEffectiveGrant: boolean`
   to `adminUserDtoSchema` (additive, ADR 0030), computed on `bms_fleet` in
   the list query? **Recommended: yes**; the alternative is one grants request
   per row from the page. **Ruled: yes**, the field on the list.

## Consequences

- A new or promoted organization admin signs in and sees its organization
  with no Grants step; the grant is visible and revocable like any other.
- Revoking the home grant still removes the scope — the grant tables stay the
  one authority for scope.
- `master.user.create` is no longer the only audit row a create can write.
- No schema change, no new dependency, no new grant or policy.

## Dependencies

None.
