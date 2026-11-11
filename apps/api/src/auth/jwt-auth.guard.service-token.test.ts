import { describe, it } from "vitest";

import {
  assertAJwtNeverReachesTheVerifier,
  assertAReadOnlyTokenReadsAndIsRefusedEveryWrite,
  assertAValidTokenAuthenticatesAsItsServiceAccount,
  assertAnyRefusedTokenIsTheOneGeneric401,
  assertEachTokenHasItsOwnStage2Budget,
  assertWithoutAVerifierATokenIsRefusedNotAccepted,
} from "./jwt-auth.guard.service-token.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("JwtAuthGuard — service-account tokens (F4.17, ADR 0125)", () => {
  it("a valid token authenticates as its service account", async () => {
    await assertAValidTokenAuthenticatesAsItsServiceAccount();
  });

  it("any refused token is the one generic401", async () => {
    await assertAnyRefusedTokenIsTheOneGeneric401();
  });

  it("without a verifier a token is refused not accepted", async () => {
    await assertWithoutAVerifierATokenIsRefusedNotAccepted();
  });

  it("a jwt never reaches the verifier", async () => {
    await assertAJwtNeverReachesTheVerifier();
  });

  it("a read only token reads and is refused every write", async () => {
    await assertAReadOnlyTokenReadsAndIsRefusedEveryWrite();
  });

  it("each token has its own stage2 budget", async () => {
    await assertEachTokenHasItsOwnStage2Budget();
  });

});
