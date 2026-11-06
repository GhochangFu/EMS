import { describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { ORGANIZATION_LAYOUT_DB_GATE, useOrganizationLayoutHarness } from "../testing/organization-layout-harness";
import {
  assertAForeignOrScopedRowIsIgnored,
  assertAForeignTemplateIsNotFound,
  assertAnIgnoredRowIsNotALiveLayout,
  assertARemovedCopyIsRemadeInPlace,
  assertMakeCopiesAndPoints,
  assertMakeOverALiveLayoutIsRefused,
  assertNoRowReadsTheStockStrip,
  assertResetDropsTheRowAndKeepsTheCopy,
  assertSitesTileCountsTheOrganizationsLocations,
  assertTheArmMakesTheLayout,
  assertUnreadableIsNotFound,
  assertValuesAreOverTheReadersAssetsOnly,
  assertWhoMayChangeTheStrip,
} from "./organization-layout.service.integration.spec";

/** `F4.317` task 4.2 — Vitest entry point; the harness owns the fixture (ADR 0014). */
const connectionString = requireIntegrationDb(ORGANIZATION_LAYOUT_DB_GATE);

describe.skipIf(!connectionString)("F4.317 — OrganizationLayoutService", () => {
  const fx = useOrganizationLayoutHarness(
    {
      connectionString,
      openPool: (url) => openIntegrationPool(url, "F4.317 organization layout"),
      superuserUrl: (url) => resolveIntegrationRoleUrl(url, "superuser", process.env),
    },
    { tag: "ol" },
  );

  it("no row reads the stock strip: fourteen tiles in order, tile 3 with both keys, the prior only where asked", async () => {
    await assertNoRowReadsTheStockStrip(fx());
  });

  it("tile 2 is live / total locations over the organization", async () => {
    await assertSitesTileCountsTheOrganizationsLocations(fx());
  });

  it("each reader's values are over its own readable assets only", async () => {
    await assertValuesAreOverTheReadersAssetsOnly(fx());
  });

  it("an unreadable or missing organization is a 404", async () => {
    await assertUnreadableIsNotFound(fx());
  });

  it("Make copies the template onto one organization-wide dashboard and points the row at it", async () => {
    await assertMakeCopiesAndPoints(fx());
  });

  it("Make over a live layout is a 409 'Reset to default first' (ruling Q2)", async () => {
    await assertMakeOverALiveLayoutIsRefused(fx());
  });

  it("a row whose copy was removed is re-made in place", async () => {
    await assertARemovedCopyIsRemadeInPlace(fx());
  });

  it("Reset removes the row, keeps the copy, audits, and the read is stock again", async () => {
    await assertResetDropsTheRowAndKeepsTheCopy(fx());
  });

  it("a location admin changes its own organization's strip only; an asset-group admin never", async () => {
    await assertWhoMayChangeTheStrip(fx());
  });

  it("another organization's template id is a 404", async () => {
    await assertAForeignTemplateIsNotFound(fx());
  });

  it("a row pointed at a foreign or a site-scoped dashboard is ignored (the fail-safe)", async () => {
    await assertAForeignOrScopedRowIsIgnored(fx());
  });

  it("a row the read ignores is not a live layout: Reset clears it and Make makes over it", async () => {
    await assertAnIgnoredRowIsNotALiveLayout(fx());
  });

  it("the instantiate organization arm makes the same layout", async () => {
    await assertTheArmMakesTheLayout(fx());
  });
});
