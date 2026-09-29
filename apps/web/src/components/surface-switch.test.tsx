// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import {
  w1NamesAGroupOfTwoButtons,
  w2LeavesFlatUnpressedInNeumorphic,
  w2PressesFlatInFlat,
  w2PressesNeumorphicInNeumorphic,
  w3FlatPressesFlat,
  w3FlatSetsTheAttribute,
  w3FlatWritesFlat,
  w4NeumorphicSetsTheAttribute,
  w4NeumorphicWritesNeumorphic,
  w5SpaceActivatesFlat,
  w6AThrowingStorageStillFlipsTheAttribute,
  w7ButtonsHaveATooltip,
  w7ButtonsShowAGlyphAndNoText,
} from "./surface-switch.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), jsdom for the DOM. */
describe("F3.71 the Neumorphic / Flat switch", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-surface");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute("data-surface");
  });

  it('W1 a group named "Surface" holds two buttons, Neumorphic then Flat', () => {
    w1NamesAGroupOfTwoButtons();
  });

  it("W2 presses Neumorphic under a neumorphic attribute", () => {
    w2PressesNeumorphicInNeumorphic();
  });

  it("W2 leaves Flat unpressed under a neumorphic attribute", () => {
    w2LeavesFlatUnpressedInNeumorphic();
  });

  it("W2 presses Flat on mount under a flat attribute", () => {
    w2PressesFlatInFlat();
  });

  it('W3 clicking Flat sets data-surface="flat"', async () => {
    await w3FlatSetsTheAttribute();
  });

  it('W3 clicking Flat writes "flat" to bms.surface', async () => {
    await w3FlatWritesFlat();
  });

  it("W3 clicking Flat presses Flat", async () => {
    await w3FlatPressesFlat();
  });

  it('W4 clicking Neumorphic writes "neumorphic" to bms.surface', async () => {
    await w4NeumorphicWritesNeumorphic();
  });

  it('W4 clicking Neumorphic sets data-surface="neumorphic"', async () => {
    await w4NeumorphicSetsTheAttribute();
  });

  it("W5 Space activates the focused Flat button", async () => {
    await w5SpaceActivatesFlat();
  });

  it("W6 a throwing localStorage still flips the attribute", async () => {
    await w6AThrowingStorageStillFlipsTheAttribute();
  });

  it("W7 each button shows its glyph and no visible text", () => {
    w7ButtonsShowAGlyphAndNoText();
  });

  it("W7 each button has a tooltip naming its style", () => {
    w7ButtonsHaveATooltip();
  });
});
