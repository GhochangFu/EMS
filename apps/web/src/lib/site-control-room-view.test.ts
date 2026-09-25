import { describe, it } from "vitest";

import {
  aSiteGroupScopedDashboardIsEligible,
  aSiteScopedDashboardIsEligible,
  anAssetScopedDashboardIsNotEligible,
} from "./site-control-room-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.67 site Control Room view — dashboard eligibility (plan D6)", () => {
  it("L1 offers a site-scoped dashboard, not another site's", () => {
    aSiteScopedDashboardIsEligible();
  });

  it("L2 offers a dashboard scoped to one of the site's groups, not another site's group", () => {
    aSiteGroupScopedDashboardIsEligible();
  });

  it("L3 never offers an asset-scoped dashboard", () => {
    anAssetScopedDashboardIsNotEligible();
  });
});
