import { expect } from "vitest";

import type {
  DashboardTemplateDto,
  InstantiateSectionTemplateResponse,
} from "@bms/shared";

/**
 * `F3.45` — a rebound STOCK binding resolves `bound` against a real member and
 * a real point. ADR 0040 decision 2 (the `E5.1` unit-suffix vocabulary) as
 * applied to `stock-catalog.ts`.
 *
 * Assertions live here; `dashboard-templates-instantiate-stock.integration.test.ts`
 * is the Vitest entry point (ADR 0014) and owns the fixture and cleanup.
 *
 * **Why a second pair beside `F3.36`'s.** That suite instantiates hand-written
 * content whose `kW` / `kVA` codes it inserts itself, so it proves the
 * resolver and nothing about the shipped catalog. The `f3.38` text scan proves
 * a catalog key *exists* in a `*_POINT_KEYS` array; only instantiation proves
 * the binding *resolves*. Before `F3.45` the `stp-overview` aeration widgets
 * bound `dissolved_oxygen`, a key in no vocabulary, and the resolver's
 * exact-match lookup could never find it — every organization saw `partial`
 * or `unresolved` and no test went red.
 *
 * **One claim per `it()`.** `expect` throws, so only the first failing claim
 * in a function reddens; each function here carries one so the mutation in
 * the plan (step 5) names the assertion it kills.
 *
 * **The fixture is a v1 plant: one asset, one membership, role `aeration`.**
 * ADR 0040 ruling 5 makes a plant one asset and migration `0010`'s UNIQUE
 * (group, asset) index makes that one asset hold one role per group, so the
 * `inlet-screen` widget of the same entry reports `unresolved` by
 * construction. That is the consequence the catalog docblock records; the
 * fourth assertion gates it, with the two `bound` claims from the same
 * instantiation as its positive control.
 */

type Resolution = InstantiateSectionTemplateResponse["resolutions"][number];

/**
 * The `stp-overview` widget keys, from `stock-catalog.ts`'s entry: three
 * catalog tiles, two role tiles, one role chart, one catalog table. Counted
 * from the source, not copied from the plan. Two of the seven share the title
 * "Active Alarms", so the title is NOT a unique join on this entry — the row
 * assertion below uses "Aeration DO" with exact equality, never `includes`
 * (which would also match "Aeration DO Trend").
 */
export const STP_OVERVIEW_WIDGET_COUNT = 7;
export const AERATION_TILE_TITLE = "Aeration DO";

const resolutionFor = (
  response: InstantiateSectionTemplateResponse,
  widgetKey: string,
): Resolution => {
  const found = response.resolutions.find((entry) => entry.widgetKey === widgetKey);
  if (!found) {
    throw new Error(
      `no resolution reported for widget "${widgetKey}". Amendment 2 decision 1: instantiation ` +
        "returns a per-widget report and never a silent success — a missing entry is the defect.",
    );
  }
  return found;
};

const outcomeFields = (
  entry: Resolution,
): Pick<Resolution, "matchedMembers" | "boundPoints" | "outcome"> => ({
  matchedMembers: entry.matchedMembers,
  boundPoints: entry.boundPoints,
  outcome: entry.outcome,
});

/**
 * Anti-vacuity for the three outcome assertions: every `stp-overview` widget
 * is in the report. Stays green under every binding mutation — it gates the
 * shape of the report, not the binding.
 */
export function assertEveryWidgetReported(response: InstantiateSectionTemplateResponse): void {
  expect(
    response.resolutions.length,
    "one resolution entry per stp-overview widget — Amendment 2 decision 1",
  ).toBe(STP_OVERVIEW_WIDGET_COUNT);
}

/** The rebound `aeration-tile` (`aeration` / `aeration_do_mgl`, cap 1). */
export function assertAerationTileIsBound(response: InstantiateSectionTemplateResponse): void {
  expect(
    outcomeFields(resolutionFor(response, "aeration-tile")),
    "one aeration member carrying one aeration_do_mgl point resolves the tile `bound`. " +
      "`partial` here means the member matched and the key did not — the pre-F3.45 defect, " +
      "when the catalog bound `dissolved_oxygen`, a key no asset can carry.",
  ).toEqual({ matchedMembers: 1, boundPoints: 1, outcome: "bound" });
}

/** The rebound `aeration-chart` (`aeration` / `aeration_do_mgl`, cap 8). */
export function assertAerationChartIsBound(response: InstantiateSectionTemplateResponse): void {
  expect(
    outcomeFields(resolutionFor(response, "aeration-chart")),
    "the chart binds the same role and key with a cap of eight; one member is one point, " +
      "nothing truncated, nothing short.",
  ).toEqual({ matchedMembers: 1, boundPoints: 1, outcome: "bound" });
}

/**
 * The recorded v1 consequence: the plant holds `aeration`, so the entry's
 * OTHER role matches nothing and reports `unresolved` — never silent, and the
 * instantiate still succeeds (ADR 0049 decision 6).
 */
export function assertInletScreenIsTheRecordedV1Consequence(
  response: InstantiateSectionTemplateResponse,
): void {
  expect(
    outcomeFields(resolutionFor(response, "inlet-screen-tile")),
    "a v1 plant is one asset with one role per group (ADR 0040 ruling 5, migration 0010's " +
      "UNIQUE (group, asset)); the entry's other role matches no member and reports `unresolved`.",
  ).toEqual({ matchedMembers: 0, boundPoints: 0, outcome: "unresolved" });
}

/**
 * The ROW, not only the report. The report is computed from the plan before
 * the insert (`F3.36` review); the written widget must carry exactly one point
 * and it must belong to the fixture asset.
 */
export function assertAerationTileRowWasWritten(
  response: InstantiateSectionTemplateResponse,
  fixtureAssetId: string,
): void {
  const written = response.dashboard.widgets.find((w) => w.title === AERATION_TILE_TITLE);
  expect(
    written?.points.map((p) => p.assetId),
    `the widget titled "${AERATION_TILE_TITLE}" must come back with exactly one point row, ` +
      "and that row must belong to the fixture's aeration asset — the report says `bound`; " +
      "this is the insert that has to agree with it.",
  ).toEqual([fixtureAssetId]);
}

/**
 * `sustainability-overview`'s widget count, counted from the catalog entry
 * (6 + 6 + 5 + 2). **19 since `E4.3` PR 2 (U10)** — the stock template gained
 * `water-balance-by-site-table` alongside the existing benchmark table.
 */
export const SUSTAINABILITY_WIDGET_COUNT = 19;

/**
 * `E4.2` U3 — the shipped `sustainability-overview` content SURVIVED
 * `DashboardTemplatesService.publish`.
 *
 * That is the whole claim, and it is not a tautology: `publish` runs
 * `assertSourceParamsPointKeysActive` over every source, so a status of
 * `published` here means each of the fifteen `params.pointKey` values in the
 * entry matched an ACTIVE row of `bms.point_keys` on the fleet pool. A code
 * the seed does not carry — a typo, a rename, a key added to the catalog and
 * forgotten in `point-keys-seed.ts` — makes `publish` throw a 400 naming it,
 * and `beforeAll` fails rather than this assertion; either way the suite
 * reddens, which is what the unit claims cannot do.
 */
export function assertSustainabilityOverviewPublished(template: DashboardTemplateDto): void {
  expect(
    { status: template.status, section: template.section },
    "the shipped sustainability-overview content must publish against the seeded point-key " +
      "catalog — a `Not in the active point-key catalog` 400 out of publish means a pointKey " +
      "in stock-catalog.ts names a code bms.point_keys does not hold, or holds inactive.",
  ).toEqual({ status: "published", section: "sustainability" });
}

/**
 * `E4.2` U8b / ADR 0072 decision 1 — a role-free section template instantiates
 * with every scope column `NULL`.
 *
 * The negative half matters as much as the positive: an `assetGroupId` that
 * came back set would mean the group arm ran, and the group arm is the one
 * this entry cannot take.
 */
export function assertSustainabilityInstantiatedOrganizationWide(
  response: InstantiateSectionTemplateResponse,
): void {
  expect(
    {
      assetGroupId: response.dashboard.assetGroupId,
      assetId: response.dashboard.assetId,
      locationId: response.dashboard.locationId,
    },
    "a template with zero role bindings instantiates organization-wide: no location, no asset " +
      "group and no asset (ADR 0072 decision 1).",
  ).toEqual({ assetGroupId: null, assetId: null, locationId: null });
}

/**
 * Every one of the nineteen widgets is reported, and every one of them is
 * `bound`.
 *
 * A widget with no bindings is `bound` by construction, so this is the shape
 * claim rather than a resolution one — but it is the control that stops the two
 * assertions above from passing over a report with one widget in it, and it
 * fails loudly if the organization-wide arm ever starts reporting `unresolved`
 * for a catalog-only tile.
 */
export function assertSustainabilityWidgetsAllResolve(
  response: InstantiateSectionTemplateResponse,
): void {
  expect(
    {
      count: response.resolutions.length,
      outcomes: [...new Set(response.resolutions.map((entry) => entry.outcome))].sort(),
    },
    "one resolution entry per sustainability-overview widget (Amendment 2 decision 1), and " +
      "every one `bound` — the entry binds no role, so nothing can be partial or unresolved.",
  ).toEqual({ count: SUSTAINABILITY_WIDGET_COUNT, outcomes: ["bound"] });
}
