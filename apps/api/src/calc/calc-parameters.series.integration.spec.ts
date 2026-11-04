import type pg from "pg";
import { expect } from "vitest";

import { createDb } from "@bms/db";

import { inputKey } from "./calc-batch";
import { parameterValueAt } from "./calc-parameter-series";
import { KEY, type ParametersFixture } from "./calc-parameters.integration.spec";
import { CalcParametersService } from "./calc-parameters.service";

/**
 * `F4.311` task 5.4 (ADR 0109 decision 7, owner ruling 2) —
 * `resolveSeriesForAssets` against a real database, with the point read
 * `resolveForAssets` as the **oracle**: for every instant on a grid, the
 * series read and `parameterValueAt` must answer what the point read answers.
 *
 * Reuses the `E4.1a` fixture (`seedParametersFixture`): an organization row
 * from `t0`, a location row `[t0, t2)` and an asset row `[t1, t2)` for a
 * per-run `KEY`, asset A at the location, B elsewhere in the organization, F
 * in another organization. The grid runs five-minute steps from ten minutes
 * before `t0` to ten minutes after `t2`, so it lands exactly on all three
 * boundaries — the half-open ends are where a wrong bound would show.
 */

const STEP_MS = 5 * 60_000;
const PAD_MS = 10 * 60_000;

function service(pool: pg.Pool): CalcParametersService {
  return new CalcParametersService(createDb(pool));
}

function grid(fixture: ParametersFixture): number[] {
  const out: number[] = [];
  for (let t = fixture.t0.getTime() - PAD_MS; t <= fixture.t2.getTime() + PAD_MS; t += STEP_MS) {
    out.push(t);
  }
  return out;
}

/** Every `(asset, instant)` where the series disagrees with the point read, as `asset@iso: series vs point`. */
export async function seriesDisagreements(pool: pg.Pool, fixture: ParametersFixture): Promise<string[]> {
  const svc = service(pool);
  const pairs = [fixture.a, fixture.b, fixture.f].map((assetId) => ({ assetId, key: KEY }));
  const instants = grid(fixture);
  const series = await svc.resolveSeriesForAssets(
    pairs,
    new Date(instants[0] as number),
    new Date(instants[instants.length - 1] as number),
  );
  const out: string[] = [];
  for (const t of instants) {
    const point = await svc.resolveForAssets(pairs, new Date(t));
    for (const { assetId } of pairs) {
      const k = inputKey(assetId, KEY);
      const fromSeries = parameterValueAt(series.get(k) ?? [], t);
      if (fromSeries !== point.get(k)) {
        out.push(`${assetId}@${new Date(t).toISOString()}: ${fromSeries} vs ${point.get(k)}`);
      }
    }
  }
  return out;
}

/** The series read equals the point read at every instant of the grid, for all three assets. */
export async function assertTheSeriesMatchesThePointReadOnTheGrid(
  pool: pg.Pool,
  fixture: ParametersFixture,
): Promise<void> {
  expect(await seriesDisagreements(pool, fixture)).toEqual([]);
}

/**
 * A range that starts after `t2` holds no row that ended at or before its
 * start — the statement's `effective_to` bound, not only `parameterValueAt`'s,
 * keeps a superseded tariff out of the chunk.
 */
export async function assertARangeAfterAnEndedRowDoesNotReturnIt(
  pool: pg.Pool,
  fixture: ParametersFixture,
): Promise<void> {
  const from = new Date(fixture.t2.getTime() + 1_000);
  const series = await service(pool).resolveSeriesForAssets(
    [{ assetId: fixture.a, key: KEY }],
    from,
    new Date(from.getTime() + 3_600_000),
  );
  const ended = (series.get(inputKey(fixture.a, KEY)) ?? []).filter(
    (row) => row.toMs !== null && row.toMs <= from.getTime(),
  );
  expect(ended).toEqual([]);
}
