import { describe, it } from "vitest";

import {
  aFlaggedEntryStoresTheTargetsStamp,
  aFlaggedEntryWithoutAStampStoresNothing,
  anUnflaggedEntryStoresNoPrecondition,
} from "./copilot-propose-tools.precondition.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.247 — the propose tool stores the precondition (ADR 0099 Amendment 5 C1)", () => {
  it("stores the target's updatedAt for a flagged entry", () => aFlaggedEntryStoresTheTargetsStamp());
  it("stores no precondition for an unflagged entry", () => anUnflaggedEntryStoresNoPrecondition());
  it("refuses a flagged entry whose target read no stamp, storing nothing", () => aFlaggedEntryWithoutAStampStoresNothing());
});
