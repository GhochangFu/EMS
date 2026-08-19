# ADR 0026 — One CSV escaping rule for both exports, and why numbers are exempt

## Status

Accepted — 2026-08-10, at the `F4.29` gate.

Amendment 1 — **Accepted 2026-08-18** (`F4.50`, decisions 11–12). The owner was
shown the measurement and ruled the scope at the §10 gate: widen the quote
trigger to TAB, `;` and `|`, and record it here as an amendment rather than as a
new ADR. See *Amendment 1*, which also records the limit. It closes the consumers
that still treat the comma as a delimiter; for the ones that do not it narrows
the working payloads and **is not a guard** — residual tracked as `F4.51`.

Amendment 2 — **Accepted 2026-08-19** (`F4.51`). The owner was shown the write-path
enumeration and ruled option **(c)+(a)**: add an XLSX export beside the CSV, and
document the CSV residual rather than patch around it. The CSV bytes are
unchanged. See *Amendment 2*.

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
cannot be bypassed by *forgetting* it. This is deliberately a compile-time
guarantee rather than a test: per ADR 0025 decision 5b this repo has shipped
three tests that were invariant under the change they guarded, and a type error
is the one check that cannot be.

Scope of the claim, since the security review probed it: `csvDocument([["=1+1"]])`,
a `string[][]`, a concatenation of two `CsvField`s, and `csvTextCell(x).slice(1)`
are **all** compile errors — derived strings lose the brand. A single-token
`"=1+1" as CsvField` **compiles**, and nothing flags it. The brand stops omission,
not a deliberate cast, and decision 4 claims only the former.

**5. `csvNumberCell` throws on a non-finite value.** Not an empty cell, not
`"NaN"`. This is a **real guard, not a dead assertion** — and the first draft of
this decision said the opposite, that finiteness held "by construction" because
the report's SQL `COALESCE`s every aggregate. **That is wrong, and both reviews
caught it.** `COALESCE` handles `NULL`; `NaN` is a legal `double precision` value
in Postgres, is neither `NULL` nor caught by `COALESCE`, propagates through
`SUM`/`AVG`, and sorts above every value so `MAX` returns it too.

The guarantee that actually holds lives in **another application**: the ingest
rejects non-finite samples before they are written
(`apps/ingest/src/host/normaliser.ts:129`, `adapters/mqtt.ts:222`). `apps/api`
enforces nothing, and `telemetry.point_values.value` carries **no CHECK
constraint** — verified, the table's only constraint is its primary key — so any
direct writer can store `'NaN'::float8`. Measured **0** such rows on 2026-08-10.

Throwing remains right: the old code delivered the text `"NaN"` into a client
energy report, silently. But the failure mode is recorded rather than assumed
harmless — it is a **persistent 500** for every range covering that bucket, it is
**asymmetric** (`/reports/energy/preview` returns `"totalKwh": null` on the same
data, because `JSON.stringify(NaN)` is `null`), and once the bucket is absorbed
into a continuous aggregate, deleting the raw row does not repair it (AGENTS.md
§4.4). A CHECK constraint on `value` would move the guarantee into the database
where it belongs; that is a migration on a populated hypertable and stays out of
scope — **tracked as `F4.32`** rather than left in this paragraph.

Both reviews endorsed throwing, and the failure mode above is why it is written
down rather than assumed harmless. It is also a **one-line decision to reverse**
if the owner would rather deliver a degraded cell than a 500: replace the `throw`
with an empty cell. That is theirs to make, not something to relitigate in code.

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
- **Only the reports and audit exports are covered.** `toSheetRows` (XLSX) stays
  unguarded, and the security review verified the claim by executing the real
  `xlsx` package rather than accepting it — but it holds for a **narrower reason
  than "it is a string cell"**, which is how the comment used to read.
  `aoa_to_sheet(["=1+1"])` writes `<c r="A2" t="str"><v>=1+1</v></c>`, and `t="str"`
  is ECMA-376's *cached formula result* type, not the shared-string type. The
  safety is the **absence of any `<f>` element**: nothing instructs Excel to
  evaluate. That corrected reasoning is in `audit.serialise.ts` so it is not
  re-derived from a premise the file does not contain. The onboarding
  `template.xlsx` was enumerated too — every cell is a literal or the controller's
  empty-string argument, so no request or database data reaches it.
- **Owed on merge, per §9.10 in its own `chore(agents):` PR:** the AGENTS.md
  status line; **a §2 row** — the compliance review found this missing from the
  first draft of this list, which is the **fifth** ADR running whose own follow-up
  list was incomplete, so treat that as the norm and audit it rather than copying
  it: `AGENTS.md:171` (*Operations*, which names "Energy CSV reports") and/or
  `:172` (*Audit read*) should name `src/serialise/csv.ts`, the `CsvField` brand
  and the text/number split; a §3 tree entry for `apps/api/src/serialise/`; a §4
  rule that every CSV writer goes through the shared module and that numeric cells
  take the exempt path; a `docs/roadmap.md` `F4.29` section; and the
  `docs/BACKLOG.md` §5 owed row, which §10.1 requires and which this ADR's first
  draft also omitted. §6 is expected to need nothing — the CSV export is in scope,
  not out of it, and AGENTS.md:594 already distinguishes reports PDF/XLSX (out)
  from audit CSV/XLSX (in) — and that absence should be **verified and recorded**,
  as ADRs 0023, 0024 and 0025 each did, rather than a line being added in order to
  soften it.
- **Verified as needing nothing, recorded rather than assumed:** no existing
  AGENTS.md sentence becomes false on merge. `:172`'s "in
  `apps/api/src/admin/audit/`" still holds, and §4.4's "ADR 0025 has two" static
  tests still holds because the new invariant is a third from a different ADR.
  `:209`–`:219`'s `apps/api` subdirectory list becomes *incomplete*, not false —
  which is what the §3 entry above is for. This is a different answer from ADRs
  0022–0025 and is stated affirmatively.

## Open question — leading whitespace — **RESOLVED: there was a bypass, and the fix is confirmed in the parser that had it**

`FORMULA_LEADERS` is OWASP's six. A value led by **U+0020, U+00A0 or U+FEFF**
passes `csvTextCell` completely unmodified and unquoted: no leader match, no quote
trigger match. Whether any spreadsheet strips such a prefix and *then* evaluates
what follows is an empirical question about three closed-source import parsers,
and **neither the security review nor this ADR is willing to name a bypass it did
not reproduce** — there is no Excel, LibreOffice or Sheets in this environment.
The best available reading is that they do not, since a leading space is itself
one of the commonly cited text-forcing prefixes, which is why OWASP's set stops
where it does.

Two things follow. First, **this is not a regression introduced by `F4.29`** —
`F4.14`'s guard has shipped on the same assumption since `73a9fd2`, and this ADR
inherits it rather than creating it. Second, the test is cheap and worth doing
once: four cells in one file, opened in Excel 365, LibreOffice 7.x and Sheets. It
is **not** done here, and characters must not be added to the leader list on
reasoning alone — a comment in `csv.ts` says so at the list.

**Tracked as `F4.31`, not left here.** `F4.28`'s backlog row records that naming
deferred work only inside an ADR is how ADR 0016 §6 commit 4 stayed unowned, and
this is the item with the most exposure of anything this ADR defers: it bears on
already-shipped code in *both* exports.

### RESOLVED 2026-08-18 (`F4.31`) — there **was** a bypass, in Google Sheets

**This section used to say the best available reading was that no parser strips
such a prefix and evaluates. That reading was wrong.**

`pnpm csv:formula-probe` builds the file through the real `csvTextCell`; it was
imported into three parsers, each with an **unguarded control cell** in the same
file so that "nothing evaluated" could be told apart from "this parser never
evaluates".

| Payload | Google Sheets | Excel 2013 |
|---|---|---|
| `=1+1` (guarded) | text | text |
| **`U+0020` + `=1+1`** | **`2` — EVALUATED** | text |
| `U+00A0` + `=1+1` | text | text |
| `U+FEFF` + `=1+1` | text | text |
| `=1+1` **unguarded control** | `2` | `2` |

**Google Sheets strips a single leading space and evaluates what is underneath.**
The control evaluated in the same import, so this is a real result and not an
artifact of the import settings. It had shipped in **both** CSV exports since
`73a9fd2` (`F4.14`) — `F4.29` inherited it rather than introducing it, exactly as
this ADR predicted, but the prediction that it was harmless was the wrong half.

**The fix is the class, not the instance** (AGENTS.md §4.4). `csvTextCell` now
guards when *either* the raw value **or** the value with leading whitespace
stripped begins with a formula leader. Adding `" "` to `FORMULA_LEADERS` would
have closed precisely the one payload the probe happened to use; the trimming
form also covers `"  =1+1"`, a mixed run of all three characters, and anything
else a parser might strip. Both checks are kept: TAB and CR are leaders *and*
whitespace, so they trim away to nothing, and replacing the raw test with the
trimmed one would silently unguard them while every existing test passed.

**Two things the run itself taught, both worth keeping.**

*The first attempt tested nothing.* `apps/api` sends
`Content-Type: text/csv; charset=utf-8` but writes **no BOM**, and Excel ignores
that header when opening a file — it decoded ANSI, so `U+00A0` arrived as
`Â`+NBSP and `U+FEFF` as `ï»¿`. Both then begin with a *letter*, trivially not a
formula, so two of four cases passed without being asked the question. The probe
now emits two files, with and without a BOM. Sheets reads UTF-8 natively and
needs only the plain one.

*That same missing BOM is a separate, live defect.* **Non-ASCII text in either
CSV renders as mojibake in Excel today** — an accented site or asset name is
enough. Not fixed here: adding a BOM changes every consumer of both endpoints,
and it is not a formula-injection question.

**The fix is confirmed in Google Sheets, 2026-08-18.** The regenerated file was
re-imported; `space_u0020` now renders as **text** where the same row previously
rendered `2`, and the unguarded control still rendered `2`, so the import did
evaluate formulas and the negative is real.

That confirmation was owed. This section briefly claimed the fix was verified on
the strength of what `csvTextCell` returned **in Node**, which the security
review correctly rejected: the guard emits `"' =1+1"` — apostrophe, *space*,
equals — and the only apostrophe form any parser had imported was `'=1+1`.
Sheets is the one parser proved to do something non-obvious with a leading space
before formula detection, so that interaction had to be measured, not reasoned.

| Payload | Sheets, before fix | Sheets, after fix |
|---|---|---|
| **`U+0020` + `=1+1`** | **`2` — evaluated** | **text** |
| `=1+1` unguarded control | `2` | `2` |

**Three of the review's four new probe rows came back negative, which closes its
L4 concern for Sheets.** `zwsp_lead` (`"​ =1+1"`) and `zwsp_inner`
(`" ​=1+1"`) both rendered as text and **were not evaluated**, despite being
unguarded — one U+200B anywhere in the leading run defeats `trimStart`, so these
reached Sheets bare. Sheets did not strip the ZWSP and did not evaluate. Combined
with its earlier refusal of U+00A0 and U+FEFF, **Sheets' strip set is narrower
than `trimStart`'s**, which is the evidenced form of the residual caveat below.

`tab_split` and `semicolon_split` also rendered as single text cells — but that
result carries **no information about the risk they name**. Sheets' importer
splits on the separator you choose, so importing with a comma was never going to
split on TAB or `;`. Their vector is a *different consumer*: a clipboard paste
into Excel, LibreOffice's sticky separator checkboxes, or Excel opening a `.csv`
in a locale whose list separator is `;`. Untested, pre-existing, and tracked as
`F4.50` rather than folded in here.

**Still untested: LibreOffice 7.x****Still untested: LibreOffice 7.x**, which is not installed in this environment.
The guard is now strictly stronger than it was, so LibreOffice cannot be
*newly* exposed by this change — but the row stays open until someone runs it,
because a third parser might strip something `trimStart` does not.

Related, and the reason the mechanism matters: the original comment on that list
said TAB and CR were "stripped as leading whitespace on import". They are not —
all six are formula-*initiating* characters. The wrong mechanism made a dangerous
edit look safe, namely deleting `\r` from the leader list on the grounds that the
quote trigger already handles CR. That would reopen the hole while every test
still passed, because the specs iterate their own copy of the list. Corrected in
place.

## Amendment 1 (`F4.50`, 2026-08-18) — the quote trigger is not only about the comma

The decision above treats the quote trigger as an RFC 4180 concern: quote on `"`,
LF, CR and `,`, because those are what break a cell out of its field **in a
comma-delimited reader**. Nothing in this ADR ever states the assumption; it is
carried by the choice of four characters, which is why it survived two reviews.

Where it *was* stated is `csvTextCell`'s own docstring, which ended: "With `,`,
`"`, LF and CR all in the trigger, a value cannot break out of its field or forge
a record — only its own cell content is under an attacker's control."

**That sentence was false, and this amendment records how far.** It held for a
comma-delimited reader and silently assumed every reader is one. It has been
replaced in the module with the correction and an instruction not to reinstate a
sentence of that shape.

### What was measured

Excel 2013 (15.0.4454), Windows list separator `,`. Payloads produced by the
shipped `csvTextCell`. Anti-vacuity control in every run.

Against the bytes shipped since `73a9fd2`, **the formula evaluated in four
different consumers**, none of which reads the file as comma-delimited:

| Consumer | Imported as |
|---|---|
| Clipboard paste, TAB delimiter | `tab_split,foo` · **`=1+1` → 2** |
| Clipboard paste, `;` delimiter | `semicolon_split,foo` · **`=1+1` → 2** |
| File open, comma+TAB (LibreOffice's separator checkboxes are sticky) | `tab_split` · `foo` · **`=1+1` → 2** |
| File open, `;` only (Excel double-click in a `;`-list-separator locale) | `semicolon_split,foo` · **`=1+1` → 2** |

Reachable inputs are the audit export's `reason` and `payload` and the reports
export's `code`/`name`/`siteName`, all validated for length only (fact 2).

### Decision 11 — TAB, `;` and `|` join the quote trigger

`QUOTE_TRIGGER` is now `/["\n\r,\t;|]/`.

`|` was not named in the `F4.50` row. LibreOffice offers it in the same dialog,
so it went in as part of this decision rather than as a second one.

**It was added on the claim that it "measures identically", and at the moment
that claim was written it was an assumption — `|` had not been opened as a
delimiter in any run.** It has been now (`OpenText` with `Other:=True,
OtherChar:="|"`), and the claim holds:

| Run | Unguarded bytes | Guarded bytes |
|---|---|---|
| `\|` only | `foo` · **`=1+1` → 2** | single: `"foo` · `=1+1"` — multi: `"a` · **`=1+1` → 2** · `b"` |
| comma+`\|` | `a` · **`=1+1` → 2** · `b` | **intact** — `foo\|=1+1` and `a\|=1+1\|b` in one cell each |

The comma+`|` row is the clearest single piece of evidence in this amendment: the
guarded and unguarded forms of the same payload sit in one table under one
parser, and only the unguarded one evaluates.

**Space is deliberately excluded, and the exclusion is the honest part of this
decision.** LibreOffice offers space as a separator too. Quoting on it would
quote nearly every cell either export emits. The class "a separator some consumer
might select" has no bound, so the rule cannot be "defend against all of them".
What is defensible is narrower: *the separators that are default-offered by
mainstream importers **and** absent from our data*. `csv.spec.ts` asserts the
exclusion, so that nobody later "completes" the list.

### Decision 12 — what this closes, and what it does not

Excel honours the `"` text qualifier **only when the quote opens a field**. So
the deciding variable is **whether the comma is among the consumer's
delimiters** — not which extra separator that consumer adds.

| Consumer | Comma a delimiter? | Result |
|---|---|---|
| Open, comma+TAB | yes | cell **intact**, `foo<TAB>=1+1` in one cell |
| Open, comma+`;` | yes | cell **intact** |
| Open, `;` only | no | splits through the quotes |
| Paste, TAB | no | splits through the quotes |
| Paste, `;` | no | splits through the quotes |

**Where the comma survives, this is a real closure**, and it holds for one, two
or three separators in the same cell — measured, not extrapolated.

**Where the comma does not survive, it is not a guard at all.** The first draft of
this decision claimed those cases were "mitigated", on the reasoning that the
closing `"` stays stuck to the formula fragment and `=1+1"` is invalid. **That
generalised from a single-separator payload and is false.** Put two separators in
one cell and the closing quote lands on a *later* fragment:

    "foo;=1+1;bar"   imports as   "foo  ·  =1+1 → 2  ·  bar"

Measured with a working control on `foo;=1+1;bar`, `foo;=1+1;`, `a;=1+1;b;c` and
the TAB equivalent — all evaluated. So for a non-comma consumer the widened
trigger narrows the set of payloads that work and does nothing more. **Tracked as
`F4.51`.**

This correction is kept in the record rather than quietly rewritten, because the
mistake is the interesting part: the mitigation claim came from reasoning about
one example instead of varying the payload, which is the same failure this ADR's
*Open question* section already documents once.

The honest statement of the limit: **a consumer that imports an RFC 4180
comma-delimited file without the comma is misreading it, and no cell-level
escaping in this module can repair that** — the apostrophe guard only ever
protects the first fragment, and protecting every fragment means rewriting the
operator's own data.

### Verification

Re-run of the regenerated probe — built by the real `csvTextCell` — through the
same four consumers: **no formula evaluated in any of them**, with the control
evaluating in all four.

**That run is not the whole story, and reading it as one is how the "mitigated"
claim survived.** Every probe payload carries exactly *one* separator. Varying
that — the multi-separator cases in decision 12 — evaluates in three of the four.
The probe's rows are a regression check on the shipped guard, **not** a
demonstration that the non-comma consumers are safe.

The first verification pass was **vacuous in three of the four runs** and the
result was nearly recorded anyway. The probe's control is
`CONTROL_unguarded,=1+1`, which only puts the formula in its own cell when the
comma is the delimiter; under TAB or `;` the line stays one cell beginning
`CONTROL` and cannot evaluate whatever the guard does. A second control — a
**one-cell** row holding `=1+1`, which works under any delimiter — was added to
`csv-formula-probe.ts` and the runs repeated.

### Byte cost

**Zero on the live database, 2026-08-18.** TAB, `;` and `|` appear in 0 rows of
`bms.assets.code`, `.name`, `.site_name` (148 rows), `bms.locations.name` (17)
and `bms.audit_log.reason` / `.payload` (5431). Today's exports are byte-identical
before and after — the same shape as fact 3, and the same reason this is safe to
ship and invisible to any test that reads only real data. (5246 of 5431 payloads
already contain a comma and were already quoted.)

### Two method traps, both of which produced a clean-looking negative

`F4.31` hit the first; this amendment hit the second. Both are recorded because
each cost a wrong result before it was caught.

1. **Encoding.** No BOM meant Excel decoded ANSI, so `U+00A0` and `U+FEFF`
   arrived as text beginning with a letter.
2. **The delimiter arguments are ignored for `.csv`.** `Workbooks.OpenText`
   discards its `Tab`/`Semicolon`/`Comma` arguments when the file extension is
   `.csv` and uses the locale list separator instead. The first run returned four
   identical tables and the comma split even with `Comma:=False`. Copy to `.txt`.
   Relatedly, a clipboard paste follows Excel's **sticky** import delimiters, not
   TAB unconditionally — so `F4.50`'s row was wrong to say "always TAB-delimited".

### Still untested

**LibreOffice 7.x**, as in `F4.31` — it is not installed on the machine this was
measured on. The sticky-checkbox vector was measured in Excel, which has the same
behaviour, but not in the product the row names. The guard is strictly stronger
than before, so LibreOffice cannot be newly exposed by this change.

The **HTTP layer** was not exercised: the local stack runs `AUTH_MODE=oidc`.
Verification went as far as the deployed container — `dist/serialise/csv.js`
carries the widened trigger, and both compiled serialisers quote all three
characters.

## Still divergent between the two exports

The audit export sets `Cache-Control: no-store` (`audit.controller.ts:49`, "keep it
out of browser disk cache and any intermediary"); the Energy CSV route sets only
`Content-Type` and `Content-Disposition`. The energy export is scope-filtered per
user via `readableAssetIds` and carries asset codes, names and site names, so a
shared-cache hit across two differently-scoped users is the same failure `F4.14`
closed with that header.

**Not fixed here.** It is a caching concern, not a formula-injection one, and it
predates this item — but it is worth naming in this ADR precisely because `F4.29`
is the moment the two exports were deliberately brought into line, and this is the
one place they still are not. Tracked as `F4.30`.

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

## Amendment 2 (`F4.51`, 2026-08-19) — the residual is a format problem, not an escaping problem

Amendment 1 widened the quote trigger and said plainly that for a non-comma
consumer it narrows the working payloads and is not a guard. This amendment
records what was done about that.

### The defect, restated

For a consumer whose delimiter set excludes the comma, a cell holding **two or
more** separators still injects. Excel honours the `"` text qualifier only when
the quote **opens a field**, so with two separators the closing `"` lands on a
later fragment and the middle one arrives bare. Measured on Excel 2013
(15.0.4454) with a working one-cell control: `"foo;=1+1;bar"` opened with `;` as
the only delimiter imports as `"foo` · **`=1+1` → 2** · `bar"`. The TAB
equivalent behaves the same. Exposure is **0 rows** — TAB, `;` and `|` appear in
none of the 148 assets, 17 locations or 5431 audit rows measured on 2026-08-18.

### Why option (b) was rejected, and the enumeration that decided it

`F4.51` offered three options. Option (b) — reject `;`, TAB and `|` at the write
path — was rejected because it **cannot be made complete**, which only became
visible once the write paths were enumerated rather than cited:

| Exported column | Write paths that accept the characters |
|---|---|
| asset `code`/`name`/`siteName` | `assets.schema.ts`, `asset-templates.schema.ts`, `asset-templates-content.schema.ts`, `onboarding.schema.ts` |
| `locations.name` | `locations.schema.ts` |
| `audit_log.reason` | 8 fields across `alarms`, `maintenance`, `rules`, `work-orders` |
| `actor_email` | **`users.email`. No Zod write path exists** — the identity provider supplies it. |

That is 13+ validation points, and the last row is unreachable by any write-path
rule. A guard over part of that set reads as closed and is not — the failure mode
this ADR's own history names three times (the missing BOM, the
`CONTROL_unguarded` control, `F4.28`'s tautology). The `F4.51` row named two of
the schema files; `reports.serialise.ts`'s docstring named the same two and
called them "neither write path". **Both undercounted**, and the docstring is
corrected in this change.

Option (b) also carries a product cost with no measured benefit: `Pump A; spare`
is a legitimate asset name, and forbidding it forever defends a consumer
configuration nobody has reported.

### Decision

13. **Add `GET /api/v1/reports/energy/export.xlsx`.** Same query schema, same
    `readableAssetIds` scope filter, same `Cache-Control: no-store`. A separate
    route rather than a `?format=` switch, because the sibling route already
    carries its format in its path and because the CSV response must stay
    byte-identical.
14. **The sheet rows are deliberately unguarded and unescaped.** The safety is
    structural and belongs to the writer: `aoa_to_sheet` emits no `<f>` element,
    so the file never instructs Excel to evaluate anything. `audit.serialise.ts`
    carries that measurement, including the warning not to re-derive it from the
    cell type — `t="str"` is ECMA-376's *cached formula result* type and does not
    mean what it looks like. An apostrophe here would corrupt the operator's data
    and close nothing. `reports.serialise.spec.ts` pins the intent so a later
    reviewer cannot "complete" it.
15. **Numeric cells stay `number` in the sheet.** `audit.serialise.ts` returns
    `string[][]` because no audit column is one the client computes on; every
    numeric column in this report is. Writing them as text would set `t="str"`
    and silently break the client's arithmetic — the same harm decision 2 forbids
    the apostrophe guard from causing in the CSV, arriving by a different route.
16. **Both formats render from one table.** `energyTable` in
    `reports.serialise.ts` is the single source; `energyCsvDocument` maps it
    through `csvTextCell`/`csvNumberCell` and `energySheetRows` returns it as-is.
    The first draft of this change used two literal lists, which can drift apart
    silently while the client is told they are one report in two formats. **The
    guard is the shared table itself, not a test** — an earlier version of this
    line claimed "a spec assertion compares the row counts", and that assertion
    was removed before merge because the shared table makes the counts
    structurally equal, so it could not fail. The security review caught the ADR
    still asserting it.
17. **The CSV keeps its residual, documented.** It is not deprecated and its
    bytes do not change. The client's existing tooling reads CSV, and the file is
    valid RFC 4180 — the injection needs a consumer that misreads it. **In the
    reports panel** the UI leads with XLSX and offers CSV beneath it. This clause
    is scoped to the reports export deliberately: the audit export has **no web
    affordance at all** — nothing under `apps/web/src` references
    `admin/audit` — so it is API-only and has no default format to lead with.
    Its `?format=xlsx` has been available since ADR 0021.

### Consequences

- No new dependency. `xlsx@^0.18.5` was already in `apps/api/package.json` for
  the audit export, so **§9.4 does not gate this**. The audit export has served
  `?format=xlsx` since ADR 0021; this closes the same gap on the reports side.
- No programmatic consumer breaks: `apps/web/src/api/reports.ts` only triggers a
  browser download, and nothing in the repository parses either export.
- The residual stands for anyone who chooses CSV **and** a non-comma delimiter.
  That is now a documented user choice rather than an unrecorded defect.
- Not done, and deliberately: no write-path character restriction, and no change
  to the CSV bytes. Anyone reopening option (b) must first answer the
  `actor_email` row of the table above.
- **`AGENTS.md` §6 puts this out of scope, and the owner overruled it.** §6 lists
  "Energy reports (PDF / XLSX)" (line 1103), and line 1140 draws the contrast
  deliberately — reports-domain XLSX out, audit CSV/XLSX in under ADR 0021 — so
  the audit precedent does **not** carry on its own. Raised as a possible §10
  promotion. **The owner ruled on 2026-08-19 that reports XLSX is in scope**, and
  said the wording dates from the prototype phase.
- **This is not the passive §6 lag `CLAUDE.md` describes, and an earlier draft of
  this bullet wrongly called it that.** The compliance review caught it against
  the record: `docs/BACKLOG.md:684` shows this ADR's *own* `chore(agents):` sweep
  searching §6 a **fourth** time and reporting "the reports PDF/XLSX deferral,
  neither touched". The line was examined and left in place — correctly, because
  no ADR had promoted it then. So what moves it is the owner's ruling, not drift
  and not the audit precedent. **No §10 promotion is owed. A §6 correction is**,
  it must land as its own `chore(agents):` change (§9.10), and it must **narrow**
  rather than delete: reports **PDF** is still out of scope, so line 1103 becomes
  "Energy reports (PDF)" and line 1140 is rewritten. Tracked in the
  `docs/BACKLOG.md` owed table per §10.1.

