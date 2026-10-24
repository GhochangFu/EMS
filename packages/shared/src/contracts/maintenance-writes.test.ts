import { describe, it } from "vitest";

import {
  eachDirectionModelBodyFixesActive,
  theCreateBodyFillsItsDefaults,
  theCreateBodyRefusesAFirstDueAtWithoutAnInstant,
  theCreateBodyRefusesAnUnknownKey,
  theScheduleItemRequiresActive,
  theUpdateBodyRefusesAShortReason,
  theUpdateBodyRequiresActive,
} from "./maintenance-writes.spec";

/** `F4.281` — Vitest entry point for the maintenance write bodies. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.281 — maintenance schedule write bodies (ADR 0030)", () => {
  it("the create body refuses an unknown key", () => theCreateBodyRefusesAnUnknownKey());
  it("the create body fills priority medium and 60 minutes", () => theCreateBodyFillsItsDefaults());
  it("the create body refuses a firstDueAt without an instant", () => theCreateBodyRefusesAFirstDueAtWithoutAnInstant());
  it("the update body requires active", () => theUpdateBodyRequiresActive());
  it("the update body refuses a reason under 3 characters", () => theUpdateBodyRefusesAShortReason());
  it("each direction's model body fixes active", () => eachDirectionModelBodyFixesActive());
  it("a schedule list item requires active", () => theScheduleItemRequiresActive());
});
