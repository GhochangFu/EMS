import { describe, it } from "vitest";

import {
  assertAHeldSlugIsOneLineNamingBothRows,
  assertAHeldValueWithNoRowIsNotInserted,
  assertAnAmbiguousClaimIsOneLineNamingEveryCandidate,
  assertElevenDistinctSeedKeys,
  assertEveryCanonicalKeyIsItsSlug,
  assertOnlyARowWithoutItsCodeIsSkipped,
  assertTheRtuStepRunsAfterTheSeedRowsAndSkipsTheirHeldCodes,
  assertTheSeedReadsSlugHoldersAsTheSuperuser,
} from "./eskom-locations-seed.spec";

describe("F4.169/F4.170 addendum 2 — ruling 16: the seed finds its locations by a stable key", () => {
  it("keys every canonical ESKOM location on its slug", () => {
    assertEveryCanonicalKeyIsItsSlug();
  });

  it("gives eleven distinct keys, ESK-DECOMM-01's included", () => {
    assertElevenDistinctSeedKeys();
  });

  it("logs one line naming both rows for a held slug", () => {
    assertAHeldSlugIsOneLineNamingBothRows();
  });

  it("logs one not-inserted line for a held value on a missing row", () => {
    assertAHeldValueWithNoRowIsNotInserted();
  });

  it("logs one line naming every candidate for an ambiguous claim", () => {
    assertAnAmbiguousClaimIsOneLineNamingEveryCandidate();
  });

  it("reads slug holders on the superuser pool in seed.ts (OQ2)", () => {
    assertTheSeedReadsSlugHoldersAsTheSuperuser();
  });
});

describe("F4.169/F4.170 addendum 3 — ruling 17: later steps use the resolved rows", () => {
  it("skips only a written row whose canonical code another row holds", () => {
    assertOnlyARowWithoutItsCodeIsSkipped();
  });

  it("writes ESK-DECOMM-01 before the RTU step, which gets both outcomes' skip set", () => {
    assertTheRtuStepRunsAfterTheSeedRowsAndSkipsTheirHeldCodes();
  });
});
