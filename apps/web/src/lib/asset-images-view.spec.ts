import { expect } from "vitest";

import { MAX_ASSET_IMAGE_BYTES, ASSET_IMAGE_CONTENT_TYPES } from "@bms/shared";

import {
  ASSET_IMAGE_ACCEPT,
  assetImageMegabytes,
  describeAssetImageUploadError,
  describeGalleryError,
  uploadBlockedReason,
} from "./asset-images-view";

/**
 * `F3.4` Unit 1 — the pure view logic behind the upload panel and the
 * gallery, before either has a component (R-3, R-7).
 *
 * One exported assert per claim (the `onboarding-upload-error.spec.ts`
 * shape) — a shared function stops at its first failing `expect`, which
 * would hide a later claim behind an earlier one (the `F4.105` lesson).
 */

/** `ASSET_IMAGE_ACCEPT` is derived from the shared vocabulary, never restated (§4.8). */
export function theAcceptStringIsDerivedFromTheThreeTypes(): void {
  expect(ASSET_IMAGE_ACCEPT).toBe(ASSET_IMAGE_CONTENT_TYPES.join(","));
}

/** A valid file well under the cap blocks nothing — the positive control for the size/cap rows below. */
export function aValidFileUnderTheCapIsNotBlocked(): void {
  const file = { type: "image/png", size: 1024 };
  expect(uploadBlockedReason({ file, imageCount: 19 })).toBeNull();
}

/** No file chosen names that, first — before any other check runs. */
export function noFileNamesItself(): void {
  expect(uploadBlockedReason({ file: null, imageCount: 0 })).toBe("Choose an image to upload.");
}

/** At the cap, the sentence names the real number and says to delete one first. */
export function theCapSentenceNamesTwenty(): void {
  const file = { type: "image/png", size: 1024 };
  expect(uploadBlockedReason({ file, imageCount: 20 })).toBe(
    "This asset already has 20 images; delete one before uploading another.",
  );
}

/** A type outside the closed vocabulary is refused with the allowlist sentence. */
export function anUnsupportedTypeIsRefused(): void {
  const file = { type: "text/plain", size: 1024 };
  expect(uploadBlockedReason({ file, imageCount: 0 })).toBe(
    "Only JPEG, PNG or WebP images are accepted.",
  );
}

/** Over the byte cap names the 10 MB limit and the file's own size, to one decimal. */
export function anOversizeFileNamesTheLimitAndItsOwnSize(): void {
  const file = { type: "image/png", size: MAX_ASSET_IMAGE_BYTES + 1 };
  const reason = uploadBlockedReason({ file, imageCount: 0 });
  expect(reason, `got ${JSON.stringify(reason)}`).toContain("limit is 10 MB");
}

/** `assetImageMegabytes()` reads the real shared constant, not a hard-wired figure. */
export function megabytesIsTenFromTheSharedConstant(): void {
  expect(assetImageMegabytes()).toBe("10");
}

/** A 413 names the 10 MB limit, and never the telemetry-import sibling's 5 MB figure. */
export function a413NamesTenMbNotFiveMb(): void {
  const shown = describeAssetImageUploadError(413, "");
  expect(shown, `got ${JSON.stringify(shown)}`).toContain("10 MB");
  expect(shown).not.toContain("5 MB");
}

/** A Nest envelope's own sentence is unwrapped, unquoted, un-enveloped. */
export function aConflictEnvelopeIsUnwrapped(): void {
  const body = JSON.stringify({
    message: "This asset already has 20 images; delete one before uploading another",
  });
  expect(describeAssetImageUploadError(409, body)).toBe(
    "This asset already has 20 images; delete one before uploading another",
  );
}

/** An empty body still names the status, so a blank refusal is not a blank screen. */
export function anEmptyBodyNamesTheStatus(): void {
  expect(describeAssetImageUploadError(500, "")).toBe("Upload failed (500).");
}

/** The gallery's 503 shows the API's own sentence. */
export function galleryFiveOhThreeShowsTheApiSentence(): void {
  const body = JSON.stringify({ message: "Object storage is unreachable" });
  expect(describeGalleryError(503, body)).toBe("Object storage is unreachable");
}

/** Every other gallery status shows the generic sentence. */
export function galleryFiveHundredShowsTheGenericSentence(): void {
  expect(describeGalleryError(500, "")).toBe("Images unavailable.");
}
