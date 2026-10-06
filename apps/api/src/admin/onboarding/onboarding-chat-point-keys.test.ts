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
  assertAnEmbeddedRestIsNotAProtocolQuestion,
  assertTheProtocolAnswerOffersNoProtocolPastTheRtuStep,
  assertAnotherRtuOnTheModbusPathIsModbus,
  assertAnRtuAddedPastThePointKeysOffersNoPointKey,
  assertConfirmRtuWithNoRtuAsksForAProtocol,
  assertConfirmMappingsOnAReadyDraftGoesOnToReview,
  assertConfirmRtuBeforeTheLocationNamesIt,
  assertATypedConfirmAtTheLocationStepChangesNothing,
  assertATypedConfirmRtuWorksAsTheButton,
  assertATypedConfirmPointKeysWorksAsTheButton,
  assertATypedConfirmAssetsWorksAsTheButton,
  assertATypedConfirmMappingsWorksAsTheButton,
  assertYesPleaseChangesNothing,
  assertConfirmAssetsPleaseChangesNothing,
  assertCreateTheLocationIsNotALocationName,
  assertConfirmCommitWithAFullStopChangesNothing,
  assertAnotherRtuNamingAProtocolTakesIt,
  assertExistingKeysAreNotTakenBeforeThePointKeyStep,
  assertExistingKeysAreTakenAtThePointKeyStep,
  assertExistingKeysTurnAnswersItsActionLine,
  assertTheExistingKeysReplyNamesOneAsset,
  assertTheKwTurnAnswersItsActionLine,
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

  it("a typed confirm at the location step changes nothing", async () => {
    await assertATypedConfirmAtTheLocationStepChangesNothing();
  });

  it("a typed Confirm RTU! works as the button", async () => {
    await assertATypedConfirmRtuWorksAsTheButton();
  });

  it("a typed confirm  point keys works as the button", async () => {
    await assertATypedConfirmPointKeysWorksAsTheButton();
  });

  it("a typed CONFIRM ASSETS. works as the button", async () => {
    await assertATypedConfirmAssetsWorksAsTheButton();
  });

  it("a typed confirm mappings? works as the button", async () => {
    await assertATypedConfirmMappingsWorksAsTheButton();
  });

  it("yes please changes nothing", async () => {
    await assertYesPleaseChangesNothing();
  });

  it("confirm assets please changes nothing", async () => {
    await assertConfirmAssetsPleaseChangesNothing();
  });

  it("create the location is not a location name", async () => {
    await assertCreateTheLocationIsNotALocationName();
  });

  it("confirm commit. changes nothing", async () => {
    await assertConfirmCommitWithAFullStopChangesNothing();
  });

  it("Add another RTU modbus takes the protocol it names", async () => {
    await assertAnotherRtuNamingAProtocolTakesIt();
  });

  it("existing keys are not taken before the point-key step", async () => {
    await assertExistingKeysAreNotTakenBeforeThePointKeyStep();
  });

  it("existing keys are taken at the point-key step", async () => {
    await assertExistingKeysAreTakenAtThePointKeyStep();
  });

  it("use existing keys answers the use_existing_point_keys action line (F3.27)", async () => {
    await assertExistingKeysTurnAnswersItsActionLine();
  });

  it("the use existing keys reply names One asset and offers it (F3.27)", async () => {
    await assertTheExistingKeysReplyNamesOneAsset();
  });

  it("the kw turn answers the add_point_key action line (F3.27)", async () => {
    await assertTheKwTurnAnswersItsActionLine();
  });

  it("the protocol answer offers protocols at the RTU step", async () => {
    await assertTheProtocolAnswerOffersProtocolsAtTheRtuStep();
  });

  it("the protocol answer offers no protocol past the RTU step", async () => {
    await assertTheProtocolAnswerOffersNoProtocolPastTheRtuStep();
  });

});

describe("onboarding chat protocol question needs a whole word (F4.220)", () => {
  it("an embedded rest (restriction) is not a protocol question", async () => {
    await assertAnEmbeddedRestIsNotAProtocolQuestion();
  });
});
