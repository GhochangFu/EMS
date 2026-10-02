import { afterAll, describe, it } from "vitest";

import { requireKeycloak } from "../testing/keycloak-gate";
import * as spec from "./identity-admin.client.integration.spec";

/**
 * `F3.78` U3 — Vitest entry point for the live Keycloak cases K1–K6.
 * Assertions live in the sibling `.spec` (ADR 0014).
 *
 * Owner ruling Q-A: CI runs this on every code PR (U4 adds the Keycloak step),
 * so an unset `KEYCLOAK_ADMIN_URL` in CI throws here, at import time.
 */
const config = requireKeycloak({
  item: "F3.78",
  label: "Keycloak integration spec",
  because:
    "the unit specs stub fetch, so only this suite proves the service account's roles, the " +
    "user profile and the provisioned realm settings against Keycloak 24 (ADR 0089 decision 5).",
});

const TIMEOUT = 30_000;

describe.skipIf(!config)("F3.78 U3 — KeycloakIdentityAdminClient against Keycloak (K1–K6)", () => {
  // `skipIf` keeps this body from running without a config; the `!` is safe.
  const live = config!;

  afterAll(async () => {
    await spec.cleanUpCreatedUsers(live);
  }, TIMEOUT);

  it("K1 — role-mappings/realm/available is 200 under the service account", async () => {
    await spec.assertK1AvailableRealmRolesAreReadable(live);
  }, TIMEOUT);

  it("K2 — a created user is disabled", async () => {
    await spec.assertK2ACreatedUserIsDisabled(live);
  }, TIMEOUT);

  it("K2 — the create/password/role/enable flow leaves exactly one BMS realm role", async () => {
    await spec.assertK2TheFlowLeavesOneBmsRealmRole(live);
  }, TIMEOUT);

  it("K2 — the flow leaves default-roles-bms mapped", async () => {
    await spec.assertK2TheFlowLeavesTheDefaultRolesMapped(live);
  }, TIMEOUT);

  it("K2 — the flow enables the user", async () => {
    await spec.assertK2TheFlowEnablesTheUser(live);
  }, TIMEOUT);

  it("K2 — the flow leaves UPDATE_PASSWORD required", async () => {
    await spec.assertK2TheFlowSetsATemporaryPassword(live);
  }, TIMEOUT);

  it("K3 — a duplicate email is conflict", async () => {
    await spec.assertK3ADuplicateEmailIsConflict(live);
  }, TIMEOUT);

  it("K4 — deleteUser removes the user", async () => {
    await spec.assertK4DeleteUserRemovesTheUser(live);
  }, TIMEOUT);

  it('K5 — the user profile\'s email.permissions.edit is ["admin"]', async () => {
    await spec.assertK5OnlyAnAdminEditsTheEmail(live);
  }, TIMEOUT);

  it("K6 — passwordPolicy contains length(12)", async () => {
    await spec.assertK6ThePasswordPolicyIsProvisioned(live);
  }, TIMEOUT);

  it("K6 — bruteForceProtected is true", async () => {
    await spec.assertK6BruteForceProtectionIsOn(live);
  }, TIMEOUT);
});
