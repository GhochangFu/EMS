# ADR 0031 — A rule's category is a *concern*; its plant domain comes from the asset

## Status

**Accepted** — 2026-08-16. The two-axes shape and all three gate questions were
ruled by the repository owner on the same day; the answers are recorded in
*Questions resolved at the §10 gate* below and folded into the decisions.

**Amendment 1 — Accepted 2026-08-16.** Decisions 7 and 8 said each vocabulary
gets a `CHECK` constraint. Building `F4.45` produced evidence those answers were
given on incomplete information, and the owner ruled that **both vocabularies
become data**, then accepted the amendment at the §10 gate the same day. See
*Amendment 1* at the end of this document; it supersedes the enum/`CHECK` half
of decisions 6–8.

**This ADR authorises DDL over live pilot data**, which nothing else in this
thread has. `F4.43` and `F4.44` were deliberately constrained to avoid it. Read
decisions 6–8 before writing the migration.

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

6. **The 48 rows carrying `category = 'electrical'` are migrated to `safety`.**
   Their plant fact survives on the asset — all 48 sit on assets whose `domain`
   is already `electrical` — so only the concern is being supplied, and they are
   36 `critical` and 12 `warning` voltage alarms. `electrical` then leaves the
   category vocabulary entirely: `automationRuleCategorySchema` collapses to the
   authorable four, and the read/write asymmetry `F4.43` introduced **ends**.
   The migration must key on the rows it means — `source = 'phe_alarm_seed' AND
   category = 'electrical'` — never on category alone.
7. **`bms.assets.domain` gets a declared vocabulary and a `CHECK`:**
   `electrical` · `hvac` · `it` · `environment`, matching what the column already
   contains (86 / 14 / 14 / 34, total 148, no other value present). A matching
   enum replaces the bare `z.string()` in the contract, so the domain is checked
   at the API boundary like every other field. **The `DEFAULT 'electrical'` is
   dropped** — a default that silently classifies unstated plant is how this
   column would have acquired the same drift `category` did.
8. **`automation_rules.category` gets a four-value `CHECK`**, available only
   because decision 6 clears the 48 rows first. Ordering is therefore not
   cosmetic: **migrate, then constrain, in that order, in one migration.** A
   constraint added first fails on 48 existing rows.

## Questions resolved at the §10 gate

All three were put to the repository owner on 2026-08-16 and all three were
answered as recommended. Kept as the record of what was asked, since the
Decision section records only what was chosen.

1. **The 48 `electrical` rows — migrate or keep as legacy?** → *Migrate to
   `safety`.* Decision 6. The owner had declined migration during `F4.43`; what
   changed is that it is **no longer lossy** — the plant fact lives on the asset,
   which was not established when the earlier ruling was given. That was put to
   them explicitly as new information rather than treated as settled.
2. **Does `assets.domain` get a vocabulary and a `CHECK`?** → *Yes, four values.*
   Decision 7, including dropping the default. Without this the ADR would have
   relocated the defect rather than fixed it: the plant axis would have moved
   onto a **less** constrained column than the one it left.
3. **Does `category` get a `CHECK`?** → *Yes, four values, contingent on (1)
   being migrate.* Decision 8. The contingency is real and is now an ordering
   constraint inside the migration.

## Dependencies

None. No new npm package, so §9.4 is not engaged.

## Consequences

> **Superseded in part by Amendment 1.** Everything below that reasons from a
> `CHECK` constraint should be read as "the vocabulary is closed by
> `automation_rules_category_fk` / `assets_domain_fk` into
> `bms.rule_categories` / `bms.asset_domains`". The *conclusions* are unchanged
> — a foreign key closes the set at least as firmly — but the mechanism named is
> not the one that shipped. Marked inline rather than rewritten, so the
> reasoning as it stood at the gate stays legible.

- **`F4.44`'s lock becomes dead code, and this ADR requires deleting it.** That
  is not a criticism of `F4.44` — its lock was correct, load-bearing, and the
  only thing protecting 48 rules while the vocabulary question was open. But
  decisions 6 and 8 together make a non-authorable category **structurally
  impossible**: the 48 rows are migrated, `electrical` leaves the union, and a
  `CHECK` stops any other value arriving. `categoryAuthoring` would then always
  return `locked: null`, `omitLockedCategory` would never omit, and the builder's
  locked branch would be unreachable.

  AGENTS.md §4.4 is explicit that a guard made vacuous by a change must be
  **deleted, not kept**, precisely because its having once been meaningful is
  what makes it hard to spot later — and `F4.23`/`F4.44` are the two worked
  examples that rule cites. So `F4.45` deletes `categoryAuthoring`,
  `omitLockedCategory`, `isAuthorableCategory`, `BuilderForm.lockedCategory` and
  the locked render branch. **`authorableCategories` and `categoryLabels` stay**
  — they are the derive-don't-restate mechanism, not the lock — as does
  `tests/rule-vocabulary.test.ts`'s `<option>`-literal scan.

  Anyone tempted to keep the lock "for defence in depth" should note that the
  `CHECK` is the defence, and the response validator (ADR 0030) is what would
  notice a value arriving some other way.
- **No backfill for the 16 + 2 rules** on electrical assets carrying
  `operations` / `energy`. They are correct under this model.
- **The category filter narrows from five entries to four**, since no rule will
  carry `electrical` once decision 6 has run.
- **The read/write asymmetry `F4.43` introduced ends.** `automationRuleCategorySchema`
  and `authorableRuleCategorySchema` become the same four values, so the derived
  construction (`[...authorable.options, "electrical"]`) collapses to one enum.
  `tests/rule-vocabulary.test.ts` must be re-read as a whole when that happens:
  its "keeps `electrical` out of what an operator can author" case survives
  trivially, and its "still describes what migration 0022 writes" case is about
  `source = 'phe_alarm_seed'`, which decision 6 **keeps** — the migration still
  uses it as its idempotency key, so that half stays meaningful.
- **A domain filter is deliberately not decided here.** Showing the domain is
  decision 3; filtering by it is additive and should follow real use.
- **This absorbs the queued `CHECK`-constraint ADR** in `docs/BACKLOG.md` §5.
  That row asked which vocabulary a constraint should take; decisions 7 and 8
  are the same question asked of both columns, and answering it for one alone
  would have been the narrower and worse fix.
- **This is the first DDL over live pilot data in this thread, and the ordering
  inside the migration is load-bearing.** `F4.43` and `F4.44` were both scoped to
  avoid touching it. Decision 8's `CHECK` fails on 48 existing rows unless
  decision 6's `UPDATE` runs first, in the same migration. `migration-reviewer`
  should see it before merge, and per AGENTS.md §4.4 the `UPDATE` must filter on
  a **constant** (`source = 'phe_alarm_seed' AND category = 'electrical'`) rather
  than reach `automation_rules` through a subquery or join.
- **`docs/AGENTS.production.md` is not edited by this ADR**, per the same
  reasoning ADR 0030 recorded.
- **The `AGENTS.md` promotion this ADR owes** is a `chore(agents):` sweep under
  §9.10/§10.1 after the feature lands: the §2 *API contracts* row gains the
  `assetDomain` field, and §4.8 gains the rule that a vocabulary describing
  *what a thing is* belongs on the thing, not on rows that reference it. §4.8's
  paragraph on the read/write asymmetry also becomes **historical** rather than
  current, since decision 6 ends it — rewrite it as the worked example it now is,
  do not delete it. Not written yet, per §9.10; it lands after `F4.45`.

---

## Amendment 1 — the vocabularies are data, not DDL

**Status: Accepted — 2026-08-16.** Ruled by the repository owner during
`F4.45`, and accepted at the §10 gate the same day, after both review agents
had flagged that implementing against an unaccepted amendment was the one
blocking issue in the change.

### What prompted it

Decision 7 gave `assets.domain` a four-value `CHECK`, and decision 8 gave
`automation_rules.category` the same. Both were answered at the gate on the
strength of a census of existing rows — 86 `electrical`, 34 `environment`,
14 `hvac`, 14 `it`; 148 assets, no other value present.

**That census was true and the conclusion drawn from it was wrong**, for a
reason no amount of measuring the current data could have surfaced: it
described what the column *holds*, not what the roadmap has already committed
to putting in it.

Two facts found while building:

1. The asset-template integration suites create templates with
   `domain = 'water'` and assert the instantiated asset inherits it
   (`asset-templates.instantiate.integration.spec.ts`, `…lifecycle…`, 14 sites).
   Under the `CHECK` those fixtures would have had to be rewritten — changing
   tests to fit a schema, when the tests described the product correctly and the
   schema did not.
2. `docs/BACKLOG.md` schedules **three domain packs**: `E5.1` water-treatment
   (P0, the flagship, Ion Exchange's core business), `E5.2` mechanical/utility,
   `E5.3` facility/smart-building. A fixed list of plant domains is therefore
   known-wrong on a shorter timescale than the roadmap itself.

Put to the owner as a choice between four values and five, the answer was
neither: *"this product might incorporate other sectors as well … can you make
it dynamic?"* — and, asked whether that extended to rule categories, *"Yes
Categories should be configurable."*

### Decisions

**A1.1 — Both vocabularies become tables.** `bms.rule_categories` and
`bms.asset_domains`, each keyed by `code`. `automation_rules.category`,
`assets.domain` and `asset_templates.domain` become foreign keys into them
(`automation_rules_category_fk`, `assets_domain_fk`,
`asset_templates_domain_fk`, migration `0029`).

This does **not** weaken decision 7's reasoning, which was that the plant axis
must not move onto a *less* constrained column than the one it left. A foreign
key is stronger than a `CHECK`: the column still cannot hold an undeclared
value, and the set can no longer be out of step with itself. What changes is
that declaring a value is an `INSERT` a domain pack ships in its own seed.

**A1.2 — `code` is the primary key, not a surrogate uuid.** Domain packs
round-trip through JSON, which code references survive and uuids do not — the
reasoning `template_points.pointKey` already records. It also keeps
`assets.domain` legible and leaves the 148 existing rows untouched.

**A1.3 — Retire with `active = false`, never `DELETE`.** The foreign keys carry
no `ON DELETE` clause deliberately, so deleting a value that plant still
references fails loudly rather than cascading into deleted plant or a nulled
`NOT NULL` column. `GET /api/v1/vocabularies` serves active rows only.

**A1.4 — Badge styling becomes a column, and it keeps a `CHECK`.**
`rule_categories.tone` is one of `critical` · `warning` · `positive` ·
`informational` · `neutral`, bounded by `rule_categories_tone_check`.

This is the one place the amendment *adds* a fixed vocabulary, and the
asymmetry is the point. `categoryStyle` was an exhaustive `switch` over the
category union whose own comment said to keep it exhaustive, because `F4.43`
was precisely what a non-exhaustive one does: `undefined` for a value the type
system said could not occur, and 48 badges rendered with the literal class
`"undefined"`. With the category vocabulary open, that `switch` **cannot** be
exhaustive. Switching on tone can be — tone is presentation, owned by the
frontend, and genuinely closed — so a newly seeded category arrives styled
rather than blank. Exhaustiveness moved to where it can still hold.

**A1.5 — `water` is seeded now, unused.** Zero of 148 assets carry it. It is
seeded because `E5.1` is the P0 flagship and the template suites already use
it — the same shape as `safety` being authorable and unpopulated before this
item. Declared-but-unpopulated is the honest state; absent would not be.

**A1.6 — Both tables are global, not organization-scoped.** A domain pack is a
product capability (`E5.1`/`E5.2`/`E5.3`), not a per-customer setting. If a
tenant ever needs its own sector, that is a new decision with its own evidence.

**A1.7 — The boundary check moves to a service.** `VocabulariesService`
(`apps/api/src/vocabularies/`) validates a code at every write path that stores
one: asset create/update, onboarding commit, template create/update, and
`validateRuleDraft` — which is the single choke point for rule create, update,
preview **and duplicate**.

This is not optional tidiness. With the vocabulary out of the request schema,
an unknown code would otherwise reach Postgres and return a **500 where the
enum used to give a 400**, and the Zod `invalid_enum_value` message that listed
the valid options would be gone. The service reproduces both: rejection at the
boundary, and the live list named back to the caller.

**A1.8 — ADR 0019 §3's template-alarm guard is relocated, not dropped.**
`templateContentSchema` typed `alarms[].category` with the shared enum, so an
unknown category was a Zod issue — and `asset-templates-content.schema.spec.ts`
asserts exactly that (*"`water` is not a live rule category"*). A pure schema
cannot query a table, so the check moves to
`AssetTemplatesAdminService.assertTemplateAlarmCategories`. Nothing converts a
template alarm into an `automation_rules` row today, but a template is an
authoring surface: a category that does not exist is a defect authored now and
discovered whenever that conversion is built — which is the shape of the
`electrical` bug this ADR is unwinding.

### Consequences

- **The contract no longer declares either value set.** `ruleCategoryCodeSchema`
  and `assetDomainCodeSchema` are `z.string()`, so ADR 0030's response validator
  can no longer report an unknown category the way it reported `electrical`.
  That check did not vanish — it moved to the database, where it is absolute
  rather than advisory — but it is no longer the *contract's* check, and this is
  recorded rather than glossed because the whole `F4.43` lesson is that a
  contract which stops describing reality is worse than one that admits it.
- **`AuthorableRuleCategory` is deleted**, and `AutomationRuleCategory` is now a
  `string`. Two names for one vocabulary was a distinction the schema no longer
  supports.
- **`F4.44`'s lock is deleted**, per §4.4 and this ADR's own Consequences
  section. `apps/web/src/lib/rule-category-authoring.ts` is replaced by
  `lib/vocabulary.ts`, whose subject is resolving a code to a label and a tone
  to a class — the part that is still logic once the options are fetched.
- **The rules page, the rule builder and the asset admin form share one query
  key**, so three screens cannot offer three different vocabularies.
- **`rtus.domain` and `point_keys.domain` are deliberately untouched.** They are
  different columns on different axes, both nullable, and a point key's domain
  may legitimately diverge from the plant's. Constraining them is a separate
  decision with its own evidence to gather.
- **Effort was re-estimated from 2–3 to 6–8** and the item now touches all five
  packages.
- **The `AGENTS.md` promotion owed grows accordingly**: the §2 *API contracts*
  row gains `assetDomain` **and** the note that two vocabularies are now rows;
  §4.8 gains the rule that a vocabulary describing *what a thing is* belongs on
  the thing, plus the distinction between an open vocabulary (a table) and a
  closed one (an enum) and how to tell them apart. Not written yet, per §9.10.
