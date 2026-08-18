# ADR 0032 — Alarm severity is a vocabulary with a rank, not an enum

## Status

**Accepted** — 2026-08-18. Ruled by the repository owner while closing `F4.46`,
after the row's own premise was found to be wrong (below).

This ADR authorises DDL over live pilot data. Read decisions 1–6 before writing
the migration.

## Context

`F4.46` recorded a scope note asserting that severity "wants a `CHECK` and an
exhaustive switch, **not** a lookup table", citing the asymmetry
[ADR 0031](./0031-rule-category-concern-and-plant-domain.md) established.

**That citation does not hold.** ADR 0031 does not mention severity — zero
occurrences — and its **Amendment 1** moved the other way: the `CHECK`
constraints drafted for `automation_rules.category` and `assets.domain` were
replaced by lookup tables and foreign keys, on the owner's explicit ruling
(*"this product might incorporate other sectors as well … can you make it
dynamic?"*).

**But a live rule *had* decided it, and this ADR reverses that rule rather than
merely filling a gap.** `AGENTS.md` §4.8 lists "a badge's *tone*, an operator, **a
severity**" as examples of a closed vocabulary and instructs: "Declare it as a
`z.enum`, back it with a `CHECK` if it is stored, and lean on exhaustive
`switch`." That text is owner-approved — it landed in the `chore(agents):` sweep
promoting ADR 0031 — and CLAUDE.md's precedence carve-out covers the status line
and §6 only, not §4 code rules. The compliance review caught this ADR rebutting
the backlog row's citation while never naming the document that actually said it.

The owner ruled for the table, so the decision stands; what this ADR owes is the
acknowledgement and a **`chore(agents):` sweep**, tracked in `BACKLOG.md` §5 per
§10.1. Two sentences go stale on merge: §4.8's severity example, and §4.8's
"**Two** contract fields are deliberately no longer enums: `category` and
`assetDomain`" — now three. Editing `AGENTS.md` is not this change's to make
(§9.10).

Three facts decide it now.

**The column is open today and nothing closes it.** `bms.alarms.severity` is
`varchar(32)` `NOT NULL` with no constraint (`bms-schema.ts:429`),
`automation_rules.severity` is the same and nullable (`:560`), and the read
contract is `z.string()` (`contracts/operations.ts:82`). The only thing keeping
the data clean is that every current writer happens to be well-behaved.

**A fourth level is already in flight.** Client ask **B9** puts the reference's
Critical / **High** / Warning ladder against the shipped Critical / Warning /
Info and asks which is correct. The handover states our assumption — the
existing three are retained — but the client has not answered. Migrations here
are forward-only and may never be edited after merge, so a `CHECK` chosen this
week costs a migration and a deploy the week the answer arrives.

**An open vocabulary behind a closed switch is a known failure in this
repository.** Migration `0029` records it: `categoryStyle` was an exhaustive
switch over the category enum, so once the vocabulary opened a new category
"would have rendered unstyled — which is *exactly* the `F4.43` empty-badge
failure this ADR exists to end." `F4.46` shipped the same shape for severity —
an exhaustive `switch` in `alarmSeverityTone`. Under a lookup table that switch
becomes the bug, so this ADR removes it rather than inheriting it.

### What makes severity different, and why it is not an argument for a `CHECK`

`category` is a badge, a filter and a sort key — ADR 0031 checked before
deciding and found nothing branches on it. **Severity is not inert**: it orders
alarms by urgency, it selects a colour, and escalation will read it. That is a
real asymmetry, and the `F4.46` row read it as a reason to freeze the set.

It is instead a reason to make the **behaviour** part of the data. A value
declared by an `INSERT` with no rank and no tone would arrive unsortable and
unstyled — which is the `F4.43` failure again. So the table carries what the
behaviour needs, and a new level cannot be declared without it.

## Decision

1. **`bms.alarm_severities`, keyed by `code`.** Columns: `code varchar(64)`
   primary key, `label varchar(128) NOT NULL`, `tone varchar(32) NOT NULL` (no
   default — `info` would be a claim, and a level seeded without a tone must
   fail rather than quietly become the calmest one),
   `rank integer NOT NULL UNIQUE`, `active boolean NOT NULL DEFAULT true`,
   `created_at timestamptz NOT NULL DEFAULT now()`. `code` is the primary key
   rather than a surrogate uuid, for the reason ADR 0031 A1.2 already records:
   code references survive a JSON round trip and uuids do not, and the existing
   rows need no rewrite.

2. **`rank` carries urgency, and it is what makes the open set safe.** Higher is
   more urgent. Seeded `info` 10, `warning` 20, `critical` 30 — **deliberately
   spaced by ten so a level can be inserted between two existing ones without
   renumbering**, which is precisely what answering `B9` with `high` requires
   (`high` would be 25). `UNIQUE` because two levels with the same urgency have
   no defined order. There is no separate `sort_order`: display order follows
   urgency, and a second column would let the two disagree.

3. **`tone` keeps a `CHECK`, and this is not a contradiction.** ADR 0031 drew
   the same line for `rule_categories.tone`: the *domain* vocabulary is open,
   the *presentation* vocabulary is closed and owned by the frontend. Allowed
   values are the `StatusPill` palette — `critical`, `warning`, `info`,
   `offline`, `ok`. A tone outside it renders nothing.

4. **Foreign keys on both columns**, `alarms_severity_fk` and
   `automation_rules_severity_fk`, referencing `bms.alarm_severities(code)`,
   with **no `ON DELETE` clause**. `automation_rules.severity` stays nullable —
   `F4.46`'s write-path fix established that a rule may hold no severity, and a
   nullable foreign key permits exactly that. Retire a value with
   `active = false`; never `DELETE`.

5. **The migration preflights and is idempotent.** It fails with a readable
   `RAISE EXCEPTION` naming the table, value and row count if any row holds a
   code the vocabulary does not declare, rather than aborting the whole
   pending-migration transaction on a bare SQLSTATE 23503. Constraint-existence
   lookups are qualified by `conrelid`, since `conname` is unique per relation
   and not globally. Measured before writing (2026-08-18): `bms.alarms` holds
   `warning` 20 / `critical` 19 / `info` 1; `bms.automation_rules` holds
   `critical` 46 / `warning` 42 / `NULL` 1.

   **The vocabulary is created and seeded *before* the preflight**, which is a
   deliberate departure from `0029` and the second thing the migration review
   corrected. `0029` could preflight against literal lists because both its
   tables were brand new and could not already hold anything. Here the table may
   already have been extended — that is the design — so a literal list makes a
   re-run abort on a value the table already contains and then tell the operator
   to add a code that is already there. The preflight asks the real question
   instead: is this row's severity a code `bms.alarm_severities` declares?

   The seed uses a **bare `ON CONFLICT DO NOTHING`**, with no conflict target. A
   named `(code)` arbiter swallows only that constraint's violations, so a row
   whose code is new but whose `rank` collides would abort the transaction —
   reachable the moment somebody re-ranks the ladder to answer `B9`.

6. **The referencing columns are widened to `varchar(64)` to match
   `alarm_severities.code`.** They were `varchar(32)`. The mismatch was not
   untidiness: a 33–64 character code can be seeded, is returned by
   `GET /api/v1/vocabularies`, and passes `assertAlarmSeverity` — which checks
   existence and `active`, not length — and only then fails the write with
   SQLSTATE 22001. That is a 500 from the database on precisely the path
   decision 7 says the service exists to turn into a 400. Widening a `varchar`
   is catalog-only in Postgres, so this is safe on the populated pilot tables.
   `0029` has no equivalent gap; its three referencing columns are already 64.

7. **`VocabulariesService` gains `alarmSeverities`.** `GET /api/v1/vocabularies`
   returns the active rows as a third array, and `assertAlarmSeverity(code)`
   joins `assertRuleCategory` / `assertAssetDomain` so an unknown code is a
   **400 at the boundary rather than a 500 from a constraint violation** — the
   reason that service exists. Reads stay uncached, for ADR 0031's reason: a
   cache would hide a newly seeded value until restart.

8. **`automationRuleSeveritySchema` stops being a `z.enum`.** It becomes a
   shape-only code schema, exactly as `ruleCategoryCodeSchema` did under ADR
   0031 Amendment 1. The set is closed by the foreign key; the schema checks
   only that a code is plausible.

9. **`alarmSeverityTone` reads `tone` from the vocabulary; the exhaustive
   `switch` is deleted.** Keeping it would reproduce `F4.43`. **The unknown
   branch stays**, and this ADR does not weaken it: the foreign key makes an
   unknown code impossible *at rest*, but the page renders an alarm payload
   against a separately-fetched vocabulary, so a retired code or a client
   holding a stale vocabulary can still present one. `F4.46`'s answer stands —
   neutral grey and its own counter, never the least-urgent bucket.

## Dependencies

None. No new npm package (AGENTS.md §9.4 is not engaged).

## Consequences

- **`B9` becomes an `INSERT`.** If the client asks for `high`, it is one seeded
  row at rank 25 with tone `warning`, and no migration, no deploy, and no code
  change. That was the point.
- **`AlarmThresholdService.normalizeSeverity` had to change, and an earlier
  draft of this ADR got that wrong.** It said the method could be left alone
  because its unrecognised-value arm "can no longer fire once
  `automation_rules.severity` carries a foreign key". **That is false**, and the
  migration review caught it before merge. The foreign key admits *every* code
  in `bms.alarm_severities` — that is the entire point of the design — so a rule
  seeded at `high` passed the FK, reached that method, and had its severity
  rewritten to `warning` on every alarm it raised. The promise above would have
  been false on the one path that matters most.

  The method now supplies only the default it genuinely owes — `null →
  "warning"`, because `alarms.severity` is `NOT NULL` and `F4.46` moved the
  defaulting *to* that edge — and passes any non-null code through.
  `alarm-threshold.service.spec.ts` asserts both directions, and was confirmed
  to fail against the old body.

  The general lesson is worth keeping: **opening a vocabulary invalidates every
  closed list that reads it, not only the ones the compiler can find.** This one
  was a hand-written `if` over three string literals, so nothing in the type
  system pointed at it.
- **The `F4.46` scope note is superseded**, not merely disagreed with. Its
  "severity wants a `CHECK`" sentence should be read against this ADR.
- **`rank` has no consumer on the day it lands.** Nothing sorts alarms by
  severity today; the summary cards are counted, not ordered. It is seeded
  correctly now so that the first thing which needs it — escalation, or the
  ordering of a four-level ladder — finds the data already true rather than
  backfilling urgency onto live rows.
- **Retirement is untested against live plant.** `active = false` is the
  declared path, and the foreign keys check existence rather than the flag, so a
  retired value keeps resolving for rows that already hold it. No row has been
  retired yet, so that path rests on ADR 0031's precedent.
