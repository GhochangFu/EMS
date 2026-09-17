# ADR 0068 — Operator-facing Assets browser

## Status

Accepted — drafted and ruled 2026-09-17 under `F3.31`. The five gate
questions (§"Gate questions") were put to the owner one at a time, in order,
before any implementation code (AGENTS.md §10, `backlog-cycle` step 2), and
each was ruled **as recommended**. Five further rulings were taken by the
drafting agent as routine calls and are listed in §"Ruled here without a
question" so the owner can overturn any of them at the plan gate.

## Context

`F3.31` (Track C, P2, *"Operator-facing Assets browser"*, `Depends: F3.2`) was
created 2026-08-16 by the §7 comparison against the client reference. The
reference carries **Assets** in its primary navigation beside Alarms and Work
Orders (`ESKOM_SMOC.html` `R.as`, "Asset Registry": ID · Name · Type ·
Protocol · Gateway · Load · Reading · Status · a `Set` command button). Ours
exists only as `/admin/assets` under *Administration* — `assets-page.tsx`
(407 lines) renders inside `MasterDataLayout`, whose tab strip is
`visibleMasterDataTabs(user.role)`, and the route is a **master-data editor**:
create/edit form, RTU attach, points navigation. An operator who wants to find
an asset and see its state cannot reach it at all.

The row itself deferred two scope questions "before it is sized": a new
read-only route or a scoped view of the existing one, and how it relates to
`F3.2`'s per-asset default dashboards. `F3.2` closed 2026-09-17 under
[ADR 0067](0067-per-asset-default-dashboards.md), which twice names this row as
*"the row that gives an operator a path from an asset to these dashboards"*
and declined a builder-side asset picker for that reason (0067 decision 7).

What the code offers today, which is what the decisions below build on:

- `GET /api/v1/assets` (`assets.controller.ts`) — authenticated, scoped by
  `AccessControlService.readableAssetIds`, optional `organizationId`. It
  returns a bare array of `{ id, code, name, siteName, domain }`
  (`assetPickerRowSchema`, `envelopes.ts`) and today serves only the
  alarm-enrichment affected-asset picker (ADR 0034 decision 4) and the
  schematic telemetry context. `AssetsService.listAll` already selects
  `locationId` and joins `locations`; it is unpaginated.
- `GET /api/v1/asset-health/assets/:assetId` and `GET /asset-health/summary`
  (ADR 0050, `E1.3`) — one asset's score and band, and the estate donut.
  There is **no batched per-asset band read**; `summary()` scores per asset
  internally and aggregates before answering.
- `GET /api/v1/dashboards` — `listDashboardsQuerySchema` accepts
  `organizationId` only. Since ADR 0067 the summary DTO carries `assetId`,
  `assetTemplateId` and `assetCode`, and `/dashboards/:slug` is the viewer.
- `bms.assets` carries `rtu_id`, `active`, `domain` and `meta.telemetrySource`
  (`"mqtt" | "catalog"`, written by every `rtu_id` writer since `F4.139` /
  `F4.140`; a pre-`F4.139` row can lack it).

**One collision had to be raised before anything else.** The §5 entry
*Domain-first navigation IA* (open, gates `F3.29`) enumerates the same
reference sidebar this row's first sentence quotes — *"… Alarms · Work Orders ·
Assets · Analytics …"*. Placing a top-level Assets entry is part of that
decision, and `F3.31` cannot make it alone. Q1 below is the owner's ruling on
how the two relate.

## Gate questions

Put to the owner one at a time, in this order. Each carried a recommendation
and each was ruled as recommended.

**Q1 — Navigation placement vs. the open IA decision.** Add Assets under an
existing function group now and accept that it moves when the IA lands; or
block `F3.31` on the §5 question; or rule the IA question first. **Ruled:
add it under *Operations* now.** The entry moves when the IA decision lands,
and that move is the IA row's work, not a regression of this one.

**Q2 — New read-only route, or a scoped view of `/admin/assets`.** **Ruled: a
new read-only route (`/asset-browser`, ruling 8).** The existing page is an editor whose chrome
and access predicate are both master-data-shaped; a read-only mode bolted on
would still render inside `MasterDataLayout` and still need the tab strip's
predicate opened.

**Q3 — What the list reads (the sizing driver).** Extend `GET /assets` with
static columns and load health on the detail panel; or add a batched per-asset
health read so every row shows a band; or leave the list as it is. **Ruled:
extend the list with static columns; health stays per asset on the detail
panel.** No N+1 on the list, and the effort stays `3–4`. The batched read is
named below as the thing this ADR does not decide.

**Q4 — How the detail panel finds the asset's `F3.2` dashboards.** Add
`assetId` to `listDashboardsQuerySchema`, or filter client-side over the full
readable list. **Ruled: `assetId` on the query.** The full list grows with
every instantiated asset (27 stock classes × one view each, per asset).

**Q5 — Who can open the route.** Every authenticated user within
`readableAssetIds`, or operations roles only. **Ruled: every authenticated
user, within `readableAssetIds`** — the gate `GET /assets` and
`GET /asset-health/summary` already apply.

## Decision

### 1. A new route `/asset-browser` in `apps/web`, outside `MasterDataLayout`

`apps/web/src/pages/assets-page.tsx` (new), routed at `/asset-browser` in `app.tsx`
with the same `accessToken && user` guard every operator route uses, rendered
in `AppShell` directly. `moduleGroups` in `app-shell.tsx` gains
`{ label: "Assets", path: "/asset-browser" }` in the **Operations** group (Q1). The
`/admin/assets` editor and its nav entry are untouched.

The page is a **table with client-side filters** over the one list response:
a text filter on code and name, a domain filter fed by
`GET /vocabularies` (`assetDomains`, `F4.45`), and a site filter over
`siteName`. Columns, in order: Code · Name · Site · Domain · RTU · Source ·
Active. Clicking a row opens the detail panel (decision 3). The list is
unpaginated because `listAll` is unpaginated and the picker already bears that
cost on the same response; pagination is not decided here.

### 2. `GET /api/v1/assets` gains six columns; the contract is renamed

`AssetsService.listAll` adds one `LEFT JOIN bms.rtus` and selects
`locationName` (`locations.name`), `rtuId`, `rtuDisplayName`
(`rtus.display_name`), `telemetrySource`, `active` and `templateId`. The response stays a
bare array and the route, guard and `organizationId` filter are unchanged.

The join carries an organization predicate —
`rtus.organization_id = assets.organization_id` — not only the FK (ruling 7).
The read runs on the fleet pool, which bypasses RLS, and `assets_rtu_id_fk` is
a plain FK to `rtus(id)`; only `assertRtuLocation` at write time keeps an
asset's RTU inside its organization. A mis-stamped `rtu_id` therefore reports
`rtuDisplayName: null`, never a foreign organization's name. The same shape as
`dashboards.service.ts`'s `assets` join (ADR 0043).

`assetPickerRowSchema` / `assetPickerResponseSchema` (`envelopes.ts`) are
**renamed** `assetListRowSchema` / `assetListResponseSchema` and widened —
the old name said "which of the several asset shapes it is", and after this
ADR the picker is one consumer of a wider row rather than the owner of it.
The new fields:

```ts
locationId: z.string().uuid(),
locationName: z.string(),
rtuId: z.string().uuid().nullable(),
rtuDisplayName: z.string().nullable(),
// What `meta.telemetrySource` holds — reported, never derived. A row written
// before `F4.139` can lack it; the browser shows "—", not a guess.
telemetrySource: z.string().nullable(),
active: z.boolean(),
// Plan-gate ruling (2026-09-17): decision 3 reads it and the panel makes no
// second fetch, so the list row carries it. The column is on `bms.assets`.
templateId: z.string().uuid().nullable(),
```

`telemetrySource` is `z.string().nullable()` rather than
`z.enum(["mqtt", "catalog"])` for the reason `storedSource` in
`admin/assets/assets.service.ts` gives: the bag can hold anything a hand edit
or an older release wrote, and a list read reports what is there. The
hand-written `AssetRow` type in `apps/web/src/api/assets.ts` becomes the
inferred type of the new schema and keeps its name; its six importers
(`asset-picker.ts` and its spec, `schematic-access.ts`,
`maintenance-schedules-panel.tsx`, `location-dashboard-page.tsx`) read only
the fields they read today, so none changes — except the picker spec's
fixture literals, which gain the new fields by hand (no gate type-checks that
file).

### 3. The detail panel is three existing reads and one new filter

`apps/web/src/components/assets/asset-detail-panel.tsx` (new), opened from a
row, shows for one asset:

- the row's own columns (no second fetch);
- **health** — `GET /asset-health/assets/:assetId` through the existing
  `fetchAssetHealth` client: score, band, and the scored/unscored tag counts,
  with the three absence states ADR 0050 names rendered as text rather than
  as a zero;
- **default dashboards** — `GET /dashboards?assetId=<id>`, each row a link to
  `/dashboards/<slug>?organizationId=<id>` with its `name` and `widgetCount`
  (the query rides on the link as it does on the dashboards page: on the fleet
  pool one slug can live in two organizations, and the viewer disambiguates by
  it — `dashboards.schema.ts` D5); an empty list reads
  "No dashboards for this asset" and, when `templateId` is null on the asset,
  the sentence says why (a hand-created asset has no template to instantiate
  from).

The panel is **read-only**. It carries no edit affordance, no RTU attach, no
points link into `/admin`, and no image upload; the `AssetImagesPanel` that
`/admin/assets` renders is not reused here (§8).

### 4. `listDashboardsQuerySchema` gains `assetId`

```ts
export const listDashboardsQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
});
```

`DashboardsService.list` pushes `eq(dashboards.assetId, assetId)` beside the
existing organization conditions. The read scope is unchanged — the filter
narrows within `readableOrganizationIds` and cannot widen it, so an `assetId`
outside the caller's scope answers an empty list, not a 403 (the same shape
`asset-health/summary` gives `locationId`, and for the same reason: a 403
would confirm the id exists). The web client `fetchDashboards` gains the
optional argument.

### 5. Access is authentication plus `readableAssetIds`, nothing narrower

No new predicate in `admin-access.ts`, no new API check. `GET /assets`,
`GET /asset-health/assets/:id` (`canReadAsset`) and `GET /dashboards`
(`readableOrganizationIds`) already scope every read the page makes. A
`viewer` sees the assets in scope, which is what the row asks for.

### 6. Excluded by name: the reference's `Set` command

The mockup's Asset Registry carries a per-row **Set** button that dispatches a
setpoint to the asset's gateway "with two-phase commit … reason text … logged
to immutable audit trail". That is a control write path with no ADR, no
backlog row and no adapter-side write in the ADR 0016 framework, which ingests
and never commands. This ADR builds a **read** surface and names the exclusion
so the mockup is not read back as implied scope.

### 7. Effort stays `3–4`

Q3 was the sizing driver and its ruling keeps the API change to one join, one
query key and one renamed contract. `packages/shared` (`envelopes.ts`, the
dashboards query type), `apps/api` (`assets/assets.service.ts`,
`dashboard-builder/dashboards.schema.ts` + `dashboards.service.ts`) and
`apps/web` (one page, one panel, one nav entry, two client files). No
`packages/db` change.

### 8. What this ADR does not decide

- **A batched per-asset health read** (`GET /asset-health/assets?ids=…` or a
  band column on the list). Q3 declined it for this row; if the list needs a
  band per row later, that is a new read that exposes what `summary()` scores
  internally, and it needs its own contract decision.
- **Pagination or server-side search on `GET /assets`.** The picker and the
  browser share one unpaginated response today. The first estate where that
  is slow sizes the change.
- **Alarms on the detail panel.** `GET /alarms` has no `assetId` filter and
  this ADR adds none; "this asset's active alarms" is a different read with a
  different cursor.
- **Asset images on the panel.** `/assets/:assetId/images` is already
  `canReadAsset`-gated (ADR 0066), so a read-only gallery is cheap, but
  `AssetImagesPanel` is an upload surface and splitting it is `F3.4`'s
  territory, not this row's.
- **Where "Assets" finally lives in the sidebar.** Q1 placed it under
  *Operations* and the §5 *Domain-first navigation IA* decision moves it.
- **The mockup's Load / Reading columns.** Both are live telemetry per asset
  and belong to the same batched read as the band.

## Ruled at the plan gate

6. `templateId` joins the list row (decision 2). The step-3 plan found that
   decision 3 reads it while decision 2 did not carry it; the owner ruled the
   field in rather than dropping the sentence (2026-09-17).
7. The `rtus` join carries `rtus.organization_id = assets.organization_id`
   (decision 2). The step-5 security review found the fleet-pool read trusted a
   plain FK; G3 (`assets.service.rtu-organization.integration.spec.ts`) writes a
   foreign stamp inside a rolled-back transaction and asserts the name is null
   (2026-09-17).
8. The route is `/asset-browser`, not `/assets` (decision 1). The §4.6
   browser pass found that Vite emits the bundle under `dist/assets/`, so on
   the nginx image `GET /assets` is a real directory: 301 → `/assets/` (the
   port dropped) → 403, and `try_files` never reaches `index.html`. No cheaper
   gate could see it — the jsdom router does not go through nginx. R4 in
   `tests/f3.31-assets-browser-reachable.test.ts` keeps every later route off
   `build.assetsDir` (2026-09-17).

## Ruled here without a question

Routine calls the drafting agent took so the plan can start; each is one line
to overturn at the plan gate.

1. The nav entry sits after *Dashboards* in the Operations group; the label is
   "Assets", not the mockup's "All Assets" (decision 1).
2. `assetPickerRowSchema` is renamed rather than aliased; both importers
   change in the same commit (decision 2).
3. `telemetrySource` is `z.string().nullable()`, reported not derived
   (decision 2).
4. An out-of-scope `assetId` on `GET /dashboards` answers `[]`, not 403
   (decision 4).
5. The panel is a side panel on the same route, not a `/asset-browser/:id` route —
   nothing deep-links to one asset today, and a route can be added when
   something does (decision 3).

## Dependencies

None. No new npm package.

## Consequences

- **`F3.31` moves `⬜` → `🟡`**, effort `3–4` unchanged (decision 7). Wave stays
  `—` as the row was created; the owner may set it at the plan gate.
- **Not a §6 promotion.** AGENTS.md §6 names no operator asset browser; the
  `chore(agents):` sweep at close touches the status line and §2 only, and
  lands as its own PR (§9.10).
- **A rename in `packages/shared`** (`assetPickerRowSchema` →
  `assetListRowSchema`) reaches three files by name: `envelopes.ts`,
  `packages/shared/src/index.ts` and `apps/web/src/api/assets.ts`. Nothing in
  `apps/api` imports it.
- **`F3.29`** (shell chrome parity) and the §5 IA decision now have a concrete
  entry to move; neither is unblocked by this ADR.
- **No collision with `F3.45`** — this row touches nothing under
  `stock-catalog/*.ts`.
- **The guard this row owes**: an API test that `GET /assets` carries the six
  new fields for a wired asset and nulls for an unwired one, and that a
  location-scoped caller still sees only their scope; an API test that
  `GET /dashboards?assetId=` returns only that asset's rows and `[]` for an
  id outside the caller's scope (as `bms_tenant`, per ADR 0067's rule that a
  fleet-pool test proves nothing about a policy); a jsdom spec for the page
  that a row click opens the panel and the panel's dashboard links carry the
  slug; and a nav spec that "Assets" renders for a `viewer`.
