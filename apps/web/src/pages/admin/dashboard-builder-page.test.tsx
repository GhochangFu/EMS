// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  addingAWidgetSelectsItForEditing,
  createIsDisabledUntilRequiredFieldsAreFilled,
  locationAdminGetsNoOrganizationWideOptionOnTheComposedPage,
} from "./dashboard-builder-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.1d dashboard builder page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("gives a location_admin no organization-wide option on the composed page", async () => {
    await locationAdminGetsNoOrganizationWideOptionOnTheComposedPage();
  });

  it("selects a newly added widget for editing", async () => {
    await addingAWidgetSelectsItForEditing();
  });

  it("disables Create dashboard until the required fields are filled", async () => {
    await createIsDisabledUntilRequiredFieldsAreFilled();
  });
});
