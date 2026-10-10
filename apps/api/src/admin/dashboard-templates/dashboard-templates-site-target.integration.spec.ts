import { BadRequestException, ForbiddenException, NotImplementedException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import {
  SITE_TEMPLATE_TOP_LEVEL_MESSAGE,
  SITE_TEMPLATE_PATCH_TABS_MESSAGE,
  TEMPLATE_TARGET_BODY_MESSAGE,
  updateDashboardTemplateBodySchema,
} from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type {
  DashboardTemplatesInstantiateService,
  SiteTemplateArm,
} from "./dashboard-templates-instantiate.service";
import { SITE_ARM_NOT_WIRED_MESSAGE } from "./dashboard-templates-instantiate.service";
import type { DashboardTemplatesService } from "./dashboard-templates.service";

/**
 * `F3.73` plan Task 2.2 — the template target on the write path, against real rows.
 *
 * Publish reads the stored row and `bms.asset_domains`; instantiation reads the stored row's
 * `target`. Neither is visible to a request schema, so these are the claims only a database
 * can hold. One exported function per claim; `dashboard-templates-site-target.integration.test.ts`
 * is the Vitest entry point and owns the fixtures (ADR 0014).
 */

/** The rejection a promise ends in, or `null` if it resolved. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (err: unknown) => err,
  );
}

/**
 * A site template whose every widget sits in a tab publishes. The count is
 * `templateWidgets(content)`, not `content.widgets`, which is empty by rule on a site template.
 */
export async function assertSiteTemplateWithTabWidgetsOnlyPublishes(
  templates: DashboardTemplatesService,
  actor: JwtPayload,
  siteDraftId: string,
): Promise<void> {
  const published = await templates.publish(actor, siteDraftId);
  expect(published.status, "a site template with widgets in tabs only must publish").toBe("published");
  expect(published.target).toBe("site");
  expect(published.content.widgets).toEqual([]);
  expect(published.content.tabs.length).toBeGreaterThan(0);
}

/** A tab domain that is not a live `bms.asset_domains` code is refused at publish, naming it. */
export async function assertUnknownTabDomainIsRefusedAtPublish(
  templates: DashboardTemplatesService,
  actor: JwtPayload,
  badDomainDraftId: string,
  ownerPool: pg.Pool,
): Promise<void> {
  const err = await rejectionOf(templates.publish(actor, badDomainDraftId));
  expect(err, "a tab naming domain 'nope' must be refused").toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toMatch(/domain "nope"/i);
  const row = await ownerPool.query<{ status: string }>(
    `SELECT status FROM bms.dashboard_templates WHERE id = $1`,
    [badDomainDraftId],
  );
  expect(row.rows[0]?.status, "a refused publish must leave the draft a draft").toBe("draft");
}

/** A group body on a site template answers 400 `TEMPLATE_TARGET_BODY_MESSAGE`. */
export async function assertGroupBodyOnSiteTemplateIsRefused(
  service: DashboardTemplatesInstantiateService,
  actor: JwtPayload,
  sitePublishedId: string,
  assetGroupId: string,
  slug: string,
  ownerPool: pg.Pool,
): Promise<void> {
  const err = await rejectionOf(
    service.instantiate(actor, sitePublishedId, { assetGroupId, slug, name: "F3.73 mismatch" }),
  );
  expect(err, "a group body on a site template must be refused").toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe(TEMPLATE_TARGET_BODY_MESSAGE);
  const landed = await ownerPool.query(`SELECT id FROM bms.dashboards WHERE slug = $1`, [slug]);
  expect(landed.rowCount, "a refused instantiate must leave no dashboard behind").toBe(0);
}

/** A site body on an asset-group template answers the same 400. */
export async function assertSiteBodyOnGroupTemplateIsRefused(
  service: DashboardTemplatesInstantiateService,
  actor: JwtPayload,
  groupPublishedId: string,
  locationId: string,
): Promise<void> {
  const err = await rejectionOf(service.instantiateSite(actor, groupPublishedId, { locationId }));
  expect(err, "a site body on an asset-group template must be refused").toBeInstanceOf(
    BadRequestException,
  );
  expect((err as Error).message).toBe(TEMPLATE_TARGET_BODY_MESSAGE);
}

/** With no site arm provided (PR2), a matching site body answers 501 `SITE_ARM_NOT_WIRED_MESSAGE`. */
export async function assertSiteArmAnswers501UntilWired(
  service: DashboardTemplatesInstantiateService,
  actor: JwtPayload,
  sitePublishedId: string,
  locationId: string,
): Promise<void> {
  const err = await rejectionOf(service.instantiateSite(actor, sitePublishedId, { locationId }));
  expect(err, "the unwired site arm must answer 501").toBeInstanceOf(NotImplementedException);
  expect((err as Error).message).toBe(SITE_ARM_NOT_WIRED_MESSAGE);
}

/**
 * The seam: with an arm provided, the site body reaches it with the template's id and
 * organization and the body unchanged, and its answer is returned.
 */
export async function assertSiteArmReceivesTheTemplateAndBody(
  makeService: (arm: SiteTemplateArm) => DashboardTemplatesInstantiateService,
  actor: JwtPayload,
  sitePublishedId: string,
  organizationId: string,
  locationId: string,
  assetGroupId: string,
): Promise<void> {
  const calls: Parameters<SiteTemplateArm>[] = [];
  const answer = { copied: true };
  const service = makeService(async (...args) => {
    calls.push(args);
    return answer;
  });
  const body = { locationId, tabGroups: { sld: assetGroupId } };

  const result = await service.instantiateSite(actor, sitePublishedId, body);

  expect(result, "the arm's answer must be returned unchanged").toBe(answer);
  expect(calls.length, "the arm must be called exactly once").toBe(1);
  expect(calls[0]?.[1]).toEqual({ id: sitePublishedId, organizationId });
  expect(calls[0]?.[2]).toEqual(body);
}

/**
 * The site arm asks authorship (plan D6), not only readability: a location admin reads the
 * template, so `assertCanRead` passes, and `assertCanAuthor` is the guard that refuses. The
 * message names that guard, because `assertCanRead` answers 403 too; the arm is never reached.
 */
export async function assertLocationAdminCannotReachTheSiteArm(
  makeService: (arm: SiteTemplateArm) => DashboardTemplatesInstantiateService,
  locationAdmin: JwtPayload,
  sitePublishedId: string,
  locationId: string,
): Promise<void> {
  let called = 0;
  const service = makeService(async () => {
    called += 1;
    return {};
  });
  const err = await rejectionOf(service.instantiateSite(locationAdmin, sitePublishedId, { locationId }));
  expect(err, "a location admin must be refused the site arm").toBeInstanceOf(ForbiddenException);
  expect((err as Error).message).toMatch(/Location admins cannot author/);
  expect(called, "a refused caller must never reach the site arm").toBe(0);
}

/**
 * Publish walks tab widgets for the params gate. A tab tile whose catalog source smuggles a
 * `locationId` into `params` is refused as the dashboard write path refuses it.
 */
export async function assertTabSourceParamsAreCheckedAtPublish(
  templates: DashboardTemplatesService,
  actor: JwtPayload,
  badParamsDraftId: string,
): Promise<void> {
  const err = await rejectionOf(templates.publish(actor, badParamsDraftId));
  expect(err, "a tab source with a smuggled param must be refused").toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toMatch(/invalid params/);
}

/** Publish walks tab widgets for the active point-key gate too. */
export async function assertTabSourcePointKeysAreCheckedAtPublish(
  templates: DashboardTemplatesService,
  actor: JwtPayload,
  badPointKeyDraftId: string,
): Promise<void> {
  const err = await rejectionOf(templates.publish(actor, badPointKeyDraftId));
  expect(err, "a tab source naming an unknown point key must be refused").toBeInstanceOf(
    BadRequestException,
  );
  expect((err as Error).message).toMatch(/Not in the active point-key catalog/);
}

/** A stored site row holding top-level widgets is refused at publish, from the stored target. */
export async function assertPublishReChecksTheStoredTarget(
  templates: DashboardTemplatesService,
  actor: JwtPayload,
  siteWithTopLevelDraftId: string,
): Promise<void> {
  const err = await rejectionOf(templates.publish(actor, siteWithTopLevelDraftId));
  expect(err, "a site row with top-level widgets must not publish").toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe(SITE_TEMPLATE_TOP_LEVEL_MESSAGE);
}

/** A PATCH carries no target, so the stored row's decides: top-level widgets on a site draft. */
export async function assertPatchIsCheckedAgainstTheStoredTarget(
  templates: DashboardTemplatesService,
  actor: JwtPayload,
  siteDraftId: string,
  widget: unknown,
): Promise<void> {
  const body = updateDashboardTemplateBodySchema.parse({ content: { widgets: [widget] } });
  const err = await rejectionOf(templates.update(actor, siteDraftId, body));
  expect(err, "a PATCH putting top-level widgets on a site draft must be refused").toBeInstanceOf(
    BadRequestException,
  );
  expect((err as Error).message).toBe(SITE_TEMPLATE_TOP_LEVEL_MESSAGE);
}

/** The stored tab keys of one template row, in order — read as the superuser, past RLS. */
async function storedTabKeys(ownerPool: pg.Pool, id: string): Promise<string[]> {
  const row = await ownerPool.query<{ content: { tabs?: { key: string }[] } }>(
    `SELECT content FROM bms.dashboard_templates WHERE id = $1`,
    [id],
  );
  return (row.rows[0]?.content.tabs ?? []).map((tab) => tab.key);
}

/**
 * A PATCH whose content omits `tabs` on a site draft is refused, and the stored tabs survive.
 *
 * The shared content schema defaults `tabs` to `[]`, so before the refusal the web builder's
 * `{ widgets }` Save wrote `{ widgets: [], tabs: [] }` over a site draft at 200. The re-read is
 * the claim; the 400 alone would pass a refusal that ran after the write.
 */
export async function assertSitePatchWithoutTabsIsRefusedAndKeepsTheTabs(
  templates: DashboardTemplatesService,
  actor: JwtPayload,
  siteDraftId: string,
  ownerPool: pg.Pool,
): Promise<void> {
  const before = await storedTabKeys(ownerPool, siteDraftId);
  expect(before.length, "the fixture must hold tabs, or the survival claim proves nothing").toBeGreaterThan(0);

  const body = updateDashboardTemplateBodySchema.parse({ content: { widgets: [] } });
  const err = await rejectionOf(templates.update(actor, siteDraftId, body));
  expect(err, "a site PATCH omitting content.tabs must be refused").toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe(SITE_TEMPLATE_PATCH_TABS_MESSAGE);
  expect(await storedTabKeys(ownerPool, siteDraftId), "the stored tabs must survive").toEqual(before);
}

/** The positive control: the same PATCH carrying `tabs` is taken, and writes what it sent. */
export async function assertSitePatchCarryingTabsIsTaken(
  templates: DashboardTemplatesService,
  actor: JwtPayload,
  siteDraftId: string,
  tabs: unknown,
  ownerPool: pg.Pool,
): Promise<void> {
  const body = updateDashboardTemplateBodySchema.parse({ content: { widgets: [], tabs } });
  const updated = await templates.update(actor, siteDraftId, body);
  const sent = (tabs as { key: string }[]).map((tab) => tab.key);
  expect(updated.content.tabs.map((tab) => tab.key)).toEqual(sent);
  expect(await storedTabKeys(ownerPool, siteDraftId)).toEqual(sent);
}

/** The refusal is scoped to the site target: an asset-group PATCH of `{ widgets }` still passes. */
export async function assertGroupPatchWithoutTabsIsTaken(
  templates: DashboardTemplatesService,
  actor: JwtPayload,
  groupDraftId: string,
  widget: unknown,
): Promise<void> {
  const body = updateDashboardTemplateBodySchema.parse({ content: { widgets: [widget] } });
  const updated = await templates.update(actor, groupDraftId, body);
  expect(updated.content.widgets).toHaveLength(1);
  expect(updated.content.tabs).toEqual([]);
}

/** A draft opened from a published site template stays a site template. */
export async function assertDraftFromSiteTemplateKeepsTheTarget(
  templates: DashboardTemplatesService,
  actor: JwtPayload,
  sitePublishedId: string,
): Promise<string> {
  const draft = await templates.createDraftFrom(actor, sitePublishedId);
  expect(draft.target, "createDraftFrom must carry the target forward").toBe("site");
  return draft.id;
}
