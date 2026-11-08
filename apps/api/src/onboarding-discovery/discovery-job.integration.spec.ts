import "reflect-metadata";

import { randomUUID } from "node:crypto";

import { connect, type MqttClient } from "mqtt";

import type { BmsTx } from "../database/tenant-context";
import type { CredentialCryptoService } from "../security/credential-crypto.service";
import { until } from "../testing/until";
import { mqttPayloadFormatDefinitionSchema } from "@bms/shared";

import { BUILTIN_DISCOVERY_FORMATS, type DiscoveryFormat } from "./discovery-collector";
import type { DiscoveryAuditRow, DiscoveryJobStore, StoredDiscovery } from "./discovery-job-store";
import { DiscoveryJobService, type DiscoveryJobPayload } from "./discovery-job.service";
import {
  mqttDiscoveryTransport,
  type DiscoveryConnectOptions,
  type MqttDiscoveryTransport,
} from "./discovery-transport";

/**
 * `F3.24b` (ADR 0103 *Verification owed*, integration) — the discovery job
 * against a real broker (`MQTT_TEST_URL`; CI runs `eclipse-mosquitto:2.0`).
 *
 * **The seam.** The job is constructed with the production transport
 * (`mqttDiscoveryTransport`, wrapped only to record the options it was
 * handed) and `protocol: "mqtt"` plus a resolver that answers the broker's
 * address — constructor injection, never the environment, so the production
 * path stays `mqtts`-only and guarded. The store is in memory: the database
 * half is `discovery-job-store.spec.ts`'s.
 *
 * **"Never publishes" is a count, not an id check.** MQTT 3.1.1 messages
 * carry no publisher client id, so an observer on `<prefix>/#` counts what it
 * receives and the test asserts it equals what the publisher sent — any
 * message from the job would make the observer's count larger.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Run = {
  readonly payload: DiscoveryJobPayload;
  readonly stored: () => StoredDiscovery | undefined;
  readonly audits: () => readonly DiscoveryAuditRow[];
};

/** `F4.334`: the seeded `thinkiot-register-array` format (migration `0130`). */
const BCPL_FORMAT: DiscoveryFormat = {
  code: "thinkiot-register-array",
  definition: mqttPayloadFormatDefinitionSchema.parse({
    kind: "declarative",
    root: "array",
    deviceKey: ["TagName"],
    time: { path: ["Timestamp"], unit: "epoch_s" },
    readings: [
      { key: "treated_water_flow_klh", register: { path: ["Data"], index: 0, type: "float32" } },
      { key: "outlet_flow_totalizer_kl", register: { path: ["Data"], index: 3, type: "float32" } },
    ],
  }),
};

export type MqttSuite = {
  readonly url: URL;
  readonly prefix: string;
  readonly connects: DiscoveryConnectOptions[];
  readonly service: DiscoveryJobService;
  readonly clients: MqttClient[];
};

function memoryStore(drafts: Map<string, Record<string, unknown>>, audits: Map<string, DiscoveryAuditRow[]>) {
  return {
    inTenant: async <T>(_org: string, fn: (tx: BmsTx) => Promise<T>) => fn({} as BmsTx),
    // F4.334: the built-in envelope and the seeded BCPL format, as the catalog holds them.
    formats: async () => ({ formats: [...BUILTIN_DISCOVERY_FORMATS, BCPL_FORMAT], invalid: [] }),
    lock: async (_tx: BmsTx, sessionId: string) => {
      const draft = drafts.get(sessionId);
      return draft === undefined ? undefined : { draft, status: "draft", messages: [], checkpoints: [] };
    },
    writeDiscovery: async (_tx: BmsTx, sessionId: string, stored: StoredDiscovery) => {
      const draft = drafts.get(sessionId);
      if (draft !== undefined) {
        drafts.set(sessionId, { ...draft, _discovery: stored });
      }
    },
    audit: async (_tx: BmsTx, row: DiscoveryAuditRow) => {
      audits.set(row.sessionId, [...(audits.get(row.sessionId) ?? []), row]);
    },
  } as unknown as DiscoveryJobStore;
}

const drafts = new Map<string, Record<string, unknown>>();
const auditsBySession = new Map<string, DiscoveryAuditRow[]>();

export function openMqttSuite(rawUrl: string): MqttSuite {
  const url = new URL(rawUrl);
  const connects: DiscoveryConnectOptions[] = [];
  const recording: MqttDiscoveryTransport = {
    connect(options) {
      connects.push(options);
      return mqttDiscoveryTransport.connect(options);
    },
  };
  const service = new DiscoveryJobService(
    {} as CredentialCryptoService,
    memoryStore(drafts, auditsBySession),
    recording,
    { protocol: "mqtt", resolve: async () => ({ ok: true, address: url.hostname }) },
  );
  return { url, prefix: `bms-it/${randomUUID()}`, connects, service, clients: [] };
}

export async function closeMqttSuite(suite: MqttSuite): Promise<void> {
  await Promise.all(suite.clients.map((c) => c.endAsync(true).catch(() => undefined)));
}

async function client(suite: MqttSuite, clientId: string): Promise<MqttClient> {
  const c = connect({
    protocol: "mqtt",
    host: suite.url.hostname,
    port: Number(suite.url.port || 1883),
    clientId,
    reconnectPeriod: 0,
  });
  suite.clients.push(c);
  await new Promise<void>((resolve, reject) => {
    c.once("connect", () => resolve());
    c.once("error", reject);
  });
  return c;
}

/** Starts one job for a fresh session on `<suite prefix>/<leaf>`, as the route and `runProcessor` would. */
async function startJob(suite: MqttSuite, leaf: string): Promise<{ run: Run; done: Promise<void> }> {
  const sessionId = randomUUID();
  const discoveryId = randomUUID();
  const topicPrefix = `${suite.prefix}/${leaf}`;
  drafts.set(sessionId, {
    rtus: [{ code: "R1", protocol: "mqtt", config: { host: "broker.test", port: Number(suite.url.port || 1883), topic: topicPrefix } }],
    _discovery: {
      discoveryId,
      rtuCode: "R1",
      topicFilter: `${topicPrefix}/#`,
      windowSeconds: 5,
      status: "queued",
      queuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      truncated: false,
      devices: [],
      messages: 0,
      skipped: 0,
    },
  });
  const payload: DiscoveryJobPayload = {
    organizationId: randomUUID(),
    sessionId,
    rtuCode: "R1",
    discoveryId,
    topicPrefix,
    windowSeconds: 5,
  };
  const continuation = await suite.service.run(payload, {} as BmsTx);
  assert(typeof continuation === "object" && continuation !== null, "phase A must hand back the broker window");
  const run: Run = {
    payload,
    stored: () => drafts.get(sessionId)?._discovery as StoredDiscovery | undefined,
    audits: () => auditsBySession.get(sessionId) ?? [],
  };
  return { run, done: (continuation as { afterCommit: () => Promise<void> }).afterCommit() };
}

export type WindowOutcome = {
  readonly devices: Run;
  readonly wide: Run;
  readonly sent: number;
  readonly observed: number;
  readonly observedDuringWindow: number;
};

/**
 * Two concurrent jobs: `devices` on `<prefix>/a` (two `dev_id`s on two
 * topics) and `wide` on `<prefix>/w` (one device with 501 keys). A publisher
 * keeps sending to both until both windows end, and an observer on
 * `<prefix>/#` — the concurrent ingest-style subscriber — counts everything.
 */
export async function runWindow(suite: MqttSuite): Promise<WindowOutcome> {
  let observed = 0;
  const arrivals: number[] = [];
  const observer = await client(suite, `bms-it-observer-${randomUUID()}`);
  await observer.subscribeAsync(`${suite.prefix}/#`, { qos: 1 });
  observer.on("message", () => {
    observed += 1;
    arrivals.push(Date.now());
  });
  const publisher = await client(suite, `bms-it-publisher-${randomUUID()}`);

  const devices = await startJob(suite, "a");
  const wide = await startJob(suite, "w");
  let finished = false;
  const both = Promise.all([devices.done, wide.done]).then(() => {
    finished = true;
  });

  const wideValues = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`k${i}`, i]));
  let sent = 0;
  while (!finished) {
    await publisher.publishAsync(`${suite.prefix}/a/x`, JSON.stringify({ dev_id: "DEV-A", values: { kw: 1.5, kva: 2 } }), { qos: 1 });
    await publisher.publishAsync(`${suite.prefix}/a/y`, JSON.stringify({ dev_id: "DEV-B", values: { temp: 21.5 } }), { qos: 1 });
    await publisher.publishAsync(`${suite.prefix}/w/z`, JSON.stringify({ dev_id: "DEV-W", values: wideValues }), { qos: 1 });
    sent += 3;
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  await both;
  await until(() => observed >= sent, { timeoutMs: 5_000, label: "the observer received every published message" });
  // Anything the job published would arrive after the publisher's own; give it time to.
  await new Promise<void>((resolve) => setTimeout(resolve, 500));

  const startedAt = Date.parse(devices.run.stored()?.startedAt ?? "");
  const finishedAt = Date.parse(devices.run.stored()?.finishedAt ?? "");
  const observedDuringWindow = arrivals.filter((t) => t > startedAt && t < finishedAt).length;
  return { devices: devices.run, wide: wide.run, sent, observed, observedDuringWindow };
}

export function assertBothDevicesAndTheirKeys(o: WindowOutcome, prefix: string): void {
  const s = o.devices.stored();
  const shape = (s?.devices ?? [])
    .map((d) => `${d.topic}|${d.devId}|${d.keys.map((k) => k.sourceKey).sort().join("+")}`)
    .sort();
  assert(
    s?.status === "done" &&
      shape.join(",") === `${prefix}/a/x|DEV-A|kva+kw,${prefix}/a/y|DEV-B|temp`,
    `expected both devices with their keys; got status=${String(s?.status)} ${shape.join(",")}`,
  );
}

export function assertTheWideDeviceIsTruncated(o: WindowOutcome): void {
  const s = o.wide.stored();
  assert(
    s?.status === "done" && s.truncated && s.devices[0]?.keys.length === 500,
    `501 keys on one device must truncate it to 500; got truncated=${String(s?.truncated)} keys=${s?.devices[0]?.keys.length}`,
  );
}

export function assertEachJobUsedItsOwnClientId(suite: MqttSuite, o: WindowOutcome): void {
  const ids = suite.connects.map((c) => c.clientId).sort();
  const expected = [o.devices.payload.discoveryId, o.wide.payload.discoveryId].map((id) => `bms-discovery-${id}`).sort();
  assert(
    ids.join() === expected.join() && new Set(ids).size === 2,
    `each job must connect once with its own bms-discovery-<id>; got ${ids.join()}`,
  );
}

export function assertTheJobNeverPublished(o: WindowOutcome): void {
  assert(
    o.observed === o.sent,
    `the observer must receive exactly what the publisher sent — a larger count means the job published; sent=${o.sent} observed=${o.observed}`,
  );
}

export function assertTheConcurrentSubscriberKeptReceiving(o: WindowOutcome): void {
  assert(
    o.observedDuringWindow >= 3,
    `the concurrent subscriber must keep receiving during the job's window; got ${o.observedDuringWindow} messages inside it`,
  );
}

export function assertOneFinishRowPerJob(o: WindowOutcome): void {
  const finish = [...o.devices.audits(), ...o.wide.audits()].filter((a) => a.action === "onboarding.discovery.finish");
  assert(finish.length === 2, `expected one finish row per job; got ${finish.length}`);
}

export type PlainOutcome = { readonly run: Run; readonly connects: readonly DiscoveryConnectOptions[]; readonly prefix: string };

/**
 * `F4.326` / ADR 0114 decision 4 — a discovery over plain MQTT with the
 * **production** protocol (`mqtts`) left in the transport options: the draft
 * RTU's literal `tls: false` and its host on the allowlist are what select
 * `mqtt`, so the CI broker (plain, 1883) is reachable only through the rule.
 * The resolver stays injected — the CI broker is a loopback address the
 * production host guard refuses.
 */
export async function runPlainWindow(suite: MqttSuite): Promise<PlainOutcome> {
  const connects: DiscoveryConnectOptions[] = [];
  const recording: MqttDiscoveryTransport = {
    connect(options) {
      connects.push(options);
      return mqttDiscoveryTransport.connect(options);
    },
  };
  const service = new DiscoveryJobService(
    {} as CredentialCryptoService,
    memoryStore(drafts, auditsBySession),
    recording,
    { protocol: "mqtts", resolve: async () => ({ ok: true, address: suite.url.hostname }) },
    new Set(["broker.test"]),
  );
  const sessionId = randomUUID();
  const discoveryId = randomUUID();
  const topicPrefix = `${suite.prefix}/plain`;
  drafts.set(sessionId, {
    rtus: [
      {
        code: "R1",
        protocol: "mqtt",
        config: { host: "Broker.Test", port: Number(suite.url.port || 1883), tls: false, topic: topicPrefix },
      },
    ],
    _discovery: {
      discoveryId,
      rtuCode: "R1",
      topicFilter: `${topicPrefix}/#`,
      windowSeconds: 5,
      status: "queued",
      queuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      truncated: false,
      devices: [],
      messages: 0,
      skipped: 0,
    },
  });
  const payload: DiscoveryJobPayload = { organizationId: randomUUID(), sessionId, rtuCode: "R1", discoveryId, topicPrefix, windowSeconds: 5, tls: false };
  const continuation = await service.run(payload, {} as BmsTx);
  assert(typeof continuation === "object" && continuation !== null, "phase A must hand back the broker window");
  let finished = false;
  const done = (continuation as { afterCommit: () => Promise<void> }).afterCommit().then(() => {
    finished = true;
  });
  const publisher = await client(suite, `bms-it-plain-publisher-${randomUUID()}`);
  while (!finished) {
    await publisher.publishAsync(`${topicPrefix}/m`, JSON.stringify({ dev_id: "LALRLY1", values: { flow: 4.2 } }), { qos: 1 });
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  await done;
  const run: Run = {
    payload,
    stored: () => drafts.get(sessionId)?._discovery as StoredDiscovery | undefined,
    audits: () => auditsBySession.get(sessionId) ?? [],
  };
  return { run, connects, prefix: topicPrefix };
}

export function assertThePlainDiscoveryReturnsTheDevice(o: PlainOutcome): void {
  const s = o.run.stored();
  assert(o.connects[0]?.protocol === "mqtt", `the allowlisted tls:false RTU connects mqtt; got ${String(o.connects[0]?.protocol)}`);
  assert(
    s?.status === "done" && s.devices.some((d) => d.devId === "LALRLY1" && d.topic === `${o.prefix}/m`),
    `the plain discovery returns the device; got status=${String(s?.status)} devices=${JSON.stringify(s?.devices)}`,
  );
}

/**
 * `F4.334` / ADR 0116 decision 8 (plan §4.6 for PR 4) — the BCPL golden sample
 * through the real broker: the job decodes it with the register-array format
 * and stores the device with its format and the two readings.
 */
export async function runBcplWindow(suite: MqttSuite): Promise<Run> {
  const job = await startJob(suite, "bcpl");
  let finished = false;
  const done = job.done.then(() => {
    finished = true;
  });
  const publisher = await client(suite, `bms-it-bcpl-publisher-${randomUUID()}`);
  const sample = JSON.stringify([
    { Data: [16294, 26214, 81, 18230, 9202, 113, 17852, -17809, 177, 82], Timestamp: "1794077986", TagName: "BCPL_LAKWA_02" },
  ]);
  while (!finished) {
    await publisher.publishAsync(`${job.run.payload.topicPrefix}/data`, sample, { qos: 1 });
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  await done;
  return job.run;
}

export function assertTheBcplDeviceDecodesWithItsFormat(run: Run): void {
  const s = run.stored();
  const device = s?.devices.find((d) => d.devId === "BCPL_LAKWA_02");
  const keys = Object.fromEntries((device?.keys ?? []).map((k) => [k.sourceKey, k.sampleValue]));
  assert(
    s?.status === "done" &&
      device?.payloadFormat === "thinkiot-register-array" &&
      keys.treated_water_flow_klh === 1.2999999523162842 &&
      keys.outlet_flow_totalizer_kl === 46627.9453125 &&
      s.skipped === 0,
    `the BCPL device decodes with its format; got ${JSON.stringify(s)}`,
  );
}
