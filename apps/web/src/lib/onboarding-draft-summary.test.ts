import { describe, it } from "vitest";

import {
  aLegacyTopicIsPrinted,
  anEmptyTopicBesideALegacyKeyPrintsADash,
  theTopicKeyWinsOverTheLegacyKey,
  anAbsentTopicPrintsADash,
  aNonStringTopicFallsBackToTheLegacyKey,
  aPlainAssetLineIsUnchanged,
  aStockEntryListsItsPatterns,
  aStockEntryRendersItsLine,
  aTemplatedAssetNamesItsTemplate,
  anAuthoredTemplateRendersItsLine,
  anEmptyDraftSaysSo,
} from "./onboarding-draft-summary.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.22 onboarding draft summary", () => {
  it("renders an authored template line and every point under it", () => {
    anAuthoredTemplateRendersItsLine();
  });

  it("renders a stock template line", () => {
    aStockEntryRendersItsLine();
  });

  it("lists a stock template's pattern overrides", () => {
    aStockEntryListsItsPatterns();
  });

  it("renders a templated asset with its template and version", () => {
    aTemplatedAssetNamesItsTemplate();
  });

  it("leaves a plain asset line unchanged", () => {
    aPlainAssetLineIsUnchanged();
  });

  it("renders an empty draft as empty", () => {
    anEmptyDraftSaysSo();
  });

  it("prints a legacy mqttTopic (F4.234)", () => {
    aLegacyTopicIsPrinted();
  });

  it("prints a dash for an empty topic beside a legacy key (F4.234)", () => {
    anEmptyTopicBesideALegacyKeyPrintsADash();
  });

  it("prefers topic over mqttTopic (F4.234)", () => {
    theTopicKeyWinsOverTheLegacyKey();
  });

  it("prints a dash for an absent topic (F4.234)", () => {
    anAbsentTopicPrintsADash();
  });

  it("skips a non-string topic (F4.234)", () => {
    aNonStringTopicFallsBackToTheLegacyKey();
  });
});
