import type { BmsDb } from "@bms/db";

import { dbBlindTo } from "../testing/blinded-db";
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
 * `F3.54` — a refused CLEARED message's row really lands, at both failed reads
 * (ADR 0057 Amendment 4 ruling 1).
 *
 * **Why this is its own suite rather than more blocks in
 * `storm-control.integration.spec.ts`.** These assertions were written there
 * first, against that file's fixture. Two things sent them here. That file
 * stood at 1000 of AGENTS.md §4.5's cap, and §2's instruction for a file at
 * that margin is *extract before adding*. And `tests/repo-invariants.test.ts`
 * requires every `.spec` to have its own `.test` wrapper — being invoked from
 * another spec does not count, because Vitest discovers only `.test` files and
 * excludes `.spec` files from coverage, so a spec nothing discovers is
 * invisible to the runner and to the coverage gate alike. That invariant
 * caught the first attempt in CI. So this suite owns its fixture outright: its
 * own channel code, its own alarm, its own cleanup.
 *
 * **What these hold that the unit spec cannot.** `notifications.events.spec.ts`
 * cases 6b and 10b hold that the insert is *attempted*. These hold that the row
 * reaches `bms.notification_deliveries` and reads back — against the real
 * status CHECK, the real `organization_id NOT NULL` and the real `alarm_id`
 * foreign key, none of which a fake has.
 *
 * **The read failure is synthesised, and §4.6 asks that the substitution be
 * said where the test is written.** Both exits fire only when a read throws,
 * and inducing that against this database means revoking a grant or terminating
 * a backend on a role other suites are using. `dbBlindTo` rejects exactly one
 * `select` projection and delegates everything else — the INSERT included — to
 * the real database, so the write path under test is never simulated. Its
 * header carries why that is sound, and `blindedReads()` gates the premise
 * rather than asserting it in prose.
 *
 * Each block asserts BOTH kinds. The escalation half kills the over-broad
 * mutation "record on every event" — but only under its own key, so
 * `notifications.events.spec.ts` cases 6 and 10, which assert
 * `recorded.length === 0` outright, stay the key-independent holders of that
 * claim. Do not delete them believing this file covers it.
 */

type Pool = {
  query: <R>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

type Deps = ConstructorParameters<typeof NotificationsService>;

const CHANNEL_CODE = "f3-54-cleared-refusal";
/** The one alarm this suite attributes its deliveries to; found and removed by this text. */
const FIXTURE_ALARM_MESSAGE = "F3.54 cleared-refusal fixture";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export async function runClearedRefusalRowTests(pool: Pool, db: BmsDb): Promise<void> {
  const sent: NotificationMessage[] = [];
  const transport: NotificationTransport = {
    kind: "webhook",
    send: (message): Promise<DeliveryResult> => {
      sent.push(message);
      return Promise.resolve({ status: "sent", error: null });
    },
  };

  // `dispatchToChannel` only ever reaches `loadForRule` here — a plain fleetDb
  // join that never touches access control — so the last two slots are unused
  // stand-ins, as in the storm-control suite.
  const channels = new ChannelsService(
    db,
    db,
    { decrypt: () => ({}) } as unknown as ConstructorParameters<typeof ChannelsService>[2],
    {} as unknown as ConstructorParameters<typeof ChannelsService>[3],
  );

  await cleanup(pool);

  const created = await pool.query<{ id: string }>(
    `INSERT INTO bms.notification_channels (code, name, kind, config)
     VALUES ($1, 'F3.54 cleared refusal', 'webhook', '{"url":"https://hooks.example.com/x"}'::jsonb)
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
    // already holds. The dedupe key takes the rule from the input, which is
    // what the sweep does too.
    const alarmId = await insertFixtureAlarm(pool, seededRule.id, seededRule.organization_id);

    const stored = await loadEnabledChannelsByIds(db, [channelId as string]);
    assert(stored.length === 1, `the suite channel must load, got ${stored.length}`);
    const channel = channels.toChannelRow(stored[0] as (typeof stored)[number]);

    const base: DispatchInput = {
      ruleId: seededRule.id,
      ruleCode: seededRule.code,
      organizationId: seededRule.organization_id,
      alarmId,
      severity: "warning",
      message: FIXTURE_ALARM_MESSAGE,
      raised: true,
      event: { kind: "cleared" },
    };

    const blindService = (
      blindedShape: string,
    ): { service: NotificationsService; blindedReads: () => number } => {
      const blind = dbBlindTo(db, blindedShape);
      return {
        service: new NotificationsService(
          blind.db,
          channels,
          transport as unknown as Deps[2],
          transport as unknown as Deps[3],
          transport as unknown as Deps[4],
          buildConfig({ NOTIFY_RATE_LIMIT_PER_HOUR: "1000" }),
        ),
        blindedReads: blind.blindedReads,
      };
    };

    const statusesByKey = async (dedupeKey: string): Promise<string[]> => {
      const res = await pool.query<{ status: string }>(
        `SELECT status FROM bms.notification_deliveries
          WHERE channel_id = $1 AND organization_id = $2 AND dedupe_key = $3
          ORDER BY attempted_at`,
        [channelId, seededRule.organization_id, dedupeKey],
      );
      return res.rows.map((row) => row.status);
    };

    // Distinct severities per block: the key is `rule:alarm:severity[:suffix]`.

    // --- D3: blind `{ status }`, so only `eventDeliveryBlocked` throws ------
    {
      const d3 = blindService("status");
      const clear: DispatchInput = { ...base, severity: "major" };
      const escalation: DispatchInput = { ...clear, event: { kind: "escalation", step: 20 } };

      const clearResult = await d3.service.dispatchToChannels([channel], clear);
      const stepResult = await d3.service.dispatchToChannels([channel], escalation);

      assert(
        clearResult[0]?.status === "failed" && stepResult[0]?.status === "failed",
        `an unreadable ledger fails both kinds, got ${String(clearResult[0]?.status)}/${String(
          stepResult[0]?.status,
        )}`,
      );
      // The premise, gated: exactly one read blinded per dispatch. A fifth
      // `select({ status })` in the service would blind two and quietly change
      // what everything below is proving.
      assert(
        d3.blindedReads() === 2,
        `two dispatches must blind exactly one read each, got ${d3.blindedReads()}`,
      );
      assert(sent.length === 0, "a failed ledger read is never a send, either kind");
      assert(
        (await statusesByKey(buildDedupeKey(clear))).join(",") === "failed",
        "F3.54 D3: the cleared message's refusal row is in Postgres",
      );
      assert(
        (await statusesByKey(buildDedupeKey(escalation))).length === 0,
        "F3.54 D3: the escalation step still writes nothing — its key survives for the next tick",
      );
    }

    // --- H1: blind `{ count }`, so the ledger read runs for real and only ---
    //     `isOverHourlyLimit` throws. The key is fresh, so the real read does
    //     not block and step 2 is reached.
    {
      const h1 = blindService("count");
      const clear: DispatchInput = { ...base, severity: "minor" };
      const escalation: DispatchInput = { ...clear, event: { kind: "escalation", step: 21 } };

      const clearResult = await h1.service.dispatchToChannels([channel], clear);
      const stepResult = await h1.service.dispatchToChannels([channel], escalation);

      assert(
        clearResult[0]?.error === "rate-limit check failed" &&
          stepResult[0]?.error === "rate-limit check failed",
        `an unreadable ceiling fails both kinds by name, got ${JSON.stringify([
          clearResult[0],
          stepResult[0],
        ])}`,
      );
      assert(
        h1.blindedReads() === 2,
        `two dispatches must blind exactly one read each, got ${h1.blindedReads()}`,
      );
      assert(sent.length === 0, "an unreadable ceiling is not a licence to send");
      assert(
        (await statusesByKey(buildDedupeKey(clear))).join(",") === "failed",
        "F3.54 H1: the cleared message's refusal row is in Postgres",
      );
      assert(
        (await statusesByKey(buildDedupeKey(escalation))).length === 0,
        "F3.54 H1: the escalation step still writes nothing",
      );
    }
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
