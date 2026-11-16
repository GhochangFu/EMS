import {
  ANOMALY_LIST_MAX_DAYS,
  ANOMALY_LIST_MAX_ROWS,
  resolveSiteTimeZone,
  type AnomalyListRow,
  type AnomalyScore,
} from "@bms/shared";

import { HOUR_MS, currentHourOf } from "./ml-forecasts.pure";

/**
 * `E1.2b` / ADR 0135 Amendment 5 A-e (plan T2.6, R12, R13) — the step between
 * the anomaly SQL rows and the wire, with no database and no clock of its own:
 * every function takes the request's one clock. Times arrive from SQL as epoch
 * milliseconds (`float8`), as the forecast reads' do.
 */
const DAY_MS = 24 * HOUR_MS;

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * The one-asset window: from the UTC hour `from` falls in, up to (excluding)
 * `to`. The query schema has already held `from < to` and the span cap, so the
 * window is never empty. Not clipped to the current hour: a future hour holds
 * no score, so it reads nothing.
 */
export function anomalyWindowOf(window: { from: Date; to: Date }): { fromHourMs: number; endMs: number } {
  return { fromHourMs: currentHourOf(window.from), endMs: window.to.getTime() };
}

/**
 * R13: the list's lower bound is `max(since, now − 7 days)` floored to the
 * hour; without `since` it is `now − 7 days` floored. Never refused. A `since`
 * in a future hour leaves an empty window (`empty: true`), so the service reads
 * nothing.
 */
export function anomalyListSinceOf(since: Date | undefined, now: Date): { sinceMs: number; empty: boolean } {
  const floor = now.getTime() - ANOMALY_LIST_MAX_DAYS * DAY_MS;
  const sinceMs = currentHourOf(new Date(Math.max(since?.getTime() ?? floor, floor)));
  return { sinceMs, empty: sinceMs > now.getTime() };
}

/** One row of the one-asset read: one hour and one detector, ascending, every column aliased. */
export type AssetAnomalyDbRow = {
  bucket_ms: number;
  detector: string;
  score: number;
  contributing_points: string[];
};

/** One one-asset row → the wire's score. */
export function toAnomalyScore(row: AssetAnomalyDbRow): AnomalyScore {
  return {
    t: iso(row.bucket_ms),
    detector: row.detector,
    score: row.score,
    contributingPoints: row.contributing_points,
  };
}

/** One row of the list read, every column aliased (two `timezone` columns would collide otherwise). */
export type AnomalyListDbRow = AssetAnomalyDbRow & {
  asset_id: string;
  asset_code: string;
  asset_name: string;
  asset_rtu_name: string | null;
  location_id: string;
  location_name: string;
  location_time_zone: string | null;
  organization_time_zone: string | null;
};

/** One list row → the wire shape; the zone by the history page's chain (location, organization, `UTC`). */
export function toAnomalyListRow(row: AnomalyListDbRow): AnomalyListRow {
  return {
    assetId: row.asset_id,
    assetCode: row.asset_code,
    assetName: row.asset_name,
    assetRtuName: row.asset_rtu_name,
    locationId: row.location_id,
    assetLocationName: row.location_name,
    timeZone: resolveSiteTimeZone(row.location_time_zone, row.organization_time_zone).timeZone,
    t: iso(row.bucket_ms),
    detector: row.detector,
    score: row.score,
    contributingPoints: row.contributing_points,
  };
}

/**
 * The list read asks for one row more than `ANOMALY_LIST_MAX_ROWS`; reading it
 * means `truncated`, and the first `ANOMALY_LIST_MAX_ROWS` (newest first) go out.
 */
export function toAnomalyList(rows: readonly AnomalyListDbRow[]): { truncated: boolean; items: AnomalyListRow[] } {
  return {
    truncated: rows.length > ANOMALY_LIST_MAX_ROWS,
    items: rows.slice(0, ANOMALY_LIST_MAX_ROWS).map(toAnomalyListRow),
  };
}
