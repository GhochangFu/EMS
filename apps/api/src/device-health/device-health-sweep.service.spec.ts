import type { DeviceAlarmRaiseInput, DeviceAlarmRaiseResult } from "../alarms/alarm-raise.service";
import type { RtuHealthRow } from "./device-health.reads";
import { runDeviceHealthSweep, type DeviceHealthSweepDeps } from "./device-health-sweep.service";
import type { HostBeat } from "./device-state";

/**
 * `F3.16` (plan B3, ADR 0127 decisions 6, 11, 15, 18, 20) — one device-health
 * tick over fakes, one claim per function. The real SQL — the monitored
 * scope, the window CTE, the dedupe index and the two prunes — is
 * `device-health-sweep.integration.spec.ts`'s.
 *
 * Every instant is fixed: the database clock is {@link DB_NOW}, the host's last
 * beat 5 s before it (fresh) unless a case says otherwise, and a 60 s window
 * puts Stale past 36 s and Offline past 60 s of silence (decision 11).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const DB_NOW = Date.parse("2026-11-11T12:00:00.000Z");
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const HOST = "ingest-1";

function host(lastBeatSecondsAgo = 5): HostBeat {
  return { hostKey: HOST, lastBeatMs: DB_NOW - lastBeatSecondsAgo * 1000, healthySinceMs: DB_NOW - 3_600_000 };
}

/** A monitored, cloud-served RTU last heard `silentSeconds` before the host's beat (5 s before DB_NOW). */
function rtu(id: string, silentSeconds: number, overrides: Partial<RtuHealthRow> = {}): RtuHealthRow {
  const beat = DB_NOW - 5000;
  return {
    rtuId: id,
    organizationId: ORG_A,
    code: `RTU-${id}`,
    displayName: `Pump house ${id}`,
    edgeServed: false,
    hostKey: HOST,
    lastSeenMs: beat - silentSeconds * 1000,
    monitoredSinceMs: DB_NOW - 7_200_000,
    windowSeconds: 60,
    clockSkewSeconds: null,
    clockSkewAtMs: null,
    ...overrides,
  };
}

type Recorded = { raises: DeviceAlarmRaiseInput[]; prunes: number; warnings: string[] };

function fakeDeps(opts: {
  rows: RtuHealthRow[];
  hosts?: HostBeat[];
  raise?: (input: DeviceAlarmRaiseInput) => Promise<DeviceAlarmRaiseResult>;
}): { deps: DeviceHealthSweepDeps; recorded: Recorded } {
  const recorded: Recorded = { raises: [], prunes: 0, warnings: [] };
  let next = 0;
  const deps: DeviceHealthSweepDeps = {
    readMonitoredRtus: () => Promise.resolve(opts.rows),
    readIngestHosts: () => Promise.resolve({ hosts: opts.hosts ?? [host()], dbNowMs: DB_NOW }),
    raiseDevice: (input) => {
      recorded.raises.push(input);
      if (opts.raise) return opts.raise(input);
      next += 1;
      return Promise.resolve({ raised: true, alarmId: `alarm-${next}` });
    },
    prune: () => {
      recorded.prunes += 1;
      return Promise.resolve({ rtuBuckets: 3, endpointBuckets: 2 });
    },
    logger: { warn: (message: string) => recorded.warnings.push(message) },
  };
  return { deps, recorded };
}

const describeRaises = (raises: DeviceAlarmRaiseInput[]) => JSON.stringify(raises);

/** An Offline, monitored, cloud-served RTU raises one `rtu_comms` warning naming it. */
export async function assertAnOfflineRtuRaisesOneCommsAlarm(): Promise<void> {
  const { deps, recorded } = fakeDeps({ rows: [rtu("1", 61)] });
  const summary = await runDeviceHealthSweep(deps);
  const [only] = recorded.raises;
  assert(
    recorded.raises.length === 1 &&
      only?.source === "rtu_comms" &&
      only.rtuId === "1" &&
      only.organizationId === ORG_A &&
      only.severity === "warning" &&
      only.message === "Communication lost: Pump house 1",
    `expected one rtu_comms warning "Communication lost: Pump house 1" for RTU 1 in ORG_A, got ${describeRaises(recorded.raises)}`,
  );
  assert(
    summary.rtuAlarms === 1 && summary.hostAlarms === 0 && summary.raisedAlarmIds.join() === "alarm-1",
    `expected the summary to count one RTU alarm and name alarm-1, got ${JSON.stringify(summary)}`,
  );
}

/** Online (36 s of a 60 s window is the Stale edge) and Stale both raise nothing: only Offline is owed. */
export async function assertAnRtuInsideItsWindowRaisesNothing(): Promise<void> {
  const { deps, recorded } = fakeDeps({ rows: [rtu("online", 10), rtu("stale", 59)] });
  await runDeviceHealthSweep(deps);
  assert(recorded.raises.length === 0, `expected no raise inside the window, got ${describeRaises(recorded.raises)}`);
}

/** Decision 18: an edge-served RTU raises nothing, Offline or not. */
export async function assertAnEdgeServedRtuRaisesNothing(): Promise<void> {
  const { deps, recorded } = fakeDeps({ rows: [rtu("edge", 600, { edgeServed: true })] });
  await runDeviceHealthSweep(deps);
  assert(recorded.raises.length === 0, `expected no raise for an edge-served RTU, got ${describeRaises(recorded.raises)}`);
}

/** Decision 20: an RTU with no `monitored_since` is Not monitored and raises nothing, however old its last-seen. */
export async function assertANotMonitoredRtuRaisesNothing(): Promise<void> {
  const { deps, recorded } = fakeDeps({ rows: [rtu("sim", 86_400, { monitoredSinceMs: null })] });
  await runDeviceHealthSweep(deps);
  assert(recorded.raises.length === 0, `expected no raise for a not-monitored RTU, got ${describeRaises(recorded.raises)}`);
}

/**
 * Decisions 6 and 15: a stale host (31 s with no beat, past the 30 s bound) raises one critical
 * `ingest_host` alarm in each organization with a monitored RTU — and no RTU alarm, though every
 * RTU here is long silent.
 */
export async function assertAStaleHostRaisesOneHostAlarmPerOrganizationAndNoRtuAlarm(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    rows: [rtu("a1", 600), rtu("a2", 600), rtu("b1", 600, { organizationId: ORG_B })],
    hosts: [host(31)],
  });
  const summary = await runDeviceHealthSweep(deps);
  const hostRaises = recorded.raises.filter((raise) => raise.source === "ingest_host");
  const organizations = hostRaises.map((raise) => raise.organizationId).sort();
  assert(
    recorded.raises.length === 2 &&
      hostRaises.length === 2 &&
      organizations.join() === [ORG_A, ORG_B].sort().join() &&
      hostRaises.every((raise) => raise.severity === "critical" && raise.message === "Ingest host not reporting"),
    `expected exactly one critical "Ingest host not reporting" per organization and no rtu_comms, got ${describeRaises(recorded.raises)}`,
  );
  assert(summary.hostAlarms === 2 && summary.rtuAlarms === 0, `expected 2 host and 0 RTU alarms, got ${JSON.stringify(summary)}`);
}

/** A host with no row at all for a key the RTUs name is not reporting either; an organization with no monitored RTU gets nothing. */
export async function assertAMissingHostRowRaisesTheHostAlarm(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    rows: [rtu("a1", 600), rtu("b1", 600, { organizationId: ORG_B, monitoredSinceMs: null })],
    hosts: [],
  });
  await runDeviceHealthSweep(deps);
  assert(
    recorded.raises.length === 1 && recorded.raises[0]?.source === "ingest_host" && recorded.raises[0].organizationId === ORG_A,
    `expected one ingest_host alarm for ORG_A only, got ${describeRaises(recorded.raises)}`,
  );
}

/** The prune runs once per tick, and still runs when a raise throws; the failure is warned and counted. */
export async function assertThePruneRunsAndARaiseFailureDoesNotStopTheTick(): Promise<void> {
  const { deps, recorded } = fakeDeps({
    rows: [rtu("a1", 600), rtu("b1", 600, { organizationId: ORG_B })],
    raise: (input) =>
      input.organizationId === ORG_A
        ? Promise.reject(new Error("tenant write refused"))
        : Promise.resolve({ raised: true, alarmId: "alarm-b" }),
  });
  const summary = await runDeviceHealthSweep(deps);
  assert(recorded.prunes === 1, `expected one prune, got ${recorded.prunes}`);
  assert(
    summary.failed === 1 && summary.rtuAlarms === 1 && summary.prunedRtuBuckets === 3 && summary.prunedEndpointBuckets === 2,
    `expected 1 failure, ORG_B's raise counted and both prune counts, got ${JSON.stringify(summary)}`,
  );
  assert(
    recorded.warnings.some((line) => line.includes(ORG_A) && line.includes("tenant write refused")),
    `expected a warn naming ORG_A and the cause, got ${JSON.stringify(recorded.warnings)}`,
  );
}

/** An already-open alarm (the raiser's dedupe answers `raised: false`) is not counted as raised. */
export async function assertADedupedRaiseIsNotCounted(): Promise<void> {
  const { deps } = fakeDeps({
    rows: [rtu("1", 600)],
    raise: () => Promise.resolve({ raised: false, alarmId: null }),
  });
  const summary = await runDeviceHealthSweep(deps);
  assert(
    summary.rtuAlarms === 0 && summary.raisedAlarmIds.length === 0,
    `expected a deduped raise to count nothing, got ${JSON.stringify(summary)}`,
  );
}
