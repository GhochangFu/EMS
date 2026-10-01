import { describe, it } from "vitest";

import {
  assetsCatalogEntriesAreDeclared,
  fiveSiteWidgetTypesAreInTheEnumWithAnArm,
  moduleCardRequiresAValidTabKey,
  railConfigDefaultsAndBounds,
  siteWidgetsBindNothingAndAreNotTemplateAuthorable,
  siteWidgetsResponseIsBounded,
  siteWidgetsResponseParses,
} from "./site-widgets.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.73 — the five site widgets", () => {
  it("adds the five types to the enum, each with a spec arm", () => {
    fiveSiteWidgetTypesAreInTheEnumWithAnArm();
  });

  it("binds nothing and is not template-authorable", () => {
    siteWidgetsBindNothingAndAreNotTemplateAuthorable();
  });

  it("defaults the rail to 8 rows with a summary and bounds it 1..20", () => {
    railConfigDefaultsAndBounds();
  });

  it("requires the module card's targetTabKey, with the tab key's rules", () => {
    moduleCardRequiresAValidTabKey();
  });

  it("declares assets.offline.count (metric) and assets.list (four columns, no role)", () => {
    assetsCatalogEntriesAreDeclared();
  });

  it("parses the site-widgets response, null status and null tab key included", () => {
    siteWidgetsResponseParses();
  });

  it("caps the alarm rail at 20 rows and refuses a non-uuid dashboard id", () => {
    siteWidgetsResponseIsBounded();
  });
});
