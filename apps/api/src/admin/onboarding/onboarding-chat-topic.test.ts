import { describe, it } from "vitest";

import {
  assertAddAnotherRtuWithATopicAppends,
  assertAnOverLongTopicTurnIsCut,
  assertATopicNamingAProtocolStillUpdates,
  assertATopicOnlyPatchKeepsCredentialsSet,
  assertATopicOnlyPatchKeepsTheSecret,
  assertATopicTurnDoesNotStandInForTheCredential,
  assertATopicTurnKeepsTheRestOfTheConfig,
  assertATopicTurnMovesToPointKeys,
  assertATopicTurnOffersThePointKeyReply,
  assertATopicTurnUpdatesTheRtuInHand,
  assertATopicTurnWithNoRtuAppends,
  assertATopicTurnWritesTheTopic,
  assertConfirmRtuIsCompleteAfterATopicTurn,
  assertTheFirstWaitingRtuIsInHand,
  assertTheLastRtuIsInHandWhenNoneWaits,
  assertAnOverLongTopicIsAValidationError,
  assertAnOverLongTopicKeepsTheRtuStep,
  assertAnOverLongTopicNeedsSetup,
  assertATopicAtTheBoundIsNotAnError,
  assertADisabledMqttRtuIsNotInHand,
  assertANonMqttRtuIsNotInHand,
  assertANonStringTopicFallsBackToMqttTopic,
  assertAnOverLongTopicOnAModbusRtuIsAnError,
  assertAPastedBlockSetsTheRtuItNames,
  assertAPastedTemplateSetsItsFirstBlocksRtu,
  assertATopicAtTheBoundDoesNotNeedSetup,
  assertATopicQuestionDoesNotUpdate,
  assertATopicTurnPastTheRtuStepDoesNotUpdate,
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

describe("F4.208 — the guided `topic: x` turn sets the topic of the RTU in hand", () => {
  it("T1: updates the RTU in hand instead of appending one", async () => {
    await assertATopicTurnUpdatesTheRtuInHand();
  });

  it("T2: writes the topic into config.topic", async () => {
    await assertATopicTurnWritesTheTopic();
  });

  it("T3: keeps the rest of the config", async () => {
    await assertATopicTurnKeepsTheRestOfTheConfig();
  });

  it("T4: moves a credentialed draft on to point keys", async () => {
    await assertATopicTurnMovesToPointKeys();
  });

  it("T4b: offers the point-key reply", async () => {
    await assertATopicTurnOffersThePointKeyReply();
  });

  it("T5: confirm rtu then answers that the RTU step is complete", async () => {
    await assertConfirmRtuIsCompleteAfterATopicTurn();
  });

  it("T6: cuts an over-long topic to 255 characters", async () => {
    await assertAnOverLongTopicTurnIsCut();
  });

  it("T7: does not stand in for a missing credential", async () => {
    await assertATopicTurnDoesNotStandInForTheCredential();
  });

  it("T8: appends an RTU when the draft has no MQTT RTU", async () => {
    await assertATopicTurnWithNoRtuAppends();
  });

  it("T9: a topic containing a protocol word still updates", async () => {
    await assertATopicNamingAProtocolStillUpdates();
  });

  it("T10: add another rtu with a topic still appends", async () => {
    await assertAddAnotherRtuWithATopicAppends();
  });

  it("T11: the first RTU still waiting for a topic is in hand", async () => {
    await assertTheFirstWaitingRtuIsInHand();
  });

  it("T12: with none waiting, the last MQTT RTU is in hand", () => {
    assertTheLastRtuIsInHandWhenNoneWaits();
  });

  it("B1: a sentence mentioning a topic without a colon does not update", async () => {
    await assertATopicQuestionDoesNotUpdate();
  });

  it("B2: topic: x past the RTU step does not update", async () => {
    await assertATopicTurnPastTheRtuStepDoesNotUpdate();
  });

  it("C1: a pasted template sets the RTU of its first block", async () => {
    await assertAPastedTemplateSetsItsFirstBlocksRtu();
  });

  it("C2: one pasted block sets the RTU it names", async () => {
    await assertAPastedBlockSetsTheRtuItNames();
  });

  it("E1: a disabled MQTT RTU is never in hand", () => {
    assertADisabledMqttRtuIsNotInHand();
  });

  it("E2: a non-MQTT RTU is never in hand", () => {
    assertANonMqttRtuIsNotInHand();
  });
});

describe("F4.208 — the topic bound reads the topic the commit writes", () => {
  it("D1: a topic of exactly 255 characters does not need setup", () => {
    assertATopicAtTheBoundDoesNotNeedSetup();
  });

  it("F1: a non-string topic falls back to an over-long mqttTopic, which is an error", () => {
    assertANonStringTopicFallsBackToMqttTopic();
  });

  it("F2: an over-long topic on a Modbus RTU is an error", () => {
    assertAnOverLongTopicOnAModbusRtuIsAnError();
  });
});

describe("F4.208 — a topic-only PATCH keeps the stored credential (regression guard)", () => {
  it("A5a: the encrypted blob survives", () => {
    assertATopicOnlyPatchKeepsTheSecret();
  });

  it("A5b: credentialsSet stays true", () => {
    assertATopicOnlyPatchKeepsCredentialsSet();
  });
});
