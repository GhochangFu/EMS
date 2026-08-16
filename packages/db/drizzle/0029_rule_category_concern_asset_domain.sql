-- ADR 0031 (+ Amendment 1) — a rule's category is a *concern*; its plant domain
-- comes from the asset; and both vocabularies are **data, not DDL**.
--
-- `automation_rules.category` has been holding two different kinds of thing in
-- one column. `comfort`/`energy`/`safety`/`operations` are concerns — what a
-- rule is about. `electrical` is a plant domain — what kind of equipment the
-- rule watches, which no operator ever chose: migration 0022 writes it directly
-- for the PHE pilot's 48 threshold rules.
--
-- Every defect in this area has been a symptom of that overload. F4.43 found
-- `electrical` in the database and outside the declared union, after 48 of 89
-- rules had rendered with an empty, unstyled badge for as long as 0022 had been
-- deployed. F4.44 found the authoring surface still broken underneath it.
--
-- The plant axis was never missing — `bms.assets.domain` already holds it, and
-- all 48 rules carrying `category = 'electrical'` sit on assets whose `domain`
-- is already `electrical` (48 of 48, measured 2026-08-16). So this does not
-- invent an axis; it stops storing a copy of one on the wrong row.
--
-- **Why lookup tables rather than CHECK constraints (Amendment 1).** The first
-- draft of this migration froze both vocabularies in DDL. That is the wrong
-- shape for at least one of them and arguably both: the roadmap schedules three
-- domain packs — `E5.1` water-treatment (the P0 flagship and Ion Exchange's
-- core business), `E5.2` mechanical/utility, `E5.3` facility/smart-building —
-- so a fixed list of plant domains is known-wrong on a shorter timescale than
-- the roadmap itself. Migrations here are forward-only and may never be edited
-- after merge, so every new sector would have cost a migration and a deploy.
--
-- A foreign key is *stronger* enforcement than a CHECK, not weaker: the column
-- still cannot hold an undeclared value. What changes is that declaring one is
-- an INSERT. A domain pack seeds its own row.
--
-- Forward-only and idempotent. **Step order is load-bearing**: the FKs in step
-- 5 fail unless steps 2 and 3 have run, and drizzle wraps the whole run in one
-- transaction, so a mis-ordered file aborts the entire migration rather than
-- leaving a half-applied state.

-- 0. Preflight: fail readably rather than cryptically.
--
--    Before this branch, `assets.domain`, `asset_templates.domain` and the
--    onboarding draft all accepted `z.string().min(1).max(64)` — arbitrary text
--    — and `onboarding-excel.service.ts` reads the `domain` cell of an uploaded
--    spreadsheet verbatim. So a deployment this tree has never seen may hold a
--    value outside the seeded vocabulary.
--
--    Without this block, one such row aborts the entire pending-migration
--    transaction at step 5 with a bare SQLSTATE 23503 naming a constraint, not
--    a value or a table. Drizzle wraps all pending migrations in one
--    transaction, so nothing is half-applied either way — the only thing at
--    stake is whether the operator can tell what to fix.
--
--    Note this deliberately includes a hand-made `category = 'electrical'`:
--    step 4 reclassifies only `source = 'phe_alarm_seed'` rows, on purpose, so
--    any other row carrying that value is something a human must decide about
--    rather than something this migration should silently rewrite.
DO $$
DECLARE
  offender record;
BEGIN
  FOR offender IN
    SELECT 'bms.assets.domain' AS col, domain AS value, count(*) AS rows
      FROM bms.assets
     WHERE domain NOT IN ('electrical', 'hvac', 'it', 'environment', 'water')
     GROUP BY domain
    UNION ALL
    SELECT 'bms.asset_templates.domain', domain, count(*)
      FROM bms.asset_templates
     WHERE domain NOT IN ('electrical', 'hvac', 'it', 'environment', 'water')
     GROUP BY domain
    UNION ALL
    SELECT 'bms.automation_rules.category', category, count(*)
      FROM bms.automation_rules
     WHERE category NOT IN ('comfort', 'energy', 'safety', 'operations')
       AND NOT (source = 'phe_alarm_seed' AND category = 'electrical')
     GROUP BY category
  LOOP
    RAISE EXCEPTION
      'ADR 0031: % holds % row(s) with the value ''%'', which is not in the vocabulary this migration seeds. Add it to bms.asset_domains / bms.rule_categories, or correct the rows, then re-run.',
      offender.col, offender.rows, offender.value;
  END LOOP;
END $$;

-- 1. The two vocabularies, as data.
--
--    `code` is the primary key rather than a surrogate uuid, deliberately and
--    for a reason this repo already applies to `template_points.pointKey`:
--    domain packs must round-trip through JSON, which code references survive
--    and uuids do not. It also keeps `assets.domain` human-readable and means
--    the 148 existing rows need no rewrite.
--
--    Both tables are global rather than organization-scoped. A domain pack is a
--    product capability (`E5.1`/`E5.2`/`E5.3`), not a per-customer setting.
CREATE TABLE IF NOT EXISTS bms.rule_categories (
  code varchar(64) PRIMARY KEY,
  label varchar(128) NOT NULL,
  -- Badge styling, as data. `categoryStyle` in the web app used to be an
  -- exhaustive switch over the enum; with the vocabulary open, a new category
  -- would have rendered unstyled — which is *exactly* the F4.43 empty-badge
  -- failure this ADR exists to end. `tone` is a **presentation** vocabulary
  -- owned by the frontend, and that one really is closed, so it keeps a CHECK.
  tone varchar(32) NOT NULL DEFAULT 'neutral',
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rule_categories_tone_check
    CHECK (tone IN ('critical', 'warning', 'positive', 'informational', 'neutral'))
);

CREATE TABLE IF NOT EXISTS bms.asset_domains (
  code varchar(64) PRIMARY KEY,
  label varchar(128) NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Seed the concerns.
--
--    Four, and they are not expected to grow with sectors — a water-treatment
--    plant has the same comfort/energy/safety/operations concerns as a
--    substation. The table exists so that "not expected to" never again means
--    "cannot", which is the assumption `electrical` violated.
--
--    `electrical` is deliberately absent: it is a plant domain and belongs in
--    `asset_domains` below. Step 4 is what makes that survivable.
INSERT INTO bms.rule_categories (code, label, tone, sort_order) VALUES
  ('safety',     'Safety',     'critical',      10),
  ('energy',     'Energy',     'positive',      20),
  ('comfort',    'Comfort',    'informational', 30),
  ('operations', 'Operations', 'neutral',       40)
ON CONFLICT (code) DO NOTHING;

-- 3. Seed the plant domains.
--
--    The first four are measured, not guessed: 86 electrical, 14 hvac, 14 it,
--    34 environment — 148 rows, no other value present.
--
--    `water` is seeded now although **no row uses it yet**. It is not
--    speculative: `E5.1` is the P0 flagship, and the asset-template integration
--    suites already create templates with `domain = 'water'` and assert the
--    instantiated asset inherits it. Under the CHECK-constraint draft those
--    fixtures would have had to be rewritten to make the constraint pass —
--    changing tests to fit a schema, when the tests were describing the product
--    correctly and the schema was not.
INSERT INTO bms.asset_domains (code, label, sort_order) VALUES
  ('electrical',  'Electrical',  10),
  ('hvac',        'HVAC',        20),
  ('it',          'IT',          30),
  ('environment', 'Environment', 40),
  ('water',       'Water',       50)
ON CONFLICT (code) DO NOTHING;

-- 4. The 48 PHE rules become `safety`.
--
--    Their plant fact is not lost — it survives on the asset, which is the
--    whole point of the ADR. Only the concern is being supplied, and these are
--    36 `critical` and 12 `warning` voltage alarms, so `safety` is what they
--    always were.
--
--    Filtered on a CONSTANT, never through a join or subquery (AGENTS.md §4.4):
--    `source = 'phe_alarm_seed'` is 0022's own idempotency key, so this touches
--    exactly the rows that migration wrote and nothing an operator has since
--    created. Matching on `category = 'electrical'` alone would also catch a
--    hand-made rule that had somehow acquired the value, which is not this
--    migration's business to reclassify.
--
--    `updated_at` is deliberately NOT bumped. This changes how a fact is
--    encoded, not the fact: the alarm still watches the same point at the same
--    threshold with the same severity. Stamping it would present a schema
--    migration as an operator edit on 48 rows, and the rules list reads and
--    sorts that column.
UPDATE bms.automation_rules
SET category = 'safety'
WHERE source = 'phe_alarm_seed'
  AND category = 'electrical';

-- 5. Point both columns at their vocabulary.
--
-- `conname` is unique per relation, not globally, so an unqualified lookup
-- would skip the ADD CONSTRAINT if any other table anywhere carried the same
-- name — leaving the column unconstrained while the migration reported
-- success. Qualify by conrelid.
--
-- No ON DELETE clause: the default NO ACTION is what we want. Deleting a
-- vocabulary row that assets still reference must fail loudly rather than
-- cascade into deleting plant or nulling a NOT NULL column. Retiring a value is
-- `active = false`, which is why that column exists.
--
-- **These foreign keys check existence, not `active`.** That is a real gap and
-- it is deliberate: a row already carrying a since-retired code must keep
-- resolving, so the constraint cannot look at the flag. `VocabulariesService`
-- is therefore load-bearing rather than belt-and-braces — it is the only thing
-- stopping a *new* write from choosing a retired value, and any writer that
-- bypasses it (a future migration, a seed, psql) gets no such protection.
--
-- `automation_rules.category` also keeps `DEFAULT 'operations'`, which the FK
-- cannot see. If that row were ever deleted while no rule referenced it, the
-- delete would succeed and every later insert omitting `category` would fail on
-- the dangling default. Retire with `active = false` and this cannot arise.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_rules_category_fk'
      AND conrelid = 'bms.automation_rules'::regclass
  ) THEN
    ALTER TABLE bms.automation_rules
      ADD CONSTRAINT automation_rules_category_fk
      FOREIGN KEY (category) REFERENCES bms.rule_categories(code);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assets_domain_fk'
      AND conrelid = 'bms.assets'::regclass
  ) THEN
    ALTER TABLE bms.assets
      ADD CONSTRAINT assets_domain_fk
      FOREIGN KEY (domain) REFERENCES bms.asset_domains(code);
  END IF;

  -- `asset_templates.domain` is copied onto every asset the template
  -- instantiates (ADR 0015, `asset-templates-instantiate.service.ts`), so an
  -- unconstrained template domain becomes a foreign-key violation one hop
  -- later, at instantiation time, far from the form that caused it. The table
  -- is empty today, so this cannot fail on existing rows.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_templates_domain_fk'
      AND conrelid = 'bms.asset_templates'::regclass
  ) THEN
    ALTER TABLE bms.asset_templates
      ADD CONSTRAINT asset_templates_domain_fk
      FOREIGN KEY (domain) REFERENCES bms.asset_domains(code);
  END IF;
END $$;

-- 6. Drop `assets.domain`'s DEFAULT 'electrical'.
--
--    A default that silently classifies unstated plant is precisely how
--    `category` acquired its drift: a writer that supplies nothing gets a
--    confident, wrong answer instead of an error. The column stays NOT NULL, so
--    an INSERT omitting `domain` now fails loudly at the boundary rather than
--    inventing a plant domain. ADR 0031 decision 7.
--
--    `DROP DEFAULT` is a no-op when no default is present, so this needs no
--    existence guard to stay re-runnable.
--
--    `rtus.domain` and `point_keys.domain` are deliberately left alone. They are
--    different columns on different axes — both nullable, and a point key's
--    domain may legitimately diverge from the plant's. Constraining them is a
--    separate decision with its own evidence to gather.
ALTER TABLE bms.assets
  ALTER COLUMN domain DROP DEFAULT;
