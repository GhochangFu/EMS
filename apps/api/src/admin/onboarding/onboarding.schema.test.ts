import { describe, it } from "vitest";

import {
  runDraftCountCapTests,
  runDraftStaysPermissiveTests,
  runDraftStringBoundTests,
  runOnboardingSchemaTests,
} from "./onboarding.schema.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). */
describe("onboarding.schema", () => {
  it("accepts and rejects onboarding draft payloads", () => {
    runOnboardingSchemaTests();
  });

  it("keeps the draft subtree permissive for its stored and model producers (E7.1f)", () => {
    runDraftStaysPermissiveTests();
  });

  it("caps the four draft arrays and refuses one item over each (F4.103)", () => {
    runDraftCountCapTests();
  });

  it("bounds every draft string field at its column width, length only (F4.104)", () => {
    runDraftStringBoundTests();
  });
});
