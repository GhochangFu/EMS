import {
  HEARTBEAT_EVERY_MS,
  HEARTBEAT_STALE_TICKS,
  heartbeatIsStale,
  heartbeatKey,
  heartbeatProcessor,
  heartbeatQueue,
} from "./heartbeat";
import { RETRY_DEFAULTS } from "./queue-registry";
import { ALL_QUEUES } from "./queues";

/**
 * F4.24 (ADR 0063 decision 10) — the heartbeat queue and its staleness rule.
 *
 * Assertions live here; `heartbeat.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). One exported function per row of plan §7's first table,
 * one claim each. The boundary pair is built at millisecond precision —
 * `new Date(nowMs - 179_999).toISOString()` round-trips through `Date.parse`
 * exactly, and a second-precision fixture would stop discriminating 179_999
 * from 180_001.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A fixed instant, far from the wall clock, so a handler that reads `Date.now()` is caught. */
const NOW_MS = Date.UTC(2026, 8, 11, 12, 0, 0, 0);
const THREE_TICKS_MS = 180_000;

function isoAgo(ms: number): string {
  return new Date(NOW_MS - ms).toISOString();
}

export function assertStaleBoundIsThreeTicksOfSixtySeconds(): void {
  assert(
    HEARTBEAT_STALE_TICKS * HEARTBEAT_EVERY_MS === THREE_TICKS_MS,
    `expected 3 × 60 000 ms = ${THREE_TICKS_MS}, got ${HEARTBEAT_STALE_TICKS * HEARTBEAT_EVERY_MS}`,
  );
}

export function assertNullTickIsStale(): void {
  assert(
    heartbeatIsStale(null, NOW_MS) === true,
    "a null tick must read as stale (plan §15 ruling 5 — a queue with no consumer)",
  );
}

export function assertUnparseableTickIsStale(): void {
  assert(
    heartbeatIsStale("garbage", NOW_MS) === true,
    "an unparseable tick must read as stale — NaN makes every comparison false, so the guard must fail closed",
  );
}

export function assertTickJustInsideThreeTicksIsFresh(): void {
  assert(
    heartbeatIsStale(isoAgo(THREE_TICKS_MS - 1), NOW_MS) === false,
    "a tick 179 999 ms old is inside three ticks and must read as fresh",
  );
}

export function assertTickJustBeyondThreeTicksIsStale(): void {
  assert(
    heartbeatIsStale(isoAgo(THREE_TICKS_MS + 1), NOW_MS) === true,
    "a tick 180 001 ms old is beyond three ticks and must read as stale",
  );
}

export async function assertProcessorWritesTheInjectedClockAsIso(): Promise<void> {
  const writes: string[] = [];
  const handler = heartbeatProcessor({
    writeTick: async (iso) => {
      writes.push(iso);
    },
    now: () => NOW_MS,
  });

  await handler({}, { db: undefined as never });

  const expected = new Date(NOW_MS).toISOString();
  assert(
    writes.length === 1 && writes[0] === expected,
    `expected exactly one write of ${expected}, got ${JSON.stringify(writes)} — the tick must come from the injected clock, not Date.now()`,
  );
}

export function assertKeyStaysInsideThePrefixNamespace(): void {
  const key = heartbeatKey("bms");
  assert(
    key === "bms:heartbeat:last",
    `expected "bms:heartbeat:last", got "${key}" — the tick key must live under the queue prefix`,
  );
}

export function assertHeartbeatQueueIsFleet(): void {
  assert(
    heartbeatQueue.tenancy === "fleet",
    `expected tenancy "fleet", got "${heartbeatQueue.tenancy}" — the heartbeat has no organization`,
  );
}

export function assertHeartbeatQueueKeepsTheRetryDefaults(): void {
  assert(
    JSON.stringify(heartbeatQueue.retry) === JSON.stringify(RETRY_DEFAULTS),
    `expected retry ${JSON.stringify(RETRY_DEFAULTS)}, got ${JSON.stringify(heartbeatQueue.retry)} — a silent override of decision 7's defaults`,
  );
}

export function assertHeartbeatQueueIsRegistered(): void {
  assert(
    (ALL_QUEUES as readonly unknown[]).includes(heartbeatQueue),
    "ALL_QUEUES must list heartbeatQueue — QueueModule builds its client from that list and nothing else",
  );
}
