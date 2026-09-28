// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import {
  w1NamesAGroupOfTwoButtons,
  w2LeavesDarkUnpressedInLight,
  w2LeavesLightUnpressedInDark,
  w2PressesDarkInDark,
  w2PressesLightInLight,
  w3DarkPressesDark,
  w3DarkReleasesLight,
  w3DarkSetsTheAttribute,
  w3DarkWritesDark,
  w4LightSetsTheAttribute,
  w4LightWritesLight,
  w5EnterActivatesDark,
  w5SpaceActivatesDark,
  w5TabReachesDark,
  w6AThrowingStorageStillFlipsTheAttribute,
  w6AThrowingStorageStillPressesDark,
} from "./theme-switch.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), jsdom for the DOM. */
describe("F3.65c the Light / Dark switch", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it('W1 a group named "Theme" holds two buttons, Light then Dark', () => {
    w1NamesAGroupOfTwoButtons();
  });

  it("W2 presses Light under a light attribute", () => {
    w2PressesLightInLight();
  });

  it("W2 leaves Dark unpressed under a light attribute", () => {
    w2LeavesDarkUnpressedInLight();
  });

  it("W2 presses Dark on mount under a dark attribute", () => {
    w2PressesDarkInDark();
  });

  it("W2 leaves Light unpressed on mount under a dark attribute", () => {
    w2LeavesLightUnpressedInDark();
  });

  it('W3 clicking Dark sets data-theme="dark"', async () => {
    await w3DarkSetsTheAttribute();
  });

  it('W3 clicking Dark writes "dark" to bms.theme', async () => {
    await w3DarkWritesDark();
  });

  it("W3 clicking Dark presses Dark", async () => {
    await w3DarkPressesDark();
  });

  it("W3 clicking Dark releases Light", async () => {
    await w3DarkReleasesLight();
  });

  it('W4 clicking Light writes "light" to bms.theme', async () => {
    await w4LightWritesLight();
  });

  it('W4 clicking Light sets data-theme="light"', async () => {
    await w4LightSetsTheAttribute();
  });

  it("W5 Tab reaches Dark", async () => {
    await w5TabReachesDark();
  });

  it("W5 Enter activates the focused Dark button", async () => {
    await w5EnterActivatesDark();
  });

  it("W5 Space activates the focused Dark button", async () => {
    await w5SpaceActivatesDark();
  });

  it("W6 a throwing localStorage still flips the attribute", async () => {
    await w6AThrowingStorageStillFlipsTheAttribute();
  });

  it("W6 a throwing localStorage still presses Dark", async () => {
    await w6AThrowingStorageStillPressesDark();
  });
});
