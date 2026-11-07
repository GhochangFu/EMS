import { describe, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { SITE_LAYOUT_DB_GATE, useSiteLayoutHarness } from "../testing/site-layout-harness";
import {
  assertADrawnMimicLayoutRowIsKept,
  assertAmbiguousReplaceRollsBack,
  assertANonTemplateViewIsRefused,
  assertAnOrganizationAdminGetsTheActor,
  assertAnotherOrganizationsAdminIsRefusedEverywhere,
  assertAnotherOrganizationsAuditRowIsNotCounted,
  assertBulkPreviewListsEverySite,
  assertBulkReplaceRefusesALocationAdmin,
  assertBulkReplacesOlderCopiesAndReportsSkips,
  assertOldGroupPicksAreKeptByTabKey,
  assertPerSiteReplaceRefusesAnotherSitesAdmin,
  assertPreviewCountsEditsAndRedactsTheActor,
  assertReplaceIsAuditedWithThePreviousIds,
  assertReplaceKeepsSlugAndViewRow,
  assertSameVersionPerSiteAndOtherTemplateRefused,
} from "./site-layout-replace.integration.spec";

/**
 * `F4.320` PR 2 — Vitest entry point for the R1–R9 cases of Replace and its preview under real
 * RLS. Assertions live in the sibling `.spec` (ADR 0014); the pools, the stale sweep and the
 * cleanup are `../testing/site-layout-harness.ts`, with its own run tag.
 */
const connectionString = requireIntegrationDb(SITE_LAYOUT_DB_GATE);

describe.skipIf(!connectionString)("F4.320 — SiteLayoutService Replace under real RLS", () => {
  const harness = useSiteLayoutHarness(
    {
      connectionString,
      openPool: (url) => openIntegrationPool(url, "F3.73"),
      superuserUrl: (url) => resolveIntegrationRoleUrl(url, "superuser", process.env),
    },
    { tag: "r" },
  );

  it("R1 a per-site Replace keeps the slug and the view row and changes the dashboard id", async () => {
    await assertReplaceKeepsSlugAndViewRow(harness.ctx());
  });

  it("R2 the old tab-group picks are kept by tab key; tabGroups overrides them", async () => {
    await assertOldGroupPicksAreKeptByTabKey(harness.ctx());
  });

  it("R3 an ambiguous new tab answers 409 with the candidates and rolls the site back", async () => {
    await assertAmbiguousReplaceRollsBack(harness.ctx());
  });

  it("R4 per site the same version is a rebuild; another template code answers 409", async () => {
    await assertSameVersionPerSiteAndOtherTemplateRefused(harness.ctx());
  });

  it("R5 a plain dashboard, a generated, builtin or missing view answers 409 SITE_HAS_NO_COPY_MESSAGE", async () => {
    await assertANonTemplateViewIsRefused(harness.ctx());
  });

  it("R6 a drawn mimic comes back as the preset and its mimic_layouts row stays", async () => {
    await assertADrawnMimicLayoutRowIsKept(harness.ctx());
  });

  it("R7 the replace audit row carries the previous ids", async () => {
    await assertReplaceIsAuditedWithThePreviousIds(harness.ctx());
  });

  it("R8 the bulk replaces an older copy and skips same_version, no_copy, other_template, ambiguous", async () => {
    await assertBulkReplacesOlderCopiesAndReportsSkips(harness.ctx());
  });

  it("R8b a location admin may not run the bulk Replace or its preview", async () => {
    await assertBulkReplaceRefusesALocationAdmin(harness.ctx());
  });

  it("R8c a location admin of another site gets 403 per site", async () => {
    await assertPerSiteReplaceRefusesAnotherSitesAdmin(harness.ctx());
  });

  it("R9 the preview counts edits and gives the actor to an admin only", async () => {
    await assertPreviewCountsEditsAndRedactsTheActor(harness.ctx());
  });

  it("R9b the bulk preview lists every active site with its outcome", async () => {
    await assertBulkPreviewListsEverySite(harness.ctx());
  });

  it("R10 an organization admin of another organization gets 403 on all four and changes nothing", async () => {
    await assertAnotherOrganizationsAdminIsRefusedEverywhere(harness.ctx());
  });

  it("R11 an organization admin of the site's organization gets the newest actor's email", async () => {
    await assertAnOrganizationAdminGetsTheActor(harness.ctx());
  });

  it("R12 another organization's audit row on the copy's id is not counted", async () => {
    await assertAnotherOrganizationsAuditRowIsNotCounted(harness.ctx());
  });
});
