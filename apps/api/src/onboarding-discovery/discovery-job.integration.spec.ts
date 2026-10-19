import "reflect-metadata";

import { randomUUID } from "node:crypto";

import { connect, type MqttClient } from "mqtt";

import type { BmsTx } from "../database/tenant-context";
import type { CredentialCryptoService } from "../security/credential-crypto.service";
import { until } from "../testing/until";
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
