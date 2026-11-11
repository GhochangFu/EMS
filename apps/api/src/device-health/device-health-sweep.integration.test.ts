import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AlarmRaiser } from "../alarms/alarm-raise.service";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertASecondTickRaisesNothingNew,
  assertAStaleHostRaisesOnePerOrganizationAndHoldsTheRtus,
  assertOnlyTheOfflineRtuRaises,
  assertThePruneKeepsThirtyDays,
  type SweepFixtures,
} from "./device-health-sweep.integration.spec";
import { DeviceHealthSweepService } from "./device-health-sweep.service";

/**
 * `F3.16` (plan B3) — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. The sweep reads on
 * `bms_fleet` (the gate's default connection — the pool `ctx.db` is on the
 * worker) and `AlarmRaiser` writes on `bms_tenant`, so the raise is proved
 * under the real `0047` policy rather than through a bypassing owner.
 *
 * Fixtures, every code carrying the run's `f316sw-<stamp>`: the run's own
 * ingest host; four RTUs in one organization (offline, online, edge-served,
 * unmonitored) and one in a second; an edge gateway; drop buckets 29 and 31
 * days old on both bucket tables. Cleanup is by the ids and keys created,
 * never a prefix sweep (`tests/integration-fixture-isolation`). The cases run
 * in order: S3 makes the host stale.
 */
const connectionString = requireIntegrationDb({
  item: "F3.16",
  label: "the device-health sweep (monitored scope, raiseDevice under RLS, dedupe, prune)",
  because:
    "the monitored scope, the RTU window CTE, the tenant-GUC raise, alarms_open_per_device_uidx and " +
    "the two 30-day prunes are SQL over real rows under real roles; a green run without a database " +
    "asserts none of them.",
});

describe.skipIf(!connectionString)("F3.16 — the device-health sweep", () => {
  let observer: pg.Pool;
  let tenantPool: pg.Pool;
  let f: SweepFixtures;
  const stamp = randomUUID().slice(0, 8);
  const hostKey = `f316sw-${stamp}`;
  const rtuIds: string[] = [];
  let gatewayId: string | undefined;
  const raised: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    observer = await openIntegrationPool(url, "F3.16");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.16",
    );
    const { rows: first } = await observer.query<{ id: string; organization_id: string }>(
      "SELECT id, organization_id FROM bms.locations ORDER BY created_at, code LIMIT 1",
    );
    const locA = first[0];
    const { rows: second } = await observer.query<{ id: string; organization_id: string }>(
      "SELECT id, organization_id FROM bms.locations WHERE organization_id <> $1 ORDER BY created_at, code LIMIT 1",
      [locA?.organization_id ?? null],
    );
    const locB = second[0];
    if (!locA || !locB) throw new Error("F3.16: the seed lacks two organizations with a location — run pnpm db:seed.");

    const { rows: gw } = await observer.query<{ id: string }>(
      "INSERT INTO bms.edge_gateways (organization_id, location_id, code, name) VALUES ($1, $2, $3, $3) RETURNING id",
      [locA.organization_id, locA.id, `f316sw-${stamp}-gw`],
    );
    gatewayId = gw[0]!.id;

    const rtu = async (suffix: string, loc: { id: string; organization_id: string }, edge = false): Promise<string> => {
      const code = `f316sw-${stamp}-${suffix}`;
      const { rows } = await observer.query<{ id: string }>(
        `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type, expected_interval_seconds, edge_gateway_id)
         VALUES ($1, $2, $3, $3, 'mqtt', 10, $4) RETURNING id`,
        [loc.organization_id, loc.id, code, edge ? gatewayId : null],
      );
      rtuIds.push(rows[0]!.id);
      return rows[0]!.id;
    };
    const rtus = {
      offline: await rtu("offline", locA),
      online: await rtu("online", locA),
      edge: await rtu("edge", locA, true),
      unmonitored: await rtu("unmonitored", locA),
      orgB: await rtu("org-b", locB),
    };

    await observer.query(
      `INSERT INTO bms.ingest_hosts (host_key, started_at, healthy_since, last_beat_at)
       VALUES ($1, now() - interval '1 hour', now() - interval '1 hour', now())`,
      [hostKey],
    );
    for (const [rtuId, orgId, silence] of [
      [rtus.offline, locA.organization_id, "10 minutes"],
      [rtus.online, locA.organization_id, "1 second"],
      [rtus.edge, locA.organization_id, "10 minutes"],
      [rtus.orgB, locB.organization_id, "1 second"],
    ] as const) {
      await observer.query(
        `INSERT INTO bms.rtu_health (rtu_id, organization_id, host_key, monitored_since, last_seen_at)
         VALUES ($1, $2, $3, now() - interval '1 hour', now() - $4::interval)`,
        [rtuId, orgId, hostKey, silence],
      );
    }
    for (const days of [29, 31]) {
      await observer.query(
        `INSERT INTO bms.rtu_drop_hours (organization_id, rtu_id, bucket, reason, dropped)
         VALUES ($1, $2, date_trunc('hour', now(), 'UTC') - make_interval(days => $3), 'badQuality', 1)`,
        [locA.organization_id, rtus.offline, days],
      );
      await observer.query(
        `INSERT INTO bms.ingest_endpoint_drop_hours (host_key, endpoint_key, bucket, reason, dropped)
         VALUES ($1, 'ep', date_trunc('hour', now(), 'UTC') - make_interval(days => $2), 'unknownDevice', 1)`,
        [hostKey, days],
      );
    }

    const fleetDb = createDb(observer);
    const svc = new DeviceHealthSweepService(new AlarmRaiser(createDb(tenantPool)));
    f = {
      observer,
      svc,
      run: () => svc.run(fleetDb),
      hostKey,
      orgA: locA.organization_id,
      orgB: locB.organization_id,
      rtus,
      raised,
    };
  }, 60_000);

  afterAll(async () => {
    if (observer) {
      await observer.query("DELETE FROM bms.alarms WHERE id = ANY($1::uuid[]) OR rtu_id = ANY($2::uuid[])", [
        raised,
        rtuIds,
      ]);
      await observer.query("DELETE FROM bms.rtu_drop_hours WHERE rtu_id = ANY($1::uuid[])", [rtuIds]);
      await observer.query("DELETE FROM bms.rtu_health WHERE rtu_id = ANY($1::uuid[])", [rtuIds]);
      await observer.query("DELETE FROM bms.ingest_endpoint_drop_hours WHERE host_key = $1", [hostKey]);
      await observer.query("DELETE FROM bms.ingest_hosts WHERE host_key = $1", [hostKey]);
      await observer.query("DELETE FROM bms.rtus WHERE id = ANY($1::uuid[])", [rtuIds]);
      if (gatewayId) await observer.query("DELETE FROM bms.edge_gateways WHERE id = $1", [gatewayId]);
    }
    await Promise.all([observer?.end(), tenantPool?.end()]);
  }, 60_000);

  it("S1 only the Offline, monitored, cloud-served RTU raises, as a warning naming it", async () => {
    await assertOnlyTheOfflineRtuRaises(f);
  });

  it("S2 a second tick over the same silence opens nothing", async () => {
    await assertASecondTickRaisesNothingNew(f);
  });

  it("S3 a stale host raises one critical host alarm per organization and no RTU alarm", async () => {
    await assertAStaleHostRaisesOnePerOrganizationAndHoldsTheRtus(f);
  });

  it("S4 the prune deletes buckets older than 30 days on both tables", async () => {
    await assertThePruneKeepsThirtyDays(f);
  });
});
