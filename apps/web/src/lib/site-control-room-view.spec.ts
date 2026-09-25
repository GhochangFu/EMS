import { isEligibleSiteViewDashboard } from "./site-control-room-view";

/**
 * `F3.67` U5 / plan D6 — which dashboards the location admin page offers as a
 * site's Control Room view. One exported function per claim, so a mutation
 * reddens exactly one `it()`; `site-control-room-view.test.ts` is the Vitest
 * entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const SITE = "11111111-1111-1111-1111-111111111111";
const OTHER_SITE = "22222222-2222-2222-2222-222222222222";
const SITE_GROUP = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_GROUP = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ASSET = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const SITE_GROUPS: ReadonlySet<string> = new Set([SITE_GROUP]);

/** L1 — a dashboard scoped to the site is offered; one scoped to another site is not.
 * Mutation: drop the location branch ⇒ red. */
export function aSiteScopedDashboardIsEligible(): void {
  assert(
    isEligibleSiteViewDashboard({ locationId: SITE, assetGroupId: null, assetId: null }, SITE, SITE_GROUPS),
    "a dashboard scoped to the site must be eligible",
  );
  assert(
    !isEligibleSiteViewDashboard({ locationId: OTHER_SITE, assetGroupId: null, assetId: null }, SITE, SITE_GROUPS),
    "a dashboard scoped to another site must not be eligible",
  );
}

/** L2 — a dashboard scoped to one of the site's asset groups is offered; one scoped to a
 * group of another site is not. Mutation: drop the group branch ⇒ red. */
export function aSiteGroupScopedDashboardIsEligible(): void {
  assert(
    isEligibleSiteViewDashboard({ locationId: null, assetGroupId: SITE_GROUP, assetId: null }, SITE, SITE_GROUPS),
    "a dashboard scoped to one of the site's groups must be eligible",
  );
  assert(
    !isEligibleSiteViewDashboard({ locationId: null, assetGroupId: OTHER_GROUP, assetId: null }, SITE, SITE_GROUPS),
    "a dashboard scoped to another site's group must not be eligible",
  );
}

/** L3 — an asset-scoped dashboard is never offered (D6), even in a shape that names the
 * site's own column: the predicate fails closed rather than lean on `dashboards_scope_check`.
 * Positive control beside it: the same row without `assetId` is eligible.
 * Mutation: drop the `assetId` guard ⇒ red. */
export function anAssetScopedDashboardIsNotEligible(): void {
  assert(
    !isEligibleSiteViewDashboard({ locationId: null, assetGroupId: null, assetId: ASSET }, SITE, SITE_GROUPS),
    "an asset-scoped dashboard must not be eligible",
  );
  assert(
    !isEligibleSiteViewDashboard({ locationId: SITE, assetGroupId: null, assetId: ASSET }, SITE, SITE_GROUPS),
    "an asset-scoped dashboard must not be eligible even when it names the site",
  );
  assert(
    isEligibleSiteViewDashboard({ locationId: SITE, assetGroupId: null, assetId: null }, SITE, SITE_GROUPS),
    "positive control: the same row without assetId is eligible",
  );
}
