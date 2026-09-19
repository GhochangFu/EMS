-- E4.1b / ADR 0070 decision 6 — `bms.locations.timezone`, the zone a calendar
-- window (`today`, `this_week`, `this_month`, `this_year`) is evaluated in.
--
-- A `bms-calc-v3` formula such as `delta({kwh}, today)` needs local midnight
-- for the owning asset's LOCATION, not the server's zone and not UTC: an IST
-- day starts at 18:30 UTC, a SAST day at 22:00 UTC. The zone lives on the
-- location because that is the physical place with a wall clock; assets,
-- asset groups and organizations inherit it through containment (decision 6).
--
-- THE COLUMN IS NULLABLE WITH NO DEFAULT, deliberately (ADR 0070 ruling 6,
-- the reason ADR 0031 Amendment 1 gives for a nullable device-time column):
-- a defaulted zone would be a SILENT GUESS the engine then computes with, and
-- a wrong day boundary is indistinguishable from a right one in the written
-- value. `NULL` means UNSET: the evaluation host refuses a calendar window at
-- such a location as a counted `timezone_unset` and writes nothing. Rolling
-- windows (`24h`) are zone-free and unaffected. No backfill here — the SEEDS
-- stamp the demo and pilot locations (`eskom-locations-seed.ts`,
-- `phe-pilot-seed.ts`); a real customer location is set by an administrator
-- on the location form.
--
-- WHY NO `CHECK`. The valid set is `pg_timezone_names`, a VIEW over the
-- server's zone database, and a CHECK constraint cannot reference a view (a
-- subquery in a CHECK is refused). The write path validates by an exact,
-- case-sensitive match on `pg_timezone_names.name` before the write
-- (`locations.service.ts assertKnownTimezone`); one canonical spelling is
-- stored. `varchar(64)`: the longest IANA name is 32 characters today
-- (`America/Argentina/ComodRivadavia`); 64 leaves room without inviting prose.
--
-- `SET ROLE bms_owner` is the `0041` bracket (the table is already owned by
-- `bms_owner`; the bracket keeps the ALTER under the owner and is the shape
-- every migration since `0041` carries). No GRANT: column privileges follow
-- the table's. No `CREATE EXTENSION` (§4.4).
--
-- Forward-only and idempotent. Indexed 0075: `0051`-`0074` are committed and
-- frozen, and the journal `when` is strictly greater than `0074`'s
-- 1789749688719, or drizzle applies nothing and every check downstream passes
-- against a schema short one column (`0024`'s header records this).

SET ROLE bms_owner;

ALTER TABLE bms.locations ADD COLUMN IF NOT EXISTS timezone varchar(64);

COMMENT ON COLUMN bms.locations.timezone IS
  'IANA zone name (pg_timezone_names.name) the location keeps its calendar in. NULL means unset: a calendar window here refuses timezone_unset (ADR 0070 decision 6).';

RESET ROLE;
