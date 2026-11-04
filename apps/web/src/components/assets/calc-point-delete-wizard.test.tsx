// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import { theDeleteWizardShowsTheServersRefusal } from "./calc-point-delete-wizard.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F4.311 PR 6a — the calcPoint.delete wizard", () => {
  afterEach(() => {
    cleanup();
  });

  it("the delete wizard shows the server's refusal", () => {
    theDeleteWizardShowsTheServersRefusal();
  });
});
