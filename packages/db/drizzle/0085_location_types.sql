-- ADR 0077 decisions 1-4 — the location type becomes a lookup table.
--
-- `bms.locations.type` has been `varchar(32) NOT NULL` with no CHECK and no FK
-- since the schema's first migration. The fixed list `["smoc_campus", "rsmoc",
-- "csmoc"]` lived only in code, repeated across five contract files, two seeds
-- and a web page — and it was wrong for PHE: all six `PHEWB` locations carry
-- `rsmoc`, a name for an Eskom facility PHE has no relation to. The owner
-- ruled PHE's sites are pump stations (ADR 0077 Context).
--
-- **Why a lookup table and not a CHECK.** ADR 0031 A1's line: a vocabulary that
-- grows per sector (a water-treatment plant for `E5.1` is a plausible fifth
-- type) is data, extended with an `INSERT`, not a migration plus a deploy.
-- `bms.notification_channel_kinds` (`0038`) and `bms.point_keys` are the
-- precedents this follows, down to the bare `ON CONFLICT DO NOTHING`.
--
-- **Why `bms_tenant` loses INSERT/UPDATE/DELETE.** `0041`'s default privileges
-- grant every verb on every `bms` table to `bms_tenant` by default, and nothing
-- about this table calls for a tenant-pool write — it is fleet-wide master
-- data, the same line `0059` drew for `bms.point_keys`. The revoke runs as the
-- grantor (`bms_owner`), for the reason `0059`'s header records: a superuser
-- issuing the same `REVOKE` removes nothing and reports success.
--
-- **Why the data move and the FK run outside the `bms_owner` bracket.**
-- `bms.locations` has carried `FORCE ROW LEVEL SECURITY` since `0041`, so
-- `bms_owner` under `SET ROLE` — with no `app.current_organization` set — would
-- update and validate zero rows and report success. `pnpm db:migrate` connects
-- as `DATABASE_URL_SUPERUSER`, which bypasses RLS outright, so the two
-- `UPDATE`s, the pre-flight guard and the `ADD CONSTRAINT` all run after
-- `RESET ROLE`, as that superuser.
--
-- **Why the FK validates rather than merely referencing.** `ADD CONSTRAINT ...
-- FOREIGN KEY` on an existing table with existing rows makes Postgres scan and
-- validate every row before the constraint is live — exactly the check ADR
-- 0077 decision 3 wants ("every existing row resolves before it validates").
-- The `DO` guard below raises with the offending values first, so a data
-- problem is reported in this file's own language rather than as a bare
-- `23503` from the `ALTER TABLE`.
--
-- Forward-only and idempotent: `CREATE TABLE IF NOT EXISTS`, `INSERT ... ON
-- CONFLICT DO NOTHING`, both `UPDATE`s are no-ops on a second run (they only
-- touch rows not already `pump_station`), and the `ADD CONSTRAINT` sits behind
-- a `pg_constraint` guard.
--
-- No statement-breakpoint markers, following `0038`'s and `0059`'s lead — do
-- not write that marker's literal text anywhere in this file, not even inside
-- a comment (the `0038` header explains why: drizzle splits on the raw string
-- before Postgres ever parses it).

-- 1. The lookup table, as `bms_owner` so `0041`'s default privileges grant it.
SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.location_types (
  code varchar(32) PRIMARY KEY,
  label varchar(128) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. The seeded rows (ADR 0077 decision 2). No conflict target, the `0038`
--    reasoning: a named target aborts the whole migration on a collision
--    against a DIFFERENT unique constraint, and the bare form covers every one.
INSERT INTO bms.location_types (code, label, sort_order) VALUES
  ('smoc_campus',   'SMOC campus',    10),
  ('rsmoc',         'RSMOC',          20),
  ('csmoc',         'CSMOC',          30),
  ('pump_station',  'Pump station',   40)
ON CONFLICT DO NOTHING;

-- 3. Fleet-wide master data — `bms_tenant` reads it and never writes it,
--    the same line `0059` drew for `bms.point_keys`.
REVOKE INSERT, UPDATE, DELETE ON bms.location_types FROM bms_tenant;

RESET ROLE;

-- 4. The data move (ADR 0077 decision 4), as the superuser: `bms.locations`
--    carries FORCE ROW LEVEL SECURITY, and this connection bypasses it rather
--    than running inside a per-organization GUC loop, because every PHEWB row
--    moves the same way regardless of organization.
UPDATE bms.locations
   SET type = 'pump_station', updated_at = now()
 WHERE type <> 'pump_station'
   AND organization_id = (SELECT id FROM bms.organizations WHERE code = 'PHEWB');

UPDATE bms.map_locations
   SET kind = 'pump_station'
 WHERE kind <> 'pump_station'
   AND slug IN (
     SELECT l.slug FROM bms.locations l
      WHERE l.organization_id = (SELECT id FROM bms.organizations WHERE code = 'PHEWB')
   );

-- 5. Every existing `bms.locations.type` must resolve before the FK below is
--    added — reported here in this file's own language, not as a bare 23503
--    from the ALTER TABLE.
DO $$
DECLARE
  bad_codes text;
BEGIN
  SELECT string_agg(DISTINCT type, ', ') INTO bad_codes
    FROM bms.locations
   WHERE type NOT IN (SELECT code FROM bms.location_types);

  IF bad_codes IS NOT NULL THEN
    RAISE EXCEPTION
      'migration 0085: bms.locations holds a type with no bms.location_types row: %',
      bad_codes;
  END IF;
END $$;

-- 6. The foreign key (ADR 0077 decision 3), behind a guard so the file re-runs
--    clean. `ADD CONSTRAINT` on a populated table validates every existing row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'locations_type_fk'
      AND conrelid = 'bms.locations'::regclass
  ) THEN
    ALTER TABLE bms.locations
      ADD CONSTRAINT locations_type_fk
      FOREIGN KEY (type) REFERENCES bms.location_types(code);
  END IF;
END $$;

-- 7. The proof, as the migrator's own superuser role — the `0059` shape.
--    `has_table_privilege` follows role membership, so a privilege `bms_tenant`
--    inherits from some other role is caught here rather than surviving a
--    revoke that looked complete.
DO $$
BEGIN
  IF has_table_privilege('bms_tenant', 'bms.location_types', 'INSERT')
     OR has_table_privilege('bms_tenant', 'bms.location_types', 'UPDATE')
     OR has_table_privilege('bms_tenant', 'bms.location_types', 'DELETE') THEN
    RAISE EXCEPTION
      'migration 0085: bms_tenant still holds INSERT, UPDATE or DELETE on bms.location_types'
      USING HINT =
        'The REVOKE ran as bms_owner and reported success, so the privilege '
        || 'arrives by another route — most likely a role bms_tenant is a member '
        || 'of. Find it with \pset and pg_auth_members, and revoke it there.';
  END IF;

  IF NOT has_table_privilege('bms_tenant', 'bms.location_types', 'SELECT') THEN
    RAISE EXCEPTION
      'migration 0085: bms_tenant lost SELECT on bms.location_types'
      USING HINT =
        'Every tenant reads the vocabulary; this migration must not touch SELECT.';
  END IF;

  -- `bms_fleet` needs SELECT too — the map query (`map.service.ts`) runs on the
  -- fleet pool (ADR 0077 decision 6).
  IF NOT has_table_privilege('bms_fleet', 'bms.location_types', 'SELECT') THEN
    RAISE EXCEPTION
      'migration 0085: bms_fleet lacks SELECT on bms.location_types'
      USING HINT =
        'The map query joins this table on the fleet pool; it must be able to read it.';
  END IF;
END $$;
