# ADR 0056 — Tag-mapping bulk editor, the Excel mapping sheet, and point metadata (`F2.7`, folds `F4.56`)

## Status

Accepted — 2026-09-06, by the repository owner, the same day it was drafted at
`F2.7`'s start gate (AGENTS.md §10 step 2). The record was written as
*Proposed* and flipped here on the owner's word; nothing in it changed between
the two states.

The seven design questions below were ruled by the repository owner on
2026-09-06, in the gating conversation that produced this draft, before a line
of it was written. Each ruling is a numbered decision. Two rulings went
*against* the recommendation put to the owner — Q0 (the row's scope) and Q5
(what a commit does with a sheet that has errors in it) — and the *Gate
questions* section keeps the alternative each was chosen over, so a later
reader meets a deliberate choice rather than an accident.

**Accepted is not implemented.** Until `F2.7` lands, the ingest host stores a
sample exactly as the adapter emitted it, and a tag is mapped one row at a
time.

| Gate question | Ruling | Decision |
| --- | --- | --- |
| Q0 — how much of the client's sheet row 2 this row carries | All of it except parent/child, which is `F2.10` | 11 |
| Q1 — where scale, range and quality live, and where scaling runs | Template default + per-asset override; scaling in the ingest host | 1, 2, 4 |
| Q2 — what the host does with a sample outside the engineering range | Discard and count; no change to `telemetry.point_values` | 4, 5 |
| Q3 — what a per-point "quality flag" is | A two-valued policy on the protocol's own quality bit | 1, 4 |
| Q4 — what one workbook covers, and what seeds it | One location; the template pattern pre-fills unmapped rows | 6 |
| Q5 — what a commit does with a sheet that has errors | Preview first; commit writes the valid rows and skips the rest | 7 |
| Q6 — whether `F4.56` joins this row | Yes; one row, one pull request | 10 |

## Context

**The client asked for this in one sentence.** Row 2 of the IONSiTE NEXUS
feature sheet of 2026-08-22 (`docs/IonSiTE Nexus Features.xlsx`, mapped in
`docs/BACKLOG.md` §8.2) reads, verbatim:

> Map source instrument/PLC/BMS tags to platform tags and assets. Define
> units, scaling, engineering ranges, quality flags and asset hierarchy
> relatonship (parent / child). support bulk mapping/import

Row 11 of the same sheet raises the bar on *who* does it: "non-programmers
should be able to configure tag mapping". `F2.7` is the row the §8
comparison attached that detail to, and the parent/child clause was split off
to `F2.10` the same day because it re-opens ADR 0008's shape.

**What exists.** Three records already carve out the surfaces this ADR fills.

- ADR 0015 named `bms.template_points.source_data_key_pattern` as "the seed
  column for the bulk mapping sheet" and listed `F2.1 → F2.7` as a committed
  dependent. The pattern is a class rule — `CH{unit}_CHW_SUPPLY_T` — not a tag.
- ADR 0018 decision 3 moved the telemetry source to `bms.asset_points.rtu_id`,
  and decision 4 added `source_kind` with its CHECK (`measured` requires an
  RTU, the other three forbid one). An `asset_points` row *is* the mapping the
  ingest host reads: `(asset_id, point_key) ← (rtu_id, source_data_key)`.
- ADR 0016 §2 fixed the host's write path. `apps/ingest/src/host/normaliser.ts`
  resolves `source_data_key` to `(assetId, pointKey, unit)`, drops a sample the
  adapter flagged `good: false` and counts it in `SampleCounters.badQuality`,
  and writes `(time, asset_id, point_key, value, unit)` to
  `telemetry.point_values`. The point index is rebuilt wholesale every
  `INGEST_RELOAD_MS` (`main.ts`), so a new mapping takes effect without a
  restart.

Both editing surfaces are one row at a time. The Points tab (ADR 0038) edits
`sourceDataKeyPattern` per template point and its record explicitly left "the
tag-mapping bulk editor and the Excel mapping sheet" to `F2.7`. The Asset
Points page posts one `asset_points` row per form submit, and its create body
carries `assetId`, `pointKey`, `sourceDataKey`, `sensorCode`, `unit` and
nothing else; `rtu_id` is inherited from the asset at create time.

**What does not exist, anywhere.** There is no scaling, no engineering range
and no quality policy in the schema, the contracts or the host. Every measured
value is stored as the adapter delivered it, in the unit the mapping names.
`telemetry.point_values` has five columns and one range CHECK — the finite
guard migration `0031` added — and no quality column. ADR 0050 decision 2 says
so in as many words: *"There is no range concept to read"*, which is why it
defined "in safe range" for the health score as "no enabled, published
threshold rule fires". That definition is load-bearing for `E1.3`, and this ADR
must not move it by accident (decision 5).

**Why this is an ADR and not a row.** Three of the four attributes in the
client's sentence — scaling, engineering range, quality — are columns on two
tables, and a schema change is §10-gated. The owner ruled on 2026-09-06 that
`F2.7` carries the whole sentence rather than the no-schema minimum (a bulk
editor over the columns that exist), which is what makes this record necessary.

**`F4.56` is the same column seen from the other side.** The instantiate
dialog renders no field for `sourceDataKeyVars`, so a template whose pattern
carries any token other than `{asset_code}` cannot be instantiated from the
browser (`F4.56`, raised during `F2.6`). The mapping sheet's pre-fill has to
substitute the same tokens, from the same vocabulary
(`PATTERN_TOKEN = /\{([a-zA-Z0-9_]+)\}/g`, reserved var `asset_code`, in
`asset-templates-instantiate.service.ts`). Building the vocabulary once and
wiring it twice is cheaper than two rows, and `F4.56`'s own text says "worth
pairing with `F2.7`".

## Decision

**1. Five nullable metadata columns on `bms.template_points`, and the same
five on `bms.asset_points` (migration `0063`).**

| Column | Type | Meaning when resolved |
| --- | --- | --- |
| `scale_multiplier` | `double precision` | engineering value = raw × multiplier + offset |
| `scale_offset` | `double precision` | as above |
| `eng_min` | `double precision` | lower bound of the plausible engineering value, inclusive |
| `eng_max` | `double precision` | upper bound, inclusive |
| `quality_policy` | `varchar(16)` | `discard_bad` or `accept_bad` — what to do with a sample the protocol marks bad |

The template column is the class default; the asset column is the per-asset
override; the resolved value is `coalesce(asset_points.col, template_points.col)`
per column, joined through `assets.template_id` and `point_key`. This is ADR
0039 decisions 6 and 7's pattern for the calc-config columns on the same two
tables, reused rather than re-invented: five nullable columns and not one
`jsonb` blob, so a partial override restates one field, not a point. An asset
with no template has no default to inherit, and its own columns are the whole
value.

A resolved `NULL` means: multiplier `1`, offset `0`, no range test,
`discard_bad`. That is today's behaviour, spelled out, so every existing row
and every sheet cell left blank reads as "unchanged", not as a new rule.

**2. Row-level CHECKs on both tables, and a merged-pair check in the API.**
`eng_min < eng_max` where both are non-null; `scale_multiplier <> 0`;
`quality_policy IN ('discard_bad', 'accept_bad')`. These tables already carry
CHECKs (ADR 0018's `asset_points_source_ref_check`), and each of these three
is a within-row invariant, so the migrations-`0035`/`0036` argument for
leaving a rule to Zod alone does not apply. What a row CHECK **cannot** see is
the resolved pair: an asset override of `eng_min` beside an inherited
`eng_max` can invert the band while each row is valid on its own. That check
lives in `apps/api`'s Zod layer, exactly where ADR 0039 put the resolved
trigger/interval check for the same reason, and its refusal names the
inherited value it conflicts with.

**3. The contracts and the write bodies carry the five fields.**
`templatePointBodySchema` (`asset-templates.schema.ts`) and
`createAssetPointBodySchema` / `updateAssetPointBodySchema`
(`asset-points.schema.ts`) gain the five as `.nullish()`, with the bounds in
decision 2 mirrored; the DTOs in `packages/shared/src/contracts/admin.ts` gain
them under ADR 0030's rule that every response type is `z.infer`red. The
create body also gains an optional `rtuId`, because the sheet maps a point to
an RTU by name (decision 6) and the single-row route must be able to say the
same thing. A `computed` point refuses all five: a derived value has no
instrument to scale.

**4. The ingest host applies the resolved metadata, in a fixed order, and
counts what it drops.** `BINDING_QUERY` (`apps/ingest/src/host/bindings.ts`)
selects the five coalesced columns; `PointTarget` carries them beside `unit`.
`resolveSamples` applies them per target, in this order:

1. **Quality policy.** `good === false` under `discard_bad` → `badQuality`,
   drop (today's rule). Under `accept_bad` the sample continues.
2. **Scale.** `value' = value × multiplier + offset`.
3. **Finite.** `value'` non-finite → `nonFinite`, drop. Scaling can overflow;
   the test runs on what would be stored.
4. **Range.** `eng_min`/`eng_max` set and `value'` outside → **`outOfRange`**,
   a new `SampleCounters` bucket, drop.

`outOfRange` joins the dropped-sample sum `main.ts` logs per batch. `F3.16`
(device health, ⬜) is where the counters become operator-facing; this ADR
does not build that surface. The order is a decision, not an implementation
detail: a policy that stored a bad-quality sample only to have the range test
drop it would be indistinguishable from `discard_bad` in the counters.

Scaling applies to **adapter samples only**. `F1.9`'s file import and `F1.8`'s
manual entry carry engineering values typed or exported by a person, and are
written as they are. Nothing in `apps/api`'s telemetry write path reads the
five columns.

**5. `telemetry.point_values` does not change, and ADR 0050 is not amended.**
No quality column, no stored range mark. An out-of-range sample leaves a
counter, not a row. The engineering range is an *instrument plausibility
band* — the span a sensor can physically report — and not an operating limit;
"in safe range" for the health score stays ADR 0050 decision 2's predicate
over threshold rules. A later row that wants range-based goodness amends
ADR 0050 explicitly and says which of the two bands it means.

**6. Export: one workbook per location, seeded from the template pattern.**
`GET /api/v1/admin/asset-points/mapping-sheet.xlsx?locationId=<uuid>`, gated
by `canManageLocation`. One sheet, `MAPPINGS`, with a fixed header row in this
order:

```
asset_code · asset_name · point_key · rtu_code · source_data_key · unit ·
scale_multiplier · scale_offset · eng_min · eng_max · quality_policy · active
```

The row set, for every active asset in the location, is the union of:

- every existing `asset_points` row whose `source_kind` is not `computed`,
  with its stored values (blank where the column is `NULL`, i.e. inherited);
- every `measured` template point of the asset's pinned template version
  that has **no** `asset_points` row yet — the pre-fill. `source_data_key` is
  the pattern with `{asset_code}` substituted and every other token left
  literal (`CH{unit}_CHW_SUPPLY_T` for an un-instantiated var), `rtu_code`
  is the asset's RTU if it has one, `unit` is the template unit, the five
  metadata cells are blank.

Cells are written as literals through `aoa_to_sheet`, the way the onboarding
template and the audit export already are; per ADR 0026's XLSX finding, the
safety is the absence of any `<f>` element, and the import (decision 7) reads
every cell as text before it parses a number. Derived points are absent by
construction: a formula has no source tag, and its per-asset override is the
`F2.6` panel's business, not this sheet's.

**7. Import: preview, then commit; the commit writes the valid rows and skips
the rest.** Two routes under the same controller, both `multipart/form-data`
with one file, `.xlsx` or `.csv`, read through `XLSX.read` as `F1.9` does:

- `POST /api/v1/admin/asset-points/mapping-sheet/preview?locationId=` parses
  the sheet and returns `MappingSheetPreviewDto`: `creates[]`, `updates[]`
  (field-level, old and new), `unchanged` (a count), and `errors[]`, each
  naming `row`, `column`, a stable `code` and a message. **Nothing is
  written.**
- `POST /api/v1/admin/asset-points/mapping-sheet/commit?locationId=` parses
  the same sheet again, writes every row that has no error in **one
  transaction**, and returns `{ applied: { created, updated }, skipped:
  errors[] }`. "Valid rows only" is the owner's ruling at Q5 over the
  all-or-nothing recommendation; it is about *which rows* are written, not
  about partial writes — if the transaction fails, nothing is written.

The upsert key is `(asset_code, point_key)` within the location. Rules a row
must pass: the asset exists in that location and is active; `point_key`
resolves against the catalog or the pinned template's points; `rtu_code` is
blank or names an RTU the caller may manage, and a non-blank one sets
`rtu_id` and `source_kind = 'measured'`, a blank one leaves an unmapped row
`unmapped` (ADR 0018's CHECK, not re-derived); a `computed` point is refused;
the five metadata cells are blank (`NULL`, inherit) or pass decision 2 as
resolved against the template default; `active = false` deactivates rather
than deletes. The header row must match decision 6's exactly, and an unknown
column is an error on the file, not a row — the sheet is `.strict()` in the
same sense the bodies are. The row cap is `MAX_IMPORT_ROWS = 20_000`, `F1.9`'s
number, and a sheet over it is refused whole. Every write goes through
`MasterDataAuditService` as the single-row routes' writes do. Importing the
sheet a location just exported produces zero creates and zero updates; that
round-trip is a test, not a hope.

**8. An in-app bulk editor on the Asset Points page, over the same fields.**
Row multi-select and an "Edit selected" panel that sets any subset of `unit`,
the five metadata columns and `active` on every selected row, through
`POST /api/v1/admin/asset-points/bulk-update` with `{ ids: uuid[], patch }`,
at most 500 ids. Unlike the sheet this is **all-or-nothing**: the person is
looking at the rows they selected, and a half-applied selection with no file
to re-import would be worse than a refusal that names the row. If the owner
wants the two surfaces to agree, this is the decision to flip, and it is
recorded here so that flipping it is a one-line amendment.

**9. The Points tab grid gains the five template defaults**
(`template-points-grid.ts`, `points-tab.tsx`), on draft versions only — ADR
0039's immutability of a published version is untouched, and a bulk import
*of template points* is not built (decision 11). The stock template viewer
shows the five read-only when a stock entry sets them.

**10. The instantiate dialog collects pattern variables — `F4.56` closes
here.** The dialog scans the pinned version's `sourceDataKeyPattern`s with the
service's own `PATTERN_TOKEN`, renders one input per distinct token other than
the reserved `asset_code`, and sends `sourceDataKeyVars`. The vars are still
not persisted (ADR 0039 Q-A stands: migration resolves `{asset_code}` only);
the mapping sheet is now the correction path for a tag that was instantiated
wrong, which is the state `F4.56` had no route out of.

**11. Scope limits.** Not in this ADR: the campus/township tier and asset
parent/child (`F2.10`, its own ADR, because it re-opens ADR 0008); a stored
quality mark on `telemetry.point_values`; bulk import of template points;
scaling of imported or hand-entered values; any change to how a `computed`
point is bound or evaluated.

## Gate questions

### Q0 — Does `F2.7` carry all of sheet row 2, or the no-schema minimum? — **ruled 2026-09-06: all of it except parent/child**

The recommendation put to the owner was the minimum: a bulk editor and a
sheet over the columns that exist, no migration, no ADR. The owner chose the
full sentence. The consequence is this record, decisions 1–5, and the `apps/
ingest` work — roughly a third of the row's effort that the minimum did not
have.

### Q1 — Where do scale, range and quality live, and where does scaling run? — **ruled 2026-09-06: template default + asset override; scaling in the host**

Three shapes were offered. *Asset-only* (five columns on `asset_points`, no
template default) is one migration smaller and leaves the Points tab alone,
but every chiller instantiated from one template would restate the same
4–20 mA scaling by hand, which is the model-once-deploy-many failure ADR
0015 exists to prevent. *`jsonb meta` on both tables* is the cheapest
migration and enforces nothing; `BINDING_QUERY` would read JSON on the hot
path. The ruled shape is ADR 0039's, already on these tables, already
understood by the code that merges overrides.

Scaling runs in the host, not at read time, because the store holds
engineering values today and every reader — the calc engine, the rules, the
dashboards, the reports, the continuous aggregates — assumes it does.
Read-time scaling would have to be applied in all of them.

### Q2 — What does the host do with a scaled sample outside the engineering range? — **ruled 2026-09-06: discard and count**

*Store with a quality mark* preserves evidence but adds a column to a
hypertable with continuous aggregates over it, and then every reader must
decide what a bad row means to it — the largest change on the table. *Clamp*
fabricates a value the instrument did not report. *Discard and count* is the
rule the host already applies to a bad-quality sample, extended by one
counter; ADR 0050 stays untouched. The cost is recorded in *Consequences*: a
mistyped range drops data silently until `F3.16` shows the counter.

### Q3 — What is a per-point "quality flag"? — **ruled 2026-09-06: a two-valued policy**

The client's word could mean a stored per-sample quality (ruled out at Q2), a
read-only report of drop counters in the export, or a per-point rule for the
protocol's own quality bit. The last is the only one that gives the sheet a
cell with an effect and costs one column and one branch. `accept_bad` exists
for devices that flag every read uncertain — a known Modbus-gateway
behaviour — where the alternative is no data at all. Deferring the attribute
was offered and not taken.

### Q4 — What does one workbook cover, and what seeds it? — **ruled 2026-09-06: one location, seeded from the template pattern**

*Per template version* edits the class rule and leaves real tags one row at a
time — a smaller file that does not deliver bulk mapping. *Both sheets in one
file* adds a read-only templates sheet the import ignores; it can be added
later without a decision. *Per location* edits the rows the ingest host reads,
and the pre-fill from `source_data_key_pattern` is the sentence ADR 0015 wrote
for this column.

### Q5 — What does a commit do with a sheet that has errors? — **ruled 2026-09-06: write the valid rows, skip the rest**

The recommendation was all-or-nothing — the template migration preview and
the onboarding validate/commit pair both refuse a batch with one bad row. The
owner ruled for valid-rows-only after a preview: a 3,000-row sheet with four
typos maps 2,996 tags now and returns the four by row and column. The
preview step is what makes this safe — the person has seen the four before
they commit — and it is why decision 7 keeps preview mandatory rather than
optional. The in-app bulk editor (decision 8) stays all-or-nothing because it
has no preview and no file to re-import; that asymmetry is deliberate and
flippable.

### Q6 — Does `F4.56` join this row? — **ruled 2026-09-06: yes**

One token vocabulary, wired into the dialog and the pre-fill in one pull
request, against a separate Track F row that would have re-read the same
service. Effort grows by `F4.56`'s own `1–2`.

## Dependencies

**No new package.** `xlsx` is already a dependency of `apps/api` (the
onboarding template, `F1.9`'s import, the audit and reports exports), so
§9.4 is not triggered and the dependency hook should stay silent. Everything
else is `drizzle-orm/pg-core` primitives already imported by `bms-schema.ts`
and `zod` under ADR 0030.

Touched: `packages/db` (migration `0063`, schema, seed compatibility),
`packages/shared/src/contracts/admin.ts`, `apps/api/src/admin/asset-points/`
and `asset-templates/asset-templates.schema.ts`, `apps/ingest/src/host/`
(`bindings.ts`, `normaliser.ts`, `main.ts` counters), `apps/web` (the Asset
Points page, `points-tab.tsx`, `template-points-grid.ts`, the instantiate
dialog in `asset-template-detail-page.tsx`).

## Consequences

**Positive.** Sheet row 2 is met in full except the hierarchy clause, which has
its own row and will have its own record. `F3.23` (P0, the agent mapping
source↔tag by Q&A) loses its last blocker. `F4.56` closes. A template
instantiated with a wrong tag has a correction path that does not involve
deleting the asset.

**Negative, accepted knowingly.**

- A mistyped engineering range drops data with no signal but a counter, and
  the counter is operator-facing only when `F3.16` lands. Until then it is in
  the host log.
- `accept_bad` stores a sample the protocol marked bad with no mark on the
  row. That is the trade Q3 made, and the policy defaults off.
- `BINDING_QUERY` grows a join to `template_points` through
  `assets.template_id`. The `F2.9` lesson applies — *measure a query before
  believing its shape* — and the plan carries an `EXPLAIN` on the binding
  query at the seeded row count as a gate, not a hope.
- Two bulk surfaces with two failure rules (decision 8). Recorded so it is
  found as a choice.

**Effort.** `F2.7` was `4–5` before this record and `F4.56` is `1–2`. The
schema and ingest work Q0 added, the two import routes and the in-app editor
put the row at **`7–9`**, to be re-set at the plan gate.

**Owed on merge, in a separate `chore(agents):` PR per §9.10 — never as a side
effect of the feature commit:**

- `AGENTS.md`: a §2 row for the mapping sheet and the point metadata; the
  status line.
- `docs/BACKLOG.md`: `F2.7` and `F4.56` → ✅; `F3.23`'s dependency line
  reads as satisfied; `F3.16` gains a sentence naming `outOfRange` as one of
  the counters it surfaces.
- `docs/roadmap.md`: the Track B line that still lists `F2.7` as carried.
- Pointers, one sentence each, in ADR 0015 (the seed column is now used as
  written), ADR 0038 (the `F2.7` exclusion is discharged), ADR 0050 (a range
  column exists and is *not* the safe range), and the `F4.56` row.
- **An amendment to decision 3 for the owner's plan-gate ruling Q-H
  (2026-09-06):** `rtuId` is accepted on the *update* body too (`uuid` wires,
  `null` unwires, absent leaves the wiring alone), and the asset-point read
  DTO surfaces `rtuId` so the wiring is observable in the response. Both
  shipped in PR 1 under the plan's design decision 14; this record is what the
  sweep amends so that the ADR and the code agree.
- **An amendment to decision 2 for a fourth within-row rule:** the four numeric
  metadata columns are constrained to *finite* values by migration `0064`
  (`<table>_point_metadata_finite_check`, the `0031` range form), because
  PostgreSQL's `NaN` ordering lets `0063`'s three rules admit `NaN` and both
  infinities. Found by the PR 1 migration and security reviews; the API layer
  had `.finite()` from the start, so this closes the direct-writer door before
  PR 2's importer opens it.

## Verification

Every layer, on the running stack, per AGENTS.md §4.6 — a green suite is not a
deployment:

- **Database.** Migration `0063` applied on a cold-start scratch database
  (`docker compose down -v`, init, roles, migrate, seed), then the three CHECKs
  each refused by a direct `INSERT`; the seed's row counts unchanged.
- **Host.** A pure `resolveSamples` spec for each branch of decision 4 in
  order, including a scaled value that overflows to `Infinity` and lands in
  `nonFinite`, not `outOfRange`; an integration spec that maps a point with a
  multiplier, publishes one MQTT sample through the compose `phe` profile, and
  reads the scaled value from `telemetry.point_values`.
- **API.** An integration spec that exports a seeded location, imports the
  file unchanged and asserts zero creates and zero updates; one that imports a
  sheet with two bad rows and asserts the good rows are written and the two
  come back by row and column; one that asserts an unknown header is refused
  whole.
- **Web.** jsdom specs for the dialog's token scan and the preview table's
  per-cell error rendering; then `browser-verifier` for the claims only a
  browser holds — the export downloads, a commit persists across a hard
  reload with the served bundle hash changed, a `{unit}` template can be
  instantiated from the dialog for the first time.

Reviews before merge: `code-reviewer`, `security-reviewer` (a file upload and
a spreadsheet parser are §9.6 surfaces), `agents-compliance-reviewer`, and
`migration-reviewer` for `0063`.
