import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `F3.28` (ADR 0074, owner ruling OQ1) — the class strip's offline bound is
 * stated once on each side of the wire, and the two agree.
 *
 * The API's `LIVE_TELEMETRY_MAX_AGE_SECONDS` (seconds) decides an asset's
 * `offlineCount` in `GET /assets/role-summary`; the web's `FRESH_MS`
 * (milliseconds, ADR 0027) decides when the schematic greys the same asset
 * out. Were they to drift, the strip would call an asset offline that the
 * diagram beside it still draws live. The two files live in different apps
 * with no shared import, so a source read is the only thing that can hold
 * them together.
 *
 * The second rule keeps the service honest: its SQL interval is built from the
 * constant, and a
 * restated `interval 'N seconds'` literal would silently decouple it from the
 * constant this file pins.
 */

const FRESHNESS = join(repoRoot, "apps/api/src/telemetry/telemetry-freshness.ts");
const WEB_TELEMETRY = join(repoRoot, "apps/web/src/lib/schematic-telemetry.ts");
const SERVICE = join(repoRoot, "apps/api/src/assets/asset-role-summary.service.ts");

function numericExport(file: string, name: string): number {
  const match = readFileSync(file, "utf8").match(
    new RegExp(`export const ${name}\\s*=\\s*([\\d_]+)\\s*;`),
  );
  expect(match, `${name} must be declared as a numeric literal in ${file}`).not.toBeNull();
  return Number((match?.[1] ?? "").replace(/_/g, ""));
}

describe("F3.28 — the offline bound has one source (ADR 0074, OQ1)", () => {
  it("LIVE_TELEMETRY_MAX_AGE_SECONDS × 1000 equals the web FRESH_MS", () => {
    const seconds = numericExport(FRESHNESS, "LIVE_TELEMETRY_MAX_AGE_SECONDS");
    const freshMs = numericExport(WEB_TELEMETRY, "FRESH_MS");
    expect(seconds * 1000).toBe(freshMs);
  });

  it("the role-summary service restates no interval 'N seconds' literal", () => {
    const source = readFileSync(SERVICE, "utf8");
    expect(source.match(/interval\s+'\d+\s+seconds?'/gi) ?? []).toEqual([]);
  });

  it("the role-summary service reads the constant (positive control)", () => {
    const source = readFileSync(SERVICE, "utf8");
    expect(source).toMatch(/interval '\$\{LIVE_TELEMETRY_MAX_AGE_SECONDS\} seconds'/);
  });

  it("the live CTE compares against the window built from the constant", () => {
    const source = readFileSync(SERVICE, "utf8");
    expect(source).toMatch(/pv\.time > now\(\) - \$\{LIVE_WINDOW\}/);
  });
});
