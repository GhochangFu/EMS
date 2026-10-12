import { describe, it } from "vitest";

import {
  theRefinedViewBodyHasItsThreeFields,
  theSiteLayoutEntryIsThePostRoute,
  theSiteLayoutSummaryCountsTheChosenTabs,
  theSiteLayoutSummaryNamesTheSiteAndTheTemplate,
  theViewEntryIsThePutRoute,
  theViewSummaryNamesTheSiteAndTheKind,
} from "./site-views.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 3d — the site-view catalog entries (ruling Q7(b))", () => {
  it("makes the Control Room view entry the PUT route", () => theViewEntryIsThePutRoute());
  it("makes the site-layout entry the POST route", () => theSiteLayoutEntryIsThePostRoute());
  it("unwraps the refined view body to its three fields", () => theRefinedViewBodyHasItsThreeFields());
  it("names the site and the kind in the view summary", () => theViewSummaryNamesTheSiteAndTheKind());
  it("names the site and the template in the site-layout summary", () =>
    theSiteLayoutSummaryNamesTheSiteAndTheTemplate());
  it("counts the chosen tabs in the site-layout summary", () => theSiteLayoutSummaryCountsTheChosenTabs());
});
