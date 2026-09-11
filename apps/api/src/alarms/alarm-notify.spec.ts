import type { AlarmListItem } from "@bms/shared";

import type { ListenerState, NotifyListener } from "../database/notify-listener";
import {
  flushListener,
  makeFakeListenerClient,
  type FakeListenerClient,
} from "../testing/fake-listener-client";
import { createAlarmNotifyListener } from "./alarm-notify";
import { encodeAlarmNotification } from "./alarm-notify-channel";
import { buildAlarmListenerDeps } from "./alarm-notify.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F3.11` / ADR 0064 decision 4 — `LISTEN bms_alarms` to
 * `AlarmsGateway.broadcastCreated`, through the generic loop.
 *
 * One exported function per row and one `it()` per row in the wrapper:
 * `assert` throws, so a bundled function reports only its first failure and
 * the three mutation checks the plan names (echoing the raw payload in the
 * undecodable warn; hard-coding the telemetry channel in the loop; dropping
 * the `.catch` on the read) could not tell which claim they reddened. The
 * valid-`created` row is the positive control for every refusal row below
 * it — a handler that did nothing at all would pass those and fail only
 * there.
 *
 * The gauge and counter wiring is asserted through `buildAlarmListenerDeps`
 * for the reason `telemetry-notify.service.ts` gives for `buildListenerDeps`:
 * a mutation that deleted the `onStateChange` hook once left every test
 * green, because nothing covered the wiring that drives the metric.
 */

const ALARM_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
/** A string that must never reach a log line. Distinct from any real field. */
const SENTINEL = "SECRET-F311";

const VALID_CREATED = encodeAlarmNotification({
  type: "created",
  alarmId: ALARM_ID,
  organizationId: ORG_ID,
});

function sampleRow(id: string): AlarmListItem {
  return {
    id,
    assetId: "asset-1",
    ruleKey: "kw_high",
    ruleId: "33333333-3333-4333-8333-333333333333",
    severity: "high",
    message: "kW above threshold",
    raisedAt: "2026-09-11T10:00:00.000Z",
    acknowledgedAt: null,
    acknowledgedBy: null,
    clearedAt: null,
    assetCode: "TX-01",
    assetName: "Transformer 1",
    siteName: "Site A",
  };
}

type AlarmHarness = {
  listener: NotifyListener;
  logs: string[];
  warns(): string[];
  reads: string[];
  broadcasts: AlarmListItem[];
  states: ListenerState[];
};

function makeAlarmHarness(
  fakes: FakeListenerClient[],
  options: {
    /** `call` is 1-based, so a row can make the first read fail and the second succeed. */
    readAlarm?: (alarmId: string, call: number) => Promise<AlarmListItem | null>;
  } = {},
): AlarmHarness {
  const logs: string[] = [];
  const reads: string[] = [];
  const broadcasts: AlarmListItem[] = [];
  const states: ListenerState[] = [];
  let index = 0;
  const listener = createAlarmNotifyListener({
    createClient() {
      const fake = fakes[Math.min(index, fakes.length - 1)];
      index += 1;
      return fake.client;
    },
    readAlarm(alarmId) {
      reads.push(alarmId);
      return options.readAlarm
        ? options.readAlarm(alarmId, reads.length)
        : Promise.resolve(sampleRow(alarmId));
    },
    broadcast(alarm) {
      broadcasts.push(alarm);
    },
    logger: {
      log: (m) => logs.push(`log:${m}`),
      warn: (m) => logs.push(`warn:${m}`),
      error: (m) => logs.push(`error:${m}`),
    },
    async sleep() {
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    random: () => 0.5,
    now: () => 0,
    onStateChange: (state) => states.push(state),
  });
  return {
    listener,
    logs,
    warns: () => logs.filter((l) => l.startsWith("warn:")),
    reads,
    broadcasts,
    states,
  };
}

/** The `F4.34` order survives the adapter: `error` is attached before `connect()`. */
export async function assertRegistersErrorBeforeConnect(): Promise<void> {
  const fake = makeFakeListenerClient();
  const h = makeAlarmHarness([fake]);
  h.listener.start();
  await flushListener();

  const errorAt = fake.events.indexOf("error");
  const connectAt = fake.events.indexOf("connect");
  assert(errorAt >= 0, "an error handler must be registered");
  assert(
    errorAt < connectAt,
    `error handler must be attached before connect() (error at ${errorAt}, connect at ${connectAt})`,
  );

  await h.listener.stop();
}

/** The statement after `connect()` is the alarm channel's, not telemetry's. */
export async function assertListensOnBmsAlarmsAfterConnect(): Promise<void> {
  const fake = makeFakeListenerClient();
  const h = makeAlarmHarness([fake]);
  h.listener.start();
  await flushListener();

  assert(fake.connects === 1, "the client should have connected");
  assert(
    fake.queries.length === 1 && fake.queries[0] === "LISTEN bms_alarms",
    `expected exactly "LISTEN bms_alarms", got ${JSON.stringify(fake.queries)}`,
  );

  await h.listener.stop();
}

/**
 * The fan-out, and the positive control for every refusal row below: a valid
 * `created` payload reads the alarm once by its id and broadcasts the row the
 * read returned — the same object, not a copy.
 */
export async function assertAValidCreatedPayloadIsReadOnceAndBroadcastOnce(): Promise<void> {
  const fake = makeFakeListenerClient();
  const row = sampleRow(ALARM_ID);
  const h = makeAlarmHarness([fake], { readAlarm: () => Promise.resolve(row) });
  h.listener.start();
  await flushListener();

  fake.emitNotification(VALID_CREATED);
  await flushListener();

  assert(
    h.reads.length === 1 && h.reads[0] === ALARM_ID,
    `readAlarm should be called once with the id, got ${JSON.stringify(h.reads)}`,
  );
  assert(
    h.broadcasts.length === 1 && h.broadcasts[0] === row,
    `broadcast should be called once with the row readAlarm returned, got ${h.broadcasts.length}`,
  );
  assert(h.warns().length === 0, `no warn on the happy path, got ${JSON.stringify(h.logs)}`);

  await h.listener.stop();
}

/** A payload that does not decode reaches no query. */
export async function assertAnUndecodablePayloadIsNotRead(): Promise<void> {
  const fake = makeFakeListenerClient();
  const h = makeAlarmHarness([fake]);
  h.listener.start();
  await flushListener();

  fake.emitNotification(`{"type":"created","alarmId":"${SENTINEL}","organizationId":"${ORG_ID}"}`);
  await flushListener();

  assert(h.reads.length === 0, `readAlarm must not be called, got ${JSON.stringify(h.reads)}`);
  assert(h.broadcasts.length === 0, "nothing may be broadcast for an undecodable payload");

  await h.listener.stop();
}

/** The drop is not silent: exactly one warn. */
export async function assertAnUndecodablePayloadIsWarnedOnce(): Promise<void> {
  const fake = makeFakeListenerClient();
  const h = makeAlarmHarness([fake]);
  h.listener.start();
  await flushListener();

  fake.emitNotification(`{"type":"created","alarmId":"${SENTINEL}","organizationId":"${ORG_ID}"}`);
  await flushListener();

  assert(
    h.warns().length === 1,
    `one warn for an undecodable payload, got ${JSON.stringify(h.logs)}`,
  );
  assert(h.listener.connected(), "an undecodable payload must not take the listener down");

  await h.listener.stop();
}

/**
 * The payload text never reaches a log line (§4.3 non-HTTP input, §9.6):
 * `NOTIFY` needs no table privilege, so what arrives on the channel is data
 * of unknown provenance. The warn count is the control that a warn was
 * written at all — an absence check with nothing beside it passes when the
 * handler does nothing.
 */
export async function assertNoLogLineCarriesTheUndecodablePayload(): Promise<void> {
  const fake = makeFakeListenerClient();
  const h = makeAlarmHarness([fake]);
  h.listener.start();
  await flushListener();

  fake.emitNotification(`{"type":"created","alarmId":"${SENTINEL}","organizationId":"${ORG_ID}"}`);
  fake.emitNotification(`not json ${SENTINEL}`);
  await flushListener();

  assert(h.warns().length === 2, `two warns expected as the control, got ${JSON.stringify(h.logs)}`);
  assert(
    !h.logs.some((l) => l.includes(SENTINEL)),
    `the payload's contents must never reach the log, got ${JSON.stringify(h.logs)}`,
  );

  await h.listener.stop();
}

/**
 * A `created` whose row is not visible — deleted between commit and read,
 * or the id of another database — is warned by id. The id is the schema's
 * validated uuid, not the raw payload, so naming it is not an echo.
 */
export async function assertAMissingAlarmIsWarnedNamingTheId(): Promise<void> {
  const fake = makeFakeListenerClient();
  const h = makeAlarmHarness([fake], { readAlarm: () => Promise.resolve(null) });
  h.listener.start();
  await flushListener();

  fake.emitNotification(VALID_CREATED);
  await flushListener();

  const warns = h.warns();
  assert(
    warns.length === 1 && warns[0].includes(ALARM_ID),
    `one warn naming ${ALARM_ID}, got ${JSON.stringify(h.logs)}`,
  );

  await h.listener.stop();
}

/** A `null` row never reaches the gateway — `emitScoped` would throw on `alarm.assetId`. */
export async function assertAMissingAlarmIsNotBroadcast(): Promise<void> {
  const fake = makeFakeListenerClient();
  const h = makeAlarmHarness([fake], { readAlarm: () => Promise.resolve(null) });
  h.listener.start();
  await flushListener();

  fake.emitNotification(VALID_CREATED);
  await flushListener();

  assert(h.reads.length === 1, "the read should have happened (control)");
  assert(h.broadcasts.length === 0, `nothing may be broadcast for a missing row, got ${h.broadcasts.length}`);

  await h.listener.stop();
}

/**
 * A row that is no longer active is not `created` — the security review of
 * `F3.11` (L1): `NOTIFY` needs no table privilege, so any connected role can
 * replay a known id, and without this guard every in-scope socket would
 * receive a cleared alarm as a fresh `created`. The read-back is the source
 * of truth, and `clearedAt` is the row's own word on whether it is active.
 */
export async function assertAClearedRowIsNotBroadcastAsCreated(): Promise<void> {
  const fake = makeFakeListenerClient();
  const cleared = { ...sampleRow(ALARM_ID), clearedAt: new Date(0).toISOString() };
  const h = makeAlarmHarness([fake], { readAlarm: () => Promise.resolve(cleared) });
  h.listener.start();
  await flushListener();

  fake.emitNotification(VALID_CREATED);
  await flushListener();

  assert(h.reads.length === 1, "the read should have happened (control)");
  assert(h.broadcasts.length === 0, `a cleared row must not be broadcast, got ${h.broadcasts.length}`);
  const warns = h.warns();
  assert(
    warns.length === 1 && warns[0].includes(ALARM_ID),
    `one warn naming ${ALARM_ID}, got ${JSON.stringify(h.logs)}`,
  );

  await h.listener.stop();
}

/**
 * A rejected read is caught and warned with its real message. Without the
 * `.catch` this is an unhandled rejection inside a `pg` event handler —
 * vitest fails the run on one, and the warn count here reads zero.
 */
export async function assertARejectedReadIsWarnedOnce(): Promise<void> {
  const fake = makeFakeListenerClient();
  const h = makeAlarmHarness([fake], {
    readAlarm: () => Promise.reject(new Error("fleet pool exhausted")),
  });
  h.listener.start();
  await flushListener();

  fake.emitNotification(VALID_CREATED);
  await flushListener();

  const warns = h.warns();
  assert(
    warns.length === 1 && warns[0].includes("fleet pool exhausted"),
    `one warn carrying the read's message, got ${JSON.stringify(h.logs)}`,
  );
  assert(h.broadcasts.length === 0, "a failed read broadcasts nothing");

  await h.listener.stop();
}

/** A failed read costs that one alarm, not the listener: the next valid payload still fans out. */
export async function assertAfterARejectedReadTheNextValidPayloadStillBroadcasts(): Promise<void> {
  const fake = makeFakeListenerClient();
  const row = sampleRow(ALARM_ID);
  const h = makeAlarmHarness([fake], {
    readAlarm: (_id, call) =>
      call === 1 ? Promise.reject(new Error("first read failed")) : Promise.resolve(row),
  });
  h.listener.start();
  await flushListener();

  fake.emitNotification(VALID_CREATED);
  await flushListener();
  fake.emitNotification(VALID_CREATED);
  await flushListener();

  assert(h.reads.length === 2, `two reads expected, got ${h.reads.length}`);
  assert(
    h.broadcasts.length === 1 && h.broadcasts[0] === row,
    `the second payload must still broadcast, got ${h.broadcasts.length}`,
  );
  assert(h.listener.connected(), "a rejected read must not take the listener down");

  await h.listener.stop();
}

/**
 * `cleared` (and `acknowledged`) are `F4.133`'s: today the schema's literal
 * refuses them, so the listener neither reads nor broadcasts. When `F4.133`
 * widens the literal this row reddens — deliberately: it is the reminder that
 * the handler then needs a `type` switch, not a wider read.
 */
export async function assertAClearedPayloadIsNeitherReadNorBroadcast(): Promise<void> {
  const fake = makeFakeListenerClient();
  const h = makeAlarmHarness([fake]);
  h.listener.start();
  await flushListener();

  fake.emitNotification(
    JSON.stringify({ type: "cleared", alarmId: ALARM_ID, organizationId: ORG_ID }),
  );
  await flushListener();

  assert(
    h.reads.length === 0 && h.broadcasts.length === 0,
    `a cleared payload must neither read nor broadcast, got reads=${h.reads.length} broadcasts=${h.broadcasts.length}`,
  );

  await h.listener.stop();
}

function makeDeps(sinks: {
  gauge?: boolean[];
  reconnects?: number[];
  created?: AlarmListItem[];
}): ReturnType<typeof buildAlarmListenerDeps> {
  return buildAlarmListenerDeps({
    createClient: () => makeFakeListenerClient().client,
    readAlarm: () => Promise.resolve(null),
    gateway: {
      broadcastCreated: (alarm: AlarmListItem) => {
        sinks.created?.push(alarm);
      },
    },
    metrics: {
      setAlarmListenerConnected: (connected: boolean) => {
        sinks.gauge?.push(connected);
      },
      countAlarmListenerReconnect: () => {
        sinks.reconnects?.push(1);
      },
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });
}

/** `onStateChange("connected")` drives the gauge to 1, `"disconnected"` to 0. */
export function assertBuildAlarmListenerDepsWiresTheGauge(): void {
  const gauge: boolean[] = [];
  const deps = makeDeps({ gauge });

  assert(deps.onStateChange !== undefined, "state changes must be wired to the gauge");
  deps.onStateChange?.("connected");
  deps.onStateChange?.("disconnected");
  assert(
    gauge.length === 2 && gauge[0] === true && gauge[1] === false,
    `gauge should follow listener state, got ${JSON.stringify(gauge)}`,
  );
}

/** `onReconnectAttempt` increments the counter. */
export function assertBuildAlarmListenerDepsWiresTheReconnectCounter(): void {
  const reconnects: number[] = [];
  const deps = makeDeps({ reconnects });

  assert(deps.onReconnectAttempt !== undefined, "reconnects must be wired to the counter");
  deps.onReconnectAttempt?.();
  assert(reconnects.length === 1, `one reconnect should have been counted, got ${reconnects.length}`);
}

/** `broadcast` is `AlarmsGateway.broadcastCreated`, with the row untouched. */
export function assertBuildAlarmListenerDepsBroadcastsThroughTheGateway(): void {
  const created: AlarmListItem[] = [];
  const deps = makeDeps({ created });
  const row = sampleRow(ALARM_ID);

  deps.broadcast(row);
  assert(
    created.length === 1 && created[0] === row,
    `broadcastCreated should receive the row once, got ${created.length}`,
  );
}
