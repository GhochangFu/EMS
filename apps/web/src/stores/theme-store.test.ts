// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  h1UseThemeRolesRerendersWithTheDarkBlock,
  h2UseThemeFollowsSetTheme,
  s1InitialRolesFollowADarkAttribute,
  s1InitialRolesFollowALightAttribute,
  s1InitialThemeFollowsADarkAttribute,
  s1InitialThemeFollowsALightAttribute,
  s2SetDarkMovesTheState,
  s2SetDarkResolvesTheDarkBlock,
  s2SetDarkSetsTheAttribute,
  s2SetDarkWritesDark,
  s3SetLightWritesLight,
  s4AThrowingStorageStillFlipsTheAttribute,
  s4AThrowingStorageStillFlipsTheRoles,
  s4AThrowingStorageStillMovesTheStoreTheme,
} from "./theme-store.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), jsdom for the store. */
describe("F3.65c theme store", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("S1 the initial theme follows a dark attribute", async () => {
    await s1InitialThemeFollowsADarkAttribute();
  });

  it("S1 the initial roles follow a dark attribute", async () => {
    await s1InitialRolesFollowADarkAttribute();
  });

  it("S1 the initial theme follows a light attribute", async () => {
    await s1InitialThemeFollowsALightAttribute();
  });

  it("S1 the initial roles follow a light attribute", async () => {
    await s1InitialRolesFollowALightAttribute();
  });

  it('S2 setTheme("dark") sets data-theme', async () => {
    await s2SetDarkSetsTheAttribute();
  });

  it('S2 setTheme("dark") writes "dark" to bms.theme', async () => {
    await s2SetDarkWritesDark();
  });

  it('S2 setTheme("dark") moves the store theme', async () => {
    await s2SetDarkMovesTheState();
  });

  it('S2 setTheme("dark") resolves the dark block', async () => {
    await s2SetDarkResolvesTheDarkBlock();
  });

  it('S3 setTheme("light") writes "light", it does not remove the key', async () => {
    await s3SetLightWritesLight();
  });

  it("S4 a throwing localStorage still flips the attribute", async () => {
    await s4AThrowingStorageStillFlipsTheAttribute();
  });

  it("S4 a throwing localStorage still flips the roles", async () => {
    await s4AThrowingStorageStillFlipsTheRoles();
  });

  it("S4 a throwing localStorage still moves the store theme", async () => {
    await s4AThrowingStorageStillMovesTheStoreTheme();
  });

  it("H1 useThemeRoles re-renders with the dark block after setTheme", async () => {
    await h1UseThemeRolesRerendersWithTheDarkBlock();
  });

  it("H2 useTheme follows setTheme", async () => {
    await h2UseThemeFollowsSetTheme();
  });
});
