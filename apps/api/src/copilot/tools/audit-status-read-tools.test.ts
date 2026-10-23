import "reflect-metadata";

import { describe, it } from "vitest";

import {
  assertListAuditLogBoundsThePayloadAndTheResult,
  assertListAuditLogMapsTheServiceRoleRefusal,
  assertListAuditLogNeverOffersTheExport,
  assertListAuditLogReadsOncePerOrganizationWithThatOrganizationOnly,
  assertListAuditLogRefusesAnOwnKeyOrganizationAndReadsAnAllowedOne,
  assertListAuditLogPagesOneOrganizationOnly,
  assertListAuditLogSchemaBounds,
  assertListAuditLogStopsReadingAfterTheBudgetDropsARow,
  assertListAuditLogStripsTheActorSubject,
  assertSystemStatusReadsOnceOverTheUnionAndNeverNull,
  assertSystemStatusWithNoReadableAssetReadsAnEmptyList,
  assertTheTurnAnswersIsIngestHealthy,
  assertTheTurnAnswersWhoChangedThisAssetYesterday,
  assertTheTurnScrubsAnAuditPayload,
} from "./audit-status-read-tools.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.277 — the copilot's audit-log and system-status read tools", () => {
  it("list_audit_log refuses an own-key organization and reads an allowed one restricted to it", assertListAuditLogRefusesAnOwnKeyOrganizationAndReadsAnAllowedOne);
  it("list_audit_log reads once per organization, restricted to that organization, sharing the room", assertListAuditLogReadsOncePerOrganizationWithThatOrganizationOnly);
  it("list_audit_log maps the service's role refusal to a sentence and lets any other failure through", assertListAuditLogMapsTheServiceRoleRefusal);
  it("list_audit_log's schema bounds the page, the time and the keys before any dispatch", assertListAuditLogSchemaBounds);
  it("list_audit_log summarises a large payload and keeps the result under the tool-result cut", assertListAuditLogBoundsThePayloadAndTheResult);
  it("list_audit_log refuses a page past the first over more than one organization and pages one named organization", assertListAuditLogPagesOneOrganizationOnly);
  it("list_audit_log stops reading organizations once the budget drops a row and stays under the cut", assertListAuditLogStopsReadingAfterTheBudgetDropsARow);
  it("list_audit_log strips the acting operator's oidcSubject from every payload", assertListAuditLogStripsTheActorSubject);
  it("a turn scrubs a secret in an audit payload by key and by value", assertTheTurnScrubsAnAuditPayload);
  it("a turn answers who changed an asset yesterday, and refuses an own-key organization", assertTheTurnAnswersWhoChangedThisAssetYesterday);
  it("list_audit_log never offers the export", assertListAuditLogNeverOffersTheExport);
  it("get_system_status reads once over the union of readable assets and never with null", assertSystemStatusReadsOnceOverTheUnionAndNeverNull);
  it("get_system_status with no readable asset reads an empty list, never null", assertSystemStatusWithNoReadableAssetReadsAnEmptyList);
  it("a turn answers whether ingest is healthy from the component states", assertTheTurnAnswersIsIngestHealthy);
});
