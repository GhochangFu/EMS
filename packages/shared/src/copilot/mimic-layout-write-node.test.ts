import { describe, it } from "vitest";

import {
  aPanelsWriteNodeParses,
  aStoredListIsCarriedInOrder,
  anEmptyListIsCarriedAsEmpty,
  theBodyGuideNamesPointKeys,
} from "./mimic-layout-write-node.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.307 — writeNodeOfDto and the layout body guide carry pointKeys", () => {
  it("carries a stored point list in order", () => aStoredListIsCarriedInOrder());
  it("carries an empty point list as [], not absent", () => anEmptyListIsCarriedAsEmpty());
  it("a stored panel's write node parses as a PUT node", () => aPanelsWriteNodeParses());
  it("the body guide names pointKeys", () => theBodyGuideNamesPointKeys());
});
