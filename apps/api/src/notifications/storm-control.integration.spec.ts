import { loadEnabledChannelsByIds } from "./channel-reads";
import { ChannelsService } from "./channels.service";
import { buildDedupeKey } from "./dedupe-key";
import type {
  DeliveryResult,
  NotificationMessage,
  NotificationTransport,
} from "./notification-transport";
import { buildConfig } from "./notifications.config";
import { NotificationsService, type DispatchInput } from "./notifications.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Pool = {
  query: <R>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

type Deps = ConstructorParameters<typeof NotificationsService>;
type Db = Deps[0];

const CHANNEL_CODE = "f3-8-storm-control";
/** The one alarm row `F3.10`'s event proof attributes its deliveries to; found and removed by this text. */
const FIXTURE_ALARM_MESSAGE = "F3.10 storm-control event fixture";

/**
 * `F3.8` U6 — storm control against the real database.
 *
 * **The direction that matters is the negative one.** ADR 0041 decision 7
 * names re-evaluating every enabled rule against an unchanged plant as the
 * case that costs a client an inbox, and AGENTS.md §4.6 requires proving both
 * directions rather than only the happy one. So this attaches a channel to
 * **every** enabled rule in the seeded database, dispatches once per rule with
 * `raised: false`, and asserts the transport was never called.
 *
 * The rule count is read from the database rather than hard-coded: a test that
 * fails because somebody added a rule is a test people delete.
 *
 * `F3.10` U2 adds the event proof at the end: an escalation step and a cleared
 * message each send once per `(channel, organization, dedupe key)` against the
 * real `WHERE` of `hasRecordedDelivery`, which the unit spec's fake cannot see.
 *
 * Everything it writes, it removes.
 */
export async function runStormControlTests(pool: Pool, db: Db): Promise<void> {
  const sent: NotificationMessage[] = [];
  const transport: NotificationTransport = {
    kind: "webhook",
    send: (message): Promise<DeliveryResult> => {
      sent.push(message);
      return Promise.resolve({ status: "sent", error: null });
    },
  };

  // E7.1c: ChannelsService takes (fleetDb, tenantDb, crypto, accessControl).
  // This suite drives dispatch, which only ever reaches loadForRule — a plain
  // fleetDb join that never touches accessControl — so the fourth slot is an
  // unused stand-in, not a real gate.
  const channels = new ChannelsService(
    db,
    db,
    { decrypt: () => ({}) } as unknown as ConstructorParameters<typeof ChannelsService>[2],
    {} as unknown as ConstructorParameters<typeof ChannelsService>[3],
  );

  const service = new NotificationsService(
    db,
    channels,
    // The three transport slots take concrete classes; this suite is about the
    // service's own decisions, so one fake stands in for all three.
    transport as unknown as Deps[2], // stand-in, unused here
    transport as unknown as Deps[3], // email, unused here
    transport as unknown as Deps[4],
    buildConfig({ NOTIFY_RATE_LIMIT_PER_HOUR: "1000" }),
  );

  await cleanup(pool);

  const created = await pool.query<{ id: string }>(
    `INSERT INTO bms.notification_channels (code, name, kind, config)
     VALUES ($1, 'F3.8 storm control', 'webhook', '{"url":"https://hooks.example.com/x"}'::jsonb)
     RETURNING id`,
    [CHANNEL_CODE],
  );
  const channelId = created.rows[0]?.id;
  assert(channelId !== undefined, "the test channel was not created");

  try {
    // E7.1c: organization_id too — DispatchInput.organizationId is NOT NULL
    // (0048), and its only source for a dispatch is the rule's own org
    // (automationRules.organizationId has been NOT NULL since 0047).
    const rules = await pool.query<{ id: string; code: string; organization_id: string }>(
      `SELECT id, code, organization_id FROM bms.automation_rules WHERE enabled = true`,
    );
    assert(
      rules.rows.length > 0,
      "no enabled rules in the seeded database — this test would assert nothing",
    );

    // Attach the one channel to every enabled rule.
    await pool.query(
      `INSERT INTO bms.rule_notifications (rule_id, channel_id)
       SELECT id, $1 FROM bms.automation_rules WHERE enabled = true
       ON CONFLICT DO NOTHING`,
      [channelId],
    );

    // --- the negative direction ---------------------------------------------
    //
    // An unchanged plant: every condition still matches, but every alarm was
    // already open, so AlarmRaiser returned raised: false for all of them.
    for (const rule of rules.rows) {
      await service.dispatch({
        ruleId: rule.id,
        ruleCode: rule.code,
        organizationId: rule.organization_id,
        alarmId: null,
        severity: "warning",
        message: "unchanged",
        raised: false,
      });
    }

    assert(
      sent.length === 0,
      `re-evaluating ${rules.rows.length} rules against an unchanged plant sent ${sent.length} ` +
        "notifications — decision 7's storm control is not holding",
    );
    const deduped = await countDeliveries(pool, channelId as string, "skipped_deduped");
    assert(
      deduped === rules.rows.length,
      `every one of the ${rules.rows.length} refusals must be recorded; found ${deduped}`,
    );

    // --- `F3.46`: the second sweep records nothing new -----------------------
    //
    // The same unchanged plant, pressed again — byte-identical input, so every
    // dedupe key is the one the first sweep already wrote. The contract does
    // not move (one skipped_deduped result per joined channel, every time), but
    // the ledger must not grow: this is the only place the WHERE clause of
    // `hasRecordedSkip` is exercised against a real Postgres, where the fake in
    // the unit spec can see nothing of it.
    for (const rule of rules.rows) {
      const again = await service.dispatch({
        ruleId: rule.id,
        ruleCode: rule.code,
        organizationId: rule.organization_id,
        alarmId: null,
        severity: "warning",
        message: "unchanged",
        raised: false,
      });
      assert(
        again.filter((r) => r.status === "skipped_deduped").length === 1,
        `rule ${rule.code} must still report exactly one skipped_deduped result on the second ` +
          `sweep; got [${again.map((r) => r.status).join(",")}]`,
      );
    }

    assert(
      sent.length === 0,
      `a second sweep over the same unchanged plant sent ${sent.length} notifications`,
    );
    // This count is the whole claim. A read that failed and fell back to the
    // write (D2) records a second `skipped_deduped` row, not a `failed` one, so
    // a fallback on this sweep shows up here as `2 × rules` — there is no other
    // status to check for it.
    const dedupedAgain = await countDeliveries(pool, channelId as string, "skipped_deduped");
    assert(
      dedupedAgain === rules.rows.length,
      `a second sweep must add no rows: expected still ${rules.rows.length} skipped_deduped ` +
        `rows, found ${dedupedAgain} — the once-per-key suppression is not holding, or a ` +
        `ledger read failed and fell back to the write`,
    );

    // --- the positive direction ---------------------------------------------
    //
    // A test that only proves nothing is sent passes just as well when nothing
    // can ever be sent. One genuine transition must still get through.
    const first = rules.rows[0];
    assert(first !== undefined, "no rule to transition");
    await service.dispatch({
      ruleId: first.id,
      ruleCode: first.code,
      organizationId: first.organization_id,
      alarmId: null,
      severity: "critical",
      message: "a real transition",
      raised: true,
    });
    assert(sent.length === 1, `a genuine transition must send exactly once, got ${sent.length}`);
    assert(
      (await countDeliveries(pool, channelId as string, "sent")) === 1,
      "the send is recorded as sent",
    );

    // --- the ceiling ---------------------------------------------------------
    //
    // Counted over `sent` rows only: counting skips would let a noisy hour fill
    // the ceiling with its own refusals and lock the channel out.
    const limited = new NotificationsService(
      db,
      channels,
      transport as unknown as Deps[2],
      transport as unknown as Deps[3],
      transport as unknown as Deps[4],
      buildConfig({ NOTIFY_RATE_LIMIT_PER_HOUR: "1" }),
    );
    await limited.dispatch({
      ruleId: first.id,
      ruleCode: first.code,
      organizationId: first.organization_id,
      alarmId: null,
      severity: "critical",
      message: "one too many",
      raised: true,
    });
    assert(
      sent.length === 1,
      "the second send is over the ceiling of 1 and must not reach the transport",
    );
    assert(
      (await countDeliveries(pool, channelId as string, "skipped_rate_limited")) === 1,
      "the rate-limited attempt is recorded",
    );

    // --- `F3.10`: an event is sent once per (channel, organization, key) ----
    //
    // ADR 0057 decision 10. The sweep asks the ledger before it sends a step
    // or a cleared message, and the unit spec's fake answers that read from a
    // queue — so this is the only place `hasRecordedDelivery`'s WHERE (this
    // channel, this organization, this key, any status) meets a real Postgres.
    // The channel set comes through `loadEnabledChannelsByIds` and
    // `toChannelRow`, the way the sweep will build it, so that read's WHERE
    // is exercised here too.
    //
    // The alarm is a fixture with `rule_id` NULL: `alarms_open_per_rule_uidx`
    // is partial on `rule_id IS NOT NULL` under both its predicates (the
    // `0032` one and `0065`'s), so a rule-less row can never collide with an
    // alarm this database already holds for the rule's asset. The dedupe key
    // carries the rule id from the input, not from the alarm row, which is
    // what the sweep does as well (plan D12: the rule is the input's source).
    const alarmId = await insertFixtureAlarm(pool, first.id, first.organization_id);
    const stored = await loadEnabledChannelsByIds(db, [channelId as string]);
    assert(
      stored.length === 1 && stored[0]?.code === CHANNEL_CODE,
      `loadEnabledChannelsByIds must return the enabled suite channel, got ${stored.length}`,
    );
    assert(
      (await loadEnabledChannelsByIds(db, [])).length === 0,
      "an empty id list loads nothing",
    );
    const channel = channels.toChannelRow(stored[0] as (typeof stored)[number]);

    const step: DispatchInput = {
      ruleId: first.id,
      ruleCode: first.code,
      organizationId: first.organization_id,
      alarmId,
      severity: "warning",
      message: FIXTURE_ALARM_MESSAGE,
      raised: true,
      event: { kind: "escalation", step: 1 },
    };
    const sentBeforeStep = sent.length;
    const firstStep = await service.dispatchToChannels([channel], step);
    const secondStep = await service.dispatchToChannels([channel], step);
    assert(
      firstStep[0]?.status === "sent",
      `the first step sends, got ${String(firstStep[0]?.status)}`,
    );
    assert(
      secondStep[0]?.status === "skipped_deduped",
      `the same step on the next tick is answered from the ledger, got ${String(
        secondStep[0]?.status,
      )}`,
    );
    assert(
      sent.length === sentBeforeStep + 1,
      `two ticks of one step must reach the transport once, got ${sent.length - sentBeforeStep}`,
    );
    assert(
      (await countByKey(pool, channelId as string, buildDedupeKey(step))) === 1,
      "exactly one row holds the step's key — the second tick wrote nothing",
    );

    // Decision 9 / ruling Q5: the cleared message goes to whoever holds a
    // `sent` row for the alarm. The step above is that row.
    const recipients = await service.sentChannelIdsForAlarm(alarmId, first.organization_id);
    assert(
      recipients.length === 1 && recipients[0] === channelId,
      `the step's channel is the cleared recipient, got [${recipients.join(",")}]`,
    );

    const cleared: DispatchInput = { ...step, event: { kind: "cleared" } };
    const sentBeforeClear = sent.length;
    await service.dispatchToChannels([channel], cleared);
    const secondClear = await service.dispatchToChannels([channel], cleared);
    assert(
      secondClear[0]?.status === "skipped_deduped",
      `a second cleared message is answered from the ledger, got ${String(
        secondClear[0]?.status,
      )}`,
    );
    assert(
      sent.length === sentBeforeClear + 1,
      `two ticks of one clear must reach the transport once, got ${sent.length - sentBeforeClear}`,
    );
    assert(
      (await countByKey(pool, channelId as string, buildDedupeKey(cleared))) === 1,
      "exactly one row holds the cleared key",
    );
    assert(
      (await service.sentChannelIdsForAlarm(alarmId, first.organization_id)).length === 1,
      "two sent rows for one channel are still one recipient",
    );

    // The other direction of `loadEnabledChannelsByIds`: a disabled channel is
    // absent, not returned disabled.
    await pool.query(`UPDATE bms.notification_channels SET enabled = false WHERE id = $1`, [
      channelId,
    ]);
    try {
      assert(
        (await loadEnabledChannelsByIds(db, [channelId as string])).length === 0,
        "a disabled channel must not be loaded for a step",
      );
    } finally {
      await pool.query(`UPDATE bms.notification_channels SET enabled = true WHERE id = $1`, [
        channelId,
      ]);
    }
  } finally {
    await cleanup(pool);
  }
}

async function countDeliveries(pool: Pool, channelId: string, status: string): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM bms.notification_deliveries
      WHERE channel_id = $1 AND status = $2`,
    [channelId, status],
  );
  return Number(res.rows[0]?.count ?? "0");
}

async function countByKey(pool: Pool, channelId: string, dedupeKey: string): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM bms.notification_deliveries
      WHERE channel_id = $1 AND dedupe_key = $2`,
    [channelId, dedupeKey],
  );
  return Number(res.rows[0]?.count ?? "0");
}

/**
 * One open, rule-less alarm in the rule's organization, against the rule's
 * asset (or, for a rule with none, the organization's first asset), so that
 * `notification_deliveries.alarm_id` has a real row to reference. The pool is
 * the fleet role (`BYPASSRLS`), so no GUC is needed for the insert.
 */
async function insertFixtureAlarm(pool: Pool, ruleId: string, organizationId: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO bms.alarms (organization_id, asset_id, severity, message)
     VALUES (
       $1,
       COALESCE(
         (SELECT asset_id FROM bms.automation_rules WHERE id = $2),
         (SELECT id FROM bms.assets WHERE organization_id = $1 ORDER BY code LIMIT 1)
       ),
       'warning',
       $3
     )
     RETURNING id`,
    [organizationId, ruleId, FIXTURE_ALARM_MESSAGE],
  );
  const id = res.rows[0]?.id;
  assert(id !== undefined, "the fixture alarm was not created");
  return id as string;
}

/** Removes everything this suite writes, in foreign-key order. */
async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.notification_deliveries
      WHERE channel_id IN (SELECT id FROM bms.notification_channels WHERE code = $1)
         OR alarm_id IN (SELECT id FROM bms.alarms WHERE message = $2)`,
    [CHANNEL_CODE, FIXTURE_ALARM_MESSAGE],
  );
  await pool.query(`DELETE FROM bms.alarms WHERE message = $1`, [FIXTURE_ALARM_MESSAGE]);
  await pool.query(
    `DELETE FROM bms.rule_notifications
      WHERE channel_id IN (SELECT id FROM bms.notification_channels WHERE code = $1)`,
    [CHANNEL_CODE],
  );
  await pool.query(`DELETE FROM bms.notification_channels WHERE code = $1`, [CHANNEL_CODE]);
}
