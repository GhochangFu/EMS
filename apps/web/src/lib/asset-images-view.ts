import {
  ASSET_IMAGE_CONTENT_TYPES,
  MAX_ASSET_IMAGE_BYTES,
  MAX_ASSET_IMAGES_PER_ASSET,
} from "@bms/shared";

import { apiErrorMessage } from "./api-error-message";

/**
 * `F3.4` Unit 1 — the pure view logic behind the upload panel (U8) and both
 * galleries (U7, U9), split out ahead of any component so it lands in the
 * coverage `include` (`src/lib/**`) rather than behind jsdom (§1 of the
 * plan).
 *
 * `apps/web/src/lib/api-error.ts` was read first, as the plan asked — it
 * turns out to hold only the `ApiError` subclass (the status-bearing error
 * `adminFetch` throws), not an unwrapper. The repository's one wire-envelope
 * unwrapper (§4.8) is `apiErrorMessage` in the sibling `api-error-message.ts`
 * — the module every other `describe*UploadError` helper
 * (`onboarding-upload-error.ts`, `telemetry-import-preview.ts`) reads — and
 * that is the real name and contract used here.
 */

/** The three accepted content types, joined for an `<input accept>` attribute — derived, never restated (§4.8). */
export const ASSET_IMAGE_ACCEPT: string = ASSET_IMAGE_CONTENT_TYPES.join(",");

/** `MAX_ASSET_IMAGE_BYTES` in whole megabytes, as the sentence below renders it. */
export function assetImageMegabytes(): string {
  return String(MAX_ASSET_IMAGE_BYTES / (1024 * 1024));
}

/** A file's byte size in MB, to one decimal — for the oversize sentence. */
function fileMegabytes(byteSize: number): string {
  return (byteSize / (1024 * 1024)).toFixed(1);
}

export type UploadBlockCheck = {
  file: { type: string; size: number } | null;
  imageCount: number;
};

/**
 * The reason the Upload button is disabled, or `null` when a click would go
 * through (R-7: "disables … and says so", the `mapping-sheet-panel` rule).
 *
 * Order matters and is asserted in that order: no file chosen is checked
 * before anything about a file that was not chosen could be asked; the cap
 * is checked before the type/size of the file that would exceed it, because
 * the cap sentence is true regardless of what file is picked.
 */
export function uploadBlockedReason({ file, imageCount }: UploadBlockCheck): string | null {
  if (file === null) {
    return "Choose an image to upload.";
  }
  if (imageCount >= MAX_ASSET_IMAGES_PER_ASSET) {
    return `This asset already has ${MAX_ASSET_IMAGES_PER_ASSET} images; delete one before uploading another.`;
  }
  if (!ASSET_IMAGE_CONTENT_TYPES.includes(file.type as (typeof ASSET_IMAGE_CONTENT_TYPES)[number])) {
    return "Only JPEG, PNG or WebP images are accepted.";
  }
  if (file.size > MAX_ASSET_IMAGE_BYTES) {
    return `Image is too large — the limit is ${assetImageMegabytes()} MB (this file is ${fileMegabytes(file.size)} MB).`;
  }
  return null;
}

/**
 * The sentence for a refused upload (R-7). A 413 always names the real
 * 10 MB limit — `MAX_ASSET_IMAGE_BYTES` lives in `@bms/shared`, unlike the
 * telemetry-import sibling's hard-wired 5 MB (`oversize-upload.ts`) — so this
 * function does not reuse that helper.
 */
export function describeAssetImageUploadError(status: number, bodyText: string): string {
  if (status === 413) {
    return `Image is too large — the limit is ${assetImageMegabytes()} MB.`;
  }
  if (bodyText.trim() === "") {
    return `Upload failed (${status}).`;
  }
  return apiErrorMessage(bodyText);
}

/** The sentence for a failed gallery read (R-7): the API's own words on a 503, else the generic line. */
export function describeGalleryError(status: number, bodyText: string): string {
  if (status === 503) {
    return apiErrorMessage(bodyText) || "Object storage is unavailable.";
  }
  return "Images unavailable.";
}
