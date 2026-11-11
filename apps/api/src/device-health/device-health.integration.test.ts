import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../testing/seeded-subjects";
import {
  assertAFirstAssetOffItsRtuIsNotLabelled,
  assertDropsOlderThanADayAreNotRecent,
  assertOrganizationBSeesNoneOfA,
  assertTheLocationAdminSeesOnlyItsRtus,
  assertTheThirtyDayHistory,
  assertTheWindowAndState,
  assertUnattributedIsTheGlobalAdmins,
  UNATTRIBUTED_FIXTURE_COUNT,
  type DeviceHealthFixtures,
} from "./device-health.integration.spec";
import { DeviceHealthService } from "./device-health.service";

/**
 * `F3.16` (plan A5) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle. The service reads
 * on `bms_fleet` (the gate's default connection, the pool `FLEET_DRIZZLE` is),
 * access control on `bms_auth`.
 *
 * Fixtures, every code carrying the run's `f316dh-<stamp>`: four RTUs (two in
 * a location inside `wc-admin`'s closure, one in another location of that
 * organization, one in `phe-admin`'s organization), one asset, the run's own
 * ingest host, `rtu_health` rows, hour buckets now, 48 h, 29 d and 31 d ago,
 * and two endpoint buckets. Cleanup is by the ids and keys created, never a
 * prefix sweep (`tests/integration-fixture-isolation`).
 */
const connectionString = requireIntegrationDb({
  item: "F3.16",
  label: "the device-health admin reads (scope, window, drops, history)",
  because:
    "the writable-location scope, the RTU window CTE, the 24 h and 30 day bucket ranges and the " +
    "global-admin-only unattributed drops are all SQL over real rows; a green run without a " +
    "database asserts none of them.",
});

describe.skipIf(!connectionString)("F3.16 — the device-health admin reads", () => {
  let observer: pg.Pool;
  let authPool: pg.Pool;
  let ctx: DeviceHealthFixtures;
  const stamp = randomUUID().slice(0, 8);
  const hostKey = `f316dh-${stamp}`;
  const rtuIds: string[] = [];
  const assetIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    observer = await openIntegrationPool(url, "F3.16");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F3.16");
    await primeSeededSubjects(observer);
    const fleetDb = createDb(observer);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");
    const locationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
    const organizationAdmin = jwtFor(SEEDED.organizationAdmin, "organization_admin");

    const closure = (await accessControl.writableLocationIds(locationAdmin)) ?? [];
    const { rows: mineRows } = await observer.query<{ id: string; organization_id: string; name: string }>(
      "SELECT id, organization_id, name FROM bms.locations WHERE id = ANY($1::uuid[]) ORDER BY created_at, code LIMIT 1",
      [closure],
    );
    const mine = mineRows[0];
    if (!mine) throw new Error(`F3.16: ${SEEDED.locationAdmin} has no writable location — run pnpm db:seed.`);
    const { rows: siblingRows } = await observer.query<{ id: string }>(
      "SELECT id FROM bms.locations WHERE organization_id = $1 AND NOT (id = ANY($2::uuid[])) ORDER BY created_at, code LIMIT 1",
      [mine.organization_id, closure],
    );
    const organizationB = (await accessControl.writableOrganizationIds(organizationAdmin)) ?? [];
    const { rows: foreignRows } = await observer.query<{ id: string; organization_id: string }>(
      "SELECT id, organization_id FROM bms.locations WHERE organization_id = ANY($1::uuid[]) AND organization_id <> $2 ORDER BY created_at, code LIMIT 1",
      [organizationB, mine.organization_id],
    );
    if (!siblingRows[0] || !foreignRows[0]) {
      throw new Error("F3.16: the seed lacks a sibling location or a second organization — run pnpm db:seed.");
    }

    const rtu = async (suffix: string, orgId: string, locId: string, interval: number | null): Promise<string> => {
      const code = `f316dh-${stamp}-${suffix}`;
      const { rows } = await observer.query<{ id: string }>(
        `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type, expected_interval_seconds)
         VALUES ($1, $2, $3, $3, 'mqtt', $4) RETURNING id`,
        [orgId, locId, code, interval],
      );
      rtuIds.push(rows[0]!.id);
      return rows[0]!.id;
    };
    const monitored = await rtu("a-monitored", mine.organization_id, mine.id, 60);
    const unmonitored = await rtu("a-unmonitored", mine.organization_id, mine.id, null);
    const sibling = await rtu("a-sibling", mine.organization_id, siblingRows[0].id, null);
    const foreign = await rtu("b-foreign", foreignRows[0].organization_id, foreignRows[0].id, null);

    const { rows: dom } = await observer.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY created_at, code LIMIT 1",
    );
    const assetCode = `f316dh-${stamp}-asset`;
    const { rows: assetRows } = await observer.query<{ id: string }>(
      `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, rtu_id, domain)
       VALUES ($1, $2, $2, 'F3.16 site', $3, $4, $5) RETURNING id`,
      [mine.organization_id, assetCode, mine.id, monitored, dom[0]!.code],
    );
    const assetId = assetRows[0]!.id;
    assetIds.push(assetId);

    await observer.query(
      `INSERT INTO bms.ingest_hosts (host_key, started_at, healthy_since, last_beat_at)
       VALUES ($1, now() - interval '1 hour', now() - interval '1 hour', now())`,
      [hostKey],
    );
    for (const [rtuId, orgId] of [
      [monitored, mine.organization_id],
      [sibling, mine.organization_id],
      [foreign, foreignRows[0].organization_id],
    ] as const) {
      await observer.query(
        `INSERT INTO bms.rtu_health (rtu_id, organization_id, host_key, monitored_since, last_seen_at, clock_skew_seconds, clock_skew_at)
         VALUES ($1, $2, $3, now() - interval '1 hour', now() - interval '10 seconds', 3, now())`,
        [rtuId, orgId, hostKey],
      );
    }
    const drop = async (rtuId: string, hoursAgo: number, reason: string, dropped: number): Promise<string> => {
      const { rows } = await observer.query<{ bucket_ms: number }>(
        `INSERT INTO bms.rtu_drop_hours (organization_id, rtu_id, bucket, reason, dropped, first_asset_id, first_point_key)
         VALUES ($1, $2, date_trunc('hour', now(), 'UTC') - make_interval(hours => $3), $4, $5, $6, 'temp_c')
         RETURNING (extract(epoch FROM bucket) * 1000)::float8 AS bucket_ms`,
        [mine.organization_id, rtuId, hoursAgo, reason, dropped, assetId],
      );
      return new Date(rows[0]!.bucket_ms).toISOString();
    };
    const recentBucket = await drop(monitored, 0, "outOfRange", 5);
    await drop(monitored, 48, "badQuality", 7);
    await drop(monitored, 29 * 24, "nonFinite", 2);
    await drop(monitored, 31 * 24, "nonFinite", 3);
    await drop(sibling, 0, "badQuality", 1);
    const endpointKey = `f316dh-${stamp}-ep`;
    for (const [hoursAgo, deviceKey, dropped] of [
      [0, "dev-recent", UNATTRIBUTED_FIXTURE_COUNT],
      [48, "dev-old", 4],
    ] as const) {
      await observer.query(
        `INSERT INTO bms.ingest_endpoint_drop_hours (host_key, endpoint_key, bucket, reason, dropped, first_device_key)
         VALUES ($1, $2, date_trunc('hour', now(), 'UTC') - make_interval(hours => $3), 'unknownDevice', $4, $5)`,
        [hostKey, endpointKey, hoursAgo, dropped, deviceKey],
      );
    }

    ctx = {
      svc: new DeviceHealthService(fleetDb, accessControl),
      globalAdmin,
      locationAdmin,
      organizationAdmin,
      locations: { mine: mine.id, sibling: siblingRows[0].id, foreign: foreignRows[0].id },
      rtus: { monitored, unmonitored, sibling, foreign },
      firstAsset: { id: assetId, code: assetCode, rtuName: `f316dh-${stamp}-a-monitored`, locationName: mine.name },
      recentBucket,
      endpointKey,
      refreshBeat: async () => {
        await observer.query("UPDATE bms.ingest_hosts SET last_beat_at = now() WHERE host_key = $1", [hostKey]);
        await observer.query(
          "UPDATE bms.rtu_health SET last_seen_at = now() - interval '10 seconds' WHERE rtu_id = $1",
          [monitored],
        );
      },
    };
  }, 60_000);

  afterAll(async () => {
    if (observer) {
      await observer.query("DELETE FROM bms.rtu_drop_hours WHERE rtu_id = ANY($1::uuid[])", [rtuIds]);
      await observer.query("DELETE FROM bms.rtu_health WHERE rtu_id = ANY($1::uuid[])", [rtuIds]);
      await observer.query("DELETE FROM bms.ingest_endpoint_drop_hours WHERE host_key = $1", [hostKey]);
      await observer.query("DELETE FROM bms.ingest_hosts WHERE host_key = $1", [hostKey]);
      await observer.query("DELETE FROM bms.assets WHERE id = ANY($1::uuid[])", [assetIds]);
      await observer.query("DELETE FROM bms.rtus WHERE id = ANY($1::uuid[])", [rtuIds]);
    }
    await Promise.all([observer?.end(), authPool?.end()]);
  }, 60_000);

  it("I1 a location admin lists only its closure's RTUs and gets 403 for a location outside it", async () => {
    await assertTheLocationAdminSeesOnlyItsRtus(ctx);
  });

  it("I2 organization B's admin sees none of organization A's RTUs", async () => {
    await assertOrganizationBSeesNoneOfA(ctx);
  });

  it("I3 windowSeconds equals windowSecondsFor and the state is judged against the run's host", async () => {
    await assertTheWindowAndState(ctx);
  });

  it("I4 drops older than 24 h are not in drops24h, and the first point is named", async () => {
    await assertDropsOlderThanADayAreNotRecent(ctx);
  });

  it("I4b a first asset no longer on the bucket's RTU keeps its id but loses its labels", async () => {
    await assertAFirstAssetOffItsRtuIsNotLabelled(ctx);
  });

  it("I5 unattributed drops reach the global admin only", async () => {
    await assertUnattributedIsTheGlobalAdmins(ctx);
  });

  it("I6 the drop history is 30 days, and 404 outside scope", async () => {
    await assertTheThirtyDayHistory(ctx, randomUUID());
  });
});
