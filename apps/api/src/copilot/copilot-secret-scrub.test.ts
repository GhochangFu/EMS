import { describe, it } from "vitest";

import {
  assertArgumentsAreWalkedForCredentials,
  assertAToolResultIsScrubbedAtAnyDepth,
  assertHistoryIsScrubbedThenCut,
  assertTheMarkersDoNotMatchThemselves,
} from "./copilot-secret-scrub.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). */
describe("F3.85 PR 7 — the copilot secret scrub (ADR 0099 decision 9, ADR 0022)", () => {
  it("its markers do not match the detector", () => assertTheMarkersDoNotMatchThemselves());
  it("scrubs history before it cuts it", () => assertHistoryIsScrubbedThenCut());
  it("scrubs a tool result at any depth", () => assertAToolResultIsScrubbedAtAnyDepth());
  it("walks tool arguments for credentials", () => assertArgumentsAreWalkedForCredentials());
});
