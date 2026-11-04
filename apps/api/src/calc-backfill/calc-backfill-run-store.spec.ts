import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import { BACKFILL_NOT_STARTED, BACKFILL_STALE } from "@bms/shared";

import { BACKFILL_STALE_MINUTES, CalcBackfillRunStore } from "./calc-backfill-run-store";

/**
 * `F4.311` PR 6b review — `latestForPoints` projects an orphaned run as
 * failed, read-side, so the page's poll stops on it. No database: the fleet
 * read is a fake chain that answers the rows given; the store never writes
 * on this path (the tenant handle is a stub that throws if touched).
 */

const NOW_MS = Date.parse("2026-11-04T12:00:00.000Z");
const MINUTE_MS = 60_000;
const POINT = "ap-1";

type Row = {
  id: string;
  assetPointId: string;
  status: string;
  fromAt: Date;
  toAt: Date;
  doneThrough: Date | null;
  writtenRows: number;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  updatedAt: Date;
};

function row(patch: Partial<Row> = {}): Row {
  return {
    id: "run-1",
    assetPointId: POINT,
    status: "running",
    fromAt: new Date("2026-10-04T00:00:00.000Z"),
    toAt: new Date("2026-11-04T00:00:00.000Z"),
    doneThrough: new Date("2026-10-10T00:00:00.000Z"),
    writtenRows: 42,
    error: null,
    createdAt: new Date(NOW_MS - 2 * MINUTE_MS),
    finishedAt: null,
    updatedAt: new Date(NOW_MS - MINUTE_MS),
    ...patch,
  };
}

function storeOver(rows: Row[]): CalcBackfillRunStore {
  const chain = {
    selectDistinctOn: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: async () => rows,
  };
  const untouched = new Proxy({}, { get: () => { throw new Error("the read path must not write"); } });
  return new CalcBackfillRunStore(untouched as BmsDb, chain as unknown as BmsDb);
}

async function latest(r: Row) {
  const runs = await storeOver([r]).latestForPoints([POINT], NOW_MS);
  return runs.get(POINT);
}

const beyondBound = (minutes = 1) => new Date(NOW_MS - (BACKFILL_STALE_MINUTES + minutes) * MINUTE_MS);

export async function aRunningRunWithAFreshHeartbeatStaysRunning(): Promise<void> {
  expect(await latest(row())).toMatchObject({ status: "running", error: null, finishedAt: null });
}

export async function aRunningRunPastTheStaleBoundReadsAsFailedStale(): Promise<void> {
  expect(await latest(row({ updatedAt: beyondBound() }))).toMatchObject({ status: "failed", error: BACKFILL_STALE });
}

export async function aStaleRunKeepsItsProgress(): Promise<void> {
  expect(await latest(row({ updatedAt: beyondBound() }))).toMatchObject({
    doneThrough: "2026-10-10T00:00:00.000Z",
    writtenRows: 42,
  });
}

export async function aRecentQueuedRunStaysQueued(): Promise<void> {
  expect(await latest(row({ status: "queued", doneThrough: null, writtenRows: 0 }))).toMatchObject({
    status: "queued",
    error: null,
  });
}

export async function aQueuedRunPastTheBoundReadsAsFailedNotStarted(): Promise<void> {
  expect(
    await latest(row({ status: "queued", doneThrough: null, writtenRows: 0, createdAt: beyondBound(), updatedAt: beyondBound() })),
  ).toMatchObject({ status: "failed", error: BACKFILL_NOT_STARTED });
}

export async function aProjectedFailureCarriesAFinishTime(): Promise<void> {
  const projected = await latest(row({ updatedAt: beyondBound() }));
  expect(projected?.finishedAt).not.toBeNull();
}

export async function aDoneRunIsNeverProjected(): Promise<void> {
  const finishedAt = beyondBound(60);
  expect(
    await latest(row({ status: "done", error: null, updatedAt: finishedAt, createdAt: finishedAt, finishedAt })),
  ).toMatchObject({ status: "done", error: null });
}
