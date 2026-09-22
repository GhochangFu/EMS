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
  /**
   * **The mis-stamped row — a dashboard of organization A whose `template_id`
   * points at organization B's `sustainability` template.**
   *
   * It is physically possible: `dashboards.template_id` is a foreign key onto
   * `dashboard_templates.id` and nothing in the column pair says the two rows
   * must share an organization. On the TENANT branch RLS hides the foreign
   * template and the join finds nothing; on the FLEET branch `bms_fleet` holds
   * `BYPASSRLS`, so the organization predicate INSIDE the join is the only
   * container there is.
   */
  readonly misStampedDashboardId: string;
  /** The organization the mis-stamped row's template belongs to (not the dashboard's). */
  readonly templateOwnerOrganizationId: string;
  /** The organization the mis-stamped row itself belongs to. */
  readonly dashboardOrganizationId: string;
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

/* ---------------------------------------------------------------------------
 * The FLEET branch. `E4.2` PR 2 security review.
 *
 * Every case above runs as `wc-admin`, a single-organization actor, so the join
 * only ever executed as `bms_tenant` under FORCE RLS — where the tenant policy
 * would hide a foreign template even if the join had no organization predicate
 * of its own. The three cases below run as a GLOBAL admin, whose
 * `readableOrganizationIds` is `null`: `withOrganizationReadScope` takes the
 * fleet branch, the query runs as `bms_fleet` (`BYPASSRLS`) and there is no
 * `organizationIdFilter` either. On that branch
 * `eq(dashboardTemplates.organizationId, dashboards.organizationId)` is the
 * whole of the containment, and nothing was asking it to hold.
 * ------------------------------------------------------------------------- */

/**
 * The positive control for the two refusals below, and it is not optional: an
 * implementation that returned nothing at all on the fleet branch would satisfy
 * both "not returned" claims for free.
 */
export async function assertFleetBranchStillReturnsACorrectlyStampedDashboard(
  service: DashboardsService,
  fleetActor: JwtPayload,
  fixtures: SectionListFixtures,
): Promise<void> {
  const items = (await service.list(fleetActor, undefined, undefined, "sustainability")).items.map(
    (item) => item.id,
  );
  expect(
    items,
    "the fleet branch must still answer the section filter — a dashboard stamped from its OWN " +
      "organization's sustainability template is returned.",
  ).toContain(fixtures.sustainabilityDashboardId);
}

/**
 * **The claim.** Filtered to the mis-stamped dashboard's OWN organization, it is
 * still absent: its `template_id` names a template of another organization, and
 * the section of a foreign template is not this dashboard's section.
 *
 * Without the organization predicate in the join this row comes back — the
 * dashboard's own organization matches the filter and the foreign template's
 * `section` matches the filter, so the read admits it under a section it was
 * never stamped into.
 */
export async function assertFleetBranchExcludesAMisStampedRowFromItsOwnOrganization(
  service: DashboardsService,
  fleetActor: JwtPayload,
  fixtures: SectionListFixtures,
): Promise<void> {
  const items = (
    await service.list(fleetActor, fixtures.dashboardOrganizationId, undefined, "sustainability")
  ).items.map((item) => item.id);
  expect(
    items,
    "a dashboard whose template_id points at ANOTHER organization's sustainability template is " +
      "not in the sustainability section. On the fleet branch the organization predicate inside " +
      "the join is the only thing that says so — BYPASSRLS means the tenant policy says nothing.",
  ).not.toContain(fixtures.misStampedDashboardId);
}

/** …and it is not admitted under the TEMPLATE owner's organization either — the
 * row belongs to the other organization, and a join is not a change of owner. */
export async function assertFleetBranchExcludesAMisStampedRowFromTheTemplateOwner(
  service: DashboardsService,
  fleetActor: JwtPayload,
  fixtures: SectionListFixtures,
): Promise<void> {
  const items = (
    await service.list(
      fleetActor,
      fixtures.templateOwnerOrganizationId,
      undefined,
      "sustainability",
    )
  ).items.map((item) => item.id);
  expect(
    items,
    "the mis-stamped dashboard belongs to the OTHER organization; matching a template here must " +
      "not pull the row into this organization's section list.",
  ).not.toContain(fixtures.misStampedDashboardId);
}
