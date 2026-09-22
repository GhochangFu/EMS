import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { DashboardsService } from "./dashboards.service";

/**
 * `E4.2` U9 — `GET /dashboards?section=` (ADR 0072 decision 1).
 *
 * The *Sustainability* sidebar entry opens *"the newest dashboard stamped from a
 * template whose `section` is `sustainability`, whatever its scope"*. Nothing
 * could answer that: `bms.dashboards` records only `template_id`, and the
 * section lives on `bms.dashboard_templates`.
 *
 * Assertions live here; `dashboards-list-section.integration.test.ts` is the
 * Vitest entry point (ADR 0014) and owns the fixtures and cleanup.
 *
 * **Every case below runs as a SINGLE-ORGANIZATION actor, on the tenant
 * branch.** The join reads `bms.dashboard_templates` as `bms_tenant` under FORCE
 * RLS, which is the one thing about this unit that a fake db could not have
 * caught: a missing `SELECT` grant there would 500 every filtered list while the
 * fleet branch (`bms_fleet`, `BYPASSRLS`) stayed green. The grant and the
 * `tenant_isolation` policy were read from the dev database before the join was
 * written; this suite is what keeps them proven.
 */

export interface SectionListFixtures {
  /** Stamped from a template whose `section` is `sustainability`. */
  readonly sustainabilityDashboardId: string;
  /** Stamped from a template whose `section` is `electrical`. */
  readonly electricalDashboardId: string;
  /** Hand-built: `template_id IS NULL`. */
  readonly handBuiltDashboardId: string;
  /** Asset-scoped AND stamped from the sustainability template. */
  readonly assetScopedSustainabilityDashboardId: string;
  readonly assetId: string;
}

/**
 * **The unfiltered list still contains all three — the LEFT-join control.**
 *
 * The obvious implementation is an unconditional `innerJoin` on
 * `dashboard_templates`, and every hand-built dashboard has `template_id IS
 * NULL`: such a join would silently delete them from the list this endpoint
 * exists to return. This is the same trap the `assets` join in `list()` already
 * carries a comment about, and it fails in the direction nobody looks at,
 * because the filtered case would be perfectly correct.
 */
export async function assertUnfilteredListStillContainsAHandBuiltDashboard(
  service: DashboardsService,
  actor: JwtPayload,
  fixtures: SectionListFixtures,
): Promise<void> {
  const items = (await service.list(actor)).items.map((item) => item.id);
  expect(
    items,
    "a hand-built dashboard has no template row to join to. An unconditional inner join drops " +
      "every one of them, and the filtered case stays green while it happens.",
  ).toContain(fixtures.handBuiltDashboardId);
  expect(items, "control: the stamped ones are listed too").toContain(
    fixtures.sustainabilityDashboardId,
  );
}

/** `section=sustainability` returns the sustainability-stamped dashboard. */
export async function assertSectionFilterReturnsTheStampedDashboard(
  service: DashboardsService,
  actor: JwtPayload,
  fixtures: SectionListFixtures,
): Promise<void> {
  const items = (await service.list(actor, undefined, undefined, "sustainability")).items.map(
    (item) => item.id,
  );
  expect(items).toContain(fixtures.sustainabilityDashboardId);
}

/**
 * …and **only** it. The two negatives are the claim; they are asserted beside
 * the positive above rather than inside it, because a filter that returned
 * everything would satisfy "contains the sustainability one" without doing any
 * filtering at all.
 */
export async function assertSectionFilterExcludesOtherSectionsAndHandBuiltRows(
  service: DashboardsService,
  actor: JwtPayload,
  fixtures: SectionListFixtures,
): Promise<void> {
  const items = (await service.list(actor, undefined, undefined, "sustainability")).items.map(
    (item) => item.id,
  );
  expect(items, "a dashboard stamped from an `electrical` template is another section").not.toContain(
    fixtures.electricalDashboardId,
  );
  expect(
    items,
    "a hand-built dashboard belongs to no section — it must drop out under the filter, which is " +
      "exactly what the LEFT join plus the section predicate produces",
  ).not.toContain(fixtures.handBuiltDashboardId);
}

/** An unknown section code answers `[]`, never a 400 and never everything. */
export async function assertUnknownSectionAnswersEmpty(
  service: DashboardsService,
  actor: JwtPayload,
): Promise<void> {
  const result = await service.list(actor, undefined, undefined, "nope");
  expect(
    result.items.length,
    "`section` is an open vocabulary (ADR 0049 Amendment 2 decision 5), so an unknown code is a " +
      "filter that matches nothing rather than a refusal.",
  ).toBe(0);
}

/**
 * **`assetId` and `section` compose — they are ANDed, never ORed.**
 *
 * Both narrow within the read scope. The fixture is built so that an OR would be
 * visible: the asset-scoped dashboard is stamped from the SAME sustainability
 * template as the organization-wide one, so filtering by both must return the
 * asset-scoped one alone.
 */
export async function assertAssetIdAndSectionCompose(
  service: DashboardsService,
  actor: JwtPayload,
  fixtures: SectionListFixtures,
): Promise<void> {
  const items = (
    await service.list(actor, undefined, fixtures.assetId, "sustainability")
  ).items.map((item) => item.id);
  expect(items).toContain(fixtures.assetScopedSustainabilityDashboardId);
  expect(
    items,
    "the organization-wide sustainability dashboard is in the SAME section and must still drop " +
      "out under the asset filter — the two predicates are ANDed.",
  ).not.toContain(fixtures.sustainabilityDashboardId);
}
