-- E1.1 / ADR 0135 decisions 3 and 4, Amendment 2 - the ml schema and its three
-- tenant tables, written by the apps/ml batch scorer (plan
-- docs/plans/e1.1-ml-serving-foundation.md section 6).
--
--   ml.model_runs      one row per organization per scoring cycle, insert-once:
--                      written after inference, in the same transaction as its
--                      rows, so a run and its rows exist together or not at all
--   ml.forecasts       (asset_id, point_key, horizon_bucket, issued_at) -> p10,
--                      p50, p90; issued_at is the run's start, so a re-run never
--                      collides with an earlier one
--   ml.anomaly_scores  (asset_id, bucket, detector, model_run_id) -> score in
--                      0..1 (Amendment 2 ruling 4: keyed by run, never
--                      overwritten). Created here because decision 4 names three
--                      tables; nothing writes it until E1.2.
--
-- TWO ROLES IN ONE FILE. No migration before this one creates a schema: bms and
-- telemetry are created outside the chain. bms_owner holds no CREATE on the
-- database (ADR 0045), and roles.ts may not grow a schema (roles.spec.ts), so
-- CREATE SCHEMA runs as the migrator, bms_app, and hands ownership to bms_owner
-- in the same statement. Everything else runs inside one SET ROLE bms_owner /
-- RESET ROLE bracket, so every object is owned by bms_owner (the 0041 rule).
--
-- EXPLICIT GRANTS, NO DEFAULT PRIVILEGES. 0041's ALTER DEFAULT PRIVILEGES names
-- the bms and telemetry schemas only, so a table created in ml reaches no pool
-- role unless granted. That is what decision 3 wants: bms_fleet, the role the
-- scorer connects as (Amendment 2 decision 3 ruling), gets USAGE and SELECT,
-- INSERT - never UPDATE, DELETE or TRUNCATE, so a row is never rewritten.
-- bms_tenant gets nothing here: the read API is E1.4's, and its migration adds
-- the grant. The policies are already in place, so that grant is safe the
-- moment it lands. A dedicated bms_ml role is owed (ADR 0135 decision 3).
--
-- TENANCY. organization_id NOT NULL on every table; tenant_isolation on
-- organization_id alone, USING and WITH CHECK, no NULL disjunct, ENABLE and
-- FORCE. bms_fleet bypasses row security, so the composite foreign keys are the
-- control on a score row: (asset_id, organization_id) -> bms.assets and
-- (model_run_id, organization_id) -> ml.model_runs make a row stamped with the
-- wrong organization a 23503, not a leak. The scorer derives organization_id
-- in SQL from bms.assets, never from a caller. assets_id_organization_id_key
-- already exists (0152). The asset keys are ON DELETE CASCADE: scores are
-- derived data, and deleting an asset must not be refused by them.
--
-- SCHEMA VERSION. COMMENT ON SCHEMA ml carries bms-ml-schema-version=N
-- (Amendment 2, R2). apps/ml refuses to start below the version it expects.
-- A later migration that changes ml.* re-issues the comment with the next
-- integer; forward-only, additive changes keep an older scorer valid.
--
-- Plain tables, no hypertable and no retention job (R3): retention follows
-- _1h, which is never dropped, and the volume is ordinary (Amendment 2
-- ruling 7). Whole-hour checks use date_trunc's three-argument form with
-- 'UTC': the two-argument form follows the session's TimeZone, which is why
-- 0150 exists.
--
-- Forward-only and idempotent: CREATE ... IF NOT EXISTS, policies dropped
-- before they are created, grants repeatable. No statement-breakpoint markers
-- (the 0038 reason).

SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS ml AUTHORIZATION bms_owner;

SET ROLE bms_owner;

COMMENT ON SCHEMA ml IS 'bms-ml-schema-version=1';

CREATE TABLE IF NOT EXISTS ml.model_runs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  model_name varchar(128) NOT NULL,
  model_version varchar(128) NOT NULL,
  config_hash varchar(64) NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  rows_written integer NOT NULL,
  status varchar(16) NOT NULL,
  error_text varchar(500),
  CONSTRAINT model_runs_id_organization_id_key UNIQUE (id, organization_id),
  CONSTRAINT model_runs_status_check CHECK (status IN ('succeeded', 'failed')),
  CONSTRAINT model_runs_config_hash_check CHECK (config_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT model_runs_window_check CHECK (finished_at >= started_at),
  CONSTRAINT model_runs_rows_written_check CHECK (rows_written >= 0),
  CONSTRAINT model_runs_outcome_check CHECK (
    (status = 'failed' AND error_text IS NOT NULL AND rows_written = 0)
    OR (status = 'succeeded' AND error_text IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS model_runs_org_started_idx ON ml.model_runs (organization_id, started_at DESC);

-- The quantile CHECK is one chain on purpose. Postgres sorts NaN above every
-- float and treats NaN = NaN, so p90 < 'Infinity' rejects a NaN or +Infinity in
-- p90, the <= links carry that to p50 and p10, and p10 > '-Infinity' rejects
-- -Infinity (the 0064 range-form reasoning). The integration test proves each
-- position.
CREATE TABLE IF NOT EXISTS ml.forecasts (
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  point_key varchar(128) NOT NULL,
  horizon_bucket timestamptz NOT NULL,
  issued_at timestamptz NOT NULL,
  p10 double precision NOT NULL,
  p50 double precision NOT NULL,
  p90 double precision NOT NULL,
  model_run_id uuid NOT NULL,
  CONSTRAINT forecasts_pkey PRIMARY KEY (asset_id, point_key, horizon_bucket, issued_at),
  CONSTRAINT forecasts_asset_id_organization_id_fkey FOREIGN KEY (asset_id, organization_id)
    REFERENCES bms.assets (id, organization_id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT forecasts_model_run_id_organization_id_fkey FOREIGN KEY (model_run_id, organization_id)
    REFERENCES ml.model_runs (id, organization_id),
  CONSTRAINT forecasts_horizon_bucket_check CHECK (horizon_bucket = date_trunc('hour', horizon_bucket, 'UTC')),
  CONSTRAINT forecasts_quantiles_check CHECK (
    p10 > '-Infinity'::float8 AND p10 <= p50 AND p50 <= p90 AND p90 < 'Infinity'::float8
  )
);

CREATE INDEX IF NOT EXISTS forecasts_model_run_idx ON ml.forecasts (model_run_id);

CREATE TABLE IF NOT EXISTS ml.anomaly_scores (
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  bucket timestamptz NOT NULL,
  detector varchar(64) NOT NULL,
  score double precision NOT NULL,
  contributing_points varchar(128)[] NOT NULL DEFAULT '{}',
  model_run_id uuid NOT NULL,
  CONSTRAINT anomaly_scores_pkey PRIMARY KEY (asset_id, bucket, detector, model_run_id),
  CONSTRAINT anomaly_scores_asset_id_organization_id_fkey FOREIGN KEY (asset_id, organization_id)
    REFERENCES bms.assets (id, organization_id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT anomaly_scores_model_run_id_organization_id_fkey FOREIGN KEY (model_run_id, organization_id)
    REFERENCES ml.model_runs (id, organization_id),
  CONSTRAINT anomaly_scores_bucket_check CHECK (bucket = date_trunc('hour', bucket, 'UTC')),
  CONSTRAINT anomaly_scores_score_check CHECK (score >= 0 AND score <= 1)
);

CREATE INDEX IF NOT EXISTS anomaly_scores_model_run_idx ON ml.anomaly_scores (model_run_id);

ALTER TABLE ml.model_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml.model_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE ml.forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml.forecasts FORCE ROW LEVEL SECURITY;
ALTER TABLE ml.anomaly_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml.anomaly_scores FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON ml.model_runs;
CREATE POLICY tenant_isolation ON ml.model_runs
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

DROP POLICY IF EXISTS tenant_isolation ON ml.forecasts;
CREATE POLICY tenant_isolation ON ml.forecasts
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

DROP POLICY IF EXISTS tenant_isolation ON ml.anomaly_scores;
CREATE POLICY tenant_isolation ON ml.anomaly_scores
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

GRANT USAGE ON SCHEMA ml TO bms_fleet;
GRANT SELECT, INSERT ON ml.model_runs, ml.forecasts, ml.anomaly_scores TO bms_fleet;

COMMENT ON TABLE ml.model_runs IS 'One row per organization per apps/ml scoring cycle, insert-once (ADR 0135).';
COMMENT ON TABLE ml.forecasts IS 'Hourly p10/p50/p90 forecasts from apps/ml, never rewritten (ADR 0135).';
COMMENT ON TABLE ml.anomaly_scores IS 'Advisory anomaly scores in 0..1, keyed by run; written from E1.2 (ADR 0135).';

RESET ROLE;

RESET lock_timeout;

-- The proof, as the migrator's own superuser role: a schema or table owned by
-- the wrong role, RLS that is not forced, a privilege granted too widely or not
-- at all (has_*_privilege follows role membership, the 0059 reason), and a
-- constraint or index under another name all read correct above and guard
-- nothing.
DO $$
DECLARE
  tbl text;
  wanted text[];
  verb text;
  r text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_namespace ns
     WHERE ns.nspname = 'ml' AND pg_get_userbyid(ns.nspowner) = 'bms_owner'
  ) THEN
    RAISE EXCEPTION 'migration 0157: schema ml is missing or not owned by bms_owner';
  END IF;

  IF coalesce(obj_description('ml'::regnamespace, 'pg_namespace'), '') <> 'bms-ml-schema-version=1' THEN
    RAISE EXCEPTION 'migration 0157: schema ml does not carry bms-ml-schema-version=1';
  END IF;

  IF NOT has_schema_privilege('bms_fleet', 'ml', 'USAGE') THEN
    RAISE EXCEPTION 'migration 0157: bms_fleet holds no USAGE on schema ml';
  END IF;

  FOREACH r IN ARRAY ARRAY['bms_tenant', 'bms_auth'] LOOP
    IF has_schema_privilege(r, 'ml', 'USAGE') THEN
      RAISE EXCEPTION 'migration 0157: % holds USAGE on schema ml (the read grant is E1.4''s)', r;
    END IF;
  END LOOP;

  FOREACH tbl IN ARRAY ARRAY['model_runs', 'forecasts', 'anomaly_scores'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'ml' AND c.relname = tbl
         AND pg_get_userbyid(c.relowner) = 'bms_owner'
         AND c.relrowsecurity AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'migration 0157: ml.% is missing, not owned by bms_owner, or its row level security is not enabled and forced', tbl;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'ml' AND tablename = tbl AND policyname = 'tenant_isolation'
         AND qual IS NOT NULL AND with_check IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'migration 0157: policy tenant_isolation with USING and WITH CHECK is missing on ml.%', tbl;
    END IF;

    FOREACH verb IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
      IF NOT has_table_privilege('bms_fleet', 'ml.' || tbl, verb) THEN
        RAISE EXCEPTION 'migration 0157: bms_fleet holds no % on ml.%', verb, tbl;
      END IF;
    END LOOP;

    FOREACH verb IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      IF has_table_privilege('bms_fleet', 'ml.' || tbl, verb) THEN
        RAISE EXCEPTION 'migration 0157: bms_fleet holds % on ml.% (rows are never rewritten)', verb, tbl;
      END IF;
    END LOOP;

    FOREACH r IN ARRAY ARRAY['bms_tenant', 'bms_auth'] LOOP
      FOREACH verb IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
        IF has_table_privilege(r, 'ml.' || tbl, verb) THEN
          RAISE EXCEPTION 'migration 0157: % holds % on ml.%', r, verb, tbl;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH wanted SLICE 1 IN ARRAY ARRAY[
    ARRAY['assets_id_organization_id_key', 'bms.assets'],
    ARRAY['model_runs_id_organization_id_key', 'ml.model_runs'],
    ARRAY['model_runs_status_check', 'ml.model_runs'],
    ARRAY['model_runs_config_hash_check', 'ml.model_runs'],
    ARRAY['model_runs_window_check', 'ml.model_runs'],
    ARRAY['model_runs_rows_written_check', 'ml.model_runs'],
    ARRAY['model_runs_outcome_check', 'ml.model_runs'],
    ARRAY['forecasts_pkey', 'ml.forecasts'],
    ARRAY['forecasts_asset_id_organization_id_fkey', 'ml.forecasts'],
    ARRAY['forecasts_model_run_id_organization_id_fkey', 'ml.forecasts'],
    ARRAY['forecasts_horizon_bucket_check', 'ml.forecasts'],
    ARRAY['forecasts_quantiles_check', 'ml.forecasts'],
    ARRAY['anomaly_scores_pkey', 'ml.anomaly_scores'],
    ARRAY['anomaly_scores_asset_id_organization_id_fkey', 'ml.anomaly_scores'],
    ARRAY['anomaly_scores_model_run_id_organization_id_fkey', 'ml.anomaly_scores'],
    ARRAY['anomaly_scores_bucket_check', 'ml.anomaly_scores'],
    ARRAY['anomaly_scores_score_check', 'ml.anomaly_scores']
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = wanted[1] AND conrelid = wanted[2]::regclass
    ) THEN
      RAISE EXCEPTION 'migration 0157: constraint % does not exist on %', wanted[1], wanted[2];
    END IF;
  END LOOP;

  FOREACH wanted SLICE 1 IN ARRAY ARRAY[
    ARRAY['model_runs_org_started_idx', 'ml.model_runs'],
    ARRAY['forecasts_model_run_idx', 'ml.forecasts'],
    ARRAY['anomaly_scores_model_run_idx', 'ml.anomaly_scores']
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
        JOIN pg_class ic ON ic.oid = i.indexrelid
       WHERE i.indrelid = wanted[2]::regclass AND ic.relname = wanted[1]
    ) THEN
      RAISE EXCEPTION 'migration 0157: index % is missing on %', wanted[1], wanted[2];
    END IF;
  END LOOP;
END $$;
