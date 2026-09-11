import { describe, it } from "vitest";

import {
  assertAllDigitJobIdIsRefused,
  assertCloseClosesEveryHandle,
  assertColonJobIdIsRefused,
  assertConfiguredClientCarriesTheConnection,
  assertCreateQueueCalledOncePerDeclarationWithPrefixAndConnection,
  assertDefineQueueMergesRetryOverDefaults,
  assertDefineQueueWithoutRetryCarriesTheDefaults,
  assertEnqueueAddsTheSchemaOutputNotTheRawObject,
  assertEnqueueAddsWithJobIdAndResolvedRetryOptions,
  assertErrorListenerWarnsAndDoesNotThrow,
  assertEveryHandleRegistersAnErrorListener,
  assertFleetPayloadNeedsNoOrganizationId,
  assertGrammaticalJobIdIsAccepted,
  assertInvalidJobIdAnswersBeforeAvailability,
  assertInvalidPayloadAnswersBeforeAvailability,
  assertMissingJobIdIsRefusedBeforeRedis,
  assertOverlongJobIdIsRefused,
  assertPayloadFailingItsSchemaIsRefusedAtEnqueue,
  assertPayloadGuardAnswersBeforeAvailability,
  assertPrefixOverrideReachesCreateQueue,
  assertReservedJobIdIsRefusedBeforeRedis,
  assertReservedListCarriesTheReproducedThree,
  assertTenantNonUuidOrganizationIdIsInvalidPayloadNotMissing,
  assertTenantPayloadWithOrganizationIdIsAdded,
  assertTenantPayloadWithoutOrganizationIdIsRefused,
  assertTwoHundredCharacterJobIdIsAccepted,
  assertUnconfiguredClientRejectsWithQueueUnavailableError,
  assertUnconfiguredConfigBuildsNoQueue,
  assertUnconfiguredConfigWarnsOnce,
  assertUndeclaredQueueIsRefused,
  assertUpsertScheduleAppliesTenancyGuard,
  assertUpsertScheduleCallsUpsertJobSchedulerWithTemplate,
  assertUpsertScheduleOnUnconfiguredClientRejects,
  assertUpsertScheduleRefusesAPayloadFailingItsSchema,
  MISSING_JOB_ID_OPTS,
  RESERVED_JOB_ID_ROWS,
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

  describe("enqueue — jobId (decision 5, review M1)", () => {
    it("adds with the jobId and the resolved retry options (positive control)", async () => {
      await assertEnqueueAddsWithJobIdAndResolvedRetryOptions();
    });

    it.each(MISSING_JOB_ID_OPTS)(
      "refuses missing_job_id before any Redis call for $label",
      async ({ opts }) => {
        await assertMissingJobIdIsRefusedBeforeRedis(opts);
      },
    );

    it.each(RESERVED_JOB_ID_ROWS)(
      "refuses the BullMQ structural name %s with invalid_job_id before any Redis call",
      async (jobId) => {
        await assertReservedJobIdIsRefusedBeforeRedis(jobId);
      },
    );

    it("carries the three reproduced names on RESERVED_JOB_IDS", () => {
      assertReservedListCarriesTheReproducedThree();
    });

    it("refuses a 201-character id", async () => {
      await assertOverlongJobIdIsRefused();
    });

    it("accepts a 200-character id (boundary positive control)", async () => {
      await assertTwoHundredCharacterJobIdIsAccepted();
    });

    it("refuses a colon id, which BullMQ 5.81.5 itself throws on", async () => {
      await assertColonJobIdIsRefused();
    });

    it("refuses an all-digit id, which BullMQ reserves for integers", async () => {
      await assertAllDigitJobIdIsRefused();
    });

    it('accepts "cmd-123.v2_a" (positive control for the grammar)', async () => {
      await assertGrammaticalJobIdIsAccepted();
    });

    it("answers a structural id with QueuePayloadError, not QueueUnavailableError, on an unconfigured client", async () => {
      await assertInvalidJobIdAnswersBeforeAvailability();
    });
  });

  describe("enqueue — payload (decision 6, review M2)", () => {
    it("refuses a tenant payload without organizationId", async () => {
      await assertTenantPayloadWithoutOrganizationIdIsRefused();
    });

    it("adds a tenant payload that carries a UUID organizationId (positive control)", async () => {
      await assertTenantPayloadWithOrganizationIdIsAdded();
    });

    it("refuses a non-UUID organizationId as invalid_payload, not missing_organization_id", async () => {
      await assertTenantNonUuidOrganizationIdIsInvalidPayloadNotMissing();
    });

    it("refuses a payload failing its schema, naming the field path and not the value", async () => {
      await assertPayloadFailingItsSchemaIsRefusedAtEnqueue();
    });

    it("adds the schema's output, with an undeclared key stripped", async () => {
      await assertEnqueueAddsTheSchemaOutputNotTheRawObject();
    });

    it("answers a schema refusal with QueuePayloadError, not QueueUnavailableError, on an unconfigured client", async () => {
      await assertInvalidPayloadAnswersBeforeAvailability();
    });

    it("adds a fleet payload without organizationId", async () => {
      await assertFleetPayloadNeedsNoOrganizationId();
    });
  });

  describe("enqueue — availability and the registry (decision 9)", () => {
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

    it("refuses a payload failing its schema", async () => {
      await assertUpsertScheduleRefusesAPayloadFailingItsSchema();
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
