import { afterEach, describe, it, vi } from "vitest";

import {
  blobReadThrowsApiErrorCarryingA503,
  deleteResolvesOnA204,
  deleteThrowsApiErrorCarryingA404,
  uploadOmitsABlankCaption,
  uploadSendsOneFileAndTheTrimmedCaption,
} from "./asset-images.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node`
 * default, not jsdom.
 */
describe("F3.4 asset-images web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends exactly one file part and the trimmed caption", async () => {
    await uploadSendsOneFileAndTheTrimmedCaption();
  });

  it("omits the caption part entirely when the caption is blank", async () => {
    await uploadOmitsABlankCaption();
  });

  it("resolves with undefined when the delete answers 204", async () => {
    await deleteResolvesOnA204();
  });

  it("throws an ApiError carrying 404 when the image is gone", async () => {
    await deleteThrowsApiErrorCarryingA404();
  });

  it("throws an ApiError carrying 503 when object storage is unreachable", async () => {
    await blobReadThrowsApiErrorCarryingA503();
  });
});
