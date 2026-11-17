-- E1.9c / ADR 0135 Amendment 8 decision 7 - the cache of the AI-written findings
-- paragraph (plan docs/plans/e1.9-ml-findings-summary.md section 8, T3.1; owner
-- ruling Q3 (a) adds the attempts column).
--
--   bms.ml_finding_paragraphs   one outcome per (organization, kind, facts hash):
--                               'ok' with the paragraph in placeholder form, or
--                               'rejected' / 'failed' with a fixed reason and no
--                               text. provider and model name what wrote it.
--
-- IN bms, NOT ml. The API writes this table, and Amendment 3 ruling 2 / A-d keep
-- bms_tenant from writing anywhere in schema ml. Nothing here touches schema ml,
-- and its bms-ml-schema-version marker stays 3.
--
-- THE KEY. (organization_id, kind, facts_hash). facts_hash is the SHA-256 of the
-- canonical pseudonymised facts, as 64 lower-case hex digits: varchar(64) with a
-- CHECK, the shape of ml.model_runs.config_hash (plan R-f), so the unique index
-- serves a text parameter. Keying by the facts is the security property: a
-- location-scoped reader's facts differ from an organization admin's, so neither
-- is served a paragraph written from the other's assets.
--
-- ATTEMPTS (owner ruling Q3 (a)). A retry of a 'failed' row deletes it and
-- inserts a new one; on the same UTC day the new row carries attempts + 1. The
-- daily cap is sum(attempts) of the organization's rows created since 00:00 UTC,
-- so it counts provider calls, not keys.
--
-- ROW LEVEL SECURITY. organization_id NOT NULL, ENABLE and FORCE, and the strict
-- tenant_isolation policy (USING and WITH CHECK, the GUC alone, no NULL
-- disjunct, no OR): with the setting unset a role matches nothing (ADR 0043, 0045).
-- Every write runs in withTenant(the card's organization), a global admin's too.
--
-- THE GRANTS. 0041's default privileges give bms_tenant and bms_fleet SELECT,
-- INSERT, UPDATE and DELETE on every table bms_owner creates in bms. This table
-- wants less, so it revokes: bms_tenant keeps SELECT, INSERT, DELETE (INSERT ...
-- ON CONFLICT DO NOTHING; a retry deletes and inserts, never updates); bms_fleet
-- keeps SELECT only (the multi-organization read). bms_auth gets nothing.
--
-- RETENTION. Each write deletes that organization's rows older than 14 days in
-- the same transaction, so no job and no new index are needed (plan 2.3).
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the one
-- SET ROLE bms_owner / RESET ROLE bracket: bms_owner owns the table, so the
-- REVOKEs are made by the role whose default privileges granted them. Forward-
-- only and idempotent: the table is IF NOT EXISTS, the policy is dropped before
-- it is created, a REVOKE that already holds is a no-op. The table is new and
-- empty, so the CHECKs are inline. No statement-breakpoint markers (the 0038
-- reason).

SET LOCAL lock_timeout = '5s';

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.ml_finding_paragraphs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL,
  facts_hash varchar(64) NOT NULL,
  status varchar(16) NOT NULL,
  paragraph text,
  reason varchar(32),
  provider varchar(32),
  model varchar(200),
  attempts smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ml_finding_paragraphs_org_kind_hash_key UNIQUE (organization_id, kind, facts_hash),
  CONSTRAINT ml_finding_paragraphs_kind_check CHECK (kind IN ('forecasts', 'anomalies')),
  CONSTRAINT ml_finding_paragraphs_status_check CHECK (status IN ('ok', 'rejected', 'failed')),
  CONSTRAINT ml_finding_paragraphs_facts_hash_check CHECK (facts_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ml_finding_paragraphs_paragraph_check CHECK (
    (status = 'ok') = (paragraph IS NOT NULL)
    AND (paragraph IS NULL OR char_length(paragraph) BETWEEN 1 AND 600)
  ),
  CONSTRAINT ml_finding_paragraphs_reason_check CHECK ((status = 'ok') = (reason IS NULL)),
  CONSTRAINT ml_finding_paragraphs_attempts_check CHECK (attempts >= 1)
);

ALTER TABLE bms.ml_finding_paragraphs ENABLE ROW LEVEL SECURITY;

ALTER TABLE bms.ml_finding_paragraphs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.ml_finding_paragraphs;

CREATE POLICY tenant_isolation ON bms.ml_finding_paragraphs
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

REVOKE UPDATE ON bms.ml_finding_paragraphs FROM bms_tenant;

REVOKE INSERT, UPDATE, DELETE ON bms.ml_finding_paragraphs FROM bms_fleet;

RESET ROLE;

RESET lock_timeout;

-- The proof, as the migrator's own superuser role, in the 0158 / 0160 shape.
-- has_*_privilege follows role membership (the 0059 reason), and
-- has_any_column_privilege also sees a column-level grant that a table-level
-- check would miss. A dropped REVOKE above fails the migration here.
DO $$
DECLARE
  verb text;
  con text;
  policies integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'bms' AND c.relname = 'ml_finding_paragraphs'
       AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'migration 0162: bms.ml_finding_paragraphs is missing or its row level security is not enabled and forced';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'bms' AND tablename = 'ml_finding_paragraphs' AND policyname = 'tenant_isolation'
       AND qual LIKE '%app.current_organization%' AND with_check LIKE '%app.current_organization%'
       AND qual NOT LIKE '%IS NULL%' AND with_check NOT LIKE '%IS NULL%'
       AND qual !~* '\mor\M' AND with_check !~* '\mor\M'
  ) THEN
    RAISE EXCEPTION 'migration 0162: policy tenant_isolation on bms.ml_finding_paragraphs does not scope USING and WITH CHECK to app.current_organization alone';
  END IF;

  SELECT count(*) INTO policies FROM pg_policies WHERE schemaname = 'bms' AND tablename = 'ml_finding_paragraphs';
  IF policies <> 1 THEN
    RAISE EXCEPTION 'migration 0162: bms.ml_finding_paragraphs carries % policies; tenant_isolation must be the only one', policies;
  END IF;

  FOREACH verb IN ARRAY ARRAY['SELECT', 'INSERT', 'DELETE'] LOOP
    IF NOT has_table_privilege('bms_tenant', 'bms.ml_finding_paragraphs', verb) THEN
      RAISE EXCEPTION 'migration 0162: bms_tenant holds no % on bms.ml_finding_paragraphs', verb;
    END IF;
    IF has_table_privilege('bms_tenant', 'bms.ml_finding_paragraphs', verb || ' WITH GRANT OPTION') THEN
      RAISE EXCEPTION 'migration 0162: bms_tenant may re-grant % on bms.ml_finding_paragraphs', verb;
    END IF;
  END LOOP;
  FOREACH verb IN ARRAY ARRAY['UPDATE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('bms_tenant', 'bms.ml_finding_paragraphs', verb) THEN
      RAISE EXCEPTION 'migration 0162: bms_tenant holds % on bms.ml_finding_paragraphs', verb;
    END IF;
  END LOOP;
  IF has_any_column_privilege('bms_tenant', 'bms.ml_finding_paragraphs', 'UPDATE') THEN
    RAISE EXCEPTION 'migration 0162: bms_tenant holds a column-level UPDATE on bms.ml_finding_paragraphs';
  END IF;

  IF NOT has_table_privilege('bms_fleet', 'bms.ml_finding_paragraphs', 'SELECT') THEN
    RAISE EXCEPTION 'migration 0162: bms_fleet holds no SELECT on bms.ml_finding_paragraphs';
  END IF;
  FOREACH verb IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('bms_fleet', 'bms.ml_finding_paragraphs', verb) THEN
      RAISE EXCEPTION 'migration 0162: bms_fleet holds % on bms.ml_finding_paragraphs', verb;
    END IF;
  END LOOP;
  FOREACH verb IN ARRAY ARRAY['INSERT', 'UPDATE'] LOOP
    IF has_any_column_privilege('bms_fleet', 'bms.ml_finding_paragraphs', verb) THEN
      RAISE EXCEPTION 'migration 0162: bms_fleet holds a column-level % on bms.ml_finding_paragraphs', verb;
    END IF;
  END LOOP;

  FOREACH verb IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('bms_auth', 'bms.ml_finding_paragraphs', verb) THEN
      RAISE EXCEPTION 'migration 0162: bms_auth holds % on bms.ml_finding_paragraphs', verb;
    END IF;
  END LOOP;
  FOREACH verb IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
    IF has_any_column_privilege('bms_auth', 'bms.ml_finding_paragraphs', verb) THEN
      RAISE EXCEPTION 'migration 0162: bms_auth holds a column-level % on bms.ml_finding_paragraphs', verb;
    END IF;
  END LOOP;

  FOREACH con IN ARRAY ARRAY[
    'ml_finding_paragraphs_org_kind_hash_key',
    'ml_finding_paragraphs_kind_check',
    'ml_finding_paragraphs_status_check',
    'ml_finding_paragraphs_facts_hash_check',
    'ml_finding_paragraphs_paragraph_check',
    'ml_finding_paragraphs_reason_check',
    'ml_finding_paragraphs_attempts_check'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = con AND conrelid = 'bms.ml_finding_paragraphs'::regclass
    ) THEN
      RAISE EXCEPTION 'migration 0162: constraint % is missing on bms.ml_finding_paragraphs', con;
    END IF;
  END LOOP;
END $$;
