// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../stores/auth-store";
import {
  admitsACallerWhoReadsControlRoomAssets,
  admitsTheAreaTheGroupCovers,
  doesNotRedirectWhilePending,
  doesNotRedirectWhileTheScopeIsNull,
  keepsTheCallerInWhenABackgroundRefetchFails,
  keepsThePerAreaRuleOnTop,
  rendersAStatusLineWhilePending,
  rendersAStatusLineWhileTheScopeIsNull,
  sendsACallerWithNoControlRoomAssetHome,
  treatsAFailedReadAsDenied,
} from "./control-room-route.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F4.156 Control Room route gate", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.setState({ scope: null });
  });

  it("G1 admits a caller who reads Control Room assets", async () => {
    await admitsACallerWhoReadsControlRoomAssets();
  });

  it("G2 sends a caller with no readable CR-* asset to /", async () => {
    await sendsACallerWithNoControlRoomAssetHome();
  });

  it("G3a renders a status line while the read is pending", () => {
    rendersAStatusLineWhilePending();
  });

  it("G3b does not redirect while the read is pending", () => {
    doesNotRedirectWhilePending();
  });

  it("G4 treats a failed read as denied", async () => {
    await treatsAFailedReadAsDenied();
  });

  it("G5a keeps the per-area asset_group rule on top", async () => {
    await keepsThePerAreaRuleOnTop();
  });

  it("G5b admits the area the asset group covers", async () => {
    await admitsTheAreaTheGroupCovers();
  });

  it("G6 keeps a granted caller in when a background refetch fails", async () => {
    await keepsTheCallerInWhenABackgroundRefetchFails();
  });

  it("G7a renders a status line while the scope is null", async () => {
    await rendersAStatusLineWhileTheScopeIsNull();
  });

  it("G7b does not redirect while the scope is null", async () => {
    await doesNotRedirectWhileTheScopeIsNull();
  });
});
