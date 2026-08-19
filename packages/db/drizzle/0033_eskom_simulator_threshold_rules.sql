-- ADR 0033 / F3.6 — the ESKOM demo thresholds, expressed as rules instead of
-- code, landing BEFORE the code that deletes `evaluateEskomLegacyRules`
-- (F3.6 task 4) so the running demo/simulator's alarm behaviour is unchanged
-- across the deploy, not dropped for one window and restored the next.
--
-- Five checks, read straight off `alarm-threshold.service.ts`'s hardcoded
-- ladder: `voltage_l1_v >= 239.5` (critical), `voltage_l1_v >= 237` (warning),
-- `breaker_main < 0.5` (critical), `kw >= 115` (warning), `pf < 0.82` (warning).
-- Each condition carries `alarmMessage`/`unit` exactly as `0022` established,
-- so `composeAlarmMessage` (`apps/api/src/rules/alarm-message.ts`) renders the
-- byte-identical string whether the rule came from this seed or from `0022`'s.
--
-- ONE deliberate behaviour change, and it is not the one this migration set
-- out to make. The hardcoded ladder guards `pf` with `value > 0 && value <
-- 0.82` — excluding zero/negative readings, which read as a sensor fault
-- rather than a real power factor. `compare()` (rule-evaluation.ts) is a
-- single operator against a single threshold; it cannot express a two-sided
-- range, and the rule engine has no second "AND" condition to attach. The
-- seeded rule is therefore `pf lt 0.82` alone, which would also fire at
-- `pf = 0`.
--
-- **What actually keeps this away from a real plant is the `WHERE o.code =
-- 'ESKOM'` filter below, not the simulator.** Security review caught the
-- first draft of this note reasoning from `apps/sim/src/index.js`'s bounded
-- `pf` random walk (`[0.82, 0.99]`, never reaching the dropped guard's
-- range) — true for THIS seed, on THIS org's assets, but that reasoning does
-- not travel: a real RTU on a non-simulated org reporting `pf = 0` on a
-- genuine sensor fault would raise a "power factor low" alarm under the same
-- seed pattern reused for a different org. On the org this migration
-- actually seeds, the simulator's own bound means neither the old guard nor
-- its absence has ever fired on live demo data. Recorded here rather than
-- silently dropped.
--
-- The org gate this migration seeds AROUND is real, not incidental: today's
-- hardcoded ladder applies to every asset in the ESKOM org, and every one of
-- those assets is `domain = 'electrical'` (the ESKOM catalog uses exactly
-- four domains — electrical / hvac / it / environment — and only `electrical`
-- assets ever report `voltage_l1_v` / `breaker_main` / `kw` / `pf` in the
-- simulator's `stepElectrical`, so filtering on domain is equivalent to and
-- more precise than the code's own org-only check).
--
-- `kw >= 115` needs a wider net than "everything but UPS-A". `UPS-A` already
-- carries `demand_ceiling_notify` (`kw >= 115`, seeded by
-- `automation-rules-seed.ts`) — seeding it again there would recreate the
-- exact duplicate-alarm defect this item exists to fix. But the hardcoded
-- check is org-wide, not UPS-A-specific, and the simulator's `stepElectrical`
-- gives every `CR-*` control-room asset a tight kW profile (well under 115)
-- while every OTHER electrical asset — `TX-L1-MV`, `SWG-MDB1`, `PV-INV-01`,
-- and the per-province RSMOC utility/UPS/battery assets — uses the unbounded
-- `(v * i * pf) / 1000` formula with current up to 520 A, which CAN cross
-- 115 kW. Skipping this rule entirely would silently drop their demand-high
-- alarm the moment F3.6 task 4 deletes the hardcoded ladder. The `NOT EXISTS`
-- guard below is therefore keyed on the condition itself
-- `(asset_id, point_key, operator, threshold_value)`, not on an asset code —
-- it naturally skips `UPS-A` (already covered by `demand_ceiling_notify`,
-- which matches the same tuple) while still seeding every other qualifying
-- asset, with no asset code hardcoded here to go stale.
--
-- `category` is the ADR 0031 CONCERN axis, not the plant domain — 'electrical'
-- is what migration `0022` used here before that distinction existed, and
-- `automation_rules_category_fk` (migration 0029) is exactly the guard that
-- would now reject it. Voltage/breaker faults are `safety`; demand and power
-- factor are `energy`, matching `demand_ceiling_notify`'s own category.
--
-- `replace(a.code, '-', '_')` can collide: two ESKOM electrical assets whose
-- codes differ only by `-` vs `_` would generate the identical rule `code`,
-- which is UNIQUE, and abort this migration on the second INSERT. Security
-- review flagged it — no collision exists on the seeded catalog today (asset
-- codes are operator-editable through master-data admin, so this is a
-- forward-only-migration robustness gap worth knowing about, not a live bug).
-- Not fixed here: the fix is a schema-level decision (append a short hash, or
-- key on the asset's uuid instead of its code), and this migration seeds data,
-- it does not redesign the naming convention `0022` already established.
--
-- `source = 'simulator_threshold'` is a new, intentionally-scoped value — see
-- the companion change in `packages/shared/src/contracts/operations.ts`, which
-- previously documented this value as "declared and written by nothing".
--
-- Idempotent: every INSERT is guarded by `NOT EXISTS` on the condition tuple,
-- so a re-run neither duplicates a rule nor errors.
--
-- SECOND deliberate behaviour change, found by security review: the deleted
-- ladder's voltage check was `if (v >= 239.5) return critical; else if (v >=
-- 237) return warning` — one hit per reading, mutually exclusive by the
-- early return. Steps 1 and 2 below seed that as TWO independent rules, and
-- `AlarmEngineService.evaluateReadings` (F3.6) loops every cached rule per
-- reading with no such exclusion, so a reading >= 239.5 V now matches BOTH
-- and raises both — two open alarms, different `rule_id`s, so
-- `alarms_open_per_rule_uidx` does not dedupe them. Owner-accepted as a known
-- limitation (2026-08-19) rather than fixed: `compare()`
-- (rule-evaluation.ts) is a single operator against a single threshold and
-- cannot express "and below the next band up", the same shape that already
-- forced dropping the `pf` sensor-fault guard above. Both alarms are
-- individually true of the reading — the condition genuinely is both `>=
-- 237` and `>= 239.5` — so this is redundant, not incorrect; auto-clear
-- (`F3.10`) is the natural place to revisit it if the redundancy proves
-- disruptive in practice, not this migration.

-- 1. Voltage critical: >= 239.5 V.
INSERT INTO bms.automation_rules (
  code, name, description, category, rule_type, source, enabled,
  lifecycle_status, published_at, asset_id, point_key, operator,
  threshold_value, severity, condition, action
)
SELECT
  'ESKOM_' || replace(a.code, '-', '_') || '_VOLTAGE_CRITICAL',
  a.name || ' L1 voltage critical',
  'IF L1 voltage is at or above 239.5 V THEN raise a critical alarm.',
  'safety',
  'threshold',
  'simulator_threshold',
  true,
  'published',
  now(),
  a.id,
  'voltage_l1_v',
  'gte',
  239.5,
  'critical',
  '{"window":"latest","unit":"V","alarmMessage":"voltage_l1_critical"}'::jsonb,
  '{"type":"notify","target":"Operations"}'::jsonb
FROM bms.assets AS a
INNER JOIN bms.locations AS l ON l.id = a.location_id
INNER JOIN bms.organizations AS o ON o.id = l.organization_id
WHERE o.code = 'ESKOM'
  AND a.domain = 'electrical'
  AND NOT EXISTS (
    SELECT 1 FROM bms.automation_rules AS r
    WHERE r.asset_id = a.id
      AND r.point_key = 'voltage_l1_v'
      AND r.operator = 'gte'
      AND r.threshold_value = 239.5
  );
--> statement-breakpoint

-- 2. Voltage warning: >= 237 V.
INSERT INTO bms.automation_rules (
  code, name, description, category, rule_type, source, enabled,
  lifecycle_status, published_at, asset_id, point_key, operator,
  threshold_value, severity, condition, action
)
SELECT
  'ESKOM_' || replace(a.code, '-', '_') || '_VOLTAGE_WARN',
  a.name || ' L1 voltage warning',
  'IF L1 voltage is at or above 237 V THEN raise a warning alarm.',
  'safety',
  'threshold',
  'simulator_threshold',
  true,
  'published',
  now(),
  a.id,
  'voltage_l1_v',
  'gte',
  237,
  'warning',
  '{"window":"latest","unit":"V","alarmMessage":"voltage_l1_high"}'::jsonb,
  '{"type":"notify","target":"Operations"}'::jsonb
FROM bms.assets AS a
INNER JOIN bms.locations AS l ON l.id = a.location_id
INNER JOIN bms.organizations AS o ON o.id = l.organization_id
WHERE o.code = 'ESKOM'
  AND a.domain = 'electrical'
  AND NOT EXISTS (
    SELECT 1 FROM bms.automation_rules AS r
    WHERE r.asset_id = a.id
      AND r.point_key = 'voltage_l1_v'
      AND r.operator = 'gte'
      AND r.threshold_value = 237
  );
--> statement-breakpoint

-- 3. Main breaker open: < 0.5.
INSERT INTO bms.automation_rules (
  code, name, description, category, rule_type, source, enabled,
  lifecycle_status, published_at, asset_id, point_key, operator,
  threshold_value, severity, condition, action
)
SELECT
  'ESKOM_' || replace(a.code, '-', '_') || '_BREAKER_OPEN',
  a.name || ' main breaker open',
  'IF main breaker status drops below 0.5 THEN raise a critical alarm.',
  'safety',
  'threshold',
  'simulator_threshold',
  true,
  'published',
  now(),
  a.id,
  'breaker_main',
  'lt',
  0.5,
  'critical',
  '{"window":"latest","alarmMessage":"breaker_main_open"}'::jsonb,
  '{"type":"notify","target":"Operations"}'::jsonb
FROM bms.assets AS a
INNER JOIN bms.locations AS l ON l.id = a.location_id
INNER JOIN bms.organizations AS o ON o.id = l.organization_id
WHERE o.code = 'ESKOM'
  AND a.domain = 'electrical'
  AND NOT EXISTS (
    SELECT 1 FROM bms.automation_rules AS r
    WHERE r.asset_id = a.id
      AND r.point_key = 'breaker_main'
      AND r.operator = 'lt'
      AND r.threshold_value = 0.5
  );
--> statement-breakpoint

-- 4. Demand high: >= 115 kW. Skips UPS-A via the condition-tuple guard, not an
--    asset code — see the header note.
INSERT INTO bms.automation_rules (
  code, name, description, category, rule_type, source, enabled,
  lifecycle_status, published_at, asset_id, point_key, operator,
  threshold_value, severity, condition, action
)
SELECT
  'ESKOM_' || replace(a.code, '-', '_') || '_DEMAND_HIGH',
  a.name || ' demand high',
  'IF current demand is above 115 kW THEN raise a warning alarm.',
  'energy',
  'threshold',
  'simulator_threshold',
  true,
  'published',
  now(),
  a.id,
  'kw',
  'gte',
  115,
  'warning',
  '{"window":"latest","unit":"kW"}'::jsonb,
  '{"type":"notify","target":"Energy Manager"}'::jsonb
FROM bms.assets AS a
INNER JOIN bms.locations AS l ON l.id = a.location_id
INNER JOIN bms.organizations AS o ON o.id = l.organization_id
WHERE o.code = 'ESKOM'
  AND a.domain = 'electrical'
  AND NOT EXISTS (
    SELECT 1 FROM bms.automation_rules AS r
    WHERE r.asset_id = a.id
      AND r.point_key = 'kw'
      AND r.operator = 'gte'
      AND r.threshold_value = 115
  );
--> statement-breakpoint

-- 5. Power factor low: < 0.82. See the header note on the dropped `> 0` guard.
INSERT INTO bms.automation_rules (
  code, name, description, category, rule_type, source, enabled,
  lifecycle_status, published_at, asset_id, point_key, operator,
  threshold_value, severity, condition, action
)
SELECT
  'ESKOM_' || replace(a.code, '-', '_') || '_PF_LOW',
  a.name || ' power factor low',
  'IF power factor is below 0.82 THEN raise a warning alarm.',
  'energy',
  'threshold',
  'simulator_threshold',
  true,
  'published',
  now(),
  a.id,
  'pf',
  'lt',
  0.82,
  'warning',
  '{"window":"latest"}'::jsonb,
  '{"type":"notify","target":"Energy Manager"}'::jsonb
FROM bms.assets AS a
INNER JOIN bms.locations AS l ON l.id = a.location_id
INNER JOIN bms.organizations AS o ON o.id = l.organization_id
WHERE o.code = 'ESKOM'
  AND a.domain = 'electrical'
  AND NOT EXISTS (
    SELECT 1 FROM bms.automation_rules AS r
    WHERE r.asset_id = a.id
      AND r.point_key = 'pf'
      AND r.operator = 'lt'
      AND r.threshold_value = 0.82
  );
--> statement-breakpoint

-- 6. Link historical alarms the hardcoded ladder already raised, under its
--    ad-hoc `rule_key` strings, to the rule that now expresses the same
--    condition — caught by migration review, not anticipated when 0032 was
--    written.
--
--    `0032`'s own backfill only matches `rule_key = automation_rules.code`,
--    so it could never link these: the ladder's keys (`demand_high`,
--    `voltage_l1_critical`, ...) were never any rule's `code` until the
--    INSERTs above ran, seconds ago in migration time but a separate
--    statement. Left alone, every alarm the pilot already has open under
--    those keys stays `rule_id IS NULL` forever — invisible to
--    `alarms_open_per_rule_uidx` (migration 0032, which only governs rows
--    carrying a `rule_id`) — so the FIRST alarm the unified engine raises for
--    the same asset and the same condition, once F3.6 tasks 3-5 make it write
--    `rule_id`, opens a second row beside it. That is the exact duplicate
--    this item exists to close, surviving on the one class of row this
--    migration did not look at.
--
--    Matched on the identical condition tuple as this file's own NOT EXISTS
--    guards, so `demand_high` resolves to `demand_ceiling_notify` on
--    `UPS-A` — never re-seeded above — and to this file's own seeded rule
--    everywhere else. A plain `UPDATE ... FROM`, matching this file's other
--    statements: `automation_rules_asset_id` is not unique, but the five
--    NOT EXISTS guards above (and the seeded catalog's own uniqueness at
--    demo-data scale) mean at most one rule ever matches a given
--    `(asset_id, marker)` pair. If a row of `bms.alarms` joins to more than
--    one candidate, Postgres picks one non-deterministically — the preflight
--    below is what actually protects the constraint, not this assumption.
--
--    The preflight runs FIRST and simulates the update rather than trying it
--    and catching a bare SQLSTATE 23505: this UPDATE does not add a new
--    constraint the way `0032`'s own preflight protects one being added a few
--    statements later in the same file — the unique index already exists and
--    is already enforced, so an uncaught collision here would abort the
--    whole migration with a message naming an index, not an asset.
DO $$
DECLARE
  offender record;
BEGIN
  FOR offender IN
    WITH projected AS (
      -- Every currently-open alarm, not only the ones this migration is about
      -- to link. `COALESCE(r.id, a.rule_id)` projects what its `rule_id`
      -- WOULD be after the UPDATE below — the join only ever matches a row
      -- whose `rule_key` is one of the five legacy ladder markers, so an
      -- alarm already linked by migration 0032's own code-match backfill
      -- joins to nothing here and keeps its existing `a.rule_id` via the
      -- COALESCE fallback.
      --
      -- Security review caught the bug this comment now documents: the first
      -- draft filtered to `a.rule_id IS NULL`, which made the collision this
      -- migration exists to catch invisible to it. `UPS-A` proves it exactly:
      -- migration 0032's own backfill already links its `demand_ceiling_
      -- notify`-keyed alarm to rule R (rule_key='demand_ceiling_notify' — no
      -- legacy marker matches it, so it stays excluded from the UPDATE below).
      -- `UPS-A` also holds an open `demand_high`-keyed alarm, `rule_id IS
      -- NULL`, whose marker DOES match — and matches the SAME rule R, because
      -- step 4 above skipped seeding a duplicate `kw >= 115` rule there. Filtered
      -- to only-still-NULL rows, the preflight could never see R already
      -- taken on that asset; the UPDATE would then abort the whole migration
      -- on a bare `alarms_open_per_rule_uidx` violation instead of the
      -- readable exception below.
      SELECT
        a.id AS alarm_id,
        a.asset_id,
        COALESCE(r.id, a.rule_id) AS rule_id
      FROM bms.alarms a
      LEFT JOIN bms.automation_rules r
        ON r.asset_id = a.asset_id
       AND (
         (a.rule_key = 'voltage_l1_critical' AND r.point_key = 'voltage_l1_v' AND r.operator = 'gte' AND r.threshold_value = 239.5) OR
         (a.rule_key = 'voltage_l1_high'     AND r.point_key = 'voltage_l1_v' AND r.operator = 'gte' AND r.threshold_value = 237) OR
         (a.rule_key = 'breaker_main_open'   AND r.point_key = 'breaker_main' AND r.operator = 'lt'  AND r.threshold_value = 0.5) OR
         (a.rule_key = 'demand_high'         AND r.point_key = 'kw'          AND r.operator = 'gte' AND r.threshold_value = 115) OR
         (a.rule_key = 'power_factor_low'    AND r.point_key = 'pf'          AND r.operator = 'lt'  AND r.threshold_value = 0.82)
       )
      WHERE a.acknowledged_at IS NULL
    )
    SELECT asset_id, rule_id, count(*) AS open_rows
      FROM projected
     WHERE rule_id IS NOT NULL
     GROUP BY asset_id, rule_id
    HAVING count(*) > 1
  LOOP
    RAISE EXCEPTION
      'ADR 0033: backfilling historical alarms would leave asset % with % open alarms mapped to rule %, violating alarms_open_per_rule_uidx. Acknowledge or merge the duplicate bms.alarms rows for that asset/condition, then re-run.',
      offender.asset_id, offender.open_rows, offender.rule_id;
  END LOOP;
END $$;
--> statement-breakpoint

UPDATE bms.alarms a
   SET rule_id = r.id
  FROM bms.automation_rules r
 WHERE a.rule_id IS NULL
   AND r.asset_id = a.asset_id
   AND (
     (a.rule_key = 'voltage_l1_critical' AND r.point_key = 'voltage_l1_v' AND r.operator = 'gte' AND r.threshold_value = 239.5) OR
     (a.rule_key = 'voltage_l1_high'     AND r.point_key = 'voltage_l1_v' AND r.operator = 'gte' AND r.threshold_value = 237) OR
     (a.rule_key = 'breaker_main_open'   AND r.point_key = 'breaker_main' AND r.operator = 'lt'  AND r.threshold_value = 0.5) OR
     (a.rule_key = 'demand_high'         AND r.point_key = 'kw'          AND r.operator = 'gte' AND r.threshold_value = 115) OR
     (a.rule_key = 'power_factor_low'    AND r.point_key = 'pf'          AND r.operator = 'lt'  AND r.threshold_value = 0.82)
   );
