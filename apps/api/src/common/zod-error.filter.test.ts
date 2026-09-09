import { describe, it } from "vitest";

import {
  assertAMalformedIdLandsInFormErrorsNotFieldErrors,
  assertAMalformedParameterAnswers400,
  assertANonHttpHostRethrowsTheOriginalError,
  assertMainRegistersTheFilterGlobally,
  assertTheBodyIsTheFlattenedErrorAndNothingElse,
  assertTheFilterCatchesZodError,
  assertTheFilterDoesNotCatchTheStoredContractFault,
  assertZodIsOneClassForTheResolutionTheApiRunsUnder,
} from "./zod-error.filter.spec";

/** `F4.108` / ADR 0060 — Vitest entry point (§4.6). */
describe("ADR 0060 — one ZodError filter answers a malformed parameter", () => {
  it("answers 400 where the route used to answer 500", () => {
    assertAMalformedParameterAnswers400();
  });

  it("answers the flattened error and no Nest envelope", () => {
    assertTheBodyIsTheFlattenedErrorAndNothingElse();
  });

  it("puts a malformed id in formErrors, not fieldErrors", () => {
    assertAMalformedIdLandsInFormErrorsNotFieldErrors();
  });

  it("re-throws rather than answering on a non-HTTP host", () => {
    assertANonHttpHostRethrowsTheOriginalError();
  });

  // Two `it()`s, not one with two assertions: `@Catch()` empties the caught set,
  // so it reddens the first and the second would never run — the mutation could
  // not reach the assertion holding its claim (§4.6). `@Catch(Error)` is the
  // second one's mutation.
  it("catches ZodError", () => {
    assertTheFilterCatchesZodError();
  });

  it("does not catch the server fault parseStoredContract raises", () => {
    assertTheFilterDoesNotCatchTheStoredContractFault();
  });

  it("resolves one zod class for the CommonJS resolution the API runs under", () => {
    assertZodIsOneClassForTheResolutionTheApiRunsUnder();
  });

  it("is registered globally in main.ts", () => {
    assertMainRegistersTheFilterGlobally();
  });
});
