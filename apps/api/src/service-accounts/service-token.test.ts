import { describe, it } from "vitest";

import {
  assertAMalformedTokenNeverReachesTheDatabase,
  assertARevokeNotificationForgetsAndDisconnectsThatToken,
  assertAValidTokenResolvesToItsServiceAccount,
  assertAnIssuedTokenHasTheFormatAndHashesItsSecret,
  assertEveryRefusalIsNull,
  assertForgetDropsTheCacheSoARevokeTakesEffect,
  assertLastUsedIsTouchedOncePerMinuteAndAFailureServesTheRequest,
  assertMalformedTokensParseToNull,
  assertSecretMatchesOnlyItsOwnHash,
  assertTheCacheHoldsThirtySecondsAndStillProvesTheSecret,
  assertTheCatchUpClearsTheCacheAndClosesDeadTokensSockets,
  assertTokensAreUnique,
} from "./service-token.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.17 service-account tokens (ADR 0125 decisions 11–13)", () => {
  it("an issued token has the format and hashes its secret", async () => {
    await assertAnIssuedTokenHasTheFormatAndHashesItsSecret();
  });

  it("tokens are unique", async () => {
    await assertTokensAreUnique();
  });

  it("malformed tokens parse to null", async () => {
    await assertMalformedTokensParseToNull();
  });

  it("secret matches only its own hash", async () => {
    await assertSecretMatchesOnlyItsOwnHash();
  });

  it("a valid token resolves to its service account", async () => {
    await assertAValidTokenResolvesToItsServiceAccount();
  });

  it("every refusal is null", async () => {
    await assertEveryRefusalIsNull();
  });

  it("a malformed token never reaches the database", async () => {
    await assertAMalformedTokenNeverReachesTheDatabase();
  });

  it("the cache holds thirty seconds and still proves the secret", async () => {
    await assertTheCacheHoldsThirtySecondsAndStillProvesTheSecret();
  });

  it("forget drops the cache so a revoke takes effect", async () => {
    await assertForgetDropsTheCacheSoARevokeTakesEffect();
  });

  it("last used is touched once per minute and a failure serves the request", async () => {
    await assertLastUsedIsTouchedOncePerMinuteAndAFailureServesTheRequest();
  });

  it("a revoke notification forgets and disconnects that token", async () => {
    await assertARevokeNotificationForgetsAndDisconnectsThatToken();
  });

  it("the catch up clears the cache and closes dead tokens sockets", async () => {
    await assertTheCatchUpClearsTheCacheAndClosesDeadTokensSockets();
  });

});
