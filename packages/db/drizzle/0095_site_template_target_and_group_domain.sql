-- F3.73 / ADR 0087 Amendment 1 — the site-template target, the group's domain,
-- the `site` section and two role codes.
--
-- 1. `bms.dashboard_templates.target` says what a template instantiates onto:
--    an asset group (`asset_group`, every row so far) or a whole site (`site`).
--    The default keeps every existing row and every existing insert valid. The
--    value list lives in `dashboardTemplateTargetSchema`
--    (`packages/shared/src/contracts/dashboard-templates.ts`); SQL has no
--    imports, so the CHECK restates it and
--    `tests/f3.73-site-template-schema.test.ts` compares the two.
--
-- 2. `bms.asset_groups.domain` names the asset domain a group belongs to, a
--    nullable FK to `bms.asset_domains(code)` (0029). A site template's tab
--    binds a domain, and the instantiator picks the group at the site whose
--    domain matches. Nullable: a group with no domain is a group nobody has
--    classified, and a default would be a claim (the reason 0029 dropped
--    `assets.domain`'s).
--
-- 3. One `bms.dashboard_sections` row, `site`, so a site template has a section
--    to sit in. Sort 900 is past the six 0056 rows (110-160).
--
-- 4. Two role codes (OQ6 ruling), `leak-sensor` and `smoke-detector`, in the
--    `0089` idiom. Sort 850 and 860 sit between 0089's Environment band
--    (810-840) and its Facility band (910-930); no earlier migration (0051,
--    0060, 0087, 0089) uses either.
--
-- NO POLICY CHANGE. `bms.asset_domains`, `bms.asset_roles` and
-- `bms.dashboard_sections` are global vocabulary tables, and the two new
-- columns sit on tables whose `tenant_isolation` policy already gates the row
-- by `organization_id`. A domain code is not tenant data, so the policy has
-- nothing to add. No GRANT: `0041`'s default privileges cover every verb.
--
-- WHY THE BACKFILL RUNS AFTER `RESET ROLE` (the 0085 reason). `bms.asset_groups`
-- has carried `FORCE ROW LEVEL SECURITY` since 0041, so `bms_owner` under
-- `SET ROLE` with no `app.current_organization` would update zero rows and
-- report success. `pnpm db:migrate` connects as `DATABASE_URL_SUPERUSER`, which
-- bypasses RLS outright, so the four `UPDATE`s run as that superuser.
-- `tests/f3.73-site-template-schema.test.ts` fails an `UPDATE` inside the
-- bracket.
--
-- THE BACKFILL. A group whose code equals a domain code takes that domain,
-- except `IT_LOAD`, which is a meter group and not an IT domain group; the
-- three named demo groups are mapped by hand. Every statement carries
-- `domain IS NULL`, so a re-run touches nothing.
--
-- Forward-only and idempotent. No statement-breakpoint markers (the `0038`
-- reason: drizzle splits on the raw string, even inside a comment).

SET ROLE bms_owner;

ALTER TABLE bms.dashboard_templates ADD COLUMN IF NOT EXISTS target varchar(32) NOT NULL DEFAULT 'asset_group';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dashboard_templates_target_check'
      AND conrelid = 'bms.dashboard_templates'::regclass
  ) THEN
    ALTER TABLE bms.dashboard_templates
      ADD CONSTRAINT dashboard_templates_target_check CHECK (target IN ('asset_group', 'site'));
  END IF;
END $$;

ALTER TABLE bms.asset_groups ADD COLUMN IF NOT EXISTS domain varchar(64) REFERENCES bms.asset_domains(code);

INSERT INTO bms.dashboard_sections (code, label, sort_order) VALUES
  ('site', 'Site layouts', 900)
ON CONFLICT DO NOTHING;

INSERT INTO bms.asset_roles (code, label, sort_order) VALUES
  ('leak-sensor',    'Leak Sensors',    850),
  ('smoke-detector', 'Smoke Detectors', 860)
ON CONFLICT DO NOTHING;

-- The migration asserts its own effect, per the `0059`/`0060`/`0087`/`0089`
-- idiom: ON CONFLICT DO NOTHING is silent by construction and would hide a row
-- that never landed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bms.dashboard_sections WHERE code = 'site') THEN
    RAISE EXCEPTION 'migration 0095: bms.dashboard_sections has no row for code ''site''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'leak-sensor' AND active = true) THEN
    RAISE EXCEPTION 'migration 0095: bms.asset_roles has no active row for code ''leak-sensor''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'smoke-detector' AND active = true) THEN
    RAISE EXCEPTION 'migration 0095: bms.asset_roles has no active row for code ''smoke-detector''';
  END IF;
END $$;

RESET ROLE;

UPDATE bms.asset_groups g SET domain = g.code WHERE g.domain IS NULL AND g.code <> 'IT_LOAD' AND EXISTS (SELECT 1 FROM bms.asset_domains d WHERE d.code = g.code);

UPDATE bms.asset_groups SET domain = 'electrical' WHERE domain IS NULL AND code = 'ups-battery';

UPDATE bms.asset_groups SET domain = 'it' WHERE domain IS NULL AND code = 'it-rack';

UPDATE bms.asset_groups SET domain = 'water' WHERE domain IS NULL AND code = 'demo-water-plant';
