import { randomUUID } from "node:crypto";

import { notificationChannels, ruleNotifications } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { buildDedupeKey } from "../notifications/dedupe-key";
import type { NotificationMessage } from "../notifications/notification-transport";
import { toDispatchInput } from "../rules/rule-actions";
import { createFixtureAssets, fixtureLocation } from "../testing/integration-fixtures";
import {
  type AlarmState,
  type Harness,
  SEVERITY,
  assert,
  buildHarness,
  deliveriesByKey,
  insertFixtureRule,
  insertFixtureSeverity,
  secondsAfter,
  stateOf,
  withRollback,
} from "./alarm-lifecycle.integration.spec";
import type { AlarmRaiseRule } from "./alarm-raise.service";

/**
 * The statuses under one channel's raise key, **sorted**, as one string.
 *
 * `deliveriesByKey` has no `ORDER BY` (`F3.51` review), and every row this
 * suite plants shares an `attempted_at` inside the transaction — the default is
 * `now()`, which in Postgres is the transaction's start instant — so no column
 * disambiguates them and the driver may hand back `sent,failed` as readily as
 * `failed,sent`. Comparing the unsorted join was a false-RED waiting to happen:
 * the claim each assertion makes is WHICH statuses the key holds, never in
 * which order they came back. Sorting states that, and it costs nothing —
 * `failed,sent` is already the sorted form of the pair every case expects.
 *
 * The message renders go through the same helper, so a genuine failure prints
 * the value that was actually compared.
 */
async function statusesUnderKey(db: BmsDb, channelId: string, dedupeKey: string): Promise<string> {
  return [...(await deliveriesByKey(db, channelId, dedupeKey))].sort().join(",");
}

/**
 * `F3.51` — the alarm lifecycle sweep's raise-retry phase against a real
 * database (ADR 0041 Amendment 5, ADR 0057 Amendment 5).
 *
 * `alarm-lifecycle-raise-retry.spec.ts` drives the phase over fakes; those
 * fakes apply no `WHERE`, hold no ledger and have no ceiling. Everything below
 * needs the real ones:
 *
 * - the `rule_notifications` join — `ChannelsService.loadForRule` on the raise
 *   path, `loadEnabledChannelsForRules` in the sweep since `F3.60`, and case
 *   CI4 asserts the two give the same list per rule — which is
 *   how the phase learns who the rule's channels are;
 * - the real `notification_deliveries` rows, written by the raise path itself,
 *   so "the retry lands under the ORIGINAL key" is a fact about the ledger
 *   rather than a string typed twice;
 * - `isOverHourlyLimit`, which counts `sent` rows over a trailing WALL-CLOCK
 *   hour — no injected `now` moves it, which is why I2 cannot be a unit test.
 *
 * A separate file from `alarm-lifecycle.integration.spec.ts` because that one
 * stood at 978 of AGENTS.md §4.5's 1000-line cap with these three scenarios in
 * it. It exports its harness and fixture helpers instead — the split
 * `cleared-refusal-rows.integration.spec.ts` and
 * `raise-attempts.integration.spec.ts` already make in this area — so the
 * isolation, the severity code and the transaction shape are shared, not
 * re-invented.
 *
 * **Never a bare `harness.sent.length`.** `loadActiveAlarms` is fleet-wide, so
 * another session's committed alarms are visible inside this transaction and
 * can be re-offered into the same array. Every count here is scoped to the
 * fixture's own alarm id and dedupe key.
 *
 * **Not gateable here, and this file says so rather than claiming it:** the
 * `PROCESS_STARTED_AT` half of the watermark. The constant is fixed once per
 * run, so no suite can move it (`F3.50` established this). It is covered on the
 * parameter by `raise-retry.spec.ts` P8/P9/P14 and on the wiring by the unit
 * phase spec's R5.
 */

/**
 * One fixture rule that really notifies, joined to `count` fresh channels
 * through `rule_notifications`.
 *
 * **Both halves are load-bearing, and each was mutated to prove it.**
 * The sweep's channel read — `loadEnabledChannelsForRules` since `F3.60`, and
 * `ChannelsService.loadForRule` before it — reads `rule_notifications ⋈
 * notification_channels`, and `insertFixtureRule` writes no such row — the
 * `F3.10` scenarios reach their channels through
 * `alarm_escalation_step_channels`, a different join. And
 * `automation_rules.action` defaults to `{}`, which `asAction` narrows to
 * `trace_only`, so a fixture rule notifies nobody unless the action is set and
 * the phase's `shouldNotify` gate drops it. Without either, this whole file
 * would pass against a phase that never ran.
 */
async function notifyingRuleWithChannels(
  tx: BmsDb,
  args: { assetId: string; organizationId: string; pointKey: string; count: number },
): Promise<{ rule: AlarmRaiseRule; channelIds: string[] }> {
  const rule = await insertFixtureRule(tx, {
    assetId: args.assetId,
    organizationId: args.organizationId,
    pointKey: args.pointKey,
    thresholdValue: 100,
    clearHoldSeconds: 30,
    action: { type: "notify", target: "Operations" },
  });
  const channelIds = await joinChannels(tx, rule.id, args.organizationId, args.count, 1);
  return { rule, channelIds };
}

/** Inserts `count` channels and joins them to the rule. `from` keeps the codes ordered across calls. */
async function joinChannels(
  tx: BmsDb,
  ruleId: string,
  organizationId: string,
  count: number,
  from: number,
): Promise<string[]> {
  const suffix = randomUUID().slice(0, 8);
  const rows = await tx
    .insert(notificationChannels)
    .values(
      Array.from({ length: count }, (_unused, index) => ({
        organizationId,
        // `loadForRule` orders by code, so index 0 is always the first channel.
        code: `f351-c${from + index}-${suffix}`,
        name: `F3.51 retry channel ${from + index}`,
        kind: "webhook",
        config: { url: "https://hooks.example.com/f351" },
      })),
    )
    .returning({ id: notificationChannels.id });
  assert(rows.length === count, `${count} fixture channels`);
  await tx.insert(ruleNotifications).values(rows.map((row) => ({ ruleId, channelId: row.id })));
  return rows.map((row) => row.id);
}

/**
 * Raises the alarm and dispatches its ORIGINAL raise through the real raise
 * path, so every row this file reads was written by the code that writes it in
 * production.
 */
async function raiseAndDispatch(
  harness: Harness,
  args: { assetId: string; organizationId: string; rule: AlarmRaiseRule; value: number },
): Promise<{ alarmId: string; message: string; dedupeKey: string }> {
  const result = await harness.raiser.raise(
    args.assetId,
    args.organizationId,
    args.rule,
    args.value,
  );
  assert(result.raised && result.alarmId !== null, "the fixture raise must succeed");
  const alarmId = result.alarmId as string;
  const input = toDispatchInput(
    { id: args.rule.id, code: args.rule.code, organizationId: args.organizationId, action: {} },
    result,
  );
  assert(input !== null, "the fixture rule has an organization, so it yields an input");
  const raiseInput = input as NonNullable<typeof input>;
  await harness.notifications.dispatch(raiseInput);
  const dedupeKey = buildDedupeKey(raiseInput);
  assert(
    dedupeKey === `${args.rule.id}:${alarmId}:${SEVERITY}`,
    `the raise key is rule:alarm:severity, got ${dedupeKey}`,
  );
  return { alarmId, message: result.message, dedupeKey };
}

/** The messages this alarm's dispatches reached the transport with — never every message in the tick. */
function sentFor(harness: Harness, alarmId: string): NotificationMessage[] {
  return harness.sent.filter((message) => message.alarmId === alarmId);
}

/**
 * I1 — an undelivered raise IS delivered by a later sweep, exactly once.
 *
 * The raise goes out through `NotificationsService.dispatch` with a transport
 * that throws, which leaves the one `failed` row this item exists to act on. A
 * later sweep re-offers it: one new row, `sent`, under the ORIGINAL dedupe key,
 * carrying the alarm's own message and the raise subject — no
 * `escalation`/`cleared` prefix, no age, no staleness marker (that complaint is
 * `F3.52`'s, and it is inherited).
 *
 * The second sweep's absence is a gate ONLY because the first sweep on the same
 * fixture proved the phase dispatches. On its own it would pass against a phase
 * that never ran at all.
 *
 * A third channel is joined to the rule AFTER the raise, and it is owner ruling
 * 3's evidence conjunct on real rows: it holds nothing under the key, so it
 * has never been offered the raise and the sweep must not offer it — the
 * same-tick double-send guard, seen from the operator action that produces it.
 */
export async function assertAFailedRaiseIsDeliveredByALaterSweepOnce(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await insertFixtureSeverity(tx);
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F310", loc);
    const pointKey = `f351_retry_${randomUUID().slice(0, 8)}`;
    const { rule, channelIds } = await notifyingRuleWithChannels(tx, {
      assetId,
      organizationId: loc.organizationId,
      pointKey,
      count: 1,
    });
    const [c1] = channelIds;
    assert(c1 !== undefined, "one fixture channel");

    // The raise, refused by the transport: one `failed` row and nothing else.
    const failing = buildHarness(tx, { sendSucceeds: () => false });
    const alarm = await raiseAndDispatch(failing, {
      assetId,
      organizationId: loc.organizationId,
      rule,
      value: 150,
    });
    assert(
      (await statusesUnderKey(tx, c1, alarm.dedupeKey)) === "failed",
      `the raise left one failed row under its key, got [${(await statusesUnderKey(tx, c1, alarm.dedupeKey))}]`,
    );

    // An operator joins a second channel after the fact. It holds no row under
    // the key, so ruling 3 says it is not owed the raise.
    const [late] = await joinChannels(tx, rule.id, loc.organizationId, 1, 9);
    assert(late !== undefined, "the late-joined channel");

    // No sample is inserted on purpose: with none, `matchedAgainstLatestSample`
    // returns `null` and the clear phase writes nothing (ADR 0027), so every
    // sweep below is the retry phase and nothing else.
    const [row] = await stateOf(tx, alarm.alarmId);
    const t0 = (row as AlarmState).raisedAt;

    const sending = buildHarness(tx);
    // `F3.57` review — 90 s, not 60. At exactly 60 000 ms the age sits ON the
    // whole-minute boundary, so one millisecond either way flips the clause and
    // the body assertion below would fail for a reason unrelated to what it
    // asserts. 90 s renders the same "1 min" with thirty seconds of slack on
    // both sides. The unit fixtures have that slack already (`alarmRow` raises
    // at `secondsBefore(61)`); this suite, which runs least often because it
    // needs a database, had none.
    await sending.lifecycle.sweep(secondsAfter(90, t0));
    assert(
      (await statusesUnderKey(tx, c1, alarm.dedupeKey)) === "failed,sent",
      `the sweep re-offered the raise and it sent, under the ORIGINAL key; got [${(await statusesUnderKey(tx, c1, alarm.dedupeKey))}]`,
    );
    assert(
      (await deliveriesByKey(tx, late, alarm.dedupeKey)).length === 0,
      `the channel with no evidence under the key is NOT offered the raise, got [${(await statusesUnderKey(tx, late, alarm.dedupeKey))}]`,
    );
    const delivered = sentFor(sending, alarm.alarmId);
    assert(delivered.length === 1, `one message for this alarm, got ${delivered.length}`);
    assert(
      delivered[0]?.subject === `${SEVERITY}: ${rule.code}`,
      `the RAISE subject, with no escalation or cleared prefix; got "${String(
        delivered[0]?.subject,
      )}"`,
    );
    // `F3.57` — the alarm's message with its age, and against a REAL database
    // this is the whole ruling in one place. The sweep above ran at
    // `secondsAfter(90, t0)` where `t0` is the alarm's own `raised_at`, so the
    // age floors to one whole minute with thirty seconds of slack either side.
    // (This comment said `secondsAfter(60, t0)` and called that "the boundary,
    // and deterministic" — the value the same review had already moved off,
    // for the reason given at the sweep call. A reader who trusted it would
    // have restored the millisecond boundary.)
    //
    // What makes this the strongest evidence in the row: the body differs from
    // the original raise's, and the two assertions ABOVE still found the
    // delivery under `alarm.dedupeKey`. Postgres matched the row on the key the
    // original attempt was written with, exactly as before. A second body text
    // under one key orphans nothing, because the ledger stores no body.
    assert(
      delivered[0]?.body === `${alarm.message} — alarm open for 1 min`,
      `the alarm's message with the age appended; got "${String(delivered[0]?.body)}"`,
    );

    // The `sent` row now blocks the key on this channel, so the next sweep
    // offers nothing — and this absence means something because the sweep
    // above, on this same fixture, dispatched.
    await sending.lifecycle.sweep(secondsAfter(120, t0));
    assert(
      (await statusesUnderKey(tx, c1, alarm.dedupeKey)) === "failed,sent",
      `a second sweep adds no row, got [${(await statusesUnderKey(tx, c1, alarm.dedupeKey))}]`,
    );
    assert(
      sentFor(sending, alarm.alarmId).length === 1,
      `and reaches the transport no second time, got ${sentFor(sending, alarm.alarmId).length}`,
    );

    tx.rollback();
  });
}

/**
 * I2 — the hourly ceiling does not burn the retry (`F3.48`'s finding, on the
 * raise path).
 *
 * This is the claim no unit test can make: `isOverHourlyLimit` counts `sent`
 * rows over a trailing WALL-CLOCK hour, which no injected `now` moves, while
 * the sweep ticks every 30 s. Before `reoffered`, three refused ticks wrote
 * three `skipped_rate_limited` rows inside ninety seconds — unbounded ledger
 * growth for a channel held permanently over a misconfigured ceiling, and the
 * exact shape `F3.48` measured on the escalation path.
 *
 * The gate is the ROW COUNT under the key, and that is a correction to this
 * item's plan, which also predicted "the final sweep sends nothing" under the
 * mutation. It would still send: `channelsOwedTheRaise` excludes
 * `skipped_rate_limited` rows from the eligible set (`F3.48` ruling Q2), so
 * three of them neither block the key nor spend the cap. What they do is grow
 * the ledger, and the count is what sees it — measured, with the mutation
 * applied: `[failed, skipped_rate_limited, skipped_rate_limited,
 * skipped_rate_limited]`.
 */
export async function assertTheCeilingDoesNotBurnTheRetry(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await insertFixtureSeverity(tx);
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F310", loc);
    const pointKey = `f351_ceiling_${randomUUID().slice(0, 8)}`;
    const { rule, channelIds } = await notifyingRuleWithChannels(tx, {
      assetId,
      organizationId: loc.organizationId,
      pointKey,
      count: 1,
    });
    const [c1] = channelIds;
    assert(c1 !== undefined, "one fixture channel");

    const failing = buildHarness(tx, { sendSucceeds: () => false });
    const alarm = await raiseAndDispatch(failing, {
      assetId,
      organizationId: loc.organizationId,
      rule,
      value: 150,
    });
    const [row] = await stateOf(tx, alarm.alarmId);
    const t0 = (row as AlarmState).raisedAt;

    // No escalation profile is configured for this severity, so the refusing
    // harness refuses this phase and no other: the counts below are the retry's.
    const refusing = buildHarness(tx, { ratePerHour: 0 });
    await refusing.lifecycle.sweep(secondsAfter(30, t0));
    await refusing.lifecycle.sweep(secondsAfter(60, t0));
    await refusing.lifecycle.sweep(secondsAfter(90, t0));
    assert(
      (await statusesUnderKey(tx, c1, alarm.dedupeKey)) === "failed",
      `three ceiling-refused ticks write NO row — still just the original failure; got [${(await statusesUnderKey(tx, c1, alarm.dedupeKey))}]`,
    );
    assert(
      sentFor(refusing, alarm.alarmId).length === 0,
      "and nothing reached the transport while the ceiling was over",
    );

    // The paired positive, on the same transaction and the same rows: the key
    // was never blocked, so a harness under a workable ceiling still delivers.
    const sending = buildHarness(tx);
    await sending.lifecycle.sweep(secondsAfter(120, t0));
    assert(
      (await statusesUnderKey(tx, c1, alarm.dedupeKey)) === "failed,sent",
      `once the ceiling lifts the retry lands, got [${(await statusesUnderKey(tx, c1, alarm.dedupeKey))}]`,
    );
    assert(sentFor(sending, alarm.alarmId).length === 1, "exactly once");

    tx.rollback();
  });
}

/**
 * I3 — a raise that WAS delivered is never re-offered, and the channel that was
 * not is (owner ruling 2's `sent` arm, over a real ledger).
 *
 * One dispatch, two channels, one transport that sends to the first and throws
 * for the second. The absence on c1 is paired, in the same transaction and the
 * same sweep, with the delivery on c2.
 */
export async function assertASentRaiseIsNeverReoffered(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await insertFixtureSeverity(tx);
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F310", loc);
    const pointKey = `f351_sent_${randomUUID().slice(0, 8)}`;
    const { rule, channelIds } = await notifyingRuleWithChannels(tx, {
      assetId,
      organizationId: loc.organizationId,
      pointKey,
      count: 2,
    });
    const [c1, c2] = channelIds;
    assert(c1 !== undefined && c2 !== undefined, "two fixture channels");

    const half = buildHarness(tx, { sendSucceeds: (message) => message.channel.id === c1 });
    const alarm = await raiseAndDispatch(half, {
      assetId,
      organizationId: loc.organizationId,
      rule,
      value: 150,
    });
    assert(
      (await statusesUnderKey(tx, c1, alarm.dedupeKey)) === "sent" &&
        (await statusesUnderKey(tx, c2, alarm.dedupeKey)) === "failed",
      "the raise landed on the first channel and failed on the second",
    );
    const [row] = await stateOf(tx, alarm.alarmId);
    const t0 = (row as AlarmState).raisedAt;

    const sending = buildHarness(tx);
    await sending.lifecycle.sweep(secondsAfter(60, t0));
    assert(
      (await statusesUnderKey(tx, c2, alarm.dedupeKey)) === "failed,sent",
      `the channel that was owed IS re-offered and sent, got [${(await statusesUnderKey(tx, c2, alarm.dedupeKey))}]`,
    );
    assert(
      (await statusesUnderKey(tx, c1, alarm.dedupeKey)) === "sent",
      `and the channel that already holds a sent row gets no second row, got [${(await statusesUnderKey(tx, c1, alarm.dedupeKey))}]`,
    );

    await sending.lifecycle.sweep(secondsAfter(120, t0));
    assert(
      (await deliveriesByKey(tx, c1, alarm.dedupeKey)).length === 1 &&
        (await deliveriesByKey(tx, c2, alarm.dedupeKey)).length === 2,
      "and a second sweep changes neither channel: both keys are now answered",
    );
    assert(
      sentFor(sending, alarm.alarmId).length === 1,
      `one retry send in total across both sweeps, got ${sentFor(sending, alarm.alarmId).length}`,
    );

    tx.rollback();
  });
}
