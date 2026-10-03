import { describe, it } from "vitest";

import {
  assertANewProviderWithoutAKeyClearsTheStoredKey,
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
});
