import { expect } from "vitest";

import { selectPool } from "./identity-bootstrap";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

export function assertSendsAGlobalAdminToTheFleetPool(): void {
  expect(selectPool({ id: "u1", role: "admin", organizationIds: [] })).toEqual({
    kind: "fleet",
    userId: "u1",
    role: "admin",
  });
}

export function assertNeverSendsACustomerOrganizationAdminToTheFleetPool(): void {
  const result = selectPool({ id: "u2", role: "organization_admin", organizationIds: ["o1"] });
  expect(result.kind).toBe("tenant");
  expect(result).not.toHaveProperty("kind", "fleet");
}

export function assertRefusesAPrincipalWithNoDatabaseRecord(): void {
  expect(selectPool(null)).toEqual({
    kind: "refused",
    reason:
      "No bms.users row for this principal. A token claim is not authority for pool selection.",
  });
}

export function assertRefusesANonAdminWithNoOrganization(): void {
  expect(selectPool({ id: "u3", role: "viewer", organizationIds: [] }).kind).toBe("refused");
}

export function assertIgnoresTheJwtRoleAndUsesTheDatabaseRole(): void {
  // The database says viewer, so a token that outlived a demotion to admin
  // does not reach the fleet pool. `selectPool` only ever sees the database
  // role — the JWT claim never enters this function at all.
  expect(selectPool({ id: "u4", role: "viewer", organizationIds: ["o1"] }).kind).toBe("tenant");
}
