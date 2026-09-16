import { assetImageDtoSchema, assetImageListResponseSchema } from "@bms/shared/contracts";
import type { AssetImageDto } from "@bms/shared";

import { ApiError } from "../lib/api-error";
import { adminFetch } from "./admin/client";
import { clearSessionOnAuthFailure, withAuth } from "./http";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F3.4` Unit 7 — the client for the asset-image routes (ADR 0066 decisions 4
 * and 7).
 *
 * ## Why `adminFetch` on routes that are not admin routes
 *
 * `/assets/:assetId/images` is gated by `canReadAsset`, not by the master-data
 * role, so on the name alone the plain-`fetch` shape of `asset-health.ts`
 * would look like the closer precedent. Two things make `adminFetch` the right
 * one anyway, and neither is about admin:
 *
 * - it runs the response through `checkResponse` against the ADR 0030 schema,
 *   which is what stops a drifted DTO reaching a component as `undefined`; and
 * - it throws **`ApiError`, which carries the status**. R-7 renders the API's
 *   own sentence on a 503 (object storage not configured / unreachable) and
 *   "Images unavailable." on everything else, and that branch is unreachable
 *   from a plain `Error` whose message is all a caller gets.
 *
 * The two routes that return no JSON cannot use it: `DELETE` answers 204 with
 * an empty body, and the content route answers image bytes. Both are a local
 * `fetch` that reproduces `adminFetch`'s refusal handling — `clearSessionOnAuthFailure`
 * first, then an `ApiError` carrying the status — rather than a plain `Error`,
 * so a caller cannot tell where the sentence came from.
 */

/** `GET /api/v1/assets/:assetId/images` — the asset's images, newest first. */
export async function fetchAssetImages(assetId: string): Promise<AssetImageDto[]> {
  return adminFetch(
    `/assets/${encodeURIComponent(assetId)}/images`,
    assetImageListResponseSchema,
  );
}

/**
 * `GET /api/v1/assets/:assetId/images/:imageId/content` — the image bytes.
 *
 * **A bare `<img src="…/content">` cannot authenticate.** `JwtAuthGuard` reads
 * `headers.authorization` only, and a browser sends no `Authorization` header
 * on an `<img>` request, so the element would render a 401. Every thumbnail is
 * therefore this `fetch` plus `URL.createObjectURL` — see `use-asset-images.ts`
 * for the revocation that pairs with it.
 */
export async function fetchAssetImageBlob(assetId: string, imageId: string): Promise<Blob> {
  const res = await fetch(
    `${base}/api/v1/assets/${encodeURIComponent(assetId)}/images/${encodeURIComponent(imageId)}/content`,
    withAuth(),
  );
  if (!res.ok) {
    // Before the body is read: `res.text()` on a broken stream rejects, and an
    // ordering that read it first would skip the clear on exactly the failures
    // that most need it (`onboarding.ts`'s rule).
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new ApiError(text || `asset image content ${res.status}`, res.status);
  }
  return res.blob();
}

/**
 * `POST /api/v1/assets/:assetId/images` — one file and an optional caption.
 *
 * **The caption part is appended only when it is non-empty after trimming.**
 * The route's `FileInterceptor` is configured `files: 1, fields: 2`, so a part
 * is a scarce slot, and a `caption` of `""` costs one of them to send what the
 * service maps straight back to `null`.
 *
 * `adminFetch` carries the `FormData` body unchanged, and that is measured
 * rather than assumed: it passes `init` through `withAuth`, which only does
 * `new Headers(init.headers)` and spreads the rest, and neither function sets
 * `Content-Type` — so the platform sets `multipart/form-data` with its own
 * boundary. A hard-wired JSON content type would have forced the local-`fetch`
 * shape the two siblings below use.
 */
export async function uploadAssetImage(
  assetId: string,
  file: File,
  caption: string,
): Promise<AssetImageDto> {
  const form = new FormData();
  form.append("file", file);
  const trimmed = caption.trim();
  if (trimmed !== "") {
    form.append("caption", trimmed);
  }
  return adminFetch(`/assets/${encodeURIComponent(assetId)}/images`, assetImageDtoSchema, {
    method: "POST",
    body: form,
  });
}

/**
 * `DELETE /api/v1/assets/:assetId/images/:imageId` — 204, no body.
 *
 * The success test is `status === 204` rather than `res.ok`, deliberately: the
 * route is declared `@HttpCode(HttpStatus.NO_CONTENT)` and any other 2xx from
 * this path would mean the client is talking to something that is not it.
 */
export async function deleteAssetImage(assetId: string, imageId: string): Promise<void> {
  const res = await fetch(
    `${base}/api/v1/assets/${encodeURIComponent(assetId)}/images/${encodeURIComponent(imageId)}`,
    withAuth({ method: "DELETE" }),
  );
  if (res.status === 204) {
    return;
  }
  clearSessionOnAuthFailure(res);
  const text = await res.text();
  throw new ApiError(text || `asset image delete ${res.status}`, res.status);
}
