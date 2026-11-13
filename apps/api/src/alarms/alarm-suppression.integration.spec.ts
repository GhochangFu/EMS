import { Logger } from "@nestjs/common";
import { is, sql, type SQL, TransactionRollbackError } from "drizzle-orm";
import type pg from "pg";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import type { BmsTx } from "../database/tenant-context";
import { withTenant } from "../database/tenant-context";
import { ChannelsService } from "../notifications/channels.service";
import type { DeliveryResult, NotificationMessage, NotificationTransport } from "../notifications/notification-transport";
import { buildConfig } from "../notifications/notifications.config";
import { NotificationsService } from "../notifications/notifications.service";
import { selectRuleRows, stampRulesEvaluated } from "../rules/rule-reads";
import { batchedLatestPointValues } from "../rules/rule-samples";
import { runRuleSweep } from "../rules/rule-sweep";
import { RulesService } from "../rules/rules.service";
import { TelemetryBroadcastHub } from "../telemetry/telemetry-broadcast.hub";
import { until } from "../testing/until";
import type { VocabulariesService } from "../vocabularies/vocabularies.service";
import { ALARM_NOTIFY_CHANNEL } from "./alarm-notify-channel";
import { AlarmEngineService } from "./alarm-engine.service";
import { AlarmRaiser } from "./alarm-raise.service";
import type { Pg } from "./alarm-list-filters.integration.spec";
import { type CoverOrganization, insertCoverOrganization, insertWindow } from "./maintenance-cover.reads.integration.spec";

/**
 * `F4.359` U7 (ADR 0131 decisions 6 and 10; plan Q1 (a), D8, D9) — the raise
 * path suppresses, end to end, on a real database.
 *
 * **The gap test.** Three engines raise rule alarms — the streaming
 * `AlarmEngineService`, the "Evaluate now" press (`RulesService
 * .evaluateEnabledRules`) and the worker's `runRuleSweep` — and each hands the
 * raiser's result to `notifyOnRaise`. For each, a notify rule targeted by an
 * active window raises a stamped alarm and leaves **zero**
 * `notification_deliveries` rows, while its twin on the same asset and the same
 * channel — a rule the window does not name — leaves one `sent` row. The twin
 * is also the drain marker: dispatch is fire-and-forget, so "no row" is only a
 * claim once the twin's row, started after it in the same pass, has landed.
 *
 * Isolation is the model suites' (`alarm-engine.integration`,
 * `evaluate-enabled-rules.integration`, `rule-sweep.integration`): one
 * transaction per engine, used as both pools, rolled back last, with the
 * organization built inside it — so the organization is dropped with it and the
 * raises' `pg_notify` never leaves it. The transport is a recording `webhook`
 * stand-in returning `sent` (`LogTransport` records `skipped_unconfigured`, so it
 * cannot be the positive twin's `sent` row).
 *
 * **The one-transaction test** needs a commit (a rolled-back `NOTIFY` is never
 * delivered either way), so it runs on real pools against an organization of its
 * own, committed and dropped by the wrapper: with the cover read made to throw,
 * the raise rejects, no alarm row exists and no `NOTIFY` was delivered.
 *
 * Vitest entry point: the sibling `.integration.test.ts` (ADR 0014).
 */

function fail(message: string): never {
  throw new Error(message);
}

/** A `Pg` over a drizzle handle, so the committed-fixture helpers run inside a rolled-back transaction too. */
function pgOn(db: BmsTx): Pg {
  return {
    query: async <R extends pg.QueryResultRow>(text: string, values: unknown[] = []) => {
      const parts = text.split(/\$(\d+)/);
      const chunks: SQL[] = parts.map((part, i) => (i % 2 === 0 ? sql.raw(part) : sql`${sql.param(values[Number(part) - 1])}`));
      return (await db.execute(sql.join(chunks, sql.raw("")))) as unknown as pg.QueryResult<R>;
    },
  };
}

type NotificationsDeps = ConstructorParameters<typeof NotificationsService>;

/** The real `NotificationsService` on the transaction, with a recording `webhook` transport — the model suites' `realNotificationsOn`. */
function realNotificationsOn(db: BmsDb): { notifications: NotificationsService; sent: NotificationMessage[] } {
  const sent: NotificationMessage[] = [];
  const transport: NotificationTransport = {
    kind: "webhook",
    send: (message): Promise<DeliveryResult> => {
      sent.push(message);
      return Promise.resolve({ status: "sent", error: null });
    },
  };
  const channels = new ChannelsService(
    db,
    db,
    { decrypt: () => ({}) } as unknown as ConstructorParameters<typeof ChannelsService>[2],
    {} as unknown as ConstructorParameters<typeof ChannelsService>[3],
  );
  const notifications = new NotificationsService(
    db,
    channels,
    transport as unknown as NotificationsDeps[2],
    transport as unknown as NotificationsDeps[3],
    transport as unknown as NotificationsDeps[4],
    buildConfig({ NOTIFY_RATE_LIMIT_PER_HOUR: "1000" }),
  );
  return { notifications, sent };
}

export type Engine = "streaming" | "evaluate-now" | "rule-sweep";

export type GapOutcome = {
  readonly windowId: string;
  /** The rule the window names. */
  readonly covered: { readonly alarm: StampedAlarm | undefined; readonly deliveries: readonly string[]; readonly sent: number };
  /** The twin on the same asset and channel, which no window names. */
  readonly twin: { readonly alarm: StampedAlarm | undefined; readonly deliveries: readonly string[]; readonly sent: number };
};

type StampedAlarm = { id: string; stamped: boolean; suppressed_by_window_id: string | null };

async function alarmOf(pgq: Pg, ruleId: string): Promise<StampedAlarm | undefined> {
  const { rows } = await pgq.query<StampedAlarm>(
    "SELECT id, suppressed_at IS NOT NULL AS stamped, suppressed_by_window_id FROM bms.alarms WHERE rule_id = $1 AND cleared_at IS NULL",
    [ruleId],
  );
  return rows[0];
}

/** Every ledger row of one rule, by status — never a table-wide count (`F4.71`). */
async function deliveriesOf(pgq: Pg, ruleId: string): Promise<string[]> {
  const { rows } = await pgq.query<{ status: string }>("SELECT status FROM bms.notification_deliveries WHERE rule_id = $1", [ruleId]);
  return rows.map((row) => row.status);
}

function stubVocabularies(): VocabulariesService {
  return {
    assertRuleCategory: async () => undefined,
    assertAlarmSeverity: async () => undefined,
  } as unknown as VocabulariesService;
}

const ACTOR: Pick<JwtPayload, "sub" | "email"> = {
  sub: "00000000-0000-4000-8000-000000000000",
  email: "integration-test@bms.local",
};

/**
 * One engine's pass over the fixture: R1 (the window's rule target) and R2 (the
 * twin), both on A1, both `notify`, both joined to one channel, both with a
 * matching fresh sample. R1 sorts first in every engine, so a dispatch for it —
 * if a regression started one — is queued ahead of the twin's.
 */
export async function runGapScenario(db: BmsDb, engine: Engine): Promise<GapOutcome> {
  let outcome: GapOutcome | undefined;
  await db
    .transaction(async (tx) => {
      const pgq = pgOn(tx);
      const org: CoverOrganization = await insertCoverOrganization(pgq, `GAP${engine.slice(0, 3).toUpperCase()}`);
      const rules = [org.ruleId, org.otherRuleId] as const;
      await pgq.query(`UPDATE bms.automation_rules SET action = '{"type":"notify","target":"t"}'::jsonb WHERE id = ANY($1::uuid[])`, [
        [...rules],
      ]);
      const pointKeys = (
        await pgq.query<{ id: string; point_key: string }>("SELECT id, point_key FROM bms.automation_rules WHERE id = ANY($1::uuid[])", [
          [...rules],
        ])
      ).rows;
      const pointKeyOf = (ruleId: string): string => pointKeys.find((row) => row.id === ruleId)?.point_key ?? fail("no point key");
      const channel = await pgq.query<{ id: string }>(
        `INSERT INTO bms.notification_channels (organization_id, code, name, kind, config, enabled)
         VALUES ($1, $2, 'F4.359 gap fixture', 'webhook', '{"url":"https://hooks.example.com/x"}'::jsonb, true) RETURNING id`,
        [org.organizationId, `f4359-gap-${org.organizationId.slice(0, 8)}`],
      );
      const channelId = channel.rows[0]?.id ?? fail("no channel");
      for (const ruleId of rules) {
        await pgq.query("INSERT INTO bms.rule_notifications (rule_id, channel_id) VALUES ($1, $2)", [ruleId, channelId]);
      }
      const windowId = await insertWindow(pgq, org, { startsInSeconds: -60, endsInSeconds: 3600, ruleIds: [org.ruleId] });

      const { notifications, sent } = realNotificationsOn(tx);
      const raiser = new AlarmRaiser(tx);
      const logger = new Logger("alarm-suppression.integration");

      if (engine === "streaming") {
        const hub = new TelemetryBroadcastHub();
        const service = new AlarmEngineService(hub, tx, raiser, notifications);
        service.onModuleInit();
        const time = new Date().toISOString();
        hub.emitReadings(rules.map((ruleId) => ({ time, assetId: org.assetIds[0], pointKey: pointKeyOf(ruleId), value: 1_000_000, unit: null })));
      } else {
        for (const ruleId of rules) {
          await pgq.query("INSERT INTO telemetry.point_values (time, asset_id, point_key, value) VALUES (now(), $1, $2, 1000000)", [
            org.assetIds[0],
            pointKeyOf(ruleId),
          ]);
        }
        if (engine === "evaluate-now") {
          const service = new RulesService(tx, tx, stubVocabularies(), raiser, notifications, new MasterDataAuditService(tx, tx));
          await service.evaluateEnabledRules(ACTOR, null);
        } else {
          const own = new Set<string>(rules);
          await runRuleSweep({
            readRules: async () => (await tx.transaction((inner) => selectRuleRows(inner))).filter((row) => own.has(row.id)),
            loadSamples: (rows) => batchedLatestPointValues(tx, rows),
            raiser,
            notifications,
            stampEvaluated: (organizationId, ids, at) => withTenant(tx, organizationId, (inner) => stampRulesEvaluated(inner, ids, at)),
            logger,
            now: Date.now,
          });
        }
      }

      // The twin's row is the drain marker (see the file doc).
      await until(async () => (await deliveriesOf(pgq, org.otherRuleId)).length === 1, {
        timeoutMs: 15_000,
        label: `${engine}: the twin's delivery row`,
      });
      // Then three round trips on this one connection: any query a dispatch for R1 queued has run.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      for (let i = 0; i < 3; i += 1) await tx.execute(sql`SELECT 1`);

      const sentFor = (ruleId: string): number => sent.filter((message) => message.ruleId === ruleId).length;
      outcome = {
        windowId,
        covered: { alarm: await alarmOf(pgq, org.ruleId), deliveries: await deliveriesOf(pgq, org.ruleId), sent: sentFor(org.ruleId) },
        twin: { alarm: await alarmOf(pgq, org.otherRuleId), deliveries: await deliveriesOf(pgq, org.otherRuleId), sent: sentFor(org.otherRuleId) },
      };
      tx.rollback();
    })
    .catch((err: unknown) => {
      if (!is(err, TransactionRollbackError)) throw err;
    });
  return outcome ?? fail(`${engine}: the scenario never ran`);
}

/** Inside the window: a stamped alarm, and nobody told — zero ledger rows, nothing sent. */
export function assertCoveredRaiseIsStampedAndSilent(outcome: GapOutcome, engine: Engine): void {
  const { covered, windowId } = outcome;
  expect(covered.alarm, `${engine}: the covered rule still raises its alarm (it is listed, not dropped)`).toBeDefined();
  expect(covered.alarm?.stamped, `${engine}: the alarm is stamped`).toBe(true);
  expect(covered.alarm?.suppressed_by_window_id, `${engine}: by the window`).toBe(windowId);
  expect(covered.deliveries, `${engine}: a suppressed raise leaves ZERO notification_deliveries rows`).toEqual([]);
  expect(covered.sent, `${engine}: and the transport saw nothing`).toBe(0);
}

/** The positive twin: no window names it, so its raise is unstamped and leaves one `sent` row. */
export function assertTwinRaiseNotifiesOnce(outcome: GapOutcome, engine: Engine): void {
  const { twin } = outcome;
  expect(twin.alarm, `${engine}: the twin raised`).toBeDefined();
  expect(twin.alarm?.stamped, `${engine}: the twin is not stamped`).toBe(false);
  expect(twin.alarm?.suppressed_by_window_id).toBeNull();
  expect(twin.deliveries, `${engine}: the twin leaves exactly one sent row`).toEqual(["sent"]);
  expect(twin.sent).toBe(1);
}

// ---------------------------------------------------------------------------
// The one-transaction test
// ---------------------------------------------------------------------------

export type OneTransactionFixture = {
  /** Superuser — fixtures, reads and the LISTEN. */
  readonly admin: pg.Pool;
  /** The raiser's pool (`bms_tenant`). */
  readonly tenantDb: BmsDb;
  /** A committed organization with an active window over its A1. */
  readonly org: CoverOrganization;
};

/**
 * `db` with every `select` made to throw, on the pool handle and on every
 * transaction it opens. In `AlarmRaiser.raise` the only `select` is the cover
 * read (the insert, the trace and the `pg_notify` are `insert` and `execute`),
 * so this is "the cover read fails" wherever the raiser runs it.
 */
function coverReadThrows(db: BmsDb): BmsDb {
  const refuse = (): never => {
    throw new Error("F4.359 one-transaction test: the cover read failed");
  };
  const wrap = <T extends object>(target: T, onTransaction: boolean): T =>
    new Proxy(target, {
      get(inner, property, receiver) {
        if (property === "select") return refuse;
        const value: unknown = Reflect.get(inner, property, receiver);
        if (onTransaction && property === "transaction" && typeof value === "function") {
          return (fn: (tx: BmsTx) => Promise<unknown>, config?: unknown) =>
            (value as (f: (tx: BmsTx) => Promise<unknown>, c?: unknown) => Promise<unknown>).call(inner, (tx) => fn(wrap(tx, true)), config);
        }
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(inner) : value;
      },
    });
  return wrap(db, true);
}

/** The `NOTIFY bms_alarms` payloads naming `organizationId`, heard while `body` runs — `LISTEN` is fleet-wide. */
async function notificationsFor(admin: pg.Pool, organizationId: string, body: () => Promise<void>): Promise<Array<Record<string, unknown>>> {
  const listener = await admin.connect();
  const heard: Array<Record<string, unknown>> = [];
  const onNotification = (msg: pg.Notification): void => {
    if (msg.channel !== ALARM_NOTIFY_CHANNEL || !msg.payload) return;
    const payload = JSON.parse(msg.payload) as Record<string, unknown>;
    if (payload.organizationId === organizationId) heard.push(payload);
  };
  listener.on("notification", onNotification);
  try {
    await listener.query(`LISTEN ${ALARM_NOTIFY_CHANNEL}`);
    await body();
    // A committed NOTIFY reaches a listener on another connection asynchronously.
    for (let i = 0; i < 25; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    await listener.query(`UNLISTEN ${ALARM_NOTIFY_CHANNEL}`);
  } finally {
    listener.off("notification", onNotification);
    listener.release();
  }
  return heard;
}

/**
 * Q1 (a) / D8: the cover read, the stamp and the `pg_notify` share the insert's
 * transaction. With the cover read failing, the raise rejects and leaves no
 * alarm row and no delivered `NOTIFY` — the row is never visible unstamped and
 * never announced. The same raise on the unwrapped raiser then commits and is
 * heard (the positive control for the listener).
 */
export async function assertCoverFailureRollsTheRaiseBack(fx: OneTransactionFixture): Promise<void> {
  const { admin, org } = fx;
  const rule = {
    id: org.ruleId,
    code: "F4359-ONE-TX",
    name: "F4.359 one-transaction rule",
    pointKey: "f4359_r1",
    severity: "warning",
    organizationId: org.organizationId,
    alarmMessage: null,
    unit: null,
  };
  let rejection: unknown;
  const heard = await notificationsFor(admin, org.organizationId, async () => {
    rejection = await new AlarmRaiser(coverReadThrows(fx.tenantDb)).raise(org.assetIds[0], org.organizationId, rule, 999_999).then(
      () => null,
      (err: unknown) => err,
    );
  });
  expect(String(rejection), "the raise rejects with the cover read's failure").toMatch(/the cover read failed/);
  const rows = await admin.query("SELECT id FROM bms.alarms WHERE organization_id = $1", [org.organizationId]);
  expect(rows.rows, "no alarm row survives a failed cover read").toEqual([]);
  expect(heard, "no NOTIFY was delivered for it").toEqual([]);

  const control = await notificationsFor(admin, org.organizationId, async () => {
    const result = await new AlarmRaiser(fx.tenantDb).raise(org.assetIds[0], org.organizationId, rule, 999_999);
    expect(result).toMatchObject({ raised: true, suppressed: true });
  });
  expect(control.map((n) => n.type), "the same raise, with a working cover read, is heard once").toEqual(["created"]);
}
