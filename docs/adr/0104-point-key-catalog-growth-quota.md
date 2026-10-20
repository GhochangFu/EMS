# ADR 0104 — A growth quota on the fleet-wide point-key catalog (`F4.111`)

## Status

**Accepted — 2026-10-20** (owner, in chat). Four gate questions were put to the owner one at a
time, in chat, each with options and a recommendation. The owner accepted the
recommendation on questions 1 to 3 and changed question 4 (see *Gate
questions*). Drafted before any implementation code. Code citations are to
`main` at `5ae4051d`.

This record **amends ADR 0051** decision 3 (the point-key catalog is fleet-wide
master data, readable by every master-data user): the catalog stays
fleet-wide, but an organization may no longer grow it without a bound.

## Context

Migration `0057` (`F3.39`, ADR 0051) made `bms.point_keys` one fleet-wide
catalog with no `organization_id`, and `0059` stopped a tenant from editing its
rows. A tenant can still **add** rows: `OnboardingCommitService.commitWith`
(`apps/api/src/admin/onboarding/onboarding-commit.service.ts:389-433`) inserts
every draft point key whose code the catalog does not hold, at the
`organization_admin` role, with no limit per commit and no limit per
organization. `F4.103` caps a draft at `MAX_ONBOARDING_POINT_KEYS = 500`
(`packages/shared/src/contracts/onboarding.ts:503`), so one commit can add 500
rows, and nothing bounds how many commits an organization makes. Every row is
permanent and every other organization reads it.

`F4.105` and `F3.26` bounded what one turn **shows** of the catalog
(`echoedItems`, 25 items; `TOOL_LIST_MAX_ITEMS` for `list_point_keys`). They
did not bound what the table **holds**, and both docblocks say so
(`onboarding-catalog.service.ts:95-101`, `onboarding-chat.service.ts:170-190`).
`F3.24b` (ADR 0103) makes the growth term more likely: discovery fills a draft
with keys read from a broker rather than typed by an operator.

Measured on a clean seeded database (as `bms_fleet`, at `F4.105`): 613 keys,
18,006 characters of code plus name.

Rider: the rule-based chat says "Your organization already has point keys"
(`onboarding-chat.service.ts:194`). That has been false since `0057`; the keys
are the fleet's.

## Gate questions

1. **Which limit?** Options: an organization quota and a commit cap; a commit
   cap only; an organization quota only; global-admin approval of new keys.
   **Ruled: an organization quota and a commit cap** (recommended). A commit
   cap alone leaves many small commits unbounded; a quota alone lets one commit
   spend it all; approval changes the onboarding flow and is far larger than
   the row.
2. **The values.** **Ruled: 200 new keys per commit, 1,000 keys per
   organization** (recommended), as constants in code, pinned by a spec. Not
   environment-configured.
3. **Over a limit.** **Ruled: refuse early and at commit** (recommended). The
   commit refuses the whole draft; the draft write paths refuse early so the
   user learns it before Commit. Nothing is written in part, and nothing is
   dropped silently (the `F4.103` / `F4.135` shape).
4. **A global admin.** Recommended: no exemption. **Ruled: a global admin is
   exempt** — a commit by a user whose `bms.users` role is `admin` skips both
   limits.

## Decision

1. **A new nullable column** `bms.point_keys.created_by_organization_id uuid
   REFERENCES bms.organizations(id)`, added by one forward-only migration with
   an index on it. Existing rows stay `NULL`. The seed, the Point keys admin
   page and any other writer leave it `NULL`. Only the onboarding commit sets
   it, to the session's `organization_id`. The column records who **added** a
   row; it is not a scope, it adds no RLS policy, and ADR 0051 decision 3 still
   holds for reads.
2. **Two constants** in `packages/shared/src/contracts/onboarding.ts`:
   `MAX_NEW_POINT_KEYS_PER_COMMIT = 200` and
   `MAX_POINT_KEYS_PER_ORGANIZATION = 1000`.
3. **What counts.** A draft key counts as **new** only when its code is not in
   the catalog at commit time; a code that the catalog already holds, or that
   the draft names twice, counts once or not at all, as the commit loop
   resolves it today. The organization quota counts rows with
   `created_by_organization_id` equal to the session's organization, plus this
   commit's new keys. Rows from before the migration do not count.
4. **The commit is the authority.** Inside the commit transaction, before the
   first `point_keys` insert, the commit takes
   `pg_advisory_xact_lock` on a key derived from the organization id, counts
   the organization's rows, resolves which draft codes are new, and throws one
   `BadRequestException` if either limit is passed. The message names the
   limit, the count, and how many keys to remove or replace with existing
   codes. The lock makes two concurrent commits for one organization run the
   check one after the other. The transaction rolls back, so nothing is
   written.
5. **The early refusals are advisory.** The agent's `add_point_keys` tool and
   the draft write paths that add point keys refuse a change that would put the
   draft over either limit, with the same sentence. They read without the lock,
   so a concurrent commit can still make the commit refuse; that is the reason
   decision 4 exists.
6. **The exemption.** When `AccessControlService.isGlobalAdmin(jwt)` is true,
   the commit and the early refusals skip both limits. The rows that commit
   inserts still record `created_by_organization_id`, so they count against the
   organization's quota for later commits by other users.
7. **The rider.** The rule-based chat sentence names the catalog, not the
   organization: "The catalog already has point keys (…)".

## Drafter choices

These are the drafter's, open to the owner's change before acceptance.

1. **The lock, not a constraint.** A count over rows cannot be a `CHECK`, and a
   trigger would hide the rule from the API's message. An advisory lock scoped
   to one organization serialises only that organization's commits.
2. **A global admin's rows count.** The exemption is for the actor, not the
   rows: decision 6 keeps them in the organization's total. The alternative —
   leave them `NULL` — would let an exempt commit make room it did not use.
3. **No backfill.** Attributing the 613 seeded rows, or any row added before the
   migration, would need a guess. They stay `NULL` and outside every quota.
4. **The audit row.** The commit's existing `master.onboarding.commit` audit
   payload adds `newPointKeys`, the count of catalog rows it inserted. A
   refusal writes no audit row, as the other count caps (`draftCountProblem`)
   write none.
5. **The other writer.** `apps/api/src/admin/point-keys/point-keys.service.ts`
   is the Point keys admin page, global `admin` only since `F3.39`. It leaves
   the column `NULL` and is unlimited.

## Consequences

- An organization adds at most 1,000 catalog rows through onboarding, and at
  most 200 in one commit. The fleet catalog's growth through onboarding is
  bounded by 1,000 per organization.
- A global admin can still add any number of rows, through onboarding or the
  Point keys page. The quota bounds tenants, not the platform owner.
- A large site with more than 200 genuinely new codes needs two commits or
  reuse of existing codes. The refusal says which.
- One migration, one column, one index. No RLS change.

## Verification owed

- A spec pins both constants.
- A DB integration test: a commit with 201 new keys is refused and writes no
  row; a commit with 200 succeeds and stamps `created_by_organization_id`;
  an organization at 1,000 is refused one more; existing codes do not count.
- A test that two concurrent commits for one organization cannot both pass the
  quota.
- A test that a global admin's commit over both limits succeeds and its rows
  count afterwards.
- A test that `add_point_keys` refuses over a limit, with the sentence.
- The cold-start gate: roles, migrate and seed on an empty volume.

## Amends and relates to

- **Amends ADR 0051** decision 3: the fleet-wide catalog gets a growth quota.
- Relates to ADR 0103 (discovery fills drafts with keys), `F4.103` (draft caps),
  `F4.105` (echo caps), `F3.39` / migrations `0057` and `0059`.

## Amendment 1 — build decisions (agent, 2026-10-20)

Recorded during the `F4.111` build. None changes a ruled decision.

1. **Where the early refusal runs (decision 5).** Three tools ask
   `pointKeyQuotaProblem`: the agent's `add_point_keys`, the guided mode's
   `add_point_key`, and `propose_commit`. A `PATCH :id/draft` and a workbook
   upload replace the draft wholesale and are not refused at write time; a
   draft over a limit is refused when it is proposed and when it commits. The
   upload already has its own count caps (`F4.103`), and refusing a `PATCH` is
   what leaves an operator a way to repair a draft.
2. **How a turn learns the quota.** `OnboardingService.chat` reads
   `isGlobalAdmin` and the organization's stamped row count once per turn
   (`OnboardingTemplateCatalogService.pointKeyQuota`) and passes it through the
   required `pointKeyQuota` field of `handleTurn`'s context, the turn
   vocabulary and `ToolContext`. Required, so `tsc` names every caller that
   must state the exemption or the count.
3. **The lock key.** `pg_advisory_xact_lock(hashtext('bms.point_keys.quota:' ||
   organization_id))`. A hash collision with another organization only makes
   two commits wait for each other; it cannot let one pass a limit.
4. **The commit reads only the draft's codes** (`code = ANY(...)`) to find which
   are new, under the lock, not the whole catalog.
