import { describe, it } from "vitest";

import {
  theOrganizationArmIsInjectedByItsToken,
  theOrganizationArmIsOptional,
  theSiteArmIsInjectedByItsToken,
  theSiteArmIsOptional,
} from "./dashboard-templates-instantiate.wiring.spec";

/** `F3.73` plan Task 2.2 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014). One `it()` per claim. */
describe("F3.73 — the instantiate service's site-arm seam", () => {
  it("injects the site arm by the SITE_TEMPLATE_ARM token", () => {
    theSiteArmIsInjectedByItsToken();
  });

  it("marks the site arm optional, so the module boots before PR4 provides it", () => {
    theSiteArmIsOptional();
  });
});

/** `F4.317` task 3.4 — the organization arm's seam, the same shape. */
describe("F4.317 — the instantiate service's organization-arm seam", () => {
  it("injects the organization arm by the ORGANIZATION_TEMPLATE_ARM token", () => {
    theOrganizationArmIsInjectedByItsToken();
  });

  it("marks the organization arm optional, so a module without it still boots", () => {
    theOrganizationArmIsOptional();
  });
});
