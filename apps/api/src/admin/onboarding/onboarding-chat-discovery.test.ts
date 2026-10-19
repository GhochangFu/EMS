import { describe, it } from "vitest";

import {
  assertADiscoveredDeviceRtuGetsTheEncryptedCopy,
  assertAnRtuOnAnotherHostGetsNoCopy,
  assertAProposingTurnStoresTheDiscoveryProposal,
  assertATurnWithoutAProposalStoresNone,
} from "./onboarding-chat-discovery.spec";

/** Vitest entry point (ADR 0014). One `it()` per claim. */
describe("chat stores what a discovery turn earned (F3.24b, ADR 0103 decision 2)", () => {
  it("CH1 a proposing turn stores the discovery proposal", async () => {
    await assertAProposingTurnStoresTheDiscoveryProposal();
  });
  it("CH2 a turn without a proposal stores none", async () => {
    await assertATurnWithoutAProposalStoresNone();
  });
  it("CH3 a discovered device RTU gets the encrypted copy", async () => {
    await assertADiscoveredDeviceRtuGetsTheEncryptedCopy();
  });
  it("CH4 an RTU on another host gets no copy", async () => {
    await assertAnRtuOnAnotherHostGetsNoCopy();
  });
});
