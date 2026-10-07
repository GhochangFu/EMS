import { describe, it } from "vitest";

import {
  assertChatMessageRoleAcceptsAction,
  assertChatMessageRoleRefusesToolRole,
  assertCommitResponseParsesWithTheTemplateFields,
  assertCommitResponseRequiresEachTemplateField,
  assertDraftWithTemplatesParses,
  assertStockPatternCountIsCapped,
  assertTemplateCountIsCapped,
  assertTemplatePointCountIsCapped,
  assertTemplateVarCountIsCapped,
  assertDraftArrayCapsAreEnforced,
  assertDraftLocationMetaDescribesTheSeedKey,
  assertDraftLocationParsesWithoutType,
  assertDraftStringBoundsAreDeclaredOnce,
  assertDraftStringBoundsAreEnforced,
  assertSessionDtoCarriesTheCaps,
  assertSessionDtoCarriesTheStringBounds,
  assertASummaryCarryingSectionsIsRefused,
  assertSessionDtoParsesWithAHash,
  assertSessionDtoParsesWithSummariesAndNoHash,
  assertSessionDtoRequiresTheCheckpointFields,
} from "./onboarding.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.103 — the onboarding draft carries a count cap on all four arrays", () => {
  it("parses a draft at each cap and refuses one item over it", () => {
    assertDraftArrayCapsAreEnforced();
  });

  it("carries the cap into the session DTO the client parses", () => {
    assertSessionDtoCarriesTheCaps();
  });
});

describe("F4.104 — the onboarding draft bounds the length of every string field", () => {
  it("declares the bounds once, and they cover every string field of the draft", () => {
    assertDraftStringBoundsAreDeclaredOnce();
  });

  it("attaches every bound, length-only, and refuses one character over", () => {
    assertDraftStringBoundsAreEnforced();
  });

  it("carries the bound into the session DTO the client parses", () => {
    assertSessionDtoCarriesTheStringBounds();
  });
});

describe("F4.157 — onboardingDraftLocationSchema.type becomes optional (ADR 0077 D4, OQ2)", () => {
  it("C4 — parses a draft location without type", () => {
    assertDraftLocationParsesWithoutType();
  });
});

describe("F4.170 — onboardingDraftLocationSchema.meta says seedKey is seed-owned", () => {
  it("D4 — the meta description", () => {
    assertDraftLocationMetaDescribesTheSeedKey();
  });
});

describe("F3.21 — onboardingChatMessageSchema.role gains `action`", () => {
  it("accepts the action role", () => {
    assertChatMessageRoleAcceptsAction();
  });

  it("still refuses the tool role", () => {
    assertChatMessageRoleRefusesToolRole();
  });
});

describe("F3.22 — templates in the onboarding draft (ADR 0091 decision 2)", () => {
  it("parses a draft with an authored template, a stock entry and a templated asset", () => {
    assertDraftWithTemplatesParses();
  });

  it("caps the templates array", () => {
    assertTemplateCountIsCapped();
  });

  it("caps the points of an authored template", () => {
    assertTemplatePointCountIsCapped();
  });

  it("caps the variables of a templated asset", () => {
    assertTemplateVarCountIsCapped();
  });

  it("caps the pattern overlay of a stock entry", () => {
    assertStockPatternCountIsCapped();
  });
});

describe("F3.22 — the commit result reports templates (ADR 0091 decision 4)", () => {
  it("parses a result carrying the five template fields", () => {
    assertCommitResponseParsesWithTheTemplateFields();
  });

  it("refuses a result missing any one of them", () => {
    assertCommitResponseRequiresEachTemplateField();
  });
});

describe("F3.25 — checkpoint summaries and the draft hash on the session DTO (ADR 0094 decisions 4, 7)", () => {
  it("parses a session carrying one summary and a null hash", () => {
    assertSessionDtoParsesWithSummariesAndNoHash();
  });

  it("parses a session carrying a 64-hex hash", () => {
    assertSessionDtoParsesWithAHash();
  });

  it("refuses a summary that carries sections (strict, the F4.185 guard)", () => {
    assertASummaryCarryingSectionsIsRefused();
  });

  it("refuses a session missing checkpoints or draftHash", () => {
    assertSessionDtoRequiresTheCheckpointFields();
  });
});
