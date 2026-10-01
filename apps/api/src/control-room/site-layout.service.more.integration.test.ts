import { describe, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { SITE_LAYOUT_DB_GATE, useSiteLayoutHarness } from "../testing/site-layout-harness";
import {
  assertBulkMakesAndReportsSkips,
  assertBulkRefusesALocationAdmin,
  assertConcurrentCopyAnswers409,
  assertGetBySlugCarriesTheStamp,
  assertInstantiateSiteArmMakesTheCopy,
  assertKeptCardsArePackedLeft,
  assertMimicNodesResolveThroughTheTabGroup,
  assertNoPublishedSiteTemplateAnswers409,
  assertOmittedTilesAreAudited,
  assertTakenSlugAnswers409,
  assertUnboundRoleTilesAreOmitted,
} from "./site-layout.service.more.integration.spec";

/**
 * `F3.73` plan Task 4.2 — Vitest entry point for the S7–S14 cases of `SiteLayoutService` under real
 * RLS. Assertions live in the sibling `.spec` (ADR 0014); the pools, the stale sweep and the
 * cleanup live in `../testing/site-layout-harness.ts`, shared with
 * `site-layout.service.integration.test.ts` (S1–S6). Its own run tag, so its fixture codes never
 * meet that file's when the two run in parallel workers.
 */
const connectionString = requireIntegrationDb(SITE_LAYOUT_DB_GATE);

describe.skipIf(!connectionString)("F3.73 — SiteLayoutService under real RLS", () => {
  const harness = useSiteLayoutHarness(
    {
      connectionString,
      openPool: (url) => openIntegrationPool(url, "F3.73"),
      superuserUrl: (url) => resolveIntegrationRoleUrl(url, "superuser", process.env),
    },
    { tag: "m" },
  );

  it("S7 the bulk makes what it can and reports every skip; a made site survives the later ones", async () => {
    await assertBulkMakesAndReportsSkips(harness.ctx());
  });

  it("S7b the bulk refuses a location admin with 403", async () => {
    await assertBulkRefusesALocationAdmin(harness.ctx());
  });

  it("S8 an organization with no published site template answers 409 NO_SITE_TEMPLATE_MESSAGE", async () => {
    await assertNoPublishedSiteTemplateAnswers409(harness.ctx());
  });

  it("S9 the copy's mimic nodes resolve through the tab's group", async () => {
    await assertMimicNodesResolveThroughTheTabGroup(harness.ctx());
  });

  it("S10 getBySlug returns the copy's templateId and tabs", async () => {
    await assertGetBySlugCarriesTheStamp(harness.ctx());
  });

  it("S11 a taken site-layout slug answers 409 SITE_LAYOUT_SLUG_TAKEN_MESSAGE, not 500", async () => {
    await assertTakenSlugAnswers409(harness.ctx());
  });

  it("S13 instantiate with { locationId } makes the copy through the module's arm and audits once", async () => {
    await assertInstantiateSiteArmMakesTheCopy(harness.ctx());
  });

  it("S14 a copy concurrent with another on the same site answers 409, not a raw 23505", async () => {
    await assertConcurrentCopyAnswers409(harness.ctx());
  });

  it("S15a the Overview cards of the kept tabs are packed left", async () => {
    await assertKeptCardsArePackedLeft(harness.ctx());
  });

  it("S15b a role tile with no point at the site is omitted and the tab's body moves up", async () => {
    await assertUnboundRoleTilesAreOmitted(harness.ctx());
  });

  it("S15c the make audit names every omitted tile", async () => {
    await assertOmittedTilesAreAudited(harness.ctx());
  });
});
