import type pg from "pg";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { MetricsService } from "../observability/metrics.service";
import { CalcWriteService, type CalcWriteInput } from "./calc-write.service";

/**
 * `F4.311` PR 5 review — `writeValues`' NOTIFY is the caller's to switch off,
 * and only the backfill does. No database: the two Drizzle handles are
 * chains that answer what the write path reads, and every `tx.execute` is
 * recorded — the NOTIFY is the only statement the value transaction runs
 * through `execute`, so the record is the NOTIFY count.
 *
 * Why the option exists: a NOTIFY on `bms_telemetry` reaches every API
 * instance's `TelemetryBroadcastHub`, whose consumers (the alarm engine, the
 * streaming host, the WebSocket gateway) treat a reading as live. A backfill
 * writes weeks-old values, which must raise no live alarm and reach no
 * browser as current (`telemetry-write.service.ts`' `NOTIFY_LIVE_WINDOW_MS`
 * holds the same line for a backdated manual entry).
 */

const ROWS: CalcWriteInput[] = [
  { assetId: "asset-1", pointKey: "DERIVED", value: 1, time: new Date("2026-10-01T00:00:00.000Z") },
  { assetId: "asset-1", pointKey: "DERIVED", value: 2, time: new Date("2026-10-01T00:01:00.000Z") },
];

function chain(answer: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const method of ["select", "from", "insert", "values", "onConflictDoNothing"]) {
    c[method] = () => c;
  }
  c.where = () => Promise.resolve(answer());
  c.returning = () => Promise.resolve(answer());
  return c;
}

/** Writes `ROWS` with `options` and returns how many statements went through `tx.execute` (the NOTIFYs). */
async function notifiesFor(options?: { notify?: boolean }): Promise<number> {
  let executes = 0;
  const fleetDb = chain(() => [{ id: "asset-1", organizationId: "org-1" }]);
  let inserted: CalcWriteInput[] = [];
  const tx = {
    insert: () => ({
      values: (rows: CalcWriteInput[]) => {
        inserted = rows;
        return {
          onConflictDoNothing: () => ({
            returning: async () => inserted.map((row) => ({ time: row.time, assetId: row.assetId, pointKey: row.pointKey })),
          }),
        };
      },
    }),
    execute: async () => {
      executes += 1;
    },
  };
  const db = { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
  // The per-chunk refresh is caught and logged by `writeValues`; a pool that
  // refuses keeps it off any database.
  const pool = {
    connect: async () => {
      throw new Error("no database in this spec");
    },
    query: async () => {
      throw new Error("no database in this spec");
    },
  };
  const service = new CalcWriteService(
    db as unknown as BmsDb,
    fleetDb as unknown as BmsDb,
    pool as unknown as pg.Pool,
    new MetricsService(),
  );
  const { written } = await service.writeValues(ROWS, options);
  expect(written, "anti-vacuity: the rows were written").toBe(ROWS.length);
  return executes;
}

/** By default a write NOTIFYs its rows — the sweep and the streaming host rely on it. */
export async function aDefaultWriteNotifies(): Promise<void> {
  expect(await notifiesFor()).toBeGreaterThan(0);
}

/** `{ notify: false }` writes the rows and issues no `pg_notify`. */
export async function notifyFalseIssuesNoNotify(): Promise<void> {
  expect(await notifiesFor({ notify: false })).toBe(0);
}
