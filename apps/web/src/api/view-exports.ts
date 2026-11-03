import type { EnergyViewQuery, SiteSegmentViewsQuery } from "@bms/shared";

import { ApiError } from "../lib/api-error";
import { rangeToQuery, type HistoryRange } from "../lib/asset-history-range";
import { viewSearch } from "./energy-view";
import { downloadExport } from "./reports";
import { segmentSearch } from "./segment-views";
import { trendStripSearch, type TrendStripRequest } from "./trend-strip";

/**
 * `F4.303` U7 (ADR 0108 Amendment 6 item 3) — the web client for the eight export routes, one
 * pair (CSV, XLSX) per view kind. Each export sends the view's own query, so the file holds what
 * the screen shows; the file name is fixed per kind (the server names it the same way).
 *
 * A refusal throws {@link ViewExportError} carrying only the status. `ExportMenu` picks a fixed
 * sentence from it; the response body is never read into a message (`F4.204`).
 */

export type ViewExportFormat = "csv" | "xlsx";

/** A refused export. The message is a fixed label; the status is what the menu reads. */
export class ViewExportError extends Error {
  constructor(readonly status: number) {
    super(`view export ${status}`);
    this.name = "ViewExportError";
  }
}

async function exportView(
  path: string,
  search: URLSearchParams,
  format: ViewExportFormat,
  kind: string,
): Promise<void> {
  try {
    await downloadExport(`${path}.${format}`, search, `${kind}.${format}`, `${kind}-${format}`);
  } catch (err) {
    throw err instanceof ApiError ? new ViewExportError(err.status) : err;
  }
}

/** `GET /api/v1/reports/energy/view/export.(csv|xlsx)` — the Energy page and the site Energy sub-tab. */
export function downloadEnergyViewExport(format: ViewExportFormat, query: EnergyViewQuery): Promise<void> {
  return exportView("/api/v1/reports/energy/view/export", viewSearch(query), format, "energy-view");
}

/** `GET /api/v1/control-room/sites/:locationId/segment-views/export.(csv|xlsx)` — a segment sub-tab. */
export function downloadSegmentViewExport(
  format: ViewExportFormat,
  locationId: string,
  query: SiteSegmentViewsQuery,
): Promise<void> {
  return exportView(
    `/api/v1/control-room/sites/${encodeURIComponent(locationId)}/segment-views/export`,
    segmentSearch(query),
    format,
    "segment-view",
  );
}

/** `GET /api/v1/control-room/sites/:locationId/trend-strip/export.(csv|xlsx)` — the trend strip. */
export function downloadTrendStripExport(
  format: ViewExportFormat,
  locationId: string,
  request: TrendStripRequest,
): Promise<void> {
  return exportView(
    `/api/v1/control-room/sites/${encodeURIComponent(locationId)}/trend-strip/export`,
    trendStripSearch(request),
    format,
    "trend-strip",
  );
}

/**
 * `GET /api/v1/telemetry/assets/:assetId/history/export.(csv|xlsx)` — the asset history page. The
 * search mirrors `fetchPointAggregate`'s (a preset is a trailing `windowMinutes`, a custom range
 * the `from`/`to` pair, `compare=true` only when on) plus the charted codes.
 */
export function downloadAssetHistoryExport(
  format: ViewExportFormat,
  assetId: string,
  range: HistoryRange,
  points: readonly string[],
): Promise<void> {
  const search = new URLSearchParams({ points: points.join(",") });
  const window = rangeToQuery(range, Date.now());
  if ("windowMinutes" in window) {
    search.set("windowMinutes", String(window.windowMinutes));
  } else {
    search.set("from", window.from);
    search.set("to", window.to);
  }
  if (range.compare) {
    search.set("compare", "true");
  }
  search.set("bucketFunction", range.fn);
  return exportView(
    `/api/v1/telemetry/assets/${encodeURIComponent(assetId)}/history/export`,
    search,
    format,
    "asset-history",
  );
}
