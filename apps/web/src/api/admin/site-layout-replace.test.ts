import { afterEach, describe, it, vi } from "vitest";

import {
  aPreviewOffContractIsRefused,
  bulkReplacePostsWithNoBody,
  previewsGetTheirPaths,
  replacePostsTheBody,
  replaceReadsTheAmbiguousBodyAndThrowsOtherwise,
} from "./site-layout-replace.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). No
 * `@vitest-environment` docblock: the project's `node` default.
 */
describe("F4.320 PR 2 Replace clients — what they put on the wire", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("R1 POSTs the body to /admin/locations/:id/site-layout/replace and answers replaced", async () => {
    await replacePostsTheBody();
  });

  it("R2 answers the 409 body's ambiguous tabs, and throws ApiError on any other 409", async () => {
    await replaceReadsTheAmbiguousBodyAndThrowsOtherwise();
  });

  it("R3 POSTs the bulk Replace with no body", async () => {
    await bulkReplacePostsWithNoBody();
  });

  it("R4 GETs the per-site and the bulk preview", async () => {
    await previewsGetTheirPaths();
  });

  it("R5 refuses a preview answer off the contract", async () => {
    await aPreviewOffContractIsRefused();
  });
});
