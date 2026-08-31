import { expect } from "vitest";

import {
  RULED_POINT_CATALOG_SQL,
  UNCATALOGUED_RULED_POINTS_SQL,
} from "./ruled-point-catalog-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * The clauses that decide which rules earn a catalog row.
 *
 * They are listed here rather than imported so that this file is a second
 * statement of the rule and not an echo of it: exporting the predicate and
 * asserting the export contains itself would pass on any string.
 */
const PREDICATE_CLAUSES = [
  "r.organization_id = $1",
  "r.rule_type = 'threshold'",
  "r.enabled = true",
  "r.lifecycle_status = 'published'",
  "r.asset_id IS NOT NULL",
  "r.point_key IS NOT NULL",
];

/**
 * The insert and its post-condition must select the same rules.
 *
 * If they drift, the seed inserts for one set and proves the other, and reports
 * a success it has not established — the failure mode the post-condition exists
 * to prevent, reintroduced one statement over.
 */
export function assertBothStatementsSelectTheSameRules(): void {
  for (const clause of PREDICATE_CLAUSES) {
    expect(RULED_POINT_CATALOG_SQL).toContain(clause);
    expect(UNCATALOGUED_RULED_POINTS_SQL).toContain(clause);
  }
}

/**
 * `asset_points_source_ref_check` (migration `0023`) admits `unmapped` only
 * with a NULL `rtu_id`, and `measured` only with a non-NULL one.
 *
 * This is the pairing `AssetPointsService.create` writes for a point with no
 * gateway. `manual` would also satisfy the CHECK and would be wrong in a way an
 * operator can see: it marks a hand-entered reading, and the simulator writes
 * these.
 */
export function assertPointsAreUnmappedWithNoGateway(): void {
  expect(RULED_POINT_CATALOG_SQL).toContain("'unmapped'");
  expect(RULED_POINT_CATALOG_SQL).not.toContain("'manual'");
  expect(RULED_POINT_CATALOG_SQL).not.toContain("'measured'");
  // The NULL sits in the `rtu_id` position of the column list above it.
  expect(RULED_POINT_CATALOG_SQL).toContain("rtu_id, source_kind");
  expect(RULED_POINT_CATALOG_SQL).toContain("  NULL,\n  'unmapped',");
}

/**
 * A re-seed must not fail and must not overwrite a row an operator edited.
 *
 * `DO NOTHING` rather than `DO UPDATE` for the second reason: this module owns
 * the row's existence, never its contents.
 */
export function assertReSeedingIsIdempotentAndNeverOverwrites(): void {
  expect(RULED_POINT_CATALOG_SQL).toContain("ON CONFLICT (asset_id, point_key) DO NOTHING");
  expect(RULED_POINT_CATALOG_SQL).not.toContain("DO UPDATE");
}

/**
 * The insert is bounded to one organization, and the row it writes carries that
 * organization rather than one derived from the joined asset.
 *
 * Not a style point. `verify-hierarchy-seed.ts` asserts `PHE asset_points` is
 * exactly 252, so a single PHE rule reached by an unbounded statement turns the
 * hierarchy verify red — and it would do so in the seed step that runs after
 * this one, where the cause is furthest from the effect.
 */
export function assertTheInsertCannotReachAnotherOrganization(): void {
  expect(RULED_POINT_CATALOG_SQL).toContain("r.organization_id = $1");
  expect(RULED_POINT_CATALOG_SQL).toContain("$1::uuid,");
}
