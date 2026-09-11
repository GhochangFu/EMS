import type { Logger } from "@nestjs/common";
import { z } from "zod";

import type { QueueConfig, RedisConnectionOptions } from "./queue-config";
import {
  createQueueClient,
  defineQueue,
  enqueue,
  RESERVED_JOB_IDS,
  RETRY_DEFAULTS,
  tenantPayloadSchema,
  upsertSchedule,
  type QueueClient,
  type QueueDeclaration,
  type QueueHandle,
} from "./queue-registry";

/**
 * F4.24 (ADR 0063 decisions 4, 5, 6, 7, 9) — the typed queue registry.
 *
 * Assertions live here; `queue-registry.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). One exported function per row of plan §6's first table,
 * plus the rows the 2026-09-11 review added (M1 — the `jobId` grammar; M2 —
 * the payload schema) and the few that fence the seam four P1 rows will
 * build against (`defineQueue`'s retry merge, the `prefix` override, the
 * error listener actually warning). Errors are matched on `err.name` /
 * `err.reason`, never `instanceof` (F4.108 — a class identity does not
 * survive a second copy of the module).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Captures a rejection. The "expected to reject" sentinel lives **outside**
 * the `try` (Unit 1's lesson): a call that resolves must fail with this
 * message, not with an `err.name` mismatch on a sentinel thrown inside the
 * `try` and caught by its own `catch`.
 */
async function captureRejection(run: () => Promise<unknown>): Promise<unknown> {
  let rejected = false;
  let caught: unknown;
  try {
    await run();
  } catch (err) {
    rejected = true;
    caught = err;
  }
  assert(rejected, "expected the call to reject, and it resolved");
  return caught;
}

function errorName(err: unknown): string | undefined {
  return typeof err === "object" && err !== null
    ? (err as { name?: unknown }).name?.toString()
    : undefined;
}

function errorReason(err: unknown): string | undefined {
  return typeof err === "object" && err !== null
    ? (err as { reason?: unknown }).reason?.toString()
    : undefined;
}

function errorMessage(err: unknown): string {
  return typeof err === "object" && err !== null
    ? String((err as { message?: unknown }).message)
    : String(err);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/** A UUID because `tenantPayloadSchema` requires one; the suffix keeps it recognisable in a message. */
export const ORG_A = "00000000-0000-4000-8000-00000000000a";

export const tenantQ = defineQueue({
  name: "t",
  tenancy: "tenant",
  payload: tenantPayloadSchema.extend({ x: z.number() }),
});

export const fleetQ = defineQueue({
  name: "f",
  tenancy: "fleet",
  payload: z.object({ x: z.number() }),
  retry: { attempts: 5 },
});

const CONFIGURED: QueueConfig = { redis: { host: "cache", port: 6380 } };
const UNCONFIGURED: QueueConfig = { redis: null };

type RecordedAdd = { name: string; data: unknown; opts: unknown };
type RecordedUpsert = { schedulerId: string; repeat: unknown; template: unknown };
type RecordedListener = { event: string; listener: (...args: unknown[]) => void };

type FakeHandle = {
  name: string;
  adds: RecordedAdd[];
  upserts: RecordedUpsert[];
  listeners: RecordedListener[];
  closed: number;
};

type Fixture = {
  client: QueueClient;
  created: { name: string; opts: { connection: RedisConnectionOptions; prefix: string } }[];
  handles: FakeHandle[];
  warns: string[];
};

/** A recording `createQueue`: the five-line fake plan §6 promises. */
function makeFixture(
  config: QueueConfig,
  declarations: readonly QueueDeclaration[] = [tenantQ, fleetQ],
  prefix?: string,
): Fixture {
  const created: Fixture["created"] = [];
  const handles: FakeHandle[] = [];
  const warns: string[] = [];
  const client = createQueueClient(config, declarations, {
    createQueue: (name, opts) => {
      created.push({ name, opts });
      const fake: FakeHandle = { name, adds: [], upserts: [], listeners: [], closed: 0 };
      handles.push(fake);
      const handle = {
        add: async (jobName: string, data: unknown, jobOpts: unknown) => {
          fake.adds.push({ name: jobName, data, opts: jobOpts });
          return undefined as never;
        },
        upsertJobScheduler: async (schedulerId: string, repeat: unknown, template: unknown) => {
          fake.upserts.push({ schedulerId, repeat, template });
          return undefined as never;
        },
        getJobCounts: async () => ({}),
        client: Promise.resolve(undefined as never),
        close: async () => {
          fake.closed += 1;
        },
        on: (event: string, listener: (...args: unknown[]) => void) => {
          fake.listeners.push({ event, listener });
          return handle;
        },
      };
      return handle as unknown as QueueHandle;
    },
    logger: {
      warn: (message: unknown) => {
        warns.push(String(message));
      },
    } as Pick<Logger, "warn">,
    ...(prefix !== undefined ? { prefix } : {}),
  });
  return { client, created, handles, warns };
}

function allAdds(fixture: Fixture): RecordedAdd[] {
  return fixture.handles.flatMap((h) => h.adds);
}

function allUpserts(fixture: Fixture): RecordedUpsert[] {
  return fixture.handles.flatMap((h) => h.upserts);
}

/** The retry-derived BullMQ job options `fleetQ` resolves to (attempts overridden to 5). */
const FLEET_RETRY_OPTS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

// ---------------------------------------------------------------------------
// defineQueue
// ---------------------------------------------------------------------------

export function assertDefineQueueMergesRetryOverDefaults(): void {
  const expected = { ...RETRY_DEFAULTS, attempts: 5 };
  assert(
    JSON.stringify(fleetQ.retry) === JSON.stringify(expected),
    `expected fleetQ.retry to be the defaults with attempts overridden, ${JSON.stringify(expected)}, got ${JSON.stringify(fleetQ.retry)}`,
  );
}

export function assertDefineQueueWithoutRetryCarriesTheDefaults(): void {
  assert(
    JSON.stringify(tenantQ.retry) === JSON.stringify(RETRY_DEFAULTS),
    `expected tenantQ.retry to equal RETRY_DEFAULTS, got ${JSON.stringify(tenantQ.retry)}`,
  );
}

// ---------------------------------------------------------------------------
// createQueueClient
// ---------------------------------------------------------------------------

export function assertCreateQueueCalledOncePerDeclarationWithPrefixAndConnection(): void {
  const { created } = makeFixture(CONFIGURED);
  const names = created.map((c) => c.name);
  assert(
    JSON.stringify(names) === JSON.stringify(["t", "f"]),
    `expected createQueue once per declaration, in order [t, f], got ${JSON.stringify(names)}`,
  );
  for (const call of created) {
    assert(
      call.opts.prefix === "bms",
      `expected prefix "bms" for queue ${call.name}, got ${JSON.stringify(call.opts.prefix)} — BullMQ's default "bull" must not leak`,
    );
    assert(
      JSON.stringify(call.opts.connection) === JSON.stringify(CONFIGURED.redis),
      `expected the parsed connection for queue ${call.name}, got ${JSON.stringify(call.opts.connection)}`,
    );
  }
}

export function assertPrefixOverrideReachesCreateQueue(): void {
  const { created, client } = makeFixture(CONFIGURED, [fleetQ], "bms-test-1");
  assert(
    created.length === 1 && created[0].opts.prefix === "bms-test-1",
    `expected the prefix override to reach createQueue, got ${JSON.stringify(created.map((c) => c.opts.prefix))}`,
  );
  assert(
    client.kind === "configured" && client.prefix === "bms-test-1",
    "expected the configured client to carry the same prefix it built its queues with",
  );
}

export function assertEveryHandleRegistersAnErrorListener(): void {
  const { handles } = makeFixture(CONFIGURED);
  assert(handles.length === 2, `expected two handles, got ${handles.length}`);
  for (const handle of handles) {
    const errorListeners = handle.listeners.filter((l) => l.event === "error");
    assert(
      errorListeners.length === 1,
      `expected exactly one on("error") listener on queue ${handle.name}, got ${errorListeners.length} — an unhandled "error" event kills the process`,
    );
  }
}

export function assertErrorListenerWarnsAndDoesNotThrow(): void {
  const { handles, warns } = makeFixture(CONFIGURED, [fleetQ]);
  const listener = handles[0].listeners.find((l) => l.event === "error")?.listener;
  assert(listener !== undefined, "precondition: an error listener was registered");
  const failure = new Error("connect ECONNREFUSED cache:6380");
  failure.name = "RedisConnectionError";
  listener?.(failure);
  assert(
    warns.length === 1 && warns[0].includes("f") && warns[0].includes("RedisConnectionError"),
    `expected one warn naming the queue and err.name, got ${JSON.stringify(warns)}`,
  );
}

export function assertConfiguredClientCarriesTheConnection(): void {
  const { client } = makeFixture(CONFIGURED);
  assert(
    client.kind === "configured" &&
      JSON.stringify(client.connection) === JSON.stringify(CONFIGURED.redis),
    "expected the configured client to carry the resolved RedisConnectionOptions for the worker host (plan §8)",
  );
}

export function assertUnconfiguredConfigBuildsNoQueue(): void {
  const { client, created } = makeFixture(UNCONFIGURED);
  assert(
    client.kind === "unconfigured",
    `expected kind "unconfigured" for redis: null, got ${JSON.stringify(client.kind)}`,
  );
  assert(
    created.length === 0,
    `expected createQueue never to be called without REDIS_URL (decision 9 forbids a stand-in), got ${created.length} call(s)`,
  );
}

export function assertUnconfiguredConfigWarnsOnce(): void {
  const { warns } = makeFixture(UNCONFIGURED);
  assert(
    warns.length === 1 && warns[0].includes("unconfigured"),
    `expected exactly one warn naming the unconfigured queue, got ${JSON.stringify(warns)}`,
  );
}

// ---------------------------------------------------------------------------
// enqueue — decision 5 and the happy path
// ---------------------------------------------------------------------------

/** Positive control for every refusal row below: the happy path reaches `add` with the resolved options. */
export async function assertEnqueueAddsWithJobIdAndResolvedRetryOptions(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  await enqueue(fixture.client, fleetQ, { x: 1 }, { jobId: "j1" });
  const adds = allAdds(fixture);
  assert(adds.length === 1, `expected exactly one add, got ${adds.length}`);
  const [call] = adds;
  assert(call.name === "f", `expected add on queue "f", got ${JSON.stringify(call.name)}`);
  assert(
    JSON.stringify(call.data) === JSON.stringify({ x: 1 }),
    `expected the payload to reach add unchanged, got ${JSON.stringify(call.data)}`,
  );
  const expectedOpts = { jobId: "j1", ...FLEET_RETRY_OPTS };
  assert(
    JSON.stringify(call.opts) === JSON.stringify(expectedOpts),
    `expected add opts ${JSON.stringify(expectedOpts)}, got ${JSON.stringify(call.opts)}`,
  );
}

export const MISSING_JOB_ID_OPTS: readonly { label: string; opts: { jobId: string } }[] = [
  { label: "an empty string", opts: { jobId: "" } },
  { label: "no jobId at all", opts: {} as never },
];

export async function assertMissingJobIdIsRefusedBeforeRedis(opts: {
  jobId: string;
}): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  const err = await captureRejection(() => enqueue(fixture.client, fleetQ, { x: 1 }, opts));
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "missing_job_id",
    `expected QueuePayloadError(missing_job_id), got ${errorName(err)}(${errorReason(err)}) — decision 5's guard`,
  );
  assert(allAdds(fixture).length === 0, "expected add never to be called after the jobId refusal");
}

// ---------------------------------------------------------------------------
// enqueue — review M1: the jobId grammar
// ---------------------------------------------------------------------------

/**
 * The three the security review reproduced on a real Redis: `meta` collides
 * with the queue's meta hash, `repeat` with the scheduler ZSET, `wait` with
 * the waiting LIST (`WRONGTYPE`).
 */
export const RESERVED_JOB_ID_ROWS = ["meta", "wait", "repeat"] as const;

export async function assertReservedJobIdIsRefusedBeforeRedis(jobId: string): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  const err = await captureRejection(() => enqueue(fixture.client, fleetQ, { x: 1 }, { jobId }));
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_job_id",
    `expected QueuePayloadError(invalid_job_id) for the structural name ${JSON.stringify(jobId)}, got ${errorName(err)}(${errorReason(err)})`,
  );
  assert(
    allAdds(fixture).length === 0,
    `expected add never to be called for jobId ${JSON.stringify(jobId)} — it would overwrite a BullMQ structure`,
  );
}

/** The exported list is what `F3.12` reads; the three reproduced names must be on it. */
export function assertReservedListCarriesTheReproducedThree(): void {
  const missing = RESERVED_JOB_ID_ROWS.filter((id) => !RESERVED_JOB_IDS.includes(id));
  assert(
    missing.length === 0,
    `expected RESERVED_JOB_IDS to carry ${JSON.stringify(RESERVED_JOB_ID_ROWS)}, missing ${JSON.stringify(missing)}`,
  );
}

export async function assertOverlongJobIdIsRefused(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  const err = await captureRejection(() =>
    enqueue(fixture.client, fleetQ, { x: 1 }, { jobId: "a".repeat(201) }),
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_job_id",
    `expected QueuePayloadError(invalid_job_id) for a 201-character id, got ${errorName(err)}(${errorReason(err)})`,
  );
  assert(allAdds(fixture).length === 0, "expected add never to be called for a 201-character id");
}

/** Boundary positive control for the row above: 200 characters is inside the grammar. */
export async function assertTwoHundredCharacterJobIdIsAccepted(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  await enqueue(fixture.client, fleetQ, { x: 1 }, { jobId: "a".repeat(200) });
  assert(allAdds(fixture).length === 1, "expected a 200-character id to reach add");
}

/**
 * Measured 2026-09-11 on BullMQ 5.81.5: `add` with `"cmd-123:v2"` throws
 * `Custom Id cannot contain :` (only a three-segment `a:b:c` passes, a legacy
 * repeatable form). The review's draft named this id as the positive
 * control; it is refused here by name instead, before Redis.
 */
export async function assertColonJobIdIsRefused(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  const err = await captureRejection(() =>
    enqueue(fixture.client, fleetQ, { x: 1 }, { jobId: "cmd-123:v2" }),
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_job_id",
    `expected QueuePayloadError(invalid_job_id) for a colon id, got ${errorName(err)}(${errorReason(err)})`,
  );
  assert(
    errorMessage(err).includes("colon"),
    `expected the message to name the colon, got "${errorMessage(err)}"`,
  );
}

/** Measured the same day: BullMQ throws `Custom Id cannot be integers` for `"123"`. */
export async function assertAllDigitJobIdIsRefused(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  const err = await captureRejection(() => enqueue(fixture.client, fleetQ, { x: 1 }, { jobId: "123" }));
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_job_id",
    `expected QueuePayloadError(invalid_job_id) for an all-digit id, got ${errorName(err)}(${errorReason(err)})`,
  );
}

/** Positive control for the grammar rows: the shape `F3.12` will use, with every permitted class of character. */
export async function assertGrammaticalJobIdIsAccepted(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  await enqueue(fixture.client, fleetQ, { x: 1 }, { jobId: "cmd-123.v2_a" });
  const adds = allAdds(fixture);
  assert(
    adds.length === 1 && (adds[0].opts as { jobId?: unknown }).jobId === "cmd-123.v2_a",
    `expected "cmd-123.v2_a" to reach add as the jobId, got ${JSON.stringify(adds)}`,
  );
}

/** The guard-order proof for M1: a structural id is a programming error, refused with or without Redis. */
export async function assertInvalidJobIdAnswersBeforeAvailability(): Promise<void> {
  const fixture = makeFixture(UNCONFIGURED);
  const err = await captureRejection(() => enqueue(fixture.client, fleetQ, { x: 1 }, { jobId: "meta" }));
  assert(
    errorName(err) !== "QueueUnavailableError",
    "guard order inverted: an unconfigured client answered QueueUnavailableError for a structural jobId",
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_job_id",
    `expected QueuePayloadError(invalid_job_id) on an unconfigured client, got ${errorName(err)}(${errorReason(err)})`,
  );
}

// ---------------------------------------------------------------------------
// enqueue — decision 6 and review M2: the payload
// ---------------------------------------------------------------------------

export async function assertTenantPayloadWithoutOrganizationIdIsRefused(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  const err = await captureRejection(() =>
    enqueue(fixture.client, tenantQ, { x: 1 } as never, { jobId: "j1" }),
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "missing_organization_id",
    `expected QueuePayloadError(missing_organization_id), got ${errorName(err)}(${errorReason(err)}) — decision 6's guard`,
  );
  assert(allAdds(fixture).length === 0, "expected add never to be called after the tenancy refusal");
}

/** Positive control for the row above: the guard must not over-refuse. */
export async function assertTenantPayloadWithOrganizationIdIsAdded(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  await enqueue(fixture.client, tenantQ, { organizationId: ORG_A, x: 1 }, { jobId: "j1" });
  const adds = allAdds(fixture);
  assert(
    adds.length === 1 && adds[0].name === "t",
    `expected one add on queue "t" for a tenant payload carrying organizationId, got ${JSON.stringify(adds)}`,
  );
}

/**
 * Which reason fires when: an absent or empty `organizationId` is
 * `missing_organization_id` (the row above); a present, non-empty one that is
 * not a UUID is the schema's `invalid_payload` — and the negative names the
 * neighbour that must **not** have answered.
 */
export async function assertTenantNonUuidOrganizationIdIsInvalidPayloadNotMissing(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  const err = await captureRejection(() =>
    enqueue(fixture.client, tenantQ, { organizationId: "org-a", x: 1 }, { jobId: "j1" }),
  );
  assert(
    errorReason(err) !== "missing_organization_id",
    "a present, non-empty organizationId answered missing_organization_id — the tenancy guard must only refuse absence",
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_payload",
    `expected QueuePayloadError(invalid_payload) for a non-UUID organizationId, got ${errorName(err)}(${errorReason(err)})`,
  );
  assert(
    errorMessage(err).includes("organizationId") && !errorMessage(err).includes("org-a"),
    `expected the message to name the field path and not the value, got "${errorMessage(err)}"`,
  );
  assert(allAdds(fixture).length === 0, "expected add never to be called after the schema refusal");
}

export async function assertPayloadFailingItsSchemaIsRefusedAtEnqueue(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  const err = await captureRejection(() =>
    enqueue(fixture.client, fleetQ, { x: "one" } as never, { jobId: "j1" }),
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_payload",
    `expected QueuePayloadError(invalid_payload) for x: "one" against z.number(), got ${errorName(err)}(${errorReason(err)})`,
  );
  assert(
    errorMessage(err).includes("x") && !errorMessage(err).includes("one"),
    `expected the message to name the field path "x" and not the value "one", got "${errorMessage(err)}"`,
  );
  assert(allAdds(fixture).length === 0, "expected add never to be called after the schema refusal");
}

/** What reaches `add` is the schema's output: an undeclared key is stripped, not stored. */
export async function assertEnqueueAddsTheSchemaOutputNotTheRawObject(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  await enqueue(fixture.client, fleetQ, { x: 1, smuggled: "yes" } as never, { jobId: "j1" });
  const adds = allAdds(fixture);
  assert(
    adds.length === 1 && JSON.stringify(adds[0].data) === JSON.stringify({ x: 1 }),
    `expected add to receive the parsed output { x: 1 } with the undeclared key stripped, got ${JSON.stringify(adds.map((a) => a.data))}`,
  );
}

/** The guard-order proof for M2: a payload the schema refuses is a programming error, refused with or without Redis. */
export async function assertInvalidPayloadAnswersBeforeAvailability(): Promise<void> {
  const fixture = makeFixture(UNCONFIGURED);
  const err = await captureRejection(() =>
    enqueue(fixture.client, fleetQ, { x: "one" } as never, { jobId: "j1" }),
  );
  assert(
    errorName(err) !== "QueueUnavailableError",
    "guard order inverted: an unconfigured client answered QueueUnavailableError for a payload its schema refuses",
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_payload",
    `expected QueuePayloadError(invalid_payload) on an unconfigured client, got ${errorName(err)}(${errorReason(err)})`,
  );
}

export async function assertFleetPayloadNeedsNoOrganizationId(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  await enqueue(fixture.client, fleetQ, { x: 1 }, { jobId: "j1" });
  assert(
    allAdds(fixture).length === 1,
    "expected a fleet payload without organizationId to be added — the tenancy check must read decl.tenancy",
  );
}

// ---------------------------------------------------------------------------
// enqueue — decision 9 and the registry
// ---------------------------------------------------------------------------

export async function assertUnconfiguredClientRejectsWithQueueUnavailableError(): Promise<void> {
  const fixture = makeFixture(UNCONFIGURED);
  const err = await captureRejection(() =>
    enqueue(fixture.client, fleetQ, { x: 1 }, { jobId: "j1" }),
  );
  assert(
    errorName(err) === "QueueUnavailableError",
    `expected QueueUnavailableError from an unconfigured client, got ${errorName(err)} — decision 9's rejection`,
  );
}

/**
 * The guard-order proof. A programming error is refused whether or not Redis
 * exists, so on an unconfigured client a missing jobId must answer as
 * `QueuePayloadError` — and the negative names the neighbour that must
 * **not** have answered.
 */
export async function assertPayloadGuardAnswersBeforeAvailability(): Promise<void> {
  const fixture = makeFixture(UNCONFIGURED);
  const err = await captureRejection(() =>
    enqueue(fixture.client, fleetQ, { x: 1 }, { jobId: "" }),
  );
  assert(
    errorName(err) !== "QueueUnavailableError",
    "guard order inverted: an unconfigured client answered QueueUnavailableError for a missing jobId; the payload guards must run before the availability check",
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "missing_job_id",
    `expected QueuePayloadError(missing_job_id) on an unconfigured client, got ${errorName(err)}(${errorReason(err)})`,
  );
}

export async function assertUndeclaredQueueIsRefused(): Promise<void> {
  const fixture = makeFixture(CONFIGURED, [fleetQ]);
  const err = await captureRejection(() =>
    enqueue(fixture.client, tenantQ, { organizationId: ORG_A, x: 1 }, { jobId: "j1" }),
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "unknown_queue",
    `expected QueuePayloadError(unknown_queue) for a declaration the client never built, got ${errorName(err)}(${errorReason(err)})`,
  );
  assert(allAdds(fixture).length === 0, "expected add never to be called for an undeclared queue");
}

// ---------------------------------------------------------------------------
// upsertSchedule
// ---------------------------------------------------------------------------

export async function assertUpsertScheduleCallsUpsertJobSchedulerWithTemplate(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  await upsertSchedule(fixture.client, fleetQ, { schedulerId: "s", everyMs: 60_000 }, { x: 1 });
  const upserts = allUpserts(fixture);
  assert(upserts.length === 1, `expected exactly one upsertJobScheduler call, got ${upserts.length}`);
  const [call] = upserts;
  const expected = {
    schedulerId: "s",
    repeat: { every: 60000 },
    template: { name: "f", data: { x: 1 }, opts: FLEET_RETRY_OPTS },
  };
  assert(
    JSON.stringify(call) === JSON.stringify(expected),
    `expected upsertJobScheduler ${JSON.stringify(expected)}, got ${JSON.stringify(call)}`,
  );
}

export async function assertUpsertScheduleAppliesTenancyGuard(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  const err = await captureRejection(() =>
    upsertSchedule(fixture.client, tenantQ, { schedulerId: "s", everyMs: 60_000 }, {} as never),
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "missing_organization_id",
    `expected the scheduler path to refuse a tenant payload without organizationId, got ${errorName(err)}(${errorReason(err)})`,
  );
  assert(
    allUpserts(fixture).length === 0,
    "expected upsertJobScheduler never to be called after the tenancy refusal",
  );
}

export async function assertUpsertScheduleRefusesAPayloadFailingItsSchema(): Promise<void> {
  const fixture = makeFixture(CONFIGURED);
  const err = await captureRejection(() =>
    upsertSchedule(fixture.client, fleetQ, { schedulerId: "s", everyMs: 60_000 }, { x: "one" } as never),
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_payload",
    `expected the scheduler path to refuse a payload its schema rejects, got ${errorName(err)}(${errorReason(err)})`,
  );
  assert(
    allUpserts(fixture).length === 0,
    "expected upsertJobScheduler never to be called after the schema refusal",
  );
}

export async function assertUpsertScheduleOnUnconfiguredClientRejects(): Promise<void> {
  const fixture = makeFixture(UNCONFIGURED);
  const err = await captureRejection(() =>
    upsertSchedule(fixture.client, fleetQ, { schedulerId: "s", everyMs: 60_000 }, { x: 1 }),
  );
  assert(
    errorName(err) === "QueueUnavailableError",
    `expected QueueUnavailableError from upsertSchedule on an unconfigured client, got ${errorName(err)}`,
  );
}

// ---------------------------------------------------------------------------
// close
// ---------------------------------------------------------------------------

export async function assertCloseClosesEveryHandle(): Promise<void> {
  const { client, handles } = makeFixture(CONFIGURED);
  assert(client.kind === "configured", "precondition: a configured client");
  if (client.kind === "configured") {
    await client.close();
  }
  const closedCounts = handles.map((h) => h.closed);
  assert(
    JSON.stringify(closedCounts) === JSON.stringify([1, 1]),
    `expected close() once on every handle, got ${JSON.stringify(closedCounts)} — a handle leaked`,
  );
}
