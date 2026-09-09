import { describe, it } from "vitest";

import {
  runArrayMessageTests,
  runEmptyZodFlattenTests,
  runEnvelopeErrorWinsOverFieldErrorsTests,
  runEnvelopeMessageWinsOverFieldErrorsTests,
  runFallbackTests,
  runNestEnvelopeTests,
  runNonErrorTests,
  runZodFlattenFieldErrorTests,
  runZodFlattenFormErrorTests,
} from "./api-error-message.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("api error message", () => {
  it("shows the sentence, not the JSON envelope around it", () => {
    runNestEnvelopeTests();
  });

  it("keeps every sentence of a validation array", () => {
    runArrayMessageTests();
  });

  it("passes a non-envelope body through unchanged", () => {
    runFallbackTests();
  });

  it("handles a throw that is not an Error", () => {
    runNonErrorTests();
  });

  // `F4.106` — the shape four onboarding routes throw, which this function used
  // to hand back as raw JSON. One `it()` per claim, so a mutation reddens the
  // case it belongs to instead of the first assertion in a shared function.
  it("names the field and its message in a Zod flatten", () => {
    runZodFlattenFieldErrorTests();
  });

  it("renders a formErrors-only body without inventing a field name", () => {
    runZodFlattenFormErrorTests();
  });

  it("still prefers the envelope message when both shapes are present", () => {
    runEnvelopeMessageWinsOverFieldErrorsTests();
  });

  // The other half of the same claim. Split into its own `it()` because a
  // mutation that moves the flatten branch above `error` alone must redden this
  // one and leave the case above green — which is only readable if they are
  // separate.
  it("still prefers the envelope error when both shapes are present", () => {
    runEnvelopeErrorWinsOverFieldErrorsTests();
  });

  it("shows the server's body when a flatten carries nothing usable", () => {
    runEmptyZodFlattenTests();
  });
});
