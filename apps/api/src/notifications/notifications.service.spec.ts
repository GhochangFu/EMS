import { BadRequestException } from "@nestjs/common";

import { buildDedupeKey } from "./dedupe-key";
import type {
  DeliveryResult,
  NotificationChannelRow,
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
};

/**
 * A fake `BmsDb` narrow enough for this service: it answers the rate-limit
 * SELECT with a settable count and records every delivery INSERT.
 */
function fakeDb(sentInLastHour = 0): {
  db: ConstructorParameters<typeof NotificationsService>[0];
  recorded: Recorded[];
  setCount: (n: number) => void;
  failInserts: (fail: boolean) => void;
} {
  const recorded: Recorded[] = [];
  let count = sentInLastHour;
  let insertsFail = false;

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ count }]),
      }),
    }),
    insert: () => ({
      values: (row: Recorded) => {
        if (insertsFail) return Promise.reject(new Error("ledger unavailable"));
        recorded.push({
          status: row.status,
          error: row.error,
          channelId: row.channelId,
          dedupeKey: row.dedupeKey,
          organizationId: row.organizationId,
        });
        return Promise.resolve();
      },
    }),
  } as unknown as ConstructorParameters<typeof NotificationsService>[0];

  return {
    db,
    recorded,
    setCount: (n) => {
      count = n;
    },
    failInserts: (fail) => {
      insertsFail = fail;
    },
  };
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
 * keeps. The database and every transport are fakes; no socket, no Postgres.
 */
export async function runNotificationsServiceTests(): Promise<void> {
  // --- the transition dedupe ----------------------------------------------
  //
  // Decision 7's first bound. `raised: false` means alarms_open_per_rule_uidx
  // caught a rule already open for that asset: the condition still matches,
  // nothing transitioned, nobody needs telling again.
  {
    const { db, recorded } = fakeDb();
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
    // The skip is RECORDED. "We chose not to send" and "nothing happened" must
    // not look the same in the ledger (decision 4).
    assert(recorded.length === 1, `the skip must be recorded, got ${recorded.length} rows`);
    assert(recorded[0]?.status === "skipped_deduped", "the row carries the skip reason");
    assert(
      recorded[0]?.dedupeKey === buildDedupeKey(input()),
      "the row carries the dedupe key it was skipped under",
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
    const { db, recorded } = fakeDb();
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
