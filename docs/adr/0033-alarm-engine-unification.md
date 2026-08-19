# ADR 0033 — Alarm engine unification: raise scope, trace volume, and rail timing

## Status

Accepted — 2026-08-19. Ruled by the repository owner while starting `F3.6`.

## Context

`F3.6` (`docs/BACKLOG.md`, Wave 0, P0) merges two alarm-raising paths that exist
today — `AlarmThresholdService`'s hardcoded ESKOM-only threshold ladder
(`evaluateEskomLegacyRules`) and DB-backed `bms.automation_rules`, evaluated
separately by `RulesService.evaluateEnabledRules` but never writing an alarm —
into one engine and one writer of `bms.alarms`.

This fixes a live defect: an asset crossing a shared threshold today raises
**two** open alarms, not one. `UPS-A` crossing 115 kW trips both the seeded rule
`demand_ceiling_notify` and the hardcoded `demand_high` ladder entry — same
condition, same asset, two rows in `bms.alarms`, because the two engines don't
know about each other and `ensureAlarm`'s dedupe keys differ between them.

Neither AGENTS.md §9.4 (no new dependency) nor §10 (this is already-approved
Wave-0 scope, not a promotion) requires an ADR for `F3.6` itself. This one
exists because four decisions inside the merge set precedent for later items —
`F3.10` (escalation/auto-clear), `F3.28` (dashboard parity, the Active Alarms
rail), and any future caller of rule evaluation — and a wrong default there is
expensive to unwind once `F3.10`/`F3.28` build on top of it.

## Decision

1. **The `/cr-overview` Active Alarms rail is deferred to `F3.10`, not built in
   `F3.6`.** `F3.6` ships the unified engine, the single `bms.alarms` writer, and
   the read endpoint only. The panel keeps rendering `ActiveRulesPanel`'s
   current-state "Active Rule Warnings" view until `F3.10` adds auto-clear-on-
   normal. A latched alarm rail without auto-clear would accumulate every
   transient simulator breach and never drain it, which fails the "does not fire
   when it should not" half of AGENTS.md §4.6 verification by construction.

2. **`POST /api/v1/rules/evaluate` raises real alarms, unscoped, and returns
   only the caller's scoped traces.** Alarms are facts about the plant, not a
   view scoped to whoever clicked "evaluate now" — a location-scoped operator
   triggering evaluation must raise the same alarms a global admin would. The
   endpoint evaluates the full published+enabled rule set, raises through the
   shared `AlarmRaiser`, and filters only the returned `RuleExecutionItem` list
   by the caller's asset scope. This matches the streaming path's existing,
   unscoped behavior.

3. **`bms.rule_executions` gets a trace row only when a rule raises an alarm,
   not on every evaluation.** The table carries no retention policy today,
   and an every-evaluation trace is `readings × rules` rows per batch. Bounding
   it to raises keeps "why did this alarm fire" answerable without unbounded
   growth. A retention policy for `bms.rule_executions`, if traffic later
   justifies logging more, is out of scope here.

4. **The hardcoded ESKOM legacy thresholds are retired from code and reseeded as
   DB rules before the code deletion lands.** `evaluateEskomLegacyRules` and its
   `assetOrgCodes` gate are deleted; migration `0033_eskom_simulator_threshold_
   rules.sql` seeds the equivalent five rules (`voltage_l1_v` × 2, `breaker_main`,
   `kw`, `pf`) as `source = 'simulator_threshold'` rows for every `ESKOM`
   electrical-domain asset, ordered to land before the code that removes the
   hardcoded path. This keeps the running demo/simulator's alarm behavior
   unchanged rather than silently dropping alarms the moment the code merges.

   **`kw >= 115` needed a wider net than "skip it, `UPS-A` has
   `demand_ceiling_notify`".** The hardcoded check is org-wide, not
   `UPS-A`-specific — traced against `apps/sim/src/index.js` during the build:
   every Eskom electrical asset without a tight `crProfile` (`TX-L1-MV`,
   `SWG-MDB1`, `PV-INV-01`, the per-province RSMOC utility/UPS/battery assets)
   can cross 115 kW. The migration's `NOT EXISTS` guard is keyed on the
   condition tuple `(asset_id, point_key, operator, threshold_value)`, not on
   `UPS-A`'s asset code, so it seeds `kw >= 115` everywhere it is not already
   covered — which happens to be everywhere except `UPS-A` — rather than
   skipping the rule for every asset.

   **The migration also links the pilot's already-open alarms, raised under
   the ladder's ad-hoc `rule_key` strings, to the rule that now expresses the
   same condition.** Caught by migration review after the first draft: without
   this, `alarms_open_per_rule_uidx` (decision 5) only governs rows carrying a
   `rule_id`, so a historical open alarm with `rule_id IS NULL` would sit
   forever beside a fresh rule-raised duplicate for the same asset and
   condition the moment the unified engine (tasks 3–5) starts writing
   `rule_id` — reopening the exact defect this ADR exists to close, on the
   pilot database specifically. Security review then found the preflight
   guarding that link had the same class of blind spot one layer up — see
   Consequences.

   **The voltage check's two bands are reseeded as two independent rules,
   which can both raise on one reading — accepted, not fixed.** The deleted
   ladder's `if (v >= 239.5) return critical; else if (v >= 237) return
   warning` was one hit per reading by construction; `compare()`
   (`rule-evaluation.ts`) cannot express "and below the next band up", the
   same single-operator limit that already forced dropping the `pf`
   sensor-fault guard. A reading at or above 239.5 V now opens both the
   critical and the warning alarm — different `rule_id`s, so the decision-5
   dedupe does not catch it. Owner-accepted 2026-08-19: both alarms are true
   of the reading, so this is redundant rather than wrong, and the natural
   place to revisit it is `F3.10`'s auto-clear work, not this migration.

5. **`bms.alarms.rule_id` is nullable, has no `ON DELETE` action, and the
   one-open-alarm-per-rule invariant is a partial unique index, not
   application code.** Migration `0032_alarm_rule_link.sql`. Nullable because a
   historical alarm — raised before this column existed, or by the hardcoded
   ladder before its DB-rule equivalent exists — cannot always be attributed to
   a rule, and forward-only migrations do not get to invent one it wasn't
   raised by. `NO ACTION` (the default) because deleting a rule that alarms
   still reference must fail loudly rather than cascade — but unlike ADR
   0032's `alarm_severities`, `automation_rules` is operator-managed CRUD with
   a lifecycle, not a closed vocabulary nobody deletes, so this is a real
   ongoing constraint on future migrations, not a formality: any migration
   that deletes `bms.automation_rules` rows must clear their `bms.alarms` rows
   first. `alarms_open_per_rule_uidx` (`(asset_id, rule_id)` `WHERE
   acknowledged_at IS NULL AND rule_id IS NOT NULL`) replaces `ensureAlarm`'s
   SELECT-then-INSERT dedupe — a real TOCTOU race, not a hypothetical one —
   with a constraint the database enforces.

## Dependencies

None — no new npm package.

## Consequences

- **Security review found decision 5's own migration had the collision it was
  meant to prevent, and it is fixed, not merely noted.** Migration `0033`'s
  historical-alarm backfill preflight (see decision 4) first filtered its scan
  to `rule_id IS NULL` — exactly the rows the backfill was about to touch —
  which meant it never saw an *already-linked* open alarm on the same asset
  and rule. Concretely: `UPS-A`'s `demand_ceiling_notify` alarm links to rule
  R by migration `0032`'s own code-match backfill; `UPS-A`'s `demand_high`
  alarm — unlinked, and mapping to the SAME rule R because `0033` skips
  reseeding `kw >= 115` there — would then be backfilled onto R too, past a
  preflight that could not see R was already taken, and abort the whole
  migration on a bare `alarms_open_per_rule_uidx` violation instead of the
  readable exception the preflight exists to raise. Fixed by projecting every
  open alarm, not only the unlinked ones; proven both directions inside a
  rolled-back transaction against the live database (the fix raises the
  intended exception, the pre-fix version does not) before merge, not assumed
  from the corrected query's shape.
- `F3.10` inherits an open item: it must add `bms.alarms.cleared_at` (or
  equivalent) and the auto-clear logic before the `F3.28` rail can switch from
  `ActiveRulesPanel` to a real Active Alarms table. Decision 1 is what makes
  that F3.10's job rather than F3.6's.
- Decision 2 means an unprivileged, location-scoped operator can cause
  org-wide side effects (alarms raised for assets they cannot see) by pressing
  "evaluate now." This mirrors the streaming path's existing scope and is
  accepted here rather than newly introduced, but any future audit of the
  write-access matrix (AGENTS.md §9, ADR 0017) should treat this endpoint as
  unscoped-write, not read-scoped.
- **Unreviewed consequence of decision 2, found by security review, recorded
  rather than fixed here:** `evaluateEnabledRules` now evaluates every
  enabled+published rule regardless of the caller's `assetIds` — 337 on the
  seeded dev database, 249 of them added by migration `0033` alone — so a
  caller whose scope resolves to zero assets still triggers roughly 337
  `rule_executions` inserts, 337 `automation_rules` updates, and org-wide
  alarm raises, for an empty response body. Pre-decision-2, a scoped caller's
  cost was bounded by their own rule count; post-decision-2 it is bounded by
  the whole rule set. The endpoint is not anonymous
  (`assertOperationsWriteRole`), so this is privileged-user amplification, not
  an open DoS, and no rate limiting exists anywhere in `apps/api` to bound it
  either way (`F4.17`). Not fixed here — flagged for whoever picks up
  `F4.17` or a follow-up on this endpoint specifically.
- Decision 3's "only on a raise" applies to the *streaming* engine
  (`AlarmEngineService`, which had no trace mechanism before F3.6). The
  on-demand evaluator's own every-evaluation trace — matched or not, the
  reason "evaluate now" exists at all — is pre-existing behaviour this ADR
  does not change; `recordTrace: false` on its `AlarmRaiser.raise()` call
  exists specifically so a raise there does not double that trace, not to
  extend decision 3 to a path it was never about. `bms.rule_executions`
  itself still has no retention policy either way — a future item wanting one
  is a new decision, not an extension of this one.
- Decision 4 is reversible without a migration edit, but only by
  **deactivation** (`enabled = false`), not `DELETE` — decision 5's `NO ACTION`
  foreign key rejects deleting a rule that any alarm still references, and once
  a seeded rule has raised even once, deleting it fails. Retiring the ESKOM
  thresholds later is a data change either way, not a schema change, because
  they now live as ordinary `bms.automation_rules` rows rather than code.
- Decision 5's `NO ACTION` is a standing constraint on every later migration
  that removes rows from `bms.automation_rules`: their `bms.alarms` rows (or
  `rule_id` references) must be cleared first, or the migration aborts. Two
  existing migrations delete rules outright
  (`0014_remove_smoc_pretoria_north.sql`,
  `0021_remove_onboarding_demo_locations.sql`); only `0021` survives this FK,
  and only because it happens to delete the affected assets' alarms first.
- Client ask **B9** (severity ladder: Critical/High/Warning vs. shipped
  Critical/Warning/Info) is unaffected by this ADR — ADR 0032 already made
  severity an open vocabulary, so B9's answer is an `INSERT`, not a migration,
  regardless of what this ADR decides.

## Promotion follow-ups owed (separate `chore(agents):` commit, per §9.10/§10.1)

- `docs/BACKLOG.md` §5 — add a row for this ADR.
- `docs/roadmap.md` — mirror `F3.6`'s progress.
- No `AGENTS.md` §6 item is promoted by this ADR (F3.6 was already in-scope), so
  no §6 edit is owed.
