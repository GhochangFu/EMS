import { describe, it } from "vitest";

import {
  assertCreateAcceptsAnAdminWithANullOrganization,
  assertCreateAcceptsATwelveCharacterPassword,
  assertCreateRefusesAnAdminWithAnOrganization,
  assertCreateRefusesANonAdminWithoutAnOrganization,
  assertCreateRefusesAnElevenCharacterPassword,
  assertCreateTrimsAndLowerCasesTheEmail,
  assertListResponseRefusesARowWithoutLinked,
  assertTemporaryPasswordBodyAcceptsTwelveCharacters,
  assertTemporaryPasswordBodyRefusesElevenCharacters,
  assertUpdateAcceptsADisplayNameAlone,
  assertUpdateRefusesAnEmptyBody,
  assertUpdateRefusesANonAdminRoleWithANullOrganization,
  assertUpdateRefusesAnOrganizationWithoutARole,
  assertUpdateRefusesAnUnknownKey,
  assertUpdateRefusesToAdminWithAnOrganization,
  assertWriteResponseAcceptsANullFollowUp,
  assertWriteResponseRefusesAnUnknownFollowUp,
} from "./users.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.78 — users API contracts (ADR 0089 decision 1)", () => {
  it("create trims and lower-cases the email", () => {
    assertCreateTrimsAndLowerCasesTheEmail();
  });

  it("create refuses role admin with an organization", () => {
    assertCreateRefusesAnAdminWithAnOrganization();
  });

  it("create refuses a non-admin role with a null organization", () => {
    assertCreateRefusesANonAdminWithoutAnOrganization();
  });

  it("create accepts role admin with a null organization", () => {
    assertCreateAcceptsAnAdminWithANullOrganization();
  });

  it("create refuses an 11-character temporary password", () => {
    assertCreateRefusesAnElevenCharacterPassword();
  });

  it("create accepts a 12-character temporary password", () => {
    assertCreateAcceptsATwelveCharacterPassword();
  });

  it("update is strict: an unknown key (email) is refused", () => {
    assertUpdateRefusesAnUnknownKey();
  });

  it("update refuses an empty body", () => {
    assertUpdateRefusesAnEmptyBody();
  });

  it("update refuses organizationId without role", () => {
    assertUpdateRefusesAnOrganizationWithoutARole();
  });

  it("update refuses role admin with an organization", () => {
    assertUpdateRefusesToAdminWithAnOrganization();
  });

  it("update refuses a non-admin role with a null organization", () => {
    assertUpdateRefusesANonAdminRoleWithANullOrganization();
  });

  it("update accepts displayName alone", () => {
    assertUpdateAcceptsADisplayNameAlone();
  });

  it("temporary-password body refuses 11 characters", () => {
    assertTemporaryPasswordBodyRefusesElevenCharacters();
  });

  it("temporary-password body accepts 12 characters", () => {
    assertTemporaryPasswordBodyAcceptsTwelveCharacters();
  });

  it("write response refuses an unknown followUp", () => {
    assertWriteResponseRefusesAnUnknownFollowUp();
  });

  it("write response accepts a null followUp", () => {
    assertWriteResponseAcceptsANullFollowUp();
  });

  it("list response refuses a row without linked", () => {
    assertListResponseRefusesARowWithoutLinked();
  });
});
