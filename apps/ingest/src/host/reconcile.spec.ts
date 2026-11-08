import type { IngestProtocol } from "@bms/shared/ingest";

import type { EndpointPlan } from "./bindings.js";
import { endpointGroupKey } from "./bindings.js";
import type { PointIndex } from "./normaliser.js";
import {
  createEndpointRegistry,
  diffEndpoints,
  type EndpointRegistry,
  type ReconcileAction,
  type RunningEndpoint,
} from "./reconcile.js";
import type { Supervisor, SupervisorHealth } from "./supervisor.js";

/**
 * `F4.330` / ADR 0115 decision 6 — the reload's endpoint reconciliation.
 *
 * `diffEndpoints` is pure; the registry is exercised against fake supervisors
 * whose `stop()` can be held open on a deferred, so the ordering claims (plan
 * R10) and the no-overlap claim (plan R6) are observed rather than assumed.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function plan(endpointKey: string, devices: readonly string[], protocol: IngestProtocol = "mqtt"): EndpointPlan {
  return {
    protocol,
    endpointKey,
    config: { host: endpointKey },
    credentials: {},
    bindings: devices.map((d) => ({ rtuId: `id-${d}`, rtuCode: d, deviceKey: d, device: {}, sourceKeys: ["flow"] })),
    pointIndex: new Map(devices.map((d) => [d, new Map()])),
    decoderFingerprint: "fp-0",
  };
}

function key(endpointKey: string, protocol: IngestProtocol = "mqtt"): string {
  return endpointGroupKey(protocol, endpointKey);
}

function running(
  entries: Record<string, readonly string[]>,
  fingerprint = "fp-0",
): ReadonlyMap<string, RunningEndpoint> {
  return new Map(
    Object.entries(entries).map(([k, devices]) => [key(k), { devices: new Set(devices), fingerprint }]),
  );
}

function kinds(actions: readonly ReconcileAction[]): string {
  return actions.map((a) => `${a.kind}:${a.key.split("\u0000")[1]}`).join(",");
}

// ---- the pure diff ---------------------------------------------------------

export function runDiffStartsNewEndpointsTests(): void {
  const actions = diffEndpoints(new Map(), [plan("b:1", ["R2"]), plan("a:1", ["R1"])]);
  assert(kinds(actions) === "start:a:1,start:b:1", `two starts, by key: ${kinds(actions)}`);
  const first = actions[0];
  assert(first.kind === "start" && first.plan.endpointKey === "a:1", "a start carries its plan");
}

export function runDiffSameDeviceSetSwapsIndexTests(): void {
  const next = plan("a:1", ["R1", "R2"]);
  const actions = diffEndpoints(running({ "a:1": ["R2", "R1"] }), [next]);
  assert(kinds(actions) === "swap-index:a:1", `same device set → swap-index only: ${kinds(actions)}`);
  const only = actions[0];
  assert(only.kind === "swap-index" && only.pointIndex === next.pointIndex, "the new plan's index is carried");
}

export function runDiffChangedDeviceSetReplacesTests(): void {
  const added = diffEndpoints(running({ "a:1": ["R1"] }), [plan("a:1", ["R1", "R3"])]);
  const a = added[0];
  assert(added.length === 1 && a.kind === "replace", `a device added → one replace: ${kinds(added)}`);
  assert(
    a.kind === "replace" && a.added.join(",") === "R3" && a.removed.length === 0,
    `wrong added/removed: ${JSON.stringify(a)}`,
  );

  const removed = diffEndpoints(running({ "a:1": ["R1", "R2"] }), [plan("a:1", ["R1"])]);
  const r = removed[0];
  assert(removed.length === 1 && r.kind === "replace", `a device removed → one replace: ${kinds(removed)}`);
  assert(
    r.kind === "replace" && r.removed.join(",") === "R2" && r.added.length === 0 && r.plan.bindings.length === 1,
    `wrong added/removed: ${JSON.stringify(r)}`,
  );
}

export function runDiffGoneEndpointStopsTests(): void {
  const actions = diffEndpoints(running({ "a:1": ["R1"], "b:1": ["R2"] }), [plan("b:1", ["R2"])]);
  assert(kinds(actions) === "stop:a:1,swap-index:b:1", `a key absent from next → stop: ${kinds(actions)}`);
}

export function runDiffOrderingTests(): void {
  // Plan R10: every stop and replace before any start, each group stable by key.
  const actions = diffEndpoints(running({ "c:1": ["R1"], "a:1": ["R1"], "d:1": ["R4"] }), [
    plan("b:1", ["R2"]),
    plan("a:1", ["R9"]),
    plan("e:1", ["R5"]),
    plan("d:1", ["R4"]),
  ]);
  assert(
    kinds(actions) === "replace:a:1,stop:c:1,swap-index:d:1,start:b:1,start:e:1",
    `stops and replaces first, then swaps, then starts, by key: ${kinds(actions)}`,
  );
  const lastStop = Math.max(...actions.map((x, i) => (x.kind === "stop" || x.kind === "replace" ? i : -1)));
  const firstStart = actions.findIndex((x) => x.kind === "start");
  assert(lastStop < firstStart, "no start may precede a stop or replace");
}

export function runDiffPurityTests(): void {
  const before = running({ "a:1": ["R1"] });
  const next = [plan("a:1", ["R1", "R2"]), plan("b:1", ["R3"])];
  const snapshot = JSON.stringify([...before].map(([k, v]) => [k, [...v.devices], v.fingerprint]));
  const nextLength = next.length;
  const realNow = Date.now;
  Date.now = () => {
    throw new Error("diffEndpoints read the clock");
  };
  let first: readonly ReconcileAction[];
  let second: readonly ReconcileAction[];
  try {
    first = diffEndpoints(before, next);
    second = diffEndpoints(before, next);
  } finally {
    Date.now = realNow;
  }
  assert(JSON.stringify([...before].map(([k, v]) => [k, [...v.devices], v.fingerprint])) === snapshot, "running must not be mutated");
  assert(next.length === nextLength && next[0].bindings.length === 2, "next must not be mutated");
  assert(kinds(first) === kinds(second), "the same inputs give the same actions");
}

// ---- the registry ----------------------------------------------------------

type LogLine = { level: "info" | "warn" | "error"; message: string; fields?: Record<string, unknown> };

type Deferred = { promise: Promise<void>; release(): void };

function deferred(): Deferred {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** A world of fake supervisors: an ordered event log, and per-endpoint knobs. */
function world(options: { scanned?: readonly { protocol: IngestProtocol; endpointKey: string }[] } = {}) {
  const events: string[] = [];
  const logs: LogLine[] = [];
  const stopGates = new Map<string, Deferred>();
  const stopRejects = new Set<string>();
  const buildThrows = new Set<string>();
  const startThrows = new Set<string>();
  const knobs = { infoThrowsOnce: false };
  const buffered = new Map<string, number>();
  const indexes = new Map<string, () => PointIndex>();
  let builds = 0;

  function health(p: EndpointPlan): SupervisorHealth {
    return {
      protocol: p.protocol,
      endpointKey: p.endpointKey,
      state: "connected",
      devices: p.bindings.map((b) => ({ rtuCode: b.rtuCode, deviceKey: b.deviceKey, points: [] })),
      restarts: 0,
      consecutivePollFailures: 0,
      queueDepth: 0,
      droppedSamples: 0,
      writeFailures: 0,
      samplesWritten: 0,
      buffered: 0,
      writePath: "ok",
      bufferDropped: 0,
      replayed: 0,
    };
  }

  const registry: EndpointRegistry = createEndpointRegistry({
    build(p, index): Supervisor {
      const name = p.endpointKey;
      if (buildThrows.has(name)) {
        throw new Error(`build refused ${name}`);
      }
      builds += 1;
      events.push(`build:${name}`);
      indexes.set(name, index);
      return {
        protocol: p.protocol,
        endpointKey: p.endpointKey,
        start: () => {
          if (startThrows.has(name)) {
            throw new Error(`start refused ${name}`);
          }
          events.push(`start:${name}`);
        },
        stop: async () => {
          events.push(`stop-begin:${name}`);
          await stopGates.get(name)?.promise;
          events.push(`stop-end:${name}`);
          if (stopRejects.has(name)) {
            throw new Error(`stop failed ${name}`);
          }
        },
        health: () => health(p),
      };
    },
    logger: {
      info: (message, fields) => {
        if (knobs.infoThrowsOnce) {
          knobs.infoThrowsOnce = false;
          throw new Error("logger refused");
        }
        logs.push({ level: "info", message, ...(fields ? { fields } : {}) });
      },
      warn: (message, fields) => logs.push({ level: "warn", message, ...(fields ? { fields } : {}) }),
      error: (message, fields) => logs.push({ level: "error", message, ...(fields ? { fields } : {}) }),
    },
    buffered: (_protocol, endpointKey) => buffered.get(endpointKey) ?? 0,
    ...(options.scanned === undefined ? {} : { scanned: options.scanned }),
  });

  return {
    registry,
    events,
    logs,
    stopGates,
    stopRejects,
    buildThrows,
    startThrows,
    knobs,
    buffered,
    indexes,
    builds: () => builds,
    roster: () =>
      registry
        .health()
        .endpoints.map((e) => `${e.endpointKey}=${e.devices.map((d) => d.rtuCode).join("|")}`)
        .join(","),
    logged: (message: string) => logs.filter((l) => l.message === message),
  };
}

export async function runRegistryBootTests(): Promise<void> {
  const w = world();
  const result = await w.registry.reload([plan("a:1", ["R1"]), plan("b:1", ["R2"])]);
  assert(result === "applied", `boot applies, got ${result}`);
  assert(w.events.join(",") === "build:a:1,start:a:1,build:b:1,start:b:1", `boot order: ${w.events.join(",")}`);
  assert(w.logged("endpoint started").length === 2, "each start is logged");
  assert(w.roster() === "a:1=R1,b:1=R2", `boot roster: ${w.roster()}`);
}

export async function runRegistryReplaceAwaitsStopTests(): Promise<void> {
  const w = world();
  await w.registry.reload([plan("a:1", ["R1", "R2"])]);
  w.events.length = 0;
  const gate = deferred();
  w.stopGates.set("a:1", gate);

  const pending = w.registry.reload([plan("a:1", ["R1", "R3"])]);
  await Promise.resolve();
  await Promise.resolve();
  assert(
    w.events.join(",") === "stop-begin:a:1",
    `nothing may be built while the old stop() is pending: ${w.events.join(",")}`,
  );
  gate.release();
  assert((await pending) === "applied", "the replace applies");
  assert(
    w.events.join(",") === "stop-begin:a:1,stop-end:a:1,build:a:1,start:a:1",
    `replace = stop old, then build and start new: ${w.events.join(",")}`,
  );
  const line = w.logged("endpoint replaced")[0];
  assert(line !== undefined, "the replace is logged");
  assert(
    JSON.stringify(line.fields?.added) === '["R3"]' && JSON.stringify(line.fields?.removed) === '["R2"]',
    `the replace names what changed: ${JSON.stringify(line.fields)}`,
  );
  assert(w.roster() === "a:1=R1|R3", `the new roster is served: ${w.roster()}`);
}

export async function runRegistryStopAndStoppedBacklogTests(): Promise<void> {
  const w = world();
  await w.registry.reload([plan("a:1", ["R1"]), plan("b:1", ["R2"]), plan("c:1", ["R3"])]);
  w.buffered.set("a:1", 7);
  await w.registry.reload([plan("c:1", ["R3"])]);

  assert(w.roster() === "c:1=R3", `stopped keys leave the roster: ${w.roster()}`);
  assert(w.logged("endpoint stopped").length === 2, "each stop is logged");
  const stopped = w.registry.health().stopped;
  assert(
    stopped.length === 1 &&
      stopped[0].endpointKey === "a:1" &&
      stopped[0].protocol === "mqtt" &&
      stopped[0].buffered === 7,
    `only the stopped endpoint with a backlog is listed: ${JSON.stringify(stopped)}`,
  );

  // The gauge is read live: once the backlog is swept the line goes.
  w.buffered.set("a:1", 0);
  assert(w.registry.health().stopped.length === 0, "a stopped endpoint with nothing buffered is not listed");

  // A later start of the key removes it from `stopped`, even with a backlog
  // (the running endpoint's own `buffered=` now reports it).
  w.buffered.set("a:1", 3);
  await w.registry.reload([plan("a:1", ["R1"]), plan("c:1", ["R3"])]);
  assert(w.registry.health().stopped.length === 0, "a restarted key is no longer stopped");
  assert(w.roster() === "a:1=R1,c:1=R3", `the key is served again: ${w.roster()}`);
}

export async function runRegistryNoOverlapTests(): Promise<void> {
  const w = world();
  await w.registry.reload([plan("a:1", ["R1"]), plan("b:1", ["R2"])]);
  const gate = deferred();
  w.stopGates.set("a:1", gate);
  const first = w.registry.reload([plan("b:1", ["R2"])]);
  await Promise.resolve();
  const buildsBefore = w.builds();
  const eventsBefore = w.events.length;

  const second = await w.registry.reload([plan("z:1", ["R9"])]);
  assert(second === "busy", `a reload while one is applying is refused, got ${second}`);
  assert(w.logged("reload skipped; previous reload still applying").length === 1, "the refusal is logged once");
  assert(w.builds() === buildsBefore && w.events.length === eventsBefore, "a busy reload changes nothing");

  gate.release();
  assert((await first) === "applied", "the first reload completes");
  const third = await w.registry.reload([plan("b:1", ["R2"]), plan("z:1", ["R9"])]);
  assert(third === "applied", `after release the next reload applies, got ${third}`);
  assert(w.roster() === "b:1=R2,z:1=R9", `roster after the applied reload: ${w.roster()}`);
}

export async function runRegistrySwapIndexTests(): Promise<void> {
  const w = world();
  const boot = plan("a:1", ["R1"]);
  await w.registry.reload([boot]);
  const index = w.indexes.get("a:1");
  assert(index !== undefined && index() === boot.pointIndex, "the supervisor reads the boot index");
  const builds = w.builds();

  const next = plan("a:1", ["R1"]);
  await w.registry.reload([next]);
  assert(w.builds() === builds, "a swap-index does not rebuild");
  assert(index?.() === next.pointIndex, "the same supervisor now reads the new index");
  assert(!w.events.some((e) => e.startsWith("stop")), "a swap-index stops nothing");
}

export async function runRegistryFailureIsolationTests(): Promise<void> {
  const w = world();
  w.buildThrows.add("a:1");
  const result = await w.registry.reload([plan("a:1", ["R1"]), plan("b:1", ["R2"])]);
  assert(result === "applied", "a failed build does not fail the reload");
  const failed = w.logged("endpoint start failed");
  assert(
    failed.length === 1 && failed[0].level === "error" && failed[0].fields?.endpointKey === "a:1",
    `the failed build is logged with its key: ${JSON.stringify(failed)}`,
  );
  assert(w.roster() === "b:1=R2", `the other endpoint still starts: ${w.roster()}`);

  // A build that fails is retried by the next reload, which sees the key absent.
  w.buildThrows.delete("a:1");
  await w.registry.reload([plan("a:1", ["R1"]), plan("b:1", ["R2"])]);
  assert(w.roster() === "a:1=R1,b:1=R2", `the next reload retries the start: ${w.roster()}`);

  w.stopRejects.add("a:1");
  await w.registry.reload([plan("b:1", ["R2", "R3"])]);
  const stopFailed = w.logged("endpoint stop failed");
  assert(
    stopFailed.length === 1 && stopFailed[0].fields?.endpointKey === "a:1",
    `the rejected stop is logged with its key: ${JSON.stringify(stopFailed)}`,
  );
  assert(w.roster() === "b:1=R2|R3", `the key is dropped and the replace still applies: ${w.roster()}`);
}

export async function runRegistryStopAllTests(): Promise<void> {
  const w = world();
  await w.registry.reload([plan("a:1", ["R1"]), plan("b:1", ["R2"])]);
  w.buffered.set("a:1", 5);
  await w.registry.stopAll();
  assert(
    w.events.filter((e) => e.startsWith("stop-end")).sort().join(",") === "stop-end:a:1,stop-end:b:1",
    `stopAll stops every running supervisor: ${w.events.join(",")}`,
  );
  assert(w.registry.health().endpoints.length === 0, "nothing is left running");
  const after = await w.registry.reload([plan("c:1", ["R3"])]);
  assert(after === "busy" && w.builds() === 2, "nothing starts after stopAll");
}

/** No credential field ever reaches a registry log line (AGENTS.md §9.6). */
export async function runRegistryLogsNoCredentialsTests(): Promise<void> {
  const w = world();
  const secret = "s3cret-broker-password";
  const withCreds = (devices: readonly string[]): EndpointPlan => ({
    ...plan("a:1", devices),
    credentials: { username: "u", password: secret },
  });
  await w.registry.reload([withCreds(["R1"])]);
  await w.registry.reload([withCreds(["R1", "R2"])]);
  await w.registry.reload([]);
  const all = JSON.stringify(w.logs);
  assert(w.logs.length >= 3, "the started, replaced and stopped lines were written");
  assert(!all.includes(secret) && !all.includes("password"), `a credential reached a log line: ${all}`);
}

/** Review fix 2: once `stopAll` has begun, an in-flight replace launches nothing. */
export async function runRegistryStopAllDuringReplaceTests(): Promise<void> {
  const w = world();
  await w.registry.reload([plan("a:1", ["R1"])]);
  const gate = deferred();
  w.stopGates.set("a:1", gate);
  const builds = w.builds();

  // A replace of `a:1` (held on its stop) and a start of `b:1` queued behind it.
  const pending = w.registry.reload([plan("a:1", ["R1", "R2"]), plan("b:1", ["R3"])]);
  await Promise.resolve();
  const stopping = w.registry.stopAll();
  gate.release();
  await stopping;
  await pending;

  assert(w.builds() === builds, `no replacement may be built once stopAll has begun: ${w.events.join(",")}`);
  assert(w.registry.health().endpoints.length === 0, "the replacement is never left running");
  // stopAll waits for the in-flight reload, which already stopped `a:1`; a
  // stopAll that did not wait would stop the same supervisor a second time.
  assert(
    w.events.filter((e) => e === "stop-begin:a:1").length === 1,
    `the old supervisor is stopped exactly once: ${w.events.join(",")}`,
  );
}

/** Review L1: a supervisor that was built but refused to start is stopped. */
export async function runRegistryStartThrowsStopsTests(): Promise<void> {
  const w = world();
  w.startThrows.add("a:1");
  await w.registry.reload([plan("a:1", ["R1"])]);
  assert(w.events.includes("stop-begin:a:1"), `a built supervisor whose start threw is stopped: ${w.events.join(",")}`);
  assert(w.logged("endpoint start failed").length === 1, "the failed start is logged");
  assert(w.registry.health().endpoints.length === 0, "it is not running");
}

/** Review L2: a stopped endpoint's queued tail resolves against an empty index. */
export async function runRegistryStopClearsIndexTests(): Promise<void> {
  const w = world();
  await w.registry.reload([plan("a:1", ["R1"])]);
  const index = w.indexes.get("a:1");
  await w.registry.reload([]);
  assert(index !== undefined && index().size === 0, "a stopped supervisor's index() must be empty");
}

/** Mutation M2: a failed launch with a backlog is named as stopped. */
export async function runRegistryFailedLaunchListedTests(): Promise<void> {
  const w = world();
  w.buildThrows.add("a:1");
  w.buffered.set("a:1", 4);
  await w.registry.reload([plan("a:1", ["R1"])]);
  const stopped = w.registry.health().stopped;
  assert(
    stopped.length === 1 && stopped[0].endpointKey === "a:1" && stopped[0].buffered === 4,
    `a key that failed to start with a backlog is listed: ${JSON.stringify(stopped)}`,
  );
}

/** Mutation M3: the stopped list comes back sorted by key, not insertion order. */
export async function runRegistryStoppedSortedTests(): Promise<void> {
  const w = world();
  await w.registry.reload([plan("b:1", ["R2"]), plan("a:1", ["R1"])]);
  w.buffered.set("a:1", 1);
  w.buffered.set("b:1", 2);
  // `b:1` is stopped first, so insertion order would put it first.
  await w.registry.reload([plan("a:1", ["R1"])]);
  await w.registry.reload([]);
  const keys = w.registry.health().stopped.map((e) => e.endpointKey).join(",");
  assert(keys === "a:1,b:1", `stopped entries are sorted by key, got ${keys}`);
}

/** Mutation M4: a reload whose apply rejects still clears the busy state. */
export async function runRegistryRejectedApplyClearsBusyTests(): Promise<void> {
  const w = world();
  w.knobs.infoThrowsOnce = true;
  let rejected = false;
  try {
    await w.registry.reload([plan("a:1", ["R1"])]);
  } catch {
    rejected = true;
  }
  assert(rejected, "the fake logger's throw must reject this reload, or the claim tests nothing");
  const next = await w.registry.reload([plan("a:1", ["R1"])]);
  assert(next === "applied", `a rejected apply must not leave the registry busy, got ${next}`);
}

/** Owner ruling A (ADR 0115 Amendment 1): a scanned backlog is named after a restart. */
export async function runRegistryScannedBacklogTests(): Promise<void> {
  const w = world({
    scanned: [
      { protocol: "mqtt", endpointKey: "off:1" },
      { protocol: "mqtt", endpointKey: "a:1" },
    ],
  });
  w.buffered.set("off:1", 9);
  w.buffered.set("a:1", 3);
  await w.registry.reload([plan("a:1", ["R1"])]);
  const stopped = w.registry.health().stopped;
  assert(
    stopped.length === 1 && stopped[0].endpointKey === "off:1" && stopped[0].buffered === 9,
    `a scanned endpoint the boot plan does not start is listed; one it starts is not: ${JSON.stringify(stopped)}`,
  );
  await w.registry.reload([plan("a:1", ["R1"]), plan("off:1", ["R9"])]);
  assert(w.registry.health().stopped.length === 0, "once the key starts it is no longer stopped");
}

// ---- the decoder fingerprint (ADR 0116 decision 6, F4.334 plan R8) -----------

function withFingerprint(p: EndpointPlan, fingerprint: string): EndpointPlan {
  return { ...p, decoderFingerprint: fingerprint };
}

/** Same devices: same fingerprint swaps; a different one replaces with the format reason. */
export function runDiffFingerprintChangeReplacesTests(): void {
  const same = diffEndpoints(running({ "a:1": ["R1"] }, "fp-A"), [withFingerprint(plan("a:1", ["R1"]), "fp-A")]);
  assert(kinds(same) === "swap-index:a:1", `same fingerprint → swap-index: ${kinds(same)}`);

  const moved = diffEndpoints(running({ "a:1": ["R1"] }, "fp-A"), [withFingerprint(plan("a:1", ["R1"]), "fp-B")]);
  assert(kinds(moved) === "replace:a:1", `a moved fingerprint → replace: ${kinds(moved)}`);
  const only = moved[0];
  assert(
    only.kind === "replace" &&
      only.reason === "payload-format-changed" &&
      only.added.length === 0 &&
      only.removed.length === 0,
    `the replace carries the format reason and no device change: ${JSON.stringify(only)}`,
  );

  // A device change keeps its own replace, with no format reason.
  const devices = diffEndpoints(running({ "a:1": ["R1"] }, "fp-A"), [withFingerprint(plan("a:1", ["R2"]), "fp-B")]);
  const first = devices[0];
  assert(first.kind === "replace" && first.reason === undefined, "a device change is not reported as a format change");

  // Ordering: a format replace still closes before any start.
  const ordered = diffEndpoints(running({ "b:1": ["R1"] }, "fp-A"), [
    plan("a:1", ["R9"]),
    withFingerprint(plan("b:1", ["R1"]), "fp-B"),
  ]);
  assert(kinds(ordered) === "replace:b:1,start:a:1", `closing before starts: ${kinds(ordered)}`);
}

/** The registry replaces on a fingerprint change and logs the reason. */
export async function runRegistryFingerprintReplaceLogsReasonTests(): Promise<void> {
  const w = world();
  await w.registry.reload([withFingerprint(plan("a:1", ["R1"]), "fp-A")]);
  await w.registry.reload([withFingerprint(plan("a:1", ["R1"]), "fp-A")]);
  assert(w.builds() === 1, "an unchanged fingerprint does not rebuild");
  await w.registry.reload([withFingerprint(plan("a:1", ["R1"]), "fp-B")]);
  assert(w.builds() === 2, "a changed fingerprint rebuilds the endpoint");
  const line = w.logged("endpoint replaced")[0];
  assert(
    line?.fields?.reason === "payload-format-changed",
    `the replace names its reason: ${JSON.stringify(line?.fields)}`,
  );
  await w.registry.reload([withFingerprint(plan("a:1", ["R1"]), "fp-B")]);
  assert(w.builds() === 2, "the new fingerprint is what the registry now compares against");
}
