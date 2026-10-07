import { describe, it } from "vitest";

import {
  assertK1AddPointKeysRefusesACatalogContradictionAtItsCallIndex,
  assertK2AddPointKeysAcceptsAnAgreeingBatch,
  assertK3AddPointKeysJudgesOnlyTheAppendedKeys,
  assertK1AddPointKeysAppendsInOrderAndNamesTheNewOnes,
  assertK2ARepeatedCodeRefusesTheBatch,
  assertK3AnAlreadyDeclaredCodeRefusesTheBatch,
  assertK4AnInactiveCatalogCodeRefusesTheBatch,
  assertK5OneKeyPastTheBoundIsASchemaRefusal,
  assertK5TheDraftCapBindsThroughWrite,
  assertK6ACredentialInAKeyIsRefused,
  assertP1MapPointsAppendsAndBoundsTheLine,
  assertP2AnUndeclaredKeyRefusesTheBatch,
  assertP3AnInBatchDuplicateSourceRefusesTheBatch,
  assertP4ATemplatedAssetRefusesWithoutAPrefix,
  assertP5ACredentialInARowIsRefused,
  assertP6OneRowPastTheBoundIsASchemaRefusal,
  assertP6TheDraftCapBindsThroughWrite,
  assertP7ARowsOwnAssetIndexIsRefused,
  assertR1GetAssetPointsListsTheRowsWithDraftIndexes,
  assertR2AnUnknownAssetIndexFails,
  assertR3GetAssetPointsIsBoundedAtOneHundred,
} from "./onboarding-mapping-tools.spec";

/** Vitest entry point (ADR 0014). One `it()` per claim. */
describe("onboarding batch mapping tools (F3.23, ADR 0092 decision 4)", () => {
  it("K1 add_point_keys appends in order and names the keys new to the catalog", async () => {
    await assertK1AddPointKeysAppendsInOrderAndNamesTheNewOnes();
  });
  it("K2 a code repeated in the batch refuses it whole", async () => {
    await assertK2ARepeatedCodeRefusesTheBatch();
  });
  it("K3 a code already declared refuses the batch", async () => {
    await assertK3AnAlreadyDeclaredCodeRefusesTheBatch();
  });
  it("K4 a code the catalog holds inactive refuses the batch", async () => {
    await assertK4AnInactiveCatalogCodeRefusesTheBatch();
  });
  it("K5 one key past the per-call bound is a schema refusal", async () => {
    await assertK5OneKeyPastTheBoundIsASchemaRefusal();
  });
  it("K5 the draft cap binds through write()", async () => {
    await assertK5TheDraftCapBindsThroughWrite();
  });
  it("K6 a credential in a key is refused", async () => {
    await assertK6ACredentialInAKeyIsRefused();
  });
  it("P1 map_points appends on the call's asset and bounds the line", async () => {
    await assertP1MapPointsAppendsAndBoundsTheLine();
  });
  it("P2 an undeclared key in one row refuses the batch", async () => {
    await assertP2AnUndeclaredKeyRefusesTheBatch();
  });
  it("P3 an in-batch duplicate source data key refuses the batch", async () => {
    await assertP3AnInBatchDuplicateSourceRefusesTheBatch();
  });
  it("P4 a templated asset refuses with the V4 sentence", async () => {
    await assertP4ATemplatedAssetRefusesWithoutAPrefix();
  });
  it("P5 a credential in a row is refused", async () => {
    await assertP5ACredentialInARowIsRefused();
  });
  it("P6 one row past the per-call bound is a schema refusal", async () => {
    await assertP6OneRowPastTheBoundIsASchemaRefusal();
  });
  it("P6 the draft cap binds through write()", async () => {
    await assertP6TheDraftCapBindsThroughWrite();
  });
  it("P7 refuses a row that carries its own assetIndex", async () => {
    await assertP7ARowsOwnAssetIndexIsRefused();
  });
  it("R1 get_asset_points lists the rows with their draft-wide indexes", async () => {
    await assertR1GetAssetPointsListsTheRowsWithDraftIndexes();
  });
  it("R2 an unknown asset index fails", async () => {
    await assertR2AnUnknownAssetIndexFails();
  });
  it("R3 get_asset_points is bounded at 100", async () => {
    await assertR3GetAssetPointsIsBoundedAtOneHundred();
  });
});

describe("add_point_keys against the catalog unit and domain (F4.225)", () => {
  it("K1 refuses a unit the catalog contradicts, all or none, at its index in the call", async () => {
    await assertK1AddPointKeysRefusesACatalogContradictionAtItsCallIndex();
  });

  it("K2 accepts a batch that agrees with the catalog", async () => {
    await assertK2AddPointKeysAcceptsAnAgreeingBatch();
  });

  it("K3 judges only the appended keys, not a contradiction already in the draft", async () => {
    await assertK3AddPointKeysJudgesOnlyTheAppendedKeys();
  });
});
