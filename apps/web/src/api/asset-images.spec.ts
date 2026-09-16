import { expect, vi } from "vitest";

import { assetImageDtoSchema } from "@bms/shared/contracts";
import type { AssetImageDto } from "@bms/shared";

import { ApiError } from "../lib/api-error";
import {
  deleteAssetImage,
  fetchAssetImageBlob,
  uploadAssetImage,
} from "./asset-images";

/**
 * `F3.4` Unit 7 — the asset-images web client.
 *
 * ## Environment
 *
 * `node`, like every other `api/*.spec.ts` here. `api-error.ts` warns that
 * importing a module which reads `import.meta.env` at module scope drags
 * Vite's environment into a node test; `api/admin/onboarding.spec.ts` settled
 * that empirically for exactly this shape (the web project merges the app's
 * Vite config, and `validate.test.ts` records the measured
 * `{ DEV: true, MODE: "test" }`). `File` and `FormData` are Node 20 globals
 * and the repo ships Node 20.
 *
 * ## What each claim is for
 *
 * The upload rows are the only place the multipart body is observable — the
 * request never leaves the process, so the assertion reads `init.body`
 * directly. They are the gate on the one thing the API cannot repair: multer
 * is configured `files: 1, fields: 2`, so a second `file` part is a 400 and a
 * `caption` part carrying `""` spends one of the two field slots to send
 * nothing.
 *
 * Every DTO fixture is built through `assetImageDtoSchema.parse` (the
 * `mapping-sheet-panel.spec.tsx` precedent): `adminFetch` runs `checkResponse`,
 * which **throws** under test, so an off-shape fixture would fail inside the
 * client and the failure would not name the claim under test.
 */

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_ID = "22222222-2222-4222-8222-222222222222";

/** A response DTO the contract accepts, so `checkResponse` is never the thing that fails. */
const DTO: AssetImageDto = assetImageDtoSchema.parse({
  id: IMAGE_ID,
  assetId: ASSET_ID,
  contentType: "image/png",
  byteSize: 2048,
  sha256: "a".repeat(64),
  originalFilename: "panel.png",
  caption: "Front panel",
  createdBy: "33333333-3333-4333-8333-333333333333",
  createdAt: "2026-09-16T10:00:00.000Z",
});

function pngFile(): File {
  return new File(["x"], "panel.png", { type: "image/png" });
}

/**
 * Captures the `init` of the single request the call under test makes, and
 * answers with one status and one body.
 *
 * The captured value is per-call state held in a closure rather than a
 * module-level counter — a lifetime count across the asserts in this file
 * would be exactly the shape AGENTS.md §4.6 forbids.
 */
function captureFetch(status: number, body: BodyInit | null): () => RequestInit {
  let seen: RequestInit = {};
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    seen = init ?? {};
    return new Response(body, { status });
  });
  return () => seen;
}

/** The body of the captured request, typed as the `FormData` the client builds. */
function form(init: RequestInit): FormData {
  if (!(init.body instanceof FormData)) {
    throw new Error(`expected a FormData body, got ${Object.prototype.toString.call(init.body)}`);
  }
  return init.body;
}

/**
 * The error a rejected call carried.
 *
 * It throws when the promise **resolves**, because "no error was thrown" would
 * otherwise pass every assertion below by never reaching them — the absence
 * shape this repository keeps being caught by (`onboarding.spec.ts`).
 */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to reject, and it resolved");
}

/**
 * A1 — the upload sends exactly one `file` part and the caption it was given,
 * trimmed.
 *
 * `getAll("file")` rather than `get("file")`: `get` returns the first entry and
 * would be blind to a second `append` that multer's `files: 1` limit refuses
 * with a 400.
 */
export async function uploadSendsOneFileAndTheTrimmedCaption(): Promise<void> {
  const seen = captureFetch(201, JSON.stringify(DTO));

  await uploadAssetImage(ASSET_ID, pngFile(), "  Front panel  ");

  const body = form(seen());
  expect(body.getAll("file")).toHaveLength(1);
  expect(body.get("caption")).toBe("Front panel");
}

/**
 * A2 — a caption that is empty after trimming is not appended at all.
 *
 * The `file` check is the positive control and runs **first**: `assert` throws,
 * so an assertion order that put the absence first would let "the request was
 * never built" masquerade as "the caption was omitted".
 */
export async function uploadOmitsABlankCaption(): Promise<void> {
  const seen = captureFetch(201, JSON.stringify(DTO));

  await uploadAssetImage(ASSET_ID, pngFile(), "   ");

  const body = form(seen());
  expect(body.getAll("file")).toHaveLength(1);
  expect(body.getAll("caption")).toHaveLength(0);
}

/**
 * A3 — a 204 delete resolves with `undefined`.
 *
 * `new Response(null, …)`, not `new Response("", …)`: undici refuses a body on
 * a 204, and the wrong one throws before the client is reached.
 */
export async function deleteResolvesOnA204(): Promise<void> {
  captureFetch(204, null);

  await expect(deleteAssetImage(ASSET_ID, IMAGE_ID)).resolves.toBeUndefined();
}

/** A4 — a 404 delete throws an `ApiError` carrying the status the panel renders on. */
export async function deleteThrowsApiErrorCarryingA404(): Promise<void> {
  captureFetch(404, JSON.stringify({ statusCode: 404, message: "Asset image not found" }));

  const err = await rejection(deleteAssetImage(ASSET_ID, IMAGE_ID));

  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).status).toBe(404);
}

/**
 * A5 — a 503 from the content route throws an `ApiError` carrying 503.
 *
 * The status is the whole reason this path does not throw a plain `Error` like
 * `asset-health.ts` does: R-7 renders the API's own sentence on a 503 and a
 * generic one otherwise, and it cannot tell them apart without the number.
 */
export async function blobReadThrowsApiErrorCarryingA503(): Promise<void> {
  captureFetch(503, JSON.stringify({ statusCode: 503, message: "Object storage is unreachable" }));

  const err = await rejection(fetchAssetImageBlob(ASSET_ID, IMAGE_ID));

  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).status).toBe(503);
}
