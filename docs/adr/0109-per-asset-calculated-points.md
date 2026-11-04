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
