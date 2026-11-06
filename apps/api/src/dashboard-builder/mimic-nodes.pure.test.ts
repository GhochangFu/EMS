import { describe, it } from "vitest";

import { aNodeThatListsNothingGivesAnEmptyList, aPumpStationNodePassesItsPointKeysOn } from "./mimic-nodes.pure.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.319 — presetRoledNodes passes a preset node's pointKeys on (ADR 0113 decision 2)", () => {
  it("gives a pump-station node its listed points", () => {
    aPumpStationNodePassesItsPointKeysOn();
  });

  it("gives a node that lists nothing an empty list", () => {
    aNodeThatListsNothingGivesAnEmptyList();
  });
});
