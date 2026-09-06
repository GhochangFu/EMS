import { BadRequestException, Logger } from "@nestjs/common";

import { buildDedupeKey } from "./dedupe-key";
import type {
  DeliveryResult,
  NotificationChannelRow,
  NotificationMessage,
  NotificationTransport,
} from "./notification-transport";
import { buildConfig } from "./notifications.config";
import {
  NotificationsService,
  type DispatchEvent,
  type DispatchInput,
} from "./notifications.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const RULE_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "aaaaaaaa-0000-0000-0000-00000000000a";

function channelRow(overrides: Partial<NotificationChannelRow> = {}): NotificationChannelRow {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    organizationId: ORG_ID,
    code: "ops-webhook",
    name: "Operations webhook",
    kind: "webhook",
    config: { url: "https://hooks.example.com/x" },
    secret: null,
    secretState: "none",
    enabled: true,
    ...overrides,
  };
}

function input(overrides: Partial<DispatchInput> = {}): DispatchInput {
  return {
    ruleId: RULE_ID,
    ruleCode: "UPS-BATT-TEMP",
    // E7.1c: a dispatch always has a rule, and automationRules.organizationId
    // has been NOT NULL since 0047 — this is the rule's org, never the
    // channel's (the channel may be a fleet-managed global; the delivery
    // still must attribute to the rule that raised it).
    organizationId: ORG_ID,
    alarmId: "22222222-2222-2222-2222-222222222222",
    severity: "critical",
    message: "UPS-1 battery temperature is 48C.",
    raised: true,
    ...overrides,
  };
}

type Recorded = {
  status: string;
  error: string | null;
  channelId: string;
  dedupeKey: string;
  organizationId: string;
  alarmId: string | null;
};

/**
 * A fake `BmsDb` narrow enough for this service: it answers the rate-limit
 * SELECT with a settable count, answers each existence SELECT from its own
 * queue of booleans, answers the cleared-recipient SELECT from a settable row
 * list, and records every delivery INSERT.
 *
 * **The SELECTs are told apart by their projection, not by their `WHERE`.**
 * Drizzle hands the fake an opaque SQL object for the `WHERE`, so it can see
 * nothing of it: the rate-limit read asks for `{ count }` and ends at
 * `.where()`; `hasRecordedSkip` asks for `{ id }` and adds `.limit(1)`;
 * `F3.10`'s `hasRecordedDelivery` asks for `{ status }` and adds `.limit(1)`;
 * `sentChannelIdsForAlarm` asks for `{ channelId }` and ends at `.where()`.
 * Each projection has its own queue and counter, so a read that reached the
 * wrong branch shows up as the wrong counter moving — the `F3.46` lesson: a
 * fake that fed one boolean queue to two reads passed for the wrong reason.
 * An unknown projection throws rather than answer from anyone's queue. That
 * the real `WHERE` of each read names this channel, this organization, this
 * key (and, for the skip, `skipped_deduped`; for the recipients, this alarm
 * and `sent`) is proven against Postgres in `storm-control.integration.spec.ts`,
 * which is where it can be.
 */
function fakeDb(sentInLastHour = 0): {
  db: ConstructorParameters<typeof NotificationsService>[0];
  recorded: Recorded[];
  /** Per-fake call counters — not a lifetime statistic (§4.6). */
  reads: { rateLimit: number; skipExists: number; deliveryExists: number; sentChannels: number };
  setCount: (n: number) => void;
  /** Answers for the next `{ id }` (skip) existence reads, in dispatch order. Empty = `false`. */
  setSkipRecorded: (...values: boolean[]) => void;
  failSkipReads: (fail: boolean) => void;
  /** Answers for the next `{ status }` (event) existence reads, in dispatch order. Empty = `false`. */
  setDeliveryRecorded: (...values: boolean[]) => void;
  failDeliveryReads: (fail: boolean) => void;
  /** The rows every `{ channelId }` read returns, duplicates and all. */
  setSentChannels: (...channelIds: string[]) => void;
  failInserts: (fail: boolean) => void;
} {
  const recorded: Recorded[] = [];
  const reads = { rateLimit: 0, skipExists: 0, deliveryExists: 0, sentChannels: 0 };
  const skipQueue: boolean[] = [];
  const deliveryQueue: boolean[] = [];
  const sentChannels: string[] = [];
  let count = sentInLastHour;
  let insertsFail = false;
  let skipReadsFail = false;
  let deliveryReadsFail = false;

  const db = {
    select: (projection: Record<string, unknown>) => {
      if ("count" in projection) {
        return {
          from: () => ({
            where: () => {
              reads.rateLimit += 1;
              return Promise.resolve([{ count }]);
            },
          }),
        };
      }
      if ("id" in projection) {
        return {
          from: () => ({
            where: () => ({
              limit: () => {
                reads.skipExists += 1;
                if (skipReadsFail) return Promise.reject(new Error("ledger unavailable"));
                return Promise.resolve(skipQueue.shift() === true ? [{ id: "x" }] : []);
              },
            }),
          }),
        };
      }
      if ("status" in projection) {
        return {
          from: () => ({
            where: () => ({
              limit: () => {
                reads.deliveryExists += 1;
                if (deliveryReadsFail) return Promise.reject(new Error("ledger unavailable"));
                return Promise.resolve(deliveryQueue.shift() === true ? [{ status: "sent" }] : []);
              },
            }),
          }),
        };
      }
      if ("channelId" in projection) {
        return {
          from: () => ({
            where: () => {
              reads.sentChannels += 1;
              return Promise.resolve(sentChannels.map((channelId) => ({ channelId })));
            },
          }),
        };
      }
      throw new Error(`fakeDb: no queue for projection {${Object.keys(projection).join(", ")}}`);
    },
    insert: () => ({
      values: (row: Recorded) => {
        if (insertsFail) return Promise.reject(new Error("ledger unavailable"));
        recorded.push({
          status: row.status,
          error: row.error,
          channelId: row.channelId,
          dedupeKey: row.dedupeKey,
          organizationId: row.organizationId,
          alarmId: row.alarmId,
        });
        return Promise.resolve();
      },
    }),
  } as unknown as ConstructorParameters<typeof NotificationsService>[0];

  return {
    db,
    recorded,
    reads,
    setCount: (n) => {
      count = n;
    },
    setSkipRecorded: (...values) => {
      skipQueue.length = 0;
      skipQueue.push(...values);
    },
    failSkipReads: (fail) => {
      skipReadsFail = fail;
    },
    setDeliveryRecorded: (...values) => {
      deliveryQueue.length = 0;
      deliveryQueue.push(...values);
    },
    failDeliveryReads: (fail) => {
      deliveryReadsFail = fail;
    },
    setSentChannels: (...channelIds) => {
      sentChannels.length = 0;
      sentChannels.push(...channelIds);
    },
    failInserts: (fail) => {
      insertsFail = fail;
    },
  };
}

/**
 * Runs `run` with `Logger.prototype.warn` captured, and restores it after.
 *
 * The service builds its own `Logger` (no injection seam, on purpose — the
 * constructor is the module's), so the one way to see a warn line from a spec
 * is the prototype. Scoped to the call and restored in `finally`, so a failing
 * assertion inside `run` cannot leave the next case deaf.
 */
async function captureWarnings<T>(
  run: () => Promise<T>,
): Promise<{ result: T; warnings: string[] }> {
  const warnings: string[] = [];
  const original = Logger.prototype.warn;
  Logger.prototype.warn = function warn(message: unknown): void {
    warnings.push(String(message));
  };
  try {
    return { result: await run(), warnings };
  } finally {
    Logger.prototype.warn = original;
  }
}

function fakeTransport(kind: string, behaviour: () => Promise<DeliveryResult>) {
  const sent: NotificationMessage[] = [];
  const transport: NotificationTransport = {
    kind,
    send: (message) => {
      sent.push(message);
      return behaviour();
    },
  };
  return { transport, sent };
}

type Deps = ConstructorParameters<typeof NotificationsService>;

function serviceWith(options: {
  db: Deps[0];
  channels: NotificationChannelRow[] | (() => Promise<NotificationChannelRow[]>);
  webhook: NotificationTransport;
  log?: NotificationTransport;
  email?: NotificationTransport;
  env?: NodeJS.ProcessEnv;
}): NotificationsService {
  const loader =
    typeof options.channels === "function"
      ? options.channels
      : () => Promise.resolve(options.channels as NotificationChannelRow[]);
  const channelsService = { loadForRule: loader } as unknown as Deps[1];
  const fallback = options.log ?? fakeTransport("log", () =>
    Promise.resolve({ status: "skipped_unconfigured", error: null }),
  ).transport;
  const email = options.email ?? fallback;
  return new NotificationsService(
    options.db,
    channelsService,
    fallback as Deps[2],
    email as Deps[3],
    options.webhook as Deps[4],
    buildConfig(options.env ?? {}),
  );
}

/**
 * `F3.8` U6 — dedupe, the hourly ceiling, and the promise `dispatch` always
 * keeps; `F3.10` U2 — the explicit-channel entry point, the two event kinds
 * and their once-per-key ledger read. The database and every transport are
 * fakes; no socket, no Postgres.
 */
export async function runNotificationsServiceTests(): Promise<void> {
  // --- the transition dedupe ----------------------------------------------
  //
  // Decision 7's first bound. `raised: false` means alarms_open_per_rule_uidx
  // caught a rule already open for that asset: the condition still matches,
  // nothing transitioned, nobody needs telling again.
  {
    const { db, recorded, reads, setSkipRecorded } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({ db, channels: [channelRow()], webhook: webhook.transport });

    const results = await service.dispatch(input({ raised: false }));
    assert(webhook.sent.length === 0, "a non-transition must send nothing");
    assert(
      results.every((r) => r.status === "skipped_deduped"),
      `every result must be skipped_deduped, got ${results.map((r) => r.status).join(",")}`,
    );
    // The skip is RECORDED — "we chose not to send" and "nothing happened" must
    // not look the same in the ledger (decision 4) — and, since `F3.46`, ONCE
    // per (channel, organization, dedupe key).
    assert(recorded.length === 1, `the skip must be recorded, got ${recorded.length} rows`);
    assert(recorded[0]?.status === "skipped_deduped", "the row carries the skip reason");
    assert(
      recorded[0]?.dedupeKey === buildDedupeKey(input()),
      "the row carries the dedupe key it was skipped under",
    );

    // `F3.46`: press Evaluate now again against the same unchanged plant. The
    // ledger already answers this key, so the refusal answers from it — same
    // result, same silence at the transport, no second row.
    setSkipRecorded(true);
    const again = await service.dispatch(input({ raised: false }));
    assert(
      again.length === 1 && again[0]?.status === "skipped_deduped",
      `the repeat refusal is still one skipped_deduped result, got ${again
        .map((r) => r.status)
        .join(",")}`,
    );
    assert(again[0]?.error === null, "a suppressed refusal is not an error");
    assert(
      recorded.length === 1,
      `the refusal must be recorded once, not once per press; got ${recorded.length} rows`,
    );
    assert(webhook.sent.length === 0, "a suppressed refusal still sends nothing");
    assert(
      reads.skipExists === 2,
      `both refusals must read the ledger before writing, got ${reads.skipExists}`,
    );
  }

  // --- `F3.46`: the suppression is per channel -----------------------------
  //
  // Two channels joined to one rule. One already holds the row, the other does
  // not: both report the refusal, only the second writes.
  {
    const { db, recorded, setSkipRecorded } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({
      db,
      channels: [
        channelRow({ id: "aaaaaaaa-0000-0000-0000-000000000001", code: "a" }),
        channelRow({ id: "aaaaaaaa-0000-0000-0000-000000000002", code: "b" }),
      ],
      webhook: webhook.transport,
    });

    setSkipRecorded(true, false);
    const results = await service.dispatch(input({ raised: false }));
    assert(results.length === 2, `two channels, two results, got ${results.length}`);
    assert(
      results.every((r) => r.status === "skipped_deduped"),
      `both channels report the refusal, got ${results.map((r) => r.status).join(",")}`,
    );
    assert(
      recorded.length === 1,
      `only the channel with no row yet writes one, got ${recorded.length}`,
    );
    assert(
      recorded[0]?.channelId === "aaaaaaaa-0000-0000-0000-000000000002",
      `the row belongs to channel b, got ${String(recorded[0]?.channelId)}`,
    );
  }

  // --- `F3.46` D2: an unreadable ledger writes the row, never sends --------
  //
  // "The ledger could not be read" must not become indistinguishable from "we
  // already recorded this". The fallback is today's write — bounded by today's
  // growth — never a send, and never a rejection out of `dispatch`.
  {
    const { db, recorded, reads, failSkipReads } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({ db, channels: [channelRow()], webhook: webhook.transport });

    failSkipReads(true);
    const results = await service.dispatch(input({ raised: false }));
    // Without this line the case passes against a service that never reads:
    // the flag would do nothing and every assertion below would still hold.
    assert(
      reads.skipExists === 1,
      `the ledger read must have been attempted, got ${reads.skipExists}`,
    );
    assert(
      results.length === 1 && results[0]?.status === "skipped_deduped",
      `an unreadable ledger still reports the refusal, got ${results
        .map((r) => r.status)
        .join(",")}`,
    );
    assert(
      results[0]?.error === null,
      "the read failure is the service's problem, not the caller's",
    );
    assert(
      recorded.length === 1 && recorded[0]?.status === "skipped_deduped",
      `the refusal falls back to being written, got ${recorded.length} rows`,
    );
    assert(webhook.sent.length === 0, "a failed dedupe read must never become a send");
  }

  // --- `F3.46`: a raise is never affected ----------------------------------
  //
  // The existence read lives on the refusal path only. A transition still pays
  // for the ceiling read and nothing else.
  {
    const { db, recorded, reads } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({ db, channels: [channelRow()], webhook: webhook.transport });

    const results = await service.dispatch(input({ raised: true }));
    assert(results[0]?.status === "sent", "a raise still sends");
    assert(
      reads.skipExists === 0,
      `a raise must not read the dedupe ledger, got ${reads.skipExists} reads`,
    );
    assert(reads.rateLimit === 1, `the hourly ceiling is still read once, got ${reads.rateLimit}`);
    assert(
      recorded.length === 1 && recorded[0]?.status === "sent",
      `one sent row, got ${recorded.length}`,
    );
  }

  // --- the hourly ceiling --------------------------------------------------
  {
    const { db, recorded, setCount } = fakeDb(0);
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({
      db,
      channels: [channelRow()],
      webhook: webhook.transport,
      env: { NOTIFY_RATE_LIMIT_PER_HOUR: "3" },
    });

    setCount(2);
    let results = await service.dispatch(input());
    assert(results[0]?.status === "sent", "under the ceiling, it sends");

    setCount(3);
    results = await service.dispatch(input());
    assert(
      results[0]?.status === "skipped_rate_limited",
      `at the ceiling it must skip, got ${String(results[0]?.status)}`,
    );
    assert(webhook.sent.length === 1, "the rate-limited attempt must not reach the transport");
    assert(
      recorded.filter((r) => r.status === "skipped_rate_limited").length === 1,
      "the rate-limited skip is recorded too",
    );
  }

  // --- dispatch never rejects ---------------------------------------------
  //
  // Decision 1: it is called fire-and-forget from the raise path, so a
  // rejection would land in an unhandled promise instead of in front of anyone.
  {
    const { db, recorded } = fakeDb();
    const throwing = fakeTransport("webhook", () => Promise.reject(new Error("boom")));
    const service = serviceWith({ db, channels: [channelRow()], webhook: throwing.transport });

    const results = await service.dispatch(input());
    assert(results[0]?.status === "failed", `a throwing transport is a failed delivery`);
    assert(
      (results[0]?.error ?? "").includes("boom"),
      `the reason is kept: ${String(results[0]?.error)}`,
    );
    assert(recorded.length === 1, "a failed delivery is still a row");
  }
  {
    // The channel load itself failing must not reject either.
    const { db } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({
      db,
      channels: () => Promise.reject(new Error("database down")),
      webhook: webhook.transport,
    });
    const results = await service.dispatch(input());
    assert(results.length === 0, "an unreadable channel list dispatches nothing");
  }
  {
    // And neither must a ledger write that fails after a successful send.
    const fake = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({
      db: fake.db,
      channels: [channelRow()],
      webhook: webhook.transport,
    });
    fake.failInserts(true);
    const results = await service.dispatch(input());
    assert(results[0]?.status === "sent", "the send happened and is reported");
  }

  // --- a rule with no channels --------------------------------------------
  {
    const { db, recorded } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });
    const results = await service.dispatch(input());
    assert(results.length === 0, "no channels, no results");
    assert(recorded.length === 0, "no channels, no rows — channel_id is NOT NULL");
    assert(webhook.sent.length === 0, "no channels, nothing sent");
  }

  // --- transport selection -------------------------------------------------
  {
    const { db } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const email = fakeTransport("email", () => Promise.resolve({ status: "sent", error: null }));
    const log = fakeTransport("log", () =>
      Promise.resolve({ status: "skipped_unconfigured", error: null }),
    );

    // No SMTP_HOST: the stand-in takes the email channel (decision 5).
    const unconfigured = serviceWith({
      db,
      channels: [channelRow({ kind: "email", code: "ops-email" })],
      webhook: webhook.transport,
      email: email.transport,
      log: log.transport,
    });
    let results = await unconfigured.dispatch(input());
    assert(
      results[0]?.status === "skipped_unconfigured",
      "an email channel with no SMTP_HOST must skip",
    );
    assert(email.sent.length === 0, "the email transport must not be used when unconfigured");
    assert(log.sent.length === 1, "the stand-in logged it");

    // With SMTP_HOST, the real transport takes it.
    const configured = serviceWith({
      db,
      channels: [channelRow({ kind: "email", code: "ops-email" })],
      webhook: webhook.transport,
      email: email.transport,
      log: log.transport,
      env: { SMTP_HOST: "mailpit" },
    });
    results = await configured.dispatch(input());
    assert(results[0]?.status === "sent", "a configured email channel sends");
    assert(email.sent.length === 1, "through the email transport");

    // An unknown kind falls to the stand-in rather than throwing.
    const unknown = serviceWith({
      db,
      channels: [channelRow({ kind: "carrier-pigeon", code: "pigeon" })],
      webhook: webhook.transport,
      email: email.transport,
      log: log.transport,
    });
    results = await unknown.dispatch(input());
    assert(
      results[0]?.status === "skipped_unconfigured",
      "an unimplemented kind is a recorded skip, not a crash",
    );
  }

  // --- every channel of a rule gets its own attempt ------------------------
  {
    const { db, recorded } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({
      db,
      channels: [
        channelRow({ id: "aaaaaaaa-0000-0000-0000-000000000001", code: "a" }),
        channelRow({ id: "aaaaaaaa-0000-0000-0000-000000000002", code: "b" }),
      ],
      webhook: webhook.transport,
    });
    const results = await service.dispatch(input());
    assert(results.length === 2, `two channels, two results, got ${results.length}`);
    assert(recorded.length === 2, "two rows");
    assert(
      new Set(recorded.map((r) => r.channelId)).size === 2,
      "each row names its own channel",
    );
    assert(
      recorded.every((r) => r.organizationId === ORG_ID),
      "every row is stamped with the rule's organization (E7.1c)",
    );
  }

  // --- sendTest refuses a fleet-wide (NULL-org) channel outright -----------
  //
  // `E7.1c` Blocker 1's ruling: `record()`'s insert is NOT NULL on
  // organizationId, and its own catch only logs. Without this explicit 400,
  // pressing Send Test on a global channel would send the real message and
  // write no ledger row — both directions are asserted, not just the throw.
  {
    const { db, recorded, reads } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    let threw = false;
    try {
      await service.sendTest(channelRow({ organizationId: null }));
    } catch (err) {
      threw = err instanceof BadRequestException;
    }
    assert(threw, "sendTest on a NULL-org channel must throw BadRequestException");
    assert(webhook.sent.length === 0, "a refused test must never reach the transport");
    assert(recorded.length === 0, "a refused test must write no ledger row");

    // The happy path on an org-scoped channel writes a row carrying that org.
    const result = await service.sendTest(channelRow({ organizationId: ORG_ID }));
    assert(result.status === "sent", "an org-scoped channel's test still sends");
    assert(webhook.sent.length === 1, "the org-scoped test reached the transport");
    assert(
      recorded.length === 1 && recorded[0]?.organizationId === ORG_ID,
      "the ledger row carries the channel's organization",
    );
    // `F3.46`: a test passes `dedupeKey: null` and never enters the refusal
    // branch, so it never reads the dedupe ledger either.
    assert(
      reads.skipExists === 0,
      `sendTest must not read the dedupe ledger, got ${reads.skipExists} reads`,
    );
  }

  // --- the dedupe key ------------------------------------------------------
  {
    const withAlarm = buildDedupeKey({ ruleId: RULE_ID, alarmId: "a1", severity: "critical" });
    const sameAgain = buildDedupeKey({ ruleId: RULE_ID, alarmId: "a1", severity: "critical" });
    const newAlarm = buildDedupeKey({ ruleId: RULE_ID, alarmId: "a2", severity: "critical" });
    assert(withAlarm === sameAgain, "the same event keys the same");
    assert(withAlarm !== newAlarm, "a new alarm row is a new event");
    assert(
      buildDedupeKey({ ruleId: "x".repeat(400), alarmId: null, severity: null }).length <= 255,
      "the key is clamped to the column width",
    );
  }

  // =========================================================================
  // `F3.10` U2 (ADR 0057 decisions 9 and 10)
  // =========================================================================

  const channelA = channelRow({ id: "aaaaaaaa-0000-0000-0000-000000000001", code: "a" });
  const channelB = channelRow({ id: "aaaaaaaa-0000-0000-0000-000000000002", code: "b" });
  const eventInput = (event: DispatchEvent, overrides: Partial<DispatchInput> = {}) =>
    input({ ruleCode: "RULE-1", severity: "warning", raised: true, event, ...overrides });

  // --- 2. `dispatchToChannels` never asks for the rule's channels ----------
  //
  // The sweep hands it the step's channels (or the cleared recipients); a
  // `loadForRule` here would send an escalation to the rule's raise channels
  // instead of the step's. Results come back one per channel, in the order
  // given, not code order.
  {
    const { db, recorded } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    let loads = 0;
    const service = serviceWith({
      db,
      channels: () => {
        loads += 1;
        return Promise.resolve([channelRow()]);
      },
      webhook: webhook.transport,
    });

    const results = await service.dispatchToChannels([channelB, channelA], input());
    assert(loads === 0, `dispatchToChannels must not call loadForRule, got ${loads} calls`);
    assert(results.length === 2, `two channels, two results, got ${results.length}`);
    assert(
      results.every((r) => r.status === "sent"),
      `both sent, got ${results.map((r) => r.status).join(",")}`,
    );
    assert(
      recorded.map((r) => r.channelId).join(",") === `${channelB.id},${channelA.id}`,
      "one row per channel, in the order the caller gave",
    );
    assert(recorded.every((r) => r.organizationId === ORG_ID), "stamped with the rule's org");
    // And the raise path still goes through the loader: same input, one load.
    await service.dispatch(input());
    assert(loads === 1, `dispatch still loads the rule's channels, got ${loads} loads`);
  }

  // --- 3. An event already in the ledger is answered from it ---------------
  //
  // Decision 10: the read comes before the send, and the original row IS the
  // record — nothing is written, nothing is sent.
  {
    const { db, recorded, reads, setDeliveryRecorded } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    setDeliveryRecorded(true);
    const results = await service.dispatchToChannels(
      [channelRow()],
      eventInput({ kind: "escalation", step: 1 }),
    );
    assert(
      results.length === 1 && results[0]?.status === "skipped_deduped",
      `an already-sent step is skipped_deduped, got ${results.map((r) => r.status).join(",")}`,
    );
    assert(results[0]?.error === null, "an answered event is not an error");
    assert(recorded.length === 0, `the original row is the record; got ${recorded.length} new rows`);
    assert(webhook.sent.length === 0, "an already-sent step must not reach the transport");
    assert(reads.deliveryExists === 1, `one ledger read, got ${reads.deliveryExists}`);
  }

  // --- 4. A step not yet in the ledger is sent, keyed and attributed -------
  {
    const { db, recorded, reads, setDeliveryRecorded } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    setDeliveryRecorded(false);
    const step = eventInput({ kind: "escalation", step: 1 });
    const results = await service.dispatchToChannels([channelRow()], step);
    assert(results[0]?.status === "sent", `a new step sends, got ${String(results[0]?.status)}`);
    assert(reads.deliveryExists === 1, `the ledger was asked first, got ${reads.deliveryExists}`);
    assert(
      webhook.sent[0]?.subject === "escalation 1 · warning: RULE-1",
      `the subject names the step, got ${String(webhook.sent[0]?.subject)}`,
    );
    assert(webhook.sent[0]?.body === step.message, "the body is the caller's message, untouched");
    assert(webhook.sent[0]?.alarmId === step.alarmId, "the transport sees the alarm");
    assert(recorded.length === 1 && recorded[0]?.status === "sent", "one sent row");
    assert(
      recorded[0]?.dedupeKey === buildDedupeKey(step) && recorded[0].dedupeKey.endsWith(":escalation:1"),
      `the row's key carries the step, got ${String(recorded[0]?.dedupeKey)}`,
    );
    assert(recorded[0]?.alarmId === step.alarmId, "the row is attributed to the alarm");
  }

  // --- 5. The cleared message -------------------------------------------------
  {
    const { db, recorded } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    const cleared = eventInput({ kind: "cleared" });
    const results = await service.dispatchToChannels([channelRow()], cleared);
    assert(results[0]?.status === "sent", "the cleared message sends");
    assert(
      webhook.sent[0]?.subject === "cleared · warning: RULE-1",
      `the subject says cleared, got ${String(webhook.sent[0]?.subject)}`,
    );
    assert(
      recorded[0]?.dedupeKey.endsWith(":cleared") === true,
      `the row's key says cleared, got ${String(recorded[0]?.dedupeKey)}`,
    );
  }

  // --- 6. An unreadable ledger on an event: no row, no send, one warn ------
  //
  // D3: writing a row would poison the key for every later tick; sending
  // would risk the duplicate the read exists to prevent. The failure is
  // reported and the next tick retries. This is the opposite of the raise
  // path's fallback (case `F3.46` D2 above), and deliberately so.
  {
    const { db, recorded, reads, failDeliveryReads } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    failDeliveryReads(true);
    const step = eventInput({ kind: "escalation", step: 2 });
    const { result: results, warnings } = await captureWarnings(() =>
      service.dispatchToChannels([channelRow({ code: "ops-webhook" })], step),
    );
    assert(reads.deliveryExists === 1, `the read was attempted, got ${reads.deliveryExists}`);
    assert(
      results.length === 1 && results[0]?.status === "failed",
      `an unreadable ledger fails the event, got ${results.map((r) => r.status).join(",")}`,
    );
    assert(
      results[0]?.error === "delivery ledger read failed",
      `the reason is named, got ${String(results[0]?.error)}`,
    );
    assert(recorded.length === 0, `no row on a failed event read, got ${recorded.length}`);
    assert(webhook.sent.length === 0, "a failed event read must never become a send");
    assert(warnings.length === 1, `exactly one warn line, got ${warnings.length}`);
    const warned = warnings[0] ?? "";
    assert(
      warned.includes("channel=ops-webhook") && warned.includes("rule=RULE-1"),
      `the warn names the channel and rule codes, got: ${warned}`,
    );
    assert(!warned.includes(step.message), "§9.6: the warn never carries the alarm text");
  }

  // --- 7. An event still meets the hourly ceiling ---------------------------
  //
  // ADR 0041 decision 7 applies to every send; a step is a send. Recorded as
  // `skipped_rate_limited` under the event's key — which, by owner ruling Q7,
  // is then in the ledger and answers every later tick.
  {
    const { db, recorded, setCount, setDeliveryRecorded } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({
      db,
      channels: [],
      webhook: webhook.transport,
      env: { NOTIFY_RATE_LIMIT_PER_HOUR: "1" },
    });

    setDeliveryRecorded(false);
    setCount(1);
    const results = await service.dispatchToChannels(
      [channelRow()],
      eventInput({ kind: "escalation", step: 1 }),
    );
    assert(
      results[0]?.status === "skipped_rate_limited",
      `at the ceiling an event skips, got ${String(results[0]?.status)}`,
    );
    assert(webhook.sent.length === 0, "the rate-limited step must not reach the transport");
    assert(
      recorded.length === 1 &&
        recorded[0]?.status === "skipped_rate_limited" &&
        recorded[0].dedupeKey.endsWith(":escalation:1"),
      "the rate-limited skip is recorded under the event's key",
    );
  }

  // --- 8. The event branch comes first; `raised` is not consulted ----------
  //
  // `raised: false` with an event set is not an input production builds. The
  // order still matters: if the raise-path refusal ran first, an event would
  // read the skip ledger, find nothing, and write a `skipped_deduped` row
  // under the event's key — after which decision 10 would never send it.
  {
    const { db, recorded, reads } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    const results = await service.dispatchToChannels(
      [channelRow()],
      eventInput({ kind: "escalation", step: 1 }, { raised: false }),
    );
    assert(reads.skipExists === 0, `an event must not read the skip ledger, got ${reads.skipExists}`);
    assert(reads.deliveryExists === 1, `an event reads its own ledger, got ${reads.deliveryExists}`);
    assert(
      results[0]?.status === "sent" && recorded[0]?.status === "sent",
      `an event with no row sends whatever \`raised\` says, got ${String(results[0]?.status)}`,
    );
  }

  // --- 9. The cleared recipients: every channel with a `sent` row, once ----
  {
    const { db, reads, setSentChannels } = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    setSentChannels(channelA.id, channelB.id, channelA.id);
    const ids = await service.sentChannelIdsForAlarm(input().alarmId as string, ORG_ID);
    assert(
      ids.join(",") === `${channelA.id},${channelB.id}`,
      `distinct channel ids in first-seen order, got ${ids.join(",")}`,
    );
    assert(reads.sentChannels === 1, `one read, got ${reads.sentChannels}`);

    setSentChannels();
    const none = await service.sentChannelIdsForAlarm(input().alarmId as string, ORG_ID);
    assert(none.length === 0, "an alarm nobody was told about clears to nobody");
  }
}
