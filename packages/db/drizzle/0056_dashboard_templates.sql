-- F3.36 / ADR 0049 decision 1 + Amendment 1 decision 3 + Amendment 2 — section
-- dashboard templates.
--
-- Two tables and one column. `bms.dashboard_sections` is a GLOBAL vocabulary;
-- `bms.dashboard_templates` is TENANT-SCOPED from this file; `bms.dashboards`
-- gains `template_id`, and its `tenant_isolation` policy is re-created to check
-- that new parent. The two tables land in one migration because the template's
-- `section` column references the vocabulary, so splitting them would ship a
-- file that cannot apply on its own.
--
-- WHY A SECOND TEMPLATE TABLE AND NOT A FLAG ON `bms.dashboards` (decision 1).
-- The flag was the far cheaper option — it would have reused the builder AND
-- the duplicate dialog `F3.1d` shipped, needing no new authoring surface at
-- all. It was declined FOR VERSIONING: a published template and the dashboards
-- copied from it would drift with no record of which version a copy came from,
-- and `bms.asset_templates` already solves that properly. Putting a section
-- template inside `asset_templates` was declined on a fact rather than a
-- preference: a template widget references point KEYS, and a point key resolves
-- against ONE asset's points at instantiation, so a dashboard spanning many
-- assets of different types has no single asset whose keys resolve.
--
-- WHY `bms.dashboard_sections` IS GLOBAL AND CARRIES NO `organization_id`, NO
-- RLS AND NO POLICY (Amendment 2 decision 5). It is the sixth table of the
-- class `0047` deliberately left alone: `asset_domains`, `rule_categories`,
-- `alarm_severities`, `alarm_skills`, and `asset_roles` since `0051`. The
-- load-bearing reason is Amendment 1 decision 2(b) applied to a second
-- vocabulary — ADR 0049 decision 3's stock catalog only works if a SECTION code
-- means the same thing in every organization, because each of the six stock
-- entries names its section and a per-tenant vocabulary would resolve it
-- differently per tenant. And a nullable `organization_id` with NULL meaning
-- global is the shape decision 3 rejected outright, on `E7.1c` and ADR 0043
-- Amendment 5. `tests/f3.36-dashboard-templates-schema.test.ts` holds this.
--
-- WHY A SEPARATE VOCABULARY AT ALL, AND WHAT IT COST (Amendment 2 decision 6).
-- The recommendation at the `F3.36` plan gate was to extend `bms.asset_domains`
-- with `stp`, `etp` and `sustainability` and point this column at it, column for
-- column with `asset_templates.domain`. THE OWNER DECLINED IT and ruled for the
-- separate table, so `bms.asset_domains` stays at five codes and no existing
-- plant-domain picker changes — the product decision `0051`'s header refused to
-- take alone. Two costs come with that and are accepted rather than unnoticed:
-- the two vocabularies overlap in meaning and will drift (§4.8's `F4.45` shape,
-- deliberate here because a SECTION is a screen Sheet 02 draws and a DOMAIN is
-- what an asset IS), and `F3.36`'s effort moved 8-12 to 9-13. A future row that
-- needs them reconciled should reconcile them explicitly, not by quietly
-- repointing one foreign key.
--
-- THE COLUMN IS NAMED `section`, NOT `domain`. It does not reference
-- `bms.asset_domains`, and `domain` is that vocabulary's name throughout
-- `assets` and `asset_templates`; reusing it would tell every future reader the
-- wrong thing. `section` is ADR 0049's own word for it.
--
-- `bms.asset_roles` IS NOT TOUCHED HERE, AND THAT IS THE POINT OF AMENDMENT 1.
-- ADR 0049's Consequences says of the two migrations it schedules: "Both
-- forward-only and both tenant-scoped in the migration that creates them."
-- That sentence is TRUE of `bms.dashboard_templates` below and FALSE of
-- `bms.asset_roles`, which `0051` built global. Amendment 1 exists because a
-- review of `F3.37` predicted an implementer would read the bullet as written
-- and add `organization_id` to `bms.asset_roles` in this very file.
--
-- WHY `SET ROLE bms_owner` IS LOAD-BEARING. For `bms.dashboard_templates` it is
-- the usual reason — `FORCE ROW LEVEL SECURITY` needs `bms_owner` to own the
-- table or the flip is decorative (ADR 0045, `F4.16`). For
-- `bms.dashboard_sections` it is `0041_bms_owner_and_force_rls` lines 112-113:
-- `ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner IN SCHEMA bms GRANT ... TO
-- bms_tenant, bms_fleet` fires only for objects created by the role it names,
-- and `pnpm db:migrate` connects as DATABASE_URL_SUPERUSER (`bms_app`). Without
-- the bracket the vocabulary would be owned by `bms_app`, the default
-- privileges would never fire, and the API could not read it — a failure `0039`
-- records as surfacing "one endpoint at a time", which here would mean inside
-- `F3.36`'s own instantiate path.
--
-- THEREFORE: NO EXPLICIT GRANT STATEMENT IS WRITTEN, AND NONE SHOULD BE ADDED.
-- The default privileges do it for both tables. A hand-written GRANT would be
-- redundant and would hide a future breakage of the SET ROLE bracket
-- (`0050`'s and `0051`'s headers both say so).
--
-- Forward-only and idempotent. Indexed 0056: `0051`-`0055` are committed and
-- frozen, and the journal `when` is strictly greater than `0055`'s
-- 1788438783386, or drizzle applies nothing and every check downstream passes
-- against a schema short two tables (`0024`'s header records this).

SET ROLE bms_owner;

-- 1. The section vocabulary, as data — not a z.enum and not a CHECK.
--
--    §4.8's test as ADR 0032 rewrote it: ask whether the behaviour can be
--    carried as data. A widget type's behaviour is a React component and a
--    metric's is a SQL query, so ADR 0047 decision 2 and ADR 0048 decision 1
--    both closed theirs. A SECTION'S BEHAVIOUR IS "GROUP THESE TEMPLATES",
--    WHICH IS THE CODE ITSELF — a section declared by an INSERT arrives fully
--    functional, and Sheet 02 says so in as many words: "adding a seventh is
--    configuration, not a release". So a lookup table, exactly as ADR 0031 and
--    ADR 0032 ruled for rule categories and alarm severities, and as `0051`
--    ruled for roles.
--
--    Column for column with `bms.asset_roles` (`0051`), the sibling this table
--    joins, plus `description` because a section is a screen an administrator
--    picks from a list and the label alone does not say what is on it.
--
--    `code` is the primary key rather than a surrogate uuid because the stock
--    catalog round-trips through JSON, which code references survive and uuids
--    do not — the reason `template_points`.`point_key` records and
--    `asset_domains` restates.
CREATE TABLE IF NOT EXISTS bms.dashboard_sections (
  code        varchar(64) PRIMARY KEY,
  label       varchar(128) NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 100,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. Seed the six sections from the client mock's own domain instances.
--
--    Source: `docs/ion-exchange-nexus-dashboard-2026-08-29.html`, Sheet 02 —
--    "the same canvas bound to a different asset group". Nothing here is
--    invented. `sort_order` follows the sheet's own left-to-right order, spaced
--    by ten so a seventh section can be inserted between two without a
--    migration, matching `0030`'s severity spacing, `0034`'s and `0051`'s.
--
--    THE CODES MATCH `bms.asset_domains` WHERE BOTH VOCABULARIES HAPPEN TO NAME
--    THE SAME THING (`electrical`, `water`, `hvac`) AND THAT IS A COINCIDENCE
--    OF NAMING, NOT A JOIN. Amendment 2 decision 6 accepts that the two will
--    drift. Do not add a foreign key between them, and do not "align" one to
--    the other: a section is a screen, a domain is what an asset is.
--
--    Bare `ON CONFLICT DO NOTHING` — no conflict target — for the reason `0030`
--    and `0034` both give: a named `(code)` arbiter would let a collision on
--    some other unique constraint abort the whole transaction on a re-run.
--
--    This insert joins nothing that `pnpm db:seed` creates, so it is safe
--    inside `db:migrate`, which always runs first. Do not add a mirror seeding
--    path to `seed.ts`.
INSERT INTO bms.dashboard_sections (code, label, description, sort_order) VALUES
  ('electrical',     'Electrical',     'Incoming supply, transformers, HT/LT panels and MCCs.', 110),
  ('water',          'Water',          'Raw intake, pump house, treatment, tanks and distribution.', 120),
  ('stp',            'STP',            'Sewage treatment: screening, aeration, clarifier, disinfection.', 130),
  ('etp',            'ETP',            'Effluent treatment: neutralization, biological, settling, discharge.', 140),
  ('hvac',           'HVAC',           'Chillers, cooling towers, primary pumps, AHU/FCU and zones.', 150),
  ('sustainability', 'Sustainability', 'Energy, water and emissions rollups across the plant.', 160)
ON CONFLICT DO NOTHING;

-- 3. The template table, tenant-scoped from the file that creates it.
--
--    ADR 0043/0045, with `E7.1b`'s `0046`/`0047` as the recorded cost of
--    retrofitting instead. Amendment 1 decision 3 confirms the ADR's original
--    "tenant-scoped in the migration that creates them" claim holds in full for
--    THIS table.
--
--    Lifecycle columns are `bms.asset_templates`' (`0024`), column for column,
--    because ADR 0049 decision 2 rules full parity with ADR 0039: draft ->
--    published -> archived, `createDraftFrom` off a published version,
--    publish-time validation. The vocabulary itself is declared ONCE in
--    `packages/shared/src/contracts/template-lifecycle.ts` and read by both
--    tables' services; `tests/f3.36-template-lifecycle-single-source.test.ts`
--    fails a second copy in TypeScript.
--
--    THE `status` CHECK BELOW IS A PERMANENT, PRINCIPLED EXCEPTION TO THAT
--    SINGLE DECLARATION, exactly as `f3.1d`'s header records for
--    `dashboard_widgets_grid_bounds_check`: SQL HAS NO IMPORTS. The scan does
--    not read `.sql` and is not expected to. This comment is here so a later
--    reader files the restatement as the decision it is rather than as an
--    oversight to "fix".
--
--    TWO VERSION STAMPS, TWO COLUMNS, TWO REASONS. `version` is this row's own
--    tenant-local lifecycle version (decision 2) — revising the Electrical
--    template must not disturb the plants already running the previous one.
--    `stock_version` is which release of the repository catalog the row was
--    IMPORTED from (decision 3), so "a plant onboarded later receives the stock
--    current at its import" is answerable from the row itself. Collapsing them
--    loses the distinction the moment an organization edits an imported
--    template.
CREATE TABLE IF NOT EXISTS bms.dashboard_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  code            varchar(64) NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  name            varchar(255) NOT NULL,
  section         varchar(64) NOT NULL REFERENCES bms.dashboard_sections(code),
  description     text,
  status          varchar(32) NOT NULL DEFAULT 'draft',
  content         jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at    timestamptz,
  archived_at     timestamptz,
  stock_code      varchar(64),
  stock_version   integer,
  created_by      uuid REFERENCES bms.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_templates_org_code_version_unique
  ON bms.dashboard_templates (organization_id, code, version);

-- At most one editable draft per logical template. The version-bump rule
-- (edit published -> new draft at max(version) + 1) depends on this being
-- enforced by the database: two concurrent "edit" clicks would otherwise create
-- two drafts at the same version and the unique index above would reject the
-- second only by accident of ordering. `0024`:38-45 states the same for
-- `asset_templates`.
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_templates_org_code_draft_unique
  ON bms.dashboard_templates (organization_id, code) WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS dashboard_templates_org_status_idx
  ON bms.dashboard_templates (organization_id, status);

CREATE INDEX IF NOT EXISTS dashboard_templates_org_section_idx
  ON bms.dashboard_templates (organization_id, section);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dashboard_templates_status_check'
       AND conrelid = 'bms.dashboard_templates'::regclass
  ) THEN
    ALTER TABLE bms.dashboard_templates
      ADD CONSTRAINT dashboard_templates_status_check
      CHECK (status IN ('draft', 'published', 'archived'));
  END IF;
END $$;

-- A half-recorded provenance is worse than none: `stock_code` without
-- `stock_version` cannot answer "which stock did this come from", and
-- `stock_version` without `stock_code` names a release of nothing. Both NULL is
-- the hand-authored template, which is the common case.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dashboard_templates_stock_stamp_check'
       AND conrelid = 'bms.dashboard_templates'::regclass
  ) THEN
    ALTER TABLE bms.dashboard_templates
      ADD CONSTRAINT dashboard_templates_stock_stamp_check
      CHECK ((stock_code IS NULL) = (stock_version IS NULL));
  END IF;
END $$;

-- 4. The version stamp on the instance (decision 2).
--
--    Nullable, because a hand-built dashboard has no template. NO `ON DELETE`
--    CLAUSE, by design, matching `assets.template_id` and `0051` step 3's rule:
--    a delete of a template row that live dashboards still reference should
--    fail loudly. A published version is never hard-deleted — only drafts are,
--    and a draft cannot be instantiated — so the pin is stable.
--
--    NO SECOND `template_version integer` COLUMN. The foreign key points at the
--    version ROW, and `(organization_id, code, version)` is that row's
--    identity, so a second column would be a third description of one fact —
--    which `0050`'s own text refuses for `sort_order`.
ALTER TABLE bms.dashboards
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES bms.dashboard_templates(id);

-- 5. Row-level security on the template table.
--
--    ENABLE alone exempts the table owner, and `bms_owner` IS the owner, so
--    without FORCE the policy would be decorative for the one role that
--    matters. That is the exact defect ADR 0045 exists for: `F4.16`'s FORCE was
--    a no-op while `bms_app` owned the schema.
--
--    The own-column check is the whole policy here, and that is not the
--    shortcut it looks like. `0050`'s rule is that every policy checks its
--    ORG-BEARING parents; this table has none. `section` points at a global
--    vocabulary and `created_by` at `bms.users`, which `0047` already polices
--    through its own `tenant_isolation`. There is no second org-bearing parent
--    to check.
ALTER TABLE bms.dashboard_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.dashboard_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms.dashboard_templates;
CREATE POLICY tenant_isolation ON bms.dashboard_templates
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

-- 6. Re-create the `bms.dashboards` policy with the new parent leg.
--
--    THIS IS THE PART THAT SHIPS A HOLE IF IT IS SKIPPED, and the reason is
--    recorded in `0050`'s header as something that item's security review PROVED
--    ON THE RUNNING STACK rather than reasoned about: "Postgres runs a
--    referential-integrity check with row security OFF, so a foreign key never
--    consults the parent's policy. As `bms_tenant` with the ESKOM tenant set, an
--    ESKOM-stamped `dashboard_widget_points` row bound a PHEWB `asset_points` id
--    and the INSERT succeeded." `dashboards`' `location_id` and `asset_group_id`
--    legs exist because of that finding. A `template_id` with no leg re-opens it
--    one column over: a tenant could stamp its own dashboard with another
--    organization's template id.
--
--    The three existing clauses are carried over VERBATIM from `0050`:267-286.
--    The policy is replaced rather than altered — DROP POLICY IF EXISTS then
--    CREATE, `0050`'s idiom, which is also what makes this file idempotent.
--
--    The new leg is `IS NULL OR EXISTS(...)` like the other two, because
--    `template_id` is nullable and a hand-built dashboard has none. It cannot
--    fail open: a NULL template is still gated by the own-column check.
--
--    The comparison is written explicitly (`t.organization_id = <current org>`)
--    rather than leaning on `bms.dashboard_templates`' own policy to filter the
--    subquery. That is `0047` section 3c's rule, and it is what makes this
--    correct under `bms_owner`, which is FORCE-bound but filtered differently
--    from `bms_tenant`.
DROP POLICY IF EXISTS tenant_isolation ON bms.dashboards;
CREATE POLICY tenant_isolation ON bms.dashboards
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND (location_id IS NULL OR EXISTS (SELECT 1 FROM bms.locations l
             WHERE l.id = dashboards.location_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
    AND (asset_group_id IS NULL OR EXISTS (SELECT 1 FROM bms.asset_groups g
             WHERE g.id = dashboards.asset_group_id
               AND g.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
    AND (template_id IS NULL OR EXISTS (SELECT 1 FROM bms.dashboard_templates t
             WHERE t.id = dashboards.template_id
               AND t.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND (location_id IS NULL OR EXISTS (SELECT 1 FROM bms.locations l
             WHERE l.id = dashboards.location_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
    AND (asset_group_id IS NULL OR EXISTS (SELECT 1 FROM bms.asset_groups g
             WHERE g.id = dashboards.asset_group_id
               AND g.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
    AND (template_id IS NULL OR EXISTS (SELECT 1 FROM bms.dashboard_templates t
             WHERE t.id = dashboards.template_id
               AND t.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
  );

RESET ROLE;
