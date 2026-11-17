import { describe, it } from "vitest";

import {
  aBadQueryIs400BeforeNarrow,
  forAssetChecksTheIdThenTheScopeThenReads,
  listHandsNarrowsValueToTheService,
  narrowGetsExactlyTheParsedKeys,
} from "./advisories.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.6a — AdvisoriesController (ADR 0137)", () => {
  it("list hands narrow's value (an array, [] or null) to the service unchanged, with one clock", () =>
    listHandsNarrowsValueToTheService());
  it("narrow receives exactly the parsed keys", () => narrowGetsExactlyTheParsedKeys());
  it("a bad query is a 400 and narrow is never called", () => aBadQueryIs400BeforeNarrow());
  it("forAsset: the id (400), then canReadAsset (403), then the service with [assetId]", () =>
    forAssetChecksTheIdThenTheScopeThenReads());
});
