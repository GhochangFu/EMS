import type pg from "pg";
import { expect, vi } from "vitest";

import { inscribedWindowIsEmpty, refreshAggregatesFrom } from "./refresh-aggregates";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

/** The CI signature (M4): a run at 03:01:41Z the day `_1h` opened its chunk. */
export function assertTheCiInstantIsEmpty(): void {
  const from = Date.parse("2026-09-04T00:00:00.000Z");
  const now = Date.parse("2026-09-04T03:01:41.000Z");
  expect(inscribedWindowIsEmpty(from, now, DAY_MS)).toBe(true);
}

/** A day plus one minute covers a full day-bucket past `from`. */
export function assertADayAndOneMinuteIsNotEmpty(): void {
  const from = Date.parse("2026-09-04T00:00:00.000Z");
  const now = from + DAY_MS + 60_000;
  expect(inscribedWindowIsEmpty(from, now, DAY_MS)).toBe(false);
}

/**
 * `from` sits 30 minutes into its day, `now` is 24h10m later — a plain
 * `now - from < w` sees a 24h10m span against a 24h width and calls it
 * non-empty (`false`). The inscribed window is what Timescale actually
 * checks: `ceil(from, w)` rounds `from` up to the NEXT day boundary, and
 * `floor(now, w)` rounds `now` down to the day boundary it just crossed —
 * the same instant. `floor(now) <= ceil(from)` is true, so the window holds
 * no complete bucket even though it spans more than one bucket-width.
 */
export function assertAMisalignedWindowCanBeEmptyEvenWhenWiderThanABucket(): void {
  const from = Date.parse("2026-09-04T00:30:00.000Z");
  const now = from + DAY_MS + 10 * 60_000;
  expect(inscribedWindowIsEmpty(from, now, DAY_MS)).toBe(true);
}

/** A 1-hour-level window that has not yet reached the hour boundary. */
export function assertAnHourLevelWindowShortOfTheBoundaryIsEmpty(): void {
  const from = Date.parse("2026-09-04T00:00:00.000Z");
  const now = Date.parse("2026-09-04T00:59:00.000Z");
  expect(inscribedWindowIsEmpty(from, now, HOUR_MS)).toBe(true);
}

/** The same 1-hour-level window at the boundary holds one complete bucket. */
export function assertAnHourLevelWindowAtTheBoundaryIsNotEmpty(): void {
  const from = Date.parse("2026-09-04T00:00:00.000Z");
  const now = Date.parse("2026-09-04T01:00:00.000Z");
  expect(inscribedWindowIsEmpty(from, now, HOUR_MS)).toBe(false);
}

/**
 * `F4.166` — the calls {@link refreshAggregatesFrom} makes, recorded by a fake
 * client. `withRollupRole` treats an object without `connect`/`idleCount` as a
 * caller-owned `pg.Client`, so the fake sees `SET ROLE`, each `CALL`, then
 * `RESET ROLE`. Only the `CALL`s are returned: `[view, from ISO, to ISO]`.
 */
async function recordRefreshCalls(nowIso: string, fromIso: string, toIso: string): Promise<string[][]> {
  const calls: string[][] = [];
  const fake = {
    query: async (text: string, params?: unknown[]) => {
      const view = /refresh_continuous_aggregate\('([^']+)'/.exec(text)?.[1];
      if (view && params) {
        calls.push([view, ...(params as Date[]).map((d) => d.toISOString())]);
      }
      return { rows: [] };
    },
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Date.parse(nowIso));
    await refreshAggregatesFrom(fake as unknown as pg.Client, new Date(fromIso), new Date(toIso));
  } finally {
    vi.useRealTimers();
  }
  return calls;
}

/** The instant every `F4.166` case below runs at: 30 s into a minute. */
const F4_166_NOW = "2026-09-27T12:00:30.000Z";

/**
 * The CI input: `calc-write`'s second value sits 60 s ahead of the clock.
 * At `_1m` the widened window is `[11:59:30, 12:00:30]`, which inscribes to
 * `[12:00, 12:00)` — empty, the `22023` Timescale raised on every full CI run.
 * That level is skipped. The three coarser windows each hold a complete
 * bucket, so each is still refreshed, over the exact widened bounds.
 */
export async function assertAFutureRowSkipsOnlyTheEmptyMinuteLevel(): Promise<void> {
  const row = "2026-09-27T12:01:30.000Z";
  expect(await recordRefreshCalls(F4_166_NOW, row, row)).toEqual([
    ["telemetry.point_values_5m", "2026-09-27T11:51:30.000Z", F4_166_NOW],
    ["telemetry.point_values_1h", "2026-09-27T10:01:30.000Z", F4_166_NOW],
    ["telemetry.point_values_1d", "2026-09-25T12:01:30.000Z", F4_166_NOW],
  ]);
}

/**
 * A row an hour ahead: the `_1m` and `_5m` windows are inverted (`from` after
 * the capped `to`) and `_1h` inscribes to `[12:00, 12:00)`. Only `_1d` holds
 * a complete bucket. The skip is per level — a `break` on the first empty
 * level would refresh nothing here.
 */
export async function assertAFarFutureRowStillRefreshesTheDayLevel(): Promise<void> {
  const row = "2026-09-27T13:00:30.000Z";
  expect(await recordRefreshCalls(F4_166_NOW, row, row)).toEqual([
    ["telemetry.point_values_1d", "2026-09-25T13:00:30.000Z", F4_166_NOW],
  ]);
}

/**
 * The control: a row an hour in the past widens to at least two bucket widths
 * at every level — at least one complete bucket — so the guard never fires
 * and all four levels are refreshed.
 * `to` is capped at `now` only where `to + margin` passes it (`_1h`, `_1d`).
 */
export async function assertAPastRowRefreshesEveryLevel(): Promise<void> {
  const row = "2026-09-27T11:00:30.000Z";
  expect(await recordRefreshCalls(F4_166_NOW, row, row)).toEqual([
    ["telemetry.point_values_1m", "2026-09-27T10:58:30.000Z", "2026-09-27T11:02:30.000Z"],
    ["telemetry.point_values_5m", "2026-09-27T10:50:30.000Z", "2026-09-27T11:10:30.000Z"],
    ["telemetry.point_values_1h", "2026-09-27T09:00:30.000Z", F4_166_NOW],
    ["telemetry.point_values_1d", "2026-09-25T11:00:30.000Z", F4_166_NOW],
  ]);
}

/** Every query an invalid-date call sends, `SET ROLE` included. */
async function queriesForInvalidFrom(): Promise<{ queries: string[]; error: unknown }> {
  const queries: string[] = [];
  const fake = {
    query: async (text: string) => {
      queries.push(text);
      return { rows: [] };
    },
  };
  let error: unknown;
  try {
    await refreshAggregatesFrom(fake as unknown as pg.Client, new Date(Number.NaN), new Date());
  } catch (err) {
    error = err;
  }
  return { queries, error };
}

/**
 * `NaN` makes every comparison in `inscribedWindowIsEmpty` false, so the guard
 * alone reports "not empty". An invalid `Date` must throw instead.
 */
export async function assertAnInvalidDateThrows(): Promise<void> {
  const { error } = await queriesForInvalidFrom();
  expect((error as Error | undefined)?.message).toBe(
    "refreshAggregatesFrom: `from` and `to` must be valid dates",
  );
}

/** ...and it throws before `SET ROLE`, so no connection ever carries the role. */
export async function assertAnInvalidDateSendsNoQuery(): Promise<void> {
  const { queries } = await queriesForInvalidFrom();
  expect(queries).toEqual([]);
}
