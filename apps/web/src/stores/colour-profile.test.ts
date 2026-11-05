// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  cp1SetProfileSetsTheAttributeAndTheKey,
  cp2TheDefaultRemovesTheAttributeAndTheKey,
  cp3AThrowingStorageStillSetsTheAttribute,
  cp4RolesReResolveWhenTheProfileChanges,
  cp5ClearProfileRemovesBoth,
  cp6UseThemeRolesReRendersOnAProfileChange,
  cp7TheInitialProfileFollowsTheAttribute,
} from "./colour-profile.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), jsdom for the store. */
describe("F4.310 colour profile on <html> (ADR 0110 decision 4)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-profile");
  });

  it("CP1 setProfile sets data-profile and writes bms.profile", () => cp1SetProfileSetsTheAttributeAndTheKey());
  it("CP2 the default (nexus) removes the attribute and the key", () => cp2TheDefaultRemovesTheAttributeAndTheKey());
  it("CP3 a throwing storage still sets the attribute", () => cp3AThrowingStorageStillSetsTheAttribute());
  it("CP4 currentRoles re-resolves when the profile changes", () => cp4RolesReResolveWhenTheProfileChanges());
  it("CP5 clearProfile removes the attribute and the key", () => cp5ClearProfileRemovesBoth());
  it("CP6 useThemeRoles re-renders on a profile change", () => cp6UseThemeRolesReRendersOnAProfileChange());
  it("CP7 the initial profile follows the attribute; an unknown one reads as nexus", () => cp7TheInitialProfileFollowsTheAttribute());
});
