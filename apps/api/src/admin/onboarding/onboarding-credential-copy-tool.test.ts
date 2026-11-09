import { describe, it } from "vitest";

import * as S from "./onboarding-credential-copy-tool.spec";

/** Vitest entry point (ADR 0014). One `it()` per claim. */
describe("F4.339 PR 9 — propose_credential_copy (ADR 0099 Amendment 18 decision 2)", () => {
  it("P1 records the codes and the broker, writes nothing and returns the code-written line", S.aProposalRecordsCodesAndBrokerAndWritesNothing);
  it("P2 one target reads singular", S.oneTargetReadsSingular);
  it("P3 refuses with fixed text: no credential, not MQTT, other broker, self, no code, held (Q2)", S.theRefusalsAreFixedText);
  it("P4 a bound source its RTU no longer serves has no credential", S.aStaleBoundSourceHasNoCredential);
  it("P5 a duplicate code is refused", S.aDuplicateCodeIsRefused);
  it("P6 the arguments are strict: 1-100 distinct targets, no replace", S.theArgumentsAreStrict);
  it("P7 a later write in the turn drops the proposal", S.aLaterWriteDropsTheProposal);
  it("P8 the finished turn stores the proposal, read back fail-closed", S.theTurnStoresTheProposal);
});
