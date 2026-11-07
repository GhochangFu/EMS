-- F4.330 / ADR 0115 decision 1 — the ingest switch an organization carries.
--
--   - `bms.organizations.ingest_enabled`: `NOT NULL DEFAULT true`, so every
--     existing organization keeps ingesting until a global administrator
--     switches it off through `PUT /api/v1/admin/organizations/:id/ingest`
--     (ADR 0115 decision 3), the column's only writer. The ingest host reads it
--     at its next reload and skips every RTU of a switched-off organization; an
--     RTU's own `bms.rtus.ingest_enabled` is kept as it is.
--   - No backfill: the default is the value every row should read.
--
-- POLICY. None: `bms.organizations` carries no policy (F4.16 / ADR 0043), and a
-- column changes no grant. The API gates the write (ADR 0115 decision 3).
--
-- ROLE AND GRANTS. Run as bms_owner inside SET ROLE / RESET ROLE, the table's
-- owner, as 0125 did for `colour_profile`. No GRANT: the ingest host connects as
-- `bms_fleet`, which `0039` already grants SELECT on every `bms` table.
--
-- Forward-only. Idempotent: the column is `IF NOT EXISTS`.

SET ROLE bms_owner;

ALTER TABLE bms.organizations ADD COLUMN IF NOT EXISTS ingest_enabled boolean NOT NULL DEFAULT true;

RESET ROLE;
