# ADR 0055 — Cross-asset aggregation in the calc grammar (`F2.9`, unblocks `F2.8`)

## Status

Accepted — 2026-09-04, by the repository owner, the same day it was drafted for
`F2.9` at the `F2.8` start gate. It resolves the fork both rows had been
blocked on since 2026-08-21, and **discharges the "ADR 0036 amendment" that
each of their backlog rows names**.

**All seven gate questions were ruled by the repository owner on 2026-09-04**,
and each ruling is a numbered decision. Six were ruled in one sitting; the
seventh, Q5, was found by review afterwards and ruled the same day. The *Gate
questions* section below keeps the reasoning each was decided against,
including the two recommendations that were **not** taken — Q1b (measured-only)
and the narrower first form of Q3 — because a reader who later meets the
ordering engine or the tick latency needs to find out that both were chosen
deliberately, over a stated cheaper alternative.

**Accepted is not implemented.** Every guard this ADR repeals is still in the
code and still enforcing the old rules; `F2.9` is what changes them, and `F2.8`
follows it. Until then a formula behaves exactly as ADR 0036 and ADR 0037
specify.

| Gate question | Ruling | Decision |
| --- | --- | --- |
| Q0 — this record's form | Its own number, ADR 0055 | — (pointer added to ADR 0036 §Status) |
| Q1 — how a formula reaches other assets | Both reference forms | 6 |
| Q1b — may a cross-asset reference read a derived point | Yes; ADR 0036 decision 7 repealed | 7 |
| Q1c — when a cycle is detected | Save time **and** evaluation time; evaluation time is the authority | 8 |
| Q2 — what an aggregate ranges over | `@site` · `@domain` · `@group`, location always implicit | 9 |
| Q3 — trigger modes | `v2` is `scheduled` only | 10 |
| Q4 — partial or stale input | Minimum coverage ratio, excluded count reported | 11 |
| Q5 — may a qualified reference cross a location or an organization | No; confined to the owning asset's location | 12 |

Q5 was not asked at the sitting above because it did not exist yet. It is an
incoherence *between* two of the rulings — decision 9 promised a containment it
could not deliver for the reference form decision 6 had just added — and review
found it afterwards. It is now closed by decision 12.

## Context

`F2.8` — "Replace hardcoded PUE SQL with user-defined derived tags" — has been
unstartable since `F2.4` landed, and the reason is a grammar decision that
three separate records deliberately refused to make.

- **ADR 0036 decision 2** froze point references at `{pointKey}` brace syntax
  with **no asset qualifier**. **Decision 7** banned a derived point from
  referencing another derived point, because chaining "would need
  dependency-ordering (topological evaluation, cycle detection)".
- **ADR 0037 decision 2** — "A reference resolves within the asset that owns
  the formula" — records that this is "a consequence of the frozen grammar
  rather than a choice". Its *Consequences* state the fork in full: `F2.8`
  needs "either an ADR 0036 amendment (asset-qualified references or
  aggregates) or a site-level asset carrying facility totals as measured
  points. Both are `F2.8`'s decisions to make; choosing one here would be
  inventing its scope on its behalf."
- **ADR 0050 (`E1.3`, asset health score)** met the same wall and also declined:
  "Aggregation resolves **outside** the formula — ADR 0036 stays frozen …
  Amending the grammar is `F2.8`'s call, not this row's."
- **2026-08-22**, the IONSiTE NEXUS feature sheet (`docs/BACKLOG.md` §8, row 6)
  turned the open fork into stated client demand: "aggregations, balances,
  efficiency calculations". `F2.9` was created to carry it, marked
  `🔒 needs an ADR 0036 amendment first`, with `ADR` as a literal entry in its
  `Depends` column.
- **2026-09-04**, at `F2.8`'s start gate, the repository owner ruled: **amend
  the grammar**, rather than build a site-level asset carrying facility totals
  as ordinary measured points. This ADR records that ruling and drafts what
  follows.

What ships today is the thing `F2.8` exists to remove. `estimatePue()` is
duplicated three times —
`apps/api/src/dashboard/dashboard.service.ts:541`,
`apps/api/src/reports/reports.service.ts:332`, and
`apps/web/src/lib/pue-estimate.ts:2` — and all three are the same closed form,
`1.22 + min(0.45, totalKw / 12000)`, rounded to two decimals. That is a curve
fitted to a single number, not a measurement of anything, and none of the three
has a covering test. PUE is `facility total kW / IT load kW`: a ratio of two
sums taken **across** assets. `bms-calc-v1` cannot express either sum.

## Decision

These follow from the owner's 2026-09-04 ruling and from facts already frozen
in the repository. Decisions 1 to 5 were settled at drafting; decisions 6 to 12
each record a *Gate questions* ruling made the same day, and name it.

**1. The grammar reopens.** ADR 0036 decision 2 (no asset qualifier) and
decision 7 (no derived-to-derived reference) stop being frozen **for this work
only**. Neither is repealed; each is superseded to the exact extent that the
ruling on Q1 requires, and no further.

**2. The extension ships as a new dialect string, `bms-calc-v2`.**
`templateKpiSchema.dialect` and `bms.template_points.formula_dialect` widen by
one enum member. ADR 0036 decision 6 already made `dialect` an enum precisely
so it could widen, and it already carries two members (`"unvalidated"`,
`"bms-calc-v1"`), so this needs no new mechanism.

**3. A `v1` formula keeps its exact current meaning, forever.** No migration
rewrites a stored formula, and no stored row changes meaning on the day `v2`
lands. A `v1` reference resolves within the owning asset, exactly as ADR 0037
decision 2 specifies. This mirrors how ADR 0036 decision 6 left
`"unvalidated"` rows alone: an author opts in by re-saving under the new
dialect, and never by a backfill.

**4. `v2` is a strict superset of `v1`.** Every expression that parses under
`bms-calc-v1` parses under `bms-calc-v2` and evaluates to the same number. A
`v2` parser that rejects a legal `v1` formula is a defect, and the test suite
must state that as a property rather than as a handful of examples.

**5. The site-level-totals-asset alternative is refused**, and the reason is
recorded rather than left to omission. Producing facility totals as ordinary
measured points needs something to write them — a producer that no backlog row
owns, and that would itself be a cross-asset sum wearing a different hat. The
alternative moves the problem; it does not remove it.

**6. `bms-calc-v2` carries both cross-asset reference forms** (ruled
2026-09-04, Q1). An **aggregate function** ranges over a set the database
resolves at evaluation time, which is what an efficiency ratio needs. An
**asset-qualified reference** names one asset, which is what a balance needs.
Sheet row 6 asks for "aggregations, **balances**, efficiency calculations", and
one form leaves one of those three expressible only by contortion. The cost is
two reference forms to tokenize, parse, validate and error-report, and two
forms in the `F2.5` authoring UI.

```
sum({kw} @site) / sum({kw} @group('IT_LOAD'))   -- efficiency: a set
{TX_01.kwh} - {TX_02.kwh}                        -- balance: two named meters
```

**How far a qualified reference may reach is decision 12**, ruled separately at
Q5 — it is confined to the owning asset's location, like an aggregate, and the
resolver adds that filter itself because `bms.assets.code` is unique globally
rather than per location.

**7. A cross-asset reference may read a derived point, and ADR 0036 decision 7
is therefore repealed, not narrowed** (ruled 2026-09-04, Q1b). The owner's
stated reason is author flexibility: a site total may be built from per-building
derived subtotals, in layers, rather than only from raw meters. Three
consequences follow, and none of them is optional:

- **A dependency graph across assets, with a topological evaluation order.** A
  derived point may now depend on another derived point, so "evaluate the
  formulas" stops being a set operation and becomes an ordered one.
- **A cycle detector, with an author-facing error.** The cycle is reachable in
  one hop: `sum({total_kw} @site)` written on an asset's own `total_kw`
  includes itself.
- **Three existing guards must be replaced, not deleted.** Each currently
  refuses what decision 7 banned, and each needs a `v2` path that admits the
  reference and defers the decision to the cycle detector:
  `apps/web/src/lib/template-formula-validation.ts:161`
  (`validateDerivedFormula`, with `DERIVED_SELF_REFERENCE_MESSAGE` and
  `DERIVED_SIBLING_REFERENCE_MESSAGE` at lines 93 and 95); the `apps/api` Zod
  layer that ADR 0036 decision 7 placed there rather than in the DSL
  (`packages/shared/src/calc-dsl/parser.ts:249-255` records why); and its gate
  test, `assertFormulaCannotReferenceADerivedPoint`
  (`apps/api/src/admin/asset-points/asset-point-calc-override.integration.spec.ts:514`).
  **A `v1` formula keeps every one of these refusals**, per decision 3.

**8. Cycles are detected in two places, and evaluation time is the authority**
(ruled 2026-09-04, Q1c). Save-time detection stays, so an author who writes a
cycle is told at once and in the editor. Evaluation-time detection is added as
the backstop, because the sweep is the only place that sees the membership set
as it actually is — decision 6 resolves an aggregate's members at evaluation
time, so an asset joining a site or a group can make a saved, acyclic formula
cyclic with no formula edit and therefore no save to reject.

On a cycle the sweep refuses the affected formulas, writes nothing, and
increments a counter labelled by reason. ADR 0037 decision 9 already sets that
contract — "on any refusal … the engine writes nothing and increments a counter
labelled by reason. A skipped calculation is [never silent]" — so this is that
rule applied to a new refusal reason, not a new mechanism.

**The two detectors must not be two implementations.** One graph builder,
called from both, or they will disagree and the disagreement will be found in
production. The per-tick cost is a graph build over the derived formulas only —
tens of nodes, not telemetry volume.

**The operator surface is not the formula editor.** A cycle that appears
because somebody moved an asset is not the formula author's mistake, and an
error rendered only in the authoring UI would be shown to the wrong person, at
a moment they are not looking. The counter above is the minimum; where else it
surfaces is a plan-gate decision for `F2.9`, not another ADR question.

**9. An aggregate ranges over one of three scopes, and the owning asset's
location is always implicit** (ruled 2026-09-04, Q2).

| Selector | Set | Relation |
| --- | --- | --- |
| `@site` | every asset at the owning asset's location | `bms.assets.location_id` |
| `@domain('hvac')` | that location, narrowed by plant domain | `bms.assets.domain` |
| `@group('IT_LOAD')` | that location, narrowed by asset group | `bms.asset_group_members` |

Every selector resolves **relative to the asset that owns the formula**, and
none of them crosses a location — a rule decision 12 later extends to the
qualified reference form as well, which does not inherit it for free. Three
things follow.

*ADR 0037's write path is untouched.* The output is still `(assetId, pointKey)`
on the owning asset, so triggering, idempotent output timestamps and
`onConflictDoNothing` all keep working exactly as ADR 0037 decision 8
specifies.

*A template stays portable.* The same template instantiated at two sites
computes each site's own total, with no per-site formula edit — which is the
property that made the aggregate form worth having in decision 6.

*`@group` is unambiguous by construction.* `asset_groups` is unique on
`(location_id, code)` —
`packages/db/drizzle/0010_phase5_location_access.sql:48` — and `code` alone is
**not** unique. A globally-resolved group code could therefore match two
groups; a location-relative one cannot. This is why implicit location scoping
is a correctness rule here and not a convenience.

No new relation and no migration: `location_id` and `domain` are both `NOT
NULL` with foreign keys (ADR 0018, ADR 0031 Amendment 1), and
`asset_group_members` already exists.

**10. A `bms-calc-v2` formula is `scheduled` only** (ruled 2026-09-04, Q3).
The validator rejects `calc_trigger = 'streaming'` on a `v2` formula at save
time. `v1` formulas are untouched by decision 3 and keep both modes.

The recommendation this ADR carried at drafting was narrower — aggregates
scheduled, everything else free. **Decision 7 changed it**, and the reasoning is
recorded because the narrower rule looks reasonable until the ruling is in
place:

- *An ordering pass needs something stable to order.* A layered chain under
  `streaming` recomputes each layer on every reading, in no defined order. The
  ordering pass decision 7 requires then has nothing to order against.
  Scheduled ticks give it a boundary.
- *`streaming` fires on the owning asset's readings only.* A cross-asset
  balance `{TX_01.kwh} - {TX_02.kwh}` written on a third asset would recompute
  when that third asset reports — not when either meter moves. The formula
  would be correct, on time, and reading stale inputs. This trap belongs to the
  qualified-ref form, which is why it did not exist before decision 6.

Two existing pieces of code meet this rule:

- `apps/api/src/admin/asset-templates/stock-catalog/point-fields.ts:61` —
  `derived()` hardcodes `calcTrigger: "streaming"` with a null interval, and
  its own comment says the helper exists to *guarantee* that pairing. It has 18
  callers across the `F2.12`/`F2.13` class modules. Every one is a `v1`
  same-asset formula, so decision 3 leaves them alone, but the first `v2`
  aggregate in a stock template needs a `derived()` that can say `scheduled`.
- `templatePointBodySchema`'s `superRefine` refuses `streaming` beside a
  `calcIntervalSeconds`. The mirror rule is now required: a `v2` point is
  `scheduled` and therefore **must** carry an interval, so a null one is a
  save-time rejection rather than a formula that never runs.

**The cost is latency, and it is real.** Every `v2` value is at most one tick
old by construction. ADR 0037 decision 7 sets that base tick at 10 s, so this
is a bound, not an unknown — but a `v2` KPI cannot be as fresh as a `v1`
streaming one, and the `F2.5` authoring UI should not imply otherwise.

**11. An aggregate evaluates over its fresh members, subject to a minimum
coverage ratio, and reports what it excluded** (ruled 2026-09-04, Q4). This is
the shape ADR 0050 already set for the health score: an input that cannot be
scored is **excluded** rather than given a flattering default, and the excluded
count is reported.

`bms.template_points` gains one additive nullable column — a minimum coverage
ratio — following the same forward-only, no-backfill pattern as
`formula`/`formula_dialect` (migration `0035`) and the ADR 0037 calc columns
(migration `0036`). Its number is taken from `packages/db/drizzle/` when it is
written and is deliberately not recorded here, per the lesson `docs/BACKLOG.md`
records against `E5.1`.

Four rules make this precise, and each exists because its absence produces a
plausible wrong number:

- *Below the floor, the formula refuses.* It writes nothing and increments a
  counter labelled by reason — ADR 0037 decision 9, applied to one more refusal
  reason. It does not write a smaller number.
- *The denominator is the assets in scope that **declare** the referenced
  point*, not every asset in scope. An asset with no `kw` point at all is not a
  stale member; it is not a member. Counting it would make an `@site` aggregate
  over a mixed-domain site report a low coverage that means nothing.
- *A null ratio means fail closed*, not "no limit". Every declared member must
  be fresh, which is ADR 0037 decision 9 unchanged. Relaxation is opt-in and
  visible, because a default that silently accepts partial data is the failure
  ADR 0031 Amendment 1 records for `assets.domain`'s dropped `DEFAULT`.
- *A stale derived input is an excluded member like any other.* Decision 7
  allows layers, so a chain's freshness is bounded by its slowest layer. ADR
  0037 decision 5 resolves staleness against raw inputs only, which stops being
  the whole story once a chain exists.

**12. A cross-asset reference never leaves the owning asset's location, in
either form** (ruled 2026-09-04, Q5). Decision 9 stated this for the aggregate
form and could deliver it, because it resolves through
`bms.assets.location_id`. **The qualified form could not inherit it**, because
it resolves through `bms.assets.code` and that column is `.unique()`
**globally** — not per location, and not per organization. Decision 9's
containment sentence therefore did not in fact cover the form decision 6 had
just added. This decision closes that gap: the resolver applies the location
filter itself, and a code belonging to another site is an unknown reference,
rejected at save time.

The reason to close it this way rather than by an organization check is that
containment then holds **by construction**. `bms.assets.organization_id` is
`NOT NULL` under ADR 0043 and this repository forces row-level security on
tenant tables under ADR 0045, so a globally-resolved code would have been a
cross-tenant reference whose safety depended on which role the calc engine held
at evaluation time — an answer no formula author can see, for a boundary that
must not be role-dependent. A location filter needs no such reasoning.

It also keeps decision 9's portability property true of both forms: a template
carrying a hardcoded cross-site asset code would mean something different at
every site it was instantiated at.

**What it costs:** a two-site energy balance is not expressible. That is
accepted. A balance across two sites is not a balance, and no row asks for one.

## Gate questions

**These were the ADR gate**, and all six are ruled — the table in `## Status`
maps each to its decision. Each section is kept as written, with the ruling
appended, because the reasoning matters after the fact: three prior records
(ADR 0036 decision 7, ADR 0037 *Consequences*, `F2.8`'s own row) refused to
pre-empt exactly these questions, and two of the recommendations here were
overruled on purpose.

### Q0 — Is this ADR 0055, or ADR 0036 Amendment 2? — **ruled 2026-09-04: ADR 0055**

Both `F2.8`'s row and `F2.9`'s row say "an ADR 0036 amendment", so the wording
points at an amendment. Practice points the other way: every amendment in this
repository so far is a small in-file correction (ADR 0036 Amendment 1 added a
`position` field to three AST nodes; ADR 0016 Amendment 1 widened a `ZodType`
signature), whereas this is a new dialect plus, on the Q1 recommendation, a new
evaluation stage.

*Recommendation:* keep it as **ADR 0055**, and add a one-line pointer in ADR
0036 so a reader of the frozen grammar finds the record that reopened it. If
this record stays at 0055, it must state — and this sentence is that statement
— that **ADR 0055 discharges the "ADR 0036 amendment" that `F2.8` and `F2.9`
name.** Otherwise both rows keep pointing at a document that never arrives.

### Q1 — Aggregate functions, or asset-qualified references? — **ruled 2026-09-04: both**

ADR 0037 named both, as alternatives. They are not equivalent, and the ruling
is that `bms-calc-v2` carries **both reference forms side by side**, because
the client sheet asks for two shapes of calculation and each form answers one
of them.

An **aggregate function** ranges over a set that the database resolves at
evaluation time. A new asset joins the sum because it joins the site, which is
what "facility total" means. This is what an *efficiency* calculation needs,
PUE included.

```
sum({kw} @site) / sum({kw} @group('IT_LOAD'))
```

An **asset-qualified reference** names individual assets. This is what a
*balance* needs — what entered minus what left, across two named meters. An
aggregate cannot express it without first creating a one-member asset group per
meter, which is bookkeeping invented to work around a missing syntax.

```
{TX_01.kwh} - {TX_02.kwh}
```

Sheet row 6 (`docs/BACKLOG.md` §8) asks for "aggregations, **balances**,
efficiency calculations". Shipping one form would have left one of those three
expressible only by contortion.

**What this costs:** two reference forms to tokenize, parse, validate and
error-report instead of one; two forms in the `F2.5` authoring UI, and two
things to teach an author; a wider surface to keep `v1`-compatible under
decision 4.

**What it does *not* cost, and the correction that matters here.** An earlier
draft of this section asserted that carrying both forms takes cross-asset
dependency ordering and cycle detection "regardless, because a qualified
reference can point at a derived point". That is wrong as stated. Cycle
detection is needed only when a derived point may reference **another derived
point**, and the rule that prevents that applies to a qualified reference
exactly as well as to an aggregate. See Q1b, which is now the question that
decides it.

### Q1b — May a cross-asset reference read a derived point? — **ruled 2026-09-04: yes; see decision 7**

Q1's ruling did not settle this, and it is the question that set the size of
the build. It applies to **both** forms Q1 admitted.

ADR 0036 decision 7 already bans derived-to-derived **within one asset**, and
gives the reason: chaining "would need dependency-ordering (topological
evaluation, cycle detection)". Reaching across assets does not change that
reasoning; it widens the graph the reasoning applies to.

*Recommendation, not taken:* **measured only** — a cross-asset reference
resolves against `kind: "measured"` points, so no derived point ever feeds
another, and neither a topological ordering pass nor a cycle detector gets
built. That would have kept ADR 0036 decision 7 intact in substance while
amending its letter, and it would have defused the exact cost `F2.8`'s row,
`F2.9`'s row and ADR 0037 all warned this amendment would drag in. PUE and
balances both work under it, because meters are measured.

*Ruled 2026-09-04:* **derived references are allowed**, for author
flexibility — layered calculations, a site total assembled from per-building
derived subtotals. The repository owner made this call with the ordering and
cycle-detection cost stated. It is **decision 7**, and the cost lands as
described there. The defusal above was a property of the rejected rule, not of
the problem, so it does not survive the ruling.

### Q1c — When is a cycle detected, and what happens to one that appears later? — **ruled 2026-09-04: both, eval is authority; see decision 8**

**This question exists only because of the Q1b ruling**, and it is not a
restatement of it. A save-time check is the obvious place to detect a cycle,
and for an **asset-qualified** reference it is sufficient — the reference names
one asset, so the graph edge is fixed the moment the formula is saved.

**For an aggregate it is not sufficient, and this is the hazard worth ruling
on.** An aggregate's member set is resolved at evaluation time (decision 6), so
the graph can gain an edge with **no formula edit at all**. Add an asset to a
site, or add a member row to an asset group, and a formula that was acyclic
when it was saved can become cyclic. Nobody touched a formula; there is no save
to reject.

*Recommendation:* **both, with evaluation time as the authority.** Save-time
detection stays, because an author who writes a cycle deserves to be told
immediately and in the editor. Evaluation-time detection is added as the
backstop, because it is the only place that sees the membership set as it
actually is. The sweep re-derives the graph, refuses the cyclic formulas, and
increments a labelled counter — ADR 0037 decision 9 already requires that no
skip be silent. The per-tick cost is a graph build over the derived formulas
only, which is tens of nodes, not the telemetry volume.

The alternative — save-time detection plus a re-check hooked into every
membership-changing write path — is cheaper per tick but puts a calc-engine
concern into the asset-group and asset-move code, and any path that is missed
reintroduces the hole silently. That is the failure mode this repository keeps
finding in review.

Whichever is chosen, the ADR must also say **what the operator sees**. A cycle
that appears without a formula edit is not the author's mistake, so an error
attached to the formula editor is the wrong surface for it on its own.

### Q2 — What set does an aggregate range over? — **ruled 2026-09-04: all three; see decision 9**

The scope selector needs a vocabulary. The schema already carries three
candidate axes, and no new relation is needed for any of them:

| Axis | Column | State |
| --- | --- | --- |
| Site | `bms.assets.location_id` | `NOT NULL`, FK to `bms.locations` (ADR 0018) |
| Plant domain | `bms.assets.domain` | `NOT NULL`, FK to `bms.asset_domains.code` (ADR 0031 Amendment 1) |
| Asset group | `bms.asset_group_members` | `asset_groups` is unique on `(location_id, code)` — `packages/db/drizzle/0010_phase5_location_access.sql:48` |

*Recommendation:* all three, **resolved relative to the asset that owns the
formula** — `@site`, `@domain('hvac')`, `@group('IT_LOAD')`. Resolving
relatively is what keeps ADR 0037's write path untouched: the output is still
`(assetId, pointKey)` on the owning asset, so nothing about triggering,
idempotent timestamps or `onConflictDoNothing` changes. It also makes a
template portable — the same template instantiated at two sites computes each
site's own total, with no per-site formula edit.

The unique index above matters: `@group('IT_LOAD')` resolved within the owning
asset's location is unambiguous by construction. A globally-resolved group code
would not be, because `code` is unique **per location** and not overall. A
selector that can resolve to two groups is a defect in the design, not in the
implementation.

PUE then reads, on a site-representative asset:

```
sum({kw} @site) / sum({kw} @group('IT_LOAD'))
```

### Q3 — Which trigger modes may a `v2` formula use? — **ruled 2026-09-04: scheduled only; see decision 10**

ADR 0037 decision 4 gives a formula `streaming` or `scheduled`. A cross-asset
aggregate under `streaming` recomputes on **every** reading from **any** asset
in scope. At the 265-asset enterprise figure ADR 0050 cites, and the 0.509 s
median sample gap it measured, that is a recompute storm producing a value
nobody reads more than once a minute.

*Recommendation:* a `v2` formula that contains an aggregate is **`scheduled`
only**, and the validator rejects `calc_trigger = 'streaming'` on one at save
time rather than letting it be discovered in production. This matches ADR
0050's own second mechanism, which materializes a roll-up on a 60 s tick rather
than computing it on the read or write path.

**One fact this question must be answered against.** Every derived point in the
stock catalog is `streaming` today, and not by choice per point:
`apps/api/src/admin/asset-templates/stock-catalog/point-fields.ts:61` —
`derived()` — hardcodes `calcTrigger: "streaming"` with a null interval, and
its own comment records that the helper exists to *guarantee* that pairing
because `templatePointBodySchema`'s `superRefine` refuses the alternative. It
has 18 callers across the `F2.12`/`F2.13` class modules. Those are all `v1`
same-asset formulas and decision 3 leaves them untouched, but the first `v2`
aggregate in a stock template will need a `derived()` that can say `scheduled`.

**The Q1b ruling sharpens this.** A layered chain evaluated under `streaming`
recomputes each layer on every input reading, and the layers do not settle in a
defined order — which is exactly what decision 7's ordering pass exists to fix.
An ordering pass over a scheduled tick is well defined; an ordering pass over a
stream of independent reading events is not.

### Q4 — What happens when part of the input set is stale? — **ruled 2026-09-04: coverage ratio; see decision 11**

ADR 0037 decision 5 resolves staleness per formula, before `evaluate()` runs,
and decision 9 refuses to write on any stale or missing input. Applied
unchanged to an aggregate over 265 assets, one stale asset blocks the whole
site total, so the value would almost never compute.

*Recommendation:* the middle path ADR 0050 already set — evaluate over the
fresh members, require a **minimum coverage ratio** per formula, and **report
the excluded count** rather than hiding it. ADR 0050 rules exactly this for
unruled tags: excluded, not scored 1.0, with the excluded count reported. The
alternative reading is that a facility total computed over 262 of 265 assets is
a **wrong number that looks right**, which is the failure ADR 0037 decision 9
exists to prevent. **This is the sharpest of the five questions and the one
where the recommendation is least safe.**

### Q5 — May an asset-qualified reference cross a location, or an organization? — **ruled 2026-09-04: no; see decision 12**

Found by review after the six rulings above. **Decisions 6 and 9 disagreed**,
and neither was wrong on its own — the gap was that decision 9's containment
rule was written for the aggregate form and read as though it covered both.

Decision 9 rules that every **aggregate** selector resolves relative to the
owning asset and that none of them crosses a location. It can promise that,
because it resolves through `bms.assets.location_id` and, for `@group`, through
an index unique on `(location_id, code)`.

An **asset-qualified reference** resolves through `bms.assets.code`, and that
column is `.unique()` — **globally**, not per location and not per
organization. The qualified form therefore has no containment at all, and
decision 9's sentence does not in fact cover it.

Two things follow, and the second is the serious one:

- **`{OTHER_SITE_TX_01.kwh}` would resolve**, silently pulling a value from a
  different site into a site's own balance.
- **`bms.assets.organization_id` is `NOT NULL` under ADR 0043**, and this
  repository forces row-level security on tenant tables (ADR 0045). A global
  code lookup is a cross-tenant reference written in a formula. Whether RLS
  stops it depends on which role the calc engine holds at evaluation time,
  which makes the answer "it depends on a detail no formula author can see".
  That is not an acceptable answer for a tenancy boundary.

*Recommendation:* **confine a qualified reference to the owning asset's
location**, exactly as decision 9 confines an aggregate, and resolve the code
within that location rather than globally. One containment rule then covers
both forms; the tenancy question closes by construction rather than by relying
on the engine's role; and it costs nothing an author wants, because a balance
across two sites is not a balance.

*The alternative* is to let a qualified reference cross locations within the
owning asset's **organization**, and to narrow decision 9's containment
sentence to aggregates only. That is defensible for a real case — a two-site
energy balance — but it needs an explicit organization check in the resolver,
and the ADR must then say plainly that a formula may name an asset its author
cannot see in the UI.

## Dependencies

**No new npm dependency, in any workspace.** The parser extension is
hand-rolled in `packages/shared/src/calc-dsl/`, per ADR 0036 decisions 3 and
4 — no `eval`, no `new Function`, no `vm`, at parse time or evaluation time.
§9.4 is not triggered.

**One migration**, from the Q4 ruling: a single additive nullable column on
`bms.template_points` for the minimum coverage ratio (decision 11). Everything
else the engine needs is already there — `formula`, `formula_dialect`,
`calc_trigger`, `calc_interval_seconds` and `max_input_age_seconds`. Additive,
nullable, forward-only, no backfill, and no existing row changes meaning: the
same shape as migrations `0035` and `0036`, which added the ADR 0036 and ADR
0037 columns to this table. Its number is taken from `packages/db/drizzle/`
when it is written, and is deliberately not recorded here.

**The Q1b ruling grew the build but adds no package.** Decision 7 requires a
cross-asset dependency graph, a topological evaluation order and a cycle
detector. All three are ordinary graph work over rows this repository already
stores, and a hand-rolled Kahn or depth-first sort is the §9.4-avoiding option
on the same reasoning ADR 0037 decision 7 used to refuse `@nestjs/schedule`:
the dependency would buy less than it costs to gate.

**What the ruling does change is where the work sits.** ADR 0037's execution
host (`apps/api/src/calc/`) treats a sweep as a set of independent formulas,
one `try`/`catch` each, in no particular order. Under decision 7 the sweep gains
an ordering pass ahead of it. That is a change to the host, not only to the
parser, and any estimate for `F2.9` must carry it.

## Consequences

- **`F2.9` and `F2.8` both unblock on acceptance**, and only on acceptance.
  `F2.9`'s `Depends` column literally reads `F2.4, ADR`; the `ADR` entry is
  this record.
- **`docs/BACKLOG.md` §5 has no row for this decision**, although §5 exists to
  hold decisions owed "before the affected items start" and `F2.9` is marked
  `🔒 needs an ADR 0036 amendment first`. The queue row is owed and is not
  written by this ADR.
- **`F2.8` does not close until all three `estimatePue()` copies are gone.**
  Replacing the API pair and leaving `apps/web/src/lib/pue-estimate.ts:2` in
  place would leave the browser showing a fitted curve while the API served a
  measured ratio — two different numbers for one KPI, which is worse than the
  single wrong number that ships today.
- **ADR 0036 decision 7 is repealed** (decision 7 here), not narrowed. A reader
  of ADR 0036 must be able to find that out before relying on the ban; the Q0
  pointer in its `## Status` is how, and that pointer must be updated from
  "under review" to "repealed" on the day this ADR is Accepted.
- **The three guards named in decision 7 are the migration risk, not the
  schema.** Each is a live refusal with tests behind it. Replacing a guard with
  a dialect-gated one is where a `v1` formula would most easily lose a
  protection it still relies on, so the `v1` half of each guard needs a test
  that fails if the `v2` path swallows it.
- **Layered calculations make staleness compound.** A derived point built on
  another derived point inherits its input's age plus its own tick period. ADR
  0037 decision 5 resolves staleness per formula against raw inputs, which
  stops being the whole story once a chain exists. Decision 11's last rule
  answers it — a stale derived input is an excluded member like any other — but
  the compounding itself is not removed, only accounted for. A three-layer
  chain on a 10 s tick is up to three ticks behind its rawest input.
- **`F2.9`'s recorded effort predates every ruling on this page.** The backlog
  carries `4–6` for that row, set on 2026-08-22 when the shape of the amendment
  was unknown. Decisions 6, 7, 8 and 10 each add work the estimate never
  covered — a second reference form, a dependency graph, two cycle detectors
  sharing one builder, and a trigger-mode rule with a schema guard. The number
  needs re-setting at the plan gate, and this ADR does not re-set it.
- **Q1's ruling adds a second authoring surface to `F2.5`.** Two reference
  forms mean two error vocabularies through `formatCalcError`, and an author
  who must be told which form fits which question. `F2.5` is not yet built, so
  this lands as scope on that row rather than as rework.
- **Nothing is promoted yet.** No `AGENTS.md` §6 softening and no
  `docs/roadmap.md` edit belongs to this draft — there is no accepted decision
  to mirror. After acceptance both are owed, in a separate `chore(agents):` PR
  per §9.10 and §10.1, and not batched with any other ADR's sweep.
