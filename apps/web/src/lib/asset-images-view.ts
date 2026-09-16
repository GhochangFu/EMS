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
 * The cap sentence when the asset already holds `MAX_ASSET_IMAGES_PER_ASSET`
 * images, else `null`.
 *
 * Extracted from `uploadBlockedReason` by `U8`. The behaviour of that function
 * is unchanged and the sentence is still written once (§4.8). The panel needs
 * this branch **on its own** because it renders before a file is chosen:
 * `uploadBlockedReason` answers "Choose an image to upload." first — and does
 * so deliberately, since nothing about an unchosen file can be asked — which on
 * a full asset invites a click the API can only answer with a 409. The panel
 * asks the cap first and falls back to `uploadBlockedReason`, and this is also
 * what disables its file input.
 */
export function assetImageCapReason(imageCount: number): string | null {
  if (imageCount >= MAX_ASSET_IMAGES_PER_ASSET) {
    return `This asset already has ${MAX_ASSET_IMAGES_PER_ASSET} images; delete one before uploading another.`;
  }
  return null;
}

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
  const capped = assetImageCapReason(imageCount);
  if (capped !== null) {
    return capped;
  }
  // `readonly string[]`, not a cast on `file.type`: a `File`'s type is any
  // string the browser reports, and asserting it into the closed vocabulary
  // to ask whether it is a member of that vocabulary assumes the answer.
  if (!(ASSET_IMAGE_CONTENT_TYPES as readonly string[]).includes(file.type)) {
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

/**
 * Whether the body is Nest's error envelope carrying a usable `message`.
 *
 * `apiErrorMessage` deliberately falls back to the **raw text** for anything
 * else — a proxy's HTML page, a bare status line — because on the admin pages
 * a wrong-looking sentence beats a blank one. A gallery tile is not that
 * screen: `adminFetch` throws `admin /assets/<uuid>/images 503` for a body
 * with no JSON at all, and rendering that under a thumbnail shows an operator
 * an internal path instead of what to do. So the envelope is checked here
 * first, and only the envelope's own sentence is unwrapped — by
 * `apiErrorMessage`, which stays the one unwrapper (§4.8).
 */
function isEnvelopeWithMessage(bodyText: string): boolean {
  const trimmed = bodyText.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }
  const { message } = parsed as { message?: unknown };
  if (Array.isArray(message)) {
    return message.some((part) => typeof part === "string" && part.trim() !== "");
  }
  return typeof message === "string" && message.trim() !== "";
}

/**
 * The sentence for a failed gallery read (R-7), in the shape
 * `describeAssetImageUploadError` already uses: the API's own words when the
 * body is an envelope that has them, a fixed sentence otherwise.
 *
 * The first version read `apiErrorMessage(bodyText) || "Object storage is
 * unavailable."`. That fallback was dead — `apiErrorMessage("")` answers
 * "The request failed.", never `""` — so an empty 503 body rendered the
 * generic failure line and a non-envelope 503 rendered `adminFetch`'s own
 * `admin /assets/<uuid>/images 503` text.
 */
export function describeGalleryError(status: number, bodyText: string): string {
  if (status !== 503) {
    return "Images unavailable.";
  }
  return isEnvelopeWithMessage(bodyText) ? apiErrorMessage(bodyText) : "Object storage is unavailable.";
}
