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

/**
 * The argument count of every `name(` call in `source` (top-level commas, a trailing one
 * ignored). Brackets nest; string and template literals are skipped so a comma inside one
 * does not count.
 */
function callArities(source: string, name: string): number[] {
  const arities: number[] = [];
  const call = new RegExp(`\\b${name}\\s*\\(`, "g");
  for (let match = call.exec(source); match !== null; match = call.exec(source)) {
    let depth = 1;
    let commas = 0;
    let sawArgument = false;
    let lastNonSpace = "(";
    for (let i = match.index + match[0].length; i < source.length; i += 1) {
      const ch = source[i] as string;
      if (ch === '"' || ch === "'" || ch === "`") {
        for (i += 1; i < source.length && source[i] !== ch; i += 1) {
          if (source[i] === "\\") i += 1;
        }
        sawArgument = true;
        lastNonSpace = ch;
        continue;
      }
      if ("([{".includes(ch)) depth += 1;
      else if (")]}".includes(ch)) depth -= 1;
      if (depth === 0) break;
      if (depth === 1 && ch === ",") commas += 1;
      if (!/\s/.test(ch)) {
        sawArgument = true;
        lastNonSpace = ch;
      }
    }
    arities.push(sawArgument ? commas + (lastNonSpace === "," ? 0 : 1) : 0);
  }
  return arities;
}

describe("F4.388 — the PHE split list is source", () => {
  it("names Lotapata only in release B (release C changes this assertion with the list)", () => {
    expect(PHE_SPLIT_STATION_CODES).toEqual(["CBLTPT1"]);
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

  // `seedPhewbSiteLayouts` takes the split list as its fifth positional argument (after the
  // catalog and the logger), so the `splitStationCodes` scan above cannot see it passed there.
  it("never passes seedPhewbSiteLayouts a fifth (split-list) argument from seed.ts", () => {
    const arities = callArities(tsOnly(read("packages/db/src/seed.ts")), "seedPhewbSiteLayouts");
    expect(arities.length, "seed.ts must call seedPhewbSiteLayouts").toBeGreaterThan(0);
    for (const arity of arities) {
      expect(arity, "seed.ts must leave the split list to PHE_SPLIT_STATION_CODES").toBeLessThanOrEqual(4);
    }
  });

  it("counts a call's arguments past nested brackets, strings and a trailing comma", () => {
    expect(callArities("f(a, g(b, c), [d, e], { x: 1, y: 2 }, 'p,q')", "f")).toEqual([5]);
    expect(callArities("f(\n  a,\n  b,\n)", "f")).toEqual([2]);
    expect(callArities("f()", "f")).toEqual([0]);
    const mutated = 'seedPhewbSiteLayouts(pool, org, cat, undefined, ["CBLTPT1"])';
    expect(callArities(mutated, "seedPhewbSiteLayouts")).toEqual([5]);
  });
});
