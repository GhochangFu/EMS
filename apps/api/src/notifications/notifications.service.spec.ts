import { BadRequestException, Logger } from "@nestjs/common";

import { buildDedupeKey } from "./dedupe-key";
import type {
  DeliveryResult,
  NotificationChannelRow,
  NotificationMessage,
  NotificationTransport,
} from "./notification-transport";
import { buildConfig } from "./notifications.config";
import { NotificationsService, type DispatchInput } from "./notifications.service";

/*
 * The builders, the fake database and the warn capture below are exported for
 * `notifications.events.spec.ts`, which holds the `F3.10` event cases — this
 * file reached §4.5's cap when they were added here. A spec exporting to a
 * sibling spec is the shape `stock-catalog.spec.ts` already uses; a helper
 * module under `notifications/` would be compiled into `dist/` and counted in
 * the coverage denominator, which a `.spec.ts` is not.
 */

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export const RULE_ID = "11111111-1111-1111-1111-111111111111";
export const ORG_ID = "aaaaaaaa-0000-0000-0000-00000000000a";

/** A channel row in `ORG_ID`, webhook kind, enabled; every field overridable. */
export function channelRow(overrides: Partial<NotificationChannelRow> = {}): NotificationChannelRow {
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
    // `F3.50`: an OLD default on purpose. A channel nobody has edited since
    // this process started has `PROCESS_STARTED_AT` as its watermark, which is
    // the realistic production default and the one block 15 discriminates
    // against by overriding this.
    updatedAt: new Date("2020-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** A raise-path input for `RULE_ID` in `ORG_ID`, with an alarm; every field overridable. */
export function input(overrides: Partial<DispatchInput> = {}): DispatchInput {
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
 * SELECT with a settable count, answers each ledger SELECT from its own queue,
 * answers the cleared-recipient SELECT from a settable row list, and records
 * every delivery INSERT.
 *
 * **The SELECTs are told apart by their projection, not by their `WHERE`.**
 * Drizzle hands the fake an opaque SQL object for the `WHERE`, so it can see
 * nothing of it: the rate-limit read asks for `{ count }` and ends at
 * `.where()`; `hasRecordedSkip` asks for `{ id }` and adds `.limit(1)`;
 * `F3.10`'s `eventDeliveryBlocked` asks for `{ status }` and adds
 * `.limit(MAX_EVENT_ATTEMPTS)`; `sentChannelIdsForAlarm` asks for
 * `{ channelId }` and ends at `.where()`. Each projection has its own queue and
 * counter, so a read that reached the wrong branch shows up as the wrong
 * counter moving — the `F3.46` lesson: a fake that fed one boolean queue to two
 * reads passed for the wrong reason. The match is on the **exact** sorted key
 * set, never on "has this key": a future `{ id, status }` read must throw here
 * rather than land in the skip queue and pass for the wrong reason again. An
 * unknown projection throws. That the real `WHERE` of each read names this
 * channel, this organization, this key (and, for the skip, `skipped_deduped`;
 * for the recipients, this alarm and `sent`) is proven against Postgres in
 * `storm-control.integration.spec.ts`, which is where it can be.
 *
 * The `{ status }` queue holds one **row list** per read, and the fake honours
 * the `LIMIT` it is given by slicing that list — so the Q9 bound's "three
 * `failed` rows block" case only passes if the service really asks for three.
 *
 * **`F3.48`: the `{ status }` branch also records the condition it was given**,
 * and only that branch. It still cannot *apply* a `WHERE` — nothing above
 * changes — but ruling Q2's exclusion of `skipped_rate_limited` has to be IN
 * the SQL to be sound, and a rendered condition is the only thing a fake can
 * honestly check. What the exclusion *does* is proven against Postgres in
 * `storm-control.integration.spec.ts`, like every other `WHERE` here.
 */
export function fakeDb(sentInLastHour = 0): {
  db: ConstructorParameters<typeof NotificationsService>[0];
  recorded: Recorded[];
  /** Per-fake call counters — not a lifetime statistic (§4.6). */
  reads: { rateLimit: number; skipExists: number; deliveryExists: number; sentChannels: number };
  /** The `LIMIT` each `{ status }` read asked for, in read order. */
  deliveryLimits: number[];
  /** The `WHERE` each `{ status }` read was given, in read order — `F3.48` Q2's SQL assertion. */
  deliveryConditions: unknown[];
  setCount: (n: number) => void;
  failRateLimitReads: (fail: boolean) => void;
  /** Answers for the next `{ id }` (skip) existence reads, in dispatch order. Empty = `false`. */
  setSkipRecorded: (...values: boolean[]) => void;
  failSkipReads: (fail: boolean) => void;
  /** The statuses each of the next `{ status }` (event) reads finds, in dispatch order. Missing = none. */
  setDeliveryRecorded: (...rows: string[][]) => void;
  failDeliveryReads: (fail: boolean) => void;
  /** The rows every `{ channelId }` read returns, duplicates and all. */
  setSentChannels: (...channelIds: string[]) => void;
  failInserts: (fail: boolean) => void;
} {
  const recorded: Recorded[] = [];
  const reads = { rateLimit: 0, skipExists: 0, deliveryExists: 0, sentChannels: 0 };
  const deliveryLimits: number[] = [];
  const deliveryConditions: unknown[] = [];
  const skipQueue: boolean[] = [];
  const deliveryQueue: string[][] = [];
  const sentChannels: string[] = [];
  let count = sentInLastHour;
  let insertsFail = false;
  let rateLimitReadsFail = false;
  let skipReadsFail = false;
  let deliveryReadsFail = false;

  const db = {
    select: (projection: Record<string, unknown>) => {
      const shape = Object.keys(projection).sort().join(",");
      if (shape === "count") {
        return {
          from: () => ({
            where: () => {
              reads.rateLimit += 1;
              if (rateLimitReadsFail) return Promise.reject(new Error("ledger unavailable"));
              return Promise.resolve([{ count }]);
            },
          }),
        };
      }
      if (shape === "id") {
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
      if (shape === "status") {
        return {
          from: () => ({
            where: (condition: unknown) => ({
              limit: (n: number) => {
                reads.deliveryExists += 1;
                deliveryLimits.push(n);
                deliveryConditions.push(condition);
                if (deliveryReadsFail) return Promise.reject(new Error("ledger unavailable"));
                const statuses = deliveryQueue.shift() ?? [];
                return Promise.resolve(statuses.slice(0, n).map((status) => ({ status })));
              },
            }),
          }),
        };
      }
      if (shape === "channelId") {
        return {
          from: () => ({
            where: () => {
              reads.sentChannels += 1;
              return Promise.resolve(sentChannels.map((channelId) => ({ channelId })));
            },
          }),
        };
      }
      throw new Error(`fakeDb: no queue for projection {${shape}}`);
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
    deliveryLimits,
    deliveryConditions,
    setCount: (n) => {
      count = n;
    },
    failRateLimitReads: (fail) => {
      rateLimitReadsFail = fail;
    },
    setSkipRecorded: (...values) => {
      skipQueue.length = 0;
      skipQueue.push(...values);
    },
    failSkipReads: (fail) => {
      skipReadsFail = fail;
    },
    setDeliveryRecorded: (...rows) => {
      deliveryQueue.length = 0;
      deliveryQueue.push(...rows);
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
export async function captureWarnings<T>(
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

/** A transport of `kind` that records every message it is handed and answers with `behaviour()`. */
export function fakeTransport(kind: string, behaviour: () => Promise<DeliveryResult>) {
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

/** A service over the fake database, a stub channel loader and the given transports. */
export function serviceWith(options: {
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
 * keeps. `F3.10` U2's event cases (the explicit-channel entry point, the two
 * event kinds, the once-per-key ledger read and its retry bound) live in
 * `notifications.events.spec.ts`. The database and every transport are fakes;
 * no socket, no Postgres.
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
    // `F3.51` review (High): and the caller is TOLD the row did not land.
    // Every bound on a retry counts rows — `MAX_EVENT_ATTEMPTS` under the key,
    // `isOverHourlyLimit`'s trailing hour of `sent` ones — so a ledger that
    // refuses writes while serving reads leaves the raise retry with nothing
    // that can ever stop it. `rowLost` is the only channel that fact has out
    // of here, because decision 1 forbids rejecting.
    assert(
      results[0]?.rowLost === true,
      `a failed insert reports rowLost, got ${JSON.stringify(results[0])}`,
    );
    assert(
      results[0]?.channelId === channelRow().id,
      "and which channel it belongs to — the results are not index-aligned with the caller's list",
    );
  }
  {
    // The paired positive, on the same shape: an insert that LANDS reports
    // `rowLost: false`. Without it the assertion above would pass a mutation
    // that hard-coded `rowLost: true` everywhere and stopped the raise retry
    // dead on its first tick.
    const fake = fakeDb();
    const webhook = fakeTransport("webhook", () =>
      Promise.resolve({ status: "sent", error: null }),
    );
    const service = serviceWith({
      db: fake.db,
      channels: [channelRow()],
      webhook: webhook.transport,
    });
    const results = await service.dispatch(input());
    assert(fake.recorded.length === 1, `the row landed, got ${fake.recorded.length}`);
    assert(
      results[0]?.rowLost === false && results[0].status === "sent",
      `a written row reports rowLost false, got ${JSON.stringify(results[0])}`,
    );
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
}
