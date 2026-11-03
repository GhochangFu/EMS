import { expect, vi } from "vitest";

import type { HistoryRange } from "../lib/asset-history-range";
import {
  downloadAssetHistoryExport,
  downloadEnergyViewExport,
  downloadSegmentViewExport,
  downloadTrendStripExport,
  ViewExportError,
} from "./view-exports";

/**
 * `F4.303` U7 (ADR 0108 Amendment 6 item 3) — the web client for the eight export routes. `node`
 * environment, the `reports.spec.ts` shape: `document` and `URL` are stubbed for `saveBlob`, and
 * `fetch` is stubbed to record the one request. Entry point: `view-exports.test.ts`.
 */

const LOCATION_ID = "0b7e2f4a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d";

type AnchorStub = { href: string; download: string; click: () => void; remove: () => void };
type SeenRequest = { url: string; init: RequestInit };

function stubDom(): { lastAnchor: () => AnchorStub | undefined } {
  let lastAnchor: AnchorStub | undefined;
  vi.stubGlobal("document", {
    createElement: () => {
      const anchor: AnchorStub = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
      lastAnchor = anchor;
      return anchor;
    },
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  return { lastAnchor: () => lastAnchor };
}

function captureFetch(status: number, body: BodyInit | null): () => SeenRequest {
  let seen: SeenRequest = { url: "", init: {} };
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    seen = { url: String(url), init: init ?? {} };
    return new Response(body, { status });
  });
  return () => seen;
}

function split(url: string): { path: string; search: URLSearchParams } {
  const [path = "", query = ""] = url.split("?");
  return { path, search: new URLSearchParams(query) };
}

/** V1: the Energy export fetches `energy/view/export.csv` with the view's own search and saves `energy-view.csv`. */
export async function theEnergyExportFetchesTheViewSearchAndSavesTheFile(): Promise<void> {
  const seen = captureFetch(200, "csv-bytes");
  const { lastAnchor } = stubDom();

  await downloadEnergyViewExport("csv", {
    range: "7d",
    organizationId: ORGANIZATION_ID,
    locationIds: [LOCATION_ID],
    compare: "previous",
  });

  const { path, search } = split(seen().url);
  expect(path.endsWith("/api/v1/reports/energy/view/export.csv")).toBe(true);
  expect(search.get("range")).toBe("7d");
  expect(search.get("organizationId")).toBe(ORGANIZATION_ID);
  expect(search.getAll("locationIds")).toEqual([LOCATION_ID]);
  expect(search.get("compare")).toBe("previous");
  expect(lastAnchor()?.download).toBe("energy-view.csv");
}

/** V1: the XLSX half names the `.xlsx` path and file. */
export async function theEnergyXlsxNamesTheXlsxPathAndFile(): Promise<void> {
  const seen = captureFetch(200, "xlsx-bytes");
  const { lastAnchor } = stubDom();

  await downloadEnergyViewExport("xlsx", { range: "24h" });

  expect(split(seen().url).path.endsWith("/reports/energy/view/export.xlsx")).toBe(true);
  expect(lastAnchor()?.download).toBe("energy-view.xlsx");
}

/** V1: the request carries the bearer header `withAuth` builds. */
export async function theRequestCarriesTheBearerHeader(): Promise<void> {
  const seen = captureFetch(200, "csv-bytes");
  stubDom();
  const { useAuthStore } = await import("../stores/auth-store");
  useAuthStore.setState({ accessToken: "tok-123" });

  await downloadEnergyViewExport("csv", { range: "24h" });

  expect(new Headers(seen().init.headers).get("Authorization")).toBe("Bearer tok-123");
  useAuthStore.setState({ accessToken: null });
}

/** V2: the segment export is beside the segment read, with its search. */
export async function theSegmentExportPathAndSearch(): Promise<void> {
  const seen = captureFetch(200, "csv-bytes");
  const { lastAnchor } = stubDom();

  await downloadSegmentViewExport("csv", LOCATION_ID, { range: "24h", segment: "seg-one", point: "kw", compare: "previous" });

  const { path, search } = split(seen().url);
  expect(path.endsWith(`/api/v1/control-room/sites/${LOCATION_ID}/segment-views/export.csv`)).toBe(true);
  expect(search.get("segment")).toBe("seg-one");
  expect(search.get("point")).toBe("kw");
  expect(search.get("compare")).toBe("previous");
  expect(lastAnchor()?.download).toBe("segment-view.csv");
}

/** V2: the strip export sends the range and the group, and the xlsx name. */
export async function theStripExportPathAndSearch(): Promise<void> {
  const seen = captureFetch(200, "xlsx-bytes");
  const { lastAnchor } = stubDom();

  await downloadTrendStripExport("xlsx", LOCATION_ID, { range: "7d", assetGroupId: GROUP_ID });

  const { path, search } = split(seen().url);
  expect(path.endsWith(`/control-room/sites/${LOCATION_ID}/trend-strip/export.xlsx`)).toBe(true);
  expect(search.get("range")).toBe("7d");
  expect(search.get("assetGroupId")).toBe(GROUP_ID);
  expect(lastAnchor()?.download).toBe("trend-strip.xlsx");
}

/** V2: a whole-site strip sends no `assetGroupId` key. */
export async function aWholeSiteStripSendsNoGroupKey(): Promise<void> {
  const seen = captureFetch(200, "csv-bytes");
  stubDom();

  await downloadTrendStripExport("csv", LOCATION_ID, { range: "24h", assetGroupId: null });

  expect(split(seen().url).search.has("assetGroupId")).toBe(false);
}

const HISTORY: HistoryRange = { range: "7d", compare: true, points: ["kw", "pf"], fn: "max" };

/** V2: history sends the codes, the trailing window, `compare=true` and the function. */
export async function theHistoryExportPresetSearch(): Promise<void> {
  const seen = captureFetch(200, "csv-bytes");
  const { lastAnchor } = stubDom();

  await downloadAssetHistoryExport("csv", ASSET_ID, HISTORY, ["kw", "pf"]);

  const { path, search } = split(seen().url);
  expect(path.endsWith(`/api/v1/telemetry/assets/${ASSET_ID}/history/export.csv`)).toBe(true);
  expect(search.get("points")).toBe("kw,pf");
  expect(search.get("windowMinutes")).toBe("10080");
  expect(search.has("from")).toBe(false);
  expect(search.get("compare")).toBe("true");
  expect(search.get("bucketFunction")).toBe("max");
  expect(lastAnchor()?.download).toBe("asset-history.csv");
}

/** V2: a custom range sends `from` and `to` and no `windowMinutes`; compare off sends no key. */
export async function theHistoryExportCustomSearch(): Promise<void> {
  const seen = captureFetch(200, "xlsx-bytes");
  stubDom();
  const custom: HistoryRange = {
    range: "custom",
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-03T00:00:00.000Z",
    compare: false,
    points: ["kw"],
    fn: "avg",
  };

  await downloadAssetHistoryExport("xlsx", ASSET_ID, custom, ["kw"]);

  const { path, search } = split(seen().url);
  expect(path.endsWith("/history/export.xlsx")).toBe(true);
  expect(search.get("from")).toBe("2026-10-01T00:00:00.000Z");
  expect(search.get("to")).toBe("2026-10-03T00:00:00.000Z");
  expect(search.has("windowMinutes")).toBe(false);
  expect(search.has("compare")).toBe(false);
}

/** V3: a 400 throws a `ViewExportError` carrying the status. */
export async function aFourHundredThrowsAViewExportErrorWithTheStatus(): Promise<void> {
  captureFetch(400, "Export would hold 50001 rows");
  stubDom();

  let caught: unknown;
  try {
    await downloadEnergyViewExport("csv", { range: "24h" });
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeInstanceOf(ViewExportError);
  expect((caught as ViewExportError).status).toBe(400);
}

/** V3: the error message is a fixed label, never the response body. */
export async function theErrorMessageNeverCarriesTheBody(): Promise<void> {
  captureFetch(403, "SECRET body");
  stubDom();

  let caught: unknown;
  try {
    await downloadSegmentViewExport("csv", LOCATION_ID, { range: "24h" });
  } catch (err) {
    caught = err;
  }

  expect((caught as ViewExportError).status).toBe(403);
  expect((caught as ViewExportError).message).not.toContain("SECRET");
}
