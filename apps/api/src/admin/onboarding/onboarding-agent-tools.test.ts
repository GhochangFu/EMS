import { describe, it } from "vitest";

import {
  assertA1AddPointKeyRefusesACatalogContradiction,
  assertA2AddPointKeyAcceptsAnAgreeingDeclaration,
  assertA3OnlyTheAppendedKeyIsJudged,
  assertAListResultIsBoundedAtOneHundredAndCountsTheRest,
  assertAMarkerInArgumentsIsRefused,
  assertASuccessfulWriteDropsThePendingProposal,
  assertAToolResultIsCutToTheBound,
  assertAWriteOverACapIsAToolError,
  assertAddRtuAcceptsAPlainConfig,
  assertAddRtuRefusesACredentialLookingValue,
  assertAddRtuRefusesASecretKeyAtDepth,
  assertEveryToolHasAJsonSchemaWithNoForbiddenProperty,
  assertListPointKeysSearchFiltersCodeAndName,
  assertProposeCommitRecordsASummary,
  assertProposeCommitRefusesAnUnreadyDraft,
  assertProposeCommitNamesThePhaseWhenNoFieldErrorExplains,
  assertProposeCommitNamesNoPhaseWhenAFieldErrorExplains,
  assertSetLocationDerivesSlugAndCode,
  assertSetLocationRefusesAnInactiveTypeNamingTheActiveCodes,
  assertUnknownToolAndBadArgumentsAreToolErrors,
  assertAFailedOutcomeCarriesItsError,
  assertUpdateRtuKeepsCredentialsSet,
  assertUpdateRtuRefusesTheSameTwoShapes,
  assertUseExistingPointKeysWritesOnlyThatFlag,
  assertShortCredentialNamesAreRefused,
  assertMetaCredentialsAreRefused,
  assertACredentialedRtuKeepsItsConnection,
  assertUpdateRtuMergesConfig,
  assertARemovedCredentialedCodeCannotBeReAdded,
  assertRemovingKeepsIndexesPointingAtTheSameParent,
  assertSetLocationKeepsStoredIdentifiersForTheSameName,
  assertADeepWriteIsRefused,
  assertAddAssetRefusesATemplate,
  assertSuggestRepliesRefusesFiveAndAnEmptyReply,
  assertSuggestRepliesSetsTheRepliesAndWritesNothing,
  assertMapPointRefusesAnUndeclaredKey,
  assertMapPointAppendsADeclaredKeyWithAQuotedLine,
  assertMapPointRefusesADuplicatePointKeyOnTheAsset,
  assertMapPointRefusesATemplatedAsset,
  assertRemovePointKeyIsRefusedWhileAMappingUsesIt,
  assertRemovePointKeyRemovesAKeyTheCatalogStillResolves,
  assertUseExistingPointKeysIsRefusedWithoutAnActiveKw,
  assertUseExistingPointKeysFalsePassesWithoutAnActiveKw,
  assertAddPointKeyLineIsQuoted,
  assertRemoveAssetPointLineIsQuoted,
} from "./onboarding-agent-tools.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("onboarding agent tools (F3.21, ADR 0090 decision 4)", () => {
  it("gives every tool a JSON Schema with no forbidden property", () => {
    assertEveryToolHasAJsonSchemaWithNoForbiddenProperty();
  });

  it("refuses an RTU with a secret key at depth", async () => {
    await assertAddRtuRefusesASecretKeyAtDepth();
  });

  it("refuses an RTU with a credential-looking value", async () => {
    await assertAddRtuRefusesACredentialLookingValue();
  });

  it("refuses the same two shapes through update_rtu", async () => {
    await assertUpdateRtuRefusesTheSameTwoShapes();
  });

  it("accepts a plain RTU config and writes a code-built action line", async () => {
    await assertAddRtuAcceptsAPlainConfig();
  });

  it("keeps credentialsSet through an RTU update", async () => {
    await assertUpdateRtuKeepsCredentialsSet();
  });

  it("returns a cap as a tool error and keeps the draft", async () => {
    await assertAWriteOverACapIsAToolError();
  });

  it("refuses an inactive location type, naming the active codes", async () => {
    await assertSetLocationRefusesAnInactiveTypeNamingTheActiveCodes();
  });

  it("derives slug and code for set_location", async () => {
    await assertSetLocationDerivesSlugAndCode();
  });

  it("writes only useExistingPointKeys", async () => {
    await assertUseExistingPointKeysWritesOnlyThatFlag();
  });

  it("refuses to propose an unready draft", async () => {
    await assertProposeCommitRefusesAnUnreadyDraft();
  });

  it("names the phase when no field error explains a refusal (F4.192)", async () => {
    await assertProposeCommitNamesThePhaseWhenNoFieldErrorExplains();
  });

  it("names no phase when a field error explains a refusal (F4.192)", async () => {
    await assertProposeCommitNamesNoPhaseWhenAFieldErrorExplains();
  });

  it("records a code-written proposal without committing", async () => {
    await assertProposeCommitRecordsASummary();
  });

  it("bounds a list result at 100 and counts the rest", async () => {
    await assertAListResultIsBoundedAtOneHundredAndCountsTheRest();
  });

  it("filters point keys by code and name", async () => {
    await assertListPointKeysSearchFiltersCodeAndName();
  });

  it("cuts a tool result to the bound on a whole character", async () => {
    await assertAToolResultIsCutToTheBound();
  });

  it("returns unknown tools and bad arguments as tool errors", async () => {
    await assertUnknownToolAndBadArgumentsAreToolErrors();
  });

  it("carries a refusal's sentence as the outcome's error (F3.27)", async () => {
    await assertAFailedOutcomeCarriesItsError();
  });

  it("refuses an argument that echoes the withheld-value marker", async () => {
    await assertAMarkerInArgumentsIsRefused();
  });

  it("drops a pending proposal on a successful write only", async () => {
    await assertASuccessfulWriteDropsThePendingProposal();
  });

  it("refuses short credential names", async () => {
    await assertShortCredentialNamesAreRefused();
  });

  it("walks the location and asset meta for credentials", async () => {
    await assertMetaCredentialsAreRefused();
  });

  it("keeps a credentialed RTU's connection and names the changed fields", async () => {
    await assertACredentialedRtuKeepsItsConnection();
  });

  it("merges an RTU config one level deep", async () => {
    await assertUpdateRtuMergesConfig();
  });

  it("refuses to re-add a removed credentialed code", async () => {
    await assertARemovedCredentialedCodeCannotBeReAdded();
  });

  it("keeps every index pointing at the same parent after a removal", async () => {
    await assertRemovingKeepsIndexesPointingAtTheSameParent();
  });

  it("keeps a stored slug and code when the name is unchanged", async () => {
    await assertSetLocationKeepsStoredIdentifiersForTheSameName();
  });

  it("refuses a write past the depth bound", async () => {
    await assertADeepWriteIsRefused();
  });

  it("add_asset refuses a template ref (F3.22 decision 2)", async () => {
    await assertAddAssetRefusesATemplate();
  });

  it("suggest_replies records the replies and changes nothing (F3.25)", async () => {
    await assertSuggestRepliesSetsTheRepliesAndWritesNothing();
  });

  it("suggest_replies refuses five replies and an empty reply (F3.25)", async () => {
    await assertSuggestRepliesRefusesFiveAndAnEmptyReply();
  });

  it("refuses map_point on a key that resolves nowhere (F3.23)", async () => {
    await assertMapPointRefusesAnUndeclaredKey();
  });

  it("appends a declared mapping with a quoted line (F3.23)", async () => {
    await assertMapPointAppendsADeclaredKeyWithAQuotedLine();
  });

  it("refuses a duplicate point key on one asset (F3.23)", async () => {
    await assertMapPointRefusesADuplicatePointKeyOnTheAsset();
  });

  it("refuses a mapping on a templated asset (F3.23)", async () => {
    await assertMapPointRefusesATemplatedAsset();
  });

  it("refuses to remove a point key a mapping needs (F3.23)", async () => {
    await assertRemovePointKeyIsRefusedWhileAMappingUsesIt();
  });

  it("removes a point key the catalog still resolves (F3.23)", async () => {
    await assertRemovePointKeyRemovesAKeyTheCatalogStillResolves();
  });

  it("refuses the existing catalog without an active kw (F3.23)", async () => {
    await assertUseExistingPointKeysIsRefusedWithoutAnActiveKw();
  });

  it("declares keys in the draft without an active kw (F3.23)", async () => {
    await assertUseExistingPointKeysFalsePassesWithoutAnActiveKw();
  });

  it("quotes the add_point_key action line (F3.23)", async () => {
    await assertAddPointKeyLineIsQuoted();
  });

  it("quotes the remove_asset_point action line (F3.23)", async () => {
    await assertRemoveAssetPointLineIsQuoted();
  });
});

describe("add_point_key against the catalog unit and domain (F4.225)", () => {
  it("A1 refuses a unit the catalog contradicts and writes nothing", async () => {
    await assertA1AddPointKeyRefusesACatalogContradiction();
  });

  it("A2 accepts a declaration that agrees with the catalog", async () => {
    await assertA2AddPointKeyAcceptsAnAgreeingDeclaration();
  });

  it("A3 judges only the appended key", async () => {
    await assertA3OnlyTheAppendedKeyIsJudged();
  });
});
