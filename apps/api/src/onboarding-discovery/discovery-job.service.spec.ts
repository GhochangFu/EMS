import "reflect-metadata";

import type { CredentialCryptoService } from "../security/credential-crypto.service";
import type { BmsTx } from "../database/tenant-context";
import type { ProcessorContinuation } from "../queue/queue-processor";
import type { DiscoveryAuditRow, DiscoveryJobStore, StoredDiscovery } from "./discovery-job-store";
import { DiscoveryJobService, type DiscoveryJobPayload } from "./discovery-job.service";
import { classifyMqttError, listenForDevices } from "./discovery-listener";
import { createDiscoveryCollector } from "./discovery-collector";
import type { HostResolution } from "./discovery-host-guard";
import {
  buildConnectOptions,
  mqttDiscoveryTransport,
  PRODUCTION_TRANSPORT_OPTIONS,
  type DiscoveryClientHandle,
  type DiscoveryConnectOptions,
  type DiscoveryTransportOptions,
  type MqttDiscoveryTransport,
} from "./discovery-transport";

/**
 * `F3.24b` (ADR 0103 decisions 3, 4, 6, 7, 9; security review C1, M1, L1) —
 * the discovery job with a fake store, a fake crypto and a fake transport.
 * One exported assertion per claim.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const PASSWORD = "Pw-7f3a9c-very-secret";
const USERNAME = "discovery-user";
const BROKER_TEXT = "BROKER-SAID-6d1e connection refused by phe.thinkiot.co.in";
const TX = { tx: "phase-a" } as unknown as BmsTx;
const TX2 = { tx: "phase-b" } as unknown as BmsTx;

export const PAYLOAD: DiscoveryJobPayload = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  rtuCode: "R1",
  discoveryId: "33333333-3333-4333-8333-333333333333",
  topicPrefix: "Airsprint-1051/Data",
  windowSeconds: 5,
};

function queuedDiscovery(overrides: Partial<StoredDiscovery> = {}): StoredDiscovery {
  return {
    discoveryId: PAYLOAD.discoveryId,
    rtuCode: "R1",
    topicFilter: `${PAYLOAD.topicPrefix}/#`,
    windowSeconds: 5,
    status: "queued",
    queuedAt: "2026-10-18T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    truncated: false,
    devices: [],
    messages: 0,
    skipped: 0,
    ...overrides,
  };
}

function draftWith(opts: { config?: Record<string, unknown>; discovery?: StoredDiscovery; secrets?: boolean } = {}) {
  return {
    rtus: [
      {
        code: "R1",
        protocol: "mqtt",
        config: opts.config ?? { host: "broker.example.com", port: 8883, tls: true, topic: "Airsprint-1051/Data" },
      },
    ],
    ...(opts.secrets === false ? {} : { _secrets: { R1: { c: "Y2lwaGVy", iv: "aXY=", v: 1 } } }),
    _discovery: opts.discovery ?? queuedDiscovery(),
  };
}

type Probe = {
  readonly writes: { tx: BmsTx; stored: StoredDiscovery }[];
  readonly audits: DiscoveryAuditRow[];
  readonly connects: DiscoveryConnectOptions[];
  readonly subscribes: { filter: string; qos: number }[];
  readonly logs: string[];
  readonly handles: DiscoveryClientHandle[];
};

type Script = (emit: {
  connect(): void;
  message(topic: string, payload: string): void;
  error(error: unknown): void;
  close(): void;
}) => void;

function fakeTransport(probe: Probe, script: Script, subackQos = 0): MqttDiscoveryTransport {
  return {
    connect(options) {
      (probe.connects as DiscoveryConnectOptions[]).push(options);
      const listeners = new Map<string, ((...args: never[]) => void)[]>();
      const fire = (event: string, ...args: unknown[]) => {
        for (const fn of listeners.get(event) ?? []) (fn as (...a: unknown[]) => void)(...args);
      };
      const handle: DiscoveryClientHandle = {
        on(event: string, listener: (...args: never[]) => void) {
          listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        },
        subscribe(filter, opts, callback) {
          (probe.subscribes as { filter: string; qos: number }[]).push({ filter, qos: opts.qos });
          setImmediate(() => callback(null, [{ qos: subackQos }]));
        },
        end() {
          // The fake keeps nothing open.
        },
      } as DiscoveryClientHandle;
      (probe.handles as DiscoveryClientHandle[]).push(handle);
      setImmediate(() =>
        script({
          connect: () => fire("connect"),
          message: (topic, payload) => fire("message", topic, new TextEncoder().encode(payload)),
          error: (error) => fire("error", error),
          close: () => fire("close"),
        }),
      );
      return handle;
    },
  };
}

/** Connects, then three messages, then the broker closes the connection (the window's end in the fake). */
const HAPPY: Script = (emit) => {
  emit.connect();
  setImmediate(() => {
    emit.message("Airsprint-1051/Data/a", JSON.stringify({ dev_id: "D1", values: { kw: 1.5 } }));
    emit.message("Airsprint-1051/Data/a", JSON.stringify({ dev_id: "D1", values: { kw: 1.6, echo: PASSWORD } }));
    emit.message("Airsprint-1051/Data/b", JSON.stringify({ dev_id: "D2", values: { on: true } }));
    setImmediate(() => emit.close());
  });
};

function build(opts: {
  draft?: unknown;
  status?: string;
  noSession?: boolean;
  resolution?: HostResolution;
  decrypted?: Record<string, unknown>;
  script?: Script;
  subackQos?: number;
  transport?: MqttDiscoveryTransport;
  finishWriteThrows?: boolean;
  phaseAWriteThrows?: boolean;
}) {
  const probe: Probe = { writes: [], audits: [], connects: [], subscribes: [], logs: [], handles: [] };
  const resolved: string[] = [];
  const store = {
    inTenant: async <T>(_org: string, fn: (tx: BmsTx) => Promise<T>) => fn(TX2),
    lock: async () =>
      opts.noSession
        ? undefined
        : { draft: opts.draft ?? draftWith(), status: opts.status ?? "draft", messages: [], checkpoints: [] },
    writeDiscovery: async (tx: BmsTx, _sessionId: string, stored: StoredDiscovery) => {
      if (opts.finishWriteThrows && tx === TX2) {
        throw new Error(`write failed near ${BROKER_TEXT}`);
      }
      if (opts.phaseAWriteThrows && tx === TX) {
        throw new Error(`phase A write failed near ${BROKER_TEXT}`);
      }
      probe.writes.push({ tx, stored });
    },
    audit: async (_tx: BmsTx, row: DiscoveryAuditRow) => {
      probe.audits.push(row);
    },
  } as unknown as DiscoveryJobStore;
  const crypto = {
    decrypt: () => opts.decrypted ?? { username: USERNAME, password: PASSWORD, extra: "unread" },
  } as unknown as CredentialCryptoService;
  const transportOptions: DiscoveryTransportOptions = {
    protocol: "mqtts",
    resolve: async (host) => {
      resolved.push(host);
      return opts.resolution ?? { ok: true, address: "203.0.113.7" };
    },
  };
  const service = new DiscoveryJobService(
    crypto,
    store,
    opts.transport ?? fakeTransport(probe, opts.script ?? HAPPY, opts.subackQos),
    transportOptions,
  );
  const logger = {
    log: (m: unknown) => (probe.logs as string[]).push(String(m)),
    warn: (m: unknown) => (probe.logs as string[]).push(String(m)),
    error: (m: unknown) => (probe.logs as string[]).push(String(m)),
  };
  (service as unknown as { logger: typeof logger }).logger = logger;
  return { service, probe, resolved };
}

async function runFully(service: DiscoveryJobService): Promise<void | ProcessorContinuation> {
  const result = await service.run(PAYLOAD, TX);
  if (typeof result === "object" && result !== null) {
    await result.afterCommit();
  }
  return result;
}

const lastStored = (p: Probe): StoredDiscovery | undefined => p.writes[p.writes.length - 1]?.stored;
const everything = (p: Probe): string => JSON.stringify({ writes: p.writes, audits: p.audits, logs: p.logs });

// --- connect options (M1, Q5) ---------------------------------------------

export function assertProductionConnectOptionsExactly(): void {
  const options = buildConnectOptions(
    {
      address: "203.0.113.7",
      typedHost: "broker.example.com",
      port: 8883,
      discoveryId: PAYLOAD.discoveryId,
      credentials: { username: USERNAME, password: PASSWORD },
    },
    PRODUCTION_TRANSPORT_OPTIONS,
  );
  const expected = {
    protocol: "mqtts",
    host: "203.0.113.7",
    port: 8883,
    servername: "broker.example.com",
    clientId: `bms-discovery-${PAYLOAD.discoveryId}`,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 15_000,
    rejectUnauthorized: true,
    username: USERNAME,
    password: PASSWORD,
  };
  assert(
    JSON.stringify(options) === JSON.stringify(expected),
    `the production connect options must be exactly ${JSON.stringify({ ...expected, password: "…" })}; got ${JSON.stringify({ ...options, password: "…" })}`,
  );
}

export function assertNoHostnameKey(): void {
  const options = buildConnectOptions(
    { address: "203.0.113.7", typedHost: "broker.example.com", port: 8883, discoveryId: PAYLOAD.discoveryId, credentials: {} },
    PRODUCTION_TRANSPORT_OPTIONS,
  );
  assert(!("hostname" in options), "the connect options must carry no hostname — mqtt.js reads it before host and looks it up again");
}

export function assertNoServernameForAnIpLiteral(): void {
  const options = buildConnectOptions(
    { address: "203.0.113.7", typedHost: "203.0.113.7", port: 8883, discoveryId: PAYLOAD.discoveryId, credentials: {} },
    PRODUCTION_TRANSPORT_OPTIONS,
  );
  assert(!("servername" in options), "an IP literal must not be sent as SNI (RFC 6066)");
}

export function assertProductionProtocolIsMqtts(): void {
  assert(PRODUCTION_TRANSPORT_OPTIONS.protocol === "mqtts", "the production transport must be mqtts only");
}

export async function assertJobConnectsToTheCheckedAddress(): Promise<void> {
  const { service, probe, resolved } = build({});
  await runFully(service);
  const c = probe.connects[0];
  assert(
    resolved.join() === "broker.example.com" && c?.host === "203.0.113.7" && c.servername === "broker.example.com" && !("hostname" in c),
    `the job must resolve the typed host once and connect to the checked address; got resolved=${resolved.join()} host=${String(c?.host)}`,
  );
}

export async function assertTlsFlagSelectsNothing(): Promise<void> {
  const { service, probe } = build({
    draft: draftWith({ config: { host: "broker.example.com", port: 1883, tls: false, topic: "t" } }),
  });
  await runFully(service);
  const c = probe.connects[0];
  assert(c?.protocol === "mqtts" && c.rejectUnauthorized === true, `tls: false in the draft must still connect mqtts with verification; got ${String(c?.protocol)}`);
}

export async function assertDefaultTransportHandleHasNoPublish(): Promise<void> {
  const handle = mqttDiscoveryTransport.connect({
    protocol: "mqtt",
    host: "127.0.0.1",
    port: 1,
    clientId: "bms-discovery-probe",
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 1_000,
    rejectUnauthorized: true,
  });
  handle.on("error", () => undefined);
  handle.end(true);
  assert(!("publish" in handle), "the transport handle must expose no publish method");
}

// --- the window -----------------------------------------------------------

export async function assertOneSubscriptionToThePrefixWildcard(): Promise<void> {
  const { service, probe } = build({});
  await runFully(service);
  assert(
    probe.subscribes.length === 1 && probe.subscribes[0]?.filter === "Airsprint-1051/Data/#" && probe.subscribes[0].qos === 0,
    `expected one QoS 0 subscription to <prefix>/#; got ${JSON.stringify(probe.subscribes)}`,
  );
}

export async function assertClientIdIsTheDiscoveryOne(): Promise<void> {
  const { service, probe } = build({});
  await runFully(service);
  assert(
    probe.connects[0]?.clientId === `bms-discovery-${PAYLOAD.discoveryId}` && probe.connects[0].clean === true,
    `expected client id bms-discovery-<id> with a clean session; got ${String(probe.connects[0]?.clientId)}`,
  );
}

export async function assertRunningIsWrittenBeforeTheWindow(): Promise<void> {
  const { service, probe } = build({});
  const result = await service.run(PAYLOAD, TX);
  assert(
    probe.connects.length === 0 && probe.writes.length === 1 && probe.writes[0]?.tx === TX &&
      probe.writes[0].stored.status === "running" && probe.writes[0].stored.startedAt !== null,
    `phase A must write running on the processor's transaction and open no connection; got connects=${probe.connects.length} writes=${JSON.stringify(probe.writes.map((w) => w.stored.status))}`,
  );
  assert(typeof result === "object" && result !== null, "phase A must return a continuation for the window");
}

export async function assertDoneResultIsStored(): Promise<void> {
  const { service, probe } = build({});
  await runFully(service);
  const s = lastStored(probe);
  assert(
    probe.writes[probe.writes.length - 1]?.tx === TX2 && s?.status === "done" && s.finishedAt !== null &&
      s.devices.length === 2 && s.messages === 3,
    `the window's result must be stored as done on the second transaction; got ${JSON.stringify(s)}`,
  );
}

export async function assertFinishAuditRowCarriesCounts(): Promise<void> {
  const { service, probe } = build({});
  await runFully(service);
  const finish = probe.audits.filter((a) => a.action === "onboarding.discovery.finish");
  const p = finish[0]?.payload;
  assert(
    finish.length === 1 && p?.status === "done" && p.devices === 2 && p.keys === 3 && p.messages === 3 &&
      finish[0]?.organizationId === PAYLOAD.organizationId && finish[0].sessionId === PAYLOAD.sessionId,
    `expected one finish row with status and counts under the session's organization; got ${JSON.stringify(probe.audits)}`,
  );
}

export async function assertPasswordAppearsNowhere(): Promise<void> {
  const { service, probe } = build({});
  await runFully(service);
  assert(probe.connects[0]?.password === PASSWORD, "the password must reach the connect options");
  const text = everything(probe);
  assert(!text.includes(PASSWORD), "the password must appear in no write, audit row or log line");
}

export async function assertUsernameAppearsNowhere(): Promise<void> {
  const { service, probe } = build({});
  await runFully(service);
  assert(!everything(probe).includes(USERNAME), "the username must appear in no write, audit row or log line");
}

// --- the guards ------------------------------------------------------------

export async function assertSupersededDiscoveryDoesNothing(): Promise<void> {
  const { service, probe } = build({
    draft: draftWith({ discovery: queuedDiscovery({ discoveryId: "44444444-4444-4444-8444-444444444444" }) }),
  });
  const result = await service.run(PAYLOAD, TX);
  assert(
    result === undefined && probe.writes.length === 0 && probe.audits.length === 0 && probe.connects.length === 0,
    `a superseded discovery must write nothing and connect nowhere; got writes=${probe.writes.length} audits=${probe.audits.length}`,
  );
}

export async function assertNonQueuedDiscoveryDoesNothing(): Promise<void> {
  const { service, probe } = build({ draft: draftWith({ discovery: queuedDiscovery({ status: "running" }) }) });
  const result = await service.run(PAYLOAD, TX);
  assert(result === undefined && probe.writes.length === 0, "a re-delivered job whose discovery is no longer queued must do nothing");
}

export async function assertMissingSessionDoesNothing(): Promise<void> {
  const { service, probe } = build({ noSession: true });
  const result = await service.run(PAYLOAD, TX);
  assert(
    result === undefined && probe.writes.length === 0 && probe.logs.every((l) => !l.includes("broker")),
    "a session RLS hides (another organization) must do nothing",
  );
}

export async function assertCommittedSessionDoesNothing(): Promise<void> {
  const { service, probe } = build({ status: "committed" });
  const result = await service.run(PAYLOAD, TX);
  assert(result === undefined && probe.writes.length === 0, "a committed session must do nothing");
}

export async function assertBlockedHostWritesFailedAndOneRefuseRow(): Promise<void> {
  const { service, probe } = build({ resolution: { ok: false, error: "blocked host", reason: "own subnet" } });
  const result = await service.run(PAYLOAD, TX);
  const refuse = probe.audits.filter((a) => a.action === "onboarding.discovery.refuse");
  assert(
    result === undefined && probe.connects.length === 0 && lastStored(probe)?.status === "failed" &&
      lastStored(probe)?.error === "blocked host" && refuse.length === 1 && refuse[0]?.payload.refusal === "blocked host",
    `a blocked host must write failed/blocked host and one refuse row, and never connect; got ${JSON.stringify({ c: probe.connects.length, a: probe.audits })}`,
  );
}

export async function assertUnreachableHostIsNotARefusal(): Promise<void> {
  const { service, probe } = build({ resolution: { ok: false, error: "host unreachable" } });
  await service.run(PAYLOAD, TX);
  const actions = probe.audits.map((a) => a.action).join();
  assert(
    lastStored(probe)?.error === "host unreachable" && actions === "onboarding.discovery.finish",
    `a failed lookup is failed/host unreachable with a finish row, not a refusal; got ${actions}`,
  );
}

export async function assertBadPortIsRefused(): Promise<void> {
  const { service, probe } = build({ draft: draftWith({ config: { host: "broker.example.com", port: 70_000 } }) });
  await service.run(PAYLOAD, TX);
  const refuse = probe.audits.filter((a) => a.action === "onboarding.discovery.refuse");
  assert(
    probe.connects.length === 0 && refuse.length === 1 && refuse[0]?.payload.refusal === "bad port",
    `port 70000 must be refused as bad port; got ${JSON.stringify(probe.audits)}`,
  );
}

export async function assertControlCharCredentialIsRefused(): Promise<void> {
  const { service, probe } = build({ decrypted: { username: "u", password: "pw\r\nCONFIG SET dir /tmp" } });
  const result = await service.run(PAYLOAD, TX);
  const refuse = probe.audits.filter((a) => a.action === "onboarding.discovery.refuse");
  assert(
    result === undefined && probe.connects.length === 0 && refuse.length === 1 &&
      refuse[0]?.payload.refusal === "bad credential" && !everything(probe).includes("CONFIG SET"),
    `a credential with a control character must be refused before any connection (C1); got ${JSON.stringify(probe.audits)}`,
  );
}

export async function assertOnlyStringCredentialFieldsAreRead(): Promise<void> {
  const { service, probe } = build({ decrypted: { username: 42, password: PASSWORD, token: "x" } });
  await runFully(service);
  const c = probe.connects[0];
  assert(
    c !== undefined && !("username" in c) && c.password === PASSWORD && !("token" in c),
    `only string username and password are read from the decrypted record; got keys ${Object.keys(c ?? {}).join()}`,
  );
}

export async function assertNoSecretMeansAnonymous(): Promise<void> {
  const { service, probe } = build({ draft: draftWith({ secrets: false }) });
  await runFully(service);
  const c = probe.connects[0];
  assert(c !== undefined && !("username" in c) && !("password" in c), "an RTU with no stored credential connects anonymously");
}

export async function assertNonMqttRtuFails(): Promise<void> {
  const draft = { ...draftWith(), rtus: [{ code: "R1", protocol: "modbus_tcp", config: {} }] };
  const { service, probe } = build({ draft });
  const result = await service.run(PAYLOAD, TX);
  assert(
    result === undefined && probe.connects.length === 0 && lastStored(probe)?.status === "failed",
    "an RTU that is no longer MQTT must fail without a connection",
  );
}

// --- errors (L1) and the crash path -------------------------------------------

export async function assertBrokerErrorIsClassedAndItsTextIsDropped(): Promise<void> {
  const { service, probe } = build({
    script: (emit) => emit.error(Object.assign(new Error(BROKER_TEXT), { code: "ECONNREFUSED" })),
  });
  await runFully(service);
  assert(lastStored(probe)?.error === "host unreachable", `ECONNREFUSED must be host unreachable; got ${String(lastStored(probe)?.error)}`);
  assert(!everything(probe).includes("BROKER-SAID"), "the broker's text must appear in no write, audit row or log line");
}

export async function assertConnectThrowIsFailedWithAFinishRow(): Promise<void> {
  const transport: MqttDiscoveryTransport = {
    connect() {
      throw new TypeError(BROKER_TEXT);
    },
  };
  const { service, probe } = build({ transport });
  let thrown: unknown;
  try {
    await runFully(service);
  } catch (err) {
    thrown = err;
  }
  assert(thrown === undefined, "the continuation must never throw (L1)");
  assert(
    lastStored(probe)?.status === "failed" && probe.audits.some((a) => a.action === "onboarding.discovery.finish"),
    `a transport that throws must still leave failed and a finish row (try/finally); got ${JSON.stringify(probe.audits)}`,
  );
}

/** A listen that rejects (a handle that throws while listeners register) still ends in failed and a finish row: the job's `finally`. */
export async function assertRejectedListenIsFailedWithAFinishRow(): Promise<void> {
  const transport: MqttDiscoveryTransport = {
    connect: () =>
      ({
        on: () => {
          throw new Error(BROKER_TEXT);
        },
        subscribe: () => undefined,
        end: () => undefined,
      }) as unknown as DiscoveryClientHandle,
  };
  const { service, probe } = build({ transport });
  let thrown: unknown;
  try {
    await runFully(service);
  } catch (err) {
    thrown = err;
  }
  assert(thrown === undefined, "a rejected listen must not reject the continuation (L1)");
  assert(
    lastStored(probe)?.status === "failed" && probe.audits.some((a) => a.action === "onboarding.discovery.finish"),
    `a rejected listen must still leave failed and a finish row; got ${JSON.stringify(probe.audits)}`,
  );
  assert(!everything(probe).includes("BROKER-SAID"), "the thrown text must appear nowhere");
}

/** A throw inside the collector ends the window as failed instead of leaving the promise unsettled. */
export async function assertCollectorThrowEndsTheWindow(): Promise<void> {
  const probe: Probe = { writes: [], audits: [], connects: [], subscribes: [], logs: [], handles: [] };
  const outcome = await listenForDevices({
    transport: fakeTransport(probe, (emit) => {
      emit.connect();
      setImmediate(() => emit.message("t/a", "{}"));
    }),
    options: {} as DiscoveryConnectOptions,
    filter: "t/#",
    windowMs: 60_000,
    collector: {
      offer: () => {
        throw new Error("boom");
      },
      stopped: false,
      result: () => createDiscoveryCollector({}).result(),
    },
  });
  assert(outcome.kind === "failed", `a collector throw must end the window as failed; got ${JSON.stringify(outcome)}`);
}

export async function assertFailedFinishWriteDoesNotThrow(): Promise<void> {
  const { service, probe } = build({ finishWriteThrows: true });
  let thrown: unknown;
  try {
    await runFully(service);
  } catch (err) {
    thrown = err;
  }
  assert(thrown === undefined, "a failed final write must not reject the continuation (L1)");
  assert(!probe.logs.join("\n").includes("BROKER-SAID"), "the final write's error text must not be logged");
}

export async function assertSubackRefusalIsAuthRefused(): Promise<void> {
  const { service, probe } = build({ script: (emit) => emit.connect(), subackQos: 128 });
  await runFully(service);
  assert(lastStored(probe)?.error === "auth refused", `a SUBACK of 0x80 must be auth refused; got ${String(lastStored(probe)?.error)}`);
}

export function assertErrorClassOf(error: unknown, expected: string): void {
  const got = classifyMqttError(error);
  assert(got === expected, `expected ${JSON.stringify(error)} to classify as ${expected}; got ${got}`);
}

export async function assertConnectTimerIsTimeout(): Promise<void> {
  const silent: MqttDiscoveryTransport = {
    connect: () => ({ on: () => undefined, subscribe: () => undefined, end: () => undefined }) as DiscoveryClientHandle,
  };
  const outcome = await listenForDevices({
    transport: silent,
    options: {} as DiscoveryConnectOptions,
    filter: "t/#",
    windowMs: 1_000,
    collector: createDiscoveryCollector({}),
    connectTimeoutMs: 10,
  });
  assert(outcome.kind === "failed" && outcome.error === "timeout", `no CONNACK within the bound must be timeout; got ${JSON.stringify(outcome)}`);
}

/**
 * The phase-A crash path: a throw on the first transaction (here, the
 * `running` write) must not leave the discovery `queued` for ever — `queued`
 * has no stale bound, and one per organization is allowed, so a stuck one
 * would block the whole organization. The job hands back a continuation that
 * writes `failed` and one `finish` row in a fresh transaction.
 */
export async function assertPhaseAThrowResolvesWithAContinuation(): Promise<void> {
  const { service } = build({ phaseAWriteThrows: true });
  let thrown: unknown;
  let result: void | ProcessorContinuation = undefined;
  try {
    result = await service.run(PAYLOAD, TX);
  } catch (err) {
    thrown = err;
  }
  assert(
    thrown === undefined && typeof result === "object" && result !== null,
    `a phase-A throw must resolve with a continuation, not reject (L1); thrown=${String(thrown)}`,
  );
}

export async function assertPhaseAThrowWritesFailedInTheSecondTransaction(): Promise<void> {
  const { service, probe } = build({ phaseAWriteThrows: true });
  await runFully(service);
  const second = probe.writes.filter((w) => w.tx === TX2);
  assert(
    second.length === 1 && second[0]?.stored.status === "failed" && probe.connects.length === 0,
    `a phase-A throw must write failed once on the second transaction and never connect; writes=${JSON.stringify(second.map((w) => w.stored.status))} connects=${probe.connects.length}`,
  );
}

export async function assertPhaseAThrowWritesOneFinishRow(): Promise<void> {
  const { service, probe } = build({ phaseAWriteThrows: true });
  await runFully(service);
  const finish = probe.audits.filter((a) => a.action === "onboarding.discovery.finish");
  assert(
    finish.length === 1 && finish[0]?.payload.status === "failed",
    `a phase-A throw must write one failed finish row; got ${JSON.stringify(probe.audits.map((a) => a.action))}`,
  );
}

export async function assertPhaseAThrowTextIsNotLogged(): Promise<void> {
  const { service, probe } = build({ phaseAWriteThrows: true });
  await runFully(service);
  assert(!everything(probe).includes("BROKER-SAID"), "a phase-A error's text must not reach a log, a write or an audit row");
}
