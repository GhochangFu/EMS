// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";

import {
  choosingAnotherOrganizationClearsTheLocations,
  choosingAPresetDropsTheInstants,
  choosingCustomRendersTwoPickersInTheViewsZone,
  disablesThePickersUntilTheViewNamesAZone,
  hidesTheOrganizationSelectForOneOrganization,
  listsOnlyTheChosenOrganizationsTreeWithDepthLabels,
  offersAnOrganizationSelectForTwoOrganizations,
  offersTheSevenRanges,
  pickingLocationsHandsTheirIdsToOnChange,
  rendersNoPickerForAPreset,
  togglingCompareSetsAndClearsPrevious,
  typesACustomStartInTheViewsZone,
} from "./energy-filter-bar.spec";

/**
 * `F4.298` U5 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); the jsdom docblock is here because this is the file Vitest
 * collects (ADR 0042 decision 2). The browser zone is pinned to
 * `America/St_Johns`, which no fixture uses (ADR 0108 Status ruling c).
 */
describe("F4.298 — the Energy filter bar", () => {
  beforeAll(() => {
    vi.stubEnv("TZ", "America/St_Johns");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("hides the organization select for a caller with one organization", () => {
    hidesTheOrganizationSelectForOneOrganization();
  });

  it("offers an organization select for two organizations", () => {
    offersAnOrganizationSelectForTwoOrganizations();
  });

  it("lists only the chosen organization's tree, with depth labels", () => {
    listsOnlyTheChosenOrganizationsTreeWithDepthLabels();
  });

  it("choosing another organization clears the locations", async () => {
    await choosingAnotherOrganizationClearsTheLocations();
  });

  it("picking locations hands their ids to onChange", async () => {
    await pickingLocationsHandsTheirIdsToOnChange();
  });

  it("offers the seven ranges", () => {
    offersTheSevenRanges();
  });

  it("renders no picker for a preset range", () => {
    rendersNoPickerForAPreset();
  });

  it("choosing custom renders two datetime-local pickers in the view's zone", async () => {
    await choosingCustomRendersTwoPickersInTheViewsZone();
  });

  it("a typed custom start converts in the view's zone", () => {
    typesACustomStartInTheViewsZone();
  });

  it("disables the pickers until the view names a zone", () => {
    disablesThePickersUntilTheViewNamesAZone();
  });

  it("choosing a preset drops the custom instants", async () => {
    await choosingAPresetDropsTheInstants();
  });

  it("toggling compare sets and clears previous", async () => {
    await togglingCompareSetsAndClearsPrevious();
  });
});
