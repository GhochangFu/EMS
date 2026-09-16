// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aConflictRendersTheApiSentenceUnwrapped,
  aDeleteInFlightDisablesThatImagesButton,
  aDeleteRefetchesTheList,
  aGifDisablesUploadAndNamesTheAcceptedTypes,
  aRefusedOversizeUploadRendersTheTenMbSentence,
  aSuccessfulUploadRefetchesTheList,
  aValidFileEnablesUpload,
  anOversizeFileDisablesUploadAndNamesTheLimit,
  atTheCapTheSentenceShowsAndTheFileInputIsDisabled,
  closeCallsOnClose,
  deletingAThumbnailCallsTheApiOnceForThatImage,
  pressingUploadPostsTheFileAndCaptionOnce,
  thePillCountsTheImagesAgainstTheCap,
  theHeadingNamesTheAssetCodeAndName,
  uploadIsDisabledAndAsksForAFileFirst,
} from "./asset-images-panel.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from the
 * file it collects (ADR 0042 decision 2).
 *
 * `vi.restoreAllMocks()` undoes the api spies and the two object-URL spies
 * alike — jsdom defines both `URL` methods, as `asset-image-gallery.spec.tsx`
 * measured.
 */
describe("F3.4 admin asset images panel (Q-0, Q-2, R-7)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("names the asset's code and name in its heading", async () => {
    await theHeadingNamesTheAssetCodeAndName();
  });

  it("disables Upload and asks for a file before one is chosen", async () => {
    await uploadIsDisabledAndAsksForAFileFirst();
  });

  it("disables Upload and names the 10 MB limit for an oversize file", async () => {
    await anOversizeFileDisablesUploadAndNamesTheLimit();
  });

  it("disables Upload and names the accepted types for a GIF", async () => {
    await aGifDisablesUploadAndNamesTheAcceptedTypes();
  });

  it("says the asset is full and refuses a file at all once it holds 20", async () => {
    await atTheCapTheSentenceShowsAndTheFileInputIsDisabled();
  });

  it("enables Upload for a valid image under the cap", async () => {
    await aValidFileEnablesUpload();
  });

  it("posts the chosen file and caption exactly once", async () => {
    await pressingUploadPostsTheFileAndCaptionOnce();
  });

  it("refetches the list after a successful upload", async () => {
    await aSuccessfulUploadRefetchesTheList();
  });

  it("renders the 10 MB sentence when the API refuses an upload with 413", async () => {
    await aRefusedOversizeUploadRendersTheTenMbSentence();
  });

  it("renders the API's own sentence when the upload is refused with 409", async () => {
    await aConflictRendersTheApiSentenceUnwrapped();
  });

  it("deletes the image whose Delete was pressed, once", async () => {
    await deletingAThumbnailCallsTheApiOnceForThatImage();
  });

  it("refetches the list after a delete", async () => {
    await aDeleteRefetchesTheList();
  });

  it("disables the button of the image being deleted while the request is in flight", async () => {
    await aDeleteInFlightDisablesThatImagesButton();
  });

  it("counts the asset's images against the shared cap in its pill", async () => {
    await thePillCountsTheImagesAgainstTheCap();
  });

  it("calls onClose when Close is pressed", async () => {
    await closeCallsOnClose();
  });
});
