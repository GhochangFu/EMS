import { describe, it } from "vitest";

import {
  assertAddAnotherRtuWithATopicAppends,
  assertAnEmbeddedRestAppendsNoRtu,
  assertAnEmbeddedSimAppendsNoRtu,
  assertAnEmbeddedSimIsAnsweredAsAQuestion,
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
  assertATopicTurnAnswersItsActionLine,
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
  assertATopicQuestionAppendsNoRtu,
  assertAPluralTopicQuestionAppendsNoRtu,
  assertAWildcardTopicTurnIsRefused,
  assertANestedDeviceWildcardIsAValidationError,
  assertATopicQuestionIsAnsweredWithTheColonForm,
  assertAForgottenColonWithAProtocolWordStillAppends,
  assertAddAnotherRtuWithoutAColonStoresNoTopic,
  assertAddAnotherRtuWithAColonStoresTheTopic,
  assertATopicTurnPastTheRtuStepDoesNotUpdate,
  assertABareTopicLandsOnTheRtuMissingATopic,
  assertAPastedBlockNamingAProtocolWordSetsItsRtu,
  assertALaterBlocksTopicDoesNotAppend,
  assertABlockNamingADisabledRtuDoesNotTargetIt,
  assertABlockNamingAnRtuByCodeSetsIt,
  assertABlockNamingAnRtuByBareNameSetsIt,
  assertASharedNameFallsBackToTheRtuInHand,
  assertThePlaceholderTopicNeedsSetup,
  assertAnUneditedBlockKeepsTheRtuStep,
  assertAWildcardTopicNeedsSetup,
  assertAWildcardTopicKeepsTheRtuStep,
  assertAWildcardTopicIsAValidationError,
  assertAWildcardTopicIsInHand,
  assertAWildcardOnAModbusRtuIsNotAnError,
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

  it("T2b: the topic turn answers the update_rtu action line (F3.27 Q-D)", async () => {
    await assertATopicTurnAnswersItsActionLine();
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

  it("B3: a topic question appends no RTU", async () => {
    await assertATopicQuestionAppendsNoRtu();
  });

  it("C1: an embedded sim (simple) appends no RTU", async () => {
    await assertAnEmbeddedSimAppendsNoRtu();
  });

  it("C2: an embedded rest (restriction) appends no RTU", async () => {
    await assertAnEmbeddedRestAppendsNoRtu();
  });

  it("C2b: an embedded sim is answered as a question", async () => {
    await assertAnEmbeddedSimIsAnsweredAsAQuestion();
  });

  it("B3d: a plural topics question appends no RTU", async () => {
    await assertAPluralTopicQuestionAppendsNoRtu();
  });

  it("B3b: a topic question is answered with the colon form", async () => {
    await assertATopicQuestionIsAnsweredWithTheColonForm();
  });

  it("B3c: a protocol word with a forgotten colon still appends", async () => {
    await assertAForgottenColonWithAProtocolWordStillAppends();
  });

  it("B4: add another rtu without a colon stores no topic", async () => {
    await assertAddAnotherRtuWithoutAColonStoresNoTopic();
  });

  it("B5: add another rtu with a colon stores the topic", async () => {
    await assertAddAnotherRtuWithAColonStoresTheTopic();
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

  it("G1: a bare topic after add another rtu lands on the RTU missing a topic", async () => {
    await assertABareTopicLandsOnTheRtuMissingATopic();
  });

  it("G2: a block whose name holds a protocol word sets its RTU", async () => {
    await assertAPastedBlockNamingAProtocolWordSetsItsRtu();
  });

  it("G3: a later block's topic holding a protocol word does not append", async () => {
    await assertALaterBlocksTopicDoesNotAppend();
  });

  it("G4: a block naming a disabled RTU does not target it", async () => {
    await assertABlockNamingADisabledRtuDoesNotTargetIt();
  });

  it("G5: a block may name its RTU by code", async () => {
    await assertABlockNamingAnRtuByCodeSetsIt();
  });

  it("G6: a block may name its RTU by its bare display name", async () => {
    await assertABlockNamingAnRtuByBareNameSetsIt();
  });

  it("G7: a name two RTUs share falls back to the RTU in hand", async () => {
    await assertASharedNameFallsBackToTheRtuInHand();
  });

  it("H1: the template placeholder topic still needs setup", () => {
    assertThePlaceholderTopicNeedsSetup();
  });

  it("H2: an unedited pasted block keeps the RTU step", async () => {
    await assertAnUneditedBlockKeepsTheRtuStep();
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

describe("F4.215 — a wildcard topic is unusable", () => {
  it("W1: a wildcard topic needs MQTT setup", () => {
    assertAWildcardTopicNeedsSetup();
  });

  it("W2: a wildcard topic keeps the phase at rtu", () => {
    assertAWildcardTopicKeepsTheRtuStep();
  });

  it("W3: a wildcard topic is a validation error", () => {
    assertAWildcardTopicIsAValidationError();
  });

  it("W4: the wildcard RTU is the RTU in hand", () => {
    assertAWildcardTopicIsInHand();
  });

  it("W5: a wildcard on a Modbus RTU is not an error", () => {
    assertAWildcardOnAModbusRtuIsNotAnError();
  });

  it("W6: a wildcard topic turn is refused and the draft unchanged", async () => {
    await assertAWildcardTopicTurnIsRefused();
  });

  it("W7: a nested device.topic wildcard is a validation error", () => {
    assertANestedDeviceWildcardIsAValidationError();
  });
});
