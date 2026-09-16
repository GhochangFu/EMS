import { expect } from "vitest";

import { MAX_ASSET_IMAGE_BYTES, ASSET_IMAGE_CONTENT_TYPES } from "@bms/shared";

import {
  ASSET_IMAGE_ACCEPT,
  assetImageCapReason,
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

/**
 * `U8` — the cap alone, with no file in hand, is the sentence and nothing else.
 *
 * The 19 case is the positive control and is asserted **first**: `expect`
 * throws, so a `null` check placed after a broken sentence would never run,
 * and a `>=` turned into `>` has to land somewhere. The two sides also pin the
 * boundary — 19 is open, 20 is closed.
 */
export function theCapReasonIsTheSentenceAtTwentyAndNullBelow(): void {
  expect(assetImageCapReason(19)).toBeNull();
  expect(assetImageCapReason(20)).toBe(
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

/**
 * A 503 with no body at all still names the storage, not the request.
 *
 * `apiErrorMessage("")` answers "The request failed." — never `""` — so the
 * `|| "Object storage is unavailable."` fallback this function used to carry
 * could not fire, and an empty 503 showed the generic failure line instead.
 */
export function galleryFiveOhThreeWithNoBodyShowsTheStorageSentence(): void {
  expect(describeGalleryError(503, "")).toBe("Object storage is unavailable.");
}

/**
 * A 503 whose body is not a Nest envelope shows the storage sentence, never
 * the raw text.
 *
 * `adminFetch` throws `admin <path> <status>` when the response carries no
 * usable body, and `apiErrorMessage` hands any non-envelope text straight
 * back — so this exact string used to be rendered under the thumbnails,
 * showing an operator an internal path and a uuid.
 */
export function galleryFiveOhThreeWithANonEnvelopeBodyShowsTheStorageSentence(): void {
  const body = "admin /assets/11111111-1111-4111-8111-111111111111/images 503";
  expect(describeGalleryError(503, body)).toBe("Object storage is unavailable.");
}

/**
 * A 503 body that starts like JSON and is not JSON shows the storage
 * sentence — a proxy that truncated the response mid-object, which is the one
 * shape that reaches the `JSON.parse` failure arm.
 */
export function galleryFiveOhThreeWithATruncatedJsonBodyShowsTheStorageSentence(): void {
  expect(describeGalleryError(503, '{"message":"Object storage is unre')).toBe(
    "Object storage is unavailable.",
  );
}

/**
 * An envelope whose `message` is an **array** is still an envelope.
 *
 * Nest sends that shape for a validation failure and `apiErrorMessage` joins
 * the parts, so the envelope check has to admit it or the API's own sentence
 * would be replaced by the generic one.
 */
export function galleryFiveOhThreeWithAnArrayMessageShowsTheJoinedSentence(): void {
  const body = JSON.stringify({ message: ["Object storage is unreachable"] });
  expect(describeGalleryError(503, body)).toBe("Object storage is unreachable");
}

/** Every other gallery status shows the generic sentence. */
export function galleryFiveHundredShowsTheGenericSentence(): void {
  expect(describeGalleryError(500, "")).toBe("Images unavailable.");
}
