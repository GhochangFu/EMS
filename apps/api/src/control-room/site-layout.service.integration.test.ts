import { describe, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { SITE_LAYOUT_DB_GATE, useSiteLayoutHarness } from "../testing/site-layout-harness";
import {
  assertAmbiguousSiteAnswersCandidates,
  assertBuiltinSiteIsRefused,
  assertForeignGroupChoiceIsRefused,
  assertForeignTemplateIsNotFound,
  assertInsertNeverOverwritesALiveRow,
  assertLocationAdminOfAnotherSiteIsForbidden,
  assertLocationAdminOfTheSiteMayMake,
  assertNewestPublishedTemplateIsTheDefault,
  assertOperatorIsForbidden,
  assertRaceNeverOverwritesALiveCopy,
  assertRemovedCopyIsRemadeInPlace,
  assertSecondCallIsRefused,
  assertZeroGroupSiteGetsGroupsAndACopy,
} from "./site-layout.service.integration.spec";

/**
 * `F3.73` plan Task 4.2 — Vitest entry point for the S1–S6 cases of `SiteLayoutService` under real
 * RLS, on the `site-control-room-view.integration.test.ts` harness. Assertions live in the sibling
 * `.spec` (ADR 0014); the pools, the stale sweep and the cleanup live in
 * `../testing/site-layout-harness.ts`, shared with
 * `site-layout.service.more.integration.test.ts` (S7–S14).
 */
const connectionString = requireIntegrationDb(SITE_LAYOUT_DB_GATE);

describe.skipIf(!connectionString)("F3.73 — SiteLayoutService under real RLS", () => {
  const harness = useSiteLayoutHarness(
    {
      connectionString,
      openPool: (url) => openIntegrationPool(url, "F3.73"),
      superuserUrl: (url) => resolveIntegrationRoleUrl(url, "superuser", process.env),
    },
    { tag: "a", eskomTemplate: true },
  );

  it("S1 a site with no group gets one group per domain, a three-tab copy and its view row", async () => {
    await assertZeroGroupSiteGetsGroupsAndACopy(harness.ctx());
  });

  it("S2 a second call on a live copy answers 409 SITE_HAS_VIEW_MESSAGE and writes nothing", async () => {
    await assertSecondCallIsRefused(harness.ctx());
  });

  it("S2b a removed copy is re-made and the same view row re-pointed", async () => {
    await assertRemovedCopyIsRemadeInPlace(harness.ctx());
  });

  it("S2c a row that went live after the pre-check is never overwritten; the copy rolls back", async () => {
    await assertRaceNeverOverwritesALiveCopy(harness.ctx());
  });

  it("S2d a row that went live before the insert is never overwritten; the copy rolls back", async () => {
    await assertInsertNeverOverwritesALiveRow(harness.ctx());
  });

  it("S3b another organization's template answers 404 on this site", async () => {
    await assertForeignTemplateIsNotFound(harness.ctx(), harness.eskomTemplateId());
  });

  it("S8b no templateId copies the organization's newest published site template", async () => {
    await assertNewestPublishedTemplateIsTheDefault(harness.ctx());
  });

  it("S3 RSMOC-WC's builtin row is never replaced", async () => {
    await assertBuiltinSiteIsRefused(harness.ctx(), harness.eskomTemplateId());
  });

  it("S4 an ambiguous site answers 409 with the candidates and writes nothing", async () => {
    await assertAmbiguousSiteAnswersCandidates(harness.ctx());
  });

  it("S5 tabGroups naming another organization's group answers 400 without the id", async () => {
    await assertForeignGroupChoiceIsRefused(harness.ctx());
  });

  it("S6a the location admin of the site may make its layout", async () => {
    await assertLocationAdminOfTheSiteMayMake(harness.ctx());
  });

  it("S6b a location admin of another site is refused with 403", async () => {
    await assertLocationAdminOfAnotherSiteIsForbidden(harness.ctx());
  });

  it("S6c an operator is refused with 403", async () => {
    await assertOperatorIsForbidden(harness.ctx());
  });
});
