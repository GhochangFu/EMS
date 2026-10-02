import { describe, it } from "vitest";

import * as spec from "./identity-admin.client.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.78 U3 — KeycloakIdentityAdminClient (ADR 0089 decision 5)", () => {
  describe("the token", () => {
    it("requests a client-credentials token", async () => {
      await spec.assertTheTokenRequestIsClientCredentials();
    });

    it("sends the token as a bearer header", async () => {
      await spec.assertTheAdminCallCarriesTheBearerToken();
    });

    it("reuses the token inside its lifetime", async () => {
      await spec.assertTheTokenIsReusedInsideItsLifetime();
    });

    it("refreshes the token 30 s before expiry", async () => {
      await spec.assertTheTokenIsRefreshedThirtySecondsBeforeExpiry();
    });

    it("maps a token-endpoint 401 to unauthorized_client", async () => {
      await spec.assertATokenEndpoint401IsUnauthorizedClient();
    });

    it("does not echo a malformed token body", async () => {
      await spec.assertAMalformedTokenBodyDoesNotLeak();
    });
  });

  describe("createUser", () => {
    it("posts enabled: false", async () => {
      await spec.assertCreatePostsADisabledUser();
    });

    it("posts emailVerified: true", async () => {
      await spec.assertCreatePostsAVerifiedEmail();
    });

    it("posts a lower-cased username equal to the email", async () => {
      await spec.assertCreateLowerCasesTheUsernameAndEmail();
    });

    it("writes the display name to firstName only", async () => {
      await spec.assertCreateWritesTheDisplayNameToFirstNameOnly();
    });

    it("reads the id from Location", async () => {
      await spec.assertCreateReadsTheIdFromLocation();
    });

    it("throws without Location and never searches by username", async () => {
      await spec.assertCreateWithoutLocationThrowsAndNeverSearches();
    });

    it("maps 409 to conflict", async () => {
      await spec.assertCreateConflictIsConflict();
    });

    it("keeps error_description (SECRET-WORD) out of the thrown message", async () => {
      await spec.assertTheErrorDescriptionNeverReachesTheMessage();
    });

    it("keeps error_description (SECRET-WORD) out of the log", async () => {
      await spec.assertTheErrorDescriptionNeverReachesTheLog();
    });
  });

  describe("the other writes", () => {
    it("setTemporaryPassword sends temporary: true", async () => {
      await spec.assertSetTemporaryPasswordSendsTemporaryTrue();
    });

    it("setEnabled puts the flag", async () => {
      await spec.assertSetEnabledPutsTheFlag();
    });

    it("logoutSessions posts logout", async () => {
      await spec.assertLogoutSessionsPostsLogout();
    });

    it("deleteUser is DELETE /users/{id}", async () => {
      await spec.assertDeleteUserIsDeleteUsersId();
    });

    it("escapes the id in the path", async () => {
      await spec.assertTheIdIsEscapedInThePath();
    });

    it("maps a network failure to unavailable", async () => {
      await spec.assertANetworkFailureIsUnavailable();
    });

    it("throws an error named IdentityAdminError", async () => {
      await spec.assertTheErrorIsNamedIdentityAdminError();
    });
  });

  describe("setRealmRole", () => {
    it("removes the other five BMS roles", async () => {
      await spec.assertSetRealmRoleRemovesTheOtherFive();
    });

    it("adds the one role", async () => {
      await spec.assertSetRealmRoleAddsTheOne();
    });

    it("leaves default-roles-bms and offline_access mapped", async () => {
      await spec.assertSetRealmRoleLeavesTheDefaultRolesMapped();
    });

    it("sends Keycloak's role id and name", async () => {
      await spec.assertSetRealmRoleSendsTheRoleIds();
    });

    it("does not re-add a mapped role", async () => {
      await spec.assertSetRealmRoleDoesNotReAddAMappedRole();
    });

    it("refuses an unavailable role before removing anything", async () => {
      await spec.assertSetRealmRoleRefusesAnUnavailableRoleBeforeRemovingAnything();
    });
  });

  describe("errors, the module and the fake", () => {
    it("mapKeycloakFailure is a fixed status table", () => {
      spec.assertMapKeycloakFailureIsAFixedTable();
    });

    it("IdentityAdminError carries its reason and status", () => {
      spec.assertTheErrorClassCarriesAReason();
    });

    it("NotConfiguredIdentityAdmin rejects every method with not_configured", async () => {
      await spec.assertNotConfiguredRejectsEveryMethod();
    });

    it("createIdentityAdmin provides the stand-in when unconfigured", () => {
      spec.assertCreateIdentityAdminPicksTheStandInWhenUnconfigured();
    });

    it("createIdentityAdmin provides the Keycloak client when configured", () => {
      spec.assertCreateIdentityAdminPicksTheClientWhenConfigured();
    });

    it("FakeIdentityAdmin records calls and fails once", async () => {
      await spec.assertTheFakeRecordsCallsAndFailsOnce();
    });

    it("FakeIdentityAdmin returns a distinct id per user", async () => {
      await spec.assertTheFakeReturnsDistinctIds();
    });
  });
});
