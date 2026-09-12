-- `F4.60` — `bms.rtus.rtu_code` becomes unique fleet-wide wherever it carries
-- a value. Raised by the `F1.7` review on 2026-08-22 and deliberately deferred
-- then, because `F2.6` was working in the drizzle journal and a migration from
-- a parallel branch collides in the one file that cannot merge cleanly. `F2.6`
-- is merged.
--
-- WHAT THE COLUMN IS. ADR 0016 §3 (`docs/adr/0016-ingest-adapter-framework.md`
-- line 428) names it: "`deviceKey` resolves to `rtus.rtu_code` … No new column,
-- no new concept — the existing routing key, named." A routing key that does
-- not route is the defect this file closes; it decides nothing ADR 0016 has not
-- already decided, which is why no new ADR gates it.
--
-- WHAT TWO ROWS SHARING A CODE ACTUALLY DO, measured in the source rather than
-- taken from the row that raised it. `apps/ingest/src/host/bindings.ts:643`
-- reads `group.index.get(deviceKey)` and **merges** the point targets of both
-- RTUs under that one key. So a payload from either device writes BOTH RTUs'
-- assets on every shared `source_data_key` — telemetry attributed to a station
-- that never sent it. The backlog row describes only duplicate `stale rtu=…`
-- lines and an over-permissive topic-attribution `Set`; it was written narrow.
--
-- WHY THE KEY IS GLOBAL AND NOT `(organization_id, rtu_code)`. Two reasons,
-- both measured. First, `BINDING_QUERY` (`bindings.ts:112-144`) carries no
-- `organization_id` filter at all — the ingest host reads the whole fleet and
-- groups it by `(protocol, endpointKey)`, so a per-organization key would leave
-- the merge above reachable across two tenants at one broker. Second, the two
-- sibling identity indexes on this same table are already global partial
-- uniques on a bare column: `rtus_mqtt_topic_idx` and `rtus_external_rtu_idx`,
-- migration `0016` lines 65 and 67. This is that shape, for the same kind of
-- column.
--
-- The cost is stated rather than hidden: a collision across an organization
-- boundary refuses a write against a row the caller cannot see, and `bms.rtus`
-- is policied with `FORCE ROW LEVEL SECURITY`, so Postgres withholds `detail`.
-- That is exactly the behaviour the two siblings already ship; F4.60 is not
-- where it changes.
--
-- WHY THE PREDICATE EXCLUDES THE EMPTY STRING. The backlog row asks for
-- `WHERE rtu_code IS NOT NULL`. That is wrong here, and the correction is the
-- reason this comment exists. `bindings.ts:414` skips an RTU whose `rtu_code`
-- is `NULL` **or** `''` as `missing-rtu-code` — to the host, `''` means no code
-- at all. And `''` is reachable: `apps/api/src/admin/rtus/rtus.schema.ts:13` is
-- `z.string().max(64).optional()` with no `.min(1)`, and because the PATCH body
-- is optional-but-not-nullable, sending `""` is the ONLY way an operator can
-- clear the column. Under the row's predicate two cleared RTUs would collide;
-- under this one they do not, and two `NULL`s do not either.
--
-- WHY THE `UPDATE` SITS OUTSIDE THE `SET ROLE` BRACKET. This is not style. It
-- was measured on the running database on 2026-09-12: `bms.rtus` carries
-- `relrowsecurity = t` AND `relforcerowsecurity = t` with policy
-- `tenant_isolation` on `app.current_organization`, so `bms_owner` — which the
-- bracket assumes — sees 0 of the 56 rows with no GUC set, and the same
-- statement run inside the bracket reports `UPDATE 0` while normalising
-- nothing. It must run as the migration's own role, which is
-- `DATABASE_URL_SUPERUSER` (`bms_app`, `rolbypassrls = t`). DDL is unaffected:
-- `CREATE INDEX` scans the heap regardless of row security, so the index itself
-- keeps the ADR 0045 / §4.4 bracket.
--
-- The `UPDATE` is a one-time normalisation, not a prerequisite: the predicate
-- below excludes `''` on its own, so the index is correct whether or not any
-- row is normalised. It exists because a stored `''` is a value no reader wants
-- — `bindings.ts` already reads it as absent — and this file is the last
-- forward-only chance to say so cheaply. It touched 0 rows here (measured: 56
-- RTUs, 12 with a code, 12 distinct, 0 empty) and may touch some elsewhere.
--
-- IF THIS MIGRATION FAILS TO APPLY it is because another database holds two
-- RTUs with one `rtu_code`, and Postgres stops it with its own message naming
-- `rtus_rtu_code_idx`. That is the safe failure direction, and the repair is
-- the operator's: an `rtu_code` is a device identity someone knows by name, and
-- ADR 0065 §4 already settled that this file does not rename one automatically.
-- So there is no `DELETE` and no de-duplicating `UPDATE` here.
--
-- `IF NOT EXISTS` rather than a `DO` block: unlike `0070`'s `ADD CONSTRAINT`,
-- `CREATE UNIQUE INDEX` takes the clause natively, so a second run is a no-op
-- without the wrapper. No `CONCURRENTLY` — the migrator applies this file
-- inside one transaction (§4.4) and `CONCURRENTLY` cannot run in one. The lock
-- is bounded as `0069` and `0070` bound theirs: building this index holds SHARE
-- on `bms.rtus`, which blocks every ingest and admin write to the table, so an
-- unbounded wait would stall the hot path behind any in-flight reader. Five
-- seconds, then fail and be re-run, rather than hold the table.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint

UPDATE bms.rtus SET rtu_code = NULL WHERE rtu_code = '';
--> statement-breakpoint

SET ROLE bms_owner;

CREATE UNIQUE INDEX IF NOT EXISTS rtus_rtu_code_idx
  ON bms.rtus (rtu_code)
  WHERE rtu_code IS NOT NULL AND rtu_code <> '';

RESET ROLE;
--> statement-breakpoint

RESET lock_timeout;
