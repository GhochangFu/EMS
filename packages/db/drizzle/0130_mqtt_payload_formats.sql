-- ADR 0116 decisions 1, 2 and 9 (F4.334) — the MQTT payload format catalog.
--
-- One shape was known: the PHE (ThinkIoT) envelope `{ dev_id, ts, values }`,
-- parsed by `parseMqttEnvelope` in code. The BCPL meters publish an array of
-- `{ Data: [int16 registers], Timestamp, TagName }` records that envelope can
-- never read, so discovery and ingest dropped every message. This table names
-- how a message is decoded; each MQTT RTU names one row by `code` in its
-- connection config (`payloadFormat`), and an RTU that names none uses the
-- built-in `thinkiot-envelope`, whose decoder is `parseMqttEnvelope` unchanged.
--
-- **Why no RLS and no organization_id.** It is a platform catalog, not tenant
-- data — the `0085` (`bms.location_types`) precedent the owner ruled for
-- (plan Q1). Every role that reads an RTU config reads it.
--
-- **Why `bms_tenant` loses INSERT/UPDATE/DELETE.** `0041`'s default
-- privileges grant every verb on every `bms` table to `bms_tenant` and
-- `bms_fleet`. Only the global-admin routes write this table, on the fleet
-- pool, so the tenant pool keeps SELECT and nothing else. The revoke runs as
-- the grantor (`bms_owner`): a superuser issuing the same REVOKE removes
-- nothing and reports success (the `0059` header).
--
-- **The two seeded rows (plan Q6, Q16).** `thinkiot-envelope` is built-in: its
-- definition only names the code decoder, and the API never edits or deletes
-- it. `thinkiot-register-array` is the BCPL format (ADR 0116 decision 9): an
-- ordinary, editable row. `ON CONFLICT DO NOTHING` without a target, the
-- `0038` reasoning, so a re-run never reverts an admin's later edit.
--
-- Forward-only and idempotent: `CREATE TABLE IF NOT EXISTS`, `INSERT ... ON
-- CONFLICT DO NOTHING`, a repeatable REVOKE, a read-only proof block.
--
-- No statement-breakpoint markers, following `0038`, `0059` and `0085` — do
-- not write that marker's literal text anywhere in this file, not even inside
-- a comment (drizzle splits on the raw string before Postgres parses it).

-- 1. The catalog, as `bms_owner` so `0041`'s default privileges grant it.
SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.mqtt_payload_formats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(64) NOT NULL UNIQUE,
  name varchar(128) NOT NULL,
  description text NOT NULL DEFAULT '',
  definition jsonb NOT NULL,
  builtin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- 2. The seeded rows. The BCPL definition: `Data[0..1]` and `Data[3..4]` as
--    big-endian float32 (m3/h = kL/h and m3 = kL, so no scale); `TagName` is
--    the device key and so the RTU code (ADR 0116 decision 7).
INSERT INTO bms.mqtt_payload_formats (code, name, description, definition, builtin) VALUES
  ('thinkiot-envelope', 'ThinkIoT envelope',
   'The dev_id / ts / values envelope (PHE). The default for an RTU that names no format.',
   '{"kind":"builtin","name":"thinkiot-envelope"}'::jsonb, true),
  ('thinkiot-register-array', 'ThinkIoT register array',
   'An array of { Data, Timestamp, TagName } records with 16-bit registers (BCPL water flow meters).',
   '{"kind":"declarative","root":"array","deviceKey":["TagName"],"time":{"path":["Timestamp"],"unit":"epoch_s"},"wordOrder":"big","byteOrder":"big","readings":[{"key":"treated_water_flow_klh","register":{"path":["Data"],"index":0,"type":"float32"}},{"key":"outlet_flow_totalizer_kl","register":{"path":["Data"],"index":3,"type":"float32"}}]}'::jsonb,
   false)
ON CONFLICT DO NOTHING;

-- 3. Platform master data: the tenant pool reads it and never writes it.
REVOKE INSERT, UPDATE, DELETE ON bms.mqtt_payload_formats FROM bms_tenant;

RESET ROLE;

-- 4. The proof, as the migrator's superuser — the `0085` shape.
--    `has_table_privilege` follows role membership, so a privilege inherited
--    from another role is caught here rather than surviving the revoke.
DO $$
BEGIN
  IF has_table_privilege('bms_tenant', 'bms.mqtt_payload_formats', 'INSERT')
     OR has_table_privilege('bms_tenant', 'bms.mqtt_payload_formats', 'UPDATE')
     OR has_table_privilege('bms_tenant', 'bms.mqtt_payload_formats', 'DELETE') THEN
    RAISE EXCEPTION
      'migration 0130: bms_tenant still holds INSERT, UPDATE or DELETE on bms.mqtt_payload_formats';
  END IF;

  IF NOT has_table_privilege('bms_tenant', 'bms.mqtt_payload_formats', 'SELECT') THEN
    RAISE EXCEPTION
      'migration 0130: bms_tenant lacks SELECT on bms.mqtt_payload_formats'
      USING HINT = 'The onboarding worker reads the catalog on its tenant transaction.';
  END IF;

  -- `bms_fleet`: the ingest host reads the catalog, the admin routes write it.
  IF NOT has_table_privilege('bms_fleet', 'bms.mqtt_payload_formats', 'SELECT')
     OR NOT has_table_privilege('bms_fleet', 'bms.mqtt_payload_formats', 'INSERT')
     OR NOT has_table_privilege('bms_fleet', 'bms.mqtt_payload_formats', 'UPDATE')
     OR NOT has_table_privilege('bms_fleet', 'bms.mqtt_payload_formats', 'DELETE') THEN
    RAISE EXCEPTION
      'migration 0130: bms_fleet lacks a privilege on bms.mqtt_payload_formats'
      USING HINT = 'The ingest host reads and the admin routes write on the fleet pool.';
  END IF;
END $$;
