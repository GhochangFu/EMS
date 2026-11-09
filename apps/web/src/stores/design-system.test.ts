// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  ds1SetDesignSetsTheAttributeAndTheKey,
  ds2AThrowingStorageStillSetsTheAttribute,
  ds3PreviewMovesTheAttributeOnly,
  ds4ClearDesignAndSignOutRemoveBoth,
  ds5ChartTypeFollowsTheDesignAndRolesReResolve,
  ds6TheInitialDesignFollowsTheAttribute,
} from "./design-system.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), jsdom for the store. */
describe("F4.341 design system on <html> (ADR 0118 decisions 4, 11, 12)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-design");
    document.documentElement.removeAttribute("data-profile");
  });

  it("DS1 setDesign sets data-design and bms.design; the default removes both", () => ds1SetDesignSetsTheAttributeAndTheKey());
  it("DS2 a throwing storage still sets the attribute", () => ds2AThrowingStorageStillSetsTheAttribute());
  it("DS3 previewDesign moves the attribute only; null restores the own value", () => ds3PreviewMovesTheAttributeOnly());
  it("DS4 clearDesign and sign-out remove the attribute and the key", () => ds4ClearDesignAndSignOutRemoveBoth());
  it("DS5 chartType follows the design system and the roles re-resolve", () => ds5ChartTypeFollowsTheDesignAndRolesReResolve());
  it("DS6 the initial design follows the attribute; an unknown one reads as nexus-soft", () => ds6TheInitialDesignFollowsTheAttribute());
});
