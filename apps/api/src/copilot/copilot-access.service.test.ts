import { describe, it } from "vitest";

import {
  assertAStaleExceptionCanBeRemoved,
  assertAnExceptionForANonAdministratorIsRefused,
  assertAnExceptionForAnUnknownOrForeignUserGetsOneAnswer,
  assertAnOperatorIsRefusedOnGetAndPut,
  assertAnOrganizationAdminIsRefusedForAnotherOrganization,
  assertOnlyTheGlobalAdminSetsTheOrganizationSwitch,
  assertScopedAdministratorsCannotReadTheSettings,
  assertScopedAdministratorsCannotSetARoleSwitch,
  assertScopedAdministratorsCannotSetTheOrganizationSwitch,
  assertScopedAdministratorsCannotSetTheirOwnException,
  assertAnOrganizationAdminsAttachmentWriteWithNoRowIs409,
  assertAnOrganizationAdminSetsAttachmentsOnAnExistingRowOnly,
  assertAnOrganizationAdminCannotSendEnabledWithAttachments,
  assertTheGlobalAdminsAttachmentWriteCreatesTheRowOff,
  assertTheGlobalAdminsAttachmentWriteKeepsEnabled,
  assertTheAuditPayloadCarriesAttachmentsEnabled,
  assertNoRowReadsAsAttachmentsOff,
} from "./copilot-access.service.spec";

describe("F3.85 — the copilot access settings (ADR 0099 decision 5, plan §5.2)", () => {
  it("refuses an operator on GET and PUT", () => assertAnOperatorIsRefusedOnGetAndPut());
  it("refuses the scoped administrators a read of the settings", () =>
    assertScopedAdministratorsCannotReadTheSettings());
  it("refuses the scoped administrators a role switch", () => assertScopedAdministratorsCannotSetARoleSwitch());
  it("refuses the scoped administrators their own exception", () =>
    assertScopedAdministratorsCannotSetTheirOwnException());
  it("refuses an organization admin another organization", () =>
    assertAnOrganizationAdminIsRefusedForAnotherOrganization());
  it("lets only the global admin set the organization switch", () =>
    assertOnlyTheGlobalAdminSetsTheOrganizationSwitch());
  it("answers an unknown and a foreign exception target the same way", () =>
    assertAnExceptionForAnUnknownOrForeignUserGetsOneAnswer());
  it("refuses an exception for a non-administrator", () => assertAnExceptionForANonAdministratorIsRefused());
  it("removes a stale exception without checking its user", () => assertAStaleExceptionCanBeRemoved());
  it("refuses the scoped administrators the organization switch", () =>
    assertScopedAdministratorsCannotSetTheOrganizationSwitch());
});

describe("F3.87 — the attachment switch (ADR 0099 Amendment 3 A7, ruling Q3, D3)", () => {
  it("answers an organization admin's write with no row 409 and writes nothing", () =>
    assertAnOrganizationAdminsAttachmentWriteWithNoRowIs409());
  it("updates an existing row for an organization admin, never inserting, enabled unchanged", () =>
    assertAnOrganizationAdminSetsAttachmentsOnAnExistingRowOnly());
  it("refuses an organization admin who sends enabled beside attachmentsEnabled", () =>
    assertAnOrganizationAdminCannotSendEnabledWithAttachments());
  it("creates the row with enabled false for the global admin", () =>
    assertTheGlobalAdminsAttachmentWriteCreatesTheRowOff());
  it("keeps enabled on the global admin's upsert of an existing row", () =>
    assertTheGlobalAdminsAttachmentWriteKeepsEnabled());
  it("names attachmentsEnabled in the audit payload", () => assertTheAuditPayloadCarriesAttachmentsEnabled());
  it("reads no row as attachments off", () => assertNoRowReadsAsAttachmentsOff());
});
