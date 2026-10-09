# ADR 0097 — Template KPI evaluation: a read-time value on the asset page (`F2.33`)

## Status

**Accepted — 2026-10-09** (owner; proposed 2026-10-08). Source: owner rulings 2026-10-08, the Track B batch.
Drafted before any implementation code and accepted on the owner's
word. The owner ruled six questions; each is a numbered decision below. Where a
decision needed a detail the rulings do not give, the detail is listed under
*Ruled here without a question*; the owner confirmed each one at
acceptance. The build starts after the three Track B clusters (`C1`–`C3`, ADR
0056 Amendment 3) merge. Line citations are to `main` at `c60b8e00`.

Promotes nothing out of `AGENTS.md` §6: §6 does not list KPI evaluation.

| Ruling (2026-10-08) | Decision |
| --- | --- |
| 1 — the surface: `GET /assets/:assetId/kpis` behind `canReadAsset`, and a card beside the asset health card; a dashboard catalog entry is a follow-up row | 1 |
| 2 — staleness: the caller's `windowMinutes`, a default fixed here; `inputAsOf` and `state` in the response; `null` if any input is stale; no schema change | 2 |
| 3 — `v2` coverage: fail closed (ADR 0055 decision 11); the response states the reason and the excluded count; no `minCoverageRatio` | 3 |
| 4 — `v3` is in scope: `v1`, `v2` and `v3` in one read host; the row title widens to `v3`; effort 6–9 | 4 |
| 5 — the host: the API, on request, no cache; the member resolution and latest-sample read move out of `calc-scheduler.service.ts` into a module both hosts call (a named carve-out) | 5 |
| 6 — disclosure: value, state, excluded and member counts only; never member ids or per-member values | 6 |

## Context

**A template KPI is authored, validated and stored, and nothing reads it.**
`templateKpiSchema`
(`apps/api/src/admin/asset-templates/asset-templates-content.schema.ts:291`)
holds `code`, `name`, `unit?`, `pointKeys[]`, `expression`, `dialect` and
`higherIsBetter?`, stored in `asset_templates.content.kpis`. The dialect is one
of `KPI_DIALECTS = ["unvalidated", ...CALC_DIALECTS]` (`:246`), and
`CALC_DIALECTS` is `v1`, `v2` and `v3`
(`packages/shared/src/calc-dsl/limits.ts:21`). The schema has no
`minCoverageRatio` and no `maxInputAgeSeconds`. The only readers of `kpis` in
`apps/api` are the authoring and save-time validation paths. `evaluate()`
(`packages/shared/src/calc-dsl/evaluate.ts:211`) has three callers: the
scheduled host (`apps/api/src/calc/calc-scheduler.service.ts:299`), the
streaming host (`calc-streaming.service.ts:87`) and the browser preview
(`apps/web/src/lib/calc-preview.ts:160`). The Template KPIs tab says so in its
own docblock: "No KPI is evaluated anywhere yet — `F2.33`"
(`apps/web/src/components/asset-templates/kpis-tab.tsx:43-45`).

**The pieces a read host needs exist, as services.** Membership for a `v2`
reference is `CalcScopeService.resolveMembership`
(`apps/api/src/calc/calc-scope.service.ts:71`), which takes only
`{ assetId, crossRefs }` per definition (`:261`). Latest samples are
`CalcInputsService.getLatestSamples` and `getLatestSamplesForPairs`
(`calc-inputs.service.ts:39`, `:96`). `$key` parameters are
`CalcParametersService.resolveForAssets(pairs, at)`
(`calc-parameters.service.ts:68`), and window reads are
`CalcWindowsService.resolveReads` (`calc-windows.service.ts:164`). The
aggregate rule is the pure `resolveAggregate`
(`apps/api/src/calc/calc-aggregate.ts:52`).

**What is not a service is the composition.** The code that pairs a
definition's references with their samples, classifies each sample and runs
the aggregate is module-private to the scheduler: `readPairSamples`
(`calc-scheduler.service.ts:101`), `resolveCrossInputs` (`:155`) and the
local-input loop of `evaluateOneScheduledFormula` (`:218`). It is tied to two
things a KPI does not have: the `computedThisTick` overlay of same-sweep values
(`:75-89`), and `refuse` (`:64`), which counts a skip metric **and** records a
status keyed by `templatePointId` for the per-asset calc page.

**Read-time precedents.** `GET /telemetry/points/latest`
(`apps/api/src/telemetry/telemetry.controller.ts:118-135`) reads the latest
sample per pair inside `windowMinutes`, default
`DEFAULT_LATEST_WINDOW_MINUTES = 15`, bound `MAX_LATEST_WINDOW_MINUTES = 60`
(`telemetry.schema.ts:119-121`). `GET /asset-health/assets/:assetId`
(`apps/api/src/asset-health/asset-health.controller.ts:48-54`) is a per-asset
computed value behind `canReadAsset`, and the asset detail panel renders it as
`AssetHealthCard` (`apps/web/src/components/assets/asset-detail-panel.tsx:88`).

## Already decided by earlier records

This ADR cites these and does not re-rule them.

- **ADR 0037 *Not in this ADR*** (`docs/adr/0037-calc-execution-engine.md:259-270`).
  A KPI expression is "a **read-time display value**"; KPI evaluation is "a call
  into the same pure `evaluate()` from whatever renders the KPI". Only a stored
  tag needs "a trigger, a write path, a staleness policy or an idempotent
  timestamp". So a KPI here has no trigger, no write to
  `telemetry.point_values`, no stored column and no scheduler tick.
- **ADR 0055 decision 9.** `@site`, `@domain('…')` and `@group('…')` resolve
  relative to the asset that owns the formula. For a KPI the owning asset is
  the asset the KPI is read for.
- **ADR 0055 decision 11.** An aggregate is evaluated over its **fresh
  declared** members; a `null` coverage ratio fails closed; the excluded count
  is reported.
- **ADR 0055 decision 12.** No cross-asset reference leaves the owning asset's
  location. The resolver applies the owner's `location_id` itself
  (`calc-scope.service.ts` class docblock; part (d) of
  `tests/adr-0055-calc-v2-invariants.test.ts`), so a KPI host that calls the
  same resolver gets the same containment.
- **ADR 0070 §9** (`docs/adr/0070-sustainability-metrics-engine.md:409-411`).
  "A `v3` KPI expression is stored and not evaluated, as `v1` and `v2` ones are
  today." Decision 4 below discharges that sentence.

ADR 0055 decision 10 (`v2` is `scheduled` only) is about **points**. It
exists because a stored tag needs an ordered, bounded recomputation. A KPI is
not stored and has no trigger, so decision 10 does not apply to it; a `v2` KPI
is evaluated on request.

## Decision

### 1. The surface: one route and one card

`GET /api/v1/assets/:assetId/kpis`, on `AssetsController`
(`apps/api/src/assets/assets.controller.ts:48`), gated by
`accessControl.canReadAsset(user, assetId)` exactly as `GET
/assets/:assetId/points` is (`:129-135`). It returns the KPIs of the asset's
**pinned** template version (`assets.template_id`), in declared order. An
asset with no template returns an empty list, not an error.

The web shows them in a card beside `AssetHealthCard` in the asset detail
panel. The Template KPIs tab's sentence "No KPI is evaluated anywhere yet" is
changed in the same change, to say that a KPI computes at read time on the
asset page.

A dashboard-builder catalog entry for a KPI value is **not** in this ADR. It is
a follow-up row.

### 2. Staleness: the caller's window, stated in the response

The request takes `windowMinutes`. A sample older than `windowMinutes` at
request time is stale, and a KPI with any stale or missing input has `value:
null`. The response carries, per KPI, `state` (why there is or is not a value)
and `inputAsOf` (how old the inputs were). No schema change: the template does
not gain a staleness field, and no column is added.

### 3. `v2` coverage: fail closed, and say what was excluded

A KPI aggregate runs with a `null` coverage ratio, which is ADR 0055 decision
11's fail-closed rule: every declared member must be fresh. `templateKpiSchema`
does **not** gain `minCoverageRatio`. When an aggregate refuses, the response
states the reason and the **excluded count** — the number of declared members
that were stale or missing.

`resolveAggregate` cannot give that count as it is. With a `null` ratio it
returns at the first member that is not fresh, with a reason and no count
(`calc-aggregate.ts:63-73`); when it succeeds, `excluded` is always `0`. So
the KPI host, or the extracted module (decision 5), classifies **every**
declared member and counts the ones that are not fresh. The scheduler's
behaviour, and `resolveAggregate`'s result for the scheduler, do not change.

### 4. `v1`, `v2` and `v3` in one read host

One host evaluates all three real dialects. `v1` reads the owning asset's
latest samples. `v2` adds membership and qualified references. `v3` adds `$key`
parameters, resolved at request time with `resolveForAssets(pairs, now)`, and
window reads through `resolveReads`. The `F2.33` row's title, "`v1` and `v2`",
widens to `v3`; that row edit belongs to the backlog closure, not to this
record.

### 5. The host: the API, on request, with no cache — and the carve-out it needs

The value is computed in `apps/api` for each request and is not cached. Nothing
is written.

**The named carve-out.** The composition described in *Context* —
`readPairSamples`, `resolveCrossInputs` and the local-input loop of
`evaluateOneScheduledFormula` in `calc-scheduler.service.ts` — moves into a
module that both the scheduler and the KPI host call. In the moved code:

- the `computedThisTick` overlay is a parameter: the scheduler passes its
  overlay, and the KPI host passes an empty one;
- a refusal is a **returned value**, not a call to `refuse`. The scheduler
  keeps its `refuse` (`:64`) and calls it with the returned reason, so every
  scheduler refusal is still counted and recorded by one function;
- the module calls `CalcScopeService`, `CalcInputsService`,
  `CalcParametersService` and `CalcWindowsService` as they are; they do not
  move.

The KPI host never calls `countCalcSkipped` and never writes to
`CalcStatusRegistry`. A KPI is not a calc point: it has no `templatePointId`
for the status registry to key on, and a read-time refusal is not a skipped
tick. Part (e) of `tests/adr-0055-calc-v2-invariants.test.ts` (`:743-744`)
scans the two evaluation hosts for `countCalcSkipped(` outside `refuse`; the
moved module and the KPI host must keep that true.

The carve-out is this and nothing more: it moves the input assembly only. The
scheduler's tick, its graph order and its writes stay where they are, and the
scheduler's specs must stay green unchanged.

### 6. Disclosure: counts, never members

Per KPI the response carries the value, the state, the excluded count and the
member count. It never carries a member's asset id, code or value (see
Amendment 1). The reason
is containment. The membership read and the parameter read run on the fleet
connection with no tenant actor (`calc-scope.service.ts:57`,
`calc-parameters.service.ts:59`), and `telemetry.point_values` carries no row
level security (`telemetry.controller.ts:115`). A `@site` aggregate can
therefore include assets that a reader scoped to one asset group cannot read.
The only containment is the `canReadAsset` gate on the owning asset, ADR 0055
decision 12's location filter, and this decision: a reader sees one aggregate
number and two counts, never the members behind them.

**The item's identity fields** *(owner ruling 2026-10-09, at the build plan)*.
Beside the value, the state, the two counts and `inputAsOf`, each item carries
the stored KPI's `code`, `name`, `unit?` and `higherIsBetter?` — what the card
renders, and nothing else. The `expression`, the `pointKeys` and the `dialect`
stay off the read route: a reader of the asset is not an author of its
template, and the admin template route is where those belong.

## Ruled here without a question

Drafter's choices, confirmed by the owner at acceptance (2026-10-09).

- **The default window.** `windowMinutes` defaults to `15` and is bounded at
  `60`, the values of `GET /telemetry/points/latest`
  (`telemetry.schema.ts:119-121`), so the asset page shows one meaning of
  "current".
- **`inputAsOf`** is the time of the **oldest** input sample the host read for
  that KPI, as an ISO string — `null` when no input was read. It is carried
  when the value is `null` too, so a stale KPI shows how stale.
- **`state`** is a closed `z.enum`: `ok`; the runtime refusal reasons the
  evaluation can reach (`missing_input`, `stale_input`, `no_members`,
  `unknown_asset_reference`, `parameter_unset`, `window_empty`,
  `window_sparse`, `windows_unresolved`, `timezone_unset`, `non_finite`, a
  subset of `CalcRuntimeSkipReason`,
  `apps/api/src/observability/metrics.service.ts:52-67`);
  `windows_unresolved` — the window-read budget refusal
  (`MAX_WINDOW_BUCKETS`, `calc-windows.service.ts:41`) — was added by the
  owner on 2026-10-09 at the build plan, because a `v3` KPI can reach it;
  and `unvalidated` for a KPI whose dialect is `"unvalidated"`, which is listed
  with `value: null` and is never evaluated.
- **The window end** for a `v3` window read is the request time floored to the
  minute, because a KPI has no interval to bucket on. The scheduler's
  `windowEndMs(nowMs, intervalSeconds)` (`apps/api/src/calc/calc-window-plan.ts:139`)
  cannot be called with `0`: `bucketTimeMs` divides by the interval
  (`calc-schedule.ts:11-13`) and returns `NaN`. The moved module takes the end
  as a parameter instead.
- **The contract** lives in `packages/shared/src/contracts/` as a flat
  `z.object` per item inside `{ items: [...] }`; the types are `z.infer`red
  (ADR 0030), with no `.merge()`.

## Not in this ADR

- **A dashboard-builder catalog entry** for a KPI value (decision 1). A
  follow-up row.
- **A KPI in a report**, or a KPI history. A KPI has no stored series (ADR
  0037), so a trend needs a stored tag, which is a `template_points.formula`.
- **`minCoverageRatio` on a KPI** (decision 3).
- **A per-KPI staleness field** on the template (decision 2).
- **A cache** (decision 5). If the read becomes expensive, that is a new
  decision with a measured reason.

## Dependencies

**No new package**, so §9.4 is not triggered. **No migration and no schema
change.** One new response contract in `packages/shared/src/contracts/`, so the
build chain is shared → db → api → web.

Touched by the build: `apps/api/src/calc/` (the carve-out and the new module),
`apps/api/src/assets/` (the route and the host),
`packages/shared/src/contracts/` and `packages/shared/src/index.ts`,
`apps/web` (an API client, the card, the KPIs tab copy).

## Consequences

- **Effort 6–9**, against the row's `4–8`: the carve-out and `v3` are the
  difference.
- **The scheduler file changes shape.** The carve-out is a refactor of the hot
  path of every scheduled evaluation. It lands in its own commit before the KPI
  host adds a line, and the scheduler's own specs are the gate.
- **A `v2` KPI is as fresh as its slowest member at request time**, and it
  refuses when any declared member is stale. On a site with one silent meter, a
  `@site` KPI shows `null` with an excluded count of one. That is ADR 0055
  decision 11's choice, applied to a display.
- **The F2.22 start-gate ruling is reversed.** The KPIs tab may no longer say
  that no KPI computes.
- **Owed after the build, not here:** the `F2.33` backlog row's title and
  closure; the follow-up row for the catalog entry; an `AGENTS.md` §2 line in a
  separate `chore(agents):` PR (§9.10) if the sweep finds one is due. No §6
  promotion is owed.

## Verification owed

- **API.** For a seeded asset with a `v1` and a `v2` KPI: the route returns a
  value and `state: "ok"`; with one member silenced past the window, the `v2`
  KPI returns `null`, a refusal state and an excluded count of one, and no
  member id appears anywhere in the body. A reader without access to the asset
  gets 403.
- **Scheduler.** Its existing specs and part (e) of
  `tests/adr-0055-calc-v2-invariants.test.ts` stay green after the carve-out,
  unchanged.
- **Part (e)'s reach.** It scans only the two host files it lists
  (`:743-744`), so the moved module and the KPI host are not gated by it until
  the build adds them to that list. Adding them is owed by the build.
- **Browser.** The card on the asset detail panel shows the value and the
  stale state; the KPIs tab no longer says no KPI is evaluated.
- **Database.** N/A — no DDL.

## Amendment 1 — what decision 6 guarantees (owner ruling 2026-10-09)

The security review of the build found that decision 6's "never carries a
member's asset id, code or value" is false in two cases, and the owner ruled
to correct the wording, not the behaviour.

- **What the route never returns:** a member's asset id or code, or
  per-member values as a list.
- **What it can return:** the KPI value equals one asset's reading when the
  expression is a qualified reference (`{TX_01.kwh}`) or an aggregate with a
  single member; and `inputAsOf` can be a member's sample time.

That is the exposure a stored `v2` point with the same reference already has
(ADR 0055), behind the same `canReadAsset` gate, so it adds no new class of
exposure. The owner chose this over refusing such KPIs for a reader without
global scope.
