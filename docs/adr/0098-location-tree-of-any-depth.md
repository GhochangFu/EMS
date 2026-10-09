# ADR 0098 — Locations form a tree of any depth (`F2.10`)

## Status

**Proposed — 2026-10-09.** Source: owner rulings 2026-10-09, thirteen questions
put one at a time; each was ruled for the recommended option. Ruling 11
supersedes the pin rule of ruling 9. Rulings 12 and 13 were asked after the
security review of the first draft found that ruling 8's "manage rights on the
old and the new parent" let a location administrator take over a root; ruling
12 supersedes that clause. Each ruling is a numbered decision below.
Where a decision needed a detail the rulings do not give, the detail is listed
under *Drafter choices (not asked)* for the owner to confirm at acceptance.
Drafted before any implementation code. Line citations are to `main` at
`d52a3d25`; only `docs/` changed between `6a184d48` (the research base) and
that commit, so the research's code citations hold except where this record
corrects them.

This is the **companion ADR** that ADR 0018 decision 6 deferred location depth
to. It answers BACKLOG §5's *Hierarchy extension* ⚠ row. The owner's
2026-10-08 note on that row ("wait for the client site list (C22a) before an
ADR") is superseded by the 2026-10-09 rulings: the structure is built as data,
and the client's list is entered by an administrator when it arrives.

Promotes nothing out of `AGENTS.md` §6: §6 does not list location depth.

| Ruling (2026-10-09) | Decision |
| --- | --- |
| 1 — shape: `locations.parent_id` + a recursive CTE; composite same-org FK; a cycle guard; a depth cap; existing rows become roots | 1 |
| 2 — level names: the global `location_types`, free nesting; the migration seeds generic types; ADR 0077 stands | 2 |
| 3 — assets and RTUs attach to any node; `@site` is the asset's own node (ADR 0055 decision 12 unchanged) | 3 |
| 4 — access: a grant covers the subtree, read and manage (ADR 0018); re-point the flat tripwire; prove sibling refusal and no cross-org edge | 4 |
| 5 — deactivation is refused while an active child node exists (bottom-up) | 5 |
| 6 — the subsystem is the asset group; `parent_asset_id` stays out (its own later row, the v2 plant train) | 6 |
| 7 — reports and schedules store nodes and expand to the current subtree at run time; health and sustainability filter on a subtree and can group by an ancestor; no code names a level; the control room stays per node (a campus view is a later row) | 7 |
| 8 — moves are allowed within one organization; ~~manage rights on the old and the new parent~~ *(superseded by 12)*; audited with the old and new parent; no effective dating | 8 |
| 9 — coordinates stay `NOT NULL` on every node *(its pin rule is superseded by 11)* | 9 |
| 10 — calc parameters walk the ancestors: asset → own location → parent … → root → organization; nearest wins | 10 |
| 11 — map pins: a node is a pin if it is a leaf **or** holds an active asset; a parent is a filter that zooms to its subtree | 11 |
| 12 — only an organization-level administrator moves a node: a global `admin`, or an `organization_admin` with a direct grant on the node's organization — never `canManageOrganization`, which is true for a location administrator | 12 |
| 13 — creating a node keeps today's rule: a location administrator creates none (`locations.service.ts:139-141`), roots and children alike | 12 |

## Context

**The client's ladder has five levels and the schema has three.** The client's
roll-up ladder is asset → subsystem → building/site → campus/township →
enterprise; the shipped shape is `Organization → Location → Asset → Point`
(ADR 0008, as ADR 0018 separated the RTU out of the containment ladder). The
client's own site list and hierarchy (question `C22a`,
[handover 2026-08-17](../ion-exchange-client-handover-2026-08-17.md):392) has had
no answer since 2026-08-17. The owner asked how a product should make the
hierarchy fit any customer as data, and the research
([`docs/f2.10-hierarchy-research-2026-10-09.md`](../f2.10-hierarchy-research-2026-10-09.md))
answers it in two parts.

**No surveyed product or standard uses a fixed ladder.** ISA-95, ISO 14224,
Brick, Haystack, SAP PM, Maximo, AWS IoT SiteWise, Azure Digital Twins, Niagara,
Desigo CC and EcoStruxure PME all store a tree of typed nodes: a parent, a type
from a catalogue, and a free depth (SiteWise caps it at 30). None of them
models a subsystem as a location level; it is equipment composition or a system
grouping under the site (research §1).

**Our schema is one column away; the consumers are not.**

- `bms.locations` (`packages/db/src/schema/bms-schema.ts:100-126`) has no parent
  column. `type` references `bms.location_types.code` (`:108-112`), and
  `latitude`/`longitude` are `NOT NULL` (`:116-117`).
- `bms.location_types` (`:92-98`) is global — ADR 0077 gate question 1 rejected
  a per-organization table.
- `assets.location_id` is `NOT NULL` (`:299`), and it is the column every scoped
  check filters on.
- `asset_groups` are per location, with `asset_group_members.role` — the
  subsystem (ADR 0040 ruling 5, ADR 0053 decision 9).
- ADR 0018 decision 6 deferred `locations.parent_id` and `parent_asset_id` to a
  companion ADR that was never written (`0018-source-axis-separation.md:123-126`),
  and recorded that *"a grant on a parent location **does** imply access to its
  descendants"*, to ship with that ADR's migration and to be explicitly tested,
  because *"it silently widens access"* (`:150-155`).
- `assertLocationManagementIsFlat`
  (`apps/api/src/auth/access-control.integration.spec.ts:639-713`) pins flatness
  on purpose: *"Do not relax it to make depth compile."* Its docblock says 15
  `canManageLocation` callers; there are now **28 call sites in 12 files**
  (three inside `access-control.service.ts` itself) and **18
  `writableLocationIds` call sites**, all of which widen together.

The research's consumer table (§2) lists thirteen consumers that assume one
flat level. Every one is buildable without `C22a`; the list only supplies the
real nodes and names.

## Decision

### 1. The shape: `locations.parent_id`, read by a recursive CTE

`bms.locations` gains `parent_id uuid NULL`. A `NULL` parent is a root. Every
existing row becomes a root; no data moves.

- **Same-organization containment is structural.** `bms.locations` gains a
  unique `(id, organization_id)`, and `(parent_id, organization_id)` references
  `(id, organization_id)` — the composite-FK pattern of
  `asset_groups_id_location_key` (`bms-schema.ts:367`) and the `dashboard_tabs`
  FKs. With `MATCH SIMPLE`, a root (`parent_id IS NULL`) is not checked.
  The FK is `ON DELETE NO ACTION ON UPDATE NO ACTION` (*Drafter choices* 17):
  never `CASCADE`, which deletes a subtree silently and then fails on the
  `assets`/`rtus` FKs, and never a bare `SET NULL`, which nulls **both** FK
  columns and so `organization_id`, which is `NOT NULL`. `NO ACTION` rather
  than `RESTRICT`, so that one statement can delete a parent and its child (the
  integration cleanups that delete fixture locations, for example
  `locations.rls.integration.test.ts:188`, delete the whole tree in one
  statement or children first). A later `SET NULL` uses the column-list form,
  `SET NULL (parent_id)`. The API never deletes a location and cannot change
  one's organization (`updateLocationBodySchema` omits `organizationId`,
  `locations.schema.ts:40-41`).
- **A cycle guard and a depth cap**, in the write path and backed in the
  database (*Drafter choices* 1 and 3).
- **Reads walk the tree with `WITH RECURSIVE`.** No `ltree` (an extension, which
  needs the dependency and roles path) and no closure table (triggers that keep
  an index in step with every move — the drift Maximo's APAR IJ45613 records).
  At tens to hundreds of nodes per organization neither pays for itself.

Rejected in one line: a fixed `location_groups` tier (fails "any depth" — every
further tier is code again); tags only (no containment, and ADR 0018's
descendant rule would need a tag-grant table).

### 2. Level names: the global type catalogue, free nesting

A node's **type** says what the place is; its **position** in the tree says
where it sits. They are separate, and no code derives one from the other. Any
type may sit under any type. The level a report groups by is a depth or an
ancestor node, never a type name (decision 7).

Migration `0103` seeds four generic types into `bms.location_types`
(*Drafter choices* 4). ADR 0077 stands as it is: the catalogue stays global,
and a global administrator can add further types on the page (Amendment 1).

Rejected in one line: an organization-scoped `location_levels(organization_id,
depth, label)` table (it amends ADR 0077 gate question 1 for a need no client
has stated yet); deriving the level from the type.

### 3. Assets and RTUs attach to any node; `@site` is the asset's own node

`assets.location_id` and `rtus.location_id` may name any node — a leaf or an
interior one. Nothing moves an asset when a node gains a child.

`@site`, `@domain('…')` and `@group('…')` resolve over the owning asset's **own**
node, exactly as today. **ADR 0055 decision 12 is unchanged:** no cross-asset
reference leaves the owning asset's location, and no selector reaches a parent
or a child node.

Rejected in one line: an ancestor selector such as `@campus` (it re-opens ADR
0055 decision 12 and needs `C22a` to know what a campus aggregate means);
leaves only for assets (a campus-level meter, such as an incomer, has no other
home).

### 4. Access: a grant on a node covers its subtree, for read and for manage

ADR 0018's recorded rule becomes load-bearing. A `user_location_access` row on
node *N* grants read and manage over *N* and every descendant of *N*.

- `scopeFromSource` (`apps/api/src/auth/access-scope-sources.ts:72-270`) expands
  the organization and location branches to the subtree before it filters
  `inArray(assets.locationId, …)`.
- `writableLocationIds` and `canManageLocation`
  (`apps/api/src/auth/access-control.service.ts:178`, `:208`) answer from the
  same closure. All 28 + 18 call sites widen at once, which is the intent.
- An asset-group grant is unchanged: it covers its group's members only.
- `assertLocationManagementIsFlat` is re-pointed, not relaxed — see *Security*.

Rejected in one line: roll-up only with scope staying at the location level (a
campus manager could see the campus figure and not manage the campus); an
explicit grant per child (every new child is a silent access gap).

### 5. Deactivation is bottom-up: no active node under an inactive parent

**The invariant:** an active node never has an inactive parent. It holds after
every write. Each of the following is **refused**:

- **(a)** creating an active node under an inactive parent;
- **(b)** reactivating a node whose parent is inactive;
- **(c)** moving an active node under an inactive parent;
- **(d)** deactivating a node that has an active child node.

Today's refusal stays beside (d): a node with active RTUs or assets cannot be
deactivated (`apps/api/src/admin/locations/locations.service.ts:323`).

So an administrator retires a campus leaf-first and restores it root-first. An
inactive node never has an active child node, at any time. The per-row
`active` filters the consumers use today stay correct for the tree with no
ancestor walk: a hidden campus never leaves a visible site under it.

The asset and RTU half is weaker, and this ADR does not change it: the refusal
at `:323` runs only when the node is deactivated. Afterwards, only template
instantiation refuses an inactive location
(`apps/api/src/admin/asset-templates/asset-templates-instantiate-core.ts:501-506`);
the plain asset and RTU create and reactivate paths do not check the location's
`active` (see *Drafter choices* 14).

Rejected in one line: a cascade that deactivates the subtree (one click hides
a whole campus, and reactivation cannot know which children were inactive
before); hiding an inactive node's subtree at read time (every consumer must
walk the ancestors, and an active child of an inactive parent stays in the
data).

### 6. The subsystem is the asset group; `parent_asset_id` stays out

The client's "subsystem" level is `bms.asset_groups` at the node, with
`asset_group_members.role`, as ADR 0040 ruling 5 and ADR 0053 decision 9 rule
for v1. This ADR adds no `parent_asset_id`.

The `F2.10` row's second half — asset parent/child — leaves this row. It is a
later row of its own: the v2 plant train, which ADR 0040 ruling 5
(`0040-e5.1-water-pack-provisional-authoring.md:164-176`) describes as
*"available once `F2.10` lands"*. The row's condition that *"the asset-tree half
must be decided in the `E5.1` ADR before pack authoring"* is already met: ADR
0040 ruling 5 decided it (one asset per plant for v1; the group is the train).

Rejected in one line: an asset tree in this row (it touches every scope check
through `assets.location_id`, `F4.16` and `F2.2` instantiation, for a shape the
client has not asked for).

### 7. Consumers are level-agnostic: store a node, expand it at run time

No code names a level. A consumer takes a node, and the node means its
**current** subtree, resolved when the consumer runs.

- **Reports and schedules** store node ids in `location_ids` and expand each
  node to its current subtree at render time (amends ADR 0071 decision 7; see
  *Amends and relates to*). A child added to a campus after the schedule was
  saved is in the next run.
- **Health** (`E1.3`) filters on a node's subtree, not on the node alone
  (`apps/api/src/asset-health/asset-health.service.ts:461-462`).
- **Sustainability** filters on a subtree, and `sustainability.by_location`
  can group its rows by an ancestor at a chosen depth (amends ADR 0072
  decision 2).
- **The control room stays per node.** A node's site control room shows the
  node's own assets, as today. A campus view that aggregates a subtree is a
  later row.

Rejected in one line: storing the expanded subtree (a new child site is
silently missed — the research's reported pitfall); reports hard-wired to a
level shape (they return nothing on a different tree — the Schneider PME
pitfall).

### 8. Moves: within one organization, by an organization-level administrator, audited

A node may be re-parented — its `parent_id` changed, including to `NULL` — only
within its organization, and only by an organization-level administrator
(decision 12, which supersedes this ruling's "manage rights on the old and the
new parent"). Every move writes one audit row with the old and the new parent. A move
takes effect at once and is not effective-dated: health, sustainability,
reports and calc parameters read the **current** tree, including for a past
period.

Rejected in one line: refusing moves (a mis-entered tree could only be fixed by
deactivating and re-creating nodes, which breaks asset history links);
effective-dated parent links (every consumer gains a time dimension for a need
no client has stated).

### 9. Every node keeps its coordinates

`latitude` and `longitude` stay `NOT NULL` on every node, root and interior
included, in the schema and in the API (`apps/api/src/admin/locations/locations.schema.ts`,
`packages/shared/src/contracts/admin.ts`). An interior node's point is the one
the administrator enters (for a campus, its gate or centre). Nothing computes a
centroid.

Rejected in one line: nullable coordinates (they reach the map, the timezone
default and every DTO that carries them); a computed centroid (a moving value
no one entered).

### 10. Calc parameters walk the ancestors

A `$key` on an asset at instant *t* resolves to the row of the **nearest**
scope among the rows valid at *t*: the asset, then the asset's own node, then
its parent, and so on to the root, then the organization. Nearest wins. A
tariff set on a campus applies to every site under it that has no row of its
own. This amends ADR 0070 decision 2's resolution order
(`0070-sustainability-metrics-engine.md:224-228`), implemented today in
`apps/api/src/calc/calc-parameters.service.ts:93-95`.

`calc_parameters.location_id` may name any node, interior or leaf; the admin
scope picker offers the tree.

Rejected in one line: own node and organization only (a per-campus tariff needs
one row per site, and a new site under the campus is unset until someone
notices).

### 11. Map pins: a leaf, or a node that holds an active asset

A node is a map pin when it is a **leaf** (it has no active child node) **or**
it holds at least one active asset. An interior node with no asset of its own
is not a pin. A parent is a **filter**: choosing it zooms the map to its
subtree's pins. This supersedes ruling 9's "leaves only" and amends `F3.79`
ruling 4 (*"every active location is a map pin"*), which has no ADR — its record
is the `F3.79` BACKLOG row.

Rejected in one line: every node a pin (a campus pin sits on top of its own
sites); leaves only (a campus-level incomer's alarms have no pin).

### 12. Only an organization-level administrator creates or moves a node

**An organization-level administrator** is a user whose `bms.users` role is
`admin`, or `organization_admin` with a **direct** `user_organization_access`
row for the node's organization. The check never uses `canManageOrganization`
or `writableOrganizationIds`: for a `location_admin` both answer from
`locationDerivedOrganizationIds` (`access-control.service.ts:159-169`,
`:907-916`), so they are true in every organization where the user holds one
node.

- **Moves (ruling 12).** Only an organization-level administrator moves a node.
  A move changes other users' access — grantees above the old parent lose the
  subtree and grantees of the new parent gain it (*Drafter choices* 12) — and
  ADR 0089 lets only `admin` and `organization_admin` change access
  (`apps/api/src/admin/users/user-management-rules.ts:12`). A `location_admin`
  that manages two subtrees cannot move a site between them.
- **Creation (ruling 13).** Today's rule stands: a `location_admin` creates no
  location (`apps/api/src/admin/locations/locations.service.ts:139-141`), root
  or child. An organization-level administrator creates roots and children.
  A new child is inside its ancestors' grants at once (decision 4).

What a `location_admin` keeps is everything else over its closure: editing a
node's fields, deactivating and reactivating it under decision 5, and managing
its assets and RTUs.

The first draft gave moves to anyone with manage rights over the old and the
new parent and roots to "organization-level rights". The security review
found the hole: a `location_admin` granted node *X* could move root *R* under
*X* — the old parent is `NULL`, which the location-derived organization check
passed, and *X* is in the user's closure — and so read and manage all of *R*.

Rejected in one line: location administrators move between nodes they manage
(a move is an access change by another name); location administrators create
children of nodes they manage (replaces a refusal no one asked to lift).

## Security

**Scope reads run on `fleetDb`, which bypasses RLS.** `scopeFromSource` and its
helpers run every read on `fleetDb` (`bms_fleet`, `BYPASSRLS`)
(`access-scope-sources.ts:34`; the organization branch at `:105-109`, the
location branch at `:149-150`). The calc-parameter resolver also reads on the
fleet pool (`calc-parameters.service.ts:59`, ADR 0097 decision 6). RLS
therefore contains none of those walks. (The schedule render is the exception:
it resolves asset ids on a tenant `tx` under RLS, `report-render.service.ts`,
and its expansion must stay on that `tx`, never `fleetDb` — *Drafter choices*
16.) Postgres also checks a
foreign key without RLS, so a plain `parent_id → id` FK would accept a parent
in another organization even inside `withTenant`. Containment rests on two
things, and the build needs both:

1. **The composite FK** `(parent_id, organization_id) → (id, organization_id)`
   (decision 1). A cross-org parent edge cannot be stored.
2. **An `organization_id` predicate on every step of every recursive CTE** —
   the anchor and the recursive term, in `scopeFromSource`, in
   `writableLocationIds`, in the calc-parameter ancestor walk, and in the
   health, sustainability and report expansions. A predicate on the anchor
   alone is not enough: it trusts the FK for every later step, and the FK is
   then the only guard.
3. **A bound on every recursive CTE.** Each uses `UNION` (not `UNION ALL`) and a
   `depth < 8` term, so a defect — or a row written with the trigger and the FK
   skipped, as `session_replication_role = replica` does — cannot loop.

**The tripwire is re-pointed at the exact closure.**
`assertLocationManagementIsFlat` becomes an assertion that the subtree rule
widens access to exactly the intended set. On a fixture tree of depth 3 or
more it must prove:

- **the exact closure:** `writableLocationIds` for a user granted node *N* equals
  the expected set (*N* and its descendants), compared as sets with an
  explicit non-empty guard, as today; and `canManageLocation` answers
  correctly for **every** fixture node;
- **a sibling subtree is refused:** `canManageLocation` is false for a sibling
  of *N*, for each node under that sibling, and for *N*'s parent;
- **no cross-org parent edge can be stored:** an `INSERT` or `UPDATE` that sets
  `parent_id` to a node of another organization fails **on the composite FK**
  — the test asserts SQLSTATE `23503` and the constraint name, because the
  `BEFORE` trigger (*Drafter choices* 3) runs before the FK check and could
  otherwise raise first and leave the FK unproved — run as `bms_tenant` and as
  `fleetDb`;
- **the per-step predicate holds without the FK:** in a rolled-back superuser
  transaction with `session_replication_role = replica`, plant a cross-org
  edge, then assert that `writableLocationIds`, `scopeFromSource`,
  `reportFileReadScope` and the calc-parameter walk all exclude the foreign
  subtree. Without this case, removing the predicate from any CTE keeps every
  other proof green, because the FK alone already refuses the edge;
- **the read side matches:** `scopeFromSource`'s location list and readable
  asset ids for the same user cover the same closure and refuse the same
  sibling. The read path is separate code from `writableLocationIds` and can
  drift from it, so the tripwire gates both;
- **a move re-checks:** after a move, the old ancestor's grantee is refused the
  moved subtree and the new ancestor's grantee is granted it.

**Every direct reader of the grant table must agree.** Enumerated by query,
outside specs, tests and seeds, `bms.user_location_access` is read by:

- **moving to the closure** (they answer "which locations"):
  `scopeFromSource`; `writableLocationIds`; `reportFileReadScope`
  (`access-control.service.ts:235-260`), which also gates the schedule list
  (`report-schedules.service.ts`, R-12), so schedule visibility widens with
  file visibility;
- **staying flat, by design:** `readScopeSourceYields`
  (`access-scope-sources.ts:300-308`) asks whether a grant source reaches at
  least one row, and a granted node is itself in its closure — but only because
  decision 5's invariant holds; `grantsOf` and `readGrant`
  (`apps/api/src/admin/users/user-grants.service.ts:214`, `:285`), which list
  and revoke the **direct** rows and must never show the closure as grants;
- **staying flat, because they answer "which organizations":**
  `locationDerivedOrganizationIds` (`:907-916`), the user administration's
  organization lookup (`apps/api/src/admin/users/users.service.ts:246`) and the
  table's RLS policy (migration `0098`). The composite FK keeps every
  descendant in its ancestor's organization.

The `asset-images*` hits are docblock prose only.

**Only an organization-level administrator creates or moves a node**
(decision 12), and that check never reads the location-derived organization
set.

**`/auth/me` hides an unreadable parent on the server.** Its producer sets a
node's `parentId` to `null` when the parent is not in the caller's readable
set, for the location scope and the asset-group scope alike, so the response
never carries the id of a node the caller cannot read (*Drafter choices* 8).

## Amends and relates to

Each line was checked against the record.

- **ADR 0008 — the shape reopens.** `Organization → Location tree → Asset →
  Point`. ADR 0008 forbids no depth (`0008-org-location-rtu-hierarchy.md:18-28`);
  its single location level is what this ADR replaces. **Amends** the shape.
- **ADR 0018 decision 6** (`0018-source-axis-separation.md:123-126`). This ADR is
  the companion ADR that decision deferred `locations.parent_id` to; the
  descendant-grant rule recorded at `:150-155` ships with migration `0103`, as
  that record requires. `parent_asset_id` **stays deferred** (decision 6). The
  decision's third item, the Eskom-era `locations.type` union, was settled by
  ADR 0077. **Discharges** the deferral; amends nothing in 0018.
- **ADR 0077 — an addition, not an amendment.** Gate question 2 already says
  *"Any other type … comes later as one `INSERT`"* (`0077-location-types-lookup-table.md:72-75`),
  and Amendment 1 lets a global administrator add one with no migration at all.
  Migration `0103` adds four rows (*Drafter choices* 4) with `INSERT … ON
  CONFLICT DO NOTHING`, as `0085` did. It uses a migration rather than the page
  so that a cold start and a warm database agree. Decision 1 (global, no RLS)
  stands.
- **ADR 0072 decision 2** (`0072-sustainability-and-benchmarking-dashboards.md:267-300`)
  — **amended.** `sustainability.by_location` gains an optional grouping by an
  ancestor at a chosen depth, a field on its write schema; with the field unset
  it is one row per node, as today. *Ruled here without a question* item 3
  (`:415-420`, the roll-up is over the dashboard's scope, never wider) stands.
  The research cites "ADR 0072 decision 8, 0072:114-120"; that is
  **Context item 8**, the statement that the campus tier does not exist, which
  this ADR overtakes as a fact and does not amend. Amendment 1 item 6 (`:541`,
  the location query has no `active` predicate) is unchanged. Under decision
  5 an inactive node has no active child node, so grouping by an ancestor
  never folds an inactive interior node's active children into a row; an
  inactive node that still holds an active asset (decision 5's last paragraph)
  lists as it does today.
- **ADR 0050** — relates; **no amendment.** Decision 4's counter composes by
  `sum` and is level-agnostic so *"those tiers arrive as data"*
  (`0050-asset-health-score.md:147-149`); *Not in this ADR* names `F2.10` as the
  owner of the tier (`:224-226`). ADR 0050 rules no location filter, so the
  change from the node to its subtree (decision 7) is a filter change in
  `asset-health.service.ts`, not a change to a decision.
- **ADR 0070 decision 2** (`0070-sustainability-metrics-engine.md:224-228`) —
  **amended** by decision 10: the resolution order asset → location →
  organization becomes asset → own node → each ancestor to the root →
  organization. Amendment 2 item 1 (`:536`, per-asset nearest-scope resolution
  for the tariff) inherits the walk unchanged.
- **ADR 0055 decision 12** (`0055-cross-asset-aggregation-calc-grammar.md:288`)
  — **unchanged** (decision 3). So is decision 9's `@site` (`:185-195`).
- **ADR 0040 ruling 5** (`0040-e5.1-water-pack-provisional-authoring.md:164-176`)
  and **ADR 0053 decision 9** (`0053-e5.2-mechanical-pack-provisional-authoring.md:161-166`)
  — **unchanged.** Asset groups stay the subsystem and the train (decision 6).
- **`F3.79` ruling 4** (no ADR; its record is the `F3.79` row in
  `docs/BACKLOG.md`) — **amended** by decision 11.
- **ADR 0071** (`0071-scheduled-energy-reports.md`) — **decision 7 amended**: a
  schedule's `location_ids` are nodes, and the render job expands each to its
  current subtree before it resolves asset ids under RLS (`:261`). **Decisions 4
  and 6 stand in substance**: a file's `location_ids` is the readers' scope
  snapshot, and its read rule (manage scope over every id) now means the
  subtree closure, so a user granted an ancestor reads the file. The on-demand
  save stamps the
  array from `writableLocationIds(jwt)` (`:186`); once that returns a closure
  it would stamp the expanded set, so the save stamps the caller's **granted
  nodes** instead (*Drafter choices* 9). The read rule's implementation does
  **not** widen by itself: `reportFileReadScope`
  (`apps/api/src/auth/access-control.service.ts:235-260`) reads a location
  admin's direct `user_location_access` rows, so it must move to the closure
  with decision 4 (*Security*).
- **The site control room** (`F3.73`) — **unchanged** (decision 7): one view
  per node; `site_control_room_views.location_id` stays the primary key
  (`packages/db/src/schema/site-control-room-views-schema.ts:23-25`). This
  line was checked against the schema, not against the text of ADR 0087.

## Scope narrowing

- **Asset parent/child leaves `F2.10`** (decision 6). It becomes its own row —
  the v2 plant train — after ADR 0040 ruling 5's v1 shape.
- **A campus control-room view is deferred** (decision 7). It becomes its own
  row.

Following #778's precedent — that ADR PR edited no `docs/BACKLOG.md` line, and
the rows ADR 0097 owed were raised at the closure (#786) — this PR edits no
BACKLOG line. Both rows are **raised at the `F2.10` closure**, with the next
free IDs read from `origin/main` then (they would be `F4.239` and `F4.240` on
`d52a3d25`). The row's title, its effort and the §5 ⚠ row are also edited at
closure.

## Drafter choices (not asked)

For the owner to confirm at acceptance.

1. **The depth cap is 8 levels; a root is depth 1.** The client's ladder needs
   three location levels (building/site, campus/township, and room for a
   region), and SiteWise's 30 is a quota for a product with far larger trees.
   Eight bounds every recursive CTE so a defect cannot loop, and leaves room. A
   move is refused when the moved subtree's height plus the new parent's depth
   exceeds 8.
2. **Error reasons.** Each refusal is a structured body `{ message, reason }`
   (the `asset-templates-migrate.service.ts:297` shape):
   `location_parent_not_found` (400; an unknown or unreadable parent),
   `location_parent_cross_org` (400), `location_parent_cycle` (400; the new
   parent is the node or one of its descendants), `location_depth_exceeded`
   (400), `location_parent_inactive` (409; refusals a, b, c), and
   `location_has_active_children` (409; refusal d — 409 as today's deactivation
   refusal is).
3. **The race-proof backstop.** Two concurrent writes can each pass a service
   pre-check and together break the cycle guard, the depth cap or decision 5's
   invariant. So migration `0103` adds a `BEFORE INSERT OR UPDATE OF parent_id,
   active, organization_id` trigger on `bms.locations` that takes a per-org
   `pg_advisory_xact_lock` and re-checks the cycle, the depth and the
   invariant, raising on a breach. Precedents: triggers in `0084` and `0098`;
   the advisory lock in `report-files.service.ts`. The service keeps its own
   pre-check for the structured 4xx; the trigger is the backstop under it, as
   ADR 0070's `EXCLUDE` is under the parameter write's 409. Also a `CHECK
   (parent_id IS DISTINCT FROM id)`. Settled by the migration and security
   reviews of the first draft, which asked it as an open question:
   - **`SECURITY INVOKER`, `VOLATILE`, `SET search_path = pg_catalog,
     pg_temp`**, with `bms.locations` fully qualified; the migration asserts
     after creation that the function is not `SECURITY DEFINER` and that its
     `search_path` is pinned, as `0084` does. Only `bms_owner`, `bms_tenant`
     (both `NOBYPASSRLS`) and `bms_fleet` (`BYPASSRLS`) can write the table.
     Under `tenant_isolation` (`FOR ALL`, `USING` equal to `WITH CHECK`), a
     write by an RLS-bound role without the row's organization in its GUC is
     refused by `WITH CHECK` in the same statement, so it never commits
     whatever the trigger decided; a write that passes sees **every** row of
     its organization, and the composite FK keeps every ancestor and
     descendant there. `bms_fleet` and the superuser see all rows. A
     `SECURITY DEFINER` function owned by `bms_owner` would be **worse**:
     `FORCE` binds the owner, so a `fleetDb` write with no GUC would see no
     rows; owned by `bms_fleet` it would break ADR 0045's rule that
     `bms_owner` owns the objects.
   - **A parent row the function cannot read raises**; it never passes.
   - **The lock comes before any read**, on its own key namespace
     (`locations_tree:<organization_id>`, apart from `report_files:`), and the
     service takes the same lock first, so the row lock and the advisory lock
     are always taken in one order and cannot deadlock.
   - **Race-proof under `READ COMMITTED` only.** Each statement in a
     `VOLATILE` function takes a fresh snapshot after the lock there; under
     `REPEATABLE READ` the snapshot predates the lock. No code sets an
     isolation level today; the trigger raises unless
     `current_setting('transaction_isolation') = 'read committed'`, so a write
     path that raises the level fails loudly instead of racing.
   - **Every recursive CTE in the function** carries the `organization_id`
     predicate on each step and the depth bound (*Security* 2 and 3).
   - **A `BEFORE ROW` trigger sees earlier rows of the same statement in no
     fixed order**, so a multi-row statement can be refused although its final
     state is valid. That is fail-closed and accepted: the API writes one
     location per statement. A future multi-row write moves the check to an
     `AFTER ROW` trigger.
4. **The seeded types** (`0085` style: `snake_case` codes, sentence-case
   labels, `sort_order` after `pump_station`'s 40): `campus` "Campus" (50),
   `township` "Township" (60), `building` "Building" (70), `plant` "Plant"
   (80). `ON CONFLICT DO NOTHING` keeps a same-code row an administrator
   created on the page, with that administrator's label. **This changes the
   onboarding chat.** `matchLocationType`
   (`apps/api/src/admin/onboarding/onboarding-location-type-match.ts`) reads
   every active code and label as whole words in free text, so after `0103`
   "add the Thane treatment plant" is typed `plant` and "we are building a
   site" is typed `building`, where today the chat asks a question. The first
   is wanted; the second is a false match, and the chat's confirmation step is
   where the user corrects it. The build adds one matcher spec per new code,
   including a false-match case. The owner may prefer codes that collide with
   no common word.
5. **Audit actions.** A move is its own action, `master.location.move`, with
   `{ fromParentId, toParentId }` in the audit body, written in the same
   transaction; a PATCH that changes `parent_id` and other fields writes both
   `master.location.update` and `master.location.move`. `master.location.create`
   gains `parentId`. Deactivate and reactivate keep their actions.
6. *(Withdrawn — now decision 12, rulings 12 and 13.)* The first draft let a
   node's creation follow manage rights over its parent and kept roots for
   "organization-level rights"; the security review showed that the
   location-derived organization check made this a takeover path.
7. **Onboarding creates roots only.** The workbook and the chat agent gain no
   parent field in this row; an administrator places the new nodes in the tree
   afterwards.
8. **`/auth/me` lists the closure.** `accessLocationSchema`
   (`packages/shared/src/contracts/auth.ts:61-68`) gains `parentId: string |
   null`, and the list carries every readable node, so the web can build the
   tree. A node whose parent the user cannot read is shown as a root for that
   user, and the **server** sets that `parentId` to `null` (*Security*), so the
   id of an unreadable parent never leaves the API. The build enumerates the
   producers by the `.parse(` call (ADR 0030).
9. **A granted-nodes accessor for report files.** The on-demand report save
   stamps the caller's directly granted nodes, not `writableLocationIds`'
   closure, so a file stores nodes (decision 7) and the array stays inside the
   `locationIds.max(200)` bound.
10. **The organization's site cards stay flat.** The Control Room organization
    level lists every active node it lists today (`site-layout.service.ts:222`
    reads every active location), one card per node, with no tree grouping;
    grouping goes with the campus view row.
11. **The map's seeded arm.** Decision 11's rule applies to both arms of the
    `GET /map/sites` `UNION` (`apps/api/src/map/map.service.ts`): the
    `bms.map_locations` arm that joins a location, as well as the `F3.79` arm.
    Because the map service serves `/map` too, the estate map follows the same
    rule.
12. **Re-parenting changes visibility at once.** A user granted an old
    ancestor loses the moved subtree, and a user granted the new ancestor gains
    it, in the same transaction. This is the consequence of decisions 4 and 8,
    stated so the move dialog can say it. It is why decision 12 keeps moves
    with the organization-level administrators who already own access changes.
13. **The research document is committed with this ADR**, unchanged. Two of
    its citations are corrected here, not in it: "ADR 0072 decision 8" is
    Context item 8 (see *Amends and relates to*), and the tripwire spans
    `:639-713`, not `:640-700`.
14. **No new refusal for assets and RTUs on an inactive node.** Decision 5
    does not add one: asset and RTU create and reactivate keep today's
    behaviour, and only instantiation refuses an inactive location. The owner
    may add the refusal; it would make "an inactive node holds nothing active"
    true at all times, not only at deactivation.
15. **The map change reaches `/map`.** `F3.79`'s browser check recorded `/map`
    as unchanged; under choice 11 an interior node with no asset of its own
    stops being a pin on `/map` as well.
16. **A schedule follows the current subtree, not its author.** The render runs
    as the system with no author check (`report-render.service.ts`,
    `createdBy: null`), though `report_schedules.created_by` exists
    (`report-schedules-schema.ts:50`). So a schedule saved on node *N* keeps
    sending *N*'s current subtree to its recipients after its author loses
    *N* — as today for a flat location — and, new with the tree, also sends a
    node an administrator later moves under *N*. Tenancy holds: the expansion
    runs on the render's tenant `tx` under RLS, never `fleetDb`, and the FK
    keeps the tree in one organization. Accepted, and the move dialog names
    the schedules on the new ancestors. The other option, a render-time
    re-check of the author's closure, is a later row if the owner wants it.
17. **The FK actions** are `ON DELETE NO ACTION ON UPDATE NO ACTION`
    (decision 1).

## Build sketch (not a plan)

**Migration `0103`** (forward-only, re-runnable, between `SET ROLE bms_owner`
and `RESET ROLE`): `ADD COLUMN IF NOT EXISTS parent_id`; the unique
`(id, organization_id)`, the composite FK and the `CHECK`, each in a
`pg_constraint` guard block as `0085` and `0102` do; `CREATE INDEX IF NOT
EXISTS` on `(organization_id, parent_id)`; `CREATE OR REPLACE FUNCTION`, then
`DROP TRIGGER IF EXISTS` and `CREATE TRIGGER` (*Drafter choices* 3) with the
`prosecdef`/`search_path` assertion; the four types. No row moves. The
migrator runs every pending migration in one transaction, so `NOT VALID`
then `VALIDATE` would give no lock benefit; on 19 live rows a plain FK is
enough. The journal's `when` for `0103` is above `0102`'s `1791498208458` and
not ahead of the wall clock (`F4.94`). The Drizzle schema declares
`unique("locations_id_organization_key").on(t.id, t.organizationId)` and a
composite `foreignKey({ columns: [t.parentId, t.organizationId],
foreignColumns: [t.id, t.organizationId] })` in the extra-config callback, as
`dashboard-schema.ts:280` does — which also avoids the `TS7022` implicit-any a
self-referencing `.references(() => locations.id)` raises — with names that
match the SQL.

**Consumers**, from the research table, sized as there:

| Consumer | Change | Size |
| --- | --- | --- |
| Migration, seeded types, seed verifier | as above; the verifier counts present rows and needs nothing for the column | S |
| `scopeFromSource` | subtree expansion, org predicate per step | M |
| `writableLocationIds` / `canManageLocation` + tripwire | closure; re-pointed tripwire | M |
| `/auth/me` contract | `parentId` | S |
| Locations admin service and form | parent, guards, move (organization-level administrators only, decision 12), audit, parent picker | M |
| Health | node → subtree filter | S |
| Calc parameters | ancestor walk (decision 10) | M |
| Calc selectors and KPIs | none (decision 3) | 0 |
| Site control room | none (decision 7) | 0 |
| Map | pin rule; parent filter and zoom | S–M |
| Sustainability | subtree filter; group by ancestor | M |
| Reports and schedules | expand at run; granted-nodes stamp; `reportFileReadScope` to the closure | M |
| `HierarchyFilterBar` | a tree picker | M |

**Order of PRs**, serial:

1. **The tree core** (db + api): migration `0103`, the contract field, the
   locations admin write path with its guards and audit, the subtree closure in
   `scopeFromSource`, `writableLocationIds` and `canManageLocation`, and the
   re-pointed tripwire. One PR, because ADR 0018 requires the descendant rule
   to ship with the migration, not before.
2. **The read consumers** (api): health, sustainability, reports and
   schedules, calc parameters, the map pin rule.
3. **The web**: the parent picker, the tree picker in `HierarchyFilterBar`, the
   sustainability grouping control, the map filter.
4. **The closure** (docs): the BACKLOG rows and edits under *Scope narrowing*.

## Dependencies

**No new package**, so §9.4 is not triggered: `WITH RECURSIVE` is core
Postgres. **One migration** (`0103`), schema-changing, so the migration
reviewer and a cold start gate it. One contract field in
`packages/shared/src/contracts/`.

## Consequences

- **Effort 10–14**, against the row's `4–8` and the research's `8–12`. The
  row's figure assumed one campus tier, not a general tree. Bottom-up from the
  table above, at S ≈ 0.5 and M ≈ 1–1.5: seven M rows (7–10.5), three S rows
  (1.5), the map at S–M (0.5–1), and the trigger with the tripwire fixture
  (about 0.5) — 9.5–13.5, stated as 10–14. Rulings 7 and 10 do not add to the
  research's sizes: its table already sizes the calc-parameter walk,
  sustainability's grouping by an ancestor and the reports change at M each.
  The row's effort is edited at closure, per #778.
- **Access widens by design.** Every location grant becomes a subtree grant the
  moment a node gains a child. The tripwire is the announcement ADR 0018 asked
  for, re-pointed to prove the widening stops at the subtree.
- **Retiring a campus takes several clicks**, leaf-first (decision 5).
- **History reads the current tree** (decision 8). A site moved from campus A
  to campus B reports under B for last year too.
- **The client's list becomes data.** When `C22a` is answered, an administrator
  enters the nodes; no release is needed.
- **Owed after the build, not here:** the two raised rows; the `F2.10` row's
  title, effort and closure; the §5 *Hierarchy extension* ⚠ row; and a
  separate `chore(agents):` sweep (§9.10) for `AGENTS.md` §2's *Master data*
  row, which still reads "Organization → Location → RTU → Asset".

## Verification owed

- **Database.** The cold start (init, roles, migrate, seed on a scratch DB)
  proves `0103` and the seeds agree, and a second apply exits 0; a cross-org
  parent edge fails with SQLSTATE `23503` on the composite FK's name, as
  `bms_tenant` and as `fleetDb`; the trigger refuses a cycle, a depth of 9 and
  each of decision 5's four cases when the service is bypassed, as
  `bms_tenant` in a tenant context and as `fleetDb` with none; the trigger
  raises under `REPEATABLE READ`; the function is not `SECURITY DEFINER`.
- **API.** The re-pointed tripwire (*Security*), including the
  replica-mode planted-edge case; each refusal reason; a move or a create by a
  `location_admin` is 403, including a `location_admin` that manages both
  parents and one that moves a root under its own node; a move writes
  `master.location.move` with both parents; `/auth/me` never returns an
  unreadable parent's id.
- **Onboarding.** One `matchLocationType` spec per seeded code, with a
  false-match case (*Drafter choices* 4).
- **Consumers.** A schedule saved on a campus includes a site added after it;
  a campus tariff resolves for a site with no row of its own and loses to the
  site's own row; health and `by_location` over a campus cover its subtree.
- **Browser.** The parent picker, the tree picker and the map filter.
