import { describe, it } from "vitest";

import {
  assertInactiveLocationTypeIsAnErrorNamingTheCodes,
  assertInactiveLocationTypeIsNotReadyToCommit,
  assertInactiveLocationTypeMessageCarriesTheMoreTail,
  assertInactiveLocationTypeMessageNamesAtMostTheCap,
  assertInactiveLocationTypeKeepsTheLocationPhase,
  assertInactiveLocationTypeMessageDoesNotEchoTheValue,
  assertMissingLocationTypeIsAnError,
  assertMissingLocationTypeKeepsTheLocationPhase,
  assertNoActiveTypeMessageSaysNoneIsActive,
  assertTypedLocationIsReadyToCommit,
  assertTypedLocationLeavesTheLocationPhase,
  assertAnAuthoredPatternOutsideTheGrammarIsAnError,
  assertAnUnpinnedOrganizationTemplateIsAnError,
  assertAnUnreferencedTemplateIsValid,
  assertAStockPatternOutsideTheGrammarIsAnError,
  assertV1AnUnresolvedTemplateCodeIsAnError,
  assertV2AnUnpublishedVersionIsAnError,
  assertV3ADomainMismatchIsAnError,
  assertV4AMappingOntoATemplatedAssetIsAnError,
  assertV5ARequiredPointWithNoPatternIsAnError,
  assertV6AKeyAtTheLengthLimitIsValid,
  assertV6AnOptionalKeyOverTheLengthLimitIsAnError,
  assertV6AnUnresolvedVariableIsAnError,
  assertV6ARequiredKeyOverTheLengthLimitIsAnError,
  assertV6ARequiredKeyThatResolvesEmptyIsAnError,
  assertV7AnUnknownVariableIsAnError,
  assertV8ADuplicatePointKeyIsAnError,
  assertV8ADuplicateTemplateCodeIsAnError,
  assertV9AnUnknownStockCodeIsAnError,
  assertV9APatternOnANonMeasuredPointIsAnError,
  assertV10AHeldCodeIsAnErrorNamingTheVersions,
  assertV10AHeldStockCodeIsAnError,
  assertV11AMixedDraftStillNeedsMappings,
  assertV11AnAllTemplatedDraftNeedsNoMappings,
  assertV12ATemplatedDraftIsReadyToCommit,
} from "./onboarding-validate.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("OnboardingValidateService — a location with no type (F4.157)", () => {
  it("reports location.type and keeps readyToCommit false", () => {
    assertMissingLocationTypeIsAnError();
  });

  it("reports nothing once the type is set", () => {
    assertTypedLocationIsReadyToCommit();
  });

  it("keeps the location phase while the type is missing", () => {
    assertMissingLocationTypeKeepsTheLocationPhase();
  });

  it("leaves the location phase once the type is set", () => {
    assertTypedLocationLeavesTheLocationPhase();
  });
});

describe("OnboardingValidateService — a location type that is not active (F4.162)", () => {
  it("reports location.type with a message naming every active code", () => {
    assertInactiveLocationTypeIsAnErrorNamingTheCodes();
  });

  it("does not echo the stored value in that message", () => {
    assertInactiveLocationTypeMessageDoesNotEchoTheValue();
  });

  it("keeps readyToCommit false", () => {
    assertInactiveLocationTypeIsNotReadyToCommit();
  });

  it("keeps the location phase", () => {
    assertInactiveLocationTypeKeepsTheLocationPhase();
  });

  it("names at most MAX_ECHOED_ITEMS active codes", () => {
    assertInactiveLocationTypeMessageNamesAtMostTheCap();
  });

  it("closes a cut list with the more tail", () => {
    assertInactiveLocationTypeMessageCarriesTheMoreTail();
  });

  it("says no location type is active when the list is empty", () => {
    assertNoActiveTypeMessageSaysNoneIsActive();
  });
});

describe("OnboardingValidateService — templates and templated assets (F3.22, ADR 0091)", () => {
  it("V1 refuses a template code with no draft entry and no published version", () => {
    assertV1AnUnresolvedTemplateCodeIsAnError();
  });

  it("V2 refuses a named version that is not published", () => {
    assertV2AnUnpublishedVersionIsAnError();
  });

  it("V3 refuses an asset domain that differs from its template's", () => {
    assertV3ADomainMismatchIsAnError();
  });

  it("V4 refuses a mapping onto a templated asset", () => {
    assertV4AMappingOntoATemplatedAssetIsAnError();
  });

  it("V5 refuses a required measured point with no pattern, naming the point", () => {
    assertV5ARequiredPointWithNoPatternIsAnError();
  });

  it("V6 refuses a required pattern that does not resolve, naming the variable", () => {
    assertV6AnUnresolvedVariableIsAnError();
  });

  it("V6 refuses a required key that resolves to an empty string", () => {
    assertV6ARequiredKeyThatResolvesEmptyIsAnError();
  });

  it("V6 refuses an optional key over the 128-character limit", () => {
    assertV6AnOptionalKeyOverTheLengthLimitIsAnError();
  });

  it("V6 refuses a required key over the 128-character limit", () => {
    assertV6ARequiredKeyOverTheLengthLimitIsAnError();
  });

  it("V6 accepts a key of exactly 128 characters", () => {
    assertV6AKeyAtTheLengthLimitIsValid();
  });

  it("V7 refuses a variable the template does not ask for", () => {
    assertV7AnUnknownVariableIsAnError();
  });

  it("V8 refuses two draft templates with one code", () => {
    assertV8ADuplicateTemplateCodeIsAnError();
  });

  it("V8 refuses a point key declared twice in one template", () => {
    assertV8ADuplicatePointKeyIsAnError();
  });

  it("V9 refuses a stock code this release does not ship", () => {
    assertV9AnUnknownStockCodeIsAnError();
  });

  it("V9 refuses a pattern on a point that is not measured", () => {
    assertV9APatternOnANonMeasuredPointIsAnError();
  });

  it("V10 refuses an authored code the organization already holds, naming the versions", () => {
    assertV10AHeldCodeIsAnErrorNamingTheVersions();
  });

  it("V10 refuses a stock code the organization already holds", () => {
    assertV10AHeldStockCodeIsAnError();
  });

  it("refuses an authored pattern outside the token grammar (decision 9)", () => {
    assertAnAuthoredPatternOutsideTheGrammarIsAnError();
  });

  it("refuses a stock pattern outside the token grammar (decision 9)", () => {
    assertAStockPatternOutsideTheGrammarIsAnError();
  });

  it("refuses an organization template with no version (decision 2)", () => {
    assertAnUnpinnedOrganizationTemplateIsAnError();
  });

  it("V11 lets an all-templated draft reach review with no mappings", () => {
    assertV11AnAllTemplatedDraftNeedsNoMappings();
  });

  it("V11 keeps a mixed draft in mappings until its plain asset is mapped", () => {
    assertV11AMixedDraftStillNeedsMappings();
  });

  it("V12 finds a draft with every kind of template ready to commit", () => {
    assertV12ATemplatedDraftIsReadyToCommit();
  });

  it("keeps a template no asset uses valid (decision 11)", () => {
    assertAnUnreferencedTemplateIsValid();
  });
});
