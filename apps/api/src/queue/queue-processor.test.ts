import { describe, it } from "vitest";

import {
  assertAfterCommitIsSkippedWhenTheCommitFailed,
  assertAfterCommitIsSkippedWhenTheHandlerThrew,
  assertAfterCommitRejectionFailsTheJob,
  assertAfterCommitRunsAfterWithTenantResolved,
  assertAfterCommitRunsForAFleetHandlerToo,
  assertFleetHandlerNeverEntersWithTenant,
  assertFleetHandlerReceivesTheFleetDb,
  assertFleetHandlerThrowPropagatesUnchanged,
  assertFleetPayloadFailingItsSchemaIsRefusedAtTheProcessor,
  assertHandlerReceivesTheSchemaOutputNotRawJobData,
  assertRegistrationCarriesTheDeclaration,
  assertTenantHandlerReceivesThePayload,
  assertTenantHandlerReceivesTheTransactionFromWithTenant,
  assertTenantHandlerRunsWithTenantOnTheTenantPoolForTheOrganization,
  assertTenantHandlerThrowPropagatesUnchanged,
  assertTenantNonUuidOrganizationIdIsInvalidPayloadAtTheProcessor,
  assertTenantPayloadFailingItsSchemaIsRefusedAtTheProcessor,
  assertTenantPayloadWithoutOrganizationIdIsRefusedAtTheProcessor,
} from "./queue-processor.spec";

/**
 * F4.24 (ADR 0063 decision 6) — Vitest entry point for the tenancy-bound
 * processor wrapper. Assertions live in the sibling `.spec` (§4.6/ADR 0014);
 * this file only runs them. The real `withTenant` is exercised by
 * `queue-processor.integration.test.ts`.
 */
describe("F4.24 — tenancy-bound processors", () => {
  describe("tenant queue", () => {
    it("hands the handler the transaction withTenant opened", async () => {
      await assertTenantHandlerReceivesTheTransactionFromWithTenant();
    });

    it("runs withTenant on the tenant pool for the payload's organizationId", async () => {
      await assertTenantHandlerRunsWithTenantOnTheTenantPoolForTheOrganization();
    });

    it("hands the handler job.data unchanged", async () => {
      await assertTenantHandlerReceivesThePayload();
    });

    it("refuses a payload without organizationId before the handler or withTenant run", async () => {
      await assertTenantPayloadWithoutOrganizationIdIsRefusedAtTheProcessor();
    });

    it("refuses a payload failing its schema before the handler or withTenant run (review M2)", async () => {
      await assertTenantPayloadFailingItsSchemaIsRefusedAtTheProcessor();
    });

    it("refuses a non-UUID organizationId as invalid_payload, never entering withTenant", async () => {
      await assertTenantNonUuidOrganizationIdIsInvalidPayloadAtTheProcessor();
    });

    it("propagates a handler throw unchanged", async () => {
      await assertTenantHandlerThrowPropagatesUnchanged();
    });
  });

  describe("fleet queue", () => {
    it("hands the handler the fleet db", async () => {
      await assertFleetHandlerReceivesTheFleetDb();
    });

    it("never enters withTenant", async () => {
      await assertFleetHandlerNeverEntersWithTenant();
    });

    it("refuses a payload failing its schema before the handler runs (review M2)", async () => {
      await assertFleetPayloadFailingItsSchemaIsRefusedAtTheProcessor();
    });

    it("hands the handler the schema's output, with an undeclared key stripped", async () => {
      await assertHandlerReceivesTheSchemaOutputNotRawJobData();
    });

    it("propagates a handler throw unchanged", async () => {
      await assertFleetHandlerThrowPropagatesUnchanged();
    });
  });

  /**
   * F3.5b (ADR 0071 Amendment 2, plan R-5) — the post-commit continuation.
   * The tenant and fleet rows above are the positive control: a handler that
   * returns `void` still completes.
   */
  describe("post-commit continuation", () => {
    it("runs afterCommit after withTenant resolved, never inside the transaction", async () => {
      await assertAfterCommitRunsAfterWithTenantResolved();
    });

    it("runs afterCommit for a fleet handler after the handler, with no withTenant call", async () => {
      await assertAfterCommitRunsForAFleetHandlerToo();
    });

    it("never runs afterCommit when the handler threw", async () => {
      await assertAfterCommitIsSkippedWhenTheHandlerThrew();
    });

    it("never runs afterCommit when withTenant rejected after the handler (a commit failure)", async () => {
      await assertAfterCommitIsSkippedWhenTheCommitFailed();
    });

    it("fails the job when afterCommit rejects, with the continuation's error unchanged", async () => {
      await assertAfterCommitRejectionFailsTheJob();
    });
  });

  it("carries the declaration on the registration", () => {
    assertRegistrationCarriesTheDeclaration();
  });
});
