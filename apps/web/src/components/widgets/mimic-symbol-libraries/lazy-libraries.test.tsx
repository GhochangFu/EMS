// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFailedLoadIsRetried,
  aGlyphDrawsASkeletonThenItsShapes,
  aLazyKeyHasShapesOnlyAfterItsLoad,
  aLazyNoticeArrivesWithItsLoad,
  aLoadReadsOnlyTheLibrariesAskedFor,
  aStaleLazyKeyDrawsTheFallbackAfterTheLoad,
  aStaticKeyNeedsNoLoad,
  everyNonCoreLibraryHasANoticeAfterTheLoad,
} from "./lazy-libraries.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); jsdom opts in here (ADR 0042). */
describe("F3.32h the qet, wmpid and drawio libraries load on first use", () => {
  afterEach(() => {
    cleanup();
    vi.doUnmock("./qet.generated");
  });

  it("L1 a lazy key has shapes only after its load", async () => {
    await aLazyKeyHasShapesOnlyAfterItsLoad();
  });
  it("L2 a load reads only the libraries asked for", async () => {
    await aLoadReadsOnlyTheLibrariesAskedFor();
  });
  it("L3 a static key needs no load", async () => {
    await aStaticKeyNeedsNoLoad();
  });
  it("L4 a lazy notice arrives with its load", async () => {
    await aLazyNoticeArrivesWithItsLoad();
  });
  it("L4b every non-core library has a notice after the load", async () => {
    await everyNonCoreLibraryHasANoticeAfterTheLoad();
  });
  it("L5 a failed load is retried", async () => {
    await aFailedLoadIsRetried();
  });
  it("L6 a glyph draws a skeleton, then its shapes", async () => {
    await aGlyphDrawsASkeletonThenItsShapes();
  });
  it("L7 a stale lazy key draws the fallback after the load", async () => {
    await aStaleLazyKeyDrawsTheFallbackAfterTheLoad();
  });
});
