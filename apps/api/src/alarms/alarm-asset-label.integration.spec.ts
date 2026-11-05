import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { expect } from "vitest";

import { alarmAffectedAssets, alarmEnrichments, alarms, alarmSeverities, assets, locations, pointValues, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { createFixtureAssets, fixtureLocation } from "../testing/integration-fixtures";
import { AlarmDetailsService } from "./alarm-details.service";
import {
  buildHarness,
  insertFixtureRule,
  insertFixtureSeverity,
  secondsAfter,
  stateOf,
  withRollback,
} from "./alarm-lifecycle.integration.spec";
import { readAlarmListItem } from "./alarm-list-item";
import { AlarmStatsService } from "./alarm-stats.service";

/**
 * `F4.316` PR 2 (ADR 0111) — every alarm producer names the asset's RTU and
 * location: `assetRtuName` from `bms.rtus.display_name` over `assets.rtu_id`,
 * `assetLocationName` from `bms.locations.name` over `assets.location_id`.
 *
 * Two fixture assets on one seeded location: `withRtu` points at a fresh RTU,
 * `withoutRtu` has `rtu_id IS NULL` (ADR 0018) — the twin every claim stands
 * beside, so a LEFT JOIN that became an inner one (the twin vanishes) or a
 * select that lost its join (drizzle names a table the FROM never joined) both
 * fail here. Each claim runs inside one rolled-back transaction on the fleet
 * handle (`alarm-lifecycle.integration.spec.ts`'s isolation), so nothing is
 * left behind — the acknowledge's audit row included.
 *
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ACTOR = { sub: "00000000-0000-4000-8000-00000000f316", email: "f4.316-label@bms.local" };

export type LabelFixture = {
  readonly organizationId: string;
  readonly locationName: string;
  readonly rtuName: string;
  readonly withRtu: string;
  readonly withoutRtu: string;
};

async function buildFixture(tx: BmsDb): Promise<LabelFixture> {
  const loc = await fixtureLocation(tx);
  const [location] = await tx.select({ name: locations.name }).from(locations).where(eq(locations.id, loc.locationId));
  const [withRtu, withoutRtu] = await createFixtureAssets(tx, 2, "F4316", loc);
  const rtuName = `F4.316 RTU ${randomUUID().slice(0, 8)}`;
  const [rtu] = await tx
    .insert(rtus)
    .values({
      organizationId: loc.organizationId,
      locationId: loc.locationId,
      code: `F4316-${randomUUID().slice(0, 8)}`,
      displayName: rtuName,
    })
    .returning({ id: rtus.id });
  await tx.update(assets).set({ rtuId: rtu!.id }).where(eq(assets.id, withRtu!));
  return { organizationId: loc.organizationId, locationName: location!.name, rtuName, withRtu: withRtu!, withoutRtu: withoutRtu! };
}

async function insertAlarm(tx: BmsDb, fx: LabelFixture, assetId: string, raisedAt = new Date()): Promise<string> {
  const [severity] = await tx.select({ code: alarmSeverities.code }).from(alarmSeverities).limit(1);
  const [row] = await tx
    .insert(alarms)
    .values({ organizationId: fx.organizationId, assetId, severity: severity!.code, message: "F4.316 label", raisedAt })
    .returning({ id: alarms.id });
  return row!.id;
}

/** What the RTU-bearing asset's row must carry. */
const withRtuParts = (fx: LabelFixture) => ({ assetRtuName: fx.rtuName, assetLocationName: fx.locationName });
/** The twin: no RTU, so `assetRtuName` is null and the location still names it. */
const withoutRtuParts = (fx: LabelFixture) => ({ assetRtuName: null, assetLocationName: fx.locationName });

type Claim = (tx: BmsDb, fx: LabelFixture) => Promise<void>;

/** Runs one claim on a fresh fixture inside a transaction that is rolled back. */
export async function inRollback(db: BmsDb, claim: Claim): Promise<void> {
  await withRollback(db, async (tx) => {
    const fx = await buildFixture(tx);
    await claim(tx, fx);
    tx.rollback();
  });
}

function partsOf(item: { assetRtuName: string | null; assetLocationName: string | null } | undefined) {
  return item === undefined ? undefined : { assetRtuName: item.assetRtuName, assetLocationName: item.assetLocationName };
}

/** `GET /alarms` (`AlarmsService.list`): the RTU-bearing asset's row names its RTU and location. */
export const assertTheListNamesTheRtu: Claim = async (tx, fx) => {
  const id = await insertAlarm(tx, fx, fx.withRtu);
  const page = await buildHarness(tx).alarmsService.list({ limit: 10, assetIds: [fx.withRtu], state: "all" });
  expect(partsOf(page.items.find((item) => item.id === id))).toEqual(withRtuParts(fx));
};

/** The list's twin: an RTU-less asset keeps its alarm, with `assetRtuName: null`. */
export const assertTheListKeepsAnRtuLessAsset: Claim = async (tx, fx) => {
  const id = await insertAlarm(tx, fx, fx.withoutRtu);
  const page = await buildHarness(tx).alarmsService.list({ limit: 10, assetIds: [fx.withoutRtu], state: "all" });
  expect(partsOf(page.items.find((item) => item.id === id))).toEqual(withoutRtuParts(fx));
};

/** `POST /alarms/:id/ack` returns (and broadcasts) the item with both parts. */
export const assertTheAcknowledgedItemNamesTheRtu: Claim = async (tx, fx) => {
  const id = await insertAlarm(tx, fx, fx.withRtu);
  const item = await buildHarness(tx).alarmsService.acknowledge(id, ACTOR, "F4.316 label", [fx.withRtu]);
  expect(partsOf(item)).toEqual(withRtuParts(fx));
};

/** `readAlarmListItem` (the `created` socket event's read): the twin's parts. */
export const assertTheCreatedEventReadKeepsAnRtuLessAsset: Claim = async (tx, fx) => {
  const id = await insertAlarm(tx, fx, fx.withoutRtu);
  expect(partsOf((await readAlarmListItem(tx, id)) ?? undefined)).toEqual(withoutRtuParts(fx));
};

/** `GET /alarms/:id/details` names the RTU; the twin's details name the location only. */
export const assertTheDetailsNameTheRtu: Claim = async (tx, fx) => {
  const details = new AlarmDetailsService(tx);
  const id = await insertAlarm(tx, fx, fx.withRtu);
  expect(partsOf(await details.get(id, [fx.withRtu]))).toEqual(withRtuParts(fx));
};

export const assertTheDetailsKeepAnRtuLessAsset: Claim = async (tx, fx) => {
  const details = new AlarmDetailsService(tx);
  const id = await insertAlarm(tx, fx, fx.withoutRtu);
  expect(partsOf(await details.get(id, [fx.withoutRtu]))).toEqual(withoutRtuParts(fx));
};

/** The details' affected assets carry each asset's own parts — one with an RTU, one without. */
export const assertTheAffectedAssetsNameTheirRtus: Claim = async (tx, fx) => {
  const id = await insertAlarm(tx, fx, fx.withRtu);
  const [enrichment] = await tx
    .insert(alarmEnrichments)
    .values({ organizationId: fx.organizationId, alarmId: id })
    .returning({ id: alarmEnrichments.id });
  await tx.insert(alarmAffectedAssets).values([
    { enrichmentId: enrichment!.id, assetId: fx.withRtu },
    { enrichmentId: enrichment!.id, assetId: fx.withoutRtu },
  ]);
  const details = await new AlarmDetailsService(tx).get(id, [fx.withRtu, fx.withoutRtu]);
  const affected = details.enrichment?.affectedAssets ?? [];
  expect({
    withRtu: partsOf(affected.find((a) => a.assetId === fx.withRtu)),
    withoutRtu: partsOf(affected.find((a) => a.assetId === fx.withoutRtu)),
  }).toEqual({ withRtu: withRtuParts(fx), withoutRtu: withoutRtuParts(fx) });
};

/** `get_alarm_stats`' `topAssets` (raw SQL GROUP BY): both assets rank, each with its own parts. */
export const assertTheTopAssetsNameTheirRtus: Claim = async (tx, fx) => {
  const raisedAt = new Date("2026-03-01T12:00:00.000Z");
  await insertAlarm(tx, fx, fx.withRtu, raisedAt);
  await insertAlarm(tx, fx, fx.withoutRtu, raisedAt);
  const stats = await new AlarmStatsService(tx, tx).range(
    [fx.withRtu, fx.withoutRtu],
    new Date("2026-03-01T00:00:00.000Z"),
    new Date("2026-03-02T00:00:00.000Z"),
  );
  expect({
    withRtu: partsOf(stats.topAssets.find((a) => a.assetId === fx.withRtu)),
    withoutRtu: partsOf(stats.topAssets.find((a) => a.assetId === fx.withoutRtu)),
  }).toEqual({ withRtu: withRtuParts(fx), withoutRtu: withoutRtuParts(fx) });
};

/** The lifecycle sweep's `cleared` broadcast payload carries both parts. */
export const assertTheClearedBroadcastNamesTheRtu: Claim = async (tx, fx) => {
  await insertFixtureSeverity(tx);
  const pointKey = `f4316_label_${randomUUID().slice(0, 8)}`;
  const rule = await insertFixtureRule(tx, {
    assetId: fx.withRtu,
    organizationId: fx.organizationId,
    pointKey,
    thresholdValue: 100,
    clearHoldSeconds: 30,
  });
  const harness = buildHarness(tx);
  const raised = await harness.raiser.raise(fx.withRtu, fx.organizationId, rule, 150);
  const [state] = await stateOf(tx, raised.alarmId as string);
  const t1 = secondsAfter(10, state!.raisedAt);
  await tx.insert(pointValues).values({ time: t1, assetId: fx.withRtu, pointKey, value: 50, unit: "kW" });
  await harness.lifecycle.sweep(t1);
  await harness.lifecycle.sweep(secondsAfter(30, t1));
  expect(partsOf(harness.clearedAlarms.find((alarm) => alarm.id === raised.alarmId))).toEqual(withRtuParts(fx));
};
