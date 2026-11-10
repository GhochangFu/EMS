import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";

import {
  UPLINK_MAX_BODY_BYTES,
  uplinkBatchSchema,
  type UplinkBatch,
  type UplinkResponse,
} from "@bms/shared/ingest";

import { assert } from "./normaliser.spec.js";
import type { ReceivedSample } from "./received-sample.js";
import type { Scheduler } from "./supervisor.js";
import {
  BACKLOG_AGE_MS,
  BACKLOG_WAIT_BUDGET_MS,
  createUplinkClient,
  EDGE_WRITE_TIMEOUT_MS,
  RESPONSE_MAX_BYTES,
  EDGE_UPLINK_PATH,
  RETRY_AFTER_CAP_MS,
  UPLINK_POST_TIMEOUT_MS,
  type UplinkFetch,
  type UplinkFetchInit,
  UplinkRetryLater,
} from "./uplink-client.js";
import { UPLINK_PATH } from "./uplink-server.js";

/**
 * `E7.2` / ADR 0123 decisions 4, 8 and 9, plan T5.4 with C3, C4 and M5 — the
 * edge's `writeSamples`. Assertions live here; `uplink-client.test.ts` is the
 * vitest entry point.
 *
 * `fetch` and the scheduler are injected: no socket, no real time. Every
 * function ends by checking that no log line and no thrown message holds the
 * token (AGENTS.md §9.6).
 */

export const CLIENT_TOKEN = `bmsgw_${"UplinkClientSpecToken".padEnd(43, "t")}`;
const ORIGIN = new URL("https://ems.example.test");
const T0 = Date.parse("2026-11-10T12:00:00.000Z");
const OK: UplinkResponse = { accepted: 1, rejected: { foreignDevice: 0, futureRx: 0, tooOld: 0, unresolved: 0 } };

type Call = { url: string; init: UplinkFetchInit; batch: UplinkBatch };
type Answer = { status: number; body?: unknown; headers?: Record<string, string> } | Error | "hang";

/** A scheduler whose throttle sleeps advance fake time, and whose abort/lock timers wait to be fired. */
function fakeScheduler() {
  let nowMs = T0;
  const sleeps: number[] = [];
  const timers: { ms: number; fire: () => void }[] = [];
  const scheduler: Scheduler = {
    now: () => new Date(nowMs),
    sleep: (ms, signal) => {
      const startedMs = nowMs;
      return new Promise<void>((resolve) => {
        // The 20 s post abort and the 20 s lock wait are timers the spec fires;
        // every other sleep is a throttle wait and moves fake time forward.
        if (ms === UPLINK_POST_TIMEOUT_MS) {
          const entry = { ms, fire: resolve };
          timers.push(entry);
          signal.addEventListener("abort", () => resolve(), { once: true });
          return;
        }
        sleeps.push(ms);
        // Time moves when the sleep ends, not when it starts, so concurrent sleeps overlap.
        setImmediate(() => {
          nowMs = Math.max(nowMs, startedMs + ms);
          resolve();
        });
      });
    },
  };
  return {
    scheduler,
    sleeps,
    timers,
    advance: (ms: number) => {
      nowMs += ms;
    },
    nowMs: () => nowMs,
  };
}

function harness(answers: Answer[] | ((call: Call) => Answer), options: { rate?: number } = {}) {
  const clock = fakeScheduler();
  const calls: Call[] = [];
  const lines: string[] = [];
  const serverTimes: number[] = [];
  const fetch: UplinkFetch = async (url, init) => {
    const batch = uplinkBatchSchema.parse(JSON.parse(gunzipSync(init.body).toString("utf8")));
    const call = { url, init, batch };
    calls.push(call);
    const answer = typeof answers === "function" ? answers(call) : (answers.shift() ?? { status: 200, body: OK });
    if (answer === "hang") {
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }
    if (answer instanceof Error) throw answer;
    const headers = answer.headers ?? {};
    return {
      status: answer.status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      body: new Response(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body ?? { error: "x" })).body,
    };
  };
  const record = (level: string) => (message: string, fields?: Record<string, unknown>) =>
    lines.push(JSON.stringify({ level, message, ...fields }));
  const client = createUplinkClient({
    url: ORIGIN,
    token: CLIENT_TOKEN,
    fetch,
    scheduler: clock.scheduler,
    logger: { info: record("info"), warn: record("warn"), error: record("error") },
    maxBacklogSamplesPerS: options.rate ?? 500,
    buffered: () => 7,
    clock: () => "unsynced",
    onServerTime: (ms) => serverTimes.push(ms),
  });
  return { client, calls, lines, clock, serverTimes };
}

function samples(n: number, receivedAt: Date, deviceKey?: string): ReceivedSample[] {
  return Array.from({ length: n }, (_, i) => ({
    sample: {
      sourceKey: `k${i}`,
      value: i,
      ...(deviceKey === undefined ? {} : { deviceKey }),
      ...(i === 0 ? { at: new Date(receivedAt.getTime() - 500), good: true } : {}),
    },
    receivedAt,
  }));
}

const ONE_DEVICE = { protocol: "mqtt" as const, bindings: [{ deviceKey: "RTU-1" }] };
const TWO_DEVICES = { protocol: "mqtt" as const, bindings: [{ deviceKey: "RTU-1" }, { deviceKey: "RTU-2" }] };

/** Waits (real time, briefly) until `ready` holds — gzip runs on the thread pool. */
async function until(ready: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

function assertNoToken(lines: readonly string[], errors: readonly Error[] = []): void {
  const secret = CLIENT_TOKEN.slice("bmsgw_".length);
  for (const line of lines) assert(!line.includes(secret), `a log line holds the token: ${line}`);
  for (const error of errors) assert(!error.message.includes(secret), `a thrown message holds the token: ${error.message}`);
}

/** The body gunzips to a schema-valid batch, `rx` is `receivedAt`, and the request is built once and right. */
export async function theBodyIsAValidGzipBatch(): Promise<void> {
  const h = harness([{ status: 200, body: OK }]);
  const at = new Date(T0 - 1_000);
  await h.client.writerFor(ONE_DEVICE)(samples(3, at));
  const [call] = h.calls;
  assert(call !== undefined, "one post");
  assert(EDGE_UPLINK_PATH === UPLINK_PATH, "the client posts to the receiver's one path");
  assert(call.url === `https://ems.example.test${UPLINK_PATH}`, `url: ${call.url}`);
  assert(call.init.method === "POST" && call.init.redirect === "error", "POST, redirect: error");
  const keys = Object.keys(call.init.headers).map((k) => k.toLowerCase());
  assert(keys.filter((k) => k === "authorization").length === 1, "authorization exactly once");
  assert(keys.filter((k) => k === "content-encoding").length === 1, "content-encoding exactly once");
  assert(call.init.headers.authorization === `Bearer ${CLIENT_TOKEN}`, "Bearer scheme");
  assert(call.init.headers["content-encoding"] === "gzip", "gzip");
  const { batch } = call;
  assert(batch.v === 1 && batch.samples.length === 3, "three samples, v 1");
  assert(batch.buffered === 7 && batch.clock === "unsynced", "buffered and clock carried (M13)");
  assert(batch.sentAt === new Date(T0).toISOString(), "sentAt on the edge clock");
  assert(batch.samples.every((s) => s.rx === at.toISOString()), "rx is receivedAt, unchanged");
  assert(batch.samples[0]?.at === new Date(at.getTime() - 500).toISOString() && batch.samples[0].good === true, "at, good");
  assert(batch.samples[1]?.at === undefined, "no device time is invented");
  assert(batch.samples.every((s) => s.protocol === "mqtt"), "protocol from the plan");
  assertNoToken(h.lines);
}

/** M5: a one-device endpoint's sample with no `deviceKey` is stamped; on a two-device one it cannot be. */
export async function theDeviceKeyIsStampedOnAOneDeviceEndpoint(): Promise<void> {
  const h = harness([]);
  await h.client.writerFor(ONE_DEVICE)(samples(2, new Date(T0)));
  assert(h.calls[0]?.batch.samples.every((s) => s.deviceKey === "RTU-1") === true, "stamped from the sole binding");
  await h.client.writerFor(TWO_DEVICES)([...samples(1, new Date(T0)), ...samples(1, new Date(T0), "RTU-2")]);
  const second = h.calls[1]?.batch.samples ?? [];
  assert(second.length === 1 && second[0]?.deviceKey === "RTU-2", "an unattributable sample is not guessed");
  assert(h.client.stats().unattributed === 1, `counted: ${h.client.stats().unattributed}`);
  assert(h.lines.some((l) => l.includes("no device key")), "and logged");
}

/** C3: a batch is backlog when its oldest sample is over 10 s old; only backlog batches are throttled. */
export async function onlyBacklogBatchesAreThrottled(): Promise<void> {
  const h = harness([], { rate: 500 });
  const write = h.client.writerFor(ONE_DEVICE);
  await write(samples(500, new Date(T0 - BACKLOG_AGE_MS)));
  assert(h.calls[0]?.batch.backlog === false, "exactly 10 s old is live");
  await write(samples(500, new Date(T0 - BACKLOG_AGE_MS - 1)));
  assert(h.calls[1]?.batch.backlog === true, "10 s 1 ms old is backlog");
  assert(h.clock.sleeps.length === 0, "the first backlog batch goes at once");
  await write(samples(500, new Date(T0 - 3_600_000)));
  assert(h.clock.sleeps.join(",") === "1000", `500 samples at 500/s wait 1 s: ${h.clock.sleeps.join(",")}`);
  await write(samples(500, new Date(h.clock.nowMs())));
  assert(h.clock.sleeps.length === 1, "a live batch is never throttled");
  await write(samples(100, new Date(T0 - 3_600_000)));
  assert(h.clock.sleeps.at(-1) === 1000, `the next backlog batch waits out the last one's share: ${h.clock.sleeps.join(",")}`);
}

/** C3 floor: at 50/s a full batch waits 10 s, inside the edge supervisor's write timeout. */
export async function theFloorRateWaitsTenSeconds(): Promise<void> {
  const h = harness([], { rate: 50 });
  const write = h.client.writerFor(ONE_DEVICE);
  await write(samples(500, new Date(T0 - 60_000)));
  await write(samples(500, new Date(T0 - 60_000)));
  assert(h.clock.sleeps.join(",") === "10000", `500 at 50/s: ${h.clock.sleeps.join(",")}`);
}

/** C4: every row of the outcome table. */
export async function everyOutcomeIsHandled(): Promise<void> {
  const errors: Error[] = [];
  for (const [status, code] of [
    [400, "bad-schema"],
    [400, "bad-json"],
    [413, "too-large"],
  ] as const) {
    const h = harness([{ status, body: { error: code } }]);
    await h.client.writerFor(ONE_DEVICE)(samples(4, new Date(T0)));
    assert(h.client.stats().uplinkRefused === 4, `${status} is terminal for the batch and counted`);
    assert(h.client.stats().lastRefusedAt?.getTime() === T0, "and stamped for the health window");
    assert(h.lines.some((l) => l.includes('"level":"error"') && l.includes(`"status":${status}`)), `${status} logged`);
    assertNoToken(h.lines);
  }
  const ok = harness([{ status: 200, body: { accepted: 5, rejected: { foreignDevice: 1, futureRx: 0, tooOld: 2, unresolved: 3 } } }]);
  await ok.client.writerFor(ONE_DEVICE)(samples(4, new Date(T0)));
  const stats = ok.client.stats();
  assert(stats.batchesSent === 1 && stats.accepted === 5 && stats.foreignDevice === 1 && stats.tooOld === 2, "200 counts");
  assert(stats.unresolved === 3 && stats.uplinkRefused === 0, "the 200 body's own units, never compared to the batch");

  const retry: Answer[] = [
    { status: 422, body: { error: "bad-schema" } },
    { status: 400, body: "<html><body>400 Bad Request</body></html>" },
    { status: 413, body: "<html>413 Request Entity Too Large (nginx)</html>" },
    { status: 413, body: { error: "bad-schema" } },
    { status: 400, body: { error: "made-up-code" } },
    { status: 200, body: "<html>captive portal</html>" },
    { status: 200, body: { ok: true } },
    { status: 401 },
    { status: 403, body: { error: "ingest-disabled" } },
    { status: 429, headers: { "retry-after": "5" } },
    { status: 500 },
    { status: 502 },
    { status: 503, headers: { "retry-after": "30" } },
    { status: 404 },
    Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
  ];
  for (const answer of retry) {
    const h = harness([answer]);
    const error = await rejection(h.client.writerFor(ONE_DEVICE)(samples(2, new Date(T0))));
    errors.push(error);
    assert(error instanceof UplinkRetryLater, `retry later for ${JSON.stringify(answer)}: ${error.message}`);
    assert(h.client.stats().uplinkRefused === 0, "a retry-later outcome deletes nothing");
    assert(h.client.stats().lastRefusedAt === undefined, "and is not a refusal");
    assertNoToken(h.lines, errors);
  }
}

/** `Retry-After` sets a not-before time, capped at 5 min; nothing is posted before it. */
export async function retryAfterGatesTheNextPost(): Promise<void> {
  const h = harness([{ status: 503, headers: { "retry-after": "30" } }, { status: 200, body: OK }]);
  const write = h.client.writerFor(ONE_DEVICE);
  await rejection(write(samples(1, new Date(T0))));
  h.clock.advance(29_000);
  const early = await rejection(write(samples(1, new Date(h.clock.nowMs()))));
  assert(early instanceof UplinkRetryLater && h.calls.length === 1, "inside Retry-After nothing is posted");
  h.clock.advance(1_000);
  await write(samples(1, new Date(h.clock.nowMs())));
  assert(h.calls.length === 2, "at Retry-After the next batch is posted");

  const capped = harness([{ status: 429, headers: { "retry-after": "99999" } }]);
  await rejection(capped.client.writerFor(ONE_DEVICE)(samples(1, new Date(T0))));
  assert(capped.client.stats().notBefore?.getTime() === T0 + RETRY_AFTER_CAP_MS, "capped at 5 min");
}

/** A post that does not answer is aborted at 20 s and is a retry-later. */
export async function aHungPostIsAbortedAtTwentySeconds(): Promise<void> {
  const h = harness(["hang"]);
  const pending = h.client.writerFor(ONE_DEVICE)(samples(1, new Date(T0)));
  await until(() => h.calls.length === 1, "the post");
  const timer = h.clock.timers.find((t) => t.ms === UPLINK_POST_TIMEOUT_MS);
  assert(UPLINK_POST_TIMEOUT_MS === 20_000, "the abort is at 20 s");
  if (timer === undefined) throw new Error("a 20 s abort timer is armed");
  assert(h.calls[0]?.init.signal.aborted === false, "not aborted before the timer");
  timer.fire();
  const error = await rejection(pending);
  assert(error instanceof UplinkRetryLater, "rejected as retry-later");
  assert(h.calls[0]?.init.signal.aborted === true, "the request was aborted");
}

/** A batch whose gzip body is over 256 KiB is split, and every sample still arrives once. */
export async function anOversizeBatchIsSplit(): Promise<void> {
  const h = harness([]);
  const big = Array.from({ length: 500 }, (_, i) => ({
    sample: { sourceKey: randomBytes(750).toString("base64"), value: i, deviceKey: "RTU-1" },
    receivedAt: new Date(T0),
  }));
  await h.client.writerFor(ONE_DEVICE)(big);
  assert(h.calls.length >= 2, `split into ${h.calls.length}`);
  assert(h.calls.every((c) => c.init.body.length <= UPLINK_MAX_BODY_BYTES), "every body under the cap");
  const sent = h.calls.flatMap((c) => c.batch.samples.map((s) => s.value));
  assert(sent.length === 500 && new Set(sent).size === 500, `every sample once: ${sent.length}`);
}

/** One post in flight at a time (the receiver answers 429 to a second), live ahead of backlog. */
export async function postsAreSerialisedLiveFirst(): Promise<void> {
  const gates: (() => void)[] = [];
  const order: boolean[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const clock = fakeScheduler();
  const fetch: UplinkFetch = async (_url, init) => {
    const batch = uplinkBatchSchema.parse(JSON.parse(gunzipSync(init.body).toString("utf8")));
    order.push(batch.backlog);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise<void>((resolve) => gates.push(resolve));
    inFlight -= 1;
    return { status: 200, headers: { get: () => null }, body: new Response(JSON.stringify(OK)).body };
  };
  const noop = () => undefined;
  const client = createUplinkClient({
    url: ORIGIN,
    token: CLIENT_TOKEN,
    fetch,
    scheduler: clock.scheduler,
    logger: { info: noop, warn: noop, error: noop },
    maxBacklogSamplesPerS: 100_000,
    buffered: () => 0,
    clock: () => "synced",
  });
  const write = client.writerFor(ONE_DEVICE);
  const first = write(samples(1, new Date(T0)));
  await until(() => gates.length === 1, "the first post");
  const backlog = write(samples(1, new Date(T0 - 60_000)));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const live = write(samples(1, new Date(T0)));
  await new Promise((resolve) => setTimeout(resolve, 5));
  for (let i = 0; i < 3; i += 1) {
    await until(() => gates.length === 1, `post ${i + 1}`);
    gates.shift()?.();
  }
  await Promise.all([first, backlog, live]);
  assert(maxInFlight === 1, `one post at a time: ${maxInFlight}`);
  assert(order.join(",") === "false,false,true", `the waiting live batch goes before the backlog: ${order.join(",")}`);
}

/** A schema-valid `200`'s `Date` header is passed to the clock guard; nothing else is. */
export async function onlyAValid200sDateIsTrusted(): Promise<void> {
  const date = "Tue, 10 Nov 2026 12:00:05 GMT";
  const h = harness([
    { status: 200, body: OK, headers: { date } },
    { status: 200, body: OK },
    { status: 200, body: OK, headers: { date: "not a date" } },
    { status: 503, headers: { date } },
  ]);
  const write = h.client.writerFor(ONE_DEVICE);
  await write(samples(1, new Date(T0)));
  await write(samples(1, new Date(T0)));
  await write(samples(1, new Date(T0)));
  await rejection(write(samples(1, new Date(T0))));
  assert(h.serverTimes.join(",") === String(Date.parse(date)), `only the first Date is passed on: ${h.serverTimes.join(",")}`);
}

/** A `200` that refused every sample as `futureRx` keeps the batch: a wrong clock must not delete it. */
export async function anAllFutureRx200IsRetryLater(): Promise<void> {
  const all = { accepted: 0, rejected: { foreignDevice: 0, futureRx: 3, tooOld: 0, unresolved: 0 } };
  const some = { accepted: 1, rejected: { foreignDevice: 0, futureRx: 2, tooOld: 0, unresolved: 0 } };
  const h = harness([{ status: 200, body: all }, { status: 200, body: some }]);
  const write = h.client.writerFor(ONE_DEVICE);
  const error = await rejection(write(samples(3, new Date(T0))));
  assert(error instanceof UplinkRetryLater, "every sample futureRx is a retry-later");
  await write(samples(3, new Date(T0)));
  assert(h.client.stats().futureRx === 5 && h.client.stats().batchesSent === 1, "a partial futureRx is delivered, and counted");
}

/** One sample whose device time does not fit is sent without it; one that cannot be sent is dropped alone. */
export async function oneBadSampleNeverSinksTheBatch(): Promise<void> {
  const h = harness([]);
  const at = new Date(T0);
  const batch: ReceivedSample[] = [
    { sample: { sourceKey: "ok", value: 1, deviceKey: "RTU-1" }, receivedAt: at },
    { sample: { sourceKey: "far", value: 2, deviceKey: "RTU-1", at: new Date(Date.UTC(10_000, 0, 1)) }, receivedAt: at },
    { sample: { sourceKey: "nan", value: Number.NaN, deviceKey: "RTU-1" }, receivedAt: at },
    { sample: { sourceKey: "", value: 3, deviceKey: "RTU-1" }, receivedAt: at },
  ];
  await h.client.writerFor(ONE_DEVICE)(batch);
  const sent = h.calls[0]?.batch.samples ?? [];
  assert(sent.map((s) => s.sourceKey).join(",") === "ok,far", `the good two are sent: ${sent.map((s) => s.sourceKey).join(",")}`);
  assert(sent[1]?.at === undefined && sent[1]?.rx === at.toISOString(), "a device time that does not fit is left off");
  const stats = h.client.stats();
  assert(stats.deviceTimeDropped === 1 && stats.invalid === 2, `counted: ${JSON.stringify(stats)}`);
}

/** A split batch whose second body is retry-later rejects, and the retry re-sends both halves at the same rx. */
export async function aSplitBatchWithAFailedHalfIsResentWhole(): Promise<void> {
  const h = harness([{ status: 200, body: OK }, { status: 502 }]);
  const big = Array.from({ length: 500 }, (_, i) => ({
    sample: { sourceKey: randomBytes(750).toString("base64"), value: i, deviceKey: "RTU-1" },
    receivedAt: new Date(T0 - i),
  }));
  const write = h.client.writerFor(ONE_DEVICE);
  const error = await rejection(write(big));
  assert(error instanceof UplinkRetryLater && h.calls.length === 2, "the second half's retry-later rejects the batch");
  await write(big);
  const keys = (call: Call | undefined) => (call?.batch.samples ?? []).map((s) => `${s.value}|${s.rx}`).join(",");
  assert(h.calls.length === 4, `both halves re-sent: ${h.calls.length}`);
  assert(keys(h.calls[2]) === keys(h.calls[0]) && keys(h.calls[3]) === keys(h.calls[1]), "with identical rx");
}

/** Many endpoints replaying at once at the 50/s floor: past a 30 s wait a batch is refused at once, unreserved. */
export async function aFullThrottleRefusesWithoutReserving(): Promise<void> {
  const h = harness([], { rate: 50 });
  const old = new Date(T0 - 3_600_000);
  // 400 samples at 50/s is an 8 s share: waits 0, 8, 16, 24 fit the budget; 32 does not.
  const calls = Array.from({ length: 8 }, (_, i) =>
    h.client.writerFor({ protocol: "mqtt", bindings: [{ deviceKey: `RTU-${i}` }] })(samples(400, old)).then(
      () => "sent",
      (error: unknown) => (error instanceof UplinkRetryLater ? "later" : "other"),
    ),
  );
  const outcomes = await Promise.all(calls);
  assert(BACKLOG_WAIT_BUDGET_MS === 30_000, "the budget is 30 s");
  assert(outcomes.join(",") === "sent,sent,sent,sent,later,later,later,later", `outcomes: ${outcomes.join(",")}`);
  assert(h.calls.length === 4, `only the admitted four were posted: ${h.calls.length}`);
  assert(Math.max(...h.clock.sleeps) <= BACKLOG_WAIT_BUDGET_MS, `no wait past the budget: ${h.clock.sleeps.join(",")}`);
  // The refused four reserved nothing: the next batch, once the four are through, waits only for them.
  const next = h.client.writerFor(ONE_DEVICE)(samples(400, old));
  await next;
  assert(h.calls.length === 5, "a later batch is admitted once the schedule has room");
}

/** A batch that gives up before posting gives its throttle share back. */
export async function aBatchThatNeverPostsReleasesItsShare(): Promise<void> {
  const h = harness((call) => (call.batch.backlog ? { status: 200, body: OK } : "hang"));
  const write = h.client.writerFor(ONE_DEVICE);
  const live = write(samples(1, new Date(T0)));
  await until(() => h.calls.length === 1, "the hanging live post");
  const old = new Date(T0 - 3_600_000);
  // A 500-sample share at 500/s is 1 s. This one waits on the lock and times out.
  const gaveUp = write(samples(500, old));
  await until(() => h.clock.timers.length >= 2, "the lock wait");
  h.clock.timers.find((t, i) => i > 0 && t.ms === 20_000)?.fire();
  assert((await rejection(gaveUp)) instanceof UplinkRetryLater, "the lock wait timed out");
  h.clock.timers[0]?.fire();
  await rejection(live);
  const before = h.clock.sleeps.length;
  await write(samples(500, old));
  assert(h.clock.sleeps.length === before, `the released share is not waited for: ${h.clock.sleeps.slice(before).join(",")}`);
}

/** A batch still waiting when its caller's write timeout passes is never posted. */
export async function noPostAfterTheCallerTimedOut(): Promise<void> {
  const h = harness(["hang", { status: 200, body: OK }]);
  const write = h.client.writerFor(ONE_DEVICE);
  const holder = write(samples(1, new Date(T0)));
  await until(() => h.calls.length === 1, "the hanging post");
  const waiting = write(samples(1, new Date(T0)));
  await new Promise((resolve) => setTimeout(resolve, 5));
  // The waiting caller's write timeout passes while the lock is held.
  h.clock.advance(EDGE_WRITE_TIMEOUT_MS);
  h.clock.timers[0]?.fire();
  await rejection(holder);
  const error = await rejection(waiting);
  assert(error instanceof UplinkRetryLater, `rejected: ${error.message}`);
  assert(h.calls.length === 1, `nothing posted after the caller's timeout: ${h.calls.length}`);
}

/** After `stop()` nothing is posted, and a post in flight is aborted as a retry-later. */
export async function stopRejectsAndAbortsInFlight(): Promise<void> {
  const h = harness(["hang"]);
  const write = h.client.writerFor(ONE_DEVICE);
  const pending = write(samples(1, new Date(T0)));
  await until(() => h.calls.length === 1, "the post");
  h.client.stop();
  assert((await rejection(pending)) instanceof UplinkRetryLater && h.calls[0]?.init.signal.aborted === true, "aborted");
  assert((await rejection(write(samples(1, new Date(T0))))) instanceof UplinkRetryLater, "a later call rejects");
  assert(h.calls.length === 1, "and posts nothing");
}

/** A response body over 64 KiB is not read to the end: the post is aborted and retried. */
export async function anOversizeResponseIsCutOff(): Promise<void> {
  const h = harness([{ status: 200, body: "x".repeat(RESPONSE_MAX_BYTES + 1) }]);
  const error = await rejection(h.client.writerFor(ONE_DEVICE)(samples(1, new Date(T0))));
  assert(error instanceof UplinkRetryLater && error.message.includes("over"), `retry-later: ${error.message}`);
  assert(h.calls[0]?.init.signal.aborted === true, "the request was aborted");
}
