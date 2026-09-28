// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aRefusedDeleteShowsTheServersSentence,
  confirmDeleteCallsTheApiWithTheId,
  failsClosedForALocationAdmin,
  listsEachLayoutWithItsUnitCount,
  newLinksToTheNewRoute,
  openLinksToTheEditor,
  startFromWaterTrainLinksToTheNewRouteWithThePreset,
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

  it("L3 Start from Water train opens the new route with the preset", async () => {
    await startFromWaterTrainLinksToTheNewRouteWithThePreset();
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
