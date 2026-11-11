import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import { deviceHealthResponseSchema, rtuDropHistoryResponseSchema } from "@bms/shared";
import type { DeviceHealthResponse, JwtPayload } from "@bms/shared";

import { windowSecondsFor } from "../telemetry/telemetry-cadence";
import type { DeviceHealthService } from "./device-health.service";

/**
 * `F3.16` / ADR 0127 decisions 3, 11, 14 and 17 (plan A5) — the device-health
 * reads against a real Postgres, on the real roles (the wrapper builds them):
 * the service on `bms_fleet`, access control on `bms_auth`. Every row is a
 * fixture the wrapper made and deletes by id; the ingest host is the run's own
 * `f316-<stamp>`, so no other host row the database holds decides a state.
 */
export type DeviceHealthFixtures = {
  svc: DeviceHealthService;
  globalAdmin: JwtPayload;
  /** `wc-admin@bms.local`: a location admin in organization A. */
  locationAdmin: JwtPayload;
  /** `phe-admin@bms.local`: the organization admin of organization B. */
  organizationAdmin: JwtPayload;
  /** A location inside the location admin's closure, one of A outside it, one of B. */
  locations: { mine: string; sibling: string; foreign: string };
  rtus: {
    /** In `mine`, `expected_interval_seconds = 60`, monitored, heard 10 s ago, with drops. */
    monitored: string;
    /** In `mine`, no interval and no `rtu_health` row. */
    unmonitored: string;
    /** Organization A, outside the location admin's closure. */
    sibling: string;
    /** Organization B. */
    foreign: string;
  };
  firstAsset: { id: string; code: string; rtuName: string; locationName: string };
  /** The ISO hour of the monitored RTU's `outOfRange` bucket (the current hour at setup). */
  recentBucket: string;
  endpointKey: string;
  /** Re-beats the run's host and re-hears the monitored RTU now, so a slow suite never reads them stale. */
  refreshBeat: () => Promise<void>;
};

async function settle(run: Promise<unknown>): Promise<unknown> {
  try {
    return await run;
  } catch (err) {
    return err;
  }
}

const ids = (body: DeviceHealthResponse): string[] => body.items.map((item) => item.rtuId);

/** I1 — a location admin lists only its closure's RTUs and gets 403 for a location outside it. */
export async function assertTheLocationAdminSeesOnlyItsRtus(ctx: DeviceHealthFixtures): Promise<void> {
  const listed = ids(await ctx.svc.list(ctx.locationAdmin));
  expect(listed).toEqual(expect.arrayContaining([ctx.rtus.monitored, ctx.rtus.unmonitored]));
  expect(listed).not.toContain(ctx.rtus.sibling);
  expect(listed).not.toContain(ctx.rtus.foreign);

  const byLocation = ids(await ctx.svc.list(ctx.locationAdmin, ctx.locations.mine));
  expect(byLocation).toEqual(expect.arrayContaining([ctx.rtus.monitored, ctx.rtus.unmonitored]));
  for (const locationId of [ctx.locations.sibling, ctx.locations.foreign]) {
    expect(await settle(ctx.svc.list(ctx.locationAdmin, locationId))).toBeInstanceOf(ForbiddenException);
  }
}

/** I2 — organization B's admin sees its own RTU and none of organization A's. */
export async function assertOrganizationBSeesNoneOfA(ctx: DeviceHealthFixtures): Promise<void> {
  const listed = ids(await ctx.svc.list(ctx.organizationAdmin));
  expect(listed).toContain(ctx.rtus.foreign);
  for (const id of [ctx.rtus.monitored, ctx.rtus.unmonitored, ctx.rtus.sibling]) {
    expect(listed).not.toContain(id);
  }
}

/** I3 — the window is `windowSecondsFor` of the RTU's interval; the state is judged against the run's host. */
export async function assertTheWindowAndState(ctx: DeviceHealthFixtures): Promise<void> {
  await ctx.refreshBeat();
  const body = deviceHealthResponseSchema.parse(await ctx.svc.list(ctx.locationAdmin, ctx.locations.mine));
  const monitored = body.items.find((item) => item.rtuId === ctx.rtus.monitored);
  const unmonitored = body.items.find((item) => item.rtuId === ctx.rtus.unmonitored);
  expect(monitored).toMatchObject({
    state: "online",
    windowSeconds: windowSecondsFor(60),
    clockSkewSeconds: 3,
    edgeServed: false,
  });
  expect(monitored?.lastSeenAt).toEqual(expect.stringMatching(/^\d{4}-\d\d-\d\dT/));
  expect(unmonitored).toMatchObject({
    state: "not_monitored",
    windowSeconds: windowSecondsFor(null),
    lastSeenAt: null,
    clockSkewSeconds: null,
    drops24h: [],
  });
  expect(body.ingestHost.state).toBe("ok");
}

/** I4 — `drops24h` holds the buckets of the last 24 h only, with the first point named for `assetLabel`. */
export async function assertDropsOlderThanADayAreNotRecent(ctx: DeviceHealthFixtures): Promise<void> {
  const body = await ctx.svc.list(ctx.locationAdmin, ctx.locations.mine);
  const monitored = body.items.find((item) => item.rtuId === ctx.rtus.monitored);
  expect(monitored?.drops24h).toEqual([
    {
      reason: "outOfRange",
      count: 5,
      firstAt: ctx.recentBucket,
      first: {
        assetId: ctx.firstAsset.id,
        assetCode: ctx.firstAsset.code,
        assetRtuName: ctx.firstAsset.rtuName,
        assetLocationName: ctx.firstAsset.locationName,
        pointKey: "temp_c",
        sourceKey: null,
      },
    },
  ]);
}

/**
 * I4b (security review L1) — a stored first asset that is no longer on the bucket's RTU (moved,
 * or named on another RTU) keeps its id but loses its code, RTU and location labels, so a
 * location admin is never shown another location's names. The sibling RTU's bucket names the
 * monitored RTU's asset.
 */
export async function assertAFirstAssetOffItsRtuIsNotLabelled(ctx: DeviceHealthFixtures): Promise<void> {
  const body = await ctx.svc.list(ctx.globalAdmin);
  const sibling = body.items.find((item) => item.rtuId === ctx.rtus.sibling);
  expect(sibling?.drops24h[0]?.first).toEqual({
    assetId: ctx.firstAsset.id,
    assetCode: null,
    assetRtuName: null,
    assetLocationName: null,
    pointKey: "temp_c",
    sourceKey: null,
  });
}

/**
 * The fixture's recent unattributed count: large enough to rank first under the reader's
 * `ORDER BY total DESC LIMIT 200`, so a busy database cannot push the row out.
 */
export const UNATTRIBUTED_FIXTURE_COUNT = 1_000_000_000_000;

/** I5 — `unattributed` reaches the global admin only, and only the last 24 h of it. */
export async function assertUnattributedIsTheGlobalAdmins(ctx: DeviceHealthFixtures): Promise<void> {
  const global = deviceHealthResponseSchema.parse(await ctx.svc.list(ctx.globalAdmin));
  const mine = global.unattributed.filter((row) => row.endpointKey === ctx.endpointKey);
  expect(mine).toEqual([
    {
      hostKey: expect.any(String),
      endpointKey: ctx.endpointKey,
      reason: "unknownDevice",
      count: UNATTRIBUTED_FIXTURE_COUNT,
      firstDeviceKey: "dev-recent",
      firstSourceKey: null,
    },
  ]);
  for (const jwt of [ctx.locationAdmin, ctx.organizationAdmin]) {
    expect((await ctx.svc.list(jwt)).unattributed).toEqual([]);
  }
}

/** I6 — the drop history is 30 days of hour buckets, newest first; an RTU outside scope or unknown is 404. */
export async function assertTheThirtyDayHistory(ctx: DeviceHealthFixtures, unknownRtuId: string): Promise<void> {
  const body = rtuDropHistoryResponseSchema.parse(await ctx.svc.dropHistory(ctx.locationAdmin, ctx.rtus.monitored));
  expect(body.items.map((item) => [item.reason, item.count])).toEqual([
    ["outOfRange", 5],
    ["badQuality", 7],
    ["nonFinite", 2],
  ]);
  const buckets = body.items.map((item) => Date.parse(item.bucket));
  expect(buckets.every((ms) => ms % 3_600_000 === 0)).toBe(true);
  for (const rtuId of [ctx.rtus.sibling, ctx.rtus.foreign, unknownRtuId]) {
    expect(await settle(ctx.svc.dropHistory(ctx.locationAdmin, rtuId))).toBeInstanceOf(NotFoundException);
  }
}
