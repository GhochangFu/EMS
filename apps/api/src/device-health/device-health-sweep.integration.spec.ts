import type pg from "pg";

import type { DeviceHealthSweepService, DeviceHealthSweepSummary } from "./device-health-sweep.service";

/**
 * `F3.16` (plan B3) — the device-health sweep on the real pools: the fleet read
 * of the monitored scope and its window CTE, `AlarmRaiser.raiseDevice` as
 * `bms_tenant` under each organization's GUC, the dedupe index, and the two
 * prunes. Assertions live here; the sibling `.test` owns the lifecycle (ADR 0014).
 *
 * Every RTU has a 10 s configured interval, so its window is the 25 s floor:
 * Online to 15 s of silence, Offline past 25 s (decision 11).
 */

export type SweepFixtures = {
  observer: pg.Pool;
  svc: DeviceHealthSweepService;
  /** The fleet handle the processor would pass as `ctx.db`. */
  run: () => Promise<DeviceHealthSweepSummary>;
  hostKey: string;
  orgA: string;
  orgB: string;
  rtus: {
    /** Org A, silent 10 min: Offline. */
    offline: string;
    /** Org A, heard now: Online. */
    online: string;
    /** Org A, behind an edge gateway, silent 10 min (decision 18). */
    edge: string;
    /** Org A, no `rtu_health` row: Not monitored (decision 20). */
    unmonitored: string;
    /** Org B, heard now until the host-stale phase silences it. */
    orgB: string;
  };
  /** Every alarm id a run opened, for the cleanup. */
  raised: string[];
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type OpenAlarm = { id: string; organization_id: string; source: string; rtu_id: string | null; severity: string; message: string };

async function openDeviceAlarms(f: SweepFixtures): Promise<OpenAlarm[]> {
  const { rows } = await f.observer.query<OpenAlarm>(
    `SELECT id, organization_id, source, rtu_id, severity, message FROM bms.alarms
      WHERE cleared_at IS NULL AND source <> 'rule'
        AND (rtu_id = ANY($1::uuid[]) OR (source = 'ingest_host' AND organization_id = ANY($2::uuid[])))`,
    [Object.values(f.rtus), [f.orgA, f.orgB]],
  );
  return rows;
}

/** S1: with the host fresh, the Offline cloud-served RTU raises one warning naming it; Online, edge-served and not-monitored raise nothing. */
export async function assertOnlyTheOfflineRtuRaises(f: SweepFixtures): Promise<void> {
  const summary = await f.run();
  f.raised.push(...summary.raisedAlarmIds);
  const open = await openDeviceAlarms(f);
  const comms = open.filter((alarm) => alarm.source === "rtu_comms");
  assert(
    comms.length === 1 &&
      comms[0]?.rtu_id === f.rtus.offline &&
      comms[0].organization_id === f.orgA &&
      comms[0].severity === "warning" &&
      comms[0].message.startsWith("Communication lost: "),
    `expected exactly one open rtu_comms warning, for the offline RTU, got ${JSON.stringify(open)}`,
  );
  assert(
    !open.some((alarm) => alarm.source === "ingest_host"),
    `expected no ingest_host alarm while the host is fresh, got ${JSON.stringify(open)}`,
  );
}

/** S2: a second tick over the same silence opens nothing (`alarms_open_per_device_uidx`). */
export async function assertASecondTickRaisesNothingNew(f: SweepFixtures): Promise<void> {
  const before = await openDeviceAlarms(f);
  const summary = await f.run();
  f.raised.push(...summary.raisedAlarmIds);
  const after = await openDeviceAlarms(f);
  assert(
    after.length === before.length && summary.rtuAlarms === 0,
    `expected the second tick to open nothing, before=${before.length} after=${after.length} summary=${JSON.stringify(summary)}`,
  );
}

/**
 * S3 (decisions 6, 15): the host 31 s without a beat raises one critical `ingest_host` alarm in each
 * organization it serves — and org B's RTU, silenced in the same instant, raises no `rtu_comms`.
 */
export async function assertAStaleHostRaisesOnePerOrganizationAndHoldsTheRtus(f: SweepFixtures): Promise<void> {
  await f.observer.query(
    "UPDATE bms.rtu_health SET last_seen_at = now() - interval '10 minutes' WHERE rtu_id = $1",
    [f.rtus.orgB],
  );
  await f.observer.query(
    "UPDATE bms.ingest_hosts SET last_beat_at = now() - interval '31 seconds' WHERE host_key = $1",
    [f.hostKey],
  );
  const summary = await f.run();
  f.raised.push(...summary.raisedAlarmIds);
  const open = await openDeviceAlarms(f);
  const host = open.filter((alarm) => alarm.source === "ingest_host");
  assert(
    host.filter((alarm) => alarm.organization_id === f.orgA).length === 1 &&
      host.filter((alarm) => alarm.organization_id === f.orgB).length === 1 &&
      host.every((alarm) => alarm.severity === "critical" && alarm.message === "Ingest host not reporting"),
    `expected one critical "Ingest host not reporting" in each organization, got ${JSON.stringify(host)}`,
  );
  assert(
    !open.some((alarm) => alarm.rtu_id === f.rtus.orgB),
    `expected no rtu_comms for org B's RTU while the host is stale, got ${JSON.stringify(open)}`,
  );
}

/** S4 (decision 3): buckets older than 30 days are deleted on both tables; younger ones stay. */
export async function assertThePruneKeepsThirtyDays(f: SweepFixtures): Promise<void> {
  const { rows: rtuRows } = await f.observer.query<{ days: number }>(
    `SELECT round(extract(epoch FROM now() - bucket) / 86400)::int AS days FROM bms.rtu_drop_hours
      WHERE rtu_id = $1 ORDER BY bucket`,
    [f.rtus.offline],
  );
  const { rows: endpointRows } = await f.observer.query<{ days: number }>(
    `SELECT round(extract(epoch FROM now() - bucket) / 86400)::int AS days FROM bms.ingest_endpoint_drop_hours
      WHERE host_key = $1 ORDER BY bucket`,
    [f.hostKey],
  );
  assert(
    JSON.stringify(rtuRows.map((r) => r.days)) === "[29]",
    `expected only the 29-day rtu_drop_hours bucket to survive, got ${JSON.stringify(rtuRows)}`,
  );
  assert(
    JSON.stringify(endpointRows.map((r) => r.days)) === "[29]",
    `expected only the 29-day ingest_endpoint_drop_hours bucket to survive, got ${JSON.stringify(endpointRows)}`,
  );
}
