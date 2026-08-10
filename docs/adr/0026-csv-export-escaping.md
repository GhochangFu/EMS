# ADR 0026 — One CSV escaping rule for both exports, and why numbers are exempt

## Status

Accepted — 2026-08-10, at the `F4.29` gate.

## Context

This repository serves two CSV downloads:

| Export | Route | Escaping today |
|---|---|---|
| Audit log (`F4.14`, ADR 0021) | `GET /api/v1/admin/audit/export` | `audit.serialise.ts:37,79` — quotes **and** neutralises formula leaders |
| Energy Consumption (Sprint E) | `GET /api/v1/reports/energy/export.csv` | `reports.service.ts:324` — quotes only |

`F4.29` exists to close that gap. It was raised by the **`F4.28` security
review** on 2026-08-10 and deliberately kept out of `F4.28`, which converts
rollup *reads* and changes the report's numbers — not its strings.

The gap is not a scope question. AGENTS.md:580 already records "Phase 5 Sprint E
Energy report preview and CSV export are complete", so this is a **defect fix
inside promoted scope**, not a §10 promotion, and it adds no dependency (§9.4).
This ADR exists because the fix changes the bytes of a **client deliverable**
and because the one decision inside it — whether numeric cells are guarded — has
a non-obvious answer that will otherwise be re-litigated by whoever reads the two
call sites next.

## Measured facts

Everything below was measured on 2026-08-10 against the running stack, not
inferred.

**Fact 1 — the untrusted surface is exactly three cells.** `energyCsv` emits
five kinds of cell: hard-coded labels (`"Report"`, `"Total energy"`, `"kWh"`),
`startDate`/`endDate` (Zod-validated `YYYY-MM-DD`), `generatedAt` (an ISO string
this process produced), numbers, and — from `topConsumers` — `code`, `name` and
`siteName`. **Only those three carry values a human typed.** Everything else is
either a literal in the source file or produced by this process.

**Fact 2 — both write paths validate length only.** `code`, `name` and
`siteName` reach `bms.assets` through two routes, and neither restricts
characters:

- `asset-templates.schema.ts:98`–`100` — `code: z.string().min(1).max(64)`,
  `name: …max(255)`, `siteName: …max(255).optional()`
- `onboarding.schema.ts:63`–`67` — `code: z.string().min(2).max(64)`,
  `name`/`siteName` `.max(255)`

So `code = "=cmd|' /c calc'!A1"` is accepted by both. (`siteName` is optional in
the template path and falls back to the target location's name, making
`bms.locations.name` a third upstream for the same cell.)

**Fact 3 — nothing dangerous is in the data today.** Of 148 rows in
`bms.assets`, **0** have `code`, `name` or `site_name` matching
`^[=+@\t\r-]`, and **0** contain `"`, `,`, CR or LF. Of 17 rows in
`bms.locations`, **0** match either. This is a **latent** defect: today's export
is byte-identical before and after the fix, which is what makes the change safe
to ship and also what makes it invisible to any test that only reads real data.

**Fact 4 — the missing `\r` is coupled to the guard, not adjacent to it.**
`csvCell`'s quote trigger is `/["\n,]/`; `escapeCell`'s is `/["\n\r,]/`. CR is
absent from the reports one. Add the apostrophe guard **without** fixing the
trigger and a value starting with CR emits as `'\rfoo` *unquoted* — a new
row-splitting defect shipped on top of the fix. The two must land together.

**Fact 5 — `energyCsv` has never been executed by a test.** `F4.28` gave
`reports.service.ts` its first coverage (ADR 0025 fact 7), but through
`energyPreview` only — verified by grep: `rollup-conversion.integration.spec.ts`
names `energyPreview` at `:639`, `:653`, `:741`, `:770` and `energyCsv`
nowhere. The serialisation half of the file is untested.

**Fact 6 — the audit guard has no decision record.** `git log -S FORMULA_LEADERS`
returns one commit, `73a9fd2` (`F4.14 — audit read API and export`), and
**ADR 0021 does not mention formula injection, escaping or Excel at all** —
grepped for all four. The guard was added during F4.14's build and never written
down. That is the mechanism by which the second export failed to inherit it, and
it is the reason this ADR exists rather than a comment.

**Fact 7 — blanket guarding costs the audit export nothing, and the reports
export a lot.** All nine `AUDIT_EXPORT_COLUMNS` are string-shaped — UUIDs,
timestamps, action names, free text, JSON — so **no audit cell is a number** and
the question never arose there. `energyCsv` emits **8 fixed numeric cells**
(`totalKwh`, `peakKw`, `pueEstimate`, `indicativeCostZar`, `tariffZarPerKwh`,
`gridKwh`, `solarKwh`, `dgKwh`) plus **2 per top-consumer row** (`avgKw`,
`estimatedKwh`), up to 10 rows — so up to 28. Guarding those makes Excel import
them as **text**, and the client's own arithmetic on the sheet breaks.

**Fact 8 — negative telemetry is representable, so the exemption must not rest
on sign.** `telemetry.point_values` for `point_key = 'kw'`: **0 of 46,186 rows
negative**, min `0`, max `73.39`. But `kvar` has **750 negative rows**, min
`-0.83`. The column is `double precision` and a bidirectional meter on the PHE
pilot could send negative `kw`. "No negative kWh today" is therefore **not** an
argument this ADR is allowed to make — it is exactly the data-dependent
reasoning ADRs 0022–0025 were amended for.

## Decision

**1. One module, `apps/api/src/serialise/csv.ts`.** It owns `FORMULA_LEADERS`,
the quote trigger, and both cell constructors. `admin/audit/audit.serialise.ts`
and `reports/reports.serialise.ts` import it; neither keeps a private copy.
Placement: not `security/` (crypto only — `credential-crypto.service.ts` is its
sole occupant) and not a new `common/`, which invites becoming a junk drawer.
`serialise/` names one job, as `testing/` does.

**2. Numbers are exempt, and the justification is structural.** The guard exists
to neutralise cells whose Excel *formula* interpretation differs from their
literal text. For a numeric literal it does not: `=-5` evaluates to `-5`. So
guarding a number is provably unnecessary — no measurement required, and fact 8's
negative `kvar` rows cannot invalidate it.

**3. The cell kind is a type, not a regex.** `csvNumberCell(value: number)` and
`csvTextCell(value: string)` are separate functions with incompatible parameter
types, so the compiler decides which cells are exempt. **A regex that re-parses
the produced string and skips the guard when it looks numeric is rejected** —
that branch is the one that becomes the vulnerability, and `String(finite
number)` already gives the guarantee by construction.

**4. Escaped cells are a branded type.** `csvTextCell`/`csvNumberCell` return
`CsvField` (a `string` branded with a `unique symbol`), and `csvDocument` accepts
only `CsvField[][]`. A raw string in a row is a **compile error**, so the guard
cannot be bypassed by forgetting it. This is deliberately a compile-time
guarantee rather than a test: per ADR 0025 decision 5b this repo has shipped
three tests that were invariant under the change they guarded, and a type error
is the one check that cannot be.

**5. `csvNumberCell` throws on a non-finite value.** Not an empty cell, not
`"NaN"`. Every number reaching it is finite by construction — the SQL `COALESCE`s
every aggregate and `energyTariffZar()` gates on `Number.isFinite(t) && t > 0` —
so the throw is unreachable and functions as an assertion. A `NaN` in a client
energy report is a data-integrity failure that must not be delivered quietly.

**6. The audit export keeps blanket semantics.** Extraction unifies the **leader
set and the quote trigger, not the guard policy**: audit routes all nine columns
through `csvTextCell` because all nine are strings (fact 7). The two exports are
therefore *consistent*, not *identical*, and this ADR says so rather than
implying the divergence was closed.

**7. The reports `\r` trigger is fixed in the same change** (fact 4).

**8. Row building moves out of the service.** `energyCsv`'s row array becomes a
pure `energyCsvDocument(preview)` in `reports/reports.serialise.ts`, mirroring
`audit.serialise.ts`, so the escaping — "the part most likely to be subtly
wrong", as that file's own header puts it — is testable without a `Pool`. This is
what makes fact 5 fixable.

**9. `audit.serialise.spec.ts` must pass byte-unchanged.** It is the refactor's
regression proof, and it keeps its **literal** leader list (`:73`) rather than
importing `FORMULA_LEADERS` — a test that imports the constant cannot detect the
constant shrinking.

**10. A repo invariant against the third copy.** `tests/repo-invariants.test.ts`
asserts that every CSV writer under `apps/api/src` imports the shared module.
`exports/export-phe-from-json.mjs` is a **stated exclusion**: a dev-time script
whose input is the client's own SQL Server dump and whose output is committed
reference data, not a response to a request. The `DATABASE_URL` gate reached six
copies before `F4.28` extracted it; this is the cheap guard that stops the same
drift here.

## Dependencies

None. No package is added or upgraded, so §9.4 is not engaged.

## Consequences

- **Today's bytes are unchanged** (fact 3), so the fix cannot be verified by
  diffing the live export against itself. It is verified by the new unit tests
  and by a diff proving the *absence* of change — both are stated, because
  "output identical" is otherwise indistinguishable from "change not deployed",
  which is the failure `F4.28` actually hit.
- **A guarded cell mutates the delivered value for non-Excel consumers.** Excel
  hides a leading apostrophe; a text editor, `csv` parser or Sheets import shows
  it. This is the accepted cost of the OWASP fix and is unchanged from ADR 0021's
  behaviour — but it now applies to a report a client may feed into another
  system, so it is recorded here rather than assumed harmless.
- **Character validation on `code`/`name`/`siteName` is still absent** (fact 2).
  This ADR guards the *output*; it does not constrain the *input*. Restricting
  those columns is a master-data change touching ADR 0015's template
  instantiation and ADR 0011's onboarding commit, and stays out of scope.
- **Only the reports and audit exports are covered.** `toSheetRows` (XLSX) is
  correctly unguarded — a leading `=` in an `xlsx` *string cell* is stored as
  text, since it is Excel's **import** parser that reinterprets, not its
  renderer. That reasoning moves into the shared module so it is not rediscovered.
- **Owed on merge, per §9.10 in its own `chore(agents):` PR:** the AGENTS.md
  status line; a §3 tree entry for `apps/api/src/serialise/`; a §4 rule that
  every CSV writer goes through the shared module and that numeric cells take the
  exempt path; and a `docs/roadmap.md` `F4.29` section. §6 is expected to need
  nothing — the CSV export is in scope, not out of it — and that absence should
  be **verified and recorded**, as ADRs 0023, 0024 and 0025 each did, rather than
  a line being added in order to soften it.

## Settled at the gate

Two questions were put to the owner on 2026-08-10 before any code was written.

**Whether numeric cells are guarded.** Answered: **exempt them**, on the
structural grounds in decision 2 — the client keeps real numbers in Excel. The
alternative (blanket, exactly like `F4.14`) was declined; it would have been one
code path with no cell-kind concept to drift, at the cost of turning any negative
number into text.

**How the decision is recorded.** Answered: **this ADR**, rather than a commit
message and the backlog row. The owner's reasoning matches fact 6 — the audit
guard's own rationale was lost exactly that way.

Not asked, because the repo has already settled it: apostrophe-prefix versus
quoting. `audit.serialise.ts:77`–`79` committed to the reading that quoting does
**not** stop Excel's import parser from evaluating `"=1+1"`, and re-opening that
would be churn.
