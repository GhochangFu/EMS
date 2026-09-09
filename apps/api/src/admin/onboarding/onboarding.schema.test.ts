import { describe, it } from "vitest";

import {
  assertDraftDepthFixturesSitExactlyAtTheBound,
  assertOnboardingDraftSchemaCoversTheModelProducer,
  assertPatchDraftBodyAcceptsADraftAtTheBound,
  assertPatchDraftBodyRefusesADraftOneDeeper,
  assertTheDepthRefusalSentenceStatesTheLimit,
  assertTheShippedProducerShapesStillParse,
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

/**
 * `F4.115` ruling 2a. One `it()` per claim: a mutation must redden the
 * assertion that owns the claim, and a single `it()` over all five would die at
 * the first one and say nothing about the four after it.
 */
describe("onboarding.schema — the draft's nesting depth (F4.115)", () => {
  it("builds its fixtures exactly at and exactly one past the bound", () => {
    assertDraftDepthFixturesSitExactlyAtTheBound();
  });

  it("accepts a draft nested exactly to the bound", () => {
    assertPatchDraftBodyAcceptsADraftAtTheBound();
  });

  it("refuses a draft one level deeper, under fieldErrors.draft", () => {
    assertPatchDraftBodyRefusesADraftOneDeeper();
  });

  it("states the limit in the refusal sentence and echoes nothing from the draft", () => {
    assertTheDepthRefusalSentenceStatesTheLimit();
  });

  it("refuses it on the draft schema itself, so the model's producer is covered", () => {
    assertOnboardingDraftSchemaCoversTheModelProducer();
  });

  it("still parses the shape the shipped producers actually write", () => {
    assertTheShippedProducerShapesStillParse();
  });
});
