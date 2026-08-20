# ADR 0037 — Calc execution engine (`F2.4`)

## Status

Accepted — 2026-08-20, by the repository owner, the same day it was drafted
for `F2.4`, at the `build-operating-model.md` step 2 gate.

## Context

ADR 0036 (`F2.3`) froze the `bms-calc-v1` grammar and shipped a parser, and
was explicit about what it left behind:

> **No evaluator.** Nothing here computes a value from a parsed expression
> against live telemetry — that is `F2.4` (calc execution engine), including
> what "the current value of `{X}`" means (latest sample vs. rolling window),
> null/stale-input behaviour, and divide-by-zero handling.
> **No scheduling, no `asset_points` writes for derived tags.** Still `F2.4`.

So `F2.4` owns four things ADR 0036 named and declined: an evaluator, a
definition of "current value", a trigger, and a write path.

Three facts about the codebase decide most of the shape.

**1. The streaming hook already exists, with a precedent.**
`telemetry.point_values` writes raise `pg_notify('bms_telemetry', …)`; the
supervised `LISTEN` loop in `apps/api/src/telemetry/telemetry-listener.ts`
parses each payload and hands it to `TelemetryBroadcastHub`. `AlarmEngineService`
(`apps/api/src/alarms/alarm-engine.service.ts:44`) subscribes with
`hub.on("readings", …)` inside `onModuleInit`, caches its rules for 60 s,
collapses each batch to the latest sample per `(assetId, pointKey)`, and wraps
each rule's side effect in its own `try`/`catch` so one failure cannot abort
the batch. A streaming calc engine is the same shape against a different
definition table.

**2. There is no scheduler anywhere in `apps/api`.** No `@nestjs/schedule`, no
cron, no timer. The "scheduled" half of this backlog row is genuinely new
infrastructure. `apps/ingest` already solved the same problem without a
dependency, and recorded why the obvious answer is wrong
(`apps/ingest/src/host/supervisor.ts:281`):

> "next tick is scheduled only after `poll()` settles" — overlap is
> forbidden (§5), which is why this awaits rather than using `setInterval`.

**3. The write target needs no schema change.** ADR 0018 made telemetry
provenance bind at `asset_points.source_kind`, and `computed` has been a legal
value since (`packages/db/src/schema/bms-schema.ts:262`) with `rtu_id`
required-absent. `TelemetryWriteService` already creates mappings on demand
with a synthesised key — `` `${sourceKind}:${pointKey}` ``
(`apps/api/src/admin/telemetry-entry/telemetry-write.service.ts:244`). Nothing
about writing a derived value needs DDL. `F2.2`'s "derived points are never
instantiated" therefore stays true and unchanged: the engine creates the
`asset_points` row when it first has a value, not at instantiation time.

One constraint is not a preference and cannot be deferred to implementation.
`point_values.value` carries `point_values_value_finite_check`
(`packages/db/src/schema/telemetry-schema.ts:39`, migration `0031`), which
rejects `NaN` and `±Infinity`. JavaScript division by zero produces exactly
those. So "what happens on divide-by-zero" is decided by the database whether
or not this ADR decides it; an evaluator returning `Infinity` fails at the
`INSERT` with a constraint violation rather than skipping cleanly.

## Decision

**1. The evaluator lives in `packages/shared/src/calc-dsl/`, beside the
parser, and stays pure.** ADR 0036 decision 4's reasoning applies unchanged —
`F2.5`'s live preview must evaluate, not merely parse, and a second evaluator
in `apps/api` would drift from this one exactly as the pre-ADR-0026 CSV
escaping did.

```ts
// packages/shared/src/calc-dsl/evaluate.ts
export function evaluate(ast: CalcExpr, inputs: ReadonlyMap<string, number>): CalcEvalResult;
```

No clock, no database, no configuration. Staleness is resolved by the caller
*before* this function runs (decision 5), so the evaluator never learns what
time it is and stays as testable as the parser.

**2. A reference resolves within the asset that owns the formula.**
`bms-calc-v1`'s `{POINT_KEY}` carries no asset qualifier and ADR 0036 froze
that grammar, so `{TOTAL_KWH}` on asset *A* means `(assetId = A, pointKey =
'TOTAL_KWH')` in `telemetry.point_values`. This is a consequence of the frozen
grammar rather than a choice; the alternative — inventing an asset-qualified
reference here — would reopen ADR 0036 four days after it was accepted and
drag cross-asset dependency ordering into an item that has no other need for
it. See *Consequences* for what this costs `F2.8`.

**3. "The current value of `{X}`" is the latest stored sample, not a
window.** `SELECT DISTINCT ON (point_key) value, time … ORDER BY point_key,
time DESC` over `point_values` for the formula's asset and reference set, in
one batched read per asset rather than one per reference. ADR 0036's Context
already established that the only calculation shipping today —
`estimatePue()` — is "scalar arithmetic on an already-aggregated number, not a
time-windowed query", and nothing in `F2.5`/`F2.6` has asked for a window.
Rolling aggregates would need grammar support that does not exist.

The read carries a time bound so it stays index-friendly on
`point_values_point_asset_time_idx`, but a **generous** one rather than the
formula's own `max_input_age_seconds`. Bounding the query at exactly the
staleness limit would collapse "this point has never reported" and "this
point reported, but too long ago" into the same empty result, and decision 9
promises to tell those two apart. So the query fetches with room to spare and
the **classification happens in code**, where both facts are still visible.

**4. Trigger mode is per formula, not per engine.** Three nullable columns on
`template_points`, in one additive forward-only migration:

```ts
// packages/db/src/schema/bms-schema.ts — templatePoints
calcTrigger: varchar("calc_trigger", { length: 16 }),        // 'streaming' | 'scheduled'
calcIntervalSeconds: integer("calc_interval_seconds"),
maxInputAgeSeconds: integer("max_input_age_seconds"),
```

Enforced in the Zod layer and **not** as a DB `CHECK`, following the precedent
ADR 0036 decision 5 set for `formula`/`formula_dialect` in this same table and
for `rtuId`/`locationId` before it: when `kind === "derived"`, `calcTrigger` is
required; `calc_interval_seconds` is required when `scheduled`, forbidden when
`streaming`, and bounded 10…86400; `max_input_age_seconds` is optional and
bounded 1…86400. When `kind === "measured"` all three must be absent.

A single engine-wide mode was considered and rejected. A tank level and a flow
rate legitimately differ in how often they are worth recomputing, and the
author is the only party who knows by how much. This matches how this
repository treats every other vocabulary of this kind (ADR 0031's plant
domains, ADR 0032's severities): configurable, not hardcoded.

**5. Staleness is per formula, with a deliberately loose default.** A
streaming formula `{A} + {B}` fires when `A` arrives and reads `B` from
storage. `B` is refused when
`now - B.time > (max_input_age_seconds ?? DEFAULT_MAX_INPUT_AGE_SECONDS)`,
and the whole evaluation is then skipped rather than computed on a value that
is no longer true.

```ts
export const DEFAULT_MAX_INPUT_AGE_SECONDS = 300;
```

No existing constant fits and none was reused: `FRESH_MS` (25 s,
`apps/web/src/lib/schematic-telemetry.ts`) governs socket freshness for a UI
already streaming, and `NOTIFY_LIVE_WINDOW_MS` (5 min,
`telemetry-write.service.ts:48`) absorbs the human latency of typing a reading
in. Neither was chosen for this question.

The default is loose on purpose. Too tight, and formulas silently produce
nothing, which reads as "the feature does not work" and is the harder failure
to diagnose; too loose merely means the author has not yet tightened a value
they can see. Every skip is counted (decision 9), so a loose default is
visible rather than silent.

**6. The streaming host mirrors `AlarmEngineService`.** `hub.on("readings")`
in `onModuleInit`; a 60 s definition cache matching that service's
`CACHE_TTL_MS`; the batch collapsed to the latest sample per
`(assetId, pointKey)`; and one `try`/`catch` per formula, not per batch —
the §4.3 shape `F4.36` established and `F3.6` widened, so a single formula's
failure never costs the rest of the batch.

**7. The scheduled host is one self-scheduling `await` loop, and never
`setInterval`.** `apps/ingest/src/host/supervisor.ts:281` records the reason:
a timer lets a slow tick overlap the next one. The loop reuses the
`sleep(ms, signal)` helper already in
`apps/api/src/telemetry/telemetry-notify.service.ts:22` and the same
`AbortController` shutdown discipline as the telemetry listener.

**One** loop at a 10 s base tick, not one timer per formula: each tick runs
the formulas whose own `calc_interval_seconds` has elapsed. There is
deliberately **no cap on formulas per tick** — silently computing a subset
would be a worse failure than being slow, and the non-overlapping loop already
provides natural backpressure, since a sweep that runs long simply delays the
next tick. A gauge exposes the active formula count so growth is visible
before it hurts.

**8. Output timestamps are chosen for idempotency, not cosmetics.**

| Mode | Output `time` |
| --- | --- |
| `streaming` | the newest `time` among the inputs actually used |
| `scheduled` | tick time truncated to the formula's `calc_interval_seconds` |

`point_values` is keyed `(time, assetId, pointKey)`, so with
`onConflictDoNothing` a recompute of the same instant is a no-op at the
database. Streaming therefore cannot accumulate duplicate rows for a
re-delivered batch, and a scheduled sweep that runs late still writes its
bucket's timestamp — which makes the derived series regular, which is what the
ADR 0023 continuous aggregates and the trend charts want, and makes a re-run
idempotent by construction rather than by a guard someone has to remember.

**9. A non-finite result is refused, and no skip is silent.** The evaluator
checks finiteness at **every** node rather than only at the root: `Infinity -
Infinity` is `NaN`, so a root-only check reports the wrong cause for the
common case. It returns `{ ok: false }` with a code and position — never a
value — for division by zero, any non-finite intermediate, and `clamp(x, lo,
hi)` called with `lo > hi`. `-0` is normalised to `0`. `round` is specified as
`Math.round` — half toward positive infinity, so `round(-0.5)` is `0` and
`round(0.5)` is `1`; the asymmetry is recorded here rather than left for a
reader to discover, since ADR 0036 shipped `round` single-argument and this is
its first behavioural definition.

On any refusal — non-finite, missing input, stale input — the engine writes
nothing and increments a counter labelled by reason. A skipped calculation is
an absent value, never a wrong one.

**10. Writes go through a `CalcWriteService`, not `TelemetryWriteService`.**
That service requires a `JwtPayload`, calls `requireMasterDataUser`, and
writes a `bms.audit_log` row per asset per batch. The calc engine has no user
to authorise and no operator to attribute, and auditing every machine-generated
sample would flood the audit log that `F4.14`'s read API exists to make
useful. The new service reuses the parts that carry real knowledge —
`chunkForNotify` for `pg_notify` payload bounds, `onConflictDoNothing`,
chunked inserts, and `refreshAggregatesFrom` after commit — and skips the
parts that assume a human.

Provenance is `source_kind: 'computed'` with `rtu_id: null` and a
`source_data_key` of `` `computed:${pointKey}` ``, created on demand the first
time a formula produces a value.

**11. Re-entrancy is closed structurally, not by a flag.** A calc write
`pg_notify`s like any other, so it returns through the hub. Before evaluating,
the streaming host filters the incoming batch to readings whose `pointKey` is
an *input* to some active formula. ADR 0036 decision 7 forbids a derived point
referencing another derived point, so the engine's own output can never pass
that filter. The same filter removes the wasted work of waking every formula
for an unrelated reading, so the guard and the optimisation are one thing.

The filter is resolved on **`(assetId, pointKey)`**, not on the point key
alone. Point keys are org-scoped catalog codes shared across templates, so a
bare string match would wake asset *A*'s formulas whenever any *other*
template used the same code as an input. That would be wasted work rather than
a loop — decision 2 confines a formula to its own asset, and each asset pins
exactly one template — but it is worth stating, so a reader does not mistake
the string filter for the whole safety argument.

Decision 8's timestamp choice is a second, independent brake: even if the
filter were removed, a recompute at the same instant is a database no-op. Two
mechanisms, because an unbounded write-notify-recompute loop against the
database is the one failure here that would be an outage rather than a bug.

**12. Template lifecycle status is not consulted.** Instantiation already
refuses a non-published template
(`apps/api/src/admin/asset-templates/asset-templates-instantiate.service.ts:128`),
so `assets.templateId` always points at a frozen row. A published template can
later be archived, and the engine keeps computing for assets already built
from it: archiving means "build no new assets from this", not "stop the ones
that exist", whose points are physical wiring that `apps/ingest` and the rule
engine still read.

## Not in this ADR

- **No cross-asset references and no aggregate functions.** Decision 2's
  consequence; see below for `F2.8`.
- **No chained derived-to-derived formulas.** ADR 0036 decision 7 stands
  unamended, and decision 11 depends on it.
- **No backfill.** Nothing recomputes history. A formula produces values from
  the moment it is active; earlier instants stay empty.
- **No per-asset override** of trigger mode or staleness — the columns live on
  `template_points`, so the unit of configuration is the template. Per-asset
  overrides are `F2.6`'s if anyone asks for them.
- **No authoring UI.** `F2.5`.
- **No evaluation of `kpis[].expression`.** ADR 0036 decision 6 widened
  `templateKpiSchema.dialect` to accept `"bms-calc-v1"`, so the repository has
  **two** authored-formula surfaces and this ADR deliberately drives only one.
  The reason they separate cleanly: a KPI expression is a **read-time display
  value** computed for whoever is looking at a dashboard, whereas a
  `template_points.formula` produces a **stored tag** that alarms, reports and
  aggregates all read afterwards. Only the second needs a trigger, a write
  path, a staleness policy or an idempotent timestamp — every decision in this
  ADR. KPI evaluation is a call into the same pure `evaluate()` from whatever
  renders the KPI, and belongs to `F2.5`/`F3.1`. Recorded rather than left to
  omission, so a later reader does not have to guess whether the silence was a
  decision.
- **No `F2.8` wiring.** The PUE path in `dashboard.service.ts` and
  `reports.service.ts` is untouched.

## Dependencies

None. No `package.json` change in any workspace — decision 7 exists precisely
so the scheduled half needs no scheduling library, and `@nestjs/schedule` was
considered and rejected on those grounds. §9.4 is not triggered.

One additive, forward-only, nullable migration on `bms.template_points`
(decision 4). No backfill; no existing row changes meaning. Its number is
taken from `packages/db/migrations/` when it is written rather than recorded
here, following the lesson `docs/BACKLOG.md` records against `E5.1` — a
derived number in prose does not stay correct.

## Consequences

- **`F2.8` is not reachable on `bms-calc-v1` as it stands, and this ADR does
  not fix that.** `estimatePue()` runs on a figure SQL already summed across
  assets; decision 2 confines a formula to one asset and ADR 0036 provides no
  aggregate function. So "replace hardcoded PUE SQL with user-defined derived
  tags" needs either an ADR 0036 amendment (asset-qualified references or
  aggregates) or a site-level asset carrying facility totals as measured
  points. Both are `F2.8`'s decisions to make; choosing one here would be
  inventing its scope on its behalf, the trap ADR 0036 decision 7 named. This
  was discovered at `F2.4`'s ADR gate and is recorded on `F2.8`'s backlog row,
  which did not previously say it.
- **A `streaming` formula inherits the `NOTIFY`-gap exposure.**
  `telemetry-listener.ts` records that `NOTIFY` has no replay: readings
  published while the listener is down "are gone from the realtime path for
  good". A streaming calc misses those inputs permanently. This is not a new
  risk — `AlarmEngineService` evaluates exclusively off the same hub and has
  carried the identical exposure since `F3.6` — and a `scheduled` formula is
  immune by construction, because it reads storage rather than the stream. An
  author who cannot tolerate the gap has a supported answer without a new
  mechanism.
- **`F2.6` keeps real work.** Decision 4 puts configuration on
  `template_points`, and the engine resolves `asset → assets.templateId →
  template_points` at runtime, so `F2.4` is demonstrable against the running
  stack the day it lands rather than shipping dormant. What stays for `F2.6`
  is the authoring and lifecycle half: how a new template version's formula
  changes reach assets already built from the old one, per-asset overrides,
  and whatever backfill that implies.
- **`F2.2` is unchanged.** Because the `asset_points` row is created on first
  value rather than at instantiation, "derived points are never instantiated"
  remains true and no `F2.2` code path is touched.
- **The evaluator is a second frozen surface.** `packages/shared`'s AST was
  already the contract `F2.4`/`F2.5`/`F2.6`/`F2.8` build against; `evaluate()`
  joins it. `F2.5`'s live preview and the API's write-time validation must
  agree on what a formula computes, and one implementation is the only way
  they can.
- **Three new nullable columns is the whole schema cost**, against a
  standalone `calculation_definitions` table that ADR 0036 decision 5 already
  rejected for the same reason: it would duplicate `template_points` for a
  benefit nobody has asked for.
