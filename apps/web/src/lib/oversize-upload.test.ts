import { describe, it } from "vitest";

import {
  aPayloadTooLargeGetsTheFiveMegabyteSentence,
  everyOtherStatusIsNull,
} from "./oversize-upload.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.106 oversize upload message", () => {
  it("gives the 5 MB sentence for a 413", () => {
    aPayloadTooLargeGetsTheFiveMegabyteSentence();
  });

  it("gives null for every other status, so each caller keeps its own wording", () => {
    everyOtherStatusIsNull();
  });
});
