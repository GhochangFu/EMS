import { describe, it } from "vitest";

import {
  assertADraftThatUsesTheExistingCatalogIsNotGivenAPointKey,
  assertADraftWithAPlainAssetIsStillGivenAPointKey,
  assertAnAllTemplatedReviewDraftIsNotGivenAPointKey,
  assertTheMappingAddedAnswerOffersCreateItAndViewDraft,
  assertTheYesAnswerOffersOnlyViewDraft,
  assertTheImportFollowUpSendsAnAllTemplatedDraftToCommit,
  assertTheImportFollowUpStillAsksAPlainAssetToMap,
  assertAddAnotherRtuAddsAnRtuOnTheModbusPath,
  assertAddAnotherRtuAddsAnRtuOnTheMqttPath,
  assertAddPointKeyAddsKwOnTheModbusPath,
  assertAnAddedModbusRtuOffersAddPointKey,
  assertAnAddedMqttRtuOffersConfirmRtu,
  assertCommitStillGivesTheCommitAnswer,
  assertConfirmAloneStillGivesTheCommitAnswer,
  assertConfirmAssetsSaysAnAssetIsMissing,
  assertConfirmingALaterStepNamesTheEarlierOne,
  assertConfirmMappingsSaysAMappingIsMissing,
  assertConfirmPointKeysSaysAKeyIsMissing,
  assertConfirmRtuGoesOnWhenTheRtuIsSetUp,
  assertConfirmRtuSaysTheCredentialsAreMissing,
  assertTheProtocolAnswerOffersNoProtocolPastTheRtuStep,
  assertAnotherRtuOnTheModbusPathIsModbus,
  assertAnRtuAddedPastThePointKeysOffersNoPointKey,
  assertConfirmRtuWithNoRtuAsksForAProtocol,
  assertConfirmMappingsOnAReadyDraftGoesOnToReview,
  assertConfirmRtuBeforeTheLocationNamesIt,
  assertTheProtocolAnswerOffersProtocolsAtTheRtuStep,
} from "./onboarding-chat-point-keys.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("onboarding chat point-key step (F4.195)", () => {
  it("adds no point key to an all-templated review draft", async () => {
    await assertAnAllTemplatedReviewDraftIsNotGivenAPointKey();
  });

  it("adds no point key to a draft that uses the existing catalog", async () => {
    await assertADraftThatUsesTheExistingCatalogIsNotGivenAPointKey();
  });

  it("still adds kw to a draft with a plain asset and no point key", async () => {
    await assertADraftWithAPlainAssetIsStillGivenAPointKey();
  });

  it("sends an imported all-templated draft to commit", () => {
    assertTheImportFollowUpSendsAnAllTemplatedDraftToCommit();
  });

  it("still asks an imported plain asset to map", () => {
    assertTheImportFollowUpStillAsksAPlainAssetToMap();
  });

  it("F4.199: offers only View draft after a yes", async () => {
    await assertTheYesAnswerOffersOnlyViewDraft();
  });

  it("F4.199: offers create it and View draft after a mapping is added", async () => {
    await assertTheMappingAddedAnswerOffersCreateItAndViewDraft();
  });
});

describe("onboarding chat reply buttons reach their step (F4.199)", () => {
  it("confirm rtu says the MQTT credentials are missing and adds no RTU", async () => {
    await assertConfirmRtuSaysTheCredentialsAreMissing();
  });

  it("confirm rtu goes on to the point keys once the RTU is set up", async () => {
    await assertConfirmRtuGoesOnWhenTheRtuIsSetUp();
  });

  it("confirm point keys says a key is missing and adds none", async () => {
    await assertConfirmPointKeysSaysAKeyIsMissing();
  });

  it("confirm assets says an asset is missing and adds none", async () => {
    await assertConfirmAssetsSaysAnAssetIsMissing();
  });

  it("confirm mappings says a mapping is missing and adds none", async () => {
    await assertConfirmMappingsSaysAMappingIsMissing();
  });

  it("confirming a later step names the earlier one", async () => {
    await assertConfirmingALaterStepNamesTheEarlierOne();
  });

  it("confirm alone still gives the commit answer", async () => {
    await assertConfirmAloneStillGivesTheCommitAnswer();
  });

  it("Commit still gives the commit answer", async () => {
    await assertCommitStillGivesTheCommitAnswer();
  });

  it("an added MQTT RTU offers confirm rtu, not Add point key kw", async () => {
    await assertAnAddedMqttRtuOffersConfirmRtu();
  });

  it("Add another RTU adds an RTU on the MQTT path", async () => {
    await assertAddAnotherRtuAddsAnRtuOnTheMqttPath();
  });

  it("an added Modbus RTU offers Add point key kw", async () => {
    await assertAnAddedModbusRtuOffersAddPointKey();
  });

  it("Add point key kw adds kw on the Modbus path", async () => {
    await assertAddPointKeyAddsKwOnTheModbusPath();
  });

  it("Add another RTU adds an RTU on the Modbus path", async () => {
    await assertAddAnotherRtuAddsAnRtuOnTheModbusPath();
  });

  it("Add another RTU on the Modbus path adds a Modbus RTU", async () => {
    await assertAnotherRtuOnTheModbusPathIsModbus();
  });

  it("an RTU added past the point keys offers no Add point key kw", async () => {
    await assertAnRtuAddedPastThePointKeysOffersNoPointKey();
  });

  it("confirm rtu with no RTU asks for a protocol", async () => {
    await assertConfirmRtuWithNoRtuAsksForAProtocol();
  });

  it("confirm mappings on a ready draft goes on to review", async () => {
    await assertConfirmMappingsOnAReadyDraftGoesOnToReview();
  });

  it("confirm rtu before the location is complete names the location step", async () => {
    await assertConfirmRtuBeforeTheLocationNamesIt();
  });

  it("the protocol answer offers protocols at the RTU step", async () => {
    await assertTheProtocolAnswerOffersProtocolsAtTheRtuStep();
  });

  it("the protocol answer offers no protocol past the RTU step", async () => {
    await assertTheProtocolAnswerOffersNoProtocolPastTheRtuStep();
  });
});
