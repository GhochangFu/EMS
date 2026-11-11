import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import type { DashboardService } from "../dashboard/dashboard.service";
import type { AlarmDetailsService } from "./alarm-details.service";
import type { AlarmEnrichmentService } from "./alarm-enrichment.service";
import { AlarmsController } from "./alarms.controller";
import type { AlarmsService } from "./alarms.service";

/**
 * `F3.16` (plan B5, ADR 0127 decision 14) — who sees a device alarm, against
 * real `bms_tenant`/`bms_fleet` roles. Committed fixtures (this run's prefix):
 *
 * - org A: RTU `a1` **monitored** with asset `aOn1`; RTU `a2` not monitored
 *   with asset `aOn2`; asset `aOff` on no RTU. An open `rtu_comms` alarm on
 *   each RTU (`a1` critical tone, `a2` warning tone) and a cleared
 *   `ingest_host` alarm (cleared, so it never meets a real open host alarm on
 *   `alarms_open_per_device_uidx`).
 * - org B: RTU `b1` monitored with asset `bOn1`, an open `rtu_comms` alarm and
 *   a cleared `ingest_host` alarm.
 *
 * A "user" is its readable asset ids, as `AccessControlService.readableAssetIds`
 * hands them to the service; `null` is the global admin.
 */
export type DeviceScopeFixtures = {
  svc: AlarmsService;
  details: AlarmDetailsService;
  dashboard: DashboardService;
  ownerPool: pg.Pool;
  fleetDb: BmsDb;
  aOn1: string;
  aOn2: string;
  aOff: string;
  bOn1: string;
  a1Code: string;
  alarmA1: string;
  alarmA2: string;
  hostA: string;
  alarmB1: string;
  hostB: string;
};

const NOT_FOUND = /not found|outside your access scope/i;

async function idsFor(ctx: DeviceScopeFixtures, assetIds: string[] | null): Promise<string[]> {
  const page = await ctx.svc.list({ limit: 100, assetIds });
  return page.items.map((i) => i.id);
}

function allFixtureAlarms(ctx: DeviceScopeFixtures): string[] {
  return [ctx.alarmA1, ctx.alarmA2, ctx.hostA, ctx.alarmB1, ctx.hostB];
}

/** An asset-group user sees an RTU's alarm only when an asset in its scope is on that RTU. */
export async function assertRtuAlarmVisibleOnlyThroughAnAssetOnTheRtu(ctx: DeviceScopeFixtures): Promise<void> {
  const onA1 = await idsFor(ctx, [ctx.aOn1]);
  expect(onA1, "an asset on a1 shows a1's comms alarm").toContain(ctx.alarmA1);
  expect(onA1, "an asset on a1 does not show a2's").not.toContain(ctx.alarmA2);

  const onA2 = await idsFor(ctx, [ctx.aOn2]);
  expect(onA2, "an asset on a2 shows a2's comms alarm").toContain(ctx.alarmA2);
  expect(onA2).not.toContain(ctx.alarmA1);

  const off = await idsFor(ctx, [ctx.aOff]);
  expect(off.filter((id) => allFixtureAlarms(ctx).includes(id)), "an asset on no RTU shows no device alarm").toEqual([]);

  const item = (await ctx.svc.list({ limit: 100, assetIds: [ctx.aOn1] })).items.find((i) => i.id === ctx.alarmA1);
  expect(item, "the list item of a device alarm").toMatchObject({
    source: "rtu_comms",
    assetId: null,
    assetCode: null,
    rtuCode: ctx.a1Code,
  });
}

/** The host alarm: any asset of the scope on a monitored RTU of that organization. */
export async function assertHostAlarmFollowsMonitoredRtus(ctx: DeviceScopeFixtures): Promise<void> {
  expect(await idsFor(ctx, [ctx.aOn1]), "an asset on the monitored a1 shows org A's host alarm").toContain(ctx.hostA);
  expect(await idsFor(ctx, [ctx.aOn2]), "an asset only on the unmonitored a2 does not").not.toContain(ctx.hostA);
  expect(await idsFor(ctx, [ctx.aOff]), "an asset on no RTU does not").not.toContain(ctx.hostA);
}

/** Organization B never sees A's device alarms — on the tenant path or the fleet path. */
export async function assertOrganizationBNeverSeesA(ctx: DeviceScopeFixtures): Promise<void> {
  const b = await idsFor(ctx, [ctx.bOn1]);
  expect(b).toEqual(expect.arrayContaining([ctx.alarmB1, ctx.hostB]));
  for (const id of [ctx.alarmA1, ctx.alarmA2, ctx.hostA]) {
    expect(b, "org B's user never sees an org A device alarm").not.toContain(id);
  }
  const a = await idsFor(ctx, [ctx.aOn1, ctx.aOn2]);
  expect(a).not.toContain(ctx.alarmB1);
  expect(a).not.toContain(ctx.hostB);

  // Two organizations: the fleet path, where the predicate is the only isolation control.
  const both = await idsFor(ctx, [ctx.aOn1, ctx.bOn1]);
  expect(both).toEqual(expect.arrayContaining([ctx.alarmA1, ctx.hostA, ctx.alarmB1, ctx.hostB]));
  expect(both, "a2 is served by no asset of the two-organization scope").not.toContain(ctx.alarmA2);

  const admin = await ctx.svc.list({ limit: 100, assetIds: null });
  // The admin's page is the newest 100 of the fleet; the fixtures are this run's newest rows.
  expect(admin.items.map((i) => i.id), "the global admin sees every device alarm").toEqual(
    expect.arrayContaining(allFixtureAlarms(ctx)),
  );
}

/** The summary total equals the active list's length for one scope. */
export async function assertSummaryAgreesWithTheList(ctx: DeviceScopeFixtures): Promise<void> {
  for (const scope of [[ctx.aOn1], [ctx.aOn1, ctx.aOn2], [ctx.aOn1, ctx.bOn1], [ctx.aOff]]) {
    const listed = await ctx.svc.list({ limit: 100, assetIds: scope, state: "active" });
    const summary = await ctx.svc.activeCountsBySeverity(scope);
    expect(summary.total, `summary total for ${scope.length} asset(s)`).toBe(listed.items.length);
  }
  const twoOnA = await ctx.svc.activeCountsBySeverity([ctx.aOn1, ctx.aOn2]);
  expect(twoOnA.total, "both open comms alarms of org A, and no cleared host alarm").toBe(2);
}

/** The dashboard ribbon counts the same open alarms as the summary. */
export async function assertDashboardCountsAgree(ctx: DeviceScopeFixtures): Promise<void> {
  for (const scope of [[ctx.aOn1], [ctx.aOn1, ctx.aOn2], [ctx.bOn1], [ctx.aOff]]) {
    const summary = await ctx.svc.activeCountsBySeverity(scope);
    const kpis = await ctx.dashboard.kpis(scope);
    expect(kpis.alarmsOpen, `alarmsOpen for ${scope.length} asset(s) equals the summary`).toBe(summary.total);
    const critical = summary.items.filter((i) => i.tone === "critical").reduce((s, i) => s + i.count, 0);
    expect(kpis.alarmsCritical, "alarmsCritical equals the summary's critical-tone counts").toBe(critical);
  }
  expect((await ctx.dashboard.kpis([ctx.aOn1])).alarmsCritical, "a1's comms alarm is the critical one").toBe(1);
}

/** Details: in scope a device alarm reads with no asset; outside scope a clean 404. */
export async function assertDetailsFollowTheScope(ctx: DeviceScopeFixtures): Promise<void> {
  const details = await ctx.details.get(ctx.alarmA1, [ctx.aOn1]);
  expect(details).toMatchObject({
    id: ctx.alarmA1,
    source: "rtu_comms",
    rtuCode: ctx.a1Code,
    assetId: null,
    assetCode: null,
    enrichment: null,
    classPhilosophy: null,
    currentValue: null,
  });
  await expect(ctx.details.get(ctx.alarmA1, [ctx.aOff])).rejects.toBeInstanceOf(NotFoundException);
  await expect(ctx.details.get(ctx.alarmA1, [ctx.bOn1])).rejects.toBeInstanceOf(NotFoundException);
  expect((await ctx.details.get(ctx.hostA, [ctx.aOn1])).source).toBe("ingest_host");
  await expect(ctx.details.get(ctx.hostA, [ctx.aOn2])).rejects.toBeInstanceOf(NotFoundException);
  expect((await ctx.details.get(ctx.alarmB1, null)).source, "the global admin reads any").toBe("rtu_comms");
}

async function acknowledgedAt(pool: pg.Pool, id: string): Promise<Date | null> {
  const { rows } = await pool.query<{ acknowledged_at: Date | null }>(
    "SELECT acknowledged_at FROM bms.alarms WHERE id = $1",
    [id],
  );
  return rows[0]?.acknowledged_at ?? null;
}

function controllerFor(
  ctx: DeviceScopeFixtures,
  readable: string[] | null,
  writeRole: () => Promise<void>,
): AlarmsController {
  return new AlarmsController(
    ctx.svc,
    {
      readableAssetIds: async () => readable,
      assertOperationsWriteRole: writeRole,
    } as unknown as AccessControlService,
    {} as unknown as AlarmDetailsService,
    {} as unknown as AlarmEnrichmentService,
  );
}

/**
 * Acknowledging a device alarm keeps the operations-role gate and 404s outside
 * scope; inside scope it acknowledges and returns the device item.
 */
export async function assertAcknowledgeKeepsTheGateAndTheScope(
  ctx: DeviceScopeFixtures,
  user: JwtPayload,
): Promise<void> {
  const refuse = async () => {
    throw new ForbiddenException("operations role required");
  };
  const allow = async () => undefined;
  const body = { reason: "F3.16 device alarm acknowledged" };

  await expect(controllerFor(ctx, [ctx.aOn2], refuse).acknowledge(ctx.alarmA2, body, user)).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  expect(await acknowledgedAt(ctx.ownerPool, ctx.alarmA2), "the role gate wrote nothing").toBeNull();

  for (const outside of [[ctx.aOn1], [ctx.aOff], [ctx.bOn1]]) {
    await expect(controllerFor(ctx, outside, allow).acknowledge(ctx.alarmA2, body, user)).rejects.toThrow(NOT_FOUND);
  }
  expect(await acknowledgedAt(ctx.ownerPool, ctx.alarmA2), "out of scope wrote nothing").toBeNull();

  const acked = await controllerFor(ctx, [ctx.aOn2], allow).acknowledge(ctx.alarmA2, body, user);
  expect(acked).toMatchObject({ id: ctx.alarmA2, source: "rtu_comms", assetId: null });
  expect(acked.acknowledgedAt).not.toBeNull();
  expect(await acknowledgedAt(ctx.ownerPool, ctx.alarmA2)).not.toBeNull();
}
