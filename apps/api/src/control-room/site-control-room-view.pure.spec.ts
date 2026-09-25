import { expect } from "vitest";

import {
  type DashboardScopeRow,
  type SiteViewRow,
  resolveSiteControlRoomView,
} from "./site-control-room-view.pure";

/**
 * `F3.67` — the pure half of the site Control Room view (plan U3, P1–P10; security review L1, P11–P12). The
 * database half is `site-control-room-view.integration.spec.ts`. Assertions
 * live here; `site-control-room-view.pure.test.ts` is the Vitest wrapper
 * (ADR 0014, AGENTS.md §4.6).
 */

const SITE = "11111111-1111-4111-8111-111111111111";
const OTHER_SITE = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const OTHER_ORG = "44444444-4444-4444-8444-444444444444";
const DASHBOARD = "55555555-5555-4555-8555-555555555555";
const SITE_GROUP = "66666666-6666-4666-8666-666666666666";
const ASSET = "77777777-7777-4777-8777-777777777777";

/** The site as the resolver takes it: its id and its organization. */
const SITE_AT_ORG = { locationId: SITE, organizationId: ORG } as const;

const NO_GROUPS: ReadonlySet<string> = new Set();
const KNOWN = ["smoc"] as const;

const dashboardRow: SiteViewRow = {
  organizationId: ORG,
  kind: "dashboard",
  dashboardId: DASHBOARD,
  builtinKey: null,
};

/** A dashboard in the site's organization with no scope column set; each case sets one. */
function dashboard(scope: Partial<DashboardScopeRow>): DashboardScopeRow {
  return {
    id: DASHBOARD,
    slug: "f367-site-view",
    organizationId: ORG,
    locationId: null,
    assetGroupId: null,
    assetId: null,
    ...scope,
  };
}

/** P1 — no row is the generated view, and carries no notice. */
export function assertNoRowIsGeneratedWithoutNotice(): void {
  expect(resolveSiteControlRoomView(SITE_AT_ORG, null, null, NO_GROUPS, KNOWN)).toEqual({
    locationId: SITE,
    kind: "generated",
    dashboardId: null,
    dashboardSlug: null,
    builtinKey: null,
    notice: null,
  });
}

/** P2 — an explicit `generated` row answers the same as no row. */
export function assertGeneratedRowIsGenerated(): void {
  const row: SiteViewRow = { organizationId: ORG, kind: "generated", dashboardId: null, builtinKey: null };
  expect(resolveSiteControlRoomView(SITE_AT_ORG, row, null, NO_GROUPS, KNOWN)).toEqual({
    locationId: SITE,
    kind: "generated",
    dashboardId: null,
    dashboardSlug: null,
    builtinKey: null,
    notice: null,
  });
}

/** P3 — a dashboard scoped to the site itself is the view, with its slug. */
export function assertSiteScopedDashboardIsTheView(): void {
  expect(
    resolveSiteControlRoomView(SITE_AT_ORG, dashboardRow, dashboard({ locationId: SITE }), NO_GROUPS, KNOWN),
  ).toEqual({
    locationId: SITE,
    kind: "dashboard",
    dashboardId: DASHBOARD,
    dashboardSlug: "f367-site-view",
    builtinKey: null,
    notice: null,
  });
}

/** P4 — a dashboard scoped to one of the site's asset groups is the view. */
export function assertGroupScopedDashboardIsTheView(): void {
  const resolved = resolveSiteControlRoomView(
    SITE_AT_ORG,
    dashboardRow,
    dashboard({ assetGroupId: SITE_GROUP }),
    new Set([SITE_GROUP]),
    KNOWN,
  );
  expect(resolved.kind).toBe("dashboard");
  expect(resolved.notice).toBeNull();
}

/** P5 — the chosen dashboard is gone: the generated view, with `dashboard_removed`. */
export function assertRemovedDashboardFailsSafe(): void {
  const removed: SiteViewRow = { ...dashboardRow, dashboardId: null };
  expect(resolveSiteControlRoomView(SITE_AT_ORG, removed, null, NO_GROUPS, KNOWN)).toEqual({
    locationId: SITE,
    kind: "generated",
    dashboardId: null,
    dashboardSlug: null,
    builtinKey: null,
    notice: "dashboard_removed",
  });
}

/** P6 — re-scoped to another site: `dashboard_out_of_scope`, not `dashboard_removed`. */
export function assertRescopedDashboardIsOutOfScope(): void {
  const resolved = resolveSiteControlRoomView(
    SITE_AT_ORG,
    dashboardRow,
    dashboard({ locationId: OTHER_SITE }),
    NO_GROUPS,
    KNOWN,
  );
  expect(resolved.kind).toBe("generated");
  expect(resolved.notice).toBe("dashboard_out_of_scope");
}

/**
 * P7 — a dashboard in another organization is out of scope. Its `locationId`
 * IS the site, so the scope branch alone would admit it: only the organization
 * comparison can refuse it.
 */
export function assertOtherOrganizationDashboardIsOutOfScope(): void {
  const resolved = resolveSiteControlRoomView(
    SITE_AT_ORG,
    dashboardRow,
    dashboard({ organizationId: OTHER_ORG, locationId: SITE }),
    NO_GROUPS,
    KNOWN,
  );
  expect(resolved.kind).toBe("generated");
  expect(resolved.notice).toBe("dashboard_out_of_scope");
}

/**
 * P8 (plan D6) — an asset-scoped dashboard is never eligible, even for an
 * asset at this site. The fixture is the shape the database allows
 * (`dashboards_scope_check`: one scope column at most), so this pins the
 * refusal against a resolver that grows an asset branch.
 */
export function assertAssetScopedDashboardIsOutOfScope(): void {
  const resolved = resolveSiteControlRoomView(
    SITE_AT_ORG,
    dashboardRow,
    dashboard({ assetId: ASSET }),
    new Set([SITE_GROUP]),
    KNOWN,
  );
  expect(resolved.kind).toBe("generated");
  expect(resolved.notice).toBe("dashboard_out_of_scope");
}

const builtinRow: SiteViewRow = { organizationId: ORG, kind: "builtin", dashboardId: null, builtinKey: "smoc" };

/** P9 — a known built-in key is the view. */
export function assertKnownBuiltinIsTheView(): void {
  expect(resolveSiteControlRoomView(SITE_AT_ORG, builtinRow, null, NO_GROUPS, KNOWN)).toEqual({
    locationId: SITE,
    kind: "builtin",
    dashboardId: null,
    dashboardSlug: null,
    builtinKey: "smoc",
    notice: null,
  });
}

/** P10 — a key this build does not ship: the generated view, with `builtin_unknown`. */
export function assertUnknownBuiltinFailsSafe(): void {
  expect(resolveSiteControlRoomView(SITE_AT_ORG, builtinRow, null, NO_GROUPS, [])).toEqual({
    locationId: SITE,
    kind: "generated",
    dashboardId: null,
    dashboardSlug: null,
    builtinKey: null,
    notice: "builtin_unknown",
  });
}

/**
 * P11 (security review L1) — a stored row stamped with another organization
 * than the site's is out of scope, even though the dashboard itself sits in the
 * site's organization and on the site. Only the row-versus-site comparison can
 * refuse it.
 */
export function assertRowFromAnotherOrganizationIsOutOfScope(): void {
  const resolved = resolveSiteControlRoomView(
    SITE_AT_ORG,
    { ...dashboardRow, organizationId: OTHER_ORG },
    dashboard({ locationId: SITE }),
    NO_GROUPS,
    KNOWN,
  );
  expect(resolved.kind).toBe("generated");
  expect(resolved.notice).toBe("dashboard_out_of_scope");
}

/**
 * P12 (security review L1) — the row and the dashboard agree on an
 * organization, but it is not the site's. A resolver that compares the two with
 * each other (and never with the site) admits it.
 */
export function assertRowAndDashboardFromAnotherOrganizationAreOutOfScope(): void {
  const resolved = resolveSiteControlRoomView(
    SITE_AT_ORG,
    { ...dashboardRow, organizationId: OTHER_ORG },
    dashboard({ organizationId: OTHER_ORG, locationId: SITE }),
    NO_GROUPS,
    KNOWN,
  );
  expect(resolved.kind).toBe("generated");
  expect(resolved.notice).toBe("dashboard_out_of_scope");
}
