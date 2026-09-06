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
 * real `WHERE` of `eventDeliveryBlocked`, which the unit spec's fake cannot
 * see. PR 1's review added three more real-`WHERE` gates there: a row in the
 * other seeded organization under the same key, which no read may see (L1);
 * `failed` rows planted by hand, retried up to `MAX_EVENT_ATTEMPTS` and then
 * blocked (ruling Q9); and a `skipped_rate_limited` row that blocks the key
 * like a `sent` one (rulings Q7 and Q9 together).
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
    const stepKey = buildDedupeKey(step);

    // --- review L1: a row in another organization under the same key --------
    //
    // Every ledger read here filters on `organization_id`, and the fake in the
    // unit spec cannot see a WHERE. So one `sent` row is planted that matches
    // the step in every column but the organization — the other seeded
    // organization's — and each read is asked while it is the ONLY row under
    // the key: `sentChannelIdsForAlarm` must not name its channel for the
    // fixture's organization (and must for the foreign one, so the row is
    // known to be there), and the first step must still send.
    const otherOrganizationId = await otherOrganization(pool, first.organization_id);
    await plantDeliveries(pool, {
      organizationId: otherOrganizationId,
      ruleId: first.id,
      alarmId,
      channelId: channelId as string,
      status: "sent",
      dedupeKey: stepKey,
    });
    assert(
      (await service.sentChannelIdsForAlarm(alarmId, first.organization_id)).length === 0,
      "L1: the foreign organization's sent row is not a recipient in the fixture's organization",
    );
    assert(
      (await service.sentChannelIdsForAlarm(alarmId, otherOrganizationId)).join(",") === channelId,
      "L1: the same read names the planted channel for its own organization — the row is there",
    );

    const sentBeforeStep = sent.length;
    const firstStep = await service.dispatchToChannels([channel], step);
    const secondStep = await service.dispatchToChannels([channel], step);
    assert(
      firstStep[0]?.status === "sent",
      `the first step sends — the foreign row under its key is not seen (L1), got ${String(
        firstStep[0]?.status,
      )}`,
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
      (await countByKey(pool, channelId as string, first.organization_id, stepKey)) === 1,
      "exactly one row in the fixture's organization holds the step's key — the second tick " +
        "wrote nothing",
    );

    // --- ruling Q9: `failed` is retried, three attempts, then the key blocks -
    //
    // Two `failed` rows planted under step 2's key: the third attempt sends,
    // and the fourth finds the `sent` row and is answered from it. Then three
    // `failed` rows under step 3's key: blocked outright, no fourth row. The
    // `LIMIT` and the count in `eventDeliveryBlocked` meet a real Postgres
    // here; the unit spec's fake only slices what it is told.
    const stepTwo: DispatchInput = { ...step, event: { kind: "escalation", step: 2 } };
    const stepTwoKey = buildDedupeKey(stepTwo);
    const planted = {
      organizationId: first.organization_id,
      ruleId: first.id,
      alarmId,
      channelId: channelId as string,
      status: "failed",
    };
    await plantDeliveries(pool, { ...planted, dedupeKey: stepTwoKey }, 2);
    const sentBeforeRetry = sent.length;
    const third = await service.dispatchToChannels([channel], stepTwo);
    assert(
      third[0]?.status === "sent",
      `two failed attempts leave a third, got ${String(third[0]?.status)}`,
    );
    const fourth = await service.dispatchToChannels([channel], stepTwo);
    assert(
      fourth[0]?.status === "skipped_deduped",
      `after the send the key is answered from the ledger, got ${String(fourth[0]?.status)}`,
    );
    assert(
      sent.length === sentBeforeRetry + 1,
      `the retry reaches the transport once, got ${sent.length - sentBeforeRetry}`,
    );
    assert(
      (await countByKey(pool, channelId as string, first.organization_id, stepTwoKey)) === 3,
      "two failed rows and one sent row hold step 2's key — no fourth",
    );

    const stepThree: DispatchInput = { ...step, event: { kind: "escalation", step: 3 } };
    const stepThreeKey = buildDedupeKey(stepThree);
    await plantDeliveries(pool, { ...planted, dedupeKey: stepThreeKey }, 3);
    const exhausted = await service.dispatchToChannels([channel], stepThree);
    assert(
      exhausted[0]?.status === "skipped_deduped",
      `three failed attempts block the key, got ${String(exhausted[0]?.status)}`,
    );
    assert(sent.length === sentBeforeRetry + 1, "an exhausted key never reaches the transport");
    assert(
      (await countByKey(pool, channelId as string, first.organization_id, stepThreeKey)) === 3,
      "still three rows under step 3's key — the ledger stops growing at the bound",
    );

    // --- FG1: a non-`sent`, non-`failed` row consumes the key too ------------
    //
    // Rulings Q7 and Q9 together: only `failed` is retried. The ceiling-of-1
    // service records step 9 as `skipped_rate_limited` (this channel already
    // holds sent rows this hour); the normal service then finds that row and
    // answers from it. A read narrowed to `status = 'sent'` would send here.
    const stepNine: DispatchInput = { ...step, event: { kind: "escalation", step: 9 } };
    const stepNineKey = buildDedupeKey(stepNine);
    const limitedStep = await limited.dispatchToChannels([channel], stepNine);
    assert(
      limitedStep[0]?.status === "skipped_rate_limited",
      `at the ceiling of 1 the step is rate-limited, got ${String(limitedStep[0]?.status)}`,
    );
    const sentBeforeNine = sent.length;
    const afterLimited = await service.dispatchToChannels([channel], stepNine);
    assert(
      afterLimited[0]?.status === "skipped_deduped",
      `a rate-limited step is answered from its row, got ${String(afterLimited[0]?.status)}`,
    );
    assert(sent.length === sentBeforeNine, "the rate-limited step never reaches the transport");
    assert(
      (await countByKey(pool, channelId as string, first.organization_id, stepNineKey)) === 1,
      "one rate-limited row holds step 9's key and nothing was written after it",
    );

    // Decision 9 / ruling Q5: the cleared message goes to whoever holds a
    // `sent` row for the alarm. The steps above are those rows — and the
    // planted foreign one is not.
    const recipients = await service.sentChannelIdsForAlarm(alarmId, first.organization_id);
    assert(
      recipients.length === 1 && recipients[0] === channelId,
      `the steps' channel is the cleared recipient, got [${recipients.join(",")}]`,
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
      (await countByKey(pool, channelId as string, first.organization_id, buildDedupeKey(cleared))) ===
        1,
      "exactly one row holds the cleared key",
    );
    assert(
      (await service.sentChannelIdsForAlarm(alarmId, first.organization_id)).length === 1,
      "several sent rows for one channel are still one recipient",
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

/** Rows under one key on one channel in one organization — the triple every event read is keyed on. */
async function countByKey(
  pool: Pool,
  channelId: string,
  organizationId: string,
  dedupeKey: string,
): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM bms.notification_deliveries
      WHERE channel_id = $1 AND organization_id = $2 AND dedupe_key = $3`,
    [channelId, organizationId, dedupeKey],
  );
  return Number(res.rows[0]?.count ?? "0");
}

/** The id of a seeded organization other than `organizationId` — the L1 row's tenant. */
async function otherOrganization(pool: Pool, organizationId: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM bms.organizations WHERE id <> $1 ORDER BY code LIMIT 1`,
    [organizationId],
  );
  const id = res.rows[0]?.id;
  assert(id !== undefined, "the seed holds two organizations; the second is L1's cross-tenant row");
  return id as string;
}

/**
 * Plants `count` rows by hand — the ledger states the service is asked to
 * read past. `attempted_at` defaults to now, as a real row's would; `error`
 * is set on a `failed` row only, as `record()` would leave it. Removed by
 * `cleanup` through the channel and the fixture alarm.
 */
async function plantDeliveries(
  pool: Pool,
  row: {
    organizationId: string;
    ruleId: string;
    alarmId: string;
    channelId: string;
    status: string;
    dedupeKey: string;
  },
  count = 1,
): Promise<void> {
  await pool.query(
    `INSERT INTO bms.notification_deliveries
       (organization_id, rule_id, alarm_id, channel_id, status, dedupe_key, error)
     SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text,
            CASE WHEN $5::text = 'failed' THEN 'planted by storm-control.integration.spec.ts' END
       FROM generate_series(1, $7::int)`,
    [row.organizationId, row.ruleId, row.alarmId, row.channelId, row.status, row.dedupeKey, count],
  );
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
