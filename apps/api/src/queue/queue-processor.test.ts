import { describe, it } from "vitest";

import {
  assertFleetHandlerNeverEntersWithTenant,
  assertFleetHandlerReceivesTheFleetDb,
  assertFleetHandlerThrowPropagatesUnchanged,
  assertRegistrationCarriesTheDeclaration,
  assertTenantHandlerReceivesThePayload,
  assertTenantHandlerReceivesTheTransactionFromWithTenant,
  assertTenantHandlerRunsWithTenantOnTheTenantPoolForTheOrganization,
  assertTenantHandlerThrowPropagatesUnchanged,
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

    it("propagates a handler throw unchanged", async () => {
      await assertFleetHandlerThrowPropagatesUnchanged();
    });
  });

  it("carries the declaration on the registration", () => {
    assertRegistrationCarriesTheDeclaration();
  });
});
