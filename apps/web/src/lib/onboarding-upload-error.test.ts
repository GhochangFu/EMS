import { describe, it } from "vitest";

import {
  aBlankBodyKeepsTheStatus,
  anEnvelopeRendersOnlyItsSentence,
  anUnrecognisedBodyPassesThrough,
  aPayloadTooLargeAlwaysNamesTheLimit,
} from "./onboarding-upload-error.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.106 onboarding upload error", () => {
  it("names the 5 MB limit for a 413, whatever the body is", () => {
    aPayloadTooLargeAlwaysNamesTheLimit();
  });

  it("renders a Nest envelope as its sentence alone", () => {
    anEnvelopeRendersOnlyItsSentence();
  });

  it("keeps the status when the body is blank", () => {
    aBlankBodyKeepsTheStatus();
  });

  it("passes an unrecognised body through unchanged", () => {
    anUnrecognisedBodyPassesThrough();
  });
});
