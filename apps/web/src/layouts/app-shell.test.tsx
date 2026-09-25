// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../stores/auth-store";
import {
  hidesTheGroupFromACallerWithNoControlRoomAsset,
  hidesTheGroupFromANoneScope,
  hidesTheGroupWhenTheReadFails,
  hidesTheGroupWhilePending,
  keepsTheGroupWhenABackgroundRefetchFails,
  keepsThePerAreaRule,
  sharesTheAssetsQueryKey,
  showsTheGroupToACallerWhoReadsControlRoomAssets,
} from "./app-shell.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F4.156 Control Room 2D sidebar group", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.setState({ scope: null });
  });

  it("S1 shows the group to a caller who reads Control Room assets", async () => {
    await showsTheGroupToACallerWhoReadsControlRoomAssets();
  });

  it("S2 hides the group from a caller with no readable CR-* asset", async () => {
    await hidesTheGroupFromACallerWithNoControlRoomAsset();
  });

  it("S3 hides the group while the read is pending", () => {
    hidesTheGroupWhilePending();
  });

  it("S4 hides the group when the read fails", async () => {
    await hidesTheGroupWhenTheReadFails();
  });

  it("S5 keeps the per-area asset_group rule", async () => {
    await keepsThePerAreaRule();
  });

  it("S6 hides the group from a none scope", async () => {
    await hidesTheGroupFromANoneScope();
  });

  it("S7 shares the [\"assets\"] query key with the schematic provider", async () => {
    await sharesTheAssetsQueryKey();
  });

  it("S8 keeps the group when a background refetch fails", async () => {
    await keepsTheGroupWhenABackgroundRefetchFails();
  });
});
