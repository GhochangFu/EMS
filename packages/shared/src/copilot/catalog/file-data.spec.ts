import { expect } from "vitest";

import { catalogEntry, catalogPath, COPILOT_CATALOG, EXCLUDED_ROUTES, hashExcludedKeysOf } from "./index";
import { modelBodyOf } from "./model-body";
import type { CatalogEntry } from "./types";

/**
 * `F4.283` (ADR 0099 Amendment 8, Q18–Q21) — the file-borne data entries. The
 * rules every entry obeys are `catalog.spec.ts`; this file holds what is
 * particular to these three. Vitest entry point: the sibling `.test.ts`.
 */

const ASSET = "22222222-2222-4222-8222-222222222222";
const FILE_IDS = ["telemetry.import", "telemetryReading.create", "assetImage.upload"];
const ROW = { assetId: ASSET, pointKey: "kw", value: 1, time: "2026-10-20T09:00:00.000Z" };

function entry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (!found) throw new Error(`no catalog entry ${id}`);
  return found;
}

export function theThreeEntriesAreInTheCatalog(): void {
  expect(FILE_IDS.filter((id) => COPILOT_CATALOG.some((candidate) => candidate.id === id))).toEqual(FILE_IDS);
}

/** Q18: the routes' `isMasterDataRole` gate — never the asset-group admin. */
export function noEntryIsOfferedToTheAssetGroupAdmin(): void {
  for (const id of FILE_IDS) expect(entry(id).offeredTo, id).toEqual(["admin", "organization_admin", "location_admin"]);
}

export function theImportHashLeavesOutOnlyThePreview(): void {
  expect(hashExcludedKeysOf(entry("telemetry.import"))).toEqual(["preview"]);
}

export function theImportSummaryNamesTheFile(): void {
  const summary = entry("telemetry.import").summary({
    body: { filename: "readings.csv", fileSha256: "a".repeat(64) },
    params: {},
    targetName: "Pune Works",
    organizationName: "Pune Works",
  });
  expect(summary).toContain('"readings.csv"');
}

export function theImportSummarySaysConflictsAreRejected(): void {
  const summary = entry("telemetry.import").summary({ body: {}, params: {}, targetName: "P", organizationName: "Pune Works" });
  expect(summary).toContain("conflicting readings are rejected");
}

export function theReadingsSummaryNamesTheRowCount(): void {
  const summary = entry("telemetryReading.create").summary({
    body: { rows: [ROW, ROW, ROW] },
    params: {},
    targetName: "Pune Works",
    organizationName: "Pune Works",
  });
  expect(summary).toContain("Record 3 manual readings");
}

export function theImportModelBodyRefusesOverwrite(): void {
  const parsed = modelBodyOf(entry("telemetry.import")).safeParse({ conflictPolicy: "overwrite", file: { kind: "attachment", index: 1 } });
  expect(parsed.success).toBe(false);
}

export function theReadingsModelBodyRefusesOverwrite(): void {
  const parsed = modelBodyOf(entry("telemetryReading.create")).safeParse({ rows: [ROW], conflictPolicy: "overwrite" });
  expect(parsed.success).toBe(false);
}

export function thePreviewPostIsExcluded(): void {
  expect(EXCLUDED_ROUTES.some((route) => route.method === "POST" && route.path === "/admin/telemetry/import/preview")).toBe(true);
}

export function theImageDeleteIsExcluded(): void {
  expect(EXCLUDED_ROUTES.some((route) => route.method === "DELETE" && route.path === "/assets/:assetId/images/:imageId")).toBe(true);
}

export function theImagePathEncodesTheAssetId(): void {
  expect(catalogPath(entry("assetImage.upload"), { assetId: ASSET })).toBe(`/api/v1/assets/${ASSET}/images`);
}

/** Q19: the two uploads keep the bytes in the browser (`kind: "file"`). */
export function theTwoUploadsAreFileKind(): void {
  expect([entry("telemetry.import").upload?.kind, entry("assetImage.upload").upload?.kind]).toEqual(["file", "file"]);
}
