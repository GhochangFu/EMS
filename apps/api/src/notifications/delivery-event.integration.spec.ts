import type { NotificationDeliveryDto } from "@bms/shared";

import { buildDedupeKey } from "./dedupe-key";

/**
 * `F3.56` — the PRODUCER names the event kind, measured against Postgres (ADR
 * 0041 Amendment 8).
 *
 * `dedupe-key.spec.ts` holds the parse. This holds the half a unit spec cannot:
 * that `ChannelsService.listDeliveries` selects `dedupe_key` at all, hands the
 * real row to `parseDeliveryEvent`, and consumes the key rather than returning
 * it. A fake `db` would answer whatever shape the fake was written to answer.
 *
 * **Why a NEW pair rather than more blocks in a neighbouring suite.**
 * `channels.service.rls.integration.test.ts` is one 200-line `it()` whose
 * fixture lives inside it and whose name says RLS, so an event-kind assertion
 * there would be invisible in the report and would have to borrow a fixture
 * built for another question. `cleared-refusal-rows.integration.spec.ts` builds
 * its `ChannelsService` with `{}` in the `AccessControlService` slot — every
 * call in it reaches `loadForRule` and never access control — so
 * `listDeliveries`, which starts with `requireMasterDataUser`, cannot be called
 * there at all. So this suite owns its fixture outright:
 * `tests/integration-fixture-isolation.test.ts` is the record of what borrowing
 * another suite's private helper costs.
 *
 * **Rows 4 and 5 share a status AND an error string on purpose.** Those are the
 * two real sites that write `rate-limit check failed` —
 * `notifications.service.ts:458` on the dispatch path and `:759` in `sendTest`
 * — so in the ledger they are indistinguishable except by `event`. That
 * ambiguity is `F3.56`'s own complaint, and Amendment 8's correction to the row
 * is that it is three ways ambiguous rather than two.
 *
 * **Row 6 is the one row a test writes that production never writes.** It is
 * here so `unknown` is measured at the PRODUCER and not only inside the parse,
 * and because it catches a `.map()` that passed `alarmId: null` for every row —
 * row 1 would then read `unknown` too.
 */

/** This suite's own channel. Nothing else writes it and `cleanUp…` removes it by this code. */
const CHANNEL_CODE = "f3-56-event-kind";

/** The one alarm this suite attributes its deliveries to; found and removed by this text. */
const FIXTURE_ALARM_MESSAGE = "F3.56 delivery-event fixture";

/** The literal both real rate-limit sites write. Rows 4 and 5 carry it identically. */
const RATE_LIMIT_ERROR = "rate-limit check failed";

/** The key row 6 carries — a well-formed string that belongs to no rule and no alarm here. */
const FOREIGN_KEY = "f3-56-not-this-rows-key";

/** The minimum this suite needs of a `pg.Pool`. */
type Pool = {
  query: <R>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

/** What the wrapper seeds and the three assertions read back. */
export type DeliveryEventFixture = {
  /** The channel every row points at — also `listDeliveries`' filter, so no foreign row is read. */
  readonly channelId: string;
  /** The six ledger row ids, in the order of this file's own table: index 0 is row 1. */
  readonly ids: readonly string[];
  /** Row 1's dedupe key. `assertsTheKeyNeverCrosses` proves this string never reaches a client. */
  readonly rowOneKey: string;
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Removes everything this suite writes, in foreign-key order.
 *
 * Called before the seed as well as after it, so a run that was killed between
 * the two does not leave rows that make the next run's counts wrong.
 */
export async function cleanUpDeliveryEventFixture(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.notification_deliveries
      WHERE channel_id IN (SELECT id FROM bms.notification_channels WHERE code = $1)
         OR alarm_id IN (SELECT id FROM bms.alarms WHERE message = $2)`,
    [CHANNEL_CODE, FIXTURE_ALARM_MESSAGE],
  );
  await pool.query(`DELETE FROM bms.alarms WHERE message = $1`, [FIXTURE_ALARM_MESSAGE]);
  await pool.query(`DELETE FROM bms.notification_channels WHERE code = $1`, [CHANNEL_CODE]);
}

/**
 * Writes the six ledger rows this suite asserts on, one per event outcome.
 *
 * | # | row                                                       | event       |
 * |---|-----------------------------------------------------------|-------------|
 * | 1 | raise key, rule + alarm, `sent`                           | `raise`     |
 * | 2 | no-alarm key, `alarm_id` NULL, `skipped_deduped`          | `raise`     |
 * | 3 | escalation step 2 key, `skipped_stale`                    | `escalation`|
 * | 4 | cleared key, `failed`, `rate-limit check failed`          | `cleared`   |
 * | 5 | key NULL, rule NULL, alarm NULL, same status, same error  | `test`      |
 * | 6 | rule + alarm set, a key belonging to neither              | `unknown`   |
 *
 * Every key is produced by `buildDedupeKey`, not written by hand, so the row
 * shapes stay the ones the writer really produces.
 *
 * The alarm is rule-less on purpose: `alarms_open_per_rule_uidx` is partial on
 * `rule_id IS NOT NULL`, so a rule-less alarm can never collide with a row this
 * database already holds. The rule is resolved from `bms.automation_rules`,
 * which is not one of the four tables
 * `tests/f4.53-fixture-reads-prefer-seeded-rows.test.ts` governs, and this
 * suite never reads `bms.assets` — the asset comes off the rule.
 */
export async function seedDeliveryEventFixture(pool: Pool): Promise<DeliveryEventFixture> {
  await cleanUpDeliveryEventFixture(pool);

  const rules = await pool.query<{ id: string; organization_id: string; asset_id: string }>(
    `SELECT id, organization_id, asset_id FROM bms.automation_rules
      WHERE enabled = true AND asset_id IS NOT NULL
      ORDER BY code LIMIT 1`,
  );
  const rule = rules.rows[0];
  assert(
    rule !== undefined,
    "F3.56: no enabled rule with an asset in the seeded database — run pnpm db:seed",
  );

  const channel = await pool.query<{ id: string }>(
    `INSERT INTO bms.notification_channels (organization_id, code, name, kind, config, enabled)
     VALUES ($1, $2, 'F3.56 delivery event kind', 'webhook',
             '{"url":"https://hooks.example.com/f3-56"}'::jsonb, true)
     RETURNING id`,
    [rule.organization_id, CHANNEL_CODE],
  );
  const channelId = channel.rows[0]?.id;
  assert(channelId !== undefined, "F3.56: the fixture channel did not insert");

  const alarm = await pool.query<{ id: string }>(
    `INSERT INTO bms.alarms (organization_id, asset_id, severity, message)
     VALUES ($1, $2, 'warning', $3)
     RETURNING id`,
    [rule.organization_id, rule.asset_id, FIXTURE_ALARM_MESSAGE],
  );
  const alarmId = alarm.rows[0]?.id;
  assert(alarmId !== undefined, "F3.56: the fixture alarm did not insert");

  const raise = { ruleId: rule.id, alarmId, severity: "warning" };
  const rowOneKey = buildDedupeKey(raise);

  const rows: ReadonlyArray<{
    readonly dedupeKey: string | null;
    readonly ruleId: string | null;
    readonly alarmId: string | null;
    readonly status: string;
    readonly error: string | null;
  }> = [
    { dedupeKey: rowOneKey, ruleId: rule.id, alarmId, status: "sent", error: null },
    {
      dedupeKey: buildDedupeKey({ ...raise, alarmId: null }),
      ruleId: rule.id,
      alarmId: null,
      status: "skipped_deduped",
      error: null,
    },
    {
      dedupeKey: buildDedupeKey({ ...raise, event: { kind: "escalation", step: 2 } }),
      ruleId: rule.id,
      alarmId,
      status: "skipped_stale",
      error: null,
    },
    {
      dedupeKey: buildDedupeKey({ ...raise, event: { kind: "cleared" } }),
      ruleId: rule.id,
      alarmId,
      status: "failed",
      error: RATE_LIMIT_ERROR,
    },
    { dedupeKey: null, ruleId: null, alarmId: null, status: "failed", error: RATE_LIMIT_ERROR },
    { dedupeKey: FOREIGN_KEY, ruleId: rule.id, alarmId, status: "sent", error: null },
  ];

  const ids: string[] = [];
  for (const [index, row] of rows.entries()) {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO bms.notification_deliveries
         (organization_id, channel_id, rule_id, alarm_id, status, dedupe_key, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        rule.organization_id,
        channelId,
        row.ruleId,
        row.alarmId,
        row.status,
        row.dedupeKey,
        row.error,
      ],
    );
    const id = inserted.rows[0]?.id;
    assert(id !== undefined, `F3.56: fixture row ${index + 1} did not insert`);
    ids.push(id);
  }

  return { channelId, ids, rowOneKey };
}

/** The six ids, resolved to the rows `listDeliveries` returned. */
function byId(items: readonly NotificationDeliveryDto[]): Map<string, NotificationDeliveryDto> {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * `F3.56` P1 — each of the six rows reads back as its own event kind.
 *
 * The rows are matched **by id**, and asserted in this file's table order
 * rather than the response's. `listDeliveries` orders by `attempted_at DESC`
 * and six rows written in one loop share that instant to the microsecond, so
 * response order proves nothing and would make the mutation below land on a
 * different row on a different run.
 *
 * Mutation: the `.map()` writing a literal `event: "raise"` → reddens at
 * **row 3**, the first row in this order whose kind is not `raise`. `assert`
 * throws, so rows 4 to 6 never print; that is why the order is the table's.
 */
export function assertsEachRowsEvent(
  items: readonly NotificationDeliveryDto[],
  fixture: DeliveryEventFixture,
): void {
  const expected = ["raise", "raise", "escalation", "cleared", "test", "unknown"];
  const rows = byId(items);

  for (const [index, id] of fixture.ids.entries()) {
    const item = rows.get(id);
    assert(item !== undefined, `P1 row ${index + 1}: listDeliveries did not return it (${id})`);
    assert(
      item.event === expected[index],
      `P1 row ${index + 1}: expected event ${expected[index]}, got ${item.event} ` +
        `(status ${item.status})`,
    );
  }
}

/**
 * `F3.56` P2 — the two `rate-limit check failed` rows are told apart, and only
 * `event` tells them apart.
 *
 * Row 4 is a refused CLEARED message and row 5 is a refused SEND TEST. Both are
 * `failed`, both carry the same error text, and both are written by real code
 * (`notifications.service.ts:458` and `:759`). The equality of status and error
 * is asserted FIRST, so that if a later change makes them distinguishable some
 * other way this block says so instead of passing for a reason it does not name.
 *
 * Mutation: the `.map()` passing `dedupeKey: null` for every row → both read
 * `test`, and the `cleared` assertion below reddens.
 */
export function assertsTheTwoRateLimitRowsAreToldApart(
  items: readonly NotificationDeliveryDto[],
  fixture: DeliveryEventFixture,
): void {
  const rows = byId(items);
  const clearedRow = rows.get(fixture.ids[3] as string);
  const testRow = rows.get(fixture.ids[4] as string);
  assert(clearedRow !== undefined, "P2: the refused cleared row was not returned");
  assert(testRow !== undefined, "P2: the refused send-test row was not returned");

  assert(
    clearedRow.status === "failed" && testRow.status === "failed",
    `P2 premise: both rows must be failed, got ${clearedRow.status} and ${testRow.status}`,
  );
  assert(
    clearedRow.error === RATE_LIMIT_ERROR && testRow.error === RATE_LIMIT_ERROR,
    `P2 premise: both rows must carry the same error text, got ` +
      `${JSON.stringify([clearedRow.error, testRow.error])}`,
  );

  assert(
    clearedRow.event === "cleared",
    `P2: the refused CLEARED message must say so, got ${clearedRow.event}`,
  );
  assert(
    testRow.event === "test",
    `P2: the refused SEND TEST must say so, got ${testRow.event}`,
  );
}

/**
 * `F3.56` P3 — the dedupe key is consumed in the `.map()` and never crosses the
 * wire.
 *
 * Amendment 8 declined to expose the raw key on two measured grounds: nothing
 * outside `apps/api` reads it today, and it carries a rule uuid, an alarm uuid
 * **and** the severity code past the redaction `listDeliveries` performs in SQL
 * precisely so a tenant's row never leaves Postgres carrying detail it should
 * not.
 *
 * Two assertions, in this order, because they kill different mutations:
 *
 * - spreading `...row` into the returned item → the own-property check reddens
 * - returning the key under another name (`key`, `dedupe`) → the own-property
 *   check stays GREEN and the serialised search reddens
 */
export function assertsTheKeyNeverCrosses(
  items: readonly NotificationDeliveryDto[],
  fixture: DeliveryEventFixture,
): void {
  assert(items.length > 0, "P3: nothing to inspect — listDeliveries returned no rows");

  const leaking = items.filter((item) =>
    Object.prototype.hasOwnProperty.call(item, "dedupeKey"),
  );
  assert(
    leaking.length === 0,
    `P3: ${leaking.length} row(s) carry a \`dedupeKey\` property — the key is consumed in the ` +
      "`.map()`, not returned (ADR 0041 Amendment 8)",
  );

  const serialised = JSON.stringify(items);
  assert(
    !serialised.includes(fixture.rowOneKey),
    "P3: row 1's dedupe key appears in the serialised response under some other name — " +
      "the key carries the severity code past the SQL redaction",
  );
}
