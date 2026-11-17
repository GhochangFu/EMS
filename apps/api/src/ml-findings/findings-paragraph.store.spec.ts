import { expect } from "vitest";

import type { BmsTx } from "../database/tenant-context";
import { attemptsToday, readParagraph, sameUtcDay, startOfUtcDay, writeOutcome } from "./findings-paragraph.store";

/**
 * `E1.9c` (plan T3.4; owner ruling Q3 (a)) — the store's own logic on a
 * recording transaction: which statements `writeOutcome` issues and the
 * `attempts` it inserts, and how the reads shape their rows. What Postgres does
 * with the predicates (row security, the day window, the 14-day delete) is the
 * integration suite's. Assertions live here; `findings-paragraph.store.test.ts`
 * is the vitest entry point (ADR 0014).
 */
type Call = { op: string; values?: Record<string, unknown> };

/** A transaction whose builder chains record each statement and resolve to `rows`. */
function recordingTx(rows: unknown[] = []): { tx: BmsTx; calls: Call[] } {
  const calls: Call[] = [];
  const chain = (op: string): unknown => {
    const call: Call = { op };
    calls.push(call);
    const node: Record<string, unknown> = {};
    for (const step of ["from", "where", "limit"]) node[step] = () => node;
    node.values = (values: Record<string, unknown>) => {
      call.values = values;
      return node;
    };
    node.onConflictDoNothing = () => {
      call.op = `${op}+onConflictDoNothing`;
      return node;
    };
    node.then = (resolve: (v: unknown) => unknown) => resolve(rows);
    return node;
  };
  const tx = {
    select: () => chain("select"),
    delete: () => chain("delete"),
    insert: () => chain("insert"),
  } as unknown as BmsTx;
  return { tx, calls };
}

const ORG = "0f0f0f0f-0000-4000-8000-00000000000b";
const NOW = new Date("2026-11-17T08:40:00.000Z");
const OUTCOME = { status: "failed", paragraph: null, reason: "timeout" } as const;
const base = {
  organizationId: ORG,
  kind: "anomalies" as const,
  factsHash: "a".repeat(64),
  outcome: OUTCOME,
  provider: "openrouter",
  model: "small/open-model",
  now: NOW,
  retainAfter: new Date(NOW.getTime() - 14 * 86_400_000),
};

export function theUtcDayHelpers(): void {
  expect(startOfUtcDay(NOW).toISOString()).toBe("2026-11-17T00:00:00.000Z");
  expect(startOfUtcDay(new Date("2026-11-17T23:59:59.999Z")).toISOString()).toBe("2026-11-17T00:00:00.000Z");
  expect(sameUtcDay(new Date("2026-11-17T00:00:00.000Z"), NOW)).toBe(true);
  expect(sameUtcDay(new Date("2026-11-16T23:59:59.999Z"), NOW)).toBe(false);
}

export async function aFirstWriteDeletesOldRowsAndInsertsOneAttempt(): Promise<void> {
  const { tx, calls } = recordingTx();
  await writeOutcome(tx, { ...base, retryOf: null });
  expect(calls.map((c) => c.op)).toEqual(["delete", "insert+onConflictDoNothing"]);
  expect(calls[1]?.values).toEqual({
    organizationId: ORG,
    kind: "anomalies",
    factsHash: "a".repeat(64),
    status: "failed",
    paragraph: null,
    reason: "timeout",
    provider: "openrouter",
    model: "small/open-model",
    attempts: 1,
  });
}

export async function aRetryDeletesTheFailedRowAndCountsOnTheSameDay(): Promise<void> {
  const sameDay = recordingTx();
  await writeOutcome(sameDay.tx, { ...base, retryOf: { id: "r1", attempts: 3, createdAt: new Date("2026-11-17T00:00:00.000Z") } });
  expect(sameDay.calls.map((c) => c.op)).toEqual(["delete", "delete", "insert+onConflictDoNothing"]);
  expect(sameDay.calls[2]?.values?.attempts).toBe(4);
  const yesterday = recordingTx();
  await writeOutcome(yesterday.tx, { ...base, retryOf: { id: "r1", attempts: 3, createdAt: new Date("2026-11-16T23:59:59.000Z") } });
  expect(yesterday.calls[2]?.values?.attempts, "a new UTC day starts again at 1").toBe(1);
}

export async function theReadsShapeTheirRows(): Promise<void> {
  const createdAt = new Date();
  const row = { id: "r1", status: "ok", paragraph: "[A1] x.", reason: null, attempts: 1, createdAt };
  expect(await readParagraph(recordingTx([row]).tx, ORG, "anomalies", "a".repeat(64))).toEqual(row);
  expect(await readParagraph(recordingTx([]).tx, ORG, "anomalies", "a".repeat(64))).toBeNull();
  expect(await readParagraph(recordingTx([{ ...row, status: "weird" }]).tx, ORG, "anomalies", "a".repeat(64))).toBeNull();
  expect(await attemptsToday(recordingTx([{ total: "57" }]).tx, ORG, NOW)).toBe(57);
  expect(await attemptsToday(recordingTx([{ total: null }]).tx, ORG, NOW)).toBe(0);
}
