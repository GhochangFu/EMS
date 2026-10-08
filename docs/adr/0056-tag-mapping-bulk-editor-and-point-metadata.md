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
- An amendment to decision 3 for the owner's plan-gate ruling Q-H, and one to
  decision 2 for the finite rule — **both written below as Amendments 1 and 2
  on 2026-09-07**, the day the sweep landed.

**Done in the sweep, 2026-09-07** (`chore(agents):` PR after #337 and #342):
every item above, plus the fourteen deferred rows the plan filed as backlog
rows `F2.24`–`F2.31` and `F4.97`–`F4.99`.

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

## Amendment 1 — `rtuId` on the update body and in the read DTO (owner ruling Q-H, 2026-09-06; recorded 2026-09-07)

Decision 3 said "the create body also gains an optional `rtuId`". At the plan
gate the owner ruled (Q-H) that the single-row route must be able to do what
the sheet can, so the **update** body accepts `rtuId` too: a `uuid` wires the
point (the RTU asserted to be in the asset's location, `source_kind =
'measured'`), `null` unwires it (`rtu_id NULL`; `measured` → `unmapped`, a
`manual` row stays `manual`), absent leaves the wiring alone; a `computed` row
refuses it on presence. And because a wiring that cannot be read back is not
observable, the asset-point **read DTO** surfaces `rtuId` (ADR 0018 decision 3's
column, never exposed before). Both shipped in PR 1 (#337, `22d4cea`) under the
plan's design decision 14; the browser run on the merged stack read `rtuId`
back on wire and unwire. ADR 0018's CHECK is unchanged — every pair the update
path writes satisfies it.

## Amendment 2 — Decision 2 gains a fourth within-row rule: finite values (migration `0064`, 2026-09-06; recorded 2026-09-07)

Decision 2's three CHECKs — `eng_min < eng_max`, `scale_multiplier <> 0`, the
policy enum — **admit `NaN` and both infinities**, because PostgreSQL defines
`NaN` as equal to itself and greater than every other float so that float
columns can be indexed: `'NaN'::float8 <> 0` and `100 < 'NaN'::float8` are
both true. The PR 1 migration and security reviews measured it. Migration
`0064_point_metadata_finite_check` adds one constraint per table over the four
numeric columns in `0031`'s range form (`col > '-Infinity' AND col <
'Infinity'`, NULL-permissive per column), the same guarantee `0031` moved into
the database for `telemetry.point_values.value`. The API layer had `.finite()`
from the start, so the exposure was direct writers — and PR 2's importer,
which reads every cell as text and parses a number, is exactly such a writer;
it now also accepts only a plain decimal literal (`0x10` is `number_invalid`,
not 16). Decision 5 is unchanged: a non-finite value is refused at the door,
never stored with a mark.

## Amendment 3 — the single-row form, the workbook header, and the merged pair at migrate (`F2.25`–`F2.28`, `F2.30`, `F2.31`)

**Status: Accepted — 2026-10-09** (owner, after review; proposed 2026-10-08). Source: owner rulings 2026-10-08, the Track B
batch. Drafted before any implementation code and accepted on the
owner's word, as this record did. One amendment carries three parts because
the three build clusters share this record and land in that order of
dependence: part A is the Asset Points form (`F2.25`, `F2.27`, `F2.31`), part B
is the workbook (`F2.26`, `F2.28`), part C is the template side (`F2.30`). It
lands in its own docs-only pull request first, and each cluster branch starts
from it. Line citations are to `main` at `c60b8e00`.

`F2.24` (the version delta reports a changed default) needs no amendment:
decision 2 of ADR 0039 ("no blind apply") already covers it, as it covered the
`F2.9` finding-31 shape on the derived side.

### Part A — the Asset Points form reads and writes what the host applies

**A1 — the read DTO carries the pinned template's five (`F2.25`).**
`adminAssetPointDtoSchema` (`packages/shared/src/contracts/admin.ts:104`)
today spreads `pointMetadataShape`: the asset's own override, as stored, `null`
meaning "inherit". It gains one field, `templateDefaults:
pointMetadataFieldsSchema.nullable()` — the five defaults the asset's
**pinned** template version declares for that `point_key`, nested and not
spread, because the five names are already taken by the override. `null` means
there is nothing to inherit: the asset has no template, or its pinned version
does not declare the key. An object of five `null`s means the key is declared
with no defaults. The response carries the two inputs and not their result;
the web derives the effective value `coalesce(own, template)` per field — the
rule `BINDING_QUERY` applies (`apps/ingest/src/host/bindings.ts:123-127`) —
and an "inherited" marker where the shown value came from the template. This
was a technical default the owner took without a question.

Every asset-point read projects through `mapAssetPointRow`
(`apps/api/src/admin/asset-points/asset-point-row.ts:26`), and the join to
`bms.template_points` is on `(assets.template_id, point_key)`, which
`template_points_template_point_key_unique` (migration `0024`) makes at most
one row. The non-admin read (`AssetsService.listPoints`,
`apps/api/src/assets/assets.service.ts:108`) narrows the DTO with
`pickAssetPointPickerRow` and does not gain the field.

**A2 — a location-scoped RTU select on the Add/Edit dialog (`F2.27`).** The
dialog offers the RTUs of the asset's location. On **create**, blank means
omit, and the create route already inherits the asset's own gateway
(`asset-points.service.ts:182`, `body.rtuId ?? ownerAsset.rtuId`). On **edit**,
blank means `rtuId: null`, which unwires the point (Amendment 1;
`resolveUpdatedWiring`, `asset-points.service.ts:617-622`) — **and the dialog
sends it only when the field is dirty.** The update route refuses `rtuId` on a
`computed` row on presence, `null` included (`asset-points.service.ts:280`),
so a dialog that always sent the field would make every computed row
uneditable. A stored RTU that is no longer among the location's RTUs is kept
as a selectable option, so a controlled select does not fall back to blank and
unwire the point on an untouched save.

**A3 — the dialog sends a dirty-field diff (`F2.31`).** Today the edit dialog
states all five metadata fields on every save
(`apps/web/src/pages/admin/asset-points-page.tsx:314`, `metadataWriteFrom(form,
"edit")`, which writes `null` for every empty box, `:123-140`). The service
writes only the fields a body states (`statedPointMetadata`,
`asset-points.service.ts:749`), so two concurrent edits of different fields
do not overwrite each other — but a form save states every field and loses
that protection. The dialog now compares the form with the loaded row and
sends only the keys that changed. An emptied box on a field that held a value
sends `null`; a required field (`pointKey`, `sourceDataKey`) is never sent
empty; an unchanged form sends no request.

**Not changed by part A.** The `PATCH` body (`sensorCode` and `unit` stay
`optional`, not `nullable`, so the dialog still cannot clear them — a gap the
C1 plan records for a later row), the bulk editor (decision 8), and the five
inputs' placeholders.

### Part B — the workbook

**B1 — decision 7's exact-header rule is replaced by a tolerant header
(`F2.28`).** Decision 7 reads "The header row must match decision 6's
exactly". The parser enforces that position by position
(`headerProblem`, `apps/api/src/admin/asset-points/mapping-sheet-rows.ts:136`),
and `MAPPING_SHEET_HEADERS`' docblock says the same
(`packages/shared/src/contracts/mapping-sheet.ts:27-32`). The rule becomes:

1. every known column may appear in **any order**; the import reads each
   cell by the column's resolved index, not by its position;
2. an **unknown** header is refused, and so is a blank header cell between two
   known ones — trailing blank header cells stay ignored, as today
   (`mapping-sheet-rows.ts:130-133`), because Excel adds them on a re-save;
3. a **duplicate** header is refused;
4. a **missing** known column is refused, unless the column is listed in a new
   constant `MAPPING_SHEET_OPTIONAL_HEADERS` in `@bms/shared`. The set is
   **empty** today. It is the lever a later row pulls when it adds a column
   (for example `sensor_code`), so that a sheet saved before that row still
   imports.

Every refusal is still `header_mismatch` on the file, never on a row, and its
message still names only the offending header (§9.6). The error vocabulary
does not grow. "Unknown refused" keeps the property decision 7 was written
for: a misspelt header can never be read as a blank column. Decision 6's
export order is unchanged; it is now the order the export writes, not the only
order the import accepts. A `.csv` upload follows the same rule.

A version marker (a sheet-name suffix such as `MAPPINGS_V1`, or a tag in the
first row) was the alternative the `F2.28` row named. It was not taken: a
`.csv` has no sheet name to carry a suffix, a first-row tag shifts every row
number in every error, and neither answers what a later column means for a
sheet saved before it.

**B2 — a read-only `TEMPLATES` sheet, which the import ignores (`F2.26`).**
Decision 6's "One sheet, `MAPPINGS`" gains a second sheet, written after
`MAPPINGS` so that Excel opens on the editable one. It lists, once per
template version pinned by an **active** asset of the location, that
version's `measured` points with their `source_data_key_pattern` written
literally (no token substituted) and the five class defaults. Gate question Q4
recorded this option as one that "can be added later without a decision";
this part records it rather than rules it. The import already selects the
sheet by name for an `.xlsx` (`mapping-sheet-rows.ts:323`,
`book.Sheets[MAPPING_SHEET_NAME]`), so a `TEMPLATES` sheet is ignored by
construction; the build makes that a test, including a workbook with
`TEMPLATES` first. The cells are literals, under the same no-formula rule as
`MAPPINGS` (decision 6, ADR 0026).

### Part C — the merged pair is re-checked at migrate (`F2.30`)

**C1 — the decision.** When `migrate` moves an asset onto a version, the
asset's stored metadata override is re-validated against the **target**
version's defaults, with the same `validateMergedPointMetadata`
(`apps/api/src/admin/asset-points/point-metadata.schema.ts:159`) the
asset-side update and bulk update run (`asset-points.service.ts:313`, `:466`),
imported and not restated. An override whose merged pair the target inverts
is a refusal with the new reason **`metadata_override_invalid_on_target`**.
The preview names the asset, the point and both bounds, and says that the
repair is to clear or restate the override (Asset Points, bulk editor) and
then migrate. `migrate` answers 409 and **no pin moves** — the existing rule
that a refused plan writes nothing (`asset-templates-migrate.service.ts:320-330`).
The check runs in `buildPlan`, before any transaction opens, beside the calc
precedent of the same shape, `refuseOverridesThatDoNotSurvive` (`F2.9` Task
12b; `asset-templates-migrate.service.ts:841`; reason
`calc_override_invalid_on_target`, `admin.ts:717`). A `computed` row is not
checked (it carries no instrument metadata, `asset-points.service.ts:280`),
nor a key the target does not declare `measured`.

**C2 — why the template save is not the place.** The `F2.30` row offered
"refuse the template save naming the assets". At save time there are no
affected assets, and the code makes that a fact rather than a likelihood:

- a template's points can be edited only on a draft (`assertDraft`,
  `apps/api/src/admin/asset-templates/asset-templates.service.ts:517`, called
  by `update` at `:231`);
- an asset can be instantiated only from a published version
  (`asset-templates-instantiate-core.ts:132`), and migrated only onto one
  (`asset-templates-migrate.service.ts:473`);
- in `apps/api`, the only write of `assets.template_id` after the insert is
  `migrate` (`asset-templates-migrate.service.ts:357`).

So a new default reaches a stored override at exactly one moment: when
`migrate` moves the pin onto the version that carries it. A check at save time
would be an advisory about a migration that may never happen, and the migrate
check would still be needed. Accepting the migration and listing the affected
rows for repair afterwards was the other option, and it was not taken: from
the pin move until the repair, the ingest host would discard every sample of
that point as out of range (decision 4), and the bulk editor would refuse even
a bare `{ active: false }` on that row (`F2.7` plan correction 48).

### Amended records

- **Decision 7** — its exact-header sentence is replaced by B1.
- **Decision 6** — "One sheet, `MAPPINGS`" gains the `TEMPLATES` sheet of B2.
- **Decision 2** — its merged-pair check, asked "from the asset side only",
  gains a second run at migrate (C1). The row CHECKs are unchanged.
- **Decision 10** and decision 6's "every other token left literal" are
  qualified by ADR 0039 Amendment 1 (`F2.29`, same batch), for assets that
  store their variables. That amendment carries the change; this one only
  points to it.
- **ADR 0092** names `F2.28` twice (a rejected option and its *Deferred*
  list). Neither binds this answer, and ADR 0092 is not amended.
