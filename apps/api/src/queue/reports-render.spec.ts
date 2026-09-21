import type { Logger } from "@nestjs/common";

import type { QueueConfig } from "./queue-config";
import {
  createQueueClient,
  enqueue,
  JOB_ID_PATTERN,
  type QueueClient,
  type QueueHandle,
} from "./queue-registry";
import { ALL_QUEUES } from "./queues";
import { renderJobId, reportsRenderQueue } from "./reports-render";

/**
 * F3.5b (ADR 0071 decision 8, R-1) — the `reports-render` declaration and
 * `renderJobId`.
 *
 * Assertions live here; `reports-render.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). The fixture is `queue-registry.spec.ts`'s five-line
 * recording `createQueue` fake, narrowed to this one queue.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

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

const ORG = "00000000-0000-4000-8000-00000000000a";
const SCHEDULE = "00000000-0000-4000-8000-00000000000b";

const VALID_PAYLOAD = {
  organizationId: ORG,
  scheduleId: SCHEDULE,
  periodStart: "2026-09-01",
  periodEnd: "2026-09-07",
};

const CONFIGURED: QueueConfig = { redis: { host: "cache", port: 6380 } };

type RecordedAdd = { name: string; data: unknown; opts: unknown };

function makeFixture(): { client: QueueClient; adds: RecordedAdd[] } {
  const adds: RecordedAdd[] = [];
  const client = createQueueClient(CONFIGURED, ALL_QUEUES, {
    createQueue: () => {
      const handle = {
        add: async (jobName: string, data: unknown, jobOpts: unknown) => {
          adds.push({ name: jobName, data, opts: jobOpts });
          return undefined as never;
        },
        upsertJobScheduler: async () => undefined as never,
        getJobCounts: async () => ({}),
        client: Promise.resolve(undefined as never),
        close: async () => undefined,
        on: () => handle,
      };
      return handle as unknown as QueueHandle;
    },
    logger: { warn: () => undefined } as Pick<Logger, "warn">,
  });
  return { client, adds };
}

// ---------------------------------------------------------------------------
// declaration
// ---------------------------------------------------------------------------

export function assertReportsRenderQueueIsTenant(): void {
  assert(
    reportsRenderQueue.tenancy === "tenant",
    `expected tenancy "tenant", got "${reportsRenderQueue.tenancy}" — a render job belongs to one organization`,
  );
}

export function assertReportsRenderQueueIsNamedReportsRender(): void {
  assert(
    reportsRenderQueue.name === "reports-render",
    `expected name "reports-render", got "${reportsRenderQueue.name}"`,
  );
}

// ---------------------------------------------------------------------------
// renderJobId (R-1)
// ---------------------------------------------------------------------------

export function assertRenderJobIdMatchesTheJobIdPattern(): void {
  const jobId = renderJobId(SCHEDULE, "2026-09-07");
  assert(
    JOB_ID_PATTERN.test(jobId),
    `expected ${JSON.stringify(jobId)} to match JOB_ID_PATTERN (no colon)`,
  );
  assert(
    !jobId.includes(":"),
    `expected renderJobId to carry no colon (assertJobId refuses it) — got ${JSON.stringify(jobId)}`,
  );
}

export function assertRenderJobIdIsScheduleUnderscorePeriodEnd(): void {
  const jobId = renderJobId(SCHEDULE, "2026-09-07");
  assert(
    jobId === `${SCHEDULE}_2026-09-07`,
    `expected "${SCHEDULE}_2026-09-07", got ${JSON.stringify(jobId)}`,
  );
}

/** Positive control: `renderJobId`'s output reaches `enqueue`'s `add` with that exact id. */
export async function assertEnqueueReachesAddWithTheRenderJobId(): Promise<void> {
  const fixture = makeFixture();
  const jobId = renderJobId(SCHEDULE, VALID_PAYLOAD.periodEnd);
  await enqueue(fixture.client, reportsRenderQueue, VALID_PAYLOAD, { jobId });
  assert(fixture.adds.length === 1, `expected exactly one add, got ${fixture.adds.length}`);
  assert(
    fixture.adds[0]?.opts !== undefined &&
      (fixture.adds[0].opts as { jobId?: string }).jobId === jobId,
    `expected add's jobId to equal ${JSON.stringify(jobId)}, got ${JSON.stringify(fixture.adds[0]?.opts)}`,
  );
}

/** Mutation target: a colon in the id must be refused by `enqueue`, before `add` is ever called. */
export async function assertAColonJobIdIsRefusedAtEnqueue(): Promise<void> {
  const fixture = makeFixture();
  const err = await captureRejection(() =>
    enqueue(fixture.client, reportsRenderQueue, VALID_PAYLOAD, { jobId: `${SCHEDULE}:2026-09-07` }),
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_job_id",
    `expected QueuePayloadError(invalid_job_id) for a colon id, got ${errorName(err)}(${errorReason(err)})`,
  );
  assert(fixture.adds.length === 0, "expected add never to be called for a colon jobId");
}

// ---------------------------------------------------------------------------
// payload
// ---------------------------------------------------------------------------

export async function assertValidPayloadReachesAdd(): Promise<void> {
  const fixture = makeFixture();
  await enqueue(fixture.client, reportsRenderQueue, VALID_PAYLOAD, {
    jobId: renderJobId(SCHEDULE, VALID_PAYLOAD.periodEnd),
  });
  assert(fixture.adds.length === 1, `expected exactly one add, got ${fixture.adds.length}`);
}

export async function assertACalendarInvalidDateIsRefused(): Promise<void> {
  const fixture = makeFixture();
  const err = await captureRejection(() =>
    enqueue(
      fixture.client,
      reportsRenderQueue,
      { ...VALID_PAYLOAD, periodStart: "2026-02-30" },
      { jobId: renderJobId(SCHEDULE, VALID_PAYLOAD.periodEnd) },
    ),
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_payload",
    `expected QueuePayloadError(invalid_payload) for 2026-02-30, got ${errorName(err)}(${errorReason(err)})`,
  );
}

export async function assertPeriodEndBeforePeriodStartIsRefused(): Promise<void> {
  const fixture = makeFixture();
  const err = await captureRejection(() =>
    enqueue(
      fixture.client,
      reportsRenderQueue,
      { ...VALID_PAYLOAD, periodStart: "2026-09-07", periodEnd: "2026-09-01" },
      { jobId: renderJobId(SCHEDULE, "2026-09-01") },
    ),
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_payload",
    `expected QueuePayloadError(invalid_payload) for periodEnd before periodStart, got ${errorName(err)}(${errorReason(err)})`,
  );
}

export async function assertMissingOrganizationIdIsRefused(): Promise<void> {
  const fixture = makeFixture();
  const { organizationId: _dropped, ...withoutOrg } = VALID_PAYLOAD;
  const err = await captureRejection(() =>
    enqueue(fixture.client, reportsRenderQueue, withoutOrg as never, {
      jobId: renderJobId(SCHEDULE, VALID_PAYLOAD.periodEnd),
    }),
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "missing_organization_id",
    `expected QueuePayloadError(missing_organization_id), got ${errorName(err)}(${errorReason(err)})`,
  );
}

export async function assertAnExtraKeyIsRefused(): Promise<void> {
  const fixture = makeFixture();
  const err = await captureRejection(() =>
    enqueue(fixture.client, reportsRenderQueue, { ...VALID_PAYLOAD, extra: "x" } as never, {
      jobId: renderJobId(SCHEDULE, VALID_PAYLOAD.periodEnd),
    }),
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_payload",
    `expected QueuePayloadError(invalid_payload) for a smuggled key, got ${errorName(err)}(${errorReason(err)})`,
  );
}
