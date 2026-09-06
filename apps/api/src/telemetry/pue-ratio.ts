import { DEFAULT_MAX_INPUT_AGE_SECONDS } from "@bms/shared";
import type { Pool } from "pg";

import { aggregateRelation, avgExpr, type AggregateLevel } from "./point-aggregates";

/**
 * `F2.8` — Power Usage Effectiveness, read rather than fitted.
 *
 * ## What this replaces
 *
 * `DashboardService` and `ReportsService` each carried a private PUE estimator
 * returning a curve fitted to one number — `1.22` plus `min(0.45, totalKw /
 * 12000)` — with a `1.0` sentinel for an empty scope. Both are deleted in the
 * same commit as this file. (The constant is spelled without its original `+`
 * here on purpose: `F2.8` adds a repo-wide scan for the deleted curve, and a
 * comment *about* it must not be what the scan finds.)
 *
 * PUE is now measured: the `bms-calc-v2` engine computes `site_kw` and
 * `it_kw` on each site's `incoming-supply` asset (the stock entry is
 * `admin/asset-templates/stock-catalog/electrical-feeder.ts`; the ESKOM demo
 * template is `packages/db/src/pue-demo-seed.ts`, which differs only in reading
 * `rack_kw` for the IT aggregate), and this module sums them.
 *
 * ## Ruling 3, verbatim (the owner, 2026-09-05)
 *
 * > **Estate figure = kW-weighted:** Σ `site_kw` / Σ `it_kw` over the incomers
 * > in scope; one site in scope reduces to that site's own ratio; sites with no
 * > PUE point are left out of both sums.
 *
 * The last clause is the `HAVING COUNT(*) = 2` below, and it is the one part
 * that is easy to get wrong quietly: an incomer that computes `site_kw` but not
 * `it_kw` must leave **both** sums, not just the denominator. Keeping its site
 * load while dropping its IT load inflates every estate figure it appears in.
 * `pue-ratio.integration.spec.ts` mutation-tests exactly that.
 *
 * Ruling 4 — nothing configured is `null`, no sentinel — lives in
 * {@link pueRatioOf}.
 *
 * ## Containment
 *
 * `pool` is the caller's `FLEET_POOL`. Both `DashboardService` and
 * `ReportsService` inject it (ADR 0043 Amendments 2/3; the reason is written out
 * at `reports.service.ts:31-38`), and the `$1::uuid[]` scope threaded from
 * `AccessControlService.readableAssetIds` **is** the isolation control. That is
 * safe here for a reason worth stating rather than inheriting: neither query
 * below joins a `bms.*` table at all. They read `telemetry.point_values` and
 * `telemetry.point_values_*`, which carry no row-level security (migration
 * `0052`'s own header), so there is no policied surface for the fleet role to
 * bypass — only the scope array decides what is counted. `null` means "every
 * incomer", which is what a global admin's `readableAssetIds` returns.
 *
 * ## The freshness bound on the latest read — the owner's ruling of 2026-09-06
 *
 * {@link latestPueRatio} ignores any `site_kw` or `it_kw` row older than
 * {@link PUE_LATEST_MAX_AGE_SECONDS}. A site that stops reporting drops out of
 * **both** sums (the pairing rule below takes its surviving half with it), and
 * a scope in which every site has gone silent answers `null` — the tile shows
 * the dash, exactly as it does for "nothing configured", because a reader can
 * act on neither difference.
 *
 * Plan §11 decision 6 originally took the opposite view — no bound, for parity
 * with the `kw_latest` CTE the estate `totalKw` is read from — on the strength
 * of "the ribbon's `Stale` badge is the page-level signal". **That second half
 * was measured false in review.** `use-executive-dashboard.ts` derives `stale`
 * estate-wide from the timestamp of the last Socket.IO `kw` tick, so one silent
 * site among nine cannot move it; and `energy-page.tsx` and `reports-panel.tsx`
 * pass no `stale` prop at all. Nothing else on those pages would have said that
 * a PUE of 1.4 was two days old.
 *
 * 900 s is three times the engine's own default `maxInputAgeSeconds`
 * (`DEFAULT_MAX_INPUT_AGE_SECONDS`, `packages/shared/src/calc-dsl/limits.ts`):
 * the engine refuses to *write* a value computed from inputs older than 300 s,
 * and the reader tolerates three of those before it stops showing what was
 * written. `pue-ratio.spec.ts` pins the multiple rather than the number, so
 * retuning the engine default cannot silently break the relationship.
 *
 * The predicate is **one-sided** — `time > now() - interval` and no upper bound
 * — because a future-stamped row is a clock problem, not a staleness one, and
 * because the integration fixture deliberately lives in 2031 (its header says
 * why). {@link windowedPueRatio} is **not** bounded: its caller passes an
 * explicit `[start, end]`, which is a stronger and more honest statement of
 * which rows count, and an "energy in the last 24 h" panel that silently
 * dropped its own window would be wrong rather than cautious.
 *
 * Parameterised queries throughout; the only interpolation is
 * `aggregateRelation(level)`, a lookup against the closed `RELATIONS` set, and
 * `avgExpr()`, which validates its own alias.
 */

/**
 * How old a `site_kw` / `it_kw` reading may be and still count towards the KPI
 * — fifteen minutes, the owner's ruling of 2026-09-06 (module docblock).
 *
 * Derived from the engine's default rather than typed as `900`: three ticks of
 * `DEFAULT_MAX_INPUT_AGE_SECONDS` is the decision, and the number is only its
 * current value.
 */
export const PUE_LATEST_MAX_AGE_SECONDS = 3 * DEFAULT_MAX_INPUT_AGE_SECONDS;

/** The three numbers ruling 3 reduces a scope to. */
export interface PueRatioInput {
  /** Incomers that computed **both** points. Zero means "not configured". */
  readonly incomers: number;
  /** Σ `site_kw` over those incomers. */
  readonly siteKw: number;
  /** Σ `it_kw` over the same incomers. */
  readonly itKw: number;
}

/**
 * Ruling 4: `null` where there is nothing to divide, never a sentinel.
 *
 * Three ways to have no answer, and all three are the same answer:
 *
 * - **no paired incomer in scope** — the tenant has not configured the points,
 *   or the caller's scope contains no incomer that has;
 * - **`it_kw` sums to zero** — a division by zero is `Infinity`, which is not a
 *   PUE, and `1` would be indistinguishable from a real measurement;
 * - **a non-finite result** — `pueEstimate` is `z.number().nullable()` (ADR
 *   0030) and `NaN`/`Infinity` satisfy neither, so one would fail the web
 *   client's `checkResponse` and show an error where a dash belongs.
 *
 * Rounded to two decimals, the same `Math.round(v * 100) / 100` both services
 * already apply to every other number on the ribbon.
 */
export function pueRatioOf({ incomers, siteKw, itKw }: PueRatioInput): number | null {
  if (incomers <= 0) {
    return null;
  }
  // `> 0` rather than `!== 0`: it also rejects `NaN` and a negative denominator,
  // neither of which has a meaningful PUE.
  if (!(itKw > 0)) {
    return null;
  }
  const raw = siteKw / itKw;
  if (!Number.isFinite(raw)) {
    return null;
  }
  return Math.round(raw * 100) / 100;
}

/** Shape both queries reduce to before {@link pueRatioOf} sees it. */
interface PueSumsRow {
  readonly incomers: number;
  readonly site_kw: string;
  readonly it_kw: string;
}

function ratioOfRow(row: PueSumsRow | undefined): number | null {
  if (!row) {
    return null;
  }
  return pueRatioOf({
    incomers: Number(row.incomers),
    siteKw: Number(row.site_kw),
    itKw: Number(row.it_kw),
  });
}

/**
 * The KPI read: Σ of the **latest** `site_kw` over Σ of the latest `it_kw`.
 *
 * `DISTINCT ON (asset_id, point_key)` gives at most one row per asset per point,
 * so `COUNT(*) = 2` in the pairing step means "this incomer reported both" and
 * `MAX(value) FILTER (…)` picks that single row's value rather than aggregating
 * anything.
 *
 * The {@link PUE_LATEST_MAX_AGE_SECONDS} bound is applied **inside** the
 * `latest` CTE rather than after the pairing, and that placement is the whole
 * behaviour: a site whose `it_kw` has gone stale loses that row here, fails
 * `COUNT(*) = 2` below, and so leaves the numerator as well. Half a stale
 * incomer must not be worse than none — keeping its site load while dropping
 * its IT load would inflate every estate figure it appeared in.
 *
 * @param assetIds the caller's scope. `null` is every incomer; an empty array is
 *   nothing, and answers `null` — the same treatment `kw_latest` gives it.
 */
export async function latestPueRatio(
  pool: Pool,
  assetIds: string[] | null,
): Promise<number | null> {
  const r = await pool.query<PueSumsRow>(
    `
    WITH latest AS (
      SELECT DISTINCT ON (asset_id, point_key) asset_id, point_key, value
      FROM telemetry.point_values
      WHERE point_key IN ('site_kw', 'it_kw')
        AND time > now() - ($2::int * interval '1 second')
        AND ($1::uuid[] IS NULL OR asset_id = ANY($1::uuid[]))
      ORDER BY asset_id, point_key, time DESC
    ),
    paired AS (
      SELECT asset_id,
             MAX(value) FILTER (WHERE point_key = 'site_kw') AS site_kw,
             MAX(value) FILTER (WHERE point_key = 'it_kw') AS it_kw
      FROM latest
      GROUP BY asset_id
      HAVING COUNT(*) = 2
    )
    SELECT COUNT(*)::int AS incomers,
           COALESCE(SUM(site_kw), 0)::float8 AS site_kw,
           COALESCE(SUM(it_kw), 0)::float8 AS it_kw
    FROM paired
    `,
    [assetIds ?? null, PUE_LATEST_MAX_AGE_SECONDS],
  );
  return ratioOfRow(r.rows[0]);
}

export interface WindowedPueRatioOptions {
  /** Aggregate level, chosen by the caller's `levelForRange` exactly as its kWh query does. */
  readonly level: AggregateLevel;
  readonly start: Date;
  readonly end: Date;
  /** The caller's scope; `null` is every incomer. */
  readonly assetIds: string[] | null;
}

/**
 * The energy-window read: Σ of each incomer's **window mean** `site_kw` over Σ
 * of its window mean `it_kw`.
 *
 * The mean is `avgExpr()` — `sum(sum_value) / sum(sample_count)` — never an
 * average of averages. ADR 0023 measured the naive form wrong in 151 of 169
 * buckets while still agreeing on the window total, so a reader that "simplified"
 * it would look right at the totals and be wrong per site.
 *
 * No `refresh_continuous_aggregate` call and none needed: migration `0027`
 * creates all four aggregates with `materialized_only = false`, so the view
 * unions its stored rows with a live aggregate over the un-materialized tail —
 * the branch ADR 0023 measured exact to 7.1e-14 against raw.
 *
 * The bounds are `bucket >= start AND bucket <= end`, on the bucket rather than
 * on `time`, which is the same predicate shape both callers' kWh queries use —
 * and they are the **only** bounds here. {@link PUE_LATEST_MAX_AGE_SECONDS} is
 * deliberately not applied: the caller has already named the window it wants,
 * and silently dropping part of it would be wrong rather than cautious.
 */
export async function windowedPueRatio(
  pool: Pool,
  { level, start, end, assetIds }: WindowedPueRatioOptions,
): Promise<number | null> {
  const relation = aggregateRelation(level);
  if (!relation) {
    // Unreachable through the type, but types erase at runtime and this string is
    // interpolated into SQL. Throwing proves the interpolation can only ever be a
    // member of the closed `RELATIONS` set — the same guard `aggregateRelation`
    // itself documents.
    throw new Error(`windowedPueRatio: unknown aggregate level "${level}"`);
  }
  const r = await pool.query<PueSumsRow>(
    `
    WITH per AS (
      SELECT asset_id, point_key, ${avgExpr()} AS mean
      FROM ${relation}
      WHERE point_key IN ('site_kw', 'it_kw')
        AND bucket >= $1
        AND bucket <= $2
        AND ($3::uuid[] IS NULL OR asset_id = ANY($3::uuid[]))
      GROUP BY 1, 2
    ),
    paired AS (
      SELECT asset_id,
             MAX(mean) FILTER (WHERE point_key = 'site_kw') AS site_kw,
             MAX(mean) FILTER (WHERE point_key = 'it_kw') AS it_kw
      FROM per
      GROUP BY asset_id
      HAVING COUNT(*) = 2
    )
    SELECT COUNT(*)::int AS incomers,
           COALESCE(SUM(site_kw), 0)::float8 AS site_kw,
           COALESCE(SUM(it_kw), 0)::float8 AS it_kw
    FROM paired
    `,
    [start, end, assetIds ?? null],
  );
  return ratioOfRow(r.rows[0]);
}
