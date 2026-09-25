// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../stores/auth-store";
import {
  doesNotReadAssets,
  dropsTheControlRoom2dGroup,
  hidesTheEntryFromANoneScope,
  hidesTheEntryWhileTheScopeIsNull,
  highlightsTheEntryOnANestedPath,
  keepsOtherItemsExactMatch,
  placesTheEntryDirectlyAfterAlarmCentre,
  showsOneEntryToALocationScope,
} from "./app-shell.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.66 Control Room sidebar entry", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.setState({ scope: null });
  });

  it("S1 shows one entry, to /control-room, to a location scope", () => {
    showsOneEntryToALocationScope();
  });

  it("S2 hides the entry from a none scope", () => {
    hidesTheEntryFromANoneScope();
  });

  it("S3 hides the entry while the scope is null", () => {
    hidesTheEntryWhileTheScopeIsNull();
  });

  it("S4 drops the Control Room 2D group", () => {
    dropsTheControlRoom2dGroup();
  });

  it("S5 issues no fetchAssets() from the shell", async () => {
    await doesNotReadAssets();
  });

  it("S6 highlights the entry on a nested /control-room/* path", () => {
    highlightsTheEntryOnANestedPath();
  });

  it("S7 places the entry directly after Alarm Centre", () => {
    placesTheEntryDirectlyAfterAlarmCentre();
  });

  it("S8 keeps every other item exact-match", () => {
    keepsOtherItemsExactMatch();
  });
});
