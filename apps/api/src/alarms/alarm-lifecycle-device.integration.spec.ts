import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import {
  alarmEscalationDefaults,
  alarmEscalationProfiles,
  alarmEscalationStepChannels,
  alarmEscalationSteps,
  alarmSeverities,
  notificationChannels,
  notificationDeliveries,
} from "@bms/db";
import type { BmsDb } from "@bms/db";

import { fixtureLocation } from "../testing/integration-fixtures";
import {
  assert,
  buildHarness,
  deliveriesByKey,
  insertFixtureSeverity,
  secondsAfter,
  SEVERITY,
  stateOf,
  withRollback,
} from "./alarm-lifecycle.integration.spec";

/**
 * `F3.16` (plan B4, ADR 0127 decisions 6, 13, 16) — the lifecycle sweep over a
 * device alarm against a real database: the `source <> 'rule'` selection, the
 * monitored-RTU and host reads, the hold on `normal_since`, the left-joined
 * read-back that broadcasts a cleared alarm with no asset, and the ledger
 * inside `dispatchToChannels` answering a device step under its `system` key.
 *
 * `alarm-lifecycle.integration.spec.ts`'s harness and isolation: one
 * transaction ended with `tx.rollback()`, so `now()` is the transaction's start
 * for every statement and every stamp is reproducible. The fixture severity is
 * that file's own code (no seeded alarm carries it), and a second code with no
 * profile carries the "no profile, no message" case.
 */

/** A second fixture severity, mapped to no profile anywhere. */
const UNMAPPED_SEVERITY = "f316_unmapped";

async function nowOf(tx: BmsDb): Promise<Date> {
  const result = await tx.execute<{ now_ms: number }>(sql`SELECT (extract(epoch FROM now()) * 1000)::float8 AS now_ms`);
  return new Date(Number(result.rows[0]?.now_ms));
}

export async function assertADeviceAlarmEscalatesOnceAndClearsAfterTheHold(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await insertFixtureSeverity(tx);
    await tx
      .insert(alarmSeverities)
      .values({ code: UNMAPPED_SEVERITY, label: "F3.16 unmapped", tone: "warning", rank: 28 })
      .onConflictDoNothing();
    const loc = await fixtureLocation(tx);
    const suffix = randomUUID().slice(0, 8);
    const hostKey = `f316lc-${suffix}`;

    const rtuResult = await tx.execute<{ id: string }>(sql`
      INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type, expected_interval_seconds)
      VALUES (${loc.organizationId}, ${loc.locationId}, ${`f316lc-${suffix}`}, ${`f316lc-${suffix}`}, 'mqtt', 10)
      RETURNING id`);
    const rtuId = rtuResult.rows[0]!.id;
    await tx.execute(sql`
      INSERT INTO bms.ingest_hosts (host_key, started_at, healthy_since, last_beat_at)
      VALUES (${hostKey}, now() - interval '1 hour', now() - interval '1 hour', now())`);
    await tx.execute(sql`
      INSERT INTO bms.rtu_health (rtu_id, organization_id, host_key, monitored_since, last_seen_at)
      VALUES (${rtuId}, ${loc.organizationId}, ${hostKey}, now() - interval '1 hour', now() - interval '10 minutes')`);

    const [channel] = await tx
      .insert(notificationChannels)
      .values({
        organizationId: loc.organizationId,
        code: `f316-c1-${suffix}`,
        name: "F3.16 step channel",
        kind: "webhook",
        config: { url: "https://hooks.example.com/f316" },
      })
      .returning({ id: notificationChannels.id });
    const [profile] = await tx
      .insert(alarmEscalationProfiles)
      .values({ organizationId: loc.organizationId, code: `f316-p1-${suffix}`, name: "F3.16 profile" })
      .returning({ id: alarmEscalationProfiles.id });
    assert(channel !== undefined && profile !== undefined, "the fixture channel and profile");
    const [step] = await tx
      .insert(alarmEscalationSteps)
      .values({ profileId: profile.id, stepNo: 1, afterMinutes: 1 })
      .returning({ id: alarmEscalationSteps.id });
    await tx.insert(alarmEscalationStepChannels).values({ stepId: step!.id, channelId: channel.id });
    await tx
      .insert(alarmEscalationDefaults)
      .values({ organizationId: loc.organizationId, severity: SEVERITY, profileId: profile.id });

    const harness = buildHarness(tx);
    const comms = await harness.raiser.raiseDevice({
      organizationId: loc.organizationId,
      source: "rtu_comms",
      rtuId,
      severity: SEVERITY,
      message: `Communication lost: f316lc-${suffix}`,
    });
    const hostAlarm = await harness.raiser.raiseDevice({
      organizationId: loc.organizationId,
      source: "ingest_host",
      severity: UNMAPPED_SEVERITY,
      message: "Ingest host not reporting",
    });
    assert(comms.raised && comms.alarmId !== null, "the rtu_comms raise succeeds");
    assert(hostAlarm.raised && hostAlarm.alarmId !== null, "the ingest_host raise succeeds (no other open one in the organization)");
    const alarmId = comms.alarmId as string;
    const t0 = (await stateOf(tx, alarmId))[0]!.raisedAt;
    const stepKey = `system:${alarmId}:${SEVERITY}:escalation:1`;

    // Step 1 at 1 min: one `sent` row under the system key; the next tick is answered from the ledger.
    await harness.lifecycle.sweep(secondsAfter(61, t0));
    await harness.lifecycle.sweep(secondsAfter(91, t0));
    const stepRows = await deliveriesByKey(tx, channel.id, stepKey);
    assert(stepRows.join(",") === "sent", `one sent row under ${stepKey} across two ticks, got [${stepRows.join(",")}]`);
    assert(harness.sent.length === 1, `the transport was handed step 1 once, got ${harness.sent.length}`);
    const [ruleIdOfRow] = await tx
      .select({ ruleId: notificationDeliveries.ruleId })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.dedupeKey, stepKey));
    assert(ruleIdOfRow?.ruleId === null, `the step's delivery row carries no rule, got ${String(ruleIdOfRow?.ruleId)}`);

    // No profile for the host alarm's severity: nothing is sent for it, however long it is open.
    const hostRows = await tx
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.alarmId, hostAlarm.alarmId as string));
    assert(hostRows.length === 0, `no delivery for an alarm with no profile, got ${hostRows.length}`);

    // The RTU is heard again, but the host stops beating: the alarm stays open and no hold starts.
    const now = await nowOf(tx);
    await tx.execute(sql`UPDATE bms.rtu_health SET last_seen_at = now() WHERE rtu_id = ${rtuId}`);
    await tx.execute(sql`UPDATE bms.ingest_hosts SET last_beat_at = now() - interval '31 seconds' WHERE host_key = ${hostKey}`);
    const t1 = secondsAfter(120, t0);
    await harness.lifecycle.sweep(t1);
    let [state] = await stateOf(tx, alarmId);
    assert(
      state?.normalSince === null && state.clearedAt === null,
      `a stale host keeps the RTU alarm open with no hold, got ${JSON.stringify(state)}`,
    );

    // The host beats again: the hold starts at the tick, 119 s in nothing, at 120 s the alarm clears.
    await tx.execute(sql`UPDATE bms.ingest_hosts SET last_beat_at = now() WHERE host_key = ${hostKey}`);
    const t2 = secondsAfter(150, t0);
    await harness.lifecycle.sweep(t2);
    await harness.lifecycle.sweep(secondsAfter(119, t2));
    [state] = await stateOf(tx, alarmId);
    assert(
      state?.normalSince?.getTime() === t2.getTime() && state.clearedAt === null,
      `the hold started at ${t2.toISOString()} and is still running, got ${JSON.stringify(state)} (db now ${now.toISOString()})`,
    );
    const t3 = secondsAfter(120, t2);
    await harness.lifecycle.sweep(t3);
    [state] = await stateOf(tx, alarmId);
    assert(state?.clearedAt?.getTime() === t3.getTime(), `cleared at the hold, got ${JSON.stringify(state)}`);
    assert(
      harness.clearedBroadcasts.includes(alarmId),
      `the cleared device alarm is read back (no asset) and broadcast, got [${harness.clearedBroadcasts.join(",")}]`,
    );
    const clearedRows = await deliveriesByKey(tx, channel.id, `system:${alarmId}:${SEVERITY}:cleared`);
    assert(clearedRows.join(",") === "sent", `the cleared message reached the step's channel, got [${clearedRows.join(",")}]`);

    tx.rollback();
  });
}
