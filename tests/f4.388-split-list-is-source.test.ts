import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadPheCatalog } from "../packages/db/src/phe-pilot-seed.js";
import { PHE_SPLIT_STATION_CODES } from "../packages/db/src/phe-split-stations.js";

/**
 * `F4.388` (ADR 0139 decision 1, plan D1/D2) — the split list is source, and
 * production reads only the committed constant.
 *
 * Production has two entry points that reach the PHE seed or its gate:
 * `seed.ts` `main` and `verify-hierarchy-cli.ts`. Neither may pass a list or a
 * catalog, so the only list a deployed seed reads is `PHE_SPLIT_STATION_CODES`;
 * a test reaches the split path through the injected parameter instead. The
 * scans run on comment-stripped source, so docblock prose that names a
 * parameter cannot satisfy or trip them.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/** The `tests/f3.68-generated-site-view.test.ts` stripper (block, then line comments). */
const BLOCK_COMMENT = new RegExp(["/", "\\*", "[\\s\\S]*?", "\\*", "/"].join(""), "g");
const LINE_COMMENT = /\/\/.*$/gm;
const tsOnly = (source: string): string => source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");

describe("F4.388 — the PHE split list is source", () => {
  it("is empty in release A (releases B and C change this assertion with the list)", () => {
    expect(PHE_SPLIT_STATION_CODES).toEqual([]);
  });

  it("names only catalog station codes, once each", () => {
    const stationCodes = new Set(loadPheCatalog().rows.map((row) => row.StationCode));
    for (const code of PHE_SPLIT_STATION_CODES) {
      expect(stationCodes.has(code), `${code} is not a catalog StationCode`).toBe(true);
    }
    expect(new Set(PHE_SPLIT_STATION_CODES).size).toBe(PHE_SPLIT_STATION_CODES.length);
  });

  it("imports nothing and reads no environment", () => {
    const source = tsOnly(read("packages/db/src/phe-split-stations.ts"));
    expect(source).not.toMatch(/\bimport\b/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toContain("process.env");
    expect(source).toContain("export const PHE_SPLIT_STATION_CODES");
  });

  it("is never overridden by a production entry point", () => {
    for (const rel of ["packages/db/src/seed.ts", "packages/db/src/verify-hierarchy-cli.ts"]) {
      const source = tsOnly(read(rel));
      expect(source, `${rel} must not pass a split list`).not.toContain("splitStationCodes");
      expect(source, `${rel} must not pass a catalog`).not.toMatch(/\bcatalog\s*:/);
    }
  });
});
