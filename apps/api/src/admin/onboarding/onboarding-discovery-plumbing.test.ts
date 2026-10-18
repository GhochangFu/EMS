import { describe, it } from "vitest";

import * as S from "./onboarding-discovery-plumbing.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.24b U3 — _discovery and _discoveryProposal are server state in the draft", () => {
  it("the commit hash ignores the discovery result", () => S.theHashIgnoresTheDiscoveryResult());
  it("the commit hash ignores the discovery proposal", () => S.theHashIgnoresTheDiscoveryProposal());
  it("the commit hash still sees a section change", () => S.theHashStillSeesASectionChange());
  it("the client view has no discovery result", () => S.theClientViewHasNoDiscoveryResult());
  it("the client view has no discovery proposal", () => S.theClientViewHasNoDiscoveryProposal());
  it("the model view has neither", () => S.theModelViewHasNeither());
  it("a draft write clears the discovery proposal", () => S.aDraftWriteClearsTheDiscoveryProposal());
  it("a draft write keeps the discovery result", () => S.aDraftWriteKeepsTheDiscoveryResult());
  it("a restore clears the discovery proposal", () => S.aRestoreClearsTheDiscoveryProposal());
  it("a restore keeps the discovery result", () => S.aRestoreKeepsTheDiscoveryResult());
  it("a chat turn keeps the result the worker wrote during it", () => S.aChatTurnKeepsTheResultTheWorkerWroteDuringIt());
});
