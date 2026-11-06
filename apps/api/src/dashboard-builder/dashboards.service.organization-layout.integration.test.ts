import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { ORGANIZATION_LAYOUT_DB_GATE, useOrganizationLayoutHarness } from "../testing/organization-layout-harness";
import {
  assertAnotherOrganizationWideDashboardIsRefused,
  assertDeletingThePointedDashboardIsRefused,
  assertOtherRolesAreRefused,
  assertReHomingThePointedDashboardIsRefused,
  assertRenamingThePointedDashboard,
  assertTheGrantAdmitsOrganizationContentOnly,
  assertTheGrantEndsWithThePointer,
  assertWidgetsOnThePointedDashboard,
  type GrantCtx,
  stagePointedDashboard,
  unstage,
} from "./dashboards.service.organization-layout.integration.spec";

/** `F4.317` task 4.3 — Vitest entry point; the harness owns the fixture (ADR 0014). */
const connectionString = requireIntegrationDb(ORGANIZATION_LAYOUT_DB_GATE);

describe.skipIf(!connectionString)("F4.317 — the location admin's grant on the pointed organization dashboard", () => {
  const fx = useOrganizationLayoutHarness(
    {
      connectionString,
      openPool: (url) => openIntegrationPool(url, "F4.317 dashboard grant"),
      superuserUrl: (url) => resolveIntegrationRoleUrl(url, "superuser", process.env),
    },
    { tag: "dg" },
  );
  let ctx: GrantCtx | undefined;
  const c = (): GrantCtx => {
    if (!ctx) throw new Error("F4.317: the pointed dashboard was not staged");
    return ctx;
  };

  beforeAll(async () => {
    ctx = await stagePointedDashboard(fx());
  });
  afterAll(async () => {
    if (ctx) await unstage(ctx);
  });

  it("edits the widgets of the pointed dashboard", async () => {
    await assertWidgetsOnThePointedDashboard(c());
  });

  it("admits value tiles with no tabs only (the organization target's content)", async () => {
    await assertTheGrantAdmitsOrganizationContentOnly(c());
  });

  it("still refuses every other organization-wide dashboard (F3.1d kept)", async () => {
    await assertAnotherOrganizationWideDashboardIsRefused(c());
  });

  it("refuses re-homing the pointed dashboard under its own site (the F3.1d twin)", async () => {
    await assertReHomingThePointedDashboardIsRefused(c());
  });

  it("renames the pointed dashboard", async () => {
    await assertRenamingThePointedDashboard(c());
  });

  it("refuses deleting the pointed dashboard", async () => {
    await assertDeletingThePointedDashboardIsRefused(c());
  });

  it("refuses an asset-group admin and another organization's location admin", async () => {
    await assertOtherRolesAreRefused(c());
  });

  it("ends when the row no longer points at the dashboard", async () => {
    await assertTheGrantEndsWithThePointer(c());
  });
});
