# ADR 0109 — Calculated points on an asset that has no template

## Status

**Accepted — 2026-11-04** (owner, in chat; the merge of this record is the
acceptance). Raised by `F4.311`. The owner gave eight rulings in chat, one at a
time, before this record was written (listed under *Rulings*).

## Context

A calculated point today exists only through a template. The calc engine
loads its definitions as `assets.template_id → template_points (kind =
'derived') ⟕ asset_points` (`apps/api/src/calc/calc-definitions.service.ts`),
and a `computed` `asset_points` row is only an override of a derived point
that the pinned template version declares
(`asset-point-calc-override.service.ts`, ADR 0039 decisions 6–8). The one path
onto a template, `POST /admin/asset-templates/:id/migrate`, refuses an asset
with no template (`asset-templates-migrate.service.ts`), and `instantiate`
builds new assets.

So an asset built without a template can have no calculated point. All 48
PHE WB assets on the AWS demo are such assets: they came from the PHE catalog
seed and the MQTT ingest set-up (ADR 0007, ADR 0016), not from onboarding
(ADR 0091), and each `PHE-PUMP-*` and gateway asset reports only one to three
points. The owner wants calculated points on them now.

The grammar already covers what such a formula needs: own points `{key}`,
another asset's point `{ASSET_CODE.key}` and scope aggregates
(`bms-calc-v2`, ADR 0055), and `$parameters` (`bms-calc-v3`, ADR 0070). The
`asset_points` table already holds the five calc columns (`formula`,
`formula_dialect`, `calc_trigger`, `calc_interval_seconds`,
`max_input_age_seconds`, migration 0037).

## Rulings (owner, 2026-11-04)

1. **Design: both, per-asset first.** This record decides the per-asset
   calculated point. Adopting an existing asset onto a template version is a
   later amendment of this record.
2. **Grammar: everything a template allows** — `v1`, `v2` (own, qualified and
   aggregate references) and `v3` (`$parameters`, scheduled only), through the
   same validators as the template editor.
3. **Point key: a catalog key only.** The key must exist in `bms.point_keys`;
   a new key is created on the Point keys page first.
4. **Surfaces: the page, the copilot and a bulk action.**
5. **Access: the same as editing the asset's points.** A formula that names
   another asset is refused if that asset is outside the author's scope or
   organization.
6. **History: an optional backfill.**
7. **Backfill depth: up to 31 days.**
8. **Later adoption: the asset's formula stays as its override.** When the
   adopt amendment pins such an asset to a template that declares the same
   derived key, the per-asset row becomes that asset's calc override of the
   template's point, through the override's own gates, and its history
   continues under the same key.

## Decision

1. **A standalone calculated point.** On an asset whose `template_id` is
   NULL, an `asset_points` row with `source_kind = 'computed'`, `rtu_id` NULL
   and a non-NULL `formula` is a calculated point in its own right. On such an
   asset, every one of the five calc columns is required (there is no template
   value to inherit); `formula_dialect`, `calc_trigger`, interval and
   input-age bounds are the template editor's bounds (ADR 0037, ADR 0038). On
   an asset that has a template, nothing changes: a `computed` row is still an
   override, and a standalone row is refused.

2. **The engine reads both sources.** `CalcDefinitionsService` adds a second
   read: `computed` rows of assets with `template_id IS NULL`, mapped through
   the same `toActiveDefinition`, so an unusable stored row is a counted skip
   (ADR 0037 decision 9). The existing template query and its asset-first
   coalesce do not change (`tests/adr-0039-resolution-merge.test.ts` keeps
   gating it). The dependency graph, the streaming and scheduled paths, the
   window and parameter reads are shared, unchanged.

3. **Write rules, before any write.** The key must be a `bms.point_keys` code
   (ruling 3), and on create it must not already exist on the asset as a
   measured, manual or unmapped point. The formula passes the
   template editor's parse and dialect checks, `CalcDependencyService.
   checkCandidate` (no cycle, including through other assets), and the
   qualified-code check of `F2.22` item 9. Every asset a formula names must be
   in the author's write scope and the same organization (ruling 5); the
   refusal names the asset code. `$parameter` keys must exist in the
   vocabulary (ADR 0070 decision 4). The rules live in one service used by the
   three surfaces, so the surfaces cannot differ.

4. **Routes: the override routes, extended, plus one batch route.** The
   calc-override controller already owns `GET`, `PUT` and `DELETE
   /admin/assets/:assetId/calc-points[/:pointKey]` (ADR 0039 decision 8). On an
   asset with no template they serve the standalone point: `GET` lists the
   asset's standalone points; `PUT` creates or replaces one, with all five calc
   fields required; `DELETE` removes it (the point stops computing; its stored
   telemetry stays). On an asset with a template they keep today's override
   meaning, unchanged, and a `PUT` for a key the template does not declare is
   still refused. The response says which kind it served. One new route,
   `POST /admin/calc-points/batch` (ruling 4), writes the same key, formula and
   timing on up to 25 template-less assets of one organization, all or
   nothing: a refusal on one asset writes nothing and names every refused
   asset. Bodies and responses are Zod contracts in `@bms/shared` (ADR 0030).
   Each write is audited as the asset-point writes are. Access is
   `asset-points`' own (ruling 5).

5. **The page.** `/admin/assets/:assetId/points` gains **Add calculated
   point** on an asset with no template: a catalog-key picker, the lazy
   formula editor in its derived mode with the live preview (ADR 0038 decision
   5), the trigger fields, and the backfill choice. The same panel edits and
   deletes. The asset list gains a bulk action for the batch route.

6. **The copilot.** Three catalog entries, each a red Confirm card that calls
   the routes above with the same body: `calcPoint.set` (the `PUT`), `calcPoint.createBatch`
   and `calcPoint.delete`. `calcOverride.set` keeps serving the templated
   case. The model writes no SQL and no write it could not make on the page.
   This amends ADR 0099's catalog (its next amendment records the entries).

7. **Backfill (rulings 6 and 7).** A `PUT` and the batch route accept an optional
   `backfillDays` (1–31). The API stores a run in a new table
   `bms.calc_backfill_runs` (organization, asset point, from, to, status,
   progress, error, actor, timestamps; RLS by organization like its
   neighbours) and enqueues one BullMQ job (ADR 0063) on the worker. The job
   walks the window in the point's own interval, in chunks, reading the
   inputs as stored then, and writes the computed rows with their past
   timestamps through the calc write path; it never overwrites a stored value
   at the same time. After the last chunk it refreshes the continuous
   aggregates over that range, because a write older than their refresh
   window is otherwise never folded in. One active run per point; the page
   shows progress. A stream-triggered point is backfilled at its
   `max_input_age_seconds`-bounded input times.

## Dependencies

None. BullMQ and the worker exist (ADR 0063).

## Consequences

- One migration: `bms.calc_backfill_runs` with its RLS policy and grants
  (ADR 0045 roles). No change to `asset_points`.
- A second definitions read is a second place a calc point can come from; the
  plan names a test that fails if either read is dropped.
- A per-asset formula with `{ASSET_CODE.key}` is tied to asset codes; the
  bulk action suits own-point formulas better, and the page says so.
- A backfill is load on the database; 31 days at the shortest interval is the
  bound the plan sizes the chunks against.
- Deferred to the adopt amendment: pinning an existing asset to a template
  version, and turning a per-asset row into an override (ruling 8).
- `AGENTS.md` is updated in a separate `chore(agents):` PR (§9.10).

## Note — 2026-11-04: backfill on the override PUT too (owner ruling 1)

Recorded with `F4.311` PR 5, from the owner's rulings on the plan's open
questions (`docs/plans/f4.311-per-asset-calc-points.md`, "Owner rulings").
This **widens decision 7**, which named the standalone `PUT` and the batch
route only:

1. **`backfillDays` (1–31, optional) is accepted on the override `PUT` too**
   (`assetPointCalcOverrideBodySchema`), so a templated asset's overridden
   derived point can be backfilled the same way. The `calcOverride.set`
   copilot entry gains a "Backfill" step for the field. An override item's
   `backfill` on the calc-points list is read from the run table like a
   standalone item's, never always `null`.
2. **A `$parameter` formula backfills with the value in force at each
   bucket** (ruling 2): one range read of the parameter rows per chunk
   (`CalcParametersService.resolveSeriesForAssets`), held equal to the point
   read on a grid by its integration spec.
3. **Aggregate membership during a backfill is today's membership** (ruling
   3) — an accepted limit: membership is configuration, its history is not
   stored, and the walk resolves it once per run.
4. **A running backfill refuses only the new backfill** (ruling 4). The point
   write commits first and the run is created after it; only the run
   creation answers 409 ("the calculated point was saved, but a backfill is
   already running for this point"). An enqueue failure marks the run
   `failed` with `error = 'no worker'` and answers 503; the point stays
   written.

## Amendment 1 — adopt a template-less asset onto a template version (`F4.312`); a new catalog key from the Add panel (`F4.313`) (owner, 2026-11-05)

**Status: Proposed — owner ruled 2026-11-05 in chat, one question at a
time; the merge approves the text.** A line marked *(An)* states the owner's
ruling n below; lines marked *drafter choice* were not asked. Backlog rows
`F4.312` and `F4.313`. The owner chose one amendment for both rows (A0).

### Facts the amendment rests on

- `POST /admin/asset-templates/:id/migrate` refuses an asset that is pinned
  to no template version (`asset-templates-migrate.service.ts`), and
  `instantiate` builds new assets only. So an existing template-less asset has
  no path onto a template today. This record's ruling 1 deferred that path;
  ruling 8 already decides what a per-asset point becomes when its key is
  declared by the adopted template.
- The engine reads a standalone point only on an asset whose `template_id` is
  NULL (decision 2, `CalcDefinitionsService`). After adoption it reads the
  template's derived points and their overrides.
- `asset_points_source_ref_check`: a `measured` row names an RTU; `manual`,
  `computed` and `unmapped` rows name none.
- A catalog point key (`bms.point_keys`) is shared by every organization, and
  only a global administrator may create one (`point-keys` service).
- The AWS demo's 48 PHE WB assets have no template, and organization PHEWB has
  no template (`F4.311` live check, 2026-11-04).

### Rulings (owner, 2026-11-05)

| # | Question | Ruling |
|---|---|---|
| A0 | Scope | One amendment for `F4.312` and `F4.313` |
| A1 | Target version | A **published** version of the asset's **own organization** and the **same domain** only |
| A2 | Asset point whose key the template does not declare | **Kept unchanged** — wiring, telemetry and history stay; it is an extra point outside the template |
| A3 | Template measured point the asset lacks | **Added as `unmapped`** (no RTU), as migrate does for a measured addition with no RTU |
| A4 | Standalone calculated point whose key the template does **not** declare | **Adoption is refused**; the preview names each point. The admin deletes it, or adds the key to the template as a derived point, first |
| A5 | Template content | **Everything a new asset from that version gets** — derived points, KPIs, alarm rules, maintenance plans — as `instantiate` writes it |
| A6 | Surfaces | **The page, the copilot and a bulk action** |
| A7 | Undo | **None** — adoption is one-way, like an instantiate pin; later changes go through migrate |
| A8 | Same key, different unit | **Adoption is refused**; the preview names each mismatch |
| A9 | PHE templates | **Made by an administrator** on the template pages after the build; nothing is added to the stock catalog |
| A10 | Access | **Template migrate's own** — write scope over the asset, and the version inside the admin's scope |
| A11 | `F4.313` surfaces | **The Add calculated point panel and the bulk action wizard.** The copilot keeps one card per change |
| A12 | `F4.313` access | **A global administrator only**, the catalog's existing rule |
| A13 | `F4.313` writes | **Check first, then two writes** — the formula is checked before anything is written; the key, then the point |

### Decision — adoption (`F4.312`)

1. **What adoption does.** It pins an asset whose `template_id` is NULL to
   one template version (A1, A7), in one transaction per asset:
   - each `asset_points` row whose key the version declares as a measured
     point becomes that point's row: wiring, `source_data_key`, RTU and
     history stay;
   - each measured point the version declares and the asset lacks gets an
     `unmapped` row (A3);
   - each row whose key the version does not declare stays as it is (A2);
   - each standalone calculated point whose key the version declares as a
     derived point becomes that asset's calc override of it, through the
     override's own checks, and its history continues under the same key
     (ruling 8);
   - the version's derived points, KPIs, alarm rules and maintenance plans
     are written as `instantiate` writes them for a new asset (A5), after the
     points, so a rule can evaluate at once.
2. **Refusals, before any write.** The version is not published, is of
   another organization or another domain (A1); a standalone calculated point
   has a key the version does not declare (A4); an asset point and the
   version's point of the same key differ in unit (A8); the asset already has
   a template; a key the version declares as derived is held by the asset as
   a measured, manual or unmapped point. Each refusal names the asset code
   and the point key.
3. **Preview first.** A preview returns, per asset, the rows kept, added
   and converted, the content to be written, and every refusal, as
   migrate's preview does; the apply re-computes the plan and refuses if it
   differs from the preview (*drafter choice*, migrate's own guard).
4. **Routes** (*drafter choice*: names follow migrate's).
   `POST /admin/asset-templates/:id/adoption-preview` and
   `POST /admin/asset-templates/:id/adopt`, body `{ assetIds }` with 1–25
   template-less assets of the version's organization, all or nothing
   (A6, the calc batch's bound). Zod contracts in `@bms/shared` (ADR 0030).
   Each adopted asset is audited as a migrate is. Access is migrate's (A10).
5. **Surfaces** (A6). The asset page gains **Adopt a template** on a
   template-less asset: a version picker (filtered by A1), the preview, and
   Confirm. The asset list's bulk actions gain the same for the selected
   assets. The copilot gains one catalog entry, `assetTemplate.adopt`, a red
   Confirm card that calls `adopt` with the same body; this amends ADR
   0099's catalog (its next amendment records the entry).
6. **Not in this amendment.** Releasing an asset back to no template (A7).
   Stock templates for PHE (A9): after the build an administrator imports
   `electrical-feeder` (and adds `voltage_l1_v`) and creates the PUMP-M,
   PUMP-C and AIRSP templates, then adopts the 48 assets.

### Decision — a new catalog key from the Add panel (`F4.313`)

7. **Where.** The key picker of the Add calculated point panel and of the
   bulk action wizard gains **New key** (A11): code, label and unit, with the
   Point keys page's own validation. The copilot has no combined card: it
   proposes the existing `pointKey.create` card, then the `calcPoint.set` or
   `calcPoint.createBatch` card (A11).
8. **Who.** **New key** shows only to a global administrator (A12). Every
   other admin picks an existing key, as today; the API rule does not change.
9. **Order of writes** (A13). The panel first checks the formula with the
   existing preview and the write rules of decision 3 against the new code.
   Only then does it create the key (`POST /admin/point-keys`) and write the
   point. If the point write still fails, the key stays in the catalog, the
   panel says so, and the next try finds the key in the picker. Ruling 3
   stands: a calculated point uses a catalog key only.

### Consequences

- No migration is expected: adoption writes existing tables (`assets`,
  `asset_points`, and the tables `instantiate` writes). The plan confirms
  this against the schema.
- ADR 0099 gains `assetTemplate.adopt` in its next amendment.
- `AGENTS.md` is updated in a separate `chore(agents):` PR (§9.10).
