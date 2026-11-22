import type { EndpointPlan } from "./bindings.js";
import { createSupervisor } from "./supervisor.js";
import {
  makeFactory,
  makeFakeScheduler,
  makeMemoryBuffer,
  makePlan,
  makeScriptedAdapter,
  nextTick,
  sample,
  silentLogger,
  stopSupervisor,
} from "./supervisor.spec.js";

/**
 * `F1.2` plan T3.4 / ADR 0016 Amendment 10 (a) and (c) — the poll loop sleeps
 * the plan's resolved interval, and a poll adapter whose health says
 * `disconnected` after a rejected `poll()` is restarted through the §5 backoff.
 *
 * Its own file: `supervisor.spec.ts` sits at the 1000-line cap. Fixtures are
 * that file's, shared rather than copied.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The scripted poll adapter's default is 5,000 ms. */
const ADAPTER_DEFAULT_MS = 5_000;

function pollPlan(pollIntervalMs: number | null, pollIntervalUsesDefault: boolean): EndpointPlan {
  return { ...makePlan(), protocol: "modbus_tcp", pollIntervalMs, pollIntervalUsesDefault };
}

/** Starts a poll supervisor, finishes one read, and returns the delays it then asked for. */
async function delaysAfterOneRead(plan: EndpointPlan): Promise<number[]> {
  const scripted = makeScriptedAdapter("poll");
  const fake = makeFakeScheduler();
  const supervisor = createSupervisor({
    factory: makeFactory([scripted]),
    plan,
    logger: silentLogger,
    buffer: makeMemoryBuffer(),
    scheduler: fake.scheduler,
    random: () => 0.5,
    writeSamples: async () => undefined,
  });
  supervisor.start();
  await nextTick();
  scripted.finishConnect();
  await nextTick();
  const before = fake.delays.length;
  scripted.finishPoll([sample(1)]);
  await nextTick();
  await nextTick();
  const after = fake.delays.slice(before);
  await stopSupervisor(supervisor, fake);
  return after;
}

export async function assertThePlanIntervalIsTheCadence(): Promise<void> {
  const delays = await delaysAfterOneRead(pollPlan(2_000, false));
  assert(delays.includes(2_000), `a plan interval of 2,000 must be the sleep, saw ${delays.join(",")}`);
  assert(!delays.includes(ADAPTER_DEFAULT_MS), `the adapter default must not be slept, saw ${delays.join(",")}`);
}

export async function assertANullPlanIntervalIsTheAdapterDefault(): Promise<void> {
  const delays = await delaysAfterOneRead(pollPlan(null, true));
  assert(delays.includes(ADAPTER_DEFAULT_MS), `null must sleep the adapter's 5,000, saw ${delays.join(",")}`);
}

export async function assertAnRtuOnTheDefaultCapsALongerInterval(): Promise<void> {
  // P9: one RTU at 60 s, one with no setting — the one with none is read at the adapter's 5 s.
  const delays = await delaysAfterOneRead(pollPlan(60_000, true));
  assert(delays.includes(ADAPTER_DEFAULT_MS), `the default must cap 60,000, saw ${delays.join(",")}`);
  assert(!delays.includes(60_000), `60,000 must not be slept, saw ${delays.join(",")}`);
}

/** A rejected poll with the given health; returns what the supervisor did next. */
async function afterARejectedPoll(health: "disconnected" | "connected"): Promise<{
  firstDisconnects: number;
  secondConnects: number;
  pollCalls: number;
  delays: number[];
}> {
  const first = makeScriptedAdapter("poll");
  const second = makeScriptedAdapter("poll");
  const fake = makeFakeScheduler();
  const supervisor = createSupervisor({
    factory: makeFactory([first, second]),
    plan: pollPlan(2_000, false),
    logger: silentLogger,
    buffer: makeMemoryBuffer(),
    scheduler: fake.scheduler,
    random: () => 0.5,
    writeSamples: async () => undefined,
  });
  supervisor.start();
  await nextTick();
  first.finishConnect();
  await nextTick();
  first.setHealth(health, health === "disconnected" ? "socket closed" : undefined);
  first.failPoll("socket closed");
  await nextTick();
  await nextTick();
  await fake.flush(2);
  const result = {
    firstDisconnects: first.disconnects,
    secondConnects: second.contexts.length,
    pollCalls: first.pollCalls,
    delays: [...fake.delays],
  };
  await stopSupervisor(supervisor, fake);
  return result;
}

export async function assertADisconnectedPollAdapterIsRestartedThroughTheBackoff(): Promise<void> {
  const result = await afterARejectedPoll("disconnected");
  assert(result.firstDisconnects === 1, `the dead adapter must be disconnected once, saw ${result.firstDisconnects}`);
  assert(result.secondConnects === 1, `a fresh adapter must connect after the backoff, saw ${result.secondConnects}`);
  assert(result.pollCalls === 1, `the dead adapter must not be polled again, saw ${result.pollCalls}`);
  // The §5 backoff with random 0.5 at attempt 0 is the 1 s base.
  assert(result.delays.includes(1_000), `the restart must wait the §5 backoff, saw ${result.delays.join(",")}`);
}

export async function assertAConnectedFailingPollAdapterIsPolledAgain(): Promise<void> {
  const result = await afterARejectedPoll("connected");
  assert(result.firstDisconnects === 0, `a slow device must not be torn down, saw ${result.firstDisconnects}`);
  assert(result.secondConnects === 0, `no second adapter for a slow device, saw ${result.secondConnects}`);
  assert(result.pollCalls === 2, `the same adapter must be polled again, saw ${result.pollCalls}`);
}

/**
 * Security review M1: a gateway that accepts and then drops the socket makes
 * every `connect()` succeed and every first `poll()` fail `disconnected`. The
 * backoff must still grow (1 s, 2 s, 4 s, …), because a poll endpoint resets it
 * on its first good read, not on connect.
 */
export async function assertRepeatedRestartsBackOff(): Promise<void> {
  const adapters = [1, 2, 3, 4].map(() => makeScriptedAdapter("poll"));
  const fake = makeFakeScheduler();
  const supervisor = createSupervisor({
    factory: makeFactory(adapters),
    plan: pollPlan(3_000, false),
    logger: silentLogger,
    buffer: makeMemoryBuffer(),
    scheduler: fake.scheduler,
    random: () => 0.5,
    writeSamples: async () => undefined,
  });
  supervisor.start();
  for (const scripted of adapters.slice(0, 3)) {
    await nextTick();
    scripted.finishConnect();
    await nextTick();
    scripted.setHealth("disconnected", "socket closed");
    scripted.failPoll("socket closed");
    await nextTick();
    await nextTick();
    await fake.flush(1);
  }
  const restarts = fake.delays.filter((ms) => ms === 1_000 || ms === 2_000 || ms === 4_000);
  assert(
    JSON.stringify(restarts) === JSON.stringify([1_000, 2_000, 4_000]),
    `three restarts must back off 1 s, 2 s, 4 s; saw ${fake.delays.join(",")}`,
  );
  await stopSupervisor(supervisor, fake);
}

/** The other direction: one good read resets the backoff to the base. */
export async function assertAGoodReadResetsTheBackoff(): Promise<void> {
  const adapters = [1, 2, 3].map(() => makeScriptedAdapter("poll"));
  const fake = makeFakeScheduler();
  const supervisor = createSupervisor({
    factory: makeFactory(adapters),
    plan: pollPlan(3_000, false),
    logger: silentLogger,
    buffer: makeMemoryBuffer(),
    scheduler: fake.scheduler,
    random: () => 0.5,
    writeSamples: async () => undefined,
  });
  supervisor.start();
  const [first, second] = adapters as [ReturnType<typeof makeScriptedAdapter>, ReturnType<typeof makeScriptedAdapter>];
  // First adapter: dies on its first read → restart after 1 s.
  await nextTick();
  first.finishConnect();
  await nextTick();
  first.setHealth("disconnected", "socket closed");
  first.failPoll("socket closed");
  await nextTick();
  await nextTick();
  await fake.flush(1);
  // Second adapter: one good read, then dies → the restart waits 1 s again, not 2 s.
  await nextTick();
  second.finishConnect();
  await nextTick();
  second.finishPoll([sample(1)]);
  await nextTick();
  await fake.flush(1);
  await nextTick();
  second.setHealth("disconnected", "socket closed");
  second.failPoll("socket closed");
  await nextTick();
  await nextTick();
  const restarts = fake.delays.filter((ms) => ms === 1_000 || ms === 2_000);
  assert(
    JSON.stringify(restarts) === JSON.stringify([1_000, 1_000]),
    `a good read must reset the backoff; saw ${fake.delays.join(",")}`,
  );
  await stopSupervisor(supervisor, fake);
}

/**
 * Code review 2: a read rejected because the endpoint is stopping (a reload's
 * replace aborts, then disconnects) is not a failure and logs no error.
 */
export async function assertAStopDuringAReadLogsNoFailure(): Promise<void> {
  const scripted = makeScriptedAdapter("poll");
  const fake = makeFakeScheduler();
  const lines: string[] = [];
  const logger = {
    info: () => undefined,
    warn: (message: string) => lines.push(`warn:${message}`),
    error: (message: string) => lines.push(`error:${message}`),
  };
  const supervisor = createSupervisor({
    factory: makeFactory([scripted]),
    plan: pollPlan(3_000, false),
    logger,
    buffer: makeMemoryBuffer(),
    scheduler: fake.scheduler,
    random: () => 0.5,
    writeSamples: async () => undefined,
  });
  supervisor.start();
  await nextTick();
  scripted.finishConnect();
  await nextTick();
  const stopping = stopSupervisor(supervisor, fake);
  await nextTick();
  scripted.setHealth("disconnected", "socket closed");
  scripted.failPoll("socket closed");
  await stopping;
  assert(
    !lines.includes("error:endpoint failed") && !lines.includes("warn:poll failed"),
    `a stop during a read must log no failure, saw ${lines.join(",")}`,
  );
}
