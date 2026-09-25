// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  cleanupBreadcrumb,
  linksEveryEarlierCrumb,
  rendersANamedNavigationForThreeCrumbs,
  rendersNothingForNoCrumbs,
  rendersNothingForOneCrumb,
  rendersTheLastCrumbAsText,
} from "./control-room-breadcrumb.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.66 ControlRoomBreadcrumb", () => {
  afterEach(() => {
    cleanupBreadcrumb();
  });

  it("K1 renders nothing for no crumbs", () => {
    rendersNothingForNoCrumbs();
  });

  it("K2 renders nothing for one crumb", () => {
    rendersNothingForOneCrumb();
  });

  it("K3 renders a navigation named Breadcrumb for three crumbs", () => {
    rendersANamedNavigationForThreeCrumbs();
  });

  it("K4 links every crumb above the last to its target", () => {
    linksEveryEarlierCrumb();
  });

  it("K5 renders the last crumb as text even when it carries a target", () => {
    rendersTheLastCrumbAsText();
  });
});
