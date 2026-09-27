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
