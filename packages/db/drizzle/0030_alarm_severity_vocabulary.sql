-- ADR 0032 — alarm severity is a vocabulary with a rank, not an enum.
--
-- `F4.46` asserted that severity "wants a CHECK and an exhaustive switch, not a
-- lookup table", citing ADR 0031's asymmetry. That citation does not hold: ADR
-- 0031 does not mention severity at all, and its Amendment 1 moved the opposite
-- way, replacing the drafted CHECK constraints for `automation_rules.category`
-- and `assets.domain` with lookup tables and foreign keys on the owner's ruling.
-- Severity's storage was undecided, not decided.
--
-- Three facts settle it. The column is open today and nothing closes it —
-- varchar(32) with no constraint, `z.string()` in the read contract. A fourth
-- level is already in flight: client ask B9 puts the reference's
-- Critical/High/Warning ladder against the shipped Critical/Warning/Info, and
-- migrations here are forward-only, so a CHECK chosen this week costs a
-- migration and a deploy the week the answer arrives. And an open vocabulary
-- behind a closed switch is a failure this repository has already paid for
-- once: migration 0029 records `categoryStyle` rendering a new category
-- unstyled, which was F4.43.
--
-- Severity is not inert the way `category` is — it orders by urgency, selects a
-- colour, and escalation will read it. That is a reason to put the BEHAVIOUR in
-- the data, not to freeze the set: a value declared with no rank and no tone
-- would arrive unsortable and unstyled, which is F4.43 again.
--
-- Forward-only and idempotent. Step order is load-bearing: the foreign keys in
-- step 3 fail unless steps 1 and 2 have run, and drizzle wraps the whole run in
-- one transaction, so a mis-ordered file aborts the entire migration rather
-- than leaving a half-applied state.

-- 0. Preflight: fail readably rather than cryptically.
--
--    Measured on the pilot database 2026-08-18 before writing this file:
--    `bms.alarms` holds warning 20 / critical 19 / info 1, and
--    `bms.automation_rules` holds critical 46 / warning 42 / NULL 1. No other
--    value exists, so this block is expected to pass here. It is for
--    deployments this tree has not seen — the column has never been
--    constrained, and `alarms.severity` is written by
--    `AlarmThresholdService.normalizeSeverity`, which is code rather than a
--    constraint and can be bypassed by any direct INSERT.
--
--    Without it, one such row aborts the entire pending-migration transaction
--    at step 3 with a bare SQLSTATE 23503 naming a constraint, not a value or a
--    table. Nothing is half-applied either way; the only thing at stake is
--    whether the operator can tell what to fix.
DO $$
DECLARE
  offender record;
BEGIN
  FOR offender IN
    SELECT 'bms.alarms.severity' AS col, severity AS value, count(*) AS rows
      FROM bms.alarms
     WHERE severity NOT IN ('info', 'warning', 'critical')
     GROUP BY severity
    UNION ALL
    SELECT 'bms.automation_rules.severity', severity, count(*)
      FROM bms.automation_rules
     WHERE severity IS NOT NULL
       AND severity NOT IN ('info', 'warning', 'critical')
     GROUP BY severity
  LOOP
    RAISE EXCEPTION
      'ADR 0032: % holds % row(s) with the value ''%'', which is not in the vocabulary this migration seeds. Add it to bms.alarm_severities, or correct the rows, then re-run.',
      offender.col, offender.rows, offender.value;
  END LOOP;
END $$;

-- 1. The vocabulary, as data.
--
--    `code` is the primary key rather than a surrogate uuid, for the reason ADR
--    0031 A1.2 already records: code references survive a JSON round trip and
--    uuids do not. It also leaves the 40 alarm rows and 88 rule rows untouched.
--
--    `rank` carries urgency — higher is more urgent — and it is what makes an
--    open set safe for a column that has behaviour attached. UNIQUE because two
--    levels with the same urgency have no defined order. There is deliberately
--    no separate `sort_order`: display order follows urgency, and a second
--    column would let the two disagree.
--
--    `tone` keeps a CHECK, and that is not a contradiction of the ADR. ADR 0031
--    drew the same line for `rule_categories.tone`: the domain vocabulary is
--    open, the presentation vocabulary is closed and owned by the frontend.
--    These five are the `StatusPill` palette (`status-pill.tsx:3`); a tone
--    outside it renders nothing.
CREATE TABLE IF NOT EXISTS bms.alarm_severities (
  code varchar(64) PRIMARY KEY,
  label varchar(128) NOT NULL,
  tone varchar(32) NOT NULL DEFAULT 'info',
  rank integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alarm_severities_tone_check
    CHECK (tone IN ('critical', 'warning', 'info', 'offline', 'ok')),
  CONSTRAINT alarm_severities_rank_key UNIQUE (rank)
);

-- 2. Seed the three shipped levels.
--
--    Ranks are spaced by ten ON PURPOSE. Answering B9 with `high` is then one
--    INSERT at rank 25 between `warning` and `critical`, with no renumbering of
--    live rows and no second migration. That spacing is the entire practical
--    difference between this design and the CHECK constraint F4.46 asked for.
INSERT INTO bms.alarm_severities (code, label, tone, rank) VALUES
  ('info',     'Info',     'info',     10),
  ('warning',  'Warning',  'warning',  20),
  ('critical', 'Critical', 'critical', 30)
ON CONFLICT (code) DO NOTHING;

-- 3. Point both columns at the vocabulary.
--
--    `conname` is unique per relation, not globally, so an unqualified lookup
--    would skip the ADD CONSTRAINT if any other table anywhere carried the same
--    name — leaving the column unconstrained while the migration reported
--    success. Qualify by conrelid.
--
--    No ON DELETE clause: the default NO ACTION is what we want. Deleting a
--    severity that alarms still reference must fail loudly rather than cascade
--    into deleting alarms or nulling a NOT NULL column. Retiring a value is
--    `active = false`, which is why that column exists.
--
--    These foreign keys check existence, not `active` — the same deliberate gap
--    ADR 0031 records. A row already carrying a since-retired code must keep
--    resolving, so the constraint cannot look at the flag. `VocabulariesService`
--    is therefore load-bearing rather than belt-and-braces: it is the only thing
--    stopping a NEW write from choosing a retired value.
--
--    `automation_rules.severity` stays NULLABLE. F4.46's write-path fix
--    established that a rule may hold no severity — the alarm engine only ever
--    loads `ruleType = 'threshold'`, so a time-window rule has nothing to be
--    severe about — and a nullable foreign key permits exactly that: NULL is
--    not checked against the referenced table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alarms_severity_fk'
      AND conrelid = 'bms.alarms'::regclass
  ) THEN
    ALTER TABLE bms.alarms
      ADD CONSTRAINT alarms_severity_fk
      FOREIGN KEY (severity) REFERENCES bms.alarm_severities(code);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_rules_severity_fk'
      AND conrelid = 'bms.automation_rules'::regclass
  ) THEN
    ALTER TABLE bms.automation_rules
      ADD CONSTRAINT automation_rules_severity_fk
      FOREIGN KEY (severity) REFERENCES bms.alarm_severities(code);
  END IF;
END $$;
