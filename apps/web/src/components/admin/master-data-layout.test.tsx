/**
 * @vitest-environment jsdom
 */
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  leavesOutAnAreaTheRoleCannotSee,
  linksEveryScreenOfAnArea,
  marksTheAreaOfADrillDown,
  marksTheDeepestLevelOfADrillDown,
  namesTheAreaInTheRibbon,
  rendersOneCardPerArea,
  showsALocationAdminItsOwnTabs,
} from "./master-data-layout.spec";

/** Vitest entry point for `master-data-layout.spec.tsx` (ADR 0014, ADR 0042 decision 2). */
describe("F3.76 Master Data chrome", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("T1 marks the area of a drill-down", () => {
    marksTheAreaOfADrillDown();
  });

  it("T2 marks the deepest level of a drill-down", () => {
    marksTheDeepestLevelOfADrillDown();
  });

  it("T3 shows a location_admin its own areas and tabs", () => {
    showsALocationAdminItsOwnTabs();
  });

  it("T4 names the selected area in the ribbon", () => {
    namesTheAreaInTheRibbon();
  });

  it("H1 renders the hub with one card per area", () => {
    rendersOneCardPerArea();
  });

  it("H2 links every screen of an area", () => {
    linksEveryScreenOfAnArea();
  });

  it("H3 leaves out an area the role cannot see", () => {
    leavesOutAnAreaTheRoleCannotSee();
  });
});
