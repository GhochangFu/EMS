// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aRefusedDeleteShowsTheServersSentence,
  anEmptyLibraryPointsAtAnyPreset,
  confirmDeleteCallsTheApiWithTheId,
  failsClosedForALocationAdmin,
  listsEachLayoutWithItsUnitCount,
  newLinksToTheNewRoute,
  openLinksToTheEditor,
  startDefaultsToWaterTrain,
  startFollowsTheChosenPreset,
  startFromListsTheSevenPresets,
} from "./mimic-layouts-page.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F3.32c mimic layouts page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("L1 lists each layout with its unit count", async () => {
    await listsEachLayoutWithItsUnitCount();
  });

  it("L2 Open links to the editor by id", async () => {
    await openLinksToTheEditor();
  });

  it("L3a Start from lists the seven presets by label", async () => {
    await startFromListsTheSevenPresets();
  });

  it("L3b Start from opens on Water train and Start links to it", async () => {
    await startDefaultsToWaterTrain();
  });

  it("L3c choosing Compressed air points Start at it", async () => {
    await startFollowsTheChosenPreset();
  });

  it("L8 an empty library points at any preset", async () => {
    await anEmptyLibraryPointsAtAnyPreset();
  });

  it("L4 New opens the new route", async () => {
    await newLinksToTheNewRoute();
  });

  it("L5 Confirm delete calls the API with the id", async () => {
    await confirmDeleteCallsTheApiWithTheId();
  });

  it("L6 a refused delete shows the server's sentence", async () => {
    await aRefusedDeleteShowsTheServersSentence();
  });

  it("L7 fails closed for a location_admin", async () => {
    await failsClosedForALocationAdmin();
  });
});
