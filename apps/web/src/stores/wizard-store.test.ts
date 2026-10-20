import { afterEach, describe, it } from "vitest";

import { resetWizardStore } from "./wizard-store";
import {
  aFillForTheOpenedPageWaitsForItsWizard,
  aFillWithBadParamsIsDropped,
  aFillWithNoOpenMatchAndNoPageIsDropped,
  anotherRecordsWizardDoesNotTakeTheFill,
  aRegisteredWizardIsOpenUntilItUnregisters,
  aWaitingFillIsDroppedWhenItsWizardUnregisters,
  aWaitingFillIsDroppedWhenTheUserLeavesThePage,
  theFillForTheOpenRecordIsTakenByIt,
  twoCopiesOfOneRecordAreNamedOnce,
} from "./wizard-store.spec";

afterEach(() => resetWizardStore());

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.245 — the wizard store hands a fill only to its record's wizard (ADR 0099 Amendment 4)", () => {
  it("keeps a registered wizard open until it unregisters", () => aRegisteredWizardIsOpenUntilItUnregisters());
  it("names two copies of one record once", () => twoCopiesOfOneRecordAreNamedOnce());
  it("hands the open record's fill to it once", () => theFillForTheOpenRecordIsTakenByIt());
  it("never hands A's fill to B's wizard", () => anotherRecordsWizardDoesNotTakeTheFill());
  it("drops a fill with no open match and no page to wait for", () => aFillWithNoOpenMatchAndNoPageIsDropped());
  it("keeps a fill for the opened page until its wizard mounts", () => aFillForTheOpenedPageWaitsForItsWizard());
  it("drops a waiting fill when the user leaves the page", () => aWaitingFillIsDroppedWhenTheUserLeavesThePage());
  it("drops a waiting fill when its wizard unregisters", () => aWaitingFillIsDroppedWhenItsWizardUnregisters());
  it("drops a fill whose params the entry refuses", () => aFillWithBadParamsIsDropped());
});
