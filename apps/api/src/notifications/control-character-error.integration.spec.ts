import type { BmsDb } from "@bms/db";

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

/**
 * `F3.51` second review (Medium) — a control character in a transport's failure
 * text cannot cost a ledger row.
 *
 * **The chain, and every link of it is reachable from outside.**
 * `webhook.transport.ts`'s `readBounded` normalises the response excerpt with
 * `.replace(/\s+/g, " ").trim()`, and neither `\s` nor `trim()` touches
 * `U+0000`; `record()` stores that text in `notification_deliveries.error`,
 * which is `text`; Postgres refuses `0x00` in a text value. The insert
 * therefore throws, `record()` catches it (ADR 0041 decision 1) and reports
 * `rowLost`, and the sweep's memory spends one of
 * `LOST_LEDGER_ROW_CAP`'s 1000 slots — **on demand**, from the body of a
 * response an operator's own webhook endpoint returns. Past the cap `add`
 * refuses, the pair is never filtered, and it is re-offered on every tick for
 * the life of the alarm, dispatched sequentially.
 *
 * The fix is one line at the one choke point: the error string is stripped of
 * control characters where it is RECORDED, so no transport can reach the
 * column with one. This suite is the gate on that.
 *
 * **It has to be an integration suite.** The claim is about what Postgres
 * accepts in a `text` parameter. A fake insert accepts anything, so a green
 * unit run would prove only that a string was passed along. The premise was
 * measured here first, on the unfixed code against the real database, and the
 * insert threw: `invalid byte sequence for encoding "UTF8": 0x00` (SQLSTATE
 * `22021`, character_not_in_repertoire), so `record()` caught it and returned
 * `rowLost: true` — the exact loss the review predicted.
 *
 * **The paired positive.** An ordinary failure text — no control characters —
 * is stored byte for byte in the same block, so a "fix" that stripped or
 * mangled everything would redden here rather than pass. An absence assertion
 * alone ("the insert did not throw") passes when nothing is inserted at all.
 */

type Pool = {
  query: <R>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

type Deps = ConstructorParameters<typeof NotificationsService>;

const CHANNEL_CODE = "f3-51-control-character";
/** The one alarm this suite attributes its deliveries to; found and removed by this text. */
const FIXTURE_ALARM_MESSAGE = "F3.51 control-character fixture";

/**
 * `U+0000` itself, built rather than written into the source: a file that
 * really holds the byte reads as binary to git, to grep and to a reviewer's
 * pager, and the one place it needs to exist is the string under test.
 */
const NUL = String.fromCharCode(0);

/**
 * What a hostile endpoint can put in `notification_deliveries.error` through
 * `readBounded`: `\s` does not match `U+0000` and `trim()` does not strip it,
 * so the byte survives that excerpt's normalisation intact.
 */
const HOSTILE_ERROR = `webhook responded 500: bad${NUL}gateway`;
/** The same shape with nothing Postgres refuses — the paired positive. */
const ORDINARY_ERROR = "webhook responded 500: bad gateway";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export async function runControlCharacterErrorTests(pool: Pool, db: BmsDb): Promise<void> {
  /** The transport answers with whatever text the block under test set. */
  let failureText = ORDINARY_ERROR;
  const sent: NotificationMessage[] = [];
  const transport: NotificationTransport = {
    kind: "webhook",
    send: (message): Promise<DeliveryResult> => {
      sent.push(message);
      return Promise.resolve({ status: "failed", error: failureText });
    },
  };

  // `dispatchToChannel` only ever reaches `loadForRule` here — a plain fleetDb
  // join that never touches access control — so the last two slots are unused
  // stand-ins, as in the cleared-refusal suite.
  const channels = new ChannelsService(
    db,
    db,
    { decrypt: () => ({}) } as unknown as ConstructorParameters<typeof ChannelsService>[2],
    {} as unknown as ConstructorParameters<typeof ChannelsService>[3],
  );

  await cleanup(pool);

  const created = await pool.query<{ id: string }>(
    `INSERT INTO bms.notification_channels (code, name, kind, config)
     VALUES ($1, 'F3.51 control character', 'webhook', '{"url":"https://hooks.example.com/x"}'::jsonb)
     RETURNING id`,
    [CHANNEL_CODE],
  );
  const channelId = created.rows[0]?.id;
  assert(channelId !== undefined, "the test channel was not created");

  try {
    const rules = await pool.query<{ id: string; code: string; organization_id: string }>(
      `SELECT id, code, organization_id FROM bms.automation_rules WHERE enabled = true
        ORDER BY code LIMIT 1`,
    );
    const rule = rules.rows[0];
    assert(rule !== undefined, "no enabled rule in the seeded database to attribute a dispatch to");
    const seededRule = rule as { id: string; code: string; organization_id: string };

    // A rule-less alarm, so `alarms_open_per_rule_uidx` — partial on
    // `rule_id IS NOT NULL` — can never collide with a row this database
    // already holds.
    const alarmId = await insertFixtureAlarm(pool, seededRule.id, seededRule.organization_id);

    const stored = await loadEnabledChannelsByIds(db, [channelId as string]);
    assert(stored.length === 1, `the suite channel must load, got ${stored.length}`);
    const channel = channels.toChannelRow(stored[0] as (typeof stored)[number]);

    const service = new NotificationsService(
      db,
      channels,
      transport as unknown as Deps[2],
      transport as unknown as Deps[3],
      transport as unknown as Deps[4],
      buildConfig({ NOTIFY_RATE_LIMIT_PER_HOUR: "1000" }),
    );

    const base: DispatchInput = {
      ruleId: seededRule.id,
      ruleCode: seededRule.code,
      organizationId: seededRule.organization_id,
      alarmId,
      severity: "warning",
      message: FIXTURE_ALARM_MESSAGE,
      raised: true,
    };

    const storedErrors = async (dedupeKey: string): Promise<string[]> => {
      const res = await pool.query<{ error: string | null }>(
        `SELECT error FROM bms.notification_deliveries
          WHERE channel_id = $1 AND organization_id = $2 AND dedupe_key = $3
          ORDER BY attempted_at`,
        [channelId, seededRule.organization_id, dedupeKey],
      );
      return res.rows.map((row) => row.error ?? "");
    };

    // Distinct severities per block: the key is `rule:alarm:severity`.

    // --- the hostile text: the row still lands, without the NUL -------------
    {
      failureText = HOSTILE_ERROR;
      const input: DispatchInput = { ...base, severity: "major" };
      const outcomes = await service.dispatchToChannels([channel], input);

      assert(outcomes[0]?.status === "failed", `the delivery failed, got ${String(outcomes[0]?.status)}`);
      assert(
        outcomes[0]?.rowLost === false,
        "the row landed — before the fix Postgres refused the parameter and this was `true`",
      );
      const errors = await storedErrors(buildDedupeKey(input));
      assert(errors.length === 1, `exactly one row in Postgres, got ${errors.length}`);
      const text = errors[0] ?? "";
      assert(!text.includes(NUL), `the stored text carries no NUL, got ${JSON.stringify(text)}`);
      // Stripped, not replaced: what surrounds the control character is kept,
      // so an operator still reads the endpoint's own words.
      assert(
        text === "webhook responded 500: badgateway",
        `only the control character is removed, got ${JSON.stringify(text)}`,
      );
    }

    // --- the paired positive: ordinary text is stored byte for byte ---------
    {
      failureText = ORDINARY_ERROR;
      const input: DispatchInput = { ...base, severity: "minor" };
      const outcomes = await service.dispatchToChannels([channel], input);

      assert(outcomes[0]?.rowLost === false, "the ordinary row lands too");
      const errors = await storedErrors(buildDedupeKey(input));
      assert(
        errors.length === 1 && errors[0] === ORDINARY_ERROR,
        `an error with nothing to strip is stored unchanged, got ${JSON.stringify(errors)}`,
      );
    }

    assert(sent.length === 2, `both dispatches reached the transport, got ${sent.length}`);
  } finally {
    await cleanup(pool);
  }
}

/** One open, rule-less alarm for this suite's deliveries to reference. */
async function insertFixtureAlarm(
  pool: Pool,
  ruleId: string,
  organizationId: string,
): Promise<string> {
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
  await pool.query(`DELETE FROM bms.notification_channels WHERE code = $1`, [CHANNEL_CODE]);
}
