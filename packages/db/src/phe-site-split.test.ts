import { describe, it } from "vitest";

import {
  assertAnUnknownStationCodeThrows,
  assertLotapataSplitSites,
  assertTheGateExemptsAllButAPhewbSlugHolder,
  assertTheHolderRule,
  assertTheRtuTargetOrder,
  assertTheSeedRefusesABadListBeforeAnyQuery,
  assertTheSplitListIsNotInTheThrowOnEmptySet,
  assertTheSuffixRuleOnTheRealNames,
} from "./phe-site-split.spec";

describe("F4.388 — the PHE split path, pure halves (ADR 0139)", () => {
  it("cuts the site-code suffix from the 12 real RTU names", () => {
    assertTheSuffixRuleOnTheRealNames();
  });

  it("derives Lotapata's two split sites with four assets each, and none for the committed list", () => {
    assertLotapataSplitSites();
  });

  it("throws on a split code that is not a catalog station's", () => {
    assertAnUnknownStationCodeThrows();
  });

  it("refuses an unknown code, and a list with no holder reader, before any query", async () => {
    await assertTheSeedRefusesABadListBeforeAnyQuery();
  });

  it("keeps the split list out of the throw-on-empty set", () => {
    assertTheSplitListIsNotInTheThrowOnEmptySet();
  });

  it("adopts only the site itself and names the kind of every other holder", () => {
    assertTheHolderRule();
  });

  it("exempts every skipped site from the gate but one a PHEWB slug holder blocks", () => {
    assertTheGateExemptsAllButAPhewbSlugHolder();
  });

  it("writes an RTU at its site, else where it sits, else at the station", () => {
    assertTheRtuTargetOrder();
  });
});
