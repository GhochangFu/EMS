# ADR 0058 — Template alarms seed automation rules on instantiate

## Status

**Accepted** — 2026-09-07, by the repository owner, the same day it was
drafted, for `E2.4` (Track D, P1, Wave 3, `Depends: F2.5 ✅, F3.6 ✅,
E2.1 ✅`). Four product rulings were taken by the owner in chat on 2026-09-07,
all as recommended, and are decisions 1–4 below; decisions 5–10 are the
engineering consequences, drafted and accepted with the record ("Accepted. go
ahead"). The local-override question the `E2.4` row names as its third product
call is answered by ruling 1 rather than separately — a republish never moves a
live rule, so an override can only be overwritten by an explicit per-rule
re-apply. `plan-architect` writes the plan next; no implementation code exists
at acceptance.

## Context

`E2.4`. Today an asset template's `content.alarms` and the live rule engine are
entirely unconnected, and that is recorded rather than accidental. [ADR
0019](./0019-template-content-model.md) §3 states *"Nothing wires these alarms
up either"*, because `ruleDraftBodySchema`
(`apps/api/src/rules/rules.schema.ts`) requires `ruleType`, `condition` and
`action`, and a template alarm carries none of the three. §3 closes by naming
the fix as `E2.x`/`F3.x` work *"with its own ADR"*. This is that ADR.

The gap is verified in code, not inferred.
`AssetTemplateInstantiationService.instantiate` writes exactly two tables —
`bms.assets` and `bms.asset_points` — and contains no reference to rules or
alarms. `content.alarms` has exactly two readers, both validators
(`findUnresolvedContentRefs` and `assertTemplateAlarmVocabularies`).

The prize is larger than saving typing. `bms.alarm_enrichments` ([ADR
0034](./0034-alarm-enrichment-schema.md), `E2.1`) stores cause, impact, corrective
action and skill **per live alarm, typed by an operator every time one fires**;
`content.alarms[].philosophy` stores the same four fields **per asset class,
once**. The same knowledge is entered twice and the only link is a person
remembering.

The mapping is nearly free because ADR 0019 already bound the template's
`operator`, `severity` and `category` to the rule engine's own vocabularies,
and [ADR 0032](./0032-alarm-severity-vocabulary.md), [ADR
0031](./0031-rule-category-concern-and-plant-domain.md) and ADR 0034 kept them bound. The
only field a rule needs that a template alarm lacks is `action`.

Two prior decisions constrain the shape and are **not** re-opened here:

- **ADR 0019 Amendment 2, decisions 1–2.** `operator` and `thresholdValue` are
  a paired optional group. Both present makes an alarm a *site-independent
  proto-rule*. Both absent makes it an *alarm philosophy row* — the ISA-18.2
  rationalization record for the asset class, whose limit is set per site at
  commissioning. One without the other is already refused.
- **[ADR 0041](./0041-notification-service.md) decision 9 and the `F3.7` Q3
  ruling.** `review` is inert: `shouldNotify` dispatches for `notify` only.
  A `review` rule still raises its alarm through `AlarmRaiser`; it pages
  nobody.

Four decisions were put to the owner on 2026-09-07 and ruled the same day.
They are decisions 1–4 below.

## Decision

### 1. A seeded rule is a one-time copy with provenance, and a republish never moves it

Instantiating a published template creates one `bms.automation_rules` row per
template alarm per asset. Republishing that template at v2 with a changed
threshold **does not alter any live rule**. What it changes is what the next
instantiation gets.

The link is not discarded, though. Each seeded rule records where it came from
and what it was seeded with, so the product can show which live rules have
drifted from their class and let an engineer re-apply the current version
deliberately (decision 8). Ruled against the alternatives "seed once, never
follow" (no DDL, but the template stops being a fleet surface the day after
commissioning) and "republish updates live rules" (silently changes what
operators are woken up for, with no review step).

### 2. A seeded rule carries `action = review` and joins no notification channel

Every seeded rule is written with `action = {"type": "review", "target":
<category>}`, where `<category>` is the alarm's `category` when it has one and
`DEFAULT_RULE_CATEGORY_CODE` otherwise. **No `bms.rule_notifications` row is
written.**

Instantiating forty chillers against a template with four alarms therefore
arms 160 rules that raise alarms onto the Active Alarms rail and page nobody.
Promoting the ones that matter to `notify` and joining channels is a
commissioning act, done in the existing `F3.7` per-rule channel picker.

This needs no new field: the alternative of letting the template author declare
the action per alarm would widen `templateAlarmSchema` and force a version bump
on every existing template that wanted it.

### 3. A philosophy row seeds a disabled rule with no threshold

A template alarm with no `operator` and no `thresholdValue` still becomes a
rule row: `rule_type = 'threshold'`, `enabled = false`, `operator` and
`threshold_value` both `NULL`, carrying the parameter (`point_key`),
`severity`, `category` and the philosophy text. The commissioning step is then
a visible worklist in the Rule Engine rather than a silent gap.

Because such a row is armable in principle, **enabling a `threshold` rule whose
`operator` or `threshold_value` is `NULL` is refused** — a new guard on the
toggle and update paths, returning 400. A half-built rule cannot be armed.

### 4. A proto-rule seeds enabled

A template alarm with both `operator` and `thresholdValue` seeds with `enabled
= true`. The class already knows the limit, so the asset is watched from the
moment it exists. Decision 2 is what makes this safe: a true breach raises an
alarm and pages no one.

### 5. `bms.automation_rules` gains four provenance columns (migration `0067`)

```sql
source_template_id      uuid    REFERENCES bms.asset_templates(id)
source_template_version integer
source_alarm_code       varchar(64)
seeded_baseline         jsonb
```

All four are nullable and all four are `NULL` for every rule not seeded from a
template — which is every row on `main` today. No backfill.

`seeded_baseline` holds the alarm's values **as seeded**: `operator`,
`thresholdValue`, `severity`, `category`, `message`. It is what makes drift
attributable. Comparing a live rule against the template's *current* values
says only that the two differ; comparing it against `seeded_baseline` as well
says whether the engineer moved it, the template moved, or both.

**No new unique index.** An earlier draft of this decision carried a partial
unique index on `(source_template_id, source_alarm_code, asset_id)`, and it
could never fire: instantiate creates *new* assets on every call, so `asset_id`
is always fresh and no pair of seeded rows can collide on it. The guard that
does the work is the one migration `0048` already added —
`automation_rules_org_code_idx`, unique on `(organization_id, code)` — which
decision 7's derivation must satisfy, and which is what refuses a second
instantiation reusing the same asset codes. That refusal is pre-empted before
the transaction opens (decision 7) so the caller gets a named error rather than
a raw constraint violation.

What `0067` does add is a plain, non-unique index on `source_template_id`, to
serve decision 8's list route without a sequential scan of the rule table.

### 6. `source` gains the value `template_alarm`

`packages/shared/src/contracts/operations.ts` currently enumerates
`["operator_rule", "simulator_threshold", "phe_alarm_seed"]`. It gains
`template_alarm`, which is the ADR 0030 contract surface and puts
`@bms/shared` in the build chain.

`source` says *that* a rule was seeded; decision 5's columns say *from what*.
Both are needed — `source` alone cannot answer a re-apply.

### 7. Rule codes are derived, sanitized, and hashed on overflow

`bms.automation_rules.code` is `varchar(64)`, unique on `(organization_id,
code)` since migration `0048`, and `ruleCodeSchema` accepts
`^[A-Z0-9][A-Z0-9_-]*$`. An asset code is `z.string().min(1).max(64)` with **no
character restriction**, and an alarm code is up to 64 characters, so a naive
join both overflows the column and can carry characters the regex refuses.

The scheme, matching the existing seed convention (`CR-BATT-1` +
`TEMP_WARNING` → `CR_BATT_1_TEMP_WARNING`):

1. Normalize each part: uppercase, replace every run of characters outside
   `[A-Z0-9]` with `_`, strip leading and trailing `_`.
2. Join as `{ASSET}_{ALARM}`; prefix `R_` if the result does not start
   `[A-Z0-9]`.
3. If the result exceeds 64 characters, truncate to 55 and append `_` plus the
   first 8 hex characters of the SHA-256 of the untruncated string — so the
   code stays deterministic and a truncation collision does not.

The batch is pre-checked for code collisions before the transaction opens, the
same way `assertAssetCodesFree` already pre-checks asset codes.

### 8. Drift and re-apply are two routes on the template

- `GET /api/v1/admin/asset-templates/:id/seeded-rules` — the rules seeded from
  this template, each with its asset, its current values, its
  `seeded_baseline`, and a verdict of `in_sync` / `local_override` /
  `template_moved` / `both_moved`.
- `POST /api/v1/admin/asset-templates/:id/seeded-rules/reapply` — body names
  rule ids explicitly; applies the currently published version's alarm values
  to those rules and re-stamps `seeded_baseline` and
  `source_template_version`.

Re-apply is per rule and never implicit, which is what answers the local-override
question: an engineer's tuned threshold is only ever overwritten by someone
choosing that rule in this call, seeing both values.

**Re-apply arms a rule it completes.** A philosophy row (decision 3) seeds
disabled precisely because it has no limit. When a later template version
supplies one and an engineer re-applies it, the reason for the rule being off
is gone, so re-apply sets `enabled = true` on any rule whose `operator` and
`threshold_value` were `NULL` and are now filled. Leaving it off would produce
the one outcome decision 3 exists to prevent: a rule that looks complete and
watches nothing. Re-apply never *disables* a rule, and never changes `enabled`
in any other case — a rule an engineer deliberately turned off stays off.

Both routes require `requireMasterDataUser` and the same
`canManageOrganization` check `instantiate` uses.

### 9. The seed writes inside the existing instantiate transaction

The rule rows are inserted inside the existing
`withTenant(this.tenantDb, template.organizationId, ...)` block in
`instantiate()`, alongside `assets` and `asset_points`. That file's own comment
is the reason: *"Partial instantiation is the one outcome worse than
failure"*. Forty assets where twelve silently have no rules is the same
commissioning defect one level down.

The `master.asset.instantiate` audit payload gains `ruleCount` and
`disabledRuleCount`. Re-apply writes its own `master.asset_template.reapply_alarms`
audit action.

### 10. `AssetInstantiationResultDto` reports what was seeded

The result gains `ruleCount`, `disabledRuleCount`, and a per-asset
`seededRules` count, the same shape as the existing `skippedPoints`. A caller
can tell from the response how many commissioning limits are still owed.

## Dependencies

None. No new npm package.

## Consequences

- **Migration `0067`** adds four nullable columns and one plain, non-unique
  index on `source_template_id` to `bms.automation_rules`. Forward-only and
  idempotent per AGENTS.md; no backfill, so every existing rule reads as not
  seeded. It adds **no** unique index — see decision 5 for why the one an
  earlier draft carried could never fire.
- **Assets instantiated before this ADR get nothing.** There is no retro-seed
  path and none is planned here — a template's alarms reach an existing asset
  only by someone creating the rules by hand. Raising that as its own row is
  cheaper than guessing which of forty live assets wanted them.
- **`@bms/shared` changes**, so the build chain is shared → db → api → web and
  the contract test in `apps/api/src/openapi/` must be updated with the new
  `source` value.
- **160 rules from one press is a real number**, and every one of them writes
  `bms.rule_executions` rows on each evaluation sweep. `F3.47` is already open
  on that table having no throttle and no retention policy; this ADR makes the
  row count it worries about larger and does not close it.
- **`E2.2` is untouched.** This row wires the *rule* side; `E2.2`
  (template-driven alarm philosophy KB) remains the knowledge side, and the two
  meet only in `content.alarms[].philosophy`, which both read.
- **Deferred:** what happens to seeded rules when a template is archived, and
  what a *new draft* of a template means for rules seeded from the published
  version. Both are lifecycle questions with no live consumer yet.
- **AGENTS.md §6 and `docs/roadmap.md`** need the matching promotion in a
  separate `chore(agents):` PR (§9.10) once this lands.
