import type { Logger } from "@nestjs/common";

import type { QueueConfig } from "./queue-config";
import { createQueueClient, type QueueClient, type QueueHandle, upsertSchedule } from "./queue-registry";
import { ALL_QUEUES } from "./queues";
import { reportsDispatchQueue } from "./reports-dispatch";

/**
 * F3.5b (ADR 0071 decision 8) — the `reports-dispatch` declaration.
 *
 * Assertions live here; `reports-dispatch.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014).
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

const CONFIGURED: QueueConfig = { redis: { host: "cache", port: 6380 } };

type RecordedUpsert = { schedulerId: string; repeat: unknown; template: unknown };

function makeFixture(): { client: QueueClient; upserts: RecordedUpsert[] } {
  const upserts: RecordedUpsert[] = [];
  const client = createQueueClient(CONFIGURED, ALL_QUEUES, {
    createQueue: () => {
      const handle = {
        add: async () => undefined as never,
        upsertJobScheduler: async (schedulerId: string, repeat: unknown, template: unknown) => {
          upserts.push({ schedulerId, repeat, template });
          return undefined as never;
        },
        getJobCounts: async () => ({}),
        client: Promise.resolve(undefined as never),
        close: async () => undefined,
        on: () => handle,
      };
      return handle as unknown as QueueHandle;
    },
    logger: { warn: () => undefined } as Pick<Logger, "warn">,
  });
  return { client, upserts };
}

export function assertReportsDispatchQueueIsFleet(): void {
  assert(
    reportsDispatchQueue.tenancy === "fleet",
    `expected tenancy "fleet", got "${reportsDispatchQueue.tenancy}" — the tick reads across organizations`,
  );
}

export function assertReportsDispatchQueueIsNamedReportsDispatch(): void {
  assert(
    reportsDispatchQueue.name === "reports-dispatch",
    `expected name "reports-dispatch", got "${reportsDispatchQueue.name}"`,
  );
}

export function assertReportsDispatchQueuePayloadIsAnEmptyStrictObject(): void {
  const parsed = reportsDispatchQueue.payload.safeParse({});
  assert(parsed.success, `expected {} to parse against the reports-dispatch payload schema`);
}

/** A smuggled field is refused — at the producer, `upsertSchedule`'s parse. */
export async function assertASmuggledFieldIsRefusedAtUpsertSchedule(): Promise<void> {
  const fixture = makeFixture();
  const err = await captureRejection(() =>
    upsertSchedule(
      fixture.client,
      reportsDispatchQueue,
      { schedulerId: "reports-dispatch", everyMs: 60_000 },
      { extra: "x" } as never,
    ),
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_payload",
    `expected QueuePayloadError(invalid_payload) for a smuggled key, got ${errorName(err)}(${errorReason(err)})`,
  );
  assert(fixture.upserts.length === 0, "expected upsertJobScheduler never to be called after the refusal");
}
