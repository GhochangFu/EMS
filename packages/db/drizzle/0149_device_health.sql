-- F3.16 / ADR 0127 decisions 7, 8, 16 and 17 - device health: the per-RTU last-seen
-- and clock-skew row, the per-RTU hourly drop counters, and the two platform
-- tables that hold host state and the counters that have no RTU
-- (plan docs/plans/f3.16-device-health.md unit A1 and section 6).
--
--   bms.rtu_health (rtu_id PK)                  one row per monitored RTU
--   bms.rtu_drop_hours (rtu_id, bucket, reason) one row per RTU, hour and reason,
--                                               only when the count is above zero
--   bms.ingest_hosts (host_key PK)              one row per ingest host (heartbeat)
--   bms.ingest_endpoint_drop_hours              unknownDevice / ambiguousDevice per
--                                               host and endpoint (decision 17)
--
-- TENANT TABLES (rtu_health, rtu_drop_hours). organization_id NOT NULL and a
-- composite key (rtu_id, organization_id) -> bms.rtus (id, organization_id), the
-- 0113 / 0141 idiom: a row sits in its RTU's organization, and the referential
-- check runs with row security off, so a single-column key would not hold it.
-- The key's target, rtus_id_organization_id_key, never refuses a row (id is the
-- primary key); it is added here as 0146 added users_id_organization_id_key.
-- The key is ON DELETE CASCADE: the rows are derived counters and last-seen, and
-- deleting an RTU must not be refused by them. tenant_isolation on
-- organization_id alone, USING and WITH CHECK, no NULL disjunct, ENABLE and FORCE.
-- bms_tenant keeps SELECT and loses the three write verbs (the 0142 pattern):
-- the ingest host writes as bms_fleet and derives organization_id in SQL from
-- bms.rtus, never from a caller.
--
-- PLATFORM TABLES (ingest_hosts, ingest_endpoint_drop_hours). No organization_id:
-- they hold host state and device keys that could belong to any customer, so
-- bms_tenant is revoked from them entirely and only the fleet pool reads them
-- (the global-admin view, decision 17).
--
-- reason is one of the six drop reasons (DROP_REASONS in packages/shared/src/
-- device-health.ts); bucket is a whole hour; dropped is above zero. first_asset_id
-- carries no foreign key: it is a diagnostic label, and an asset deleted later
-- must not be refused by, or take with it, a counter.
--
-- WHY THIS FILE WRITES NO GRANT. 0041_bms_owner_and_force_rls.sql sets ALTER
-- DEFAULT PRIVILEGES FOR ROLE bms_owner IN SCHEMA bms for bms_tenant and
-- bms_fleet. Default privileges fire only for objects created by the role they
-- name, so the tables are created as bms_owner inside SET ROLE / RESET ROLE. The
-- REVOKEs sit inside the bracket too: bms_owner is the grantor of 0041's default,
-- and only the grantor may revoke it (0059). The proof below asserts the result.
--
-- No table here is a hypertable and nothing touches telemetry.*, compression or
-- an aggregate. The worker's DELETE prunes (at most 24 x 6 rows per RTU per day).
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the bracket.
-- Forward-only and idempotent: tables and indexes are IF NOT EXISTS, the policies
-- are dropped before they are created, every ADD CONSTRAINT sits behind a
-- pg_constraint probe. No statement-breakpoint markers (the 0038 reason).

SET LOCAL lock_timeout = '5s';

SET ROLE bms_owner;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rtus_id_organization_id_key' AND conrelid = 'bms.rtus'::regclass
  ) THEN
    ALTER TABLE bms.rtus
      ADD CONSTRAINT rtus_id_organization_id_key UNIQUE (id, organization_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bms.rtu_health (
  rtu_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  host_key varchar(64),
  last_seen_at timestamptz,
  monitored_since timestamptz,
  clock_skew_seconds integer,
  clock_skew_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rtu_health_rtu_id_organization_id_fkey FOREIGN KEY (rtu_id, organization_id)
    REFERENCES bms.rtus (id, organization_id) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS bms.rtu_drop_hours (
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  rtu_id uuid NOT NULL,
  bucket timestamptz NOT NULL,
  reason varchar(32) NOT NULL,
  dropped bigint NOT NULL,
  first_asset_id uuid,
  first_point_key varchar(128),
  first_source_key varchar(128),
  CONSTRAINT rtu_drop_hours_pkey PRIMARY KEY (rtu_id, bucket, reason),
  CONSTRAINT rtu_drop_hours_rtu_id_organization_id_fkey FOREIGN KEY (rtu_id, organization_id)
    REFERENCES bms.rtus (id, organization_id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT rtu_drop_hours_reason_check CHECK (
    reason IN ('badQuality','nonFinite','unknownDevice','unmappedSourceKey','ambiguousDevice','outOfRange')
  ),
  CONSTRAINT rtu_drop_hours_bucket_check CHECK (bucket = date_trunc('hour', bucket)),
  CONSTRAINT rtu_drop_hours_dropped_check CHECK (dropped > 0)
);

CREATE INDEX IF NOT EXISTS rtu_drop_hours_bucket_idx ON bms.rtu_drop_hours (bucket);

CREATE TABLE IF NOT EXISTS bms.ingest_hosts (
  host_key varchar(64) PRIMARY KEY,
  started_at timestamptz NOT NULL,
  healthy_since timestamptz,
  last_beat_at timestamptz NOT NULL,
  endpoints integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bms.ingest_endpoint_drop_hours (
  host_key varchar(64) NOT NULL,
  endpoint_key varchar(255) NOT NULL,
  bucket timestamptz NOT NULL,
  reason varchar(32) NOT NULL,
  dropped bigint NOT NULL,
  first_device_key varchar(128),
  first_source_key varchar(128),
  CONSTRAINT ingest_endpoint_drop_hours_pkey PRIMARY KEY (host_key, endpoint_key, bucket, reason),
  CONSTRAINT ingest_endpoint_drop_hours_reason_check CHECK (
    reason IN ('badQuality','nonFinite','unknownDevice','unmappedSourceKey','ambiguousDevice','outOfRange')
  ),
  CONSTRAINT ingest_endpoint_drop_hours_bucket_check CHECK (bucket = date_trunc('hour', bucket)),
  CONSTRAINT ingest_endpoint_drop_hours_dropped_check CHECK (dropped > 0)
);

CREATE INDEX IF NOT EXISTS ingest_endpoint_drop_hours_bucket_idx
  ON bms.ingest_endpoint_drop_hours (bucket);

ALTER TABLE bms.rtu_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.rtu_health FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.rtu_drop_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.rtu_drop_hours FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.rtu_health;
CREATE POLICY tenant_isolation ON bms.rtu_health
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

DROP POLICY IF EXISTS tenant_isolation ON bms.rtu_drop_hours;
CREATE POLICY tenant_isolation ON bms.rtu_drop_hours
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

REVOKE INSERT, UPDATE, DELETE ON bms.rtu_health FROM bms_tenant;
REVOKE INSERT, UPDATE, DELETE ON bms.rtu_drop_hours FROM bms_tenant;
REVOKE ALL ON bms.ingest_hosts FROM bms_tenant;
REVOKE ALL ON bms.ingest_endpoint_drop_hours FROM bms_tenant;

COMMENT ON TABLE bms.rtu_health IS 'Per-RTU last-seen and clock skew, written by the ingest host (ADR 0127).';
COMMENT ON TABLE bms.rtu_drop_hours IS 'Per-RTU hourly drop counters by reason (ADR 0127).';
COMMENT ON TABLE bms.ingest_hosts IS 'Ingest host heartbeat, platform-wide, no tenant data (ADR 0127).';
COMMENT ON TABLE bms.ingest_endpoint_drop_hours IS 'Hourly drops with no RTU, per host and endpoint, global admin only (ADR 0127 decision 17).';

RESET ROLE;

RESET lock_timeout;

-- The proof, as the migrator's own superuser role: RLS that is not forced, a
-- privilege that did not arrive through 0041's defaults or a revoke that took
-- too much or too little (has_table_privilege follows role membership, the 0059
-- reason), and a constraint or index under another name all read correct above
-- and guard nothing.
DO $$
DECLARE
  tbl text;
  wanted text[];
  verb text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['rtu_health', 'rtu_drop_hours'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'bms' AND c.relname = tbl
         AND c.relrowsecurity AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'migration 0149: row level security is not enabled and forced on bms.%', tbl;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'bms' AND tablename = tbl AND policyname = 'tenant_isolation'
         AND qual IS NOT NULL AND with_check IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'migration 0149: policy tenant_isolation with USING and WITH CHECK is missing on bms.%', tbl;
    END IF;

    IF NOT has_table_privilege('bms_tenant', 'bms.' || tbl, 'SELECT') THEN
      RAISE EXCEPTION 'migration 0149: bms_tenant holds no SELECT on bms.%', tbl;
    END IF;

    IF has_table_privilege('bms_tenant', 'bms.' || tbl, 'INSERT')
       OR has_table_privilege('bms_tenant', 'bms.' || tbl, 'UPDATE')
       OR has_table_privilege('bms_tenant', 'bms.' || tbl, 'DELETE') THEN
      RAISE EXCEPTION 'migration 0149: bms_tenant still holds INSERT, UPDATE or DELETE on bms.%', tbl;
    END IF;
  END LOOP;

  FOREACH tbl IN ARRAY ARRAY['ingest_hosts', 'ingest_endpoint_drop_hours'] LOOP
    FOREACH verb IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege('bms_tenant', 'bms.' || tbl, verb) THEN
        RAISE EXCEPTION 'migration 0149: bms_tenant still holds % on bms.%', verb, tbl;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH tbl IN ARRAY ARRAY['rtu_health', 'rtu_drop_hours', 'ingest_hosts', 'ingest_endpoint_drop_hours'] LOOP
    FOREACH verb IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('bms_fleet', 'bms.' || tbl, verb) THEN
        RAISE EXCEPTION 'migration 0149: bms_fleet holds no % on bms.% (0041 default privileges did not reach it; ADR 0127 does not hold)', verb, tbl;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH wanted SLICE 1 IN ARRAY ARRAY[
    ARRAY['rtus_id_organization_id_key', 'bms.rtus'],
    ARRAY['rtu_health_rtu_id_organization_id_fkey', 'bms.rtu_health'],
    ARRAY['rtu_drop_hours_pkey', 'bms.rtu_drop_hours'],
    ARRAY['rtu_drop_hours_rtu_id_organization_id_fkey', 'bms.rtu_drop_hours'],
    ARRAY['rtu_drop_hours_reason_check', 'bms.rtu_drop_hours'],
    ARRAY['rtu_drop_hours_bucket_check', 'bms.rtu_drop_hours'],
    ARRAY['rtu_drop_hours_dropped_check', 'bms.rtu_drop_hours'],
    ARRAY['ingest_endpoint_drop_hours_pkey', 'bms.ingest_endpoint_drop_hours'],
    ARRAY['ingest_endpoint_drop_hours_reason_check', 'bms.ingest_endpoint_drop_hours'],
    ARRAY['ingest_endpoint_drop_hours_bucket_check', 'bms.ingest_endpoint_drop_hours'],
    ARRAY['ingest_endpoint_drop_hours_dropped_check', 'bms.ingest_endpoint_drop_hours']
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = wanted[1] AND conrelid = wanted[2]::regclass
    ) THEN
      RAISE EXCEPTION 'migration 0149: constraint % does not exist on %', wanted[1], wanted[2];
    END IF;
  END LOOP;

  FOREACH wanted SLICE 1 IN ARRAY ARRAY[
    ARRAY['rtu_drop_hours_bucket_idx', 'bms.rtu_drop_hours'],
    ARRAY['ingest_endpoint_drop_hours_bucket_idx', 'bms.ingest_endpoint_drop_hours']
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
        JOIN pg_class ic ON ic.oid = i.indexrelid
       WHERE i.indrelid = wanted[2]::regclass AND ic.relname = wanted[1]
    ) THEN
      RAISE EXCEPTION 'migration 0149: index % is missing on %', wanted[1], wanted[2];
    END IF;
  END LOOP;
END $$;
