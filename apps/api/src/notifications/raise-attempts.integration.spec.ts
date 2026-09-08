import { buildDedupeKey } from "./dedupe-key";
import { loadRaiseAttempts } from "./raise-attempts";
import type { RaiseKeyRef } from "./raise-retry";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Pool = {
  query: <R>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

type Db = Parameters<typeof loadRaiseAttempts>[0];

/** This suite's own fixture names — never another suite's, so cleanup cannot cross. */
const CHANNEL_CODE = "f3-51-raise-retry";
const FIXTURE_ALARM_MESSAGE = "F3.51 raise-retry ledger fixture";

/**
 * `F3.51` U3 — `loadRaiseAttempts` against the real database
 * (ADR 0041 Amendment 5, ADR 0057 Amendment 5).
 *
 * The unit fakes in `notifications.service.spec.ts` answer each read from a
 * queue and apply no `WHERE`, so they cannot show a row being kept or filtered
 * out. Every claim below is about the `WHERE`, so it can only be made here.
 *
 * **S1 is the one that matters.** The intuitive way to write this read is to
 * copy `eventDeliveryBlocked` verbatim, `ne(status, 'skipped_rate_limited')`
 * included. That would kill the third of this row's three cases: a channel
 * whose only row under the raise key is a ceiling refusal would come back with
 * ZERO rows, `channelsOwedTheRaise` would read that as "no evidence" (owner
 * ruling Q1), and the raise would never be retried. The exclusions belong in
 * TypeScript here — this read takes no `LIMIT`, so there is no unordered sample
 * and `F3.48`'s argument for putting them in the SQL does not reach it.
 *
 * **Its own channel, its own alarms, its own cleanup.** Other sessions run
 * suites against this database; a `finally` removes everything this file
 * writes, keyed on the two names above and on nothing else.
 *
 * Every count is a delta over this fixture's own rows, matched by alarm id and
 * dedupe key. No lifetime counter is read (§4.6).
 */
export async function runRaiseAttemptsTests(pool: Pool, db: Db): Promise<void> {
  await cleanup(pool);

  const created = await pool.query<{ id: string }>(
    `INSERT INTO bms.notification_channels (code, name, kind, config)
     VALUES ($1, 'F3.51 raise retry', 'webhook', '{"url":"https://hooks.example.com/x"}'::jsonb)
     RETURNING id`,
    [CHANNEL_CODE],
  );
  const channelId = created.rows[0]?.id as string;
  assert(channelId !== undefined, "the test channel was not created");

  try {
    const rules = await pool.query<{ id: string; code: string; organization_id: string }>(
      `SELECT id, code, organization_id FROM bms.automation_rules WHERE enabled = true
        ORDER BY code LIMIT 1`,
    );
    const rule = rules.rows[0];
    assert(rule !== undefined, "no enabled rule in the seeded database — this suite would plant nothing");
    const organizationId = (rule as { organization_id: string }).organization_id;
    const ruleId = (rule as { id: string }).id;

    // Two rule-less fixture alarms, so `alarm_id`'s foreign key has real rows.
    // `alarms_open_per_rule_uidx` is partial on `rule_id IS NOT NULL`, so a
    // rule-less row can never collide with an alarm this database already holds.
    const alarmOne = await insertFixtureAlarm(pool, ruleId, organizationId);
    const alarmTwo = await insertFixtureAlarm(pool, ruleId, organizationId);

    const raise = { ruleId, alarmId: alarmOne, severity: "warning" };
    const raiseKey = buildDedupeKey(raise);
    const escalationKey = buildDedupeKey({ ...raise, event: { kind: "escalation", step: 1 } });
    const secondRaiseKey = buildDedupeKey({ ...raise, alarmId: alarmTwo });
    const ref: RaiseKeyRef = { alarmId: alarmOne, organizationId, dedupeKey: raiseKey };

    // The baseline, before anything is planted. Every assertion below is a
    // delta over this — an absolute count would break the moment another
    // session's suite touches the table, and would blame this read for it.
    assert(
      (await loadRaiseAttempts(db, [ref])).length === 0,
      "the fixture's raise key holds no rows before this suite plants any",
    );
    assert((await loadRaiseAttempts(db, [])).length === 0, "empty refs read nothing");

    await plantDelivery(pool, {
      organizationId,
      ruleId,
      alarmId: alarmOne,
      channelId,
      status: "skipped_rate_limited",
      dedupeKey: raiseKey,
    });
    await plantDelivery(pool, {
      organizationId,
      ruleId,
      alarmId: alarmOne,
      channelId,
      status: "sent",
      dedupeKey: escalationKey,
    });
    const otherOrganizationId = await otherOrganization(pool, organizationId);
    await plantDelivery(pool, {
      organizationId: otherOrganizationId,
      ruleId,
      alarmId: alarmOne,
      channelId,
      status: "skipped_deduped",
      dedupeKey: raiseKey,
    });
    // S4's row is deliberately INCONSISTENT: alarm two's id under alarm one's
    // key, which production never writes because the key carries the alarm id.
    // It is the only fixture that isolates the `alarm_id IN` clause — a
    // consistent row for another alarm is already excluded by its own key, so
    // dropping the clause would go unnoticed.
    await plantDelivery(pool, {
      organizationId,
      ruleId,
      alarmId: alarmTwo,
      channelId,
      status: "failed",
      dedupeKey: raiseKey,
    });

    const rows = await loadRaiseAttempts(db, [ref]);

    // The three planted intruders carry three DIFFERENT statuses, and the
    // absence assertions name the status rather than counting. That is what
    // makes each mutation die by its own assertion: a single count would catch
    // all three and tell whoever broke it nothing about which clause went.
    //
    // S2 — the escalation row under the SAME alarm is not returned. Mutation:
    // dropping `dedupe_key IN` — a `sent` escalation row would then block the
    // raise retry for ever, and three `failed` ones would spend the raise's cap.
    assert(
      !rows.some((r) => r.status === "sent"),
      `S2: the alarm's escalation row is under another key and must not join the raise's set, ` +
        `got [${rows.map((r) => r.status).join(",")}]`,
    );

    // S3 — the other organization's row under the SAME key is not returned.
    // Mutation: dropping the organization clause.
    assert(
      !rows.some((r) => r.organizationId !== organizationId),
      "S3: no other tenant's row under this key reaches this organization's set",
    );
    // The positive twin, on the same fixture: the row IS there, and reading for
    // its own organization returns it. Without this the absence above would
    // pass on a read that returned nothing at all.
    const foreign = await loadRaiseAttempts(db, [
      { alarmId: alarmOne, organizationId: otherOrganizationId, dedupeKey: raiseKey },
    ]);
    assert(
      foreign.length === 1 &&
        foreign[0]?.organizationId === otherOrganizationId &&
        foreign[0].status === "skipped_deduped",
      `S3: the foreign row exists and belongs to its own tenant, got ${foreign.length}`,
    );

    // S4 — a row whose alarm is not in `refs` is not returned. Mutation:
    // dropping `alarm_id IN`, which is also the read's access path for
    // `notification_deliveries_alarm_idx`.
    assert(
      !rows.some((r) => r.alarmId !== alarmOne),
      `S4: alarm two's row is not in this ref's set, whatever key it carries, got ` +
        `[${rows.map((r) => r.status).join(",")}]`,
    );

    // S1 — and what is left is the rate-limited row. Last on purpose: the three
    // above name the row that must not be here, this one names the row that
    // must. Mutation: adding `ne(status, 'skipped_rate_limited')` to the
    // `WHERE` empties the set — every clause above still passes, vacuously —
    // and the sweep stops retrying every ceiling-refused raise.
    assert(
      rows.length === 1,
      `S1: exactly the raise key's own row comes back, got ${rows.length}: ` +
        `[${rows.map((r) => r.status).join(",")}]`,
    );
    const row = rows[0];
    assert(
      row?.status === "skipped_rate_limited",
      `S1: a ceiling refusal is evidence, not a filtered row, got ${String(row?.status)}`,
    );
    assert(
      row?.channelId === channelId && row.alarmId === alarmOne && row.organizationId === organizationId,
      "S1: the projection carries the channel, the alarm and the organization the grouping needs",
    );
    // `channelsOwedTheRaise` calls `.getTime()` on this. The unit spec hands it
    // hand-built `Date`s, so this is the only place the driver's own type for
    // `timestamptz` is checked — a string here would throw in production and
    // redden nothing else.
    assert(
      row?.attemptedAt instanceof Date,
      `S1: attemptedAt reaches the predicate as a Date, got ${typeof row?.attemptedAt}`,
    );

    // S5 — one query per tick, not one per alarm: the three `IN` lists take
    // every ref at once. Mutation: reading only `refs[0]`.
    //
    // This is also where the lists' independence shows. Asking for both alarms
    // returns three rows, not two: alarm two's deliberately inconsistent row
    // matches `alarm_id IN (a1, a2)` AND `dedupe_key IN (k1, k2)` without any
    // single ref having asked for that pair. Production cannot build it — a key
    // names its alarm — and Task 4's grouping re-checks the organization per
    // ref anyway.
    await plantDelivery(pool, {
      organizationId,
      ruleId,
      alarmId: alarmTwo,
      channelId,
      status: "failed",
      dedupeKey: secondRaiseKey,
    });
    const both = await loadRaiseAttempts(db, [
      ref,
      { alarmId: alarmTwo, organizationId, dedupeKey: secondRaiseKey },
    ]);
    assert(
      both.length === 3,
      `S5: both refs are read in one query, got ${both.length}: [${both
        .map((r) => r.status)
        .join(",")}]`,
    );
    assert(
      both.some((r) => r.alarmId === alarmTwo && r.status === "failed"),
      "S5: the second ref's own row is in the set",
    );
  } finally {
    await cleanup(pool);
  }
}

/** One planted ledger row — the state the read is asked to see past. */
async function plantDelivery(
  pool: Pool,
  row: {
    organizationId: string;
    ruleId: string;
    alarmId: string;
    channelId: string;
    status: string;
    dedupeKey: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO bms.notification_deliveries
       (organization_id, rule_id, alarm_id, channel_id, status, dedupe_key, error)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text,
             CASE WHEN $5::text = 'failed' THEN 'planted by raise-attempts.integration.spec.ts' END)`,
    [row.organizationId, row.ruleId, row.alarmId, row.channelId, row.status, row.dedupeKey],
  );
}

/** One open, rule-less alarm in the rule's organization — a real row for `alarm_id`. */
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

/** The id of a seeded organization other than `organizationId` — S3's tenant. */
async function otherOrganization(pool: Pool, organizationId: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM bms.organizations WHERE id <> $1 ORDER BY code LIMIT 1`,
    [organizationId],
  );
  const id = res.rows[0]?.id;
  assert(id !== undefined, "the seed holds two organizations; the second is S3's cross-tenant row");
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
