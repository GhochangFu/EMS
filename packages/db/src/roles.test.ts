import { describe, it } from "vitest";

import {
  assertNamesEveryMissingVariableAtOnce,
  assertOneEntryPerRoleWhenAllFourAreSet,
  assertOnlyTheFleetRoleBypassesRowLevelSecurity,
  assertProvisioningCreatesEveryNonBootstrapRole,
  assertProvisioningDemandsTheSuperuserUrl,
  assertProvisioningTouchesNoSchemaObject,
  assertRefusesAnEmptyPassword,
  assertTheOwnerIsProvisionedFirst,
  assertTheRollupRoleCanRunBackgroundJobsButNotLogInRemotely,
  assertTheRollupRoleIsTheOnlyOneGranted,
} from "./roles.spec";

describe("F4.16 — role password wiring", () => {
  it("returns one entry per role when all four are set", () => {
    assertOneEntryPerRoleWhenAllFourAreSet();
  });

  it("names every missing variable at once rather than failing on the first", () => {
    assertNamesEveryMissingVariableAtOnce();
  });

  it("refuses an empty password rather than setting one", () => {
    assertRefusesAnEmptyPassword();
  });
});

describe("E7.1a / ADR 0045 — db:roles is the provisioning identity", () => {
  it("gives bms_owner a login before anything connects as it", () => {
    assertTheOwnerIsProvisionedFirst();
  });

  it("demands DATABASE_URL_SUPERUSER and never falls back to DATABASE_URL", () => {
    assertProvisioningDemandsTheSuperuserUrl();
  });

  it("creates every non-bootstrap role, and never bms_app", () => {
    assertProvisioningCreatesEveryNonBootstrapRole();
  });

  it("gives BYPASSRLS to bms_fleet alone", () => {
    assertOnlyTheFleetRoleBypassesRowLevelSecurity();
  });

  it("grants bms_rollup membership, and never bms_owner, to the pool roles", () => {
    assertTheRollupRoleIsTheOnlyOneGranted();
  });

  it("gives bms_rollup LOGIN for the background workers, and no password", () => {
    assertTheRollupRoleCanRunBackgroundJobsButNotLogInRemotely();
  });

  it("touches no schema object, since it now runs before the first migration", () => {
    assertProvisioningTouchesNoSchemaObject();
  });
});
