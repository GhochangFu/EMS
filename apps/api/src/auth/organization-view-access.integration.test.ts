import { describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { ORGANIZATION_LAYOUT_DB_GATE, useOrganizationLayoutHarness } from "../testing/organization-layout-harness";
import {
  assertOnlyThePointedDashboardIsPointed,
  assertTheFourRolesOnOwnAndForeign,
  assertTheLocationGrantFollowsItsOrganization,
} from "./organization-view-access.integration.spec";

/** `F4.317` task 4.1 — Vitest entry point; the harness owns the fixture (ADR 0014). */
const connectionString = requireIntegrationDb(ORGANIZATION_LAYOUT_DB_GATE);

describe.skipIf(!connectionString)("F4.317 — OrganizationViewAccessService", () => {
  const fx = useOrganizationLayoutHarness(
    {
      connectionString,
      openPool: (url) => openIntegrationPool(url, "F4.317 view access"),
      superuserUrl: (url) => resolveIntegrationRoleUrl(url, "superuser", process.env),
    },
    { tag: "va" },
  );

  it("admin, organization_admin and location_admin manage their own organization's strip; asset_group_admin does not", async () => {
    await assertTheFourRolesOnOwnAndForeign(fx());
  });

  it("a location admin's grant follows its location's organization", async () => {
    await assertTheLocationGrantFollowsItsOrganization(fx());
  });

  it("only the row's dashboard, in the row's organization, is the pointed one", async () => {
    await assertOnlyThePointedDashboardIsPointed(fx());
  });
});
