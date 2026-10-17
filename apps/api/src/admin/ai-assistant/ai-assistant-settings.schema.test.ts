import { describe, it } from "vitest";

import {
  assertPutBoundsTheKey,
  assertPutIsStrict,
  assertPutRefusesAKeyWithOff,
  assertPutRefusesAVisionModelWithOff,
  assertPutRequiresAModelUnlessOff,
  assertPutTakesAnOptionalVisionModel,
  assertTestRefusesOff,
  assertTestTakesAnOptionalVisionModel,
} from "./ai-assistant-settings.schema.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("AI-assistant settings request bodies (F3.21, ADR 0090 Amendment 1 A5)", () => {
  it("refuses the response's own fields in a PUT", () => {
    assertPutIsStrict();
  });

  it("requires a model unless the provider is off", () => {
    assertPutRequiresAModelUnlessOff();
  });

  it("refuses a key with an off provider", () => {
    assertPutRefusesAKeyWithOff();
  });

  it("bounds the key length", () => {
    assertPutBoundsTheKey();
  });

  it("refuses to test off", () => {
    assertTestRefusesOff();
  });

  it("takes an optional, bounded vision model in a PUT (Amendment 3 C4)", () => {
    assertPutTakesAnOptionalVisionModel();
  });

  it("refuses a vision model with an off provider, and takes null", () => {
    assertPutRefusesAVisionModelWithOff();
  });

  it("takes an optional vision model in a test", () => {
    assertTestTakesAnOptionalVisionModel();
  });
});
