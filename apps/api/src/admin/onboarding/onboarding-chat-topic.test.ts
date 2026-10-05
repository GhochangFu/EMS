import { describe, it } from "vitest";

import {
  assertAnOverLongTopicIsAValidationError,
  assertAnOverLongTopicKeepsTheRtuStep,
  assertAnOverLongTopicNeedsSetup,
  assertATopicAtTheBoundIsNotAnError,
} from "./onboarding-chat-topic.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("F4.208 — the MQTT topic's length bound on the onboarding draft", () => {
  it("A1: an over-long topic still needs MQTT setup", () => {
    assertAnOverLongTopicNeedsSetup();
  });

  it("A2: an over-long topic keeps the phase at rtu", () => {
    assertAnOverLongTopicKeepsTheRtuStep();
  });

  it("A3: an over-long topic is a validation error", () => {
    assertAnOverLongTopicIsAValidationError();
  });

  it("A4: a topic at the bound is not an error", () => {
    assertATopicAtTheBoundIsNotAnError();
  });
});
