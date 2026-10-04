import { describe, it } from "vitest";

import {
  aPlainAssetLineIsUnchanged,
  aStockEntryRendersItsLine,
  aTemplatedAssetNamesItsTemplate,
  anAuthoredTemplateRendersItsLine,
  anEmptyDraftSaysSo,
} from "./onboarding-draft-summary.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.22 onboarding draft summary", () => {
  it("renders an authored template line", () => {
    anAuthoredTemplateRendersItsLine();
  });

  it("renders a stock template line", () => {
    aStockEntryRendersItsLine();
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
});
