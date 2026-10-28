import { describe, it } from "vitest";

import * as spec from "./copilot-time-range.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.291 — the copilot's time-range arguments (owner ruling P3)", () => {
  it("to before from is refused", spec.assertToBeforeFromIsRefused);
  it("exactly 31 days is accepted under a 31-day bound", spec.assertExactlyThirtyOneDaysIsAccepted);
  it("31 days and one second is refused under a 31-day bound", spec.assertThirtyOneDaysAndASecondIsRefused);
  it("no maxDays is no bound", spec.assertNoMaxDaysIsNoBound);
  it("lastDays together with from or to is refused", spec.assertLastDaysWithFromOrToIsRefused);
  it("lastDays is an integer from 1 to 31", spec.assertLastDaysIsOneToThirtyOne);
  it("a required range needs lastDays or both from and to", spec.assertARequiredRangeNeedsOne);
  it("lastDays resolves to [now - lastDays, now) on the turn's clock", spec.assertLastDaysResolvesAgainstNow);
  it("from and to resolve as given; none resolves to no bound", spec.assertFromAndToResolveAsGiven);
  it("an instant before 1970 or more than a day past now is refused", spec.assertAnInstantOffTheClockIsRefused);
});
