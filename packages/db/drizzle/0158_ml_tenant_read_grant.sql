-- E1.4a / ADR 0135 Amendment 3 ruling 2, R-b and S5 - bms_tenant reads the
-- scorer's forecasts and runs (plan docs/plans/e1.4-forecast-read-path.md
-- section 5, T1.2).
--
-- THE GRANT. bms_tenant gets USAGE on schema ml and SELECT on ml.forecasts and
-- ml.model_runs, and nothing else: nothing on ml.anomaly_scores (that read path
-- is E1.2's), no INSERT, UPDATE, DELETE or TRUNCATE anywhere in ml. bms_auth gets
-- nothing. bms_fleet keeps the SELECT, INSERT that 0157 gave it; the scorer
-- writes as bms_fleet and the API's admin and multi-organization reads run there.
--
-- WHY IT IS SAFE THE MOMENT IT LANDS. 0157 already ENABLEd and FORCEd row level
-- security on all three tables, with tenant_isolation on organization_id alone,
-- USING and WITH CHECK, no NULL disjunct. So bms_tenant under the
-- app.current_organization GUC reads its own organization's rows, and with the
-- GUC unset reads none. RLS isolates by organization only, so the API also
-- applies asset_id = ANY(readable ids) on every read (Amendment 3 S1).
--
-- THE MARKER. COMMENT ON SCHEMA ml moves to bms-ml-schema-version=2 (Amendment 2
-- R2, Amendment 3 R-b). The scorer requires stored >= expected, and the running
-- scorer expects 1, so it stays valid. 0157's own proof (bms_tenant holds no ml
-- privilege) stays true at its own place in the chain.
--
-- Runs inside one SET ROLE bms_owner / RESET ROLE bracket: bms_owner owns ml and
-- its tables (0157), so it is the role that may grant on them, and a grant made
-- by the owner is the one REVOKE by the owner can take back. No object is created.
--
-- Forward-only and idempotent: a GRANT that already holds is a no-op, and the
-- COMMENT replaces itself. No statement-breakpoint markers (the 0038 reason).

SET LOCAL lock_timeout = '5s';

SET ROLE bms_owner;

COMMENT ON SCHEMA ml IS 'bms-ml-schema-version=2';

GRANT USAGE ON SCHEMA ml TO bms_tenant;
GRANT SELECT ON ml.forecasts, ml.model_runs TO bms_tenant;

RESET ROLE;

RESET lock_timeout;

-- The proof, as the migrator's own superuser role, in the 0157 shape.
-- has_*_privilege follows role membership (the 0059 reason), and
-- has_any_column_privilege also sees a column-level grant that a table-level
-- check would miss (plan section 16, security 4).
DO $$
DECLARE
  tbl text;
  verb text;
  policies integer;
BEGIN
  IF coalesce(obj_description('ml'::regnamespace, 'pg_namespace'), '') <> 'bms-ml-schema-version=2' THEN
    RAISE EXCEPTION 'migration 0158: schema ml does not carry bms-ml-schema-version=2';
  END IF;

  IF NOT has_schema_privilege('bms_tenant', 'ml', 'USAGE') THEN
    RAISE EXCEPTION 'migration 0158: bms_tenant holds no USAGE on schema ml';
  END IF;
  IF has_schema_privilege('bms_tenant', 'ml', 'CREATE') THEN
    RAISE EXCEPTION 'migration 0158: bms_tenant holds CREATE on schema ml';
  END IF;

  FOREACH tbl IN ARRAY ARRAY['forecasts', 'model_runs'] LOOP
    IF NOT has_table_privilege('bms_tenant', 'ml.' || tbl, 'SELECT') THEN
      RAISE EXCEPTION 'migration 0158: bms_tenant holds no SELECT on ml.%', tbl;
    END IF;
    IF has_table_privilege('bms_tenant', 'ml.' || tbl, 'SELECT WITH GRANT OPTION') THEN
      RAISE EXCEPTION 'migration 0158: bms_tenant may re-grant SELECT on ml.%', tbl;
    END IF;
  END LOOP;

  IF has_table_privilege('bms_tenant', 'ml.anomaly_scores', 'SELECT')
     OR has_any_column_privilege('bms_tenant', 'ml.anomaly_scores', 'SELECT') THEN
    RAISE EXCEPTION 'migration 0158: bms_tenant holds SELECT on ml.anomaly_scores (that read is E1.2''s)';
  END IF;

  IF has_schema_privilege('bms_auth', 'ml', 'USAGE') OR has_schema_privilege('bms_auth', 'ml', 'CREATE') THEN
    RAISE EXCEPTION 'migration 0158: bms_auth holds a privilege on schema ml';
  END IF;

  FOREACH tbl IN ARRAY ARRAY['model_runs', 'forecasts', 'anomaly_scores'] LOOP
    FOREACH verb IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('bms_tenant', 'ml.' || tbl, verb) THEN
        RAISE EXCEPTION 'migration 0158: bms_tenant holds % on ml.%', verb, tbl;
      END IF;
    END LOOP;
    FOREACH verb IN ARRAY ARRAY['INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF has_any_column_privilege('bms_tenant', 'ml.' || tbl, verb) THEN
        RAISE EXCEPTION 'migration 0158: bms_tenant holds a column-level % on ml.%', verb, tbl;
      END IF;
    END LOOP;

    FOREACH verb IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('bms_auth', 'ml.' || tbl, verb) THEN
        RAISE EXCEPTION 'migration 0158: bms_auth holds % on ml.%', verb, tbl;
      END IF;
    END LOOP;
    FOREACH verb IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF has_any_column_privilege('bms_auth', 'ml.' || tbl, verb) THEN
        RAISE EXCEPTION 'migration 0158: bms_auth holds a column-level % on ml.%', verb, tbl;
      END IF;
    END LOOP;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'ml' AND c.relname = tbl
         AND c.relrowsecurity AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'migration 0158: ml.% is missing or its row level security is not enabled and forced', tbl;
    END IF;

    -- The predicate, not only the name: the grant is safe because the policy reads the
    -- tenant GUC alone, with no NULL or OR escape (0157's header). A rewritten
    -- tenant_isolation that kept its name would otherwise pass.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'ml' AND tablename = tbl AND policyname = 'tenant_isolation'
         AND qual LIKE '%app.current_organization%' AND with_check LIKE '%app.current_organization%'
         AND qual NOT LIKE '%IS NULL%' AND with_check NOT LIKE '%IS NULL%'
         AND qual !~* '\mor\M' AND with_check !~* '\mor\M'
    ) THEN
      RAISE EXCEPTION 'migration 0158: policy tenant_isolation on ml.% does not scope USING and WITH CHECK to app.current_organization alone', tbl;
    END IF;

    SELECT count(*) INTO policies FROM pg_policies WHERE schemaname = 'ml' AND tablename = tbl;
    IF policies <> 1 THEN
      RAISE EXCEPTION 'migration 0158: ml.% carries % policies; tenant_isolation must be the only one', tbl, policies;
    END IF;

    FOREACH verb IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
      IF NOT has_table_privilege('bms_fleet', 'ml.' || tbl, verb) THEN
        RAISE EXCEPTION 'migration 0158: bms_fleet lost % on ml.%', verb, tbl;
      END IF;
    END LOOP;
  END LOOP;
END $$;
