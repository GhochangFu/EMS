# ADR 0031 — A rule's category is a *concern*; its plant domain comes from the asset

## Status

Proposed — the shape was ruled by the repository owner on 2026-08-16; three
questions below remain open at the §10 gate.

## Context

`automation_rules.category` currently holds **two different kinds of thing in
one column**, and every defect in this area for the past two days has been a
symptom of that.

- `comfort` · `energy` · `safety` · `operations` are **concerns** — what the
  rule is *about*. An operator chooses one.
- `electrical` is a **plant domain** — what kind of equipment the rule watches.
  Nobody chooses it; `packages/db/drizzle/0022_phe_alarm_threshold_rules.sql`
  writes it directly for the PHE pilot's 48 threshold rules.

The two are not alternatives, so putting them in one enum forces a false choice.
That is why the vocabulary has been awkward at every layer:

- **`F4.43`** found `electrical` in the database and outside the declared union,
  after 48 of 89 rules had rendered with an empty, unstyled badge for as long as
  migration `0022` had been deployed. It widened the *read* union only.
- **`F4.44`** found the authoring surface still broken: the builder offered four
  values, and a `<select>` whose value matches no `<option>` renders its **first**
  option, so editing a PHE rule silently claimed `Operations`.
- Neither fixed the cause, because the cause is the column.

### The plant axis already exists

`bms.assets.domain` is `NOT NULL` and holds exactly the vocabulary the category
enum was reaching for. Measured 2026-08-16 against the pilot database:

| `assets.domain` | assets |
|---|---|
| `electrical` | 86 |
| `environment` | 34 |
| `hvac` | 14 |
| `it` | 14 |

**All 48 rules carrying `category = 'electrical'` sit on assets whose `domain`
is already `electrical`** — 48 of 48. So the plant axis is not missing and does
not need inventing; it is recorded, correct, and unused. `rules.service.ts`'s
catalogue already returns `domain` per asset, and `rule-builder-panel.tsx`
fetches it and never reads it.

### The "18 mismatches" were never mismatches

An earlier reading of this data called out 16 rules on electrical assets
categorised `operations` and 2 categorised `energy`, as though they were
mislabelled. **Under two axes they are correct** — their concern is operations
or energy and their domain is electrical, and both facts are true at once. The
model was wrong, not the rows. This ADR therefore has **no backfill to do for
those 18**, which is a change from how the problem was first framed and is worth
recording rather than quietly dropping.

### `category` drives nothing

Checked before deciding, because it bounds the risk: no code branches on a
rule's category. It appears only in select/insert/update and one `ORDER BY`. It
is a badge, a filter and a sort key — it does not route alarms, gate evaluation,
or affect notification. **This is a reporting and usability decision, not a
safety one.**

## Decision

1. **`automation_rules.category` is a concern**, and its vocabulary is the four
   authorable values already in `authorableRuleCategorySchema`: `comfort`,
   `energy`, `safety`, `operations`. The operator chooses it. It does not grow
   to hold plant domains.
2. **The plant domain is read from the asset, never stored on the rule and never
   chosen by an operator.** `RuleListItem` gains an `assetDomain` field sourced
   from `bms.assets.domain` on the existing join, alongside `assetCode`,
   `assetName` and `siteName`. No new column, no new table, no migration for
   this decision on its own.
3. **The rules page shows both axes** — the concern badge it shows today, plus
   the plant domain beside it. The category filter keeps filtering on concern;
   filtering by domain is additive and may be deferred.
4. **The write vocabulary does not widen.** `rules.schema.ts` keeps re-exporting
   `authorableRuleCategorySchema`, so ADR 0019 §3's binding of template
   `content.alarms` is untouched. This ADR therefore does **not** engage the
   blast radius that made the "should the builder offer Electrical" question
   expensive — it answers it *no*, by making the question unnecessary.
5. **The schema change goes through ADR 0030.** `assetDomain` is added to
   `ruleListItemSchema` in `packages/shared/src/contracts/operations.ts` and the
   type derives via `z.infer`; the web client's `checkResponse` then covers it
   at the boundary like every other field.

## Open questions for the §10 gate

**These are the owner's, and nothing is built until they are answered.**

1. **What happens to the 48 rows carrying `category = 'electrical'`?**
   `electrical` is not a concern, so under decision 1 it has no home in the
   column.
   - *(a) Migrate them to a concern.* **Now non-lossy**, which it was not when
     this was declined during `F4.43`: all 48 sit on assets whose `domain` is
     already `electrical`, so the plant fact survives in the asset and only the
     concern is being supplied. They are 36 `critical` and 12 `warning` voltage
     alarms, which argues for `safety`. Costs a migration over live pilot data.
   - *(b) Keep `electrical` in the **read** union permanently as a legacy value.*
     No data change, and the badge keeps rendering. The cost is that the column
     stays mixed forever for those rows, and every future reader has to know why.

   These have opposite costs and the choice is not an agent's to make. The
   earlier ruling — *"leave the pilot data alone"* — points at (b); the fact that
   (a) is no longer lossy is new information that did not exist when that ruling
   was given.

2. **Does `assets.domain` get a declared vocabulary and a `CHECK`?** It is
   `character varying(64) NOT NULL DEFAULT 'electrical'` with **no constraint**,
   and the contract types it as a bare `z.string()`. So this ADR moves the plant
   axis onto a column that is *less* constrained than the one it is moving off,
   and **the default silently makes any asset created without a domain
   electrical**. Constraining it is DDL and is the honest place for the `CHECK`
   work queued in `docs/BACKLOG.md` §5.

3. **Does `automation_rules.category` get a `CHECK` too?** This is the queued
   §5 row. It is answerable only after question 1: a four-value `CHECK` rejects
   the 48 rows as they stand, so (a) makes it available and (b) forces a
   five-value constraint that encodes the legacy exception in the database.

## Dependencies

None. No new npm package, so §9.4 is not engaged.

## Consequences

- **`F4.44`'s fix stays exactly as built and is not superseded.** Its lock is
  written for the *class* — any readable category the builder does not offer —
  rather than for `electrical`, so it keeps working under either answer to
  question 1, and becomes dead code only if (a) is chosen *and* `electrical`
  later leaves the read union. That is the right order: it protects the data
  while the vocabulary question is open.
- **No backfill for the 16 + 2 rules** on electrical assets carrying
  `operations` / `energy`. They are correct under this model.
- **The category filter narrows from five entries to four** if question 1 is
  answered (a), because no rule will carry `electrical`. Under (b) it keeps
  five, one of which no new rule can ever use.
- **A domain filter is deliberately not decided here.** Showing the domain is
  decision 3; filtering by it is additive and should follow real use.
- **This partly absorbs the queued `CHECK`-constraint ADR** in `docs/BACKLOG.md`
  §5. That row asked which vocabulary a constraint should take; questions 2 and 3
  above are the same question asked of both columns, and the §5 row should point
  here rather than be answered separately.
- **`docs/AGENTS.production.md` is not edited by this ADR**, per the same
  reasoning ADR 0030 recorded.
- **The `AGENTS.md` promotion this ADR owes** is a `chore(agents):` sweep under
  §9.10/§10.1 after the feature lands: the §2 *API contracts* row gains the
  `assetDomain` field, and §4.8 gains the rule that a vocabulary describing
  *what a thing is* belongs on the thing, not on rows that reference it. It is
  not written yet, and should not be until the three questions are answered.
