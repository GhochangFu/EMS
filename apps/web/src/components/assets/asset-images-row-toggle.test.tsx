// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aSecondPressHidesTheGalleryRow,
  nothingIsFetchedBeforeTheToggleIsPressed,
  pressingTheToggleListsThatAssetsImagesOnce,
  pressingTheToggleShowsTheGallery,
  theReaderSeesTheImageAndNoDeleteButton,
} from "./asset-images-row-toggle.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.4 reader image row toggle (Q-1 option A)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("fetches nothing until the toggle is pressed", async () => {
    await nothingIsFetchedBeforeTheToggleIsPressed();
  });

  it("lists that asset's images once when the toggle is pressed", async () => {
    await pressingTheToggleListsThatAssetsImagesOnce();
  });

  it("shows the gallery after the press", async () => {
    await pressingTheToggleShowsTheGallery();
  });

  it("renders the image with no Delete button for a reader", async () => {
    await theReaderSeesTheImageAndNoDeleteButton();
  });

  it("hides the gallery row on a second press", async () => {
    await aSecondPressHidesTheGalleryRow();
  });
});
