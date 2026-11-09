-- F4.339 / ADR 0117 decision 8 — the topic a deactivated RTU released.
--
--   - `bms.rtus.released_mqtt_topic`: nullable `varchar(255)`, the width of
--     `mqtt_topic`. Deactivating an RTU moves its `mqtt_topic` here and clears
--     `mqtt_topic`, so another RTU can take the topic; reactivating restores it
--     when it is still free (the API is the only writer).
--   - No index change: `rtus_mqtt_topic_idx` stays as it is (plan R6, no ADR
--     0008 change). A released topic is not held, so it needs no uniqueness.
--   - No backfill: every RTU deactivated before this migration keeps its
--     `mqtt_topic`; the column starts NULL for every row.
--
-- POLICY. None: the existing `bms.rtus` policies cover a new column, and a
-- column changes no grant.
--
-- ROLE AND GRANTS. Run as bms_owner inside SET ROLE / RESET ROLE, the table's
-- owner, as 0128 did. No GRANT: the roles that read `bms.rtus` already hold
-- table-level privileges, which cover the new column.
--
-- Forward-only. Idempotent: the column is `IF NOT EXISTS`.

SET ROLE bms_owner;

ALTER TABLE bms.rtus ADD COLUMN IF NOT EXISTS released_mqtt_topic varchar(255);

RESET ROLE;
