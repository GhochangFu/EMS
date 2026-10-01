import { afterEach, describe, it, vi } from "vitest";

import {
  fetchResolvedSiteControlRoomViewHitsTheResolvePath,
  fetchResolvedSiteControlRoomViewThrowsOn404,
  fetchResolvedSiteControlRoomViewThrowsOnSchemaMismatch,
  makeSiteLayoutPostsTheBody,
  makeSiteLayoutReadsTheAmbiguousBody,
  makeSiteLayoutThrowsOnAnotherConflict,
} from "./control-room.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014,
 * §4.6). No `@vitest-environment` docblock: this file wants the project's
 * `node` default, not jsdom.
 */
describe("F3.66 U2 control-room resolve-read client — what it puts on the wire", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the resolve read to /api/v1/control-room/sites/:locationId/view with the bearer token", async () => {
    await fetchResolvedSiteControlRoomViewHitsTheResolvePath();
  });

  it("throws on a 404 (off-scope site), with the status in the message", async () => {
    await fetchResolvedSiteControlRoomViewThrowsOn404();
  });

  it("throws when the body fails the contract", async () => {
    await fetchResolvedSiteControlRoomViewThrowsOnSchemaMismatch();
  });
});

describe("F3.73 makeSiteLayout client — what it puts on the wire", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("A4 POSTs the body as JSON to /admin/locations/:id/site-layout and answers made", async () => {
    await makeSiteLayoutPostsTheBody();
  });

  it("A5 answers the 409 body's ambiguous candidates", async () => {
    await makeSiteLayoutReadsTheAmbiguousBody();
  });

  it("A6 throws ApiError with the status on any other 409", async () => {
    await makeSiteLayoutThrowsOnAnotherConflict();
  });
});
