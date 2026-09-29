// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";

import {
  u1AMissingAttributeStartsNeumorphic,
  u1InitialSurfaceFollowsAFlatAttribute,
  u1InitialSurfaceFollowsANeumorphicAttribute,
  u2SetFlatMovesTheState,
  u2SetFlatSetsTheAttribute,
  u2SetFlatWritesFlat,
  u3SetNeumorphicWritesNeumorphic,
  u4AThrowingStorageStillFlipsTheAttribute,
  u4AThrowingStorageStillMovesTheStore,
} from "./surface-store.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), jsdom for the store. */
describe("F3.71 surface store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute("data-surface");
  });

  it("U1 the initial surface follows a flat attribute", async () => {
    await u1InitialSurfaceFollowsAFlatAttribute();
  });

  it("U1 the initial surface follows a neumorphic attribute", async () => {
    await u1InitialSurfaceFollowsANeumorphicAttribute();
  });

  it("U1 a missing attribute starts the store at neumorphic", async () => {
    await u1AMissingAttributeStartsNeumorphic();
  });

  it('U2 setSurface("flat") sets data-surface="flat"', async () => {
    await u2SetFlatSetsTheAttribute();
  });

  it('U2 setSurface("flat") writes "flat" to bms.surface', async () => {
    await u2SetFlatWritesFlat();
  });

  it('U2 setSurface("flat") moves the store', async () => {
    await u2SetFlatMovesTheState();
  });

  it('U3 setSurface("neumorphic") writes "neumorphic" to bms.surface', async () => {
    await u3SetNeumorphicWritesNeumorphic();
  });

  it("U4 a throwing localStorage still flips the attribute", async () => {
    await u4AThrowingStorageStillFlipsTheAttribute();
  });

  it("U4 a throwing localStorage still moves the store", async () => {
    await u4AThrowingStorageStillMovesTheStore();
  });
});
