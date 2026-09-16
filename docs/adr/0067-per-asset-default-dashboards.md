# ADR 0067 — Per-asset default dashboards instantiated from an asset template

## Status

Accepted — drafted and ruled 2026-09-16 under `F3.2`. The three gate
questions (§"Gate questions") were put to the owner one at a time, in order,
before any implementation code (AGENTS.md §10, `backlog-cycle` step 2), and
each was ruled **as recommended**. Six further rulings were taken by the
drafting agent as routine calls and are listed in §"Ruled here without a
question" so the owner can overturn any of them at the plan gate.

## Context

`F3.2` (Track C, Wave 2, P1, *"Per-asset-type default dashboards from
template"*, `Depends: F2.1, F3.1`) is the row every template ADR since 0015
has pointed at and none has built:

- [ADR 0015](0015-asset-template-schema.md) made `asset_type` *"the axis
  `F3.2` groups by"*.
- [ADR 0019](0019-template-content-model.md) decision 5 gave templates a
  `content.dashboards` key of ordered point keys and said, under *"Not decided
  here"*: *"Whether a template's `widgets[]` should ever materialise into
  `bms.dashboard_widgets` rows for an instantiated asset. That is `F3.2`, it
  needs its own gate."*
- [ADR 0047](0047-configurable-dashboards.md) decision 6 declined to fold it
  into `F3.1e`: *"it would … spend `F3.2`'s own §10 gate inside this one."*
  Amendment 3 then discharged the one obligation `F3.2` inherited — every arm
  of `templateDashboardWidgetVariants` reads `WIDGET_POINT_CARDINALITY[type]`
  on `main` since `898b816`.
- [ADR 0048](0048-dashboard-metric-catalog-and-table-widget.md),
  [ADR 0049](0049-section-dashboard-templates.md) and
  [ADR 0052](0052-stock-asset-template-catalog.md) each name `F3.2` as the
  owner of *"instantiating a template dashboard into `bms.dashboard_widgets`"*.

Both dependencies are `✅` (`F2.1` 2026-08-05, `F3.1` 2026-08-30). This is
the gate those five records reserved. Seven things are true of the repository
today, each read from source on 2026-09-16.

**1. A template dashboard is fully authored and has no consumer.**
`asset_templates.content.dashboards` is a record of up to 20 named views
(`MAX_DASHBOARD_VIEWS`), each carrying `featured: pointKey[]` (1–50, required)
and `widgets?: TemplateDashboardWidget[]` (≤ `MAX_DASHBOARD_WIDGETS` = 40).
A template widget carries its own `gridX/gridY/gridW/gridH`, one of the four
ADR 0047 types, `pointKeys` bounded per type, and the renderer's `config`. It
carries **point keys only** — no metric-catalog source (ADR 0048), so every
binding resolves against one asset's `asset_points`. `F3.1e` ships the
authoring tab. Nothing on `main` reads the key back: not the viewer, not the
asset pages, not the seed.

**2. `bms.dashboards` has three scopes and no asset scope.** `location_id`
and `asset_group_id`, at most one non-null under `dashboards_scope_check`
(migration `0050`); both null is organization-wide. `template_id` (migration
`0056`, ADR 0049 decision 2) stamps the *section* template version an
instance came from. The two Zod bodies in `dashboards.schema.ts`, the DTOs in
`packages/shared/src/contracts/dashboard-builder.ts`, `canManageDashboard` /
`resolveScopeTarget` in `access-control.service.ts`, and `DashboardsService.update`'s
singularity guard all enumerate exactly those two columns.

**3. The instantiation precedent exists and is one file.**
`DashboardTemplatesInstantiateService` (ADR 0049, `F3.36`) turns a published
section template into one `dashboards` row, its `dashboard_widgets`, their
`dashboard_widget_points` and `dashboard_widget_sources`, in one `withTenant`
transaction, stamps `template_id`, maps a slug-unique violation to a 409 that
names the slug, and returns a per-widget resolution report (`bound` /
`truncated` / `partial` / `unresolved`, Amendment 2). Its `planWidget`
resolves *asset-group role + point key*; the per-asset case is the same shape
with one asset and no role.

**4. Asset instantiation already deploys template content.**
`AssetTemplateInstantiationService.instantiate` writes `assets`,
`asset_points` and — since ADR 0058 (`E2.4`) — one `automation_rules` row per
template alarm, *inside the same transaction* (decision 9), and reports what it
seeded on `InstantiatedAssetDto.seededRules` (decision 10). ADR 0019's
standing rule — *"deploying template content into running objects is someone
else's ADR"* — has one precedent for how that ADR looks.

**5. `assets.location_id` is `NOT NULL`.** An asset-scoped dashboard
therefore implies a location transitively, the same way an asset-group scope
does — the fact `dashboards_scope_check`'s docblock gives as its reason.

**6. There is no authored content to instantiate.** All 27 stock asset
templates in `apps/api/src/admin/asset-templates/stock-catalog/` omit
`dashboards` (27 non-spec modules, one `stockVersion:` literal each — the first
draft of this ADR said 34, having counted spec and type files too; corrected
before the plan was written); `docs/plans/f2.12-electrical-class-templates.md` says so in
words (*"No `content.dashboards` key on any entry. A dashboard is that row's
shape to choose"*), and `E5.1` fenced dashboards out under ADR 0040 decision
8. No seed carries a view. On a seeded stack `F3.2`'s mechanism would have
nothing to act on.

**7. `F3.2` is not a §6 item.** AGENTS.md §6's configurable-dashboards
closure says of `F3.2`, `F3.28` and `F3.32`: *"Three of those are not §6 items
and must not become ones."* This ADR promotes nothing out of §6; it gates a
schema change (§10) and the deployment of template content (ADR 0019).

## Gate questions

Put to the owner one at a time, 2026-09-16, each with the recommendation
first.

**Q1 — Shape: materialise rows, a virtual view, or both?** Ruled
**materialise rows**. A virtual `DashboardDto` built at read time from the
pinned template version and the asset's points would need no migration and
would follow a re-pin automatically, but it is not editable, has no slug, no
list entry, and opens a second data path beside the row-based one the builder,
viewer, widget-data endpoint and access checks all consume. The hybrid needs
both. Five ADRs already record materialisation as `F3.2`'s shape.

**Q2 — Trigger: at asset creation, on demand, or both?** Ruled **both**.
Inside the asset-instantiation transaction (ADR 0058 decision 9's pattern), so
the promise of a default is kept automatically; plus an on-demand backfill on
the template, so assets created before this ADR — every asset on the seeded
stack — get one. Idempotent: an asset already carrying a dashboard stamped
from *any* version of the template code is skipped and reported.

**Q3 — Content: does `F3.2` author stock views?** Ruled **one `overview`
view per stock class, in `F3.2`**. All 27 entries gain a view built from the
points each already declares, so the §4.6 browser pass has a real asset
dashboard to verify. Effort `3–4` → `5–6`, and the increment is this ruling.
`F3.45` edits the same catalog files, so the two rows are **not
parallel-safe**.

Three more, raised by the step-3 plan (`docs/plans/f3.2-per-asset-default-dashboards.md`
§12) and put to the owner the same day, each ruled **as recommended**:

**Q4 — The Asset badge's code.** Decision 7 promised the asset code on the
badge and decision 2 added no field to carry it. Ruled: `dashboardSummaryDto`
gains `assetCode: string | null`, filled by a left join on `assets` in the list
query; the badge reads `Asset · <code>`. The full `dashboardDto` does not gain
it — the viewer has the asset id and no badge.

**Q5 — Where `dashboardCount` appears.** The instantiate dialog closes on
success today and renders no result, so `ruleCount` (ADR 0058 decision 10) has
never reached a screen. Ruled: on success the dialog stays open and shows one
summary sentence — *"Built 2 assets · 8 points · 3 rules · 2 dashboards"* —
with a Close button. A toast was declined: it cannot be asserted in the
browser layer and vanishes before an operator reads a count.

**Q6 — `stockVersion`.** ADR 0052 decision 6 makes a stock content change a
release. Ruled: **no bump** for the 27 entries in this row; an organization
that imported a class before `F3.2` keeps its copy without a view, and a later
content release bumps every version at once. Recorded as a residual in the
closure.

**Q7 — The backfill on a large estate** (raised by the step-6 code review,
2026-09-17). The batch bound of decision 3 (8,000 widget rows per call)
made `POST …/default-dashboards` a dead end for an organization with more
pinned assets than one transaction may hold — 889 on the stock `overview`
view — and the route takes no batch size to split. Ruled: **chunked,
resumable**. The backfill processes assets in code order in chunks that fit
the bound, one transaction per chunk, stops at the first failure, and
reports what each chunk created; a re-run skips the stamped assets, so the
skip set is what makes it resumable. Decision 4's "one transaction" now
reads per chunk. The asset-creation trigger is unchanged: one transaction,
refused by the bound when the batch does not fit.

## Decision

### 1. `bms.dashboards` gains an asset scope and an asset-template stamp (migration `0073`)

Two nullable columns:

- `asset_id uuid REFERENCES bms.assets(id) ON DELETE CASCADE`. **Cascade,
  unlike `template_id`.** A section-template instance outlives its template
  (the stamp is provenance, and a delete that would orphan it must fail
  loudly). A per-asset default dashboard is *about* one asset and has no
  meaning without it; keeping it after the asset is gone would leave a
  dashboard whose every binding cascaded away already
  (`dashboard_widget_points.point_id … ON DELETE CASCADE`).
- `asset_template_id uuid REFERENCES bms.asset_templates(id)`, no `ON DELETE`,
  mirroring `template_id` exactly: it points at the **version row** whose
  identity is `(organization_id, code, version)`, so there is no second
  `asset_template_version` column (ADR 0049 decision 2's reasoning, verbatim).

Three constraints:

- `dashboards_scope_check` is **replaced**: at most one of `location_id`,
  `asset_group_id`, `asset_id` is non-null. Written as a count of non-nulls
  `<= 1`, not as three pairwise `NOT (a AND b)` clauses, so a fourth scope is
  one more term rather than three more clauses.
- `dashboards_template_stamp_check`: `NOT (template_id IS NOT NULL AND
  asset_template_id IS NOT NULL)`. A dashboard came from one template or none.
- `dashboards_asset_stamp_check`: `asset_template_id IS NULL OR asset_id IS
  NOT NULL`. A stamp without an asset describes nothing.

`tenant_isolation` on `bms.dashboards` is **re-created to check both new
parents**, exactly as migration `0056` did for `template_id` and for the
reason `0050`'s security review proved on the running stack: Postgres runs
referential-integrity checks with row security off, so a foreign key never
consults the parent's policy, and an unchecked `asset_id` would let a tenant
stamp its dashboard with another organization's asset.

The drizzle schema in `packages/db/src/schema/dashboard-schema.ts` gains the
two columns with docblocks that say the above. `migration-reviewer` is owed a
pass.

### 2. The asset scope is a fourth arm everywhere the other three are enumerated, and nothing else

- **Contract** (`packages/shared/src/contracts/dashboard-builder.ts`, ADR 0030):
  `dashboardSummaryDto` and `dashboardDto` gain `assetId: uuid | null` and
  `assetTemplateId: uuid | null`; `dashboardSummaryDto` alone also gains
  `assetCode: string | null` (Q4). The OpenAPI document changes with it.
- **Bodies** (`apps/api/src/dashboard-builder/dashboards.schema.ts`):
  `create` and `update` accept `assetId: uuid | null | undefined`;
  `scopeIsSingular` counts three; `SCOPE_REFUSAL_MESSAGE` names three.
  `DashboardsService.update`'s stored-versus-next singularity guard reads three
  columns. `assetTemplateId` is **not** writable through these bodies — only
  decision 3 sets it, as only the ADR 0049 service sets `templateId`.
- **Authorization** (`access-control.service.ts`): `resolveScopeTarget` gains
  `{ kind: "asset", id }`. `canManageDashboard`'s asset arm: `admin` and
  `organization_admin` as today; a `location_admin` manages an asset-scoped
  dashboard when `canManageLocation(assets.location_id)` holds and the asset
  belongs to the organization; an `asset_group_admin` manages it when the asset
  is a member of a group the user holds in `user_asset_group_access` and the
  group belongs to the organization. Both checks go through the asset row, so
  the "does this id belong to this organization" half of ADR 0047 Amendment
  2's scope check is an explicit predicate on `assets.organization_id`, never
  left to RLS (the `dashboard-point-scope.ts` lesson).
- **Read visibility is not narrowed.** ADR 0047 Amendment 2's rule stands: a
  scoped user sees every dashboard of their organization the list returns,
  asset-scoped ones included. Narrowing reads by asset would be a new rule
  with no row asking for it.
- **No new binding restriction.** A widget on an asset-scoped dashboard may
  bind any point of the organization, as a widget on a location-scoped
  dashboard may today. *Declined:* "bindings must belong to the scoped asset".
  A feeder's default dashboard that shows the incomer's kW beside its own is
  the ordinary case in the client's reference layouts, and the instantiator
  (decision 3) only ever binds the asset's own points, so the restriction
  would constrain hand edits alone. The organization guard in
  `dashboard-point-scope.ts` is untouched and remains the control.

### 3. `AssetDashboardsInstantiateService` materialises every view of the pinned version

A new file, `apps/api/src/admin/asset-templates/asset-dashboards-instantiate.service.ts`,
sibling to the ADR 0049 service and shaped on it. Given one asset, its
published template version row, and a transaction:

- **One `dashboards` row per view** in `content.dashboards`, in code-point
  order of the view name. *(The first draft said "record order". Task 6 found
  that `asset_templates.content` is `jsonb`, which does not keep key order —
  the fixture came back `trends, overview` — so record order is not a property
  the store has. Corrected 2026-09-16 before merge; the sort is documented in
  the service.)*
  `organization_id` the asset's; `asset_id` the asset; `asset_template_id`
  the version row; `location_id`, `asset_group_id`, `template_id` NULL.
  `name = "<asset.name> · <viewName>"`, truncated to 255.
- **`slug = <slug(asset.code)>-<slug(viewName)>`**, lower-cased to
  `[a-z0-9-]`, and when the result exceeds 64 characters it is cut and
  **hash-suffixed** exactly as ADR 0058 decision 7 derives rule codes — a cut
  alone is not unique and `slice()` splits surrogates. `assets.code` is
  globally unique and the view name is unique within a template, so the slug
  is deterministic and collides only with a hand-made dashboard. A collision
  is the ADR 0049 service's 409 naming the slug, and **the whole call fails**
  — one transaction, no partial batch (the `F2.2` rule, ADR 0015 §6).
- **Widgets copy their own layout.** `gridX/gridY/gridW/gridH`, `widgetType`,
  `config` and `title` — the fields `templateWidgetIdentityFields` already
  carries — transfer verbatim; `dashboard_widgets_grid_bounds_check` and the template schema's
  12-column refinement already agree, so no re-layout is needed or done.
- **Point keys resolve against the asset's own `asset_points`**, active rows
  only, by `(asset_id, point_key)`. A key with no active point is **a widget
  with fewer bindings, reported, never a refused instantiation** — ADR 0049
  decision 6 and Amendment 2's outcomes (`bound` / `truncated` / `partial` /
  `unresolved`), reused as the same DTO shape; `truncated` is what a 50-key
  `featured` list produces under the next bullet. A published template already guarantees every
  key names a `template_points` row (ADR 0019 decision 6); the gap this covers
  is an optional measured point whose source pattern did not resolve
  (`InstantiatedAssetDto.skippedPoints`), and a dashboard that instantiates
  with a hole beside a report of the hole is better than a plant with no
  dashboard.
- **A view with no `widgets[]` instantiates its `featured` keys as
  `value_tile`s**, 3 columns wide by 2 rows tall, four per grid row, in
  `featured` order, capped at `MAX_DASHBOARD_WIDGETS` (40) — so a 50-key
  `featured` list instantiates its first 40 and the view's report carries the
  omitted count as `omittedFeatured` (decision 5). `featured` exists precisely as *"what a
  consumer with no widget support"* renders (the schema's own docblock); this
  is that consumer.
- **No `dashboard_widget_sources` rows.** A template widget has no
  metric-catalog source to copy (Context 1).

### 4. Two triggers, one service

- **At asset creation.** `AssetTemplateInstantiationService.instantiate`
  calls decision 3 for every created asset **inside its existing `withTenant`
  transaction, after the rule seed** (ADR 0058 decision 9's position and
  reasoning: a dashboard written outside the transaction could survive a
  rolled-back batch). `assertBatchFits` gains the dashboard term: `assets ×
  views × widgets` rows join the bound it already computes for rules.
- **On demand.** `POST /admin/asset-templates/:id/default-dashboards`, `201`.
  `:id` is a **published** version (a draft is refused with ADR 0039's
  `draftRequiredMessage` shape, as `:id/instantiate` refuses one). The service
  selects every **active** asset of the organization whose `template_id` is
  **any version of this template code** — a plant pinned to v1 still deserves v2's
  layout when the administrator asks for it — and **skips an asset that
  already carries a dashboard with `asset_template_id` in that version set**,
  reporting it `skipped_existing`. The rest instantiate from `:id` in
  chunks that fit decision 3's bound, one transaction per chunk, in asset
  code order; the first failing chunk stops the call and the response
  reports what the earlier chunks created (Q7). Permission is `AssetTemplatesAdminService.assertCanAuthor`
  (organization-level, `location_admin` excluded per ADR 0015 §7): the
  backfill writes across every location of the organization, which is not a
  location admin's scope. Declared as a two-segment `@Post(":id/…")`, below
  `@Post("stock/:code/import")`, so the controller's route-order assertion
  holds unchanged.

### 5. Both paths report what they wrote (ADR 0058 decision 10's pattern)

- `instantiatedAssetDto` gains `dashboards: InstantiatedDashboardDto[]` —
  `{ slug, view, widgetCount, boundPoints, omittedFeatured, resolutions }` per
  view, where `resolutions` is ADR 0049's `templateWidgetResolutionDto[]`,
  imported rather than restated. That DTO requires a `widgetKey` and a template
  widget has none, so the key is `"<view>#<index>"`, with `assetRoleCodes: []`
  and `matchedMembers: 1` (one asset, no role). A widget never has more
  candidates than keys for one asset, so its outcome is `bound`, `partial` or
  `unresolved`; the view-level cut of decision 3's featured fallback is
  `omittedFeatured`, not a per-widget `truncated`. (Plan §12 Q2–Q3, ruled as
  recommended.) `assetInstantiationResultDto` gains `dashboardCount`.
- `POST …/default-dashboards` returns `defaultDashboardsBackfillResultDto`:
  `{ templateId, templateCode, templateVersion, assets: [{ assetId, code,
  outcome: "created" | "skipped_existing", dashboards }], createdCount,
  skippedCount }`. Every DTO is a Zod schema in `packages/shared` first (ADR
  0030).

### 6. The stock catalog gains one `overview` view per class

Each of the 27 entries under `stock-catalog/` gains `content.dashboards.overview`:
`featured` lists the class's headline points in reading order, and `widgets[]`
lays out value tiles for them plus one `chart` on the class's primary trend,
inside the 12-column grid, using only points that entry already declares. The
content schema's reference validation (ADR 0019 decision 6) and
`tests/f3.38-stock-catalog-vocabulary.test.ts`'s parse of every entry are the
gate: an authored key that names no declared point fails the suite. Which
points are "headline" is the implementer's call per class from each entry's
existing docblocks; it is content, not contract, and a later content row may
revise it without touching this ADR. `stockVersion` is **not** bumped (Q6).
Only measured, non-manual keys are bound: a derived key has no `asset_points`
row at instantiation and a manual point is always skipped, so either would
instantiate as a hole by construction.

### 7. The UI is the smallest surface that makes the rows reachable

None of the three surfaces has a mockup analogue in `ESKOM_SMOC.html` or
`TRINETRA.html`: each is an addition to a page that already exists, in that
page's own components (`SectionCard`, `PageHeader`, the scope badge cell),
so §5's reference obligation is met by the host page, not by a new route.

- `/dashboards` (`dashboards-page.tsx`) renders an **Asset** scope badge with
  the asset code beside the existing location / asset-group badges; the viewer
  renders an asset-scoped row unchanged.
- The asset-template detail page (`asset-template-detail-page.tsx`) gains a
  **Create default dashboards** action on a published version, calling
  decision 4's route and rendering decision 5's report. ADR 0058 decision 8
  gave the API a seeded-rules re-apply route and **no web surface** (nothing
  under `apps/web/src` names it), so this is the first template-page action
  of its kind and sets the shape a later re-apply button reuses.
- The instantiate dialog stays open on success and shows one summary sentence
  carrying asset, point, rule and dashboard counts, with a Close button (Q5).
  This is the first surface `ruleCount` reaches.
- **Declined:** an asset picker in the builder's scope fields
  (`dashboard-scope-fields.tsx`). The API accepts `assetId` on create (decision
  2) so the contract is complete, but no row asks a human to hand-build an
  asset-scoped dashboard, and the operator-facing asset browser that would
  link an asset to its dashboards is `F3.31`, which depends on this row.

### 8. What this ADR does not decide

- **Version drift.** A republished template leaves existing default
  dashboards on their stamp (ADR 0049 decision 2's rule). "Upgrade this
  asset's dashboards to v2" and "a re-pin (`:id/migrate`) moves the
  dashboards" are one later row, not this one; the stamp is what makes that
  row possible.
- **Deleting default dashboards when an asset is re-pinned or a template is
  archived.** Nothing here removes a dashboard except the asset cascade.
- **Per-asset-type dashboards for assets with no template**
  (`assets.template_id IS NULL`). They have no content to instantiate from.
- The dark canvas (`docs/BACKLOG.md` §5 *Reference layout language*) — the
  rows render in the existing light palette, as every `F3.1x` row did.

## Ruled here without a question

Routine calls the drafting agent took so the plan can start; each is one line
to overturn at the plan gate.

1. `asset_id` cascades on asset delete; `asset_template_id` does not (decision 1).
2. A view without `widgets[]` materialises as value tiles, 3×2, four per row, capped at 40 (decision 3).
3. A slug collision fails the whole call with a 409, in both triggers (decision 3).
4. The backfill selects assets pinned to *any* version of the code and requires template-author permission (decision 4).
5. No binding restriction on an asset-scoped dashboard; read visibility not narrowed (decision 2).
6. No asset picker in the builder; the template page carries the action (decision 7).

## Dependencies

None. No new npm package; `slugify` is a local helper on the pattern ADR 0058
decision 7 already ships for rule codes.

## Consequences

- **`F3.2` moves `⬜` → `🟡`**, effort `3–4` → `5–6` (Q3). It touches
  `packages/db` (migration `0073`, schema), `packages/shared` (contracts),
  `apps/api` (`dashboard-builder/`, `admin/asset-templates/`, `auth/`) and
  `apps/web` (three files). Four reviewers at close: `code-reviewer`,
  `security-reviewer`, `agents-compliance-reviewer`, `migration-reviewer`.
- **`F3.45` and `F3.2` are serialised** on `stock-catalog/*.ts` (Q3). Whichever
  lands second rebases.
- **`F3.31` unblocks** when this closes; it is the row that gives an operator a
  path from an asset to these dashboards.
- **The guard this row owes**: an integration test that instantiates one asset
  from a template with two views and asserts two `dashboards` rows, their
  slugs, their stamps, the widget count, and a `partial` resolution for a key
  whose point was skipped; a second that runs the backfill twice and asserts
  the second call creates nothing; a scope test that proves the new
  `dashboards_scope_check` refuses `asset_id` + `location_id` together; and an
  RLS test **as `bms_tenant`** (`bms_fleet` holds `BYPASSRLS`, so a fleet-pool
  test proves nothing about a policy) that proves a foreign `asset_id` is
  refused by the re-created policy — the `0056` lesson, as a test rather than
  a comment.
- **`chore(agents):` sweep owed, separately** (§9.10): AGENTS.md's status
  line and its §2 *Configurable dashboards* row gain this ADR. **No §6 line
  moves** — `F3.2` is not a §6 item (Context 7), and the sweep must not create
  one.
- **`docs/roadmap.md`** mirrors the closure when the row closes, not now.
- **A deactivated asset keeps its default dashboards.** `bms.assets` has no
  hard-delete path in the API (ADR 0009), so decision 1's cascade serves
  test teardown and administrative SQL only; an asset set `active = false`
  stays listed with its dashboards, which remain openable. Hiding or
  removing them on deactivation is out of scope here and belongs with the
  version-drift row decision 8 names.
