import { randomUUID } from "node:crypto";

import pg from "pg";
import { expect } from "vitest";

import type { HealthFlush, RtuDropRow } from "./device-health.js";
import { writeDeviceHealth } from "./device-health-write.js";

/**
 * `F3.16` / ADR 0127 decisions 7, 9, 10 and 17 — the device-health flush
 * against real Postgres, as `bms_fleet` (the host's role).
 *
 * **These rows commit.** `writeDeviceHealth` owns its own `BEGIN … COMMIT`, so
 * the `BEGIN … ROLLBACK` wrapper the other ingest integration suites use would
 * swallow the very boundary under test. Each case plants its own RTUs (one in
 * `ESKOM`, one in `PHEWB`) under a run-unique code and a run-unique host key,
 * and {@link cleanUp} deletes them; the RTU delete cascades to `rtu_health`
 * and `rtu_drop_hours` (migration `0149`'s composite keys). Every assertion
 * reads the rows this run wrote, never a table total.
 */

export type Fixture = {
  readonly hostKey: string;
  readonly eskom: { readonly org: string; readonly rtu: string };
  readonly phewb: { readonly org: string; readonly rtu: string };
};

const HOUR = new Date("2026-11-11T10:00:00.000Z");

/** Plants one RTU in each of `ESKOM` and `PHEWB`, as `bms_fleet`. */
export async function plantFixture(fleet: pg.Pool): Promise<Fixture> {
  const run = randomUUID().slice(0, 8);
  const plant = async (code: string): Promise<{ org: string; rtu: string }> => {
    const loc = await fleet.query<{ id: string; organization_id: string }>(
      `SELECT l.id, l.organization_id FROM bms.locations l
         JOIN bms.organizations o ON o.id = l.organization_id
        WHERE o.code = $1 ORDER BY l.created_at, l.id LIMIT 1`,
      [code],
    );
    expect(loc.rows.length, `needs a seeded ${code} location — run pnpm db:seed`).toBe(1);
    const rtu = await fleet.query<{ id: string }>(
      `INSERT INTO bms.rtus (location_id, organization_id, code, display_name)
       VALUES ($1, $2, $3, 'F3.16 device health fixture') RETURNING id`,
      [loc.rows[0].id, loc.rows[0].organization_id, `F316-${run}-${code}`],
    );
    return { org: loc.rows[0].organization_id, rtu: rtu.rows[0].id };
  };
  return { hostKey: `f316-${run}`, eskom: await plant("ESKOM"), phewb: await plant("PHEWB") };
}

export async function cleanUp(fleet: pg.Pool, fixture: Fixture | undefined): Promise<void> {
  if (fixture === undefined) {
    return;
  }
  await fleet.query("DELETE FROM bms.rtus WHERE id = ANY($1::uuid[])", [[fixture.eskom.rtu, fixture.phewb.rtu]]);
  await fleet.query("DELETE FROM bms.ingest_endpoint_drop_hours WHERE host_key = $1", [fixture.hostKey]);
  await fleet.query("DELETE FROM bms.ingest_hosts WHERE host_key = $1", [fixture.hostKey]);
}

function flush(
  fixture: Fixture,
  beatAt: Date,
  parts: Partial<Omit<HealthFlush, "host">> = {},
  restart: { restarted: boolean; healthyReset: boolean } = { restarted: true, healthyReset: true },
): HealthFlush {
  return {
    host: { hostKey: fixture.hostKey, beatAt, endpoints: 3, ...restart },
    rtus: [],
    monitoring: { entered: [], exited: [], keep: null },
    drops: [],
    endpointDrops: [],
    ...parts,
  };
}

function drop(rtuId: string, dropped: number, firstPointKey: string | null, firstSourceKey: string | null): RtuDropRow {
  return {
    rtuId,
    bucket: HOUR,
    reason: "outOfRange",
    dropped,
    firstAssetId: firstPointKey === null ? null : randomUUID(),
    firstPointKey,
    firstSourceKey,
  };
}

async function write(fleet: pg.Pool, value: HealthFlush): Promise<void> {
  const client = await fleet.connect();
  try {
    await writeDeviceHealth(client, value);
  } finally {
    client.release();
  }
}

/** Two flushes sum and keep the first point; the beat and the host row land; an unknown RTU writes nothing. */
export async function assertFlushesSumAndKeepTheFirstPoint(fleet: pg.Pool, fixture: Fixture): Promise<void> {
  const ghost = randomUUID();
  const t1 = new Date(HOUR.getTime() + 60_000);
  await write(
    fleet,
    flush(fixture, t1, {
      rtus: [
        { rtuId: fixture.eskom.rtu, lastSeenAt: t1, clockSkewSeconds: 42, clockSkewAt: t1 },
        { rtuId: ghost, lastSeenAt: t1, clockSkewSeconds: null, clockSkewAt: null },
      ],
      drops: [drop(fixture.eskom.rtu, 2, "LEVEL", "lvl"), drop(ghost, 9, "X", "x")],
      endpointDrops: [
        { endpointKey: "mqtts://broker:8883", bucket: HOUR, reason: "unknownDevice", dropped: 4, firstDeviceKey: "STRANGER", firstSourceKey: "kw" },
      ],
    }),
  );
  const t2 = new Date(HOUR.getTime() + 120_000);
  await write(
    fleet,
    flush(fixture, t2, {
      drops: [drop(fixture.eskom.rtu, 3, "OTHER", "oth")],
      endpointDrops: [
        { endpointKey: "mqtts://broker:8883", bucket: HOUR, reason: "unknownDevice", dropped: 1, firstDeviceKey: "LATER", firstSourceKey: "z" },
      ],
    }),
  );

  const host = await fleet.query(`SELECT endpoints FROM bms.ingest_hosts WHERE host_key = $1`, [fixture.hostKey]);
  expect(host.rows).toEqual([{ endpoints: 3 }]);

  const health = await fleet.query(
    `SELECT organization_id, host_key, last_seen_at, clock_skew_seconds, clock_skew_at FROM bms.rtu_health WHERE rtu_id = $1`,
    [fixture.eskom.rtu],
  );
  expect(health.rows).toEqual([
    { organization_id: fixture.eskom.org, host_key: fixture.hostKey, last_seen_at: t1, clock_skew_seconds: 42, clock_skew_at: t1 },
  ]);

  const drops = await fleet.query(
    `SELECT organization_id, dropped::int AS dropped, first_point_key, first_source_key
       FROM bms.rtu_drop_hours WHERE rtu_id = $1`,
    [fixture.eskom.rtu],
  );
  expect(drops.rows).toEqual([
    { organization_id: fixture.eskom.org, dropped: 5, first_point_key: "LEVEL", first_source_key: "lvl" },
  ]);

  const endpoint = await fleet.query(
    `SELECT dropped::int AS dropped, first_device_key, first_source_key
       FROM bms.ingest_endpoint_drop_hours WHERE host_key = $1`,
    [fixture.hostKey],
  );
  expect(endpoint.rows).toEqual([{ dropped: 5, first_device_key: "STRANGER", first_source_key: "kw" }]);

  const stray = await fleet.query(
    `SELECT (SELECT count(*)::int FROM bms.rtu_health WHERE rtu_id = $1) AS h,
            (SELECT count(*)::int FROM bms.rtu_drop_hours WHERE rtu_id = $1) AS d`,
    [ghost],
  );
  expect(stray.rows, "an RTU id bms.rtus does not hold writes nothing").toEqual([{ h: 0, d: 0 }]);
}

/** An older receive time never moves `last_seen_at` back; an older skew never replaces a newer one. */
export async function assertLastSeenOnlyMovesForward(fleet: pg.Pool, fixture: Fixture): Promise<void> {
  const newer = new Date(HOUR.getTime() + 300_000);
  const older = new Date(HOUR.getTime() + 10_000);
  await write(
    fleet,
    flush(fixture, newer, { rtus: [{ rtuId: fixture.phewb.rtu, lastSeenAt: newer, clockSkewSeconds: -5, clockSkewAt: newer }] }),
  );
  await write(
    fleet,
    flush(fixture, newer, { rtus: [{ rtuId: fixture.phewb.rtu, lastSeenAt: older, clockSkewSeconds: 999, clockSkewAt: older }] }),
  );
  const r = await fleet.query(
    `SELECT last_seen_at, clock_skew_seconds FROM bms.rtu_health WHERE rtu_id = $1`,
    [fixture.phewb.rtu],
  );
  expect(r.rows).toEqual([{ last_seen_at: newer, clock_skew_seconds: -5 }]);
}

/** `monitored_since` is stamped on entry, kept across a re-entry, cleared on exit and by the boot sweep. */
export async function assertMonitoredSinceFollowsThePlan(fleet: pg.Pool, fixture: Fixture): Promise<void> {
  const since = new Date(HOUR.getTime() + 1_000);
  const read = async (): Promise<Record<string, Date | null>> => {
    const r = await fleet.query<{ rtu_id: string; monitored_since: Date | null }>(
      `SELECT rtu_id, monitored_since FROM bms.rtu_health WHERE rtu_id = ANY($1::uuid[])`,
      [[fixture.eskom.rtu, fixture.phewb.rtu]],
    );
    return Object.fromEntries(r.rows.map((row) => [row.rtu_id, row.monitored_since]));
  };
  const both = [
    { rtuId: fixture.eskom.rtu, since },
    { rtuId: fixture.phewb.rtu, since },
  ];
  await write(fleet, flush(fixture, since, { monitoring: { entered: both, exited: [], keep: null } }));
  expect(await read()).toEqual({ [fixture.eskom.rtu]: since, [fixture.phewb.rtu]: since });

  // A restart enters both again: the stored stamp stands.
  const later = new Date(since.getTime() + 60_000);
  await write(
    fleet,
    flush(fixture, later, {
      monitoring: { entered: both.map((e) => ({ ...e, since: later })), exited: [], keep: null },
    }),
  );
  expect(await read()).toEqual({ [fixture.eskom.rtu]: since, [fixture.phewb.rtu]: since });

  await write(fleet, flush(fixture, later, { monitoring: { entered: [], exited: [fixture.eskom.rtu], keep: null } }));
  expect(await read()).toEqual({ [fixture.eskom.rtu]: null, [fixture.phewb.rtu]: since });

  // The boot sweep: this host's rows outside `keep` are cleared.
  await write(fleet, flush(fixture, later, { monitoring: { entered: [], exited: [], keep: [] } }));
  expect(await read()).toEqual({ [fixture.eskom.rtu]: null, [fixture.phewb.rtu]: null });
}

/** A failing statement rolls the whole flush back, the beat included. */
export async function assertAFailureRollsTheBeatBack(fleet: pg.Pool, fixture: Fixture): Promise<void> {
  const t = new Date(HOUR.getTime() + 30_000);
  const bad = flush(fixture, t, {
    rtus: [{ rtuId: fixture.eskom.rtu, lastSeenAt: t, clockSkewSeconds: null, clockSkewAt: null }],
    endpointDrops: [
      // A seventh reason: migration 0149's CHECK refuses it with 23514.
      { endpointKey: "e", bucket: HOUR, reason: "seventh" as never, dropped: 1, firstDeviceKey: null, firstSourceKey: null },
    ],
  });
  let code: string | undefined;
  try {
    await write(fleet, bad);
  } catch (error) {
    code = (error as { code?: string }).code;
  }
  expect(code, "the flush must throw the CHECK violation").toBe("23514");
  const left = await fleet.query(
    `SELECT (SELECT count(*)::int FROM bms.ingest_hosts WHERE host_key = $1) AS hosts,
            (SELECT count(*)::int FROM bms.rtu_health WHERE rtu_id = $2) AS rtus`,
    [fixture.hostKey, fixture.eskom.rtu],
  );
  expect(left.rows, "nothing of the failed flush survives").toEqual([{ hosts: 0, rtus: 0 }]);
  // The connection is usable afterwards: the transaction was rolled back, not left open.
  await write(fleet, flush(fixture, t));
}

/** As `bms_tenant`, an organization reads only its own RTU's row and cannot write it. */
export async function assertTenantReadsOnlyItsOwn(fleet: pg.Pool, tenant: pg.Pool, fixture: Fixture): Promise<void> {
  const t = new Date(HOUR.getTime() + 5_000);
  await write(
    fleet,
    flush(fixture, t, {
      rtus: [
        { rtuId: fixture.eskom.rtu, lastSeenAt: t, clockSkewSeconds: null, clockSkewAt: null },
        { rtuId: fixture.phewb.rtu, lastSeenAt: t, clockSkewSeconds: null, clockSkewAt: null },
      ],
      drops: [drop(fixture.eskom.rtu, 1, "P", "s"), drop(fixture.phewb.rtu, 1, "P", "s")],
    }),
  );
  const client = await tenant.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(`SELECT set_config('app.current_organization', $1, true)`, [fixture.eskom.org]);
      const ids = [[fixture.eskom.rtu, fixture.phewb.rtu]];
      const health = await client.query(`SELECT rtu_id FROM bms.rtu_health WHERE rtu_id = ANY($1::uuid[])`, ids);
      expect(health.rows).toEqual([{ rtu_id: fixture.eskom.rtu }]);
      const drops = await client.query(`SELECT rtu_id FROM bms.rtu_drop_hours WHERE rtu_id = ANY($1::uuid[])`, ids);
      expect(drops.rows).toEqual([{ rtu_id: fixture.eskom.rtu }]);
      await client.query("SAVEPOINT w");
      let code: string | undefined;
      try {
        await client.query(`UPDATE bms.rtu_health SET host_key = 'x' WHERE rtu_id = $1`, [fixture.eskom.rtu]);
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      await client.query("ROLLBACK TO SAVEPOINT w");
      expect(code, "bms_tenant must not write rtu_health").toBe("42501");
    } finally {
      await client.query("ROLLBACK");
    }
  } finally {
    client.release();
  }
}

type HostRow = { started_at: Date; healthy_since: Date; last_beat_at: Date; lag_ms: number };

async function hostRow(fleet: pg.Pool, fixture: Fixture): Promise<HostRow> {
  const result = await fleet.query<HostRow>(
    `SELECT started_at, healthy_since, last_beat_at,
            (extract(epoch FROM now() - last_beat_at) * 1000)::float8 AS lag_ms
       FROM bms.ingest_hosts WHERE host_key = $1`,
    [fixture.hostKey],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}

/**
 * The host row is stamped on the database clock (the one `hostStateAt` judges it on), never
 * the host's `beatAt`; `started_at` and `healthy_since` move only when the beat's flags say so.
 */
export async function assertTheBeatIsTheDatabaseClock(fleet: pg.Pool, fixture: Fixture): Promise<void> {
  const hostClock = new Date("2000-01-01T00:00:00.000Z");
  await write(fleet, flush(fixture, hostClock));
  const boot = await hostRow(fleet, fixture);
  expect(boot.last_beat_at.getTime(), "never the host's clock").not.toBe(hostClock.getTime());
  expect(boot.lag_ms, "the database's now()").toBeLessThan(60_000);
  expect(boot.started_at).toEqual(boot.last_beat_at);
  expect(boot.healthy_since).toEqual(boot.last_beat_at);

  await write(fleet, flush(fixture, hostClock, {}, { restarted: false, healthyReset: false }));
  const onTime = await hostRow(fleet, fixture);
  expect(onTime.last_beat_at.getTime()).toBeGreaterThan(boot.last_beat_at.getTime());
  expect(onTime.started_at, "an on-time beat keeps started_at").toEqual(boot.started_at);
  expect(onTime.healthy_since, "and healthy_since").toEqual(boot.healthy_since);

  await write(fleet, flush(fixture, hostClock, {}, { restarted: false, healthyReset: true }));
  const missed = await hostRow(fleet, fixture);
  expect(missed.healthy_since, "a missed beat restarts healthy_since at the beat").toEqual(missed.last_beat_at);
  expect(missed.started_at, "but not started_at").toEqual(boot.started_at);
}
