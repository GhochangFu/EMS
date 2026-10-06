import { describe, it } from "vitest";

import {
  assertApiDraftLocationParsesWithoutType,
  assertRollbackBodyIsBoundAndStrict,
  assertApiStockPatternCountIsCapped,
  assertApiTemplatePointCountIsCapped,
  assertApiTemplateVarCountIsCapped,
  assertTemplateVarKeyMustMatchTheTokenGrammar,
  assertTemplateVarKeyRefusesTheReservedName,
  assertDraftLocationMetaDescribesTheSeedKey,
  assertDraftDepthFixturesSitExactlyAtTheBound,
  assertOnboardingDraftSchemaCoversTheModelProducer,
  assertPatchDraftBodyAcceptsADraftAtTheBound,
  assertPatchDraftBodyRefusesADraftOneDeeper,
  assertTheDepthRefusalSentenceStatesTheLimit,
  assertTheShippedProducerShapesStillParse,
  runDraftCountCapTests,
  runDraftStaysPermissiveTests,
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

  it("caps every draft array and refuses one item over each (F4.103, F3.22)", () => {
    runDraftCountCapTests();
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

describe("onboarding.schema — draftLocationSchema.type is optional (F4.157, ADR 0077 D4)", () => {
  it("C6 — parses a draft location without type", () => {
    assertApiDraftLocationParsesWithoutType();
  });
});

describe("onboarding.schema — the OpenAPI document says location.meta.seedKey is seed-owned (F4.170)", () => {
  it("D3 — the PATCH :id/draft body's draft.location.meta description", () => {
    assertDraftLocationMetaDescribesTheSeedKey();
  });
});

describe("onboarding.schema — a templated asset's variable keys (F3.22, ADR 0091 decision 2)", () => {
  it("refuses a key outside the token grammar", () => {
    assertTemplateVarKeyMustMatchTheTokenGrammar();
  });

  it("refuses the reserved key asset_code", () => {
    assertTemplateVarKeyRefusesTheReservedName();
  });
});

describe("onboarding.schema — the nested template counts on the write path (F3.22)", () => {
  it("caps the points of an authored template", () => {
    assertApiTemplatePointCountIsCapped();
  });

  it("caps the variables of a templated asset", () => {
    assertApiTemplateVarCountIsCapped();
  });

  it("caps the pattern overlay of a stock entry", () => {
    assertApiStockPatternCountIsCapped();
  });
});

describe("onboarding.schema — the rollback body (F3.25, ADR 0094 decision 6)", () => {
  it("refuses a non-hex hash, a non-uuid id and an extra key", () => {
    assertRollbackBodyIsBoundAndStrict();
  });
});
