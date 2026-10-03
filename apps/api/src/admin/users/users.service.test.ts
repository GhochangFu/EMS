import { afterEach, describe, it, vi } from "vitest";

import * as spec from "./users.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("F3.78 — UsersService.create (ADR 0089 decision 3)", () => {
  it("the Keycloak create precedes the db insert", async () => {
    await spec.assertKeycloakCreatePrecedesTheInsert();
  });

  it("the insert carries the id parsed from this request's create", async () => {
    await spec.assertTheInsertCarriesTheParsedId();
  });

  it("setEnabled(true) runs only after the insert", async () => {
    await spec.assertCreateEnablesKeycloakOnlyAfterTheInsert();
  });

  it("a db failure deletes exactly the parsed id", async () => {
    await spec.assertADbFailureDeletesExactlyTheParsedId();
  });

  it("a failing delete logs the Keycloak id and not the email", async () => {
    await spec.assertAFailingDeleteLogsTheIdAndNotTheEmail();
  });

  it("a failed insert whose compensating delete fails logs the SQLSTATE and constraint, not the email or pg detail", async () => {
    await spec.assertAFailedInsertWhoseDeleteFailsLogsTheSqlstateAndNotTheRow();
  });

  it("a failed insert whose compensating delete fails is a 500", async () => {
    await spec.assertAnOrphanedInsertFailureIs500();
  });

  it("a failed insert whose compensating delete fails carries followUp keycloak_orphan_disabled_account", async () => {
    await spec.assertAnOrphanedInsertFailureCarriesTheOrphanFollowUp();
  });

  it("a failed insert whose compensating delete fails has a generic message", async () => {
    await spec.assertAnOrphanedInsertFailureHasAGenericMessage();
  });

  it("a failed insert whose compensating delete fails names neither the email nor the cause in its body", async () => {
    await spec.assertAnOrphanedInsertFailureBodyNamesNeitherTheEmailNorTheCause();
  });

  it("a failed create whose compensating delete fails keeps its status and says a disabled Keycloak account remains", async () => {
    await spec.assertAFailingDeleteAddsTheOrphanFollowUpAndKeepsTheStatus();
  });

  it("a password Keycloak's policy refuses is 400 naming the rule class, not the password", async () => {
    await spec.assertAPolicyRefusedPasswordIs400("create");
  });

  it("a duplicate email is 409 before any Keycloak call", async () => {
    await spec.assertADuplicateEmailIs409BeforeKeycloak();
  });

  it("a body with role admin and an organization is 400 before any Keycloak call", async () => {
    await spec.assertAnAdminBodyWithAnOrganizationIs400BeforeKeycloak();
  });

  it("organization_admin creating an admin is 403", async () => {
    await spec.assertAnOrganizationAdminCreatingAnAdminIs403();
  });

  it("organization_admin with a body organizationId outside its organizations is refused before Keycloak", async () => {
    await spec.assertAnOrganizationAdminCreatingOutsideItsOrganizationsIsRefused();
  });

  it("creating a viewer inserts on the tenant transaction under the target organization's GUC", async () => {
    await spec.assertCreatingAViewerInsertsUnderTheTargetsGuc();
  });

  it("creating an admin inserts on the fleet transaction", async () => {
    await spec.assertCreatingAnAdminInsertsOnTheFleetTransaction();
  });
});

describe("F3.78 — the admin-target rule, one action per case (ADR 0089 decision 2)", () => {
  it("organization_admin PATCH displayName on an admin target is a 404 that does not name it", async () => {
    await spec.assertOrganizationAdminOnAnAdminTargetIsHidden("PATCH displayName");
  });

  it("organization_admin PATCH role on an admin target is a 404 that does not name it", async () => {
    await spec.assertOrganizationAdminOnAnAdminTargetIsHidden("PATCH role");
  });

  it("organization_admin deactivate on an admin target is a 404 that does not name it", async () => {
    await spec.assertOrganizationAdminOnAnAdminTargetIsHidden("deactivate");
  });

  it("organization_admin reactivate on an admin target is a 404 that does not name it", async () => {
    await spec.assertOrganizationAdminOnAnAdminTargetIsHidden("reactivate");
  });

  it("organization_admin temporary-password on an admin target is a 404 that does not name it", async () => {
    await spec.assertOrganizationAdminOnAnAdminTargetIsHidden("temporary-password");
  });
});

describe("F3.78 — C1 cross-organization target, one action per case (ADR 0089 decision 2)", () => {
  it("C1 PATCH displayName on a target granted another organization is a 404 that does not name it", async () => {
    await spec.assertOrganizationAdminOnACrossOrganizationTargetIsHidden("PATCH displayName");
  });

  it("C1 PATCH role on a target granted another organization is a 404 that does not name it", async () => {
    await spec.assertOrganizationAdminOnACrossOrganizationTargetIsHidden("PATCH role");
  });

  it("C1 deactivate on a target granted another organization is a 404 that does not name it", async () => {
    await spec.assertOrganizationAdminOnACrossOrganizationTargetIsHidden("deactivate");
  });

  it("C1 reactivate on a target granted another organization is a 404 that does not name it", async () => {
    await spec.assertOrganizationAdminOnACrossOrganizationTargetIsHidden("reactivate");
  });

  it("C1 temporary-password on a target granted another organization is a 404 that does not name it", async () => {
    await spec.assertOrganizationAdminOnACrossOrganizationTargetIsHidden("temporary-password");
  });

  it("jwt.role admin with an organization_admin row gets the organization_admin rules (stale token)", async () => {
    await spec.assertTheRowsRoleDecidesNotTheTokens();
  });
});

describe("F3.78 — UsersService.list", () => {
  it("as organization_admin excludes admin rows", async () => {
    await spec.assertListAsOrganizationAdminExcludesAdminRows();
  });

  it("as organization_admin excludes a home-org user granted another organization", async () => {
    await spec.assertListAsOrganizationAdminExcludesAUserGrantedAnotherOrganization();
  });

  it("never carries a password hash", async () => {
    await spec.assertListNeverCarriesAPasswordHash();
  });
});

describe("F3.78 — UsersService.update", () => {
  it("a self role change is 403", async () => {
    await spec.assertASelfRoleChangeIs403();
  });

  it("demoting the last active admin is refused", async () => {
    await spec.assertDemotingTheLastActiveAdminIsRefused();
  });

  it("PATCH organizationId without an admin boundary crossing is 400", async () => {
    await spec.assertAnOrganizationWithoutABoundaryCrossingIs400();
  });

  it("PATCH to admin with an organization is 400", async () => {
    await spec.assertToAdminWithAnOrganizationIs400();
  });

  it("a promotion to admin writes on the fleet transaction", async () => {
    await spec.assertAPromotionWritesOnTheFleetTransaction();
  });

  it("a role change mirrors to Keycloak before the db write", async () => {
    await spec.assertARoleChangeMirrorsToKeycloakBeforeTheDb();
  });

  it("a db failure after a role mirror restores the old Keycloak role", async () => {
    await spec.assertARoleChangeDbFailureUndoesKeycloak();
  });
});

describe("F3.78 — unlinked targets are 409 with Keycloak not called (ADR 0089 decision 4)", () => {
  it("update of an unlinked user is 409", async () => {
    await spec.assertAnUnlinkedTargetIs409("update");
  });

  it("deactivate of an unlinked user is 409", async () => {
    await spec.assertAnUnlinkedTargetIs409("deactivate");
  });

  it("reactivate of an unlinked user is 409", async () => {
    await spec.assertAnUnlinkedTargetIs409("reactivate");
  });

  it("temporary-password of an unlinked user is 409", async () => {
    await spec.assertAnUnlinkedTargetIs409("temporary-password");
  });
});

describe("F3.78 — UsersService.deactivate (ADR 0089 decision 8)", () => {
  it("a self-deactivate is 403", async () => {
    await spec.assertASelfDeactivateIs403();
  });

  it("a self-deactivate with the caller's id in uppercase is 403", async () => {
    await spec.assertASelfDeactivateWithAnUppercaseIdIs403();
  });

  it("writes disabled_at and the NOTIFY before setEnabled(false)", async () => {
    await spec.assertDeactivateStampsAndNotifiesBeforeDisablingKeycloak();
  });

  it("an already disabled row writes one { alreadyDisabled: true } audit row", async () => {
    await spec.assertARepeatedDeactivateWritesOneAlreadyDisabledAuditRow();
  });

  it("an already disabled row skips the update and the NOTIFY", async () => {
    await spec.assertARepeatedDeactivateSkipsTheUpdateAndTheNotify();
  });

  it("an already disabled row still calls setEnabled(false) and logoutSessions", async () => {
    await spec.assertARepeatedDeactivateStillDisablesKeycloakAndEndsSessions();
  });

  it("an empty UPDATE … RETURNING throws 'the user changed under you'", async () => {
    await spec.assertAnEmptyDeactivateUpdateThrows();
  });

  it("an empty UPDATE … RETURNING writes no audit row", async () => {
    await spec.assertAnEmptyDeactivateUpdateWritesNoAudit();
  });

  it("an empty UPDATE … RETURNING sends no NOTIFY", async () => {
    await spec.assertAnEmptyDeactivateUpdateSendsNoNotify();
  });

  it("a Keycloak failure on deactivate is a 200 with followUp", async () => {
    await spec.assertAKeycloakFailureOnDeactivateIsAFollowUp();
  });
});

describe("F3.78 — UsersService.reactivate", () => {
  it("an active row writes one { clearedDisabledAt: false } audit row", async () => {
    await spec.assertReactivatingAnActiveRowWritesOneUnclearedAuditRow();
  });

  it("an active row still enables the Keycloak account", async () => {
    await spec.assertReactivatingAnActiveRowEnablesKeycloak();
  });
});

describe("F3.78 — UsersService.temporaryPassword (ADR 0089 decision 6)", () => {
  it("a temporary password under 12 characters is refused by the schema", async () => {
    await spec.assertAShortTemporaryPasswordIsRefusedByTheSchema();
  });

  it("the audit payload has no temporaryPassword key", async () => {
    await spec.assertTheTemporaryPasswordAuditHasNoPassword();
  });

  it("sets the password, then ends the sessions", async () => {
    await spec.assertTheTemporaryPasswordEndsTheSessions();
  });

  it("a password Keycloak's policy refuses is 400 naming the rule class, not the password", async () => {
    await spec.assertAPolicyRefusedPasswordIs400("temporary-password");
  });

  it("an audit failure stops before any Keycloak call (decision 14)", async () => {
    await spec.assertATemporaryPasswordAuditFailureCallsNoKeycloak();
  });

  it("a definite Keycloak refusal leaves no committed audit row (decision 14)", async () => {
    await spec.assertATemporaryPasswordKeycloakFailureCommitsNoAudit();
  });

  it.each(["unavailable", "unexpected_response"] as const)(
    "%s from setTemporaryPassword is an unknown outcome: one committed audit row, then 502 (decision 14)",
    async (reason) => {
      await spec.assertAnUnknownTemporaryPasswordOutcomeCommitsTheAudit(reason);
    },
  );

  it("a logout failure after the password is set commits sessionsEnded false and keycloak_logout_failed (decision 14)", async () => {
    await spec.assertATemporaryPasswordLogoutFailureCommitsATruthfulAudit();
  });
});

describe("F3.78 — local mode and an unconfigured client (ADR 0089 decisions 5 and 11)", () => {
  it("local mode is 409 with the identity fake untouched", async () => {
    await spec.assertLocalModeIs409WithKeycloakUntouched();
  });

  it("not_configured is 503", async () => {
    await spec.assertNotConfiguredIs503();
  });

  it("not_configured still serves the list (the module's NotConfiguredIdentityAdmin)", async () => {
    await spec.assertNotConfiguredStillServesTheList();
  });

  it("not_configured refuses create with 503 and no db write", async () => {
    await spec.assertNotConfiguredRefusesTheWrite("create");
  });

  it("not_configured refuses PATCH displayName with 503 and no db write", async () => {
    await spec.assertNotConfiguredRefusesTheWrite("PATCH displayName");
  });

  it("not_configured refuses PATCH role with 503 and no db write", async () => {
    await spec.assertNotConfiguredRefusesTheWrite("PATCH role");
  });

  it("not_configured refuses deactivate with 503 and no db write", async () => {
    await spec.assertNotConfiguredRefusesTheWrite("deactivate");
  });

  it("not_configured refuses reactivate with 503 and no db write", async () => {
    await spec.assertNotConfiguredRefusesTheWrite("reactivate");
  });

  it("not_configured refuses temporary-password with 503 and no db write", async () => {
    await spec.assertNotConfiguredRefusesTheWrite("temporary-password");
  });

  it("a Keycloak enable failure after the create commit is a 200 with followUp", async () => {
    await spec.assertAKeycloakEnableFailureOnCreateIsAFollowUp();
  });
});

describe("F3.78 — a non-manager row is 403 on every route, whatever the token claims (ADR 0089 decision 2)", () => {
  it("a location_admin row claiming organization_admin is refused the list", async () => {
    await spec.assertANonManagerRowIsRefusedTheList();
  });

  it("a location_admin row claiming organization_admin is refused create", async () => {
    await spec.assertANonManagerRowIsRefusedCreate();
  });

  it("a location_admin row claiming organization_admin is refused PATCH displayName", async () => {
    await spec.assertANonManagerRowIsRefusedAWrite("PATCH displayName");
  });

  it("a location_admin row claiming organization_admin is refused PATCH role", async () => {
    await spec.assertANonManagerRowIsRefusedAWrite("PATCH role");
  });

  it("a location_admin row claiming organization_admin is refused deactivate", async () => {
    await spec.assertANonManagerRowIsRefusedAWrite("deactivate");
  });

  it("a location_admin row claiming organization_admin is refused reactivate", async () => {
    await spec.assertANonManagerRowIsRefusedAWrite("reactivate");
  });

  it("a location_admin row claiming organization_admin is refused temporary-password", async () => {
    await spec.assertANonManagerRowIsRefusedAWrite("temporary-password");
  });
});
