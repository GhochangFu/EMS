import { describe, it } from "vitest";

import {
  aFillCarriesItsRecordParams,
  aFillWithoutItsRecordIsRefused,
  anOpenWizardWithAnExtraKeyIsRefused,
  aTurnBodyHoldsAtMostEightWizards,
  aTurnBodyNamesItsOpenWizards,
  aTurnBodyWithoutWizardsIsRefused,
} from "./copilot-wizards.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.245 — a turn names its open wizards and a fill names its record (ADR 0099 Amendment 4)", () => {
  it("refuses a fill without params", () => aFillWithoutItsRecordIsRefused());
  it("keeps a fill's params", () => aFillCarriesItsRecordParams());
  it("parses a turn body naming its open wizards", () => aTurnBodyNamesItsOpenWizards());
  it("refuses a turn body without wizards", () => aTurnBodyWithoutWizardsIsRefused());
  it("refuses a ninth wizard", () => aTurnBodyHoldsAtMostEightWizards());
  it("refuses an open wizard with an extra key", () => anOpenWizardWithAnExtraKeyIsRefused());
});
