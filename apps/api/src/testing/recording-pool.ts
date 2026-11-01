import type pg from "pg";

/**
 * A `pg.Pool` stand-in that records every statement and answers no rows — the
 * statement-shape gate for a read that binds its scope as parameters.
 *
 * Moved by `F4.301` U2 from the private copy in
 * `reports/energy-view-read.integration.spec.ts`, so the trend strip read and
 * the energy view read share one. `recording-db.ts` is a Drizzle fake and
 * cannot record `pool.query`.
 */

export type Recorded = { readonly text: string; readonly params: readonly unknown[] };

/** A fresh recording pool and the list its `query` calls append to. */
export function recordingPool(): { pool: pg.Pool; statements: Recorded[] } {
  const statements: Recorded[] = [];
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      statements.push({ text, params });
      return { rows: [], rowCount: 0 };
    },
  } as unknown as pg.Pool;
  return { pool, statements };
}
