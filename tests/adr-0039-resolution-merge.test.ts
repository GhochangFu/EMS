import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const definitionsService = join(repoRoot, "apps/api/src/calc/calc-definitions.service.ts");
const migrateService = join(
  repoRoot,
  "apps/api/src/admin/asset-templates/asset-templates-migrate.service.ts",
);

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

    // The calc columns belong only to a `computed` row. `AssetPointsAdminService
    // .create` resolves a point key against the `point_keys` catalog alone and
    // has no template awareness, so an operator can map a `measured`/`unmapped`
    // row onto a key the pinned version declares `derived`. Such a row carries
    // NULL across all five columns today, so dropping this filter still gives
    // the same answer — which is exactly why nothing else catches its removal.
    expect(
      source,
      "the join condition must include assetPoints.sourceKind === 'computed' — a row that " +
        "is not computed is telemetry wiring, and resolving a formula out of it is the " +
        "wrong-number-quietly failure ADR 0039 exists to prevent",
    ).toContain('eq(assetPoints.sourceKind, "computed")');
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

/**
 * ADR 0039 decision 5 — "no backfill, and no marker on history".
 *
 * A migrated asset computes the new formula from the moment it migrates; values
 * already stored under the old formula stay exactly as they are. The ADR
 * records the resulting mid-series formula change as an **accepted** reporting
 * hazard rather than a solved one, and this is the guard against someone
 * later deciding to "fix" it.
 *
 * Asserted in source rather than only behaviourally because the honest
 * behavioural test would write into `telemetry.point_values` — a hypertable
 * feeding continuous aggregates, which AGENTS.md §4.4 records cannot be cleaned
 * up by deleting the raw row. `asset-templates.migrate.integration.spec.ts`
 * asserts the global row count is unchanged by an apply, which is the same
 * claim without the write; this catches the case that suite cannot, since it
 * skips without `DATABASE_URL`.
 */
describe("ADR 0039 decision 5 — a migration never touches history", () => {
  const migrateSource = stripComments(readFileSync(migrateService, "utf8"));

  it("found the migration service, so the scans below are not silently empty", () => {
    expect(
      migrateSource.length,
      `${migrateService} is empty or unreadable — this suite proves nothing`,
    ).toBeGreaterThan(500);
    expect(migrateSource, "the service must still update the pin it exists to move").toContain(
      "assets.templateId",
    );
  });

  it("writes to no telemetry table and refreshes no aggregate", () => {
    for (const forbidden of [
      "pointValues",
      "point_values",
      "refreshAggregatesFrom",
      "TelemetryWriteService",
    ]) {
      expect(
        migrateSource,
        `asset-templates-migrate.service.ts must never reference ${forbidden}. ADR 0039 ` +
          "decision 5 accepts a series whose formula changed midway as a reporting hazard " +
          "rather than backfilling or marking it, and a migration that quietly rewrote " +
          "stored values would be unrecoverable.",
      ).not.toContain(forbidden);
    }
  });
});
