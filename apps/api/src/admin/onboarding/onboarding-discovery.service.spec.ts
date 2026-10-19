import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { startOnboardingDiscoveryBodySchema } from "@bms/shared";
import { expect } from "vitest";

import type { QueueClient } from "../../queue/queue-registry";
import { OnboardingController } from "./onboarding.controller";
import {
  DISCOVERY_BAD_PORT,
  DISCOVERY_BLOCKED_HOST,
  DISCOVERY_BUSY,
  DISCOVERY_NOT_MQTT,
  DISCOVERY_NO_CREDENTIALS,
  DISCOVERY_NO_RTU,
  DISCOVERY_NO_TARGET,
  DISCOVERY_NO_WORKER,
  DISCOVERY_TARGET_CHANGED,
  OnboardingDiscoveryService,
} from "./onboarding-discovery.service";
import { SESSION_NO_LONGER_DRAFT } from "./onboarding-locked-writes";

/**
 * `F3.24b` U3 (ADR 0103 decisions 2, 5, 7 and 9; the security review's H3,
 * M2–M5) — `POST /admin/onboarding/sessions/:id/discovery`, over a recording
 * store, a recording audit service and a recording queue. Vitest entry point:
 * the sibling `.test.ts` (ADR 0014).
 */

const JWT = { sub: "kc-1", email: "a@b.c" } as never;
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
/** The organization the locked row carries; distinct from the loaded one so a spec can tell which was used (M4). */
const LOCKED_ORG = "33333333-3333-4333-8333-333333333333";
const OTHER_DISCOVERY_ID = "44444444-4444-4444-8444-444444444444";
const CIPHERTEXT = "SECRET-CIPHERTEXT-c";
const NOW = Date.parse("2026-10-18T12:00:00.000Z");

const BODY = {
  rtuCode: "R1",
  topicPrefix: "Airsprint-1051/Data",
  expected: { host: "broker.example.com", port: 8883 },
};

function draft(overrides: { rtu?: Record<string, unknown>; secrets?: boolean; discovery?: unknown } = {}) {
  return {
    location: { name: "Berhampur", code: "BRH" },
    rtus: [
      {
        code: "R1",
        displayName: "R1",
        protocol: "mqtt",
        config: { host: "broker.example.com", port: 8883, tls: true, topic: "Airsprint-1051/Data/1051" },
        credentialsSet: true,
        ...overrides.rtu,
      },
    ],
    ...(overrides.secrets === false ? {} : { _secrets: { R1: { c: CIPHERTEXT, iv: "iv", v: 1 } } }),
    ...(overrides.discovery === undefined ? {} : { _discovery: overrides.discovery }),
  };
}

function stored(status: string, extra: Record<string, unknown> = {}) {
  return {
    discoveryId: OTHER_DISCOVERY_ID,
    rtuCode: "R1",
    topicFilter: "a/#",
    windowSeconds: 60,
    status,
    startedAt: null,
    finishedAt: null,
    truncated: false,
    devices: [],
    queuedAt: "2026-10-18T11:59:00.000Z",
    messages: 0,
    skipped: 0,
    ...extra,
  };
}

type Harness = {
  service: OnboardingDiscoveryService;
  events: string[];
  writes: Record<string, unknown>[];
  audits: { action: string; organizationId: string | null; payload: Record<string, unknown> }[];
  jobs: { name: string; payload: Record<string, unknown>; opts: Record<string, unknown> }[];
  loaded: number;
};

type Options = {
  draft?: Record<string, unknown>;
  status?: string;
  lockedStatus?: string;
  elsewhere?: unknown[];
  queue?: "configured" | "unconfigured" | "throws";
  notFound?: boolean;
};

function harness(options: Options = {}): Harness {
  const events: string[] = [];
  const writes: Record<string, unknown>[] = [];
  const audits: Harness["audits"] = [];
  const jobs: Harness["jobs"] = [];
  let currentDraft: Record<string, unknown> = options.draft ?? draft();
  const state = { loaded: 0 };

  const sessions = {
    loadSession: async () => {
      state.loaded += 1;
      events.push("load");
      if (options.notFound) throw new NotFoundException("Onboarding session not found");
      return { id: SESSION_ID, organizationId: ORG, status: options.status ?? "draft", draft: currentDraft };
    },
  };
  const store = {
    inTenant: async (organizationId: string, fn: (tx: unknown) => Promise<unknown>) => {
      events.push(`tx:${organizationId}`);
      return fn({ tx: true });
    },
    lockOrganization: async (_tx: unknown, organizationId: string) => {
      events.push(`advisory:${organizationId}`);
    },
    lock: async () => {
      events.push("lock");
      return { organizationId: LOCKED_ORG, status: options.lockedStatus ?? "draft", draft: currentDraft, messages: [], checkpoints: null };
    },
    activeDiscoveriesElsewhere: async () => options.elsewhere ?? [],
    writeDiscovery: async (_tx: unknown, _sessionId: string, value: Record<string, unknown>) => {
      events.push(`write:${String(value.status)}`);
      writes.push(value);
      currentDraft = { ...currentDraft, _discovery: value };
    },
  };
  const audit = {
    write: async (input: { action: string; organizationId: string | null; payload?: Record<string, unknown> }) => {
      events.push(`audit:${input.action}`);
      audits.push({ action: input.action, organizationId: input.organizationId, payload: input.payload ?? {} });
    },
  };
  const queue: QueueClient =
    options.queue === "unconfigured"
      ? { kind: "unconfigured" }
      : ({
          kind: "configured",
          prefix: "bms",
          connection: {},
          close: async () => undefined,
          queues: new Map([
            [
              "onboarding-discovery",
              {
                add: async (name: string, payload: Record<string, unknown>, opts: Record<string, unknown>) => {
                  if (options.queue === "throws") throw new Error("connect ECONNREFUSED 10.0.0.9:6379");
                  events.push("enqueue");
                  jobs.push({ name, payload, opts });
                },
              },
            ],
          ]),
        } as never);

  const service = new OnboardingDiscoveryService(sessions as never, store as never, audit as never, queue, () => NOW);
  return {
    service,
    events,
    writes,
    audits,
    jobs,
    get loaded() {
      return state.loaded;
    },
  };
}

function start(h: Harness, body: unknown = BODY) {
  return h.service.start(JWT, SESSION_ID, startOnboardingDiscoveryBodySchema.safeParse(body));
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

// ---- 202 ------------------------------------------------------------------

export async function aStartWritesAQueuedDiscovery(): Promise<void> {
  const h = harness();
  await start(h);
  expect(h.writes).toEqual([
    expect.objectContaining({
      rtuCode: "R1",
      topicFilter: "Airsprint-1051/Data/#",
      windowSeconds: 60,
      status: "queued",
      startedAt: null,
      finishedAt: null,
      truncated: false,
      devices: [],
      queuedAt: new Date(NOW).toISOString(),
      messages: 0,
      skipped: 0,
    }),
  ]);
}

export async function aStartAuditsOneStartRowFromTheLockedOrganization(): Promise<void> {
  const h = harness();
  await start(h);
  expect(h.audits).toEqual([
    {
      action: "onboarding.discovery.start",
      organizationId: LOCKED_ORG,
      payload: {
        discoveryId: h.writes[0]?.discoveryId,
        rtuCode: "R1",
        host: "broker.example.com",
        port: 8883,
        topicFilter: "Airsprint-1051/Data/#",
        windowSeconds: 60,
      },
    },
  ]);
}

/** Security review M4: the payload's organization is the locked row's, never the JWT's or the body's. */
export async function aStartEnqueuesTheExactPayload(): Promise<void> {
  const h = harness();
  await start(h, { ...BODY, windowSeconds: 30 });
  const id = h.writes[0]?.discoveryId;
  expect(h.jobs).toEqual([
    {
      name: "onboarding-discovery",
      payload: {
        organizationId: LOCKED_ORG,
        sessionId: SESSION_ID,
        rtuCode: "R1",
        discoveryId: id,
        topicPrefix: "Airsprint-1051/Data",
        windowSeconds: 30,
      },
      opts: expect.objectContaining({ jobId: `discovery-${String(id)}`, attempts: 1 }),
    },
  ]);
}

export async function aStartAnswersTheDiscoveryId(): Promise<void> {
  const h = harness();
  const answer = await start(h);
  expect(answer).toEqual({ discoveryId: h.writes[0]?.discoveryId });
}

/** The job is enqueued only after the transaction that stored `queued` returned. */
export async function aStartEnqueuesAfterTheWrite(): Promise<void> {
  const h = harness();
  await start(h);
  expect(h.events.indexOf("enqueue")).toBeGreaterThan(h.events.indexOf("audit:onboarding.discovery.start"));
}

/** Security review M3: the organization's advisory lock comes before the row lock. */
export async function aStartTakesTheOrganizationLockBeforeTheRowLock(): Promise<void> {
  const h = harness();
  await start(h);
  expect(h.events.slice(0, 4)).toEqual(["load", `tx:${ORG}`, `advisory:${ORG}`, "lock"]);
}

// ---- M5: the gate before any refuse row --------------------------------

export async function anUnknownSessionWritesNoRefuseRow(): Promise<void> {
  const h = harness({ notFound: true });
  await expect(start(h, { ...BODY, topicPrefix: "a/+" })).rejects.toBeInstanceOf(NotFoundException);
  expect(h.events).toEqual(["load"]);
}

export async function aBadPrefixIsA400(): Promise<void> {
  const h = harness();
  await expect(start(h, { ...BODY, topicPrefix: "a/+" })).rejects.toBeInstanceOf(BadRequestException);
}

/** Security review M5: the row names the refusal only; the refused prefix is never stored. */
export async function aBadPrefixAuditsARefuseRowWithNoPrefix(): Promise<void> {
  const h = harness();
  await rejection(start(h, { ...BODY, topicPrefix: "password=hunter2/+" }));
  expect(h.audits).toEqual([
    { action: "onboarding.discovery.refuse", organizationId: LOCKED_ORG, payload: { refusal: "bad prefix" } },
  ]);
}

export async function aBadPrefixRefuseRowFollowsTheGate(): Promise<void> {
  const h = harness();
  await rejection(start(h, { ...BODY, topicPrefix: "a/#" }));
  expect(h.events.indexOf("load")).toBeLessThan(h.events.indexOf("audit:onboarding.discovery.refuse"));
}

export async function anotherBodyErrorIsA400WithNoAudit(): Promise<void> {
  const h = harness();
  await expect(start(h, { ...BODY, windowSeconds: 4 })).rejects.toBeInstanceOf(BadRequestException);
  expect(h.audits).toEqual([]);
}

// ---- 400 / 403 with no audit row ----------------------------------------

export async function aCommittedSessionIsA403WithNoAudit(): Promise<void> {
  const h = harness({ status: "committed" });
  await expect(start(h)).rejects.toBeInstanceOf(ForbiddenException);
  expect(h.audits).toEqual([]);
}

export async function aSessionCommittedBeforeTheLockIsA409(): Promise<void> {
  const h = harness({ lockedStatus: "committed" });
  const err = await rejection(start(h));
  expect(err).toEqual(new ConflictException(SESSION_NO_LONGER_DRAFT));
}

async function refusedWithNoAudit(options: Options, message: string, body: unknown = BODY): Promise<Harness> {
  const h = harness(options);
  const err = await rejection(start(h, body));
  expect(err).toEqual(new BadRequestException(message));
  expect({ audits: h.audits, writes: h.writes, jobs: h.jobs }).toEqual({ audits: [], writes: [], jobs: [] });
  return h;
}

export async function anUnknownRtuIsA400(): Promise<void> {
  await refusedWithNoAudit({}, DISCOVERY_NO_RTU, { ...BODY, rtuCode: "R9" });
}

export async function aNonMqttRtuIsA400(): Promise<void> {
  await refusedWithNoAudit({ draft: draft({ rtu: { protocol: "modbus_tcp" } }) }, DISCOVERY_NOT_MQTT);
}

/** Decisions Q4: no connection target existed, so no refusal class fits and no row is written. */
export async function anRtuWithNoHostIsA400(): Promise<void> {
  await refusedWithNoAudit({ draft: draft({ rtu: { config: { port: 8883 } } }) }, DISCOVERY_NO_TARGET);
}

export async function anRtuWithNoPortIsA400(): Promise<void> {
  await refusedWithNoAudit({ draft: draft({ rtu: { config: { host: "broker.example.com" } } }) }, DISCOVERY_NO_TARGET);
}

export async function anRtuWithNoCredentialsIsA400(): Promise<void> {
  await refusedWithNoAudit({ draft: draft({ secrets: false }) }, DISCOVERY_NO_CREDENTIALS);
}

// ---- refusals with a refuse row -----------------------------------------

async function refusedWithRow(
  options: Options,
  error: Error,
  refusal: string,
  body: unknown = BODY,
): Promise<Harness> {
  const h = harness(options);
  const err = await rejection(start(h, body));
  expect(err).toEqual(error);
  expect(h.audits.map((row) => [row.action, row.payload.refusal])).toEqual([["onboarding.discovery.refuse", refusal]]);
  return h;
}

export async function aBlockedHostIsA400WithARefuseRow(): Promise<void> {
  const blocked = { ...BODY, expected: { host: "postgres", port: 8883 } };
  await refusedWithRow(
    { draft: draft({ rtu: { config: { host: "postgres", port: 8883 } } }) },
    new BadRequestException(DISCOVERY_BLOCKED_HOST),
    "blocked host",
    blocked,
  );
}

export async function aBlockedHostIsNeverEnqueued(): Promise<void> {
  const h = harness({ draft: draft({ rtu: { config: { host: "redis", port: 6379 } } }) });
  await rejection(start(h, { ...BODY, expected: { host: "redis", port: 6379 } }));
  expect({ writes: h.writes, jobs: h.jobs }).toEqual({ writes: [], jobs: [] });
}

export async function aBadPortIsA400WithARefuseRow(): Promise<void> {
  await refusedWithRow(
    { draft: draft({ rtu: { config: { host: "broker.example.com", port: 70_000 } } }) },
    new BadRequestException(DISCOVERY_BAD_PORT),
    "bad port",
  );
}

export async function anUnconfiguredQueueIsA503WithARefuseRow(): Promise<void> {
  await refusedWithRow({ queue: "unconfigured" }, new ServiceUnavailableException(DISCOVERY_NO_WORKER), "no worker");
}

export async function anUnconfiguredQueueStoresNoDiscovery(): Promise<void> {
  const h = harness({ queue: "unconfigured" });
  await rejection(start(h));
  expect(h.writes).toEqual([]);
}

/** Security review M2: the busy check reads the locked row, not the pre-lock read. */
export async function aQueuedDiscoveryOnTheSessionIsA409WithARefuseRow(): Promise<void> {
  await refusedWithRow(
    { draft: draft({ discovery: stored("queued") }) },
    new ConflictException(DISCOVERY_BUSY),
    "busy",
  );
}

/** Security review M3: one queued or running discovery per organization. */
export async function aRunningDiscoveryElsewhereInTheOrganizationIsA409(): Promise<void> {
  await refusedWithRow(
    { elsewhere: [stored("running", { startedAt: new Date(NOW - 10_000).toISOString() })] },
    new ConflictException(DISCOVERY_BUSY),
    "busy",
  );
}

export async function aStaleRunningDiscoveryElsewhereIsNotBusy(): Promise<void> {
  const h = harness({ elsewhere: [stored("running", { startedAt: new Date(NOW - 10 * 60_000).toISOString() })] });
  await start(h);
  expect(h.jobs).toHaveLength(1);
}

export async function aFinishedDiscoveryOnTheSessionIsNotBusy(): Promise<void> {
  const h = harness({ draft: draft({ discovery: stored("done") }) });
  await start(h);
  expect(h.jobs).toHaveLength(1);
}

// ---- H3 ------------------------------------------------------------------

async function targetChanged(expected: { host: string; port: number }): Promise<void> {
  const h = harness();
  const err = await rejection(start(h, { ...BODY, expected }));
  expect(err).toEqual(new ConflictException(DISCOVERY_TARGET_CHANGED));
  expect({ writes: h.writes, jobs: h.jobs, audits: h.audits }).toEqual({ writes: [], jobs: [], audits: [] });
}

export async function aChangedHostIsA409(): Promise<void> {
  await targetChanged({ host: "other.example.com", port: 8883 });
}

export async function aChangedPortIsA409(): Promise<void> {
  await targetChanged({ host: "broker.example.com", port: 1883 });
}

// ---- the enqueue fails after the commit ----------------------------------

export async function aFailedEnqueueIsA503(): Promise<void> {
  const h = harness({ queue: "throws" });
  const err = await rejection(start(h));
  expect(err).toEqual(new ServiceUnavailableException(DISCOVERY_NO_WORKER));
}

export async function aFailedEnqueueMarksTheDiscoveryFailed(): Promise<void> {
  const h = harness({ queue: "throws" });
  await rejection(start(h));
  expect(h.writes.map((w) => [w.status, w.discoveryId])).toEqual([
    ["queued", h.writes[0]?.discoveryId],
    ["failed", h.writes[0]?.discoveryId],
  ]);
}

export async function aFailedEnqueueAuditsANoWorkerRefusal(): Promise<void> {
  const h = harness({ queue: "throws" });
  await rejection(start(h));
  expect(h.audits.map((row) => [row.action, row.payload.refusal])).toEqual([
    ["onboarding.discovery.start", undefined],
    ["onboarding.discovery.refuse", "no worker"],
  ]);
}

/** The broker-side error text (an address) reaches no row. */
export async function aFailedEnqueueStoresNoErrorText(): Promise<void> {
  const h = harness({ queue: "throws" });
  await rejection(start(h));
  expect(JSON.stringify({ writes: h.writes, audits: h.audits })).not.toContain("ECONNREFUSED");
}

// ---- no credential anywhere ----------------------------------------------

export async function noRowOrPayloadCarriesTheCiphertext(): Promise<void> {
  const h = harness();
  await start(h);
  expect(JSON.stringify({ writes: h.writes, audits: h.audits, jobs: h.jobs })).not.toContain(CIPHERTEXT);
}

/** A host typed as `mqtts://user:password@host` is left out of a refuse row (the worker's rule). */
export async function aCredentialShapedHostIsLeftOutOfTheRow(): Promise<void> {
  const host = "mqtts://admin:hunter2@broker.example.com";
  const h = harness({ draft: draft({ rtu: { config: { host, port: 70_000 } } }) });
  await rejection(start(h, { ...BODY, expected: { host, port: 8883 } }));
  expect(h.audits.map((row) => row.payload)).toEqual([
    { rtuCode: "R1", port: 70_000, topicFilter: "Airsprint-1051/Data/#", refusal: "bad port" },
  ]);
}

// ---- the controller ------------------------------------------------------

export async function theRouteHandsTheParsedBodyToTheService(): Promise<void> {
  const calls: unknown[][] = [];
  const discovery = { start: async (...args: unknown[]) => (calls.push(args), { discoveryId: SESSION_ID }) };
  const controller = new OnboardingController({} as never, discovery as never);
  await controller.startDiscovery(SESSION_ID, BODY, JWT);
  expect(calls).toEqual([[JWT, SESSION_ID, startOnboardingDiscoveryBodySchema.safeParse(BODY)]]);
}

export async function theRouteRefusesABadIdBeforeTheService(): Promise<void> {
  const calls: unknown[][] = [];
  const discovery = { start: async (...args: unknown[]) => (calls.push(args), { discoveryId: SESSION_ID }) };
  const controller = new OnboardingController({} as never, discovery as never);
  await expect(controller.startDiscovery("not-a-uuid", BODY, JWT)).rejects.toBeInstanceOf(BadRequestException);
  expect(calls).toEqual([]);
}
