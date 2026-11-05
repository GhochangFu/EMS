import { describe, it } from "vitest";

import * as spec from "./site-segment-views.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.302 — the segment-views contract (ADR 0108 Amendment 4, ADR 0030)", () => {
  it("refuses an unknown query key (strict)", () => spec.assertTheQueryRefusesAnUnknownKey());
  it("refuses organizationId and locationIds", () => spec.assertTheQueryRefusesOrganizationIdAndLocationIds());
  it("refuses a segment or point that is not a catalog code", () => spec.assertTheQueryRefusesABadSegmentCode());
  it("refuses a bad range and a missing one", () => spec.assertTheQueryRefusesABadRange());
  it("accepts each of the seven ranges and compare=previous", () => spec.assertTheQueryAcceptsEachRangeAndCompare());
  it("parses a response with null buckets", () => spec.assertTheResponseParsesWithNullBuckets());
  it("parses every verdict value", () => spec.assertTheResponseParsesEveryVerdict());
  it("refuses a fifth verdict", () => spec.assertTheResponseRefusesAFifthVerdict());
  it("pins the four constants", () => spec.assertTheConstantsArePinned());
  it("keeps the below ratio under 1 and the above ratio over it", () => spec.assertTheRatiosStraddleOne());
});

describe("F4.316 — a ranking and an abnormal entry name the RTU and location (ADR 0111)", () => {
  it("refuses a ranking entry without assetLocationName", () =>
    spec.assertARankingEntryWithoutTheLocationNameIsRefused());
  it("refuses an abnormal entry without assetRtuName", () => spec.assertAnAbnormalEntryWithoutTheRtuNameIsRefused());
  it("parses an RTU-less asset in both lists", () => spec.assertAnRtuLessAssetParsesInBothLists());
});
