# ADR 0036 — Calculation formula DSL + definition schema (`F2.3`)

## Status

Accepted — 2026-08-20, by the repository owner, the same day it was drafted
for `F2.3`.

## Context

`F2.3` is a Wave 0 ⭐ enabler (`docs/BACKLOG.md:385`) with no `Depends` entry,
but it has no ADR. ADR 0019 named the gap directly when it built the KPI
overlay it cannot finish on its own behalf:

> `expression` is opaque: `F2.3` owns formula syntax and has not frozen it, so
> `dialect` stays `"unvalidated"` until it does.
> (`packages/shared/src/asset-template-content.ts:82`)

Two places in the schema already wait on this decision:

1. **`asset_templates.content.kpis[]`** (ADR 0019, `templateKpiSchema` in
   `apps/api/src/admin/asset-templates/asset-templates-content.schema.ts:179`)
   — `expression: string`, `dialect: z.literal("unvalidated")`, `pointKeys:
   string[]` carried separately "so the reference check possible without a
   formula parser" (ADR 0019's own words). No parser exists yet, so no
   `expression` has ever been validated as anything but a bounded string.
2. **`template_points`** (ADR 0015, `packages/db/src/schema/bms-schema.ts:373`)
   — `kind` is `measured | derived`. A derived point is "computed by the calc
   engine (`F2.6`)" per that table's own comment, but the table carries **no
   formula column at all**. `F2.2` already refuses to instantiate a derived
   point into `asset_points` (there is no honest `source_data_key` for a
   computed tag); nothing today records *how* it is computed.

The only calculation that actually ships is `estimatePue()`
(`apps/api/src/dashboard/dashboard.service.ts:535`,
`apps/api/src/reports/reports.service.ts:325`, duplicated in both places):

```ts
private estimatePue(totalKw: number): number {
  if (totalKw <= 0) return 1.0;
  const raw = 1.22 + Math.min(0.45, totalKw / 12_000);
  ...
}
```

This is **scalar arithmetic on an already-aggregated number**, not a
time-windowed query — the SUM/AVG over telemetry happens in SQL before this
function ever runs. `F2.8` ("replace hardcoded PUE SQL with user-defined
derived tags") is the closest thing to a requirements document this decision
has, and it confirms the DSL only needs to express arithmetic over named
point values, not time-window aggregation. Windowing (what "the current
value of a point" means — latest sample, rolling average, …) is a `F2.4`
execution-engine concern, not a grammar concern, and stays out of this ADR.

## Decision

**1. Grammar: a small, hand-rolled scalar-arithmetic DSL, dialect
`"bms-calc-v1"`.** No general-purpose scripting, no assignment, no control
flow, no string operations — arithmetic over point references, numeric
literals, and a whitelisted function set.

```
expression := term (("+" | "-") term)*
term       := factor (("*" | "/") factor)*
factor     := number | pointRef | "(" expression ")" | "-" factor | call
call       := fnName "(" expression ("," expression)* ")"
pointRef   := "{" pointKey "}"
fnName     := "min" | "max" | "abs" | "round" | "clamp"
number     := /-?\d+(\.\d+)?/   // no exponent form, to keep the tokenizer small
```

**2. Point references use `{pointKey}` brace syntax, not bare identifiers.**
`template_points.point_key` / KPI `pointKeys` entries are unconstrained
strings (`pointKeyCode = z.string().min(1).max(128)`, no charset limit), so a
bare-identifier grammar would be ambiguous or reject legal point keys. Brace
delimiting sidesteps that and matches an existing convention in this same
module — `template_points.source_data_key_pattern` already uses `{unit}`-style
token substitution (`asset-templates.schema.ts:100`). Example:

```
({SUB_METER_1_KWH} + {SUB_METER_2_KWH}) / {TOTAL_KWH}
```

**3. No new npm dependency.** The grammar above is small enough for a
recursive-descent parser in perhaps 150–200 lines: two-level precedence, one
delimiter form for references, five whitelisted function names. A
hand-rolled parser is not just the §9.4-avoiding option — given the input is
always user-authored (an org admin authoring a template), a grammar this repo
fully controls is the safer choice on its own merits. `eval`/`new
Function`/`vm` are never used at any point, parse-time or (later, `F2.4`)
evaluation-time.

**4. Parser lives in `packages/shared`, not `apps/api`.** ADR 0030 gave
`@bms/shared` a runtime; both the API (write-time validation) and the web
authoring UI (`F2.5`, live preview) need the same grammar, and duplicating a
parser invites drift the same way the pre-ADR-0026 CSV escaping duplication
did. Proposed location: `packages/shared/src/calc-dsl/` (tokenizer, parser,
AST types, a pure `validate(expression, knownRefs): ParseResult` — no
evaluator; see decision 7).

**5. `template_points` gains two nullable columns, no new table.** The
backlog title says "definition schema", and the two extension points named
in Context already are that schema — inventing a standalone
`calculation_definitions` table would duplicate `template_points`/`kpis[]`
for no benefit `F2.6`/`F2.8` have asked for.

```ts
// packages/db/src/schema/bms-schema.ts — templatePoints
formula: text("formula"),                          // nullable
formulaDialect: varchar("formula_dialect", { length: 32 }),  // nullable
```

Enforced at the Zod layer, not a DB `CHECK`: `kind === "derived"` requires
`formula` non-empty and `formulaDialect === "bms-calc-v1"`; `kind ===
"measured"` requires both absent. This mirrors the existing precedent for a
two-column exclusivity invariant in this same module —
`instantiateAssetsBodySchema`'s `rtuId`/`locationId` pair
(`asset-templates.schema.ts:127`) — which is enforced in Zod, not DDL,
because both write paths (`create`/`update`) already funnel through one
validator.

**6. `templateKpiSchema.dialect` widens from a locked literal to an enum,
and `"bms-calc-v1"` triggers real parsing.**

```ts
dialect: z.enum(["unvalidated", "bms-calc-v1"]),
```

When `dialect === "bms-calc-v1"`, `expression` is parsed with the `F2.3`
parser and rejected on any syntax error or unknown function name.
`pointKeys` stops being an unverified bookkeeping array and becomes an
actual cross-check: every `{ref}` inside `expression` must appear in
`pointKeys`, and every entry in `pointKeys` must be used at least once — a
tighter version of the "reference check possible without a parser" ADR 0019
built room for. Existing `"unvalidated"` rows keep validating exactly as
today; nothing here forces a migration of stored content (`asset_templates`
rows written under `E1.7` before this ADR keep parsing as `"unvalidated"`
until an author explicitly re-saves them under the new dialect).

**7. A derived `template_points.formula` may reference measured points
only, never another derived point.** Chained/derived-to-derived formulas
would need dependency-ordering (topological evaluation, cycle detection) —
that is execution-engine complexity `F2.4` may or may not ever need, and
deciding it now would be inventing `F2.4`'s scope on its own behalf, the
exact trap ADR 0019 named for the sections it declined to model. The `F2.3`
validator rejects a `{ref}` that resolves to a `kind: "derived"` point in the
same template.

**8. Bounds, mirroring the existing KPI caps** (`asset-templates-content.schema.ts`):
`expression` ≤ 1000 chars (already the cap on `TemplateKpi.expression`; same
cap applied to `template_points.formula`), ≤ 20 distinct point references
(`MAX_KPI_POINT_REFS`, reused), and a parser recursion-depth guard of 64 —
defense in depth against a pathological paste, not a limit any legitimate
formula should approach.

## Not in this ADR

- **No evaluator.** Nothing here computes a value from a parsed expression
  against live telemetry — that is `F2.4` (calc execution engine), including
  what "the current value of `{X}`" means (latest sample vs. rolling window),
  null/stale-input behaviour, and divide-by-zero handling.
- **No scheduling, no `asset_points` writes for derived tags.** Still `F2.4`.
- **No migration of existing `dialect: "unvalidated"` KPI content.** Rows
  stay valid as-is; re-validation only happens on the next author write.
- **No chained derived-point formulas.** Decision 7 defers this explicitly;
  if `F2.4` needs it, that is its own ADR amendment, not an implicit
  extension of this grammar.
- **No `F2.6`/`F2.8` wiring.** This ADR defines the DSL and where formulas
  are stored; it does not touch the PUE calculation or any other running
  code path.

## Dependencies

None. No `package.json` change in any workspace — the parser is hand-rolled
in `packages/shared`, which already has a runtime dependency on `zod`
(ADR 0030) and needs nothing further for a tokenizer/recursive-descent
parser. §9.4 is not triggered.

## Consequences

- `F2.4`, `F2.5`, `F2.6`, `F2.8` inherit a frozen grammar and a shared parser
  package rather than each guessing at one — the situation ADR 0019 avoided
  creating for `kpis[]` under Option A, applied here on purpose since `F2.3`
  is the item that *does* own this vocabulary.
- The migration adding `template_points.formula`/`formula_dialect` is
  additive and nullable — safe forward-only, no backfill. Implementation
  should confirm no existing `kind: "derived"` rows exist pre-migration
  (none are in seed data as of this ADR); if any do, the Zod-layer
  enforcement in decision 5 makes them invalid on the next write, not
  silently accepted.
- Authors get a real error message on a malformed formula at save time
  instead of an opaque string that fails silently at some future evaluation
  step — a materially better authoring experience for `F2.5`.
- The brace-reference syntax (decision 2) is a small but real UX choice:
  `{POINT_KEY}` is more verbose than a bare identifier but never collides
  with an unusual `point_key` value, and needs no escaping rules.
