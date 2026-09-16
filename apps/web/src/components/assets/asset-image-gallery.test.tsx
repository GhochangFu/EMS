// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aFiveHundredRendersTheGenericSentence,
  aFailedBlobReadRendersTheUnavailableBox,
  aFiveOhThreeRendersTheApiSentence,
  aMatchingDeletingIdDisablesThatButton,
  anEmptyListRendersTheEmptySentence,
  eachCellNamesItsImageAndItsSize,
  theLoadingSentenceShowsBeforeTheListResolves,
  twoImagesRenderWithTheirAltsAndOneBlobReadEach,
  unmountRevokesEveryUrlItCreated,
  withOnDeleteTheButtonPassesTheDto,
  withoutOnDeleteThereIsNoDeleteButton,
} from "./asset-image-gallery.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from the
 * file it collects (ADR 0042 decision 2).
 *
 * `vi.restoreAllMocks()` is what undoes the object-URL spies as well as the api
 * spies — jsdom defines both `URL` methods, so they are ordinary spies (see the
 * spec's docblock, which records the measurement).
 */
describe("F3.4 asset image gallery (ADR 0066 decision 4, R-7)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the loading sentence before the list resolves", async () => {
    await theLoadingSentenceShowsBeforeTheListResolves();
  });

  it("renders one img per image with its caption or filename as the alt, reading the bytes once each", async () => {
    await twoImagesRenderWithTheirAltsAndOneBlobReadEach();
  });

  it("labels each cell with its caption or filename and its size in KB", async () => {
    await eachCellNamesItsImageAndItsSize();
  });

  it("says an image is unavailable when its bytes cannot be read, and renders no img", async () => {
    await aFailedBlobReadRendersTheUnavailableBox();
  });

  it("renders the API's own sentence when the list is refused with 503", async () => {
    await aFiveOhThreeRendersTheApiSentence();
  });

  it("renders the generic sentence when the list is refused with any other status", async () => {
    await aFiveHundredRendersTheGenericSentence();
  });

  it("says the asset has no images yet when the list is empty", async () => {
    await anEmptyListRendersTheEmptySentence();
  });

  it("offers no Delete affordance when no onDelete is given", async () => {
    await withoutOnDeleteThereIsNoDeleteButton();
  });

  it("hands the pressed image's DTO to onDelete", async () => {
    await withOnDeleteTheButtonPassesTheDto();
  });

  it("disables the button of the image being deleted and says so", async () => {
    await aMatchingDeletingIdDisablesThatButton();
  });

  it("revokes every object URL it created when it unmounts", async () => {
    await unmountRevokesEveryUrlItCreated();
  });
});
