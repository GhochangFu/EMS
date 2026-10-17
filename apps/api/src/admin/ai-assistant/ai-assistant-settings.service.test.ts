import { describe, it } from "vitest";

import {
  assertANewProviderWithoutAKeyClearsTheStoredKey,
  assertDeleteOfAKeylessRowAuditsNoKeyChange,
  assertDeleteOfNoRowWritesNoAuditAndReportsThePlatform,
  assertDeleteRemovesAndAudits,
  assertEveryMethodRefusesOutsideScope,
  assertGetNeverCarriesTheKey,
  assertGetWithARowReportsSetAndLast4,
  assertGetWithoutARowReportsThePlatform,
  assertPutAuditsProviderModelAndKeyChangedOnly,
  assertPutEncryptsAndStoresLast4,
  assertPutResponseNeverCarriesTheKey,
  assertPutWithAKeyAndNoEncryptionKeyIs400AndWritesNothing,
  assertPutWithoutAKeyKeepsTheStoredOne,
  assertTestAnswerIsOnlyAStatus,
  assertTestNeverSpendsAStoredKeyOnAnotherProvider,
  assertTestNeverSpendsThePlatformKeyOnAnotherProvider,
  assertTestSendsOneTrivialToolWithAutoChoice,
  assertTestUsesTheGivenKeyFirst,
  assertTestUsesTheStoredKeyForTheSameProvider,
  assertTestWithNoStoredKeyIsRestrictedToThePlatformDefault,
  assertALocationAdminIsRefusedEvenInScope,
  assertAnOrganizationRowNeverTestsWithThePlatformKey,
  assertPutStoresAndAuditsTheVisionModel,
  assertPutWithoutAVisionModelClearsTheStoredOne,
  assertPutOffStoresNoVisionModel,
  assertGetReportsTheVisionModelAndThePlatformOne,
  assertDeleteAuditsTheVisionModel,
  assertTestWithAVisionModelMakesASecondCallWithOneImage,
  assertTheVisionProbeIsARealPng,
  assertTestWithoutAVisionModelMakesOneCallAndAnswersOnlyAStatus,
  assertAVisionRefusalIsItsOwnStatus,
  assertTheMainFailureDoesNotSkipTheVisionCall,
  assertThePlatformKeyIsNeverSpentOnAnotherVisionModel,
} from "./ai-assistant-settings.service.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("AiAssistantSettingsService (F3.21, ADR 0090 Amendment 1 A5–A7)", () => {
  it("refuses every method outside the organization's scope", async () => {
    await assertEveryMethodRefusesOutsideScope();
  });

  it("reports the platform default when the organization has no row", async () => {
    await assertGetWithoutARowReportsThePlatform();
  });

  it("reports a row's key as set, with its last four", async () => {
    await assertGetWithARowReportsSetAndLast4();
  });

  it("never returns a key or ciphertext from GET", async () => {
    await assertGetNeverCarriesTheKey();
  });

  it("encrypts the key and stores its last four apart", async () => {
    await assertPutEncryptsAndStoresLast4();
  });

  it("keeps the stored key when a PUT for the same provider omits it", async () => {
    await assertPutWithoutAKeyKeepsTheStoredOne();
  });

  it("clears the stored key when the provider changes without a new one", async () => {
    await assertANewProviderWithoutAKeyClearsTheStoredKey();
  });

  it("refuses a key with no encryption key configured, and writes nothing", async () => {
    await assertPutWithAKeyAndNoEncryptionKeyIs400AndWritesNothing();
  });

  it("never returns the key from PUT", async () => {
    await assertPutResponseNeverCarriesTheKey();
  });

  it("audits provider, model and keyChanged only", async () => {
    await assertPutAuditsProviderModelAndKeyChangedOnly();
  });

  it("removes the row and audits the delete", async () => {
    await assertDeleteRemovesAndAudits();
  });

  it("audits no key change when the deleted row stored no key", async () => {
    await assertDeleteOfAKeylessRowAuditsNoKeyChange();
  });

  it("writes no audit when there is no row to delete, and still reports the platform", async () => {
    await assertDeleteOfNoRowWritesNoAuditAndReportsThePlatform();
  });

  it("tests with the typed key first", async () => {
    await assertTestUsesTheGivenKeyFirst();
  });

  it("tests with the stored key for the same provider", async () => {
    await assertTestUsesTheStoredKeyForTheSameProvider();
  });

  it("restricts a keyless test to the platform default", async () => {
    await assertTestWithNoStoredKeyIsRestrictedToThePlatformDefault();
  });

  it("never spends the platform key on another provider", async () => {
    await assertTestNeverSpendsThePlatformKeyOnAnotherProvider();
  });

  it("never spends a stored key on another provider", async () => {
    await assertTestNeverSpendsAStoredKeyOnAnotherProvider();
  });

  it("answers a test with a status only", async () => {
    await assertTestAnswerIsOnlyAStatus();
  });

  it("tests with one trivial tool in one call", async () => {
    await assertTestSendsOneTrivialToolWithAutoChoice();
  });

  it("refuses a location admin by role, even in scope", async () => {
    await assertALocationAdminIsRefusedEvenInScope();
  });

  it("never tests with the platform key for an organization with a row", async () => {
    await assertAnOrganizationRowNeverTestsWithThePlatformKey();
  });

  it("stores and audits the vision model, without key text (Amendment 3 C4)", async () => {
    await assertPutStoresAndAuditsTheVisionModel();
  });

  it("clears a stored vision model when a PUT omits it or sends null (D4)", async () => {
    await assertPutWithoutAVisionModelClearsTheStoredOne();
  });

  it("stores no vision model for off", async () => {
    await assertPutOffStoresNoVisionModel();
  });

  it("reports the vision model and the platform's", async () => {
    await assertGetReportsTheVisionModelAndThePlatformOne();
  });

  it("audits the deleted vision model", async () => {
    await assertDeleteAuditsTheVisionModel();
  });

  it("tests the vision model with a second call carrying one PNG", async () => {
    await assertTestWithAVisionModelMakesASecondCallWithOneImage();
  });

  it("sends a real 1x1 PNG as the vision probe", async () => {
    await assertTheVisionProbeIsARealPng();
  });

  it("makes one call and answers only a status without a vision model", async () => {
    await assertTestWithoutAVisionModelMakesOneCallAndAnswersOnlyAStatus();
  });

  it("reports a vision refusal as its own status (D2)", async () => {
    await assertAVisionRefusalIsItsOwnStatus();
  });

  it("makes the vision call even when the main call failed (D2)", async () => {
    await assertTheMainFailureDoesNotSkipTheVisionCall();
  });

  it("never spends the platform key on another vision model", async () => {
    await assertThePlatformKeyIsNeverSpentOnAnotherVisionModel();
  });
});
