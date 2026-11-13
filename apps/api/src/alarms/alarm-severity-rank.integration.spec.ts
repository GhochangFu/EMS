import { randomUUID } from "node:crypto";

import { asc, desc, eq } from "drizzle-orm";
import { expect } from "vitest";

import { alarms, alarmSeverities, locations, maintenanceWindows, pointValues, rtus, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AlarmListItem } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import type { LabelFixture } from "./alarm-asset-label.integration.spec";
import { buildHarness, insertFixtureRule, insertFixtureSeverity, secondsAfter, stateOf } from "./alarm-lifecycle.integration.spec";
import { readAlarmListItem } from "./alarm-list-item";
import type { AlarmsGateway } from "./alarms.gateway";
import { AlarmsService } from "./alarms.service";

/**
 * `F4.357` U1 (ADR 0130 decision 17, plan Q2) — every `AlarmListItem` producer
 * carries `severityRank`, the `bms.alarm_severities` rank of the alarm's
 * severity, and `locationName`, the alarm's own location.
 *
 * One claim per producer — `AlarmsService.list`, the `acknowledge` return and
 * its `broadcastAcknowledged` argument, `readAlarmListItem` (the `created`
 * event) and the lifecycle sweep's `cleared` payload. The rank claims use two
 * alarms of **different** ranks, so a constant cannot pass. The location claims
 * stand on the three sources: a rule alarm's `locationName` is its asset's
 * location, an `rtu_comms` alarm's is its RTU's (no asset, so a projection that
 * read only the asset's location would answer `null`), an `ingest_host`
 * alarm's is `null`.
 *
 * Each claim runs inside `alarm-asset-label.integration.spec.ts`'s rolled-back
 * fixture (`inRollback`), so nothing is left behind. Vitest entry point: the
 * sibling `.test.ts` (ADR 0014).
 */

const ACTOR = { sub: "00000000-0000-4000-8000-00000000f357", email: "f4.357-rank@bms.local" };

type Claim = (tx: BmsDb, fx: LabelFixture) => Promise<void>;

/** The stored rank of one severity code — the value every producer must carry. */
async function rankOf(tx: BmsDb, code: string): Promise<number> {
  const [row] = await tx.select({ rank: alarmSeverities.rank }).from(alarmSeverities).where(eq(alarmSeverities.code, code));
  if (!row) throw new Error(`severity ${code} has no row`);
  return row.rank;
}

/** Two seeded severities of different ranks, highest first. */
async function twoRanks(tx: BmsDb): Promise<readonly [string, string]> {
  const rows = await tx.select({ code: alarmSeverities.code }).from(alarmSeverities).orderBy(desc(alarmSeverities.rank)).limit(2);
  if (rows.length < 2) throw new Error("need two alarm_severities rows — run pnpm db:seed");
  return [rows[0]!.code, rows[1]!.code];
}

async function insertRuleAlarm(tx: BmsDb, fx: LabelFixture, severity: string): Promise<string> {
  const [row] = await tx
    .insert(alarms)
    .values({ organizationId: fx.organizationId, assetId: fx.withRtu, severity, message: "F4.357 rank" })
    .returning({ id: alarms.id });
  return row!.id;
}

/** `[{ rank, expected }]` for each item, so one `toEqual` names both alarms. */
async function ranksOf(tx: BmsDb, items: readonly (AlarmListItem | null | undefined)[]) {
  return Promise.all(
    items.map(async (item) => ({ carried: item?.severityRank, stored: item ? await rankOf(tx, item.severity) : "missing" })),
  );
}

function expectStoredRanks(pairs: readonly { carried: number | undefined; stored: number | string }[]): void {
  for (const pair of pairs) expect(pair.carried).toBe(pair.stored);
  expect(new Set(pairs.map((pair) => pair.carried)).size, "the two alarms carry different ranks").toBe(pairs.length);
}

/** `GET /alarms` (`AlarmsService.list`). */
export const assertTheListCarriesTheRank: Claim = async (tx, fx) => {
  const [high, low] = await twoRanks(tx);
  const ids = [await insertRuleAlarm(tx, fx, high), await insertRuleAlarm(tx, fx, low)];
  const page = await buildHarness(tx).alarmsService.list({ limit: 10, assetIds: [fx.withRtu], state: "all" });
  expectStoredRanks(await ranksOf(tx, ids.map((id) => page.items.find((item) => item.id === id))));
};

/** `POST /alarms/:id/ack`: the returned item and the `acknowledged` broadcast's argument. */
export const assertTheAcknowledgeCarriesTheRank: Claim = async (tx, fx) => {
  const [high, low] = await twoRanks(tx);
  const broadcast: AlarmListItem[] = [];
  const gateway = { broadcastAcknowledged: (item: AlarmListItem) => broadcast.push(item) } as unknown as AlarmsGateway;
  const svc = new AlarmsService(tx, tx, gateway, new MasterDataAuditService(tx, tx));
  const returned: AlarmListItem[] = [];
  for (const severity of [high, low]) {
    returned.push(await svc.acknowledge(await insertRuleAlarm(tx, fx, severity), ACTOR, "F4.357 rank", [fx.withRtu]));
  }
  expectStoredRanks(await ranksOf(tx, returned));
  expectStoredRanks(await ranksOf(tx, broadcast));
};

/** `readAlarmListItem` — the `created` socket event's read. */
export const assertTheCreatedEventReadCarriesTheRank: Claim = async (tx, fx) => {
  const [high, low] = await twoRanks(tx);
  const items = [await readAlarmListItem(tx, await insertRuleAlarm(tx, fx, high)), await readAlarmListItem(tx, await insertRuleAlarm(tx, fx, low))];
  expectStoredRanks(await ranksOf(tx, items));
};

/** The lifecycle sweep's `cleared` broadcast payload (the fixture severity, rank 27). */
export const assertTheClearedBroadcastCarriesTheRank: Claim = async (tx, fx) => {
  await insertFixtureSeverity(tx);
  const pointKey = `f4357_rank_${randomUUID().slice(0, 8)}`;
  const rule = await insertFixtureRule(tx, { assetId: fx.withRtu, organizationId: fx.organizationId, pointKey, thresholdValue: 100, clearHoldSeconds: 30 });
  const harness = buildHarness(tx);
  const raised = await harness.raiser.raise(fx.withRtu, fx.organizationId, rule, 150);
  const [state] = await stateOf(tx, raised.alarmId as string);
  const t1 = secondsAfter(10, state!.raisedAt);
  await tx.insert(pointValues).values({ time: t1, assetId: fx.withRtu, pointKey, value: 50, unit: "kW" });
  await harness.lifecycle.sweep(t1);
  await harness.lifecycle.sweep(secondsAfter(30, t1));
  const cleared = harness.clearedAlarms.find((alarm) => alarm.id === raised.alarmId);
  expect(cleared, "the sweep broadcast the cleared alarm").toBeDefined();
  expect(cleared!.severityRank).toBe(await rankOf(tx, cleared!.severity));
  expect(cleared!.locationName).toBe(fx.locationName);
};

/**
 * Plan Q2 — the alarm's own location on each source. The RTU sits on a second
 * location, so the `rtu_comms` row's name cannot come from the fixture asset.
 */
export const assertEachSourceNamesItsOwnLocation: Claim = async (tx, fx) => {
  const [severity] = await twoRanks(tx);
  const [rtuLocation] = await tx
    .insert(locations)
    .values({
      organizationId: fx.organizationId,
      code: `F4357-${randomUUID().slice(0, 8)}`,
      slug: `f4357-${randomUUID().slice(0, 8)}`,
      name: `F4.357 RTU room ${randomUUID().slice(0, 8)}`,
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
    })
    .returning({ id: locations.id, name: locations.name });
  const [rtu] = await tx
    .insert(rtus)
    .values({ organizationId: fx.organizationId, locationId: rtuLocation!.id, code: `F4357-${randomUUID().slice(0, 8)}`, displayName: "F4.357 RTU" })
    .returning({ id: rtus.id });
  const rule = await insertRuleAlarm(tx, fx, severity);
  const [comms] = await tx
    .insert(alarms)
    .values({ organizationId: fx.organizationId, source: "rtu_comms", rtuId: rtu!.id, severity, message: "F4.357 comms" })
    .returning({ id: alarms.id });
  // Cleared, so it never meets the one open host alarm an organization may hold.
  const [host] = await tx
    .insert(alarms)
    .values({ organizationId: fx.organizationId, source: "ingest_host", severity, message: "F4.357 host", clearedAt: new Date() })
    .returning({ id: alarms.id });
  const ruleItem = await readAlarmListItem(tx, rule);
  expect({
    rule: ruleItem?.locationName,
    ruleMatchesAsset: ruleItem?.locationName === ruleItem?.assetLocationName,
    comms: (await readAlarmListItem(tx, comms!.id))?.locationName,
    host: (await readAlarmListItem(tx, host!.id))?.locationName,
  }).toEqual({ rule: fx.locationName, ruleMatchesAsset: true, comms: rtuLocation!.name, host: null });
};

/**
 * `F4.359` U4 (ADR 0131 decision 19) — a stamped alarm reads `suppressed: true`
 * and its window id from each producer; an unstamped neighbour reads false/null.
 */
async function insertWindow(tx: BmsDb, fx: LabelFixture): Promise<string> {
  const [user] = await tx.select({ id: users.id }).from(users).orderBy(asc(users.createdAt), asc(users.id)).limit(1);
  if (!user) throw new Error("need a users row — run pnpm db:seed");
  const [row] = await tx
    .insert(maintenanceWindows)
    .values({
      organizationId: fx.organizationId,
      reason: "F4.359 suppression read",
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
      createdBy: user.id,
    })
    .returning({ id: maintenanceWindows.id });
  return row!.id;
}

async function stamp(tx: BmsDb, alarmId: string, windowId: string): Promise<void> {
  await tx.update(alarms).set({ suppressedAt: new Date(), suppressedByWindowId: windowId }).where(eq(alarms.id, alarmId));
}

function suppressionOf(item: AlarmListItem | null | undefined) {
  return { suppressed: item?.suppressed, maintenanceWindowId: item?.maintenanceWindowId, unsuppressedAt: item?.unsuppressedAt };
}

/** `GET /alarms` carries `suppressed`, `maintenanceWindowId` and `unsuppressedAt` for a stamped and an unstamped alarm. */
export const assertTheListCarriesSuppression: Claim = async (tx, fx) => {
  const [severity] = await twoRanks(tx);
  const windowId = await insertWindow(tx, fx);
  const stamped = await insertRuleAlarm(tx, fx, severity);
  const plain = await insertRuleAlarm(tx, fx, severity);
  await stamp(tx, stamped, windowId);
  const page = await buildHarness(tx).alarmsService.list({ limit: 10, assetIds: [fx.withRtu], state: "all" });
  expect(suppressionOf(page.items.find((item) => item.id === stamped))).toEqual({ suppressed: true, maintenanceWindowId: windowId, unsuppressedAt: null });
  expect(suppressionOf(page.items.find((item) => item.id === plain))).toEqual({ suppressed: false, maintenanceWindowId: null, unsuppressedAt: null });
};

/** `POST /alarms/:id/ack`: the returned item and the `acknowledged` broadcast carry the suppression fields. */
export const assertTheAcknowledgeCarriesSuppression: Claim = async (tx, fx) => {
  const [severity] = await twoRanks(tx);
  const windowId = await insertWindow(tx, fx);
  const id = await insertRuleAlarm(tx, fx, severity);
  await stamp(tx, id, windowId);
  const broadcast: AlarmListItem[] = [];
  const gateway = { broadcastAcknowledged: (item: AlarmListItem) => broadcast.push(item) } as unknown as AlarmsGateway;
  const svc = new AlarmsService(tx, tx, gateway, new MasterDataAuditService(tx, tx));
  const returned = await svc.acknowledge(id, ACTOR, "F4.359 suppression", [fx.withRtu]);
  const expected = { suppressed: true, maintenanceWindowId: windowId, unsuppressedAt: null };
  expect(suppressionOf(returned)).toEqual(expected);
  expect(suppressionOf(broadcast[0])).toEqual(expected);
};

/** `readAlarmListItem` (the `created` socket event's read) carries a lifted stamp's suppression fields. */
export const assertTheCreatedEventReadCarriesSuppression: Claim = async (tx, fx) => {
  const [severity] = await twoRanks(tx);
  const windowId = await insertWindow(tx, fx);
  const id = await insertRuleAlarm(tx, fx, severity);
  await stamp(tx, id, windowId);
  const lifted = new Date("2026-11-13T01:00:00.000Z");
  await tx.update(alarms).set({ unsuppressedAt: lifted }).where(eq(alarms.id, id));
  expect(suppressionOf(await readAlarmListItem(tx, id))).toEqual({
    suppressed: true,
    maintenanceWindowId: windowId,
    unsuppressedAt: lifted.toISOString(),
  });
};

/** The lifecycle sweep's `cleared` broadcast payload carries the suppression fields. */
export const assertTheClearedBroadcastCarriesSuppression: Claim = async (tx, fx) => {
  await insertFixtureSeverity(tx);
  const pointKey = `f4359_supp_${randomUUID().slice(0, 8)}`;
  const rule = await insertFixtureRule(tx, { assetId: fx.withRtu, organizationId: fx.organizationId, pointKey, thresholdValue: 100, clearHoldSeconds: 30 });
  const harness = buildHarness(tx);
  const raised = await harness.raiser.raise(fx.withRtu, fx.organizationId, rule, 150);
  const windowId = await insertWindow(tx, fx);
  await stamp(tx, raised.alarmId as string, windowId);
  const [state] = await stateOf(tx, raised.alarmId as string);
  const t1 = secondsAfter(10, state!.raisedAt);
  await tx.insert(pointValues).values({ time: t1, assetId: fx.withRtu, pointKey, value: 50, unit: "kW" });
  await harness.lifecycle.sweep(t1);
  await harness.lifecycle.sweep(secondsAfter(30, t1));
  const cleared = harness.clearedAlarms.find((alarm) => alarm.id === raised.alarmId);
  expect(cleared, "the sweep broadcast the cleared alarm").toBeDefined();
  expect(suppressionOf(cleared)).toEqual({ suppressed: true, maintenanceWindowId: windowId, unsuppressedAt: null });
};
