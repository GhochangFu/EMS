import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const definitionsService = join(repoRoot, "apps/api/src/calc/calc-definitions.service.ts");

const BLOCK_COMMENT = new RegExp(["/", "\\*", "[\\s\\S]*?", "\\*", "/"].join(""), "g");
const LINE_COMMENT = /\/\/.*$/gm;

/** Same stripper `tests/adr-0037-calc-engine-invariants.test.ts` uses — the
 * docblock in this service explains the merge at length, and a scan that
 * counted its own explanation would pass on a file that deleted the code. */
function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");
}

const source = stripComments(readFileSync(definitionsService, "utf8"));

/**
 * ADR 0039 decision 6 (`F2.6`) — the resolution merge stays in the loader's
 * query.
 *
 * ## Why a source scan and not a behavioural test
 *
 * `calc-definitions.merge.integration.spec.ts` proves the merge *works*, and
 * it is the test that matters. This one exists because of a hole
 * `tests/adr-0037-calc-engine-invariants.test.ts` already documents: every
 * unit test in `apps/api/src/calc/` constructs `CalcDefinitionsService`'s
 * dependencies directly and never issues its SQL. Someone "simplifying"
 * `reload()` back to the template-only select it was before `F2.6` leaves the
 * entire unit suite green, and — because the integration suite skips without
 * `DATABASE_URL` — leaves a local run green too. The failure that follows is
 * not an error: every asset silently reverts to its template's formula,
 * trigger and interval, and the numbers keep flowing.
 *
 * That is the same class of regression the ADR 0037 invariants guard, and it
 * is guarded the same way.
 */
describe("ADR 0039 — the calc resolution merge stays in the query", () => {
  it("found the loader's source, so every scan below is not silently empty", () => {
    // AGENTS.md §4.4 — a scan over a file that moved passes by asserting
    // nothing. This is the anti-vacuity guard the ADR 0038 invariants set the
    // pattern for.
    expect(
      source.length,
      `${definitionsService} is empty or unreadable — this suite proves nothing`,
    ).toBeGreaterThan(500);
    expect(source, "the loader must still contain a reload() that selects rows").toContain(
      "templatePoints.kind",
    );
  });

  it("left-joins asset_points on both asset_id and point_key", () => {
    expect(
      source,
      "CalcDefinitionsService.reload() must LEFT JOIN asset_points — an inner join drops " +
        "every derived point with no asset_points row, which is the normal state because " +
        "instantiation emits none for a derived point (ADR 0039, F2.2 untouched)",
    ).toContain("leftJoin(");
    expect(source, "the join must reference assetPoints").toContain("assetPoints");

    // Both halves of the join condition. `point_key` alone would let one
    // asset's override leak to every asset built from the same template;
    // `asset_id` alone would attach an arbitrary point's row.
    expect(
      source,
      "the join condition must include assetPoints.assetId — without it an override " +
        "attaches to the wrong point",
    ).toContain("eq(assetPoints.assetId, assets.id)");
    expect(
      source,
      "the join condition must include assetPoints.pointKey — without it one asset's " +
        "override leaks to every asset on the same template version",
    ).toContain("eq(assetPoints.pointKey, templatePoints.pointKey)");
  });

  /**
   * All five, per column, asset first.
   *
   * Per *column* is the part no other check catches: coalescing the row as a
   * whole — "use the asset's values if it has any" — passes a single-column
   * test and blanks the other four inherited values. Asset first is the part
   * that silently inverts the feature: `coalesce(template, asset)` makes every
   * override inert while every test that only reads the template still passes.
   */
  const CALC_COLUMNS = [
    "formula",
    "formulaDialect",
    "calcTrigger",
    "calcIntervalSeconds",
    "maxInputAgeSeconds",
  ] as const;

  it.each(CALC_COLUMNS)("coalesces %s asset-first", (column) => {
    const expected = `coalesce(\${assetPoints.${column}}, \${templatePoints.${column}})`;
    expect(
      source,
      `calc-definitions.service.ts must select ${column} as ${expected}.\n\n` +
        "Five separate per-column coalesces, in that order, is the whole of ADR 0039 " +
        "decision 6. Coalescing the row instead makes one override erase four inherited " +
        "values; reversing the arguments makes every override inert. Neither throws — " +
        "both compute a wrong number and keep going.",
    ).toContain(expected);
  });

  it("never coalesces kind", () => {
    // An asset must not be able to turn a measured template point into a
    // derived one: `asset_points` for a measured point is physical wiring that
    // apps/ingest writes into, and a formula overwriting it would corrupt real
    // telemetry. The `not_derived` skip must keep firing on the template's own
    // value.
    expect(
      source,
      "kind must be selected straight from templatePoints, never coalesced with " +
        "assetPoints.kind — an asset cannot promote a measured point to derived",
    ).toContain("kind: templatePoints.kind");
    expect(source, "there is no assetPoints.kind to coalesce with").not.toContain(
      "assetPoints.kind",
    );
  });

  it("does not filter the joined row on active", () => {
    // D-2. `active` governs whether ingest writes through a telemetry mapping;
    // a calc override is configuration, not wiring. Filtering here would let
    // deactivating a mapping silently stop a formula.
    expect(
      source,
      "the asset_points join must not filter on active (D-2) — deactivating a telemetry " +
        "mapping must not silently stop a formula computing",
    ).not.toContain("assetPoints.active");
  });
});
