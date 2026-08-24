import { describe, it } from "vitest";

import {
  assertIgnoresTheJwtRoleAndUsesTheDatabaseRole,
  assertNeverSendsACustomerOrganizationAdminToTheFleetPool,
  assertRefusesANonAdminWithNoOrganization,
  assertRefusesAPrincipalWithNoDatabaseRecord,
  assertSendsAGlobalAdminToTheFleetPool,
} from "./identity-bootstrap.spec";

describe("F4.16 — pool selection", () => {
  it("sends a global admin to the fleet pool", () => {
    assertSendsAGlobalAdminToTheFleetPool();
  });

  it("never sends a customer organization_admin to the fleet pool", () => {
    assertNeverSendsACustomerOrganizationAdminToTheFleetPool();
  });

  it("refuses a principal with no database record rather than defaulting", () => {
    assertRefusesAPrincipalWithNoDatabaseRecord();
  });

  it("refuses a non-admin with no organization rather than serving an empty tenant", () => {
    assertRefusesANonAdminWithNoOrganization();
  });

  it("ignores the JWT role and uses the database role", () => {
    assertIgnoresTheJwtRoleAndUsesTheDatabaseRole();
  });
});
