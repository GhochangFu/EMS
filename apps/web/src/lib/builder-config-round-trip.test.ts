import { describe, it } from "vitest";

import {
  runLiveBuilderRoundTripTests,
  runTemplateBuilderRoundTripTests,
  runUnsetFieldsAreOmittedTests,
} from "./builder-config-round-trip.spec";

/** `F3.35` Stage A — Vitest wrapper for the builder's both-directions identity (ADR 0014). */
describe("F3.35 Stage A — a widget config survives an edit-and-resave", () => {
  it("round-trips every field through the live dashboard builder", () => {
    runLiveBuilderRoundTripTests();
  });

  it("round-trips every field through the template-authoring tab", () => {
    runTemplateBuilderRoundTripTests();
  });

  it("omits an unset field rather than writing an empty one a strict schema refuses", () => {
    runUnsetFieldsAreOmittedTests();
  });
});
