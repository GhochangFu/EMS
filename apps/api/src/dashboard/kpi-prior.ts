import type { DashboardKpis } from "@bms/shared";
import type { Pool } from "pg";

import { latestPueRatio } from "../telemetry/pue-ratio";

/**
 * `F3.28` — the "vs yesterday" half of the KPI ribbon (ADR 0074 decision 5).
 *
 * `DashboardService.kpis` reports each figure twice: live, and as it stood at
 * {@link priorInstant} — exactly 24 h before the response's own `asOf`. The two
 * reads here are the prior halves of the live `kw_latest` sum and the live
 * `alarms_open` count, written as separate queries so that `F3.28` left the
 * live SQL as it was and this file carries the SQL (`dashboard.service.ts` sat
 * at AGENTS.md §4.5's 1000-line cap then). `F4.159` later changed both the live
 * and the prior `kw` sum the same way — the `totalKw` bullet below.
 *
 * Each read is the live one with its instant moved, and nothing else changed:
 *
 * - **`totalKw`** — the latest `kw` per asset at or before `at`, summed. No
 *   freshness bound, because the live `kw_latest` has none; a bound on one side
 *   only would make the delta compare two different populations. For the same
 *   reason both sums join `bms.assets` after the `DISTINCT ON` (`F4.159`): a
 *   `kw` sample whose asset row is gone counts in neither.
 * - **`alarmsOpen`** — alarms that were open at `at`: raised by then and not yet
 *   cleared by then. Scoped through the same `INNER JOIN` on the `$1`-scoped
 *   assets as the live count.
 * - **`pueEstimate`** is `latestPueRatio(pool, scope, at)`, which keeps its
 *   900 s freshness window and moves it back to `(at − 900 s, at]` — the
 *   owner's ruling OQ2 of 2026-09-24.
 *
 * `pool` is the caller's `FLEET_POOL`, and the `$1::uuid[]` scope is the
 * isolation control, the same as for the live reads it mirrors. The parameter
 * is typed `Pick<Pool, "query">` so a checked-out client (a rolled-back
 * transaction in the integration spec) satisfies it too.
 */

/** The three figures at {@link priorInstant} — the contract's own type (ADR 0030). */
export type KpiPrior = DashboardKpis["prior"];

/**
 * The prior for a scope with nothing in it: no load, no alarms, no PUE. Used by
 * `kpis`' early returns so their `prior.asOf` still pairs with their `asOf`.
 */
export function emptyKpiPrior(at: Date): KpiPrior {
  return { asOf: at.toISOString(), totalKw: null, alarmsOpen: 0, pueEstimate: null };
}

/**
 * The composed prior — the three reads below at one instant, on one pool and
 * one scope. Sequential rather than `Promise.all`, matching the live reads in
 * `kpis`, which share the same pool.
 */
export async function readKpiPrior(
  pool: Pick<Pool, "query">,
  assetIds: string[] | null,
  at: Date,
): Promise<KpiPrior> {
  return {
    asOf: at.toISOString(),
    totalKw: await priorTotalKw(pool, assetIds, at),
    alarmsOpen: await priorOpenAlarms(pool, assetIds, at),
    pueEstimate: await latestPueRatio(pool, assetIds, at),
  };
}

/** 24 h, the span "vs yesterday" means. */
export const KPI_PRIOR_OFFSET_MS = 24 * 3_600_000;

/** The instant the prior figures describe: `asOf` minus exactly 24 h. */
export function priorInstant(asOf: Date): Date {
  return new Date(asOf.getTime() - KPI_PRIOR_OFFSET_MS);
}

/**
 * Σ of each in-scope asset's latest `kw` sample with `time <= at`.
 *
 * `null` — never `0` — when no asset in scope has a `kw` row at or before `at`:
 * a site that was not reporting yesterday has no yesterday to compare with, and
 * a `0` would render as an infinite rise. An empty scope is `null` for the same
 * reason; `null` scope is every asset.
 */
export async function priorTotalKw(
  pool: Pick<Pool, "query">,
  assetIds: string[] | null,
  at: Date,
): Promise<number | null> {
  if (assetIds && assetIds.length === 0) {
    return null;
  }
  const r = await pool.query<{ assets: number; total_kw: string | null }>(
    `
    WITH kw_prior AS (
      SELECT DISTINCT ON (asset_id) asset_id, value AS kw
      FROM telemetry.point_values
      WHERE point_key = 'kw'
        AND time <= $2::timestamptz
        AND ($1::uuid[] IS NULL OR asset_id = ANY($1::uuid[]))
      ORDER BY asset_id, time DESC
    )
    -- F4.159: no foreign key holds telemetry to bms.assets; only existing assets count.
    SELECT COUNT(*)::int AS assets, SUM(k.kw)::float8 AS total_kw
    FROM kw_prior k INNER JOIN bms.assets a ON a.id = k.asset_id
    `,
    [assetIds ?? null, at.toISOString()],
  );
  const row = r.rows[0];
  if (!row || Number(row.assets) === 0 || row.total_kw === null) {
    return null;
  }
  return Number(row.total_kw);
}

/**
 * Count of `bms.alarms` open at `at`: `raised_at <= at` and either never
 * cleared or cleared after `at`.
 *
 * Not nullable (plan decision 3): `bms.alarms` is the complete history, so "no
 * row" really is zero. The scope is the live count's own — an `INNER JOIN` on
 * the `$1`-scoped `bms.assets` — so the delta compares one population.
 */
export async function priorOpenAlarms(
  pool: Pick<Pool, "query">,
  assetIds: string[] | null,
  at: Date,
): Promise<number> {
  if (assetIds && assetIds.length === 0) {
    return 0;
  }
  const r = await pool.query<{ alarms_open: number }>(
    `
    WITH asset_scope AS (
      SELECT id FROM bms.assets
      WHERE ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))
    )
    SELECT COUNT(*)::int AS alarms_open
    FROM bms.alarms al
    INNER JOIN asset_scope s ON s.id = al.asset_id
    WHERE al.raised_at <= $2::timestamptz
      AND (al.cleared_at IS NULL OR al.cleared_at > $2::timestamptz)
    `,
    [assetIds ?? null, at.toISOString()],
  );
  return Number(r.rows[0]?.alarms_open ?? 0);
}
