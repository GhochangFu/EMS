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
-- varchar with no constraint, `z.string()` in the read contract. A fourth level
-- is already in flight: client ask B9 puts the reference's Critical/High/Warning
-- ladder against the shipped Critical/Warning/Info, and migrations here are
-- forward-only, so a CHECK chosen this week costs a migration and a deploy the
-- week the answer arrives. And an open vocabulary behind a closed switch is a
-- failure this repository has already paid for once: migration 0029 records
-- `categoryStyle` rendering a new category unstyled, which was F4.43.
--
-- Severity is not inert the way `category` is — it orders by urgency, selects a
-- colour, and escalation will read it. That is a reason to put the BEHAVIOUR in
-- the data, not to freeze the set: a value declared with no rank and no tone
-- would arrive unsortable and unstyled, which is F4.43 again.
--
-- Forward-only and idempotent. Step order is load-bearing, and drizzle wraps the
-- whole run in one transaction, so a mis-ordered file aborts the entire
-- migration rather than leaving a half-applied state.
--
-- **The vocabulary is created and seeded BEFORE the preflight, deliberately.**
-- The first draft of this file preflighted against the three literals
-- `('info','warning','critical')`, mirroring 0029. The migration review caught
-- that 0029 could only do that safely because both its tables were brand new:
-- here the vocabulary may already have been extended — that is the entire point
-- of the design — so a literal list makes a re-run abort on a value the table
-- already contains, and then instruct the operator to add a code that is
-- already there. Creating first lets step 3 ask the real question: is this row's
-- severity a code the vocabulary actually declares?

-- 1. The vocabulary, as data.
--
--    `code` is the primary key rather than a surrogate uuid, for the reason ADR
--    0031 A1.2 already records: code references survive a JSON round trip and
--    uuids do not. It also leaves the existing alarm and rule rows untouched.
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
  -- No DEFAULT, deliberately. 0029 gives `rule_categories.tone` a default of
  -- `neutral`, which is genuinely neutral; `info` would be a CLAIM -- a level
  -- seeded without a tone would silently become the least-urgent colour, which
  -- is F4.46 finding (2) exactly. ADR 0032 decision 1 lists no default and its
  -- Context says a level cannot be declared without a tone; a default falsified
  -- that for the one column where it matters most.
  tone varchar(32) NOT NULL,
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
--
--    `ON CONFLICT DO NOTHING` carries NO conflict target, deliberately. With
--    `(code)` named, Postgres swallows only violations of that one arbiter — a
--    row whose `code` is new but whose `rank` collides with
--    `alarm_severities_rank_key` would raise 23505 and abort the transaction.
--    That becomes reachable the moment somebody re-ranks the ladder to answer
--    B9 and this file is re-run. The bare form covers every unique constraint.
INSERT INTO bms.alarm_severities (code, label, tone, rank) VALUES
  ('info',     'Info',     'info',     10),
  ('warning',  'Warning',  'warning',  20),
  ('critical', 'Critical', 'critical', 30)
ON CONFLICT DO NOTHING;

-- 3. Preflight: fail readably rather than cryptically.
--
--    Measured on the pilot database 2026-08-18: `bms.alarms` holds warning 20 /
--    critical 19 / info 1, and `bms.automation_rules` holds critical 46 /
--    warning 42 / NULL 1. No other value exists, so this is expected to pass
--    here. It is for deployments this tree has not seen — the column has never
--    been constrained, and `alarms.severity` is written by
--    `AlarmThresholdService`, which is code rather than a constraint and can be
--    bypassed by any direct INSERT.
--
--    Without it, one such row aborts the entire pending-migration transaction at
--    step 5 with a bare SQLSTATE 23503 naming a constraint, not a value or a
--    table. Nothing is half-applied either way; the only thing at stake is
--    whether the operator can tell what to fix.
--
--    NULL is correctly not flagged: `automation_rules.severity` is nullable and
--    a NULL is never checked against a foreign key's parent (MATCH SIMPLE).
DO $$
DECLARE
  offender record;
BEGIN
  FOR offender IN
    SELECT 'bms.alarms.severity' AS col, a.severity AS value, count(*) AS rows
      FROM bms.alarms a
     WHERE NOT EXISTS (
             SELECT 1 FROM bms.alarm_severities s WHERE s.code = a.severity
           )
     GROUP BY a.severity
    UNION ALL
    SELECT 'bms.automation_rules.severity', r.severity, count(*)
      FROM bms.automation_rules r
     WHERE r.severity IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM bms.alarm_severities s WHERE s.code = r.severity
           )
     GROUP BY r.severity
  LOOP
    RAISE EXCEPTION
      'ADR 0032: % holds % row(s) with the value ''%'', which is not a code in bms.alarm_severities. Add it to that table, or correct the rows, then re-run.',
      offender.col, offender.rows, offender.value;
  END LOOP;
END $$;

-- 4. Match the referencing columns to the vocabulary's key width.
--
--    Both were varchar(32) while `alarm_severities.code` is varchar(64), which
--    the migration review flagged as a real hole rather than an untidiness: a
--    code of 33-64 characters can be seeded, is returned by
--    `GET /api/v1/vocabularies`, and passes `assertAlarmSeverity` — which checks
--    existence and `active`, not length — and only then fails the write with
--    SQLSTATE 22001. That is a 500 from the database on exactly the path ADR
--    0032 decision 7 says the service exists to turn into a 400.
--
--    0029 has no such gap: `assets.domain`, `asset_templates.domain` and
--    `automation_rules.category` are all varchar(64), matching their key.
--
--    Widening a varchar is a catalog-only change in Postgres — no table rewrite,
--    no scan — so this is safe on the populated pilot tables. It is also
--    naturally idempotent: re-running sets the same width.
ALTER TABLE bms.alarms
  ALTER COLUMN severity TYPE varchar(64);
ALTER TABLE bms.automation_rules
  ALTER COLUMN severity TYPE varchar(64);

-- 5. Point both columns at the vocabulary.
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
