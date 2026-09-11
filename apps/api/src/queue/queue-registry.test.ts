import { describe, it } from "vitest";

import {
  assertCloseClosesEveryHandle,
  assertConfiguredClientCarriesTheConnection,
  assertCreateQueueCalledOncePerDeclarationWithPrefixAndConnection,
  assertDefineQueueMergesRetryOverDefaults,
  assertDefineQueueWithoutRetryCarriesTheDefaults,
  assertEnqueueAddsWithJobIdAndResolvedRetryOptions,
  assertErrorListenerWarnsAndDoesNotThrow,
  assertEveryHandleRegistersAnErrorListener,
  assertFleetPayloadNeedsNoOrganizationId,
  assertMissingJobIdIsRefusedBeforeRedis,
  assertPayloadGuardAnswersBeforeAvailability,
  assertPrefixOverrideReachesCreateQueue,
  assertTenantPayloadWithOrganizationIdIsAdded,
  assertTenantPayloadWithoutOrganizationIdIsRefused,
  assertUnconfiguredClientRejectsWithQueueUnavailableError,
  assertUnconfiguredConfigBuildsNoQueue,
  assertUnconfiguredConfigWarnsOnce,
  assertUndeclaredQueueIsRefused,
  assertUpsertScheduleAppliesTenancyGuard,
  assertUpsertScheduleCallsUpsertJobSchedulerWithTemplate,
  assertUpsertScheduleOnUnconfiguredClientRejects,
  MISSING_JOB_ID_OPTS,
} from "./queue-registry.spec";

/**
 * F4.24 (ADR 0063 decisions 4, 5, 6, 7, 9) — Vitest entry point for the
 * typed queue registry. Assertions live in the sibling `.spec` (§4.6/ADR
 * 0014); this file only runs them.
 */
describe("F4.24 — typed queue registry", () => {
  describe("defineQueue", () => {
    it("merges a partial retry policy over RETRY_DEFAULTS", () => {
      assertDefineQueueMergesRetryOverDefaults();
    });

    it("carries RETRY_DEFAULTS when no retry is given", () => {
      assertDefineQueueWithoutRetryCarriesTheDefaults();
    });
  });

  describe("createQueueClient", () => {
    it("calls createQueue once per declaration with prefix bms and the parsed connection", () => {
      assertCreateQueueCalledOncePerDeclarationWithPrefixAndConnection();
    });

    it("passes a prefix override through to createQueue and the client", () => {
      assertPrefixOverrideReachesCreateQueue();
    });

    it("registers an error listener on every created handle", () => {
      assertEveryHandleRegistersAnErrorListener();
    });

    it("warns from the error listener without throwing", () => {
      assertErrorListenerWarnsAndDoesNotThrow();
    });

    it("carries the resolved connection on the configured client", () => {
      assertConfiguredClientCarriesTheConnection();
    });

    it("builds no queue when REDIS_URL is unconfigured", () => {
      assertUnconfiguredConfigBuildsNoQueue();
    });

    it("warns exactly once when REDIS_URL is unconfigured", () => {
      assertUnconfiguredConfigWarnsOnce();
    });
  });

  describe("enqueue", () => {
    it("adds with the jobId and the resolved retry options (positive control)", async () => {
      await assertEnqueueAddsWithJobIdAndResolvedRetryOptions();
    });

    it.each(MISSING_JOB_ID_OPTS)(
      "refuses missing_job_id before any Redis call for $label",
      async ({ opts }) => {
        await assertMissingJobIdIsRefusedBeforeRedis(opts);
      },
    );

    it("refuses a tenant payload without organizationId", async () => {
      await assertTenantPayloadWithoutOrganizationIdIsRefused();
    });

    it("adds a tenant payload that carries organizationId (positive control)", async () => {
      await assertTenantPayloadWithOrganizationIdIsAdded();
    });

    it("adds a fleet payload without organizationId", async () => {
      await assertFleetPayloadNeedsNoOrganizationId();
    });

    it("rejects with QueueUnavailableError on an unconfigured client", async () => {
      await assertUnconfiguredClientRejectsWithQueueUnavailableError();
    });

    it("answers a missing jobId with QueuePayloadError, not QueueUnavailableError, on an unconfigured client", async () => {
      await assertPayloadGuardAnswersBeforeAvailability();
    });

    it("refuses a declaration the client never built with unknown_queue", async () => {
      await assertUndeclaredQueueIsRefused();
    });
  });

  describe("upsertSchedule", () => {
    it("calls upsertJobScheduler with the every interval and the job template", async () => {
      await assertUpsertScheduleCallsUpsertJobSchedulerWithTemplate();
    });

    it("refuses a tenant payload without organizationId", async () => {
      await assertUpsertScheduleAppliesTenancyGuard();
    });

    it("rejects with QueueUnavailableError on an unconfigured client", async () => {
      await assertUpsertScheduleOnUnconfiguredClientRejects();
    });
  });

  describe("close", () => {
    it("closes every handle", async () => {
      await assertCloseClosesEveryHandle();
    });
  });
});
