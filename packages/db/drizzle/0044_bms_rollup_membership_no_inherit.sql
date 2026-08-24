-- E7.1a / ADR 0045 Amendment 2. Corrects `0043`.
--
-- **`0043`'s `GRANT bms_rollup TO ...` is an inheriting grant, which defeats the
-- containment it was written to provide.** Found by the closing security review
-- and confirmed on a running database before this file was written.
--
-- PostgreSQL defaults an omitted `INHERIT` clause to the *member's* own
-- `rolinherit`, and `bms_owner`, `bms_tenant` and `bms_fleet` are all
-- `rolinherit = t`. Ownership checks resolve through `has_privs_of_role`, which
-- is inheritance-aware — so after `0043` the pool roles held the aggregate
-- owner's rights **ambiently, on every statement of every connection**, not only
-- inside `withRollupRole`'s `SET ROLE` window. Measured:
--
--     -- as bms_tenant, with no SET ROLE:
--     DROP MATERIALIZED VIEW telemetry.point_values_1d;   -- succeeded
--
-- Any SQL-injection or unsafe dynamic-SQL path on `TENANT_POOL` — the API's main
-- write pool — could have destroyed every organization's rollups in one
-- statement. `TRUNCATE` on the materialization hypertables and `alter_job` /
-- `add_retention_policy` on the eight ADR 0023/0024 policy jobs were reachable
-- the same way. None of that is tenant-scoped, so the blast radius was
-- cross-organization, which is exactly what ADR 0043 exists to prevent.
--
-- `WITH INHERIT FALSE, SET TRUE` keeps `SET ROLE bms_rollup` working — which is
-- all `refreshAggregatesFrom` needs — while removing the ambient rights.
-- Verified both directions after the change:
--
--     pg_has_role('bms_tenant','bms_rollup','USAGE')  = f   -- no ambient rights
--     pg_has_role('bms_tenant','bms_rollup','MEMBER') = t   -- SET ROLE still works
--     DROP MATERIALIZED VIEW ... as bms_tenant  -> must be owner of continuous aggregate
--     SET ROLE bms_rollup; CALL refresh_continuous_aggregate(...)  -> CALL
--
-- Re-issuing a `GRANT` for an existing membership updates its options in place,
-- so this is idempotent and needs no prior `REVOKE`. `admin_option` stays off:
-- the API cannot re-grant the role onward.
--
-- Runs as `bms_app`. `GRANT <role> TO <role>` needs `ADMIN OPTION` or the
-- superuser attribute, so there is deliberately no `SET ROLE` here.
--
-- Requires PostgreSQL 16 or newer for the `WITH INHERIT` syntax. `docker-compose.yml`
-- pins `timescale/timescaledb:2.29.1-pg16` and CI matches it, so the floor this
-- introduces is the version the project already runs.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bms_rollup') THEN
    RAISE EXCEPTION
      'bms_rollup is missing. Run `pnpm --filter @bms/db roles` before `pnpm db:migrate` (ADR 0045 decision 6).';
  END IF;
END
$$;

GRANT bms_rollup TO bms_owner, bms_tenant, bms_fleet WITH INHERIT FALSE, SET TRUE;

-- `bms_owner` is included deliberately, and it has a consequence: `pnpm
-- db:refresh-aggregates` reached the aggregates purely by inheritance, with no
-- `SET ROLE` anywhere. A green CI backfill step was therefore evidence of the
-- hole rather than of health. `refresh-aggregates.ts` `main()` now issues
-- `SET ROLE bms_rollup` explicitly; without that this line breaks the CLI.

-- `0042` granted `USAGE` on `telemetry` only, while both of its loops scan
-- `view_schema IN ('bms','telemetry')`. A continuous aggregate created in `bms`
-- would be re-owned to `bms_rollup` with no `USAGE` on its own schema, and its
-- refresh policy would fail — quietly, in a background worker. None exists
-- today; this closes the case before it can arise.
GRANT USAGE ON SCHEMA bms TO bms_rollup;

-- `0041`'s four loops read `pg_tables`, the continuous-aggregate catalog,
-- `pg_views` and `pg_sequences`. An **ordinary** materialized view is in none of
-- them: `relkind = 'm'` puts it in `pg_matviews`, not `pg_views`, and it is not
-- a continuous aggregate. There is none today — the same argument `0041` makes
-- for shipping an empty sequence loop applies here verbatim, so the loop ships
-- empty rather than waiting for the object that would need it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, matviewname FROM pg_matviews
     WHERE schemaname IN ('bms', 'telemetry')
       AND NOT EXISTS (
         SELECT 1 FROM timescaledb_information.continuous_aggregates c
          WHERE c.view_schema = pg_matviews.schemaname
            AND c.view_name = pg_matviews.matviewname
       )
  LOOP
    EXECUTE format('ALTER MATERIALIZED VIEW %I.%I OWNER TO bms_owner',
                   r.schemaname, r.matviewname);
  END LOOP;
END
$$;

-- Prove it took, in the migration itself. A silent regression here re-opens the
-- exact hole this file closes, and nothing else in the chain would notice.
DO $$
DECLARE leaky text;
BEGIN
  SELECT string_agg(m.rolname, ', ')
    INTO leaky
    FROM pg_auth_members a
    JOIN pg_roles m ON m.oid = a.member
   WHERE a.roleid = 'bms_rollup'::regrole
     AND a.inherit_option;
  IF leaky IS NOT NULL THEN
    RAISE EXCEPTION
      'bms_rollup is still inherited by: %. The pool roles would hold the aggregate owner''s rights on every statement.', leaky;
  END IF;
END
$$;
