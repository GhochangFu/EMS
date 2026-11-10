import { describe, it } from "vitest";

import {
  assertAFailingRedisFallsBackToMemoryAndIsCounted,
  assertAMalformedValueFailsBoot,
  assertANotReadyRedisIsNeverCalled,
  assertAProbeInAnyCaseIsExempt,
  assertASlowRedisTimesOutToMemory,
  assertAnIpFloodCannotResetAnIdentityCounter,
  assertAnUnexpectedReplyFallsBack,
  assertAnUpperCasePathIsStillCounted,
  assertClaimAllFailsOpenToNullAndCounts,
  assertClaimAllReturnsTheScriptReply,
  assertEachClassHasItsOwnBudget,
  assertEachIdentityHasItsOwnBudget,
  assertEnforceRefusesTheHitAfterTheLimit,
  assertEveryEnvNameIsRead,
  assertHopsTwoReadsTheClientBehindCaddyAndNginx,
  assertHopsZeroIgnoresAForgedHeader,
  assertIpBucketsUseTheirOwnLimits,
  assertIpSubjectsAreNormalised,
  assertNoLimiterAdmitsEveryHandshake,
  assertNoRedisReadsMemoryNotDegraded,
  assertOffMakesNoStoreCall,
  assertOnlyAPostToTheLoginPathIsALogin,
  assertRedisIsTheStoreWhenItAnswers,
  assertRedisRecoveryClearsDegraded,
  assertShadowCountsLogsOnceAndNeverRefuses,
  assertStage1CountsEveryApiRouteInOneIpBucket,
  assertStage1KeysTheClientBehindTheProxies,
  assertStage1NeverCountsHealthOrMetrics,
  assertStage1RefusesTheEleventhLogin,
  assertTheDefaultsAreTheAdrNumbersAndShadow,
  assertTheFixedWindow,
  assertTheHealthSection,
  assertTheKeyShapeAndHashing,
  assertTheMemoryWindowCountsAndExpires,
  assertTheMemoryWindowIsBounded,
  assertTheMethodDefaultsAndTheOverride,
  assertTheMetricNamesAreTheOnesTheShadowWeekReads,
  assertTheNextWindowResets,
  assertTheRefusalBodyAndHeaders,
  assertTheThirtyFirstHandshakeIsRefused,
} from "./rate-limit.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.17 rate limiter (ADR 0125 Part A)", () => {
  it("the defaults are the adr numbers and shadow", async () => {
    await assertTheDefaultsAreTheAdrNumbersAndShadow();
  });

  it("every env name is read", async () => {
    await assertEveryEnvNameIsRead();
  });

  it("a malformed value fails boot", async () => {
    await assertAMalformedValueFailsBoot();
  });

  it("the key shape and hashing", async () => {
    await assertTheKeyShapeAndHashing();
  });

  it("the fixed window", async () => {
    await assertTheFixedWindow();
  });

  it("ip subjects are normalised", async () => {
    await assertIpSubjectsAreNormalised();
  });

  it("hops zero ignores a forged header", async () => {
    await assertHopsZeroIgnoresAForgedHeader();
  });

  it("hops two reads the client behind caddy and nginx", async () => {
    await assertHopsTwoReadsTheClientBehindCaddyAndNginx();
  });

  it("the memory window counts and expires", async () => {
    await assertTheMemoryWindowCountsAndExpires();
  });

  it("the memory window is bounded", async () => {
    await assertTheMemoryWindowIsBounded();
  });

  it("an ip flood cannot reset an identity counter", async () => {
    await assertAnIpFloodCannotResetAnIdentityCounter();
  });

  it("redis is the store when it answers", async () => {
    await assertRedisIsTheStoreWhenItAnswers();
  });

  it("a failing redis falls back to memory and is counted", async () => {
    await assertAFailingRedisFallsBackToMemoryAndIsCounted();
  });

  it("a not ready redis is never called", async () => {
    await assertANotReadyRedisIsNeverCalled();
  });

  it("a slow redis times out to memory", async () => {
    await assertASlowRedisTimesOutToMemory();
  });

  it("an unexpected reply falls back", async () => {
    await assertAnUnexpectedReplyFallsBack();
  });

  it("no redis reads memory not degraded", async () => {
    await assertNoRedisReadsMemoryNotDegraded();
  });

  it("the metric names are the ones the shadow week reads", async () => {
    await assertTheMetricNamesAreTheOnesTheShadowWeekReads();
  });

  it("redis recovery clears degraded", async () => {
    await assertRedisRecoveryClearsDegraded();
  });

  it("enforce refuses the hit after the limit", async () => {
    await assertEnforceRefusesTheHitAfterTheLimit();
  });

  it("each identity has its own budget", async () => {
    await assertEachIdentityHasItsOwnBudget();
  });

  it("each class has its own budget", async () => {
    await assertEachClassHasItsOwnBudget();
  });

  it("the next window resets", async () => {
    await assertTheNextWindowResets();
  });

  it("shadow counts logs once and never refuses", async () => {
    await assertShadowCountsLogsOnceAndNeverRefuses();
  });

  it("off makes no store call", async () => {
    await assertOffMakesNoStoreCall();
  });

  it("ip buckets use their own limits", async () => {
    await assertIpBucketsUseTheirOwnLimits();
  });

  it("the method defaults and the override", async () => {
    await assertTheMethodDefaultsAndTheOverride();
  });

  it("the refusal body and headers", async () => {
    await assertTheRefusalBodyAndHeaders();
  });

  it("the health section", async () => {
    await assertTheHealthSection();
  });

  it("stage1 refuses the eleventh login", async () => {
    await assertStage1RefusesTheEleventhLogin();
  });

  it("stage1 never counts health or metrics", async () => {
    await assertStage1NeverCountsHealthOrMetrics();
  });

  it("stage1 counts every api route in one ip bucket", async () => {
    await assertStage1CountsEveryApiRouteInOneIpBucket();
  });

  it("an upper case path is still counted", async () => {
    await assertAnUpperCasePathIsStillCounted();
  });

  it("a probe in any case is exempt", async () => {
    await assertAProbeInAnyCaseIsExempt();
  });

  it("stage1 keys the client behind the proxies", async () => {
    await assertStage1KeysTheClientBehindTheProxies();
  });

  it("only a post to the login path is a login", async () => {
    await assertOnlyAPostToTheLoginPathIsALogin();
  });

  it("the thirty first handshake is refused", async () => {
    await assertTheThirtyFirstHandshakeIsRefused();
  });

  it("no limiter admits every handshake", async () => {
    await assertNoLimiterAdmitsEveryHandshake();
  });

  it("claim all returns the script reply", async () => {
    await assertClaimAllReturnsTheScriptReply();
  });

  it("claim all fails open to null and counts", async () => {
    await assertClaimAllFailsOpenToNullAndCounts();
  });

});
