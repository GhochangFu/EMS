import { ChannelsService } from "./channels.service";
import type {
  DeliveryResult,
  NotificationMessage,
  NotificationTransport,
} from "./notification-transport";
import { buildConfig } from "./notifications.config";
import { NotificationsService } from "./notifications.service";

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

  const channels = new ChannelsService(db, {
    decrypt: () => ({}),
  } as unknown as ConstructorParameters<typeof ChannelsService>[1]);

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
    const rules = await pool.query<{ id: string; code: string }>(
      `SELECT id, code FROM bms.automation_rules WHERE enabled = true`,
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

    // --- the positive direction ---------------------------------------------
    //
    // A test that only proves nothing is sent passes just as well when nothing
    // can ever be sent. One genuine transition must still get through.
    const first = rules.rows[0];
    assert(first !== undefined, "no rule to transition");
    await service.dispatch({
      ruleId: first.id,
      ruleCode: first.code,
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

/** Removes everything this suite writes, in foreign-key order. */
async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.notification_deliveries
      WHERE channel_id IN (SELECT id FROM bms.notification_channels WHERE code = $1)`,
    [CHANNEL_CODE],
  );
  await pool.query(
    `DELETE FROM bms.rule_notifications
      WHERE channel_id IN (SELECT id FROM bms.notification_channels WHERE code = $1)`,
    [CHANNEL_CODE],
  );
  await pool.query(`DELETE FROM bms.notification_channels WHERE code = $1`, [CHANNEL_CODE]);
}
