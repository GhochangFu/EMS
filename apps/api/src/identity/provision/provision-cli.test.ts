import { describe, it } from "vitest";

import * as spec from "./provision-cli.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.78 U4 — keycloak:provision against a stubbed Keycloak (ADR 0089 decision 5)", () => {
  it("an empty KEYCLOAK_ADMIN_CLIENT_SECRET exits 1 before any request", async () => {
    await spec.assertAnEmptySecretIsRefusedBeforeAnyCall();
  });

  it("an unset KEYCLOAK_ADMIN_PASSWORD exits 1 before any request", async () => {
    await spec.assertAnUnsetAdminPasswordIsRefusedBeforeAnyCall();
  });

  it("a localhost URL exits 1 before any request", async () => {
    await spec.assertALocalhostUrlIsRefusedBeforeAnyCall();
  });

  it("a successful run exits 0", async () => {
    await spec.assertASuccessfulRunExitsZero();
  });

  it("the secret is PUT from KEYCLOAK_ADMIN_CLIENT_SECRET", async () => {
    await spec.assertTheSecretIsSetFromTheEnvironment();
  });

  it("a missing client is created without a secret", async () => {
    await spec.assertAMissingClientIsCreatedWithoutASecret();
  });

  it("the realm PUT carries the password policy and brute force", async () => {
    await spec.assertTheRealmSettingsCarryThePolicy();
  });

  it("the service account ends with exactly manage-users and view-users", async () => {
    await spec.assertTheServiceAccountGetsExactlyTheTwoRoles();
  });

  it("the user-profile PUT is the live config with email edit admin-only", async () => {
    await spec.assertTheUserProfilePutKeepsTheOtherAttributes();
  });

  it("the user-profile PUT leaves firstName and lastName optional (Q-D)", async () => {
    await spec.assertTheUserProfilePutMakesTheNamesOptional();
  });

  it("the first request is retried while Keycloak starts", async () => {
    await spec.assertTheFirstRequestIsRetried();
  });

  it("the first request gives up after the retry window", async () => {
    await spec.assertTheFirstRequestGivesUpAfterTheWindow();
  });

  it("a non-empty report exits 2 and names users by email", async () => {
    await spec.assertANonEmptyReportExitsTwo();
  });

  it("realm users are paged", async () => {
    await spec.assertTheRealmUsersArePaged();
  });

  it("a failing PUT leaks no client secret", async () => {
    await spec.assertAFailingPutLeaksNoSecret();
  });

  it("a failing PUT leaks no admin password", async () => {
    await spec.assertAFailingPutLeaksNoAdminPassword();
  });

  it("a failing PUT is reported by its status", async () => {
    await spec.assertAFailingPutNamesTheStatus();
  });

  it("a successful run prints neither the secret nor the admin password", async () => {
    await spec.assertASuccessfulRunLeaksNoSecret();
  });

  it("a network error's message is not forwarded", async () => {
    await spec.assertANetworkErrorMessageIsNotForwarded();
  });
});
