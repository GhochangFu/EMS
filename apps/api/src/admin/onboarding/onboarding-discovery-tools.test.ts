import { describe, it } from "vitest";

import {
  assertD1AProposalRecordsTheBrokerAndWritesNothing,
  assertD2TheActionLineNamesTheFilterAndWindow,
  assertD3NoRtuAtTheIndexIsRefused,
  assertD4ANonMqttRtuIsRefused,
  assertD5AnRtuWithNoHostIsRefused,
  assertD6AnRtuWithNoCredentialsIsRefused,
  assertD7ABlockedHostIsRefused,
  assertD8ABadPortIsRefused,
  assertD9AWildcardPrefixIsRefused,
  assertD10ADollarPrefixIsRefused,
  assertD11ABusyDiscoveryIsRefused,
  assertD12ALaterWriteDropsTheProposal,
  assertD13ACredentialShapedPrefixIsRefused,
  assertG1NoDiscoveryFails,
  assertG2ARunningDiscoveryAnswersItsStatusOnly,
  assertG3ADoneResultListsTheDevices,
  assertG4ADoneReadTaintsTheTurn,
  assertG5A101stKeyGivesAMoreTail,
  assertG6AHundredKeysGiveNoTail,
  assertG7AnOffsetReadsTheNextPage,
  assertG8AnEmptyResultSaysSo,
  assertG9ATruncatedResultSaysSo,
  assertG10TheResultCarriesNoSecret,
  assertS1ProposeCommitIsRefusedAfterTheRead,
  assertS2ProposeDiscoveryIsRefusedAfterTheRead,
  assertS3AnRtuHostEditIsRefusedAfterTheRead,
  assertS4TheSameEditRunsWithoutTheRead,
  assertS5ATemplateToolIsRefusedAfterTheRead,
  assertS6AnotherWriteIsRefusedAfterTheRead,
  assertS7AddPointKeysRunsAfterTheRead,
  assertS8AddAssetOnTheSourceRtuRunsAfterTheRead,
  assertS9AddAssetOnAnotherRtuIsRefusedAfterTheRead,
  assertS10MapPointsOnAnotherRtuIsRefusedAfterTheRead,
  assertS11AddRtuForAnUndiscoveredCodeIsRefusedAfterTheRead,
  assertS12MapPointsWithAFreeTextKeyIsRefusedAfterTheRead,
  assertS13MapPointsWithAnIdentifierKeyRunsAfterTheRead,
  assertS14AddRtuWithAFreeTextTopicIsRefusedAfterTheRead,
  assertS15AddRtuWithAnIdentifierDevIdRunsAfterTheRead,
  assertC1AddRtuForADiscoveredDeviceEarnsACopy,
  assertC2AnotherHostEarnsNoCopy,
  assertC3AnotherTopicEarnsNoCopy,
  assertC4ApplyCopiesTheEncryptedBlob,
  assertC5ApplyChecksTheHostAgain,
  assertC6ApplyStoresTheProposal,
  assertM1MapPointsStampsADiscoveredKey,
  assertM2TheStampedRowCarriesTheSource,
  assertM3AnUndiscoveredKeyIsNotStamped,
  assertM4AKeyOfAnotherDeviceIsNotStamped,
  assertM5NoResultStampsNothing,
  assertM6AMapPointsRowCarryingSourceIsRefused,
  assertM7AMapPointCarryingSourceIsRefused,
  assertM8MapPointStampsADiscoveredKey,
} from "./onboarding-discovery-tools.spec";

/** Vitest entry point (ADR 0014). One `it()` per claim. */
describe("onboarding discovery tools (F3.24b, ADR 0103 decisions 2, 7 and 8)", () => {
  it("D1 a proposal records the broker and writes nothing", async () => {
    await assertD1AProposalRecordsTheBrokerAndWritesNothing();
  });
  it("D2 the action line names the filter and window", async () => {
    await assertD2TheActionLineNamesTheFilterAndWindow();
  });
  it("D3 no rtu at the index is refused", async () => {
    await assertD3NoRtuAtTheIndexIsRefused();
  });
  it("D4 a non mqtt rtu is refused", async () => {
    await assertD4ANonMqttRtuIsRefused();
  });
  it("D5 an rtu with no host is refused", async () => {
    await assertD5AnRtuWithNoHostIsRefused();
  });
  it("D6 an rtu with no credentials is refused", async () => {
    await assertD6AnRtuWithNoCredentialsIsRefused();
  });
  it("D7 a blocked host is refused", async () => {
    await assertD7ABlockedHostIsRefused();
  });
  it("D8 a bad port is refused", async () => {
    await assertD8ABadPortIsRefused();
  });
  it("D9 a wildcard prefix is refused", async () => {
    await assertD9AWildcardPrefixIsRefused();
  });
  it("D10 a dollar prefix is refused", async () => {
    await assertD10ADollarPrefixIsRefused();
  });
  it("D11 a busy discovery is refused", async () => {
    await assertD11ABusyDiscoveryIsRefused();
  });
  it("D12 a later write drops the proposal", async () => {
    await assertD12ALaterWriteDropsTheProposal();
  });
  it("D13 a credential shaped prefix is refused", async () => {
    await assertD13ACredentialShapedPrefixIsRefused();
  });
  it("G1 no discovery fails", async () => {
    await assertG1NoDiscoveryFails();
  });
  it("G2 a running discovery answers its status only", async () => {
    await assertG2ARunningDiscoveryAnswersItsStatusOnly();
  });
  it("G3 a done result lists the devices", async () => {
    await assertG3ADoneResultListsTheDevices();
  });
  it("G4 a done read taints the turn", async () => {
    await assertG4ADoneReadTaintsTheTurn();
  });
  it("G5 a101st key gives a more tail", async () => {
    await assertG5A101stKeyGivesAMoreTail();
  });
  it("G6 a hundred keys give no tail", async () => {
    await assertG6AHundredKeysGiveNoTail();
  });
  it("G7 an offset reads the next page", async () => {
    await assertG7AnOffsetReadsTheNextPage();
  });
  it("G8 an empty result says so", async () => {
    await assertG8AnEmptyResultSaysSo();
  });
  it("G9 a truncated result says so", async () => {
    await assertG9ATruncatedResultSaysSo();
  });
  it("G10 the result carries no secret", async () => {
    await assertG10TheResultCarriesNoSecret();
  });
  it("S1 propose commit is refused after the read", async () => {
    await assertS1ProposeCommitIsRefusedAfterTheRead();
  });
  it("S2 propose discovery is refused after the read", async () => {
    await assertS2ProposeDiscoveryIsRefusedAfterTheRead();
  });
  it("S3 an rtu host edit is refused after the read", async () => {
    await assertS3AnRtuHostEditIsRefusedAfterTheRead();
  });
  it("S4 the same edit runs without the read", async () => {
    await assertS4TheSameEditRunsWithoutTheRead();
  });
  it("S5 a template tool is refused after the read", async () => {
    await assertS5ATemplateToolIsRefusedAfterTheRead();
  });
  it("S6 another write is refused after the read", async () => {
    await assertS6AnotherWriteIsRefusedAfterTheRead();
  });
  it("S7 add point keys runs after the read", async () => {
    await assertS7AddPointKeysRunsAfterTheRead();
  });
  it("S8 add asset on the source rtu runs after the read", async () => {
    await assertS8AddAssetOnTheSourceRtuRunsAfterTheRead();
  });
  it("S9 add asset on another rtu is refused after the read", async () => {
    await assertS9AddAssetOnAnotherRtuIsRefusedAfterTheRead();
  });
  it("S10 map points on another rtu is refused after the read", async () => {
    await assertS10MapPointsOnAnotherRtuIsRefusedAfterTheRead();
  });
  it("S11 add rtu for an undiscovered code is refused after the read", async () => {
    await assertS11AddRtuForAnUndiscoveredCodeIsRefusedAfterTheRead();
  });
  it("S12 map points with a free-text key is refused after the read", async () => {
    await assertS12MapPointsWithAFreeTextKeyIsRefusedAfterTheRead();
  });
  it("S13 map points with an identifier key runs after the read", async () => {
    await assertS13MapPointsWithAnIdentifierKeyRunsAfterTheRead();
  });
  it("S14 add rtu with a free-text topic is refused after the read", async () => {
    await assertS14AddRtuWithAFreeTextTopicIsRefusedAfterTheRead();
  });
  it("S15 add rtu with an identifier devId and topic runs after the read", async () => {
    await assertS15AddRtuWithAnIdentifierDevIdRunsAfterTheRead();
  });
  it("C1 add rtu for a discovered device earns a copy", async () => {
    await assertC1AddRtuForADiscoveredDeviceEarnsACopy();
  });
  it("C2 another host earns no copy", async () => {
    await assertC2AnotherHostEarnsNoCopy();
  });
  it("C3 another topic earns no copy", async () => {
    await assertC3AnotherTopicEarnsNoCopy();
  });
  it("C4 apply copies the encrypted blob", async () => {
    await assertC4ApplyCopiesTheEncryptedBlob();
  });
  it("C5 apply checks the host again", async () => {
    await assertC5ApplyChecksTheHostAgain();
  });
  it("C6 apply stores the proposal", async () => {
    await assertC6ApplyStoresTheProposal();
  });
  it("M1 map points stamps a discovered key", async () => {
    await assertM1MapPointsStampsADiscoveredKey();
  });
  it("M2 the stamped row carries the source", async () => {
    await assertM2TheStampedRowCarriesTheSource();
  });
  it("M3 an undiscovered key is not stamped", async () => {
    await assertM3AnUndiscoveredKeyIsNotStamped();
  });
  it("M4 a key of another device is not stamped", async () => {
    await assertM4AKeyOfAnotherDeviceIsNotStamped();
  });
  it("M5 no result stamps nothing", async () => {
    await assertM5NoResultStampsNothing();
  });
  it("M6 a map points row carrying source is refused", async () => {
    await assertM6AMapPointsRowCarryingSourceIsRefused();
  });
  it("M7 a map point carrying source is refused", async () => {
    await assertM7AMapPointCarryingSourceIsRefused();
  });
  it("M8 map point stamps a discovered key", async () => {
    await assertM8MapPointStampsADiscoveredKey();
  });
});
