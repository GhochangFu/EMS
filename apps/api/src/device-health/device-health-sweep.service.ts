import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";

import {
  AlarmRaiser,
  type DeviceAlarmRaiseInput,
  type DeviceAlarmRaiseResult,
} from "../alarms/alarm-raise.service";
import {
  byOrganization,
  INGEST_HOST_ALARM_MESSAGE,
  INGEST_HOST_SEVERITY,
  organizationHostReporting,
  RTU_COMMS_SEVERITY,
  rtuCommsEligible,
  rtuCommsMessage,
} from "./device-alarm-rule";
import { DROP_HISTORY_DAYS, readIngestHosts, readRtuHealthRows, stateOf, type RtuHealthRow } from "./device-health.reads";
import type { HostBeat } from "./device-state";

/**
 * `F3.16` / ADR 0127 decisions 6, 12, 15, 18 and 20 — the worker's device-health
 * tick (the `device-health` queue, every `DEVICE_HEALTH_INTERVAL_MS`).
 *
 * **Read, then raise, then prune.** One fleet read of every monitored RTU with
 * its window and health fields, one of every ingest host with the database
 * clock. Then, per organization with a monitored RTU:
 *
 * - the ingest host serving its RTUs is not reporting (stale on the database
 *   clock, or named but rowless) → one `ingest_host` alarm (`critical`) and
 *   **no** `rtu_comms` alarm this tick: a stopped host freezes every state, so
 *   the per-RTU alarms are held (decision 6);
 * - otherwise each monitored, cloud-served RTU whose decision-11 state is
 *   `offline` → one `rtu_comms` alarm (`warning`). Edge-served RTUs (decision
 *   18) and RTUs with no `monitored_since` (decision 20) raise nothing.
 *
 * Every raise goes through `AlarmRaiser.raiseDevice` — the one raiser, under the
 * organization's tenant GUC, deduped by `alarms_open_per_device_uidx`, so a
 * repeated tick over a silent RTU writes nothing. Clearing is not this sweep's:
 * the alarm lifecycle sweep stays the one writer of `cleared_at` (ADR 0057).
 * A raise that throws is warned and counted and the next organization still
 * runs; the prune runs regardless.
 *
 * **Prune (decision 3).** Hour buckets older than {@link DROP_HISTORY_DAYS}
 * days, on both bucket tables.
 *
 * {@link runDeviceHealthSweep} takes its dependencies so the spec runs every
 * branch over fakes; the class is the wiring.
 */

export type DeviceHealthSweepSummary = {
  organizations: number;
  hostAlarms: number;
  rtuAlarms: number;
  /** The ids of the alarms this tick opened — the integration suite deletes exactly these. */
  raisedAlarmIds: string[];
  prunedRtuBuckets: number;
  prunedEndpointBuckets: number;
  failed: number;
  durationMs: number;
};

export interface DeviceHealthSweepDeps {
  readMonitoredRtus(): Promise<RtuHealthRow[]>;
  readIngestHosts(): Promise<{ hosts: HostBeat[]; dbNowMs: number }>;
  raiseDevice(input: DeviceAlarmRaiseInput): Promise<DeviceAlarmRaiseResult>;
  prune(): Promise<{ rtuBuckets: number; endpointBuckets: number }>;
  logger: Pick<Logger, "warn">;
}

export async function runDeviceHealthSweep(
  deps: DeviceHealthSweepDeps,
  clock: () => number = Date.now,
): Promise<DeviceHealthSweepSummary> {
  const startedAt = clock();
  const [rows, { hosts, dbNowMs }] = await Promise.all([deps.readMonitoredRtus(), deps.readIngestHosts()]);
  const hostsByKey = new Map(hosts.map((h) => [h.hostKey, h]));
  const summary: DeviceHealthSweepSummary = {
    organizations: 0,
    hostAlarms: 0,
    rtuAlarms: 0,
    raisedAlarmIds: [],
    prunedRtuBuckets: 0,
    prunedEndpointBuckets: 0,
    failed: 0,
    durationMs: 0,
  };

  const raise = async (input: DeviceAlarmRaiseInput): Promise<boolean> => {
    try {
      const result = await deps.raiseDevice(input);
      if (result.raised && result.alarmId !== null) {
        summary.raisedAlarmIds.push(result.alarmId);
        return true;
      }
    } catch (err) {
      summary.failed += 1;
      // §9.6: ids and the cause, never the alarm text.
      deps.logger.warn(
        `device-health: ${input.source} raise failed for organization ${input.organizationId}: ${reasonOf(err)}`,
      );
    }
    return false;
  };

  for (const [organizationId, ofOrganization] of byOrganization(rows)) {
    const reporting = organizationHostReporting(ofOrganization, hosts, dbNowMs);
    if (reporting === null) {
      continue;
    }
    summary.organizations += 1;
    if (!reporting) {
      if (
        await raise({
          organizationId,
          source: "ingest_host",
          severity: INGEST_HOST_SEVERITY,
          message: INGEST_HOST_ALARM_MESSAGE,
        })
      ) {
        summary.hostAlarms += 1;
      }
      continue;
    }
    for (const row of ofOrganization) {
      if (!rtuCommsEligible(row) || stateOf(row, hostsByKey) !== "offline") {
        continue;
      }
      if (
        await raise({
          organizationId,
          source: "rtu_comms",
          rtuId: row.rtuId,
          severity: RTU_COMMS_SEVERITY,
          message: rtuCommsMessage(row),
        })
      ) {
        summary.rtuAlarms += 1;
      }
    }
  }

  const pruned = await deps.prune();
  summary.prunedRtuBuckets = pruned.rtuBuckets;
  summary.prunedEndpointBuckets = pruned.endpointBuckets;
  summary.durationMs = clock() - startedAt;
  return summary;
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class DeviceHealthSweepService {
  private readonly logger = new Logger(DeviceHealthSweepService.name);

  constructor(private readonly raiser: AlarmRaiser) {}

  /**
   * One tick. `db` is the fleet handle `runProcessor` builds for a `fleet` queue (ADR 0063
   * decision 6); the service injects no fleet token of its own, as `RuleSweepService` does.
   */
  run(db: BmsDb): Promise<DeviceHealthSweepSummary> {
    return runDeviceHealthSweep({
      // fleetDb: a system sweep with no JWT across every organization's monitored RTUs (ADR 0043
      // Amendment 3); each raise below runs under that RTU's own organization's tenant GUC.
      readMonitoredRtus: () => readRtuHealthRows(db, { kind: "monitored" }),
      // fleetDb: ingest_hosts is a platform table with no tenant column (decision 7).
      readIngestHosts: () => readIngestHosts(db),
      raiseDevice: (input) => this.raiser.raiseDevice(input),
      prune: () => pruneDropBuckets(db),
      logger: this.logger,
    });
  }
}

/**
 * Decision 3: drop the hour buckets older than {@link DROP_HISTORY_DAYS} days. On the fleet
 * handle: `ingest_endpoint_drop_hours` is a platform table `bms_tenant` cannot touch, and
 * `rtu_drop_hours` is a retention delete across every organization by a system sweep with no JWT
 * (ADR 0043 Amendment 3) — its only predicate is the bucket's age.
 */
export async function pruneDropBuckets(db: BmsDb): Promise<{ rtuBuckets: number; endpointBuckets: number }> {
  // fleetDb: retention across every organization (above).
  const rtu = await db.execute(
    sql`DELETE FROM bms.rtu_drop_hours WHERE bucket < now() - make_interval(days => ${DROP_HISTORY_DAYS})`,
  );
  // fleetDb: platform table (decision 17).
  const endpoint = await db.execute(
    sql`DELETE FROM bms.ingest_endpoint_drop_hours WHERE bucket < now() - make_interval(days => ${DROP_HISTORY_DAYS})`,
  );
  return { rtuBuckets: rtu.rowCount ?? 0, endpointBuckets: endpoint.rowCount ?? 0 };
}
