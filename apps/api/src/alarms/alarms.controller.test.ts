import { describe, it } from "vitest";

import {
  assertAMalformedListQueryIsABadRequest,
  assertAMalformedListQueryRunsNothing,
  assertAMalformedSummaryQueryIsABadRequest,
  assertAnEmptySummaryQueryUsesTheReadableScope,
  assertARequestedForeignAssetNeverWidensTheSummary,
  assertAnAllForeignRequestBecomesAnEmptyScope,
  assertAnEmptyQueryKeepsTodaysRead,
  assertANonNumericLimitIsABadRequest,
  assertAnUnrestrictedScopeStaysNull,
  assertARequestedForeignAssetNeverWidensTheList,
  assertLimitIsCoercedAndPassedThrough,
  assertStateActiveIsPassedThrough,
  assertListAbsentOrganizationIdPassesNone,
  assertListNonUuidOrganizationIdIsABadRequest,
  assertListOrganizationIdKeepsTheReadableScope,
  assertListPassesTheOrganizationIdThrough,
  assertSummaryNonUuidOrganizationIdIsABadRequest,
  assertSummaryOrganizationIdKeepsTheReadableScope,
  assertSummaryPassesTheOrganizationIdThrough,
} from "./alarms.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("alarms.controller — GET /alarms query wiring (F3.28)", () => {
  it("passes only the readable part of a requested assetIds to the service", async () => {
    await assertARequestedForeignAssetNeverWidensTheList();
  });

  it("turns an all-foreign assetIds request into an empty scope, never null", async () => {
    await assertAnAllForeignRequestBecomesAnEmptyScope();
  });

  it("keeps today's read for an empty query: readable scope, state all, limit 20", async () => {
    await assertAnEmptyQueryKeepsTodaysRead();
  });

  it("keeps an unrestricted admin's null scope as null", async () => {
    await assertAnUnrestrictedScopeStaysNull();
  });

  it("passes state=active through to the service", async () => {
    await assertStateActiveIsPassedThrough();
  });

  it("coerces limit and leaves the clamp to the service", async () => {
    await assertLimitIsCoercedAndPassedThrough();
  });

  it("answers a malformed list query with 400", async () => {
    await assertAMalformedListQueryIsABadRequest();
  });

  it("answers limit=abc with 400", async () => {
    await assertANonNumericLimitIsABadRequest();
  });

  it("runs neither the scope read nor the list on a malformed query", async () => {
    await assertAMalformedListQueryRunsNothing();
  });
});

describe("alarms.controller — GET /alarms/summary query wiring (F3.28)", () => {
  it("passes only the readable part of a requested assetIds to the summary", async () => {
    await assertARequestedForeignAssetNeverWidensTheSummary();
  });

  it("uses the caller's readable set when the summary query names no assets", async () => {
    await assertAnEmptySummaryQueryUsesTheReadableScope();
  });

  it("answers a summary query with an unknown key with 400", async () => {
    await assertAMalformedSummaryQueryIsABadRequest();
  });
});

describe("alarms.controller — organizationId on GET /alarms and /alarms/summary (F3.66)", () => {
  it("passes organizationId through to the list", async () => {
    await assertListPassesTheOrganizationIdThrough();
  });

  it("keeps the readable set beside organizationId on the list", async () => {
    await assertListOrganizationIdKeepsTheReadableScope();
  });

  it("answers a non-uuid organizationId on the list with 400", async () => {
    await assertListNonUuidOrganizationIdIsABadRequest();
  });

  it("passes no organizationId to the list when none is sent", async () => {
    await assertListAbsentOrganizationIdPassesNone();
  });

  it("passes organizationId through to the summary", async () => {
    await assertSummaryPassesTheOrganizationIdThrough();
  });

  it("keeps the readable set beside organizationId on the summary", async () => {
    await assertSummaryOrganizationIdKeepsTheReadableScope();
  });

  it("answers a non-uuid organizationId on the summary with 400", async () => {
    await assertSummaryNonUuidOrganizationIdIsABadRequest();
  });
});
