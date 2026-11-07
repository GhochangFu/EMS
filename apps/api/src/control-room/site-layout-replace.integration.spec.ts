import { ConflictException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { SectionTemplateContent } from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import {
  COPY_TEMPLATE_NOT_PUBLISHED_MESSAGE,
  SITE_COPY_OTHER_TEMPLATE_MESSAGE,
  SITE_HAS_NO_COPY_MESSAGE,
  SITE_LAYOUT_AMBIGUOUS_MESSAGE,
} from "./site-layout.schema";
import {
  type SiteLayoutCtx,
  admin,
  caught,
  count,
  dashboardsAt,
  jwtFor,
  newAssets,
  newGroup,
  newLocationAdmin,
  newOrganization,
  newSite,
  newSiteTemplate,
  viewRows,
  zeroGroupSite,
} from "./site-layout.service.integration.spec";
import { rememberSubject } from "../testing/seeded-subjects";

/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4 decisions 2–7, 9, 10) — Replace and its preview against
 * real, non-owner roles: R1–R12. The pools, the run-unique `F373SL-<run>-…` fixtures and the
 * cleanup are `../testing/site-layout-harness.ts`; `site-layout-replace.integration.test.ts` runs
 * these cases; the assertions live here (ADR 0014, AGENTS.md §4.6).
 *
 * A case that needs a second version makes its own organization, so a v2 of the harness
 * template never becomes the newest version another case reads.
 */

/** v1 and v2 of one site template code in a fresh organization; `v2Content` defaults to v1's. */
async function twoVersions(
  ctx: SiteLayoutCtx,
  tag: string,
  v2Content: SectionTemplateContent = SMOC_STANDARD_SITE_TEMPLATE.content,
): Promise<{ org: string; v1: string; v2: string; code: string }> {
  const run = `${ctx.run}-${tag}`;
  const org = await newOrganization(ctx.fleetPool, run, ctx.created);
  const v1 = await newSiteTemplate(ctx.fleetPool, org, run, ctx.created);
  const code = `f373sl-${run}`.toLowerCase();
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.dashboard_templates
       (organization_id, code, version, name, section, status, content, target, published_at)
     VALUES ($1, $2, 2, 'SMOC standard v2 (F4.320 fixture)', 'site', 'published', $3::jsonb, 'site', now())
     RETURNING id`,
    [org, code, JSON.stringify(v2Content)],
  );
  const v2 = rows[0]?.id as string;
  ctx.created.templates.push(v2);
  return { org, v1, v2, code };
}

/** The SMOC content with the `ups` tab re-keyed `ups-new` (and every widget that names it). */
function withUpsRekeyed(): SectionTemplateContent {
  const content = structuredClone(SMOC_STANDARD_SITE_TEMPLATE.content) as SectionTemplateContent;
  const rekey = (value: unknown): unknown => (value === "ups" ? "ups-new" : value);
  for (const tab of content.tabs) {
    if (tab.key === "ups") (tab as { key: string }).key = "ups-new";
    for (const widget of tab.widgets) {
      const config = widget.config as Record<string, unknown>;
      if ("tabKey" in config) config.tabKey = rekey(config.tabKey);
      if ("targetTabKey" in config) config.targetTabKey = rekey(config.targetTabKey);
    }
  }
  return content;
}

async function tabGroups(ctx: SiteLayoutCtx, dashboardId: string): Promise<Record<string, string | null>> {
  const { rows } = await ctx.fleetPool.query<{ tab_key: string; asset_group_id: string | null }>(
    `SELECT tab_key, asset_group_id FROM bms.dashboard_tabs WHERE dashboard_id = $1`,
    [dashboardId],
  );
  return Object.fromEntries(rows.map((row) => [row.tab_key, row.asset_group_id]));
}

async function dashboardRow(ctx: SiteLayoutCtx, id: string): Promise<{ slug: string; template_id: string } | undefined> {
  const { rows } = await ctx.fleetPool.query<{ slug: string; template_id: string }>(
    `SELECT slug, template_id FROM bms.dashboards WHERE id = $1`,
    [id],
  );
  return rows[0];
}

/** A site with three electrical groups, made from `template` with `sld` → a and `ups` → b. */
async function threeGroupCopy(ctx: SiteLayoutCtx, suffix: string, org: string, template: string) {
  const site = await newSite(ctx, suffix, org);
  await newAssets(ctx, site, suffix, ["electrical"], org);
  const a = await newGroup(ctx, site, "electrical-a", "electrical", org);
  const b = await newGroup(ctx, site, "electrical-b", "electrical", org);
  const c = await newGroup(ctx, site, "electrical-c", "electrical", org);
  const made = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: template, tabGroups: { sld: a, ups: b } });
  return { site, a, b, c, made };
}

/**
 * R1 (decision 3) — per site: the copy is deleted and made again from v2. A new dashboard id, the
 * same slug, the same single view row re-pointed, the v2 stamp; the old dashboard is gone.
 * Mutation: insert a new view row instead of re-pointing → two rows or a 409 → red.
 */
export async function assertReplaceKeepsSlugAndViewRow(ctx: SiteLayoutCtx): Promise<void> {
  const { org, v1, v2 } = await twoVersions(ctx, "r1");
  const site = await zeroGroupSite(ctx, "r1", org);
  const first = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: v1 });

  const result = await ctx.svc.replaceForSite(admin(), { locationId: site });

  expect(result.dashboardId).not.toBe(first.dashboardId);
  expect(result.dashboardSlug).toBe(first.dashboardSlug);
  expect(result).toMatchObject({ templateId: v2, version: 2, previousDashboardId: first.dashboardId, previousTemplateId: v1, previousVersion: 1 });
  expect(await viewRows(ctx, site)).toEqual([{ kind: "dashboard", dashboard_id: result.dashboardId }]);
  expect(await dashboardRow(ctx, first.dashboardId), "the old copy is deleted").toBeUndefined();
  expect(await dashboardRow(ctx, result.dashboardId)).toEqual({ slug: first.dashboardSlug, template_id: v2 });
  expect(await dashboardsAt(ctx, site)).toBe(1);
  expect(
    await count(ctx, `SELECT count(*)::int AS n FROM bms.dashboard_tabs WHERE dashboard_id = $1`, [first.dashboardId]),
    "the old copy's tabs cascade with it",
  ).toBe(0);
}

/**
 * R2 (decision 4) — the old tab-group picks are carried by tab key: a site whose Make needed
 * `tabGroups` is replaced with no body and binds the same groups; a `tabGroups` body overrides.
 * Mutation: pass the request choice alone (drop the carry) → 409 ambiguous → red.
 */
export async function assertOldGroupPicksAreKeptByTabKey(ctx: SiteLayoutCtx): Promise<void> {
  const { org, v1 } = await twoVersions(ctx, "r2");
  const site = await newSite(ctx, "r2", org);
  await newAssets(ctx, site, "r2", ["electrical"], org);
  const a = await newGroup(ctx, site, "electrical-a", "electrical", org);
  const b = await newGroup(ctx, site, "electrical-b", "electrical", org);
  await ctx.svc.makeForSite(admin(), { locationId: site, templateId: v1, tabGroups: { sld: b, ups: a } });

  const kept = await ctx.svc.replaceForSite(admin(), { locationId: site });
  expect(await tabGroups(ctx, kept.dashboardId)).toMatchObject({ sld: b, ups: a });

  const swapped = await ctx.svc.replaceForSite(admin(), { locationId: site, tabGroups: { sld: a, ups: b } });
  expect(await tabGroups(ctx, swapped.dashboardId), "a tabGroups body overrides the carried picks").toMatchObject({ sld: a, ups: b });
}

/**
 * R3 (decision 4) — a tab key new in v2 with two untaken candidates is ambiguous: 409 with the
 * candidates, and the whole site rolls back (the old copy and its view row stay).
 * Mutation: delete the copy outside the site's transaction → the copy is gone after the 409 → red.
 */
export async function assertAmbiguousReplaceRollsBack(ctx: SiteLayoutCtx): Promise<void> {
  const { org, v1, v2 } = await twoVersions(ctx, "r3", withUpsRekeyed());
  const { site, b, c, made } = await threeGroupCopy(ctx, "r3", org, v1);

  const err = await caught(ctx.svc.replaceForSite(admin(), { locationId: site, templateId: v2 }));
  expect(err).toBeInstanceOf(ConflictException);
  const body = (err as ConflictException).getResponse() as { message: string; ambiguous: Array<{ tabKey: string; candidates: Array<{ id: string }> }> };
  expect(body.message).toBe(SITE_LAYOUT_AMBIGUOUS_MESSAGE);
  expect(body.ambiguous.find((tab) => tab.tabKey === "ups-new")?.candidates.map((x) => x.id).sort()).toEqual([b, c].sort());
  expect(await viewRows(ctx, site), "the refused Replace rolled back").toEqual([{ kind: "dashboard", dashboard_id: made.dashboardId }]);
  expect(await dashboardRow(ctx, made.dashboardId), "the old copy survives the refusal").toBeDefined();
}

/**
 * R4 (decision 5) — per site the same version is an explicit rebuild; another template code is
 * a 409 that changes nothing.
 * Mutation: pass `"bulk"` on the per-site path → the same-version Replace is refused → red.
 */
export async function assertSameVersionPerSiteAndOtherTemplateRefused(ctx: SiteLayoutCtx): Promise<void> {
  const { org, v1 } = await twoVersions(ctx, "r4");
  const other = await newSiteTemplate(ctx.fleetPool, org, `${ctx.run}-r4-other`, ctx.created);
  const site = await zeroGroupSite(ctx, "r4", org);
  const first = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: v1 });

  const again = await ctx.svc.replaceForSite(admin(), { locationId: site, templateId: v1 });
  expect(again.dashboardId).not.toBe(first.dashboardId);
  expect(again).toMatchObject({ version: 1, previousVersion: 1, previousTemplateId: v1 });

  const err = await caught(ctx.svc.replaceForSite(admin(), { locationId: site, templateId: other }));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(SITE_COPY_OTHER_TEMPLATE_MESSAGE);
  expect(await viewRows(ctx, site)).toEqual([{ kind: "dashboard", dashboard_id: again.dashboardId }]);
}

/**
 * R5 (decision 2) — only a template copy is replaceable: a dashboard with no template stamp, a
 * generated view and a site with no view answer 409 `SITE_HAS_NO_COPY_MESSAGE`; nothing is deleted.
 * Mutation: drop the template join from the held-copy read → the plain dashboard is deleted → red.
 */
export async function assertANonTemplateViewIsRefused(ctx: SiteLayoutCtx): Promise<void> {
  const plainSite = await zeroGroupSite(ctx, "r5a");
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.dashboards (organization_id, slug, name, location_id) VALUES ($1, $2, 'F4.320 plain', $3) RETURNING id`,
    [ctx.orgId, `f373sl-${ctx.run}-r5a-plain`.toLowerCase(), plainSite],
  );
  const plain = rows[0]?.id as string;
  await ctx.fleetPool.query(
    `INSERT INTO bms.site_control_room_views (location_id, organization_id, kind, dashboard_id) VALUES ($1, $2, 'dashboard', $3)`,
    [plainSite, ctx.orgId, plain],
  );
  const generatedSite = await zeroGroupSite(ctx, "r5b");
  await ctx.fleetPool.query(
    `INSERT INTO bms.site_control_room_views (location_id, organization_id, kind) VALUES ($1, $2, 'generated')`,
    [generatedSite, ctx.orgId],
  );
  const bareSite = await zeroGroupSite(ctx, "r5c");

  for (const site of [plainSite, generatedSite, bareSite]) {
    const err = await caught(ctx.svc.replaceForSite(admin(), { locationId: site, templateId: ctx.templateId }));
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toBe(SITE_HAS_NO_COPY_MESSAGE);
  }
  expect(await dashboardRow(ctx, plain), "the plain dashboard is never deleted").toBeDefined();
  expect(await viewRows(ctx, plainSite)).toEqual([{ kind: "dashboard", dashboard_id: plain }]);
  expect(await viewRows(ctx, bareSite)).toEqual([]);

  // RSMOC-WC's builtin row: the same 409, and the row is unchanged.
  const before = await viewRows(ctx, ctx.rsmocWcId);
  expect(before.map((row) => row.kind), "precondition: RSMOC-WC holds the builtin row").toEqual(["builtin"]);
  const builtin = await caught(ctx.svc.replaceForSite(admin(), { locationId: ctx.rsmocWcId }));
  expect((builtin as Error).message).toBe(SITE_HAS_NO_COPY_MESSAGE);
  expect(await viewRows(ctx, ctx.rsmocWcId)).toEqual(before);
}

/**
 * R6 (decision 6) — a drawn mimic: the copy's widgets go, so the rebuilt mimic is the version's
 * preset, and the `bms.mimic_layouts` row stays.
 */
export async function assertADrawnMimicLayoutRowIsKept(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "r6");
  const first = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId });
  const { rows: layout } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h) VALUES ($1, $2, $3, 120, 80) RETURNING id`,
    [ctx.orgId, `F4.320 r6 ${ctx.run}`, `f4320-r6-${ctx.run}`.toLowerCase()],
  );
  const layoutId = layout[0]?.id as string;
  try {
    const drawn = await ctx.fleetPool.query(
      `UPDATE bms.dashboard_widgets SET config = jsonb_build_object('source', 'layout', 'layoutId', $2::text)
        WHERE id = (SELECT id FROM bms.dashboard_widgets WHERE dashboard_id = $1 AND widget_type = 'mimic' ORDER BY id LIMIT 1)`,
      [first.dashboardId, layoutId],
    );
    expect(drawn.rowCount, "precondition: the copy holds a mimic to draw").toBe(1);

    const result = await ctx.svc.replaceForSite(admin(), { locationId: site });
    const mimics = (source: string) =>
      count(
        ctx,
        `SELECT count(*)::int AS n FROM bms.dashboard_widgets WHERE dashboard_id = $1 AND widget_type = 'mimic' AND config->>'source' = $2`,
        [result.dashboardId, source],
      );
    expect(await mimics("layout"), "the drawn arm does not survive the rebuild").toBe(0);
    expect(await mimics("preset"), "the rebuilt mimic is the version's preset").toBeGreaterThan(0);
    expect(await count(ctx, `SELECT count(*)::int AS n FROM bms.mimic_layouts WHERE id = $1`, [layoutId])).toBe(1);
  } finally {
    await ctx.fleetPool.query(`DELETE FROM bms.mimic_layouts WHERE id = $1`, [layoutId]);
  }
}

/**
 * R7 (decision 7) — the audit: one `master.location.site_layout.replace` on the location with the
 * make payload and the old ids, and a second `master.location.control_room_view.set`.
 */
export async function assertReplaceIsAuditedWithThePreviousIds(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "r7");
  const first = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId });
  const result = await ctx.svc.replaceForSite(admin(), { locationId: site });

  const { rows } = await ctx.fleetPool.query<{ action: string; payload: Record<string, unknown> }>(
    `SELECT action, payload FROM bms.audit_log WHERE entity_id = $1 ORDER BY created_at, action`,
    [site],
  );
  expect(rows.map((row) => row.action).sort()).toEqual([
    "master.location.control_room_view.set",
    "master.location.control_room_view.set",
    "master.location.site_layout.make",
    "master.location.site_layout.replace",
  ]);
  const replaced = rows.find((row) => row.action === "master.location.site_layout.replace")?.payload;
  expect(replaced).toMatchObject({
    dashboardId: result.dashboardId,
    templateId: ctx.templateId,
    previousDashboardId: first.dashboardId,
    previousTemplateId: ctx.templateId,
    previousVersion: 1,
  });
  expect(replaced?.tabs, "the make payload rides along").toEqual(result.resolution.map((tab) => tab.tabKey));
}

/**
 * R8 (decisions 5, 10) — the bulk: replaces a copy at another version, skips `same_version`,
 * `other_template`, `no_copy` and `ambiguous`; a location admin is refused before any site.
 */
export async function assertBulkReplacesOlderCopiesAndReportsSkips(ctx: SiteLayoutCtx): Promise<void> {
  const { org, v1, v2 } = await twoVersions(ctx, "r8", withUpsRekeyed());
  const other = await newSiteTemplate(ctx.fleetPool, org, `${ctx.run}-r8-other`, ctx.created);
  const older = await zeroGroupSite(ctx, "r8a", org);
  const olderCopy = await ctx.svc.makeForSite(admin(), { locationId: older, templateId: v1 });
  const same = await zeroGroupSite(ctx, "r8b", org);
  const sameCopy = await ctx.svc.makeForSite(admin(), { locationId: same, templateId: v2 });
  const none = await zeroGroupSite(ctx, "r8c", org);
  const otherSite = await zeroGroupSite(ctx, "r8d", org);
  const otherCopy = await ctx.svc.makeForSite(admin(), { locationId: otherSite, templateId: other });
  const ambiguous = await threeGroupCopy(ctx, "r8e", org, v1);
  const sites = [older, same, none, otherSite, ambiguous.site];

  // Fixture sites are inactive (the sibling spec's docblock); the bulk walks active ones.
  await ctx.fleetPool.query(`UPDATE bms.locations SET active = true WHERE id = ANY($1::uuid[])`, [sites]);
  let result;
  try {
    result = await ctx.svc.replaceForOrganization(admin(), v2);
  } finally {
    await ctx.fleetPool.query(`UPDATE bms.locations SET active = false WHERE id = ANY($1::uuid[])`, [sites]);
  }

  expect(result.replaced.map((row) => [row.locationId, row.previousDashboardId])).toEqual([[older, olderCopy.dashboardId]]);
  expect(result.skipped.map((row) => [row.locationId, row.reason])).toEqual([
    [same, "same_version"],
    [none, "no_copy"],
    [otherSite, "other_template"],
    [ambiguous.site, "ambiguous"],
  ]);
  expect(await viewRows(ctx, same)).toEqual([{ kind: "dashboard", dashboard_id: sameCopy.dashboardId }]);
  expect(await viewRows(ctx, otherSite)).toEqual([{ kind: "dashboard", dashboard_id: otherCopy.dashboardId }]);
  expect(await viewRows(ctx, ambiguous.site)).toEqual([{ kind: "dashboard", dashboard_id: ambiguous.made.dashboardId }]);
  expect(await viewRows(ctx, older)).toEqual([{ kind: "dashboard", dashboard_id: result.replaced[0]?.dashboardId }]);
}

/** R8b (decision 10) — a location admin may not run the bulk Replace or its preview (403). */
export async function assertBulkReplaceRefusesALocationAdmin(ctx: SiteLayoutCtx): Promise<void> {
  const site = await newSite(ctx, "r8r");
  const email = await newLocationAdmin(ctx, site, "r8r");
  const jwt = jwtFor(email, "location_admin");
  expect(await caught(ctx.svc.replaceForOrganization(jwt, ctx.templateId))).toBeInstanceOf(ForbiddenException);
  expect(await caught(ctx.svc.previewReplaceForOrganization(jwt, ctx.templateId))).toBeInstanceOf(ForbiddenException);
}

/** R8c (decision 10) — a location admin of another site gets 403 on the per-site Replace and preview. */
export async function assertPerSiteReplaceRefusesAnotherSitesAdmin(ctx: SiteLayoutCtx): Promise<void> {
  const own = await newSite(ctx, "r8s-own");
  const email = await newLocationAdmin(ctx, own, "r8s");
  const site = await zeroGroupSite(ctx, "r8s");
  const first = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId });
  const jwt = jwtFor(email, "location_admin");
  expect(await caught(ctx.svc.replaceForSite(jwt, { locationId: site }))).toBeInstanceOf(ForbiddenException);
  expect(await caught(ctx.svc.previewReplaceForSite(jwt, site))).toBeInstanceOf(ForbiddenException);
  expect(await viewRows(ctx, site)).toEqual([{ kind: "dashboard", dashboard_id: first.dashboardId }]);
}

/**
 * R9 (decision 9) — the preview counts the copy's dashboard-entity audit rows and gives the
 * newest time; the actor's email goes to an `admin` and never to a `location_admin`, who may
 * still preview (and run) the per-site Replace. A rebuilt copy starts at "no recorded edit".
 * Mutation: drop the `withActor` gate → the location admin sees the email → red.
 */
export async function assertPreviewCountsEditsAndRedactsTheActor(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "r9");
  const first = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId });

  const untouched = await ctx.svc.previewReplaceForSite(admin(), site);
  expect(untouched.sites).toEqual([
    {
      locationId: site,
      locationName: "F3.73 r9",
      held: { dashboardId: first.dashboardId, templateId: ctx.templateId, templateCode: expect.any(String), version: 1 },
      outcome: "replace",
      edits: { count: 0, lastEditedAt: null, lastEditedBy: null },
    },
  ]);

  await ctx.dashboards.update(admin(), first.dashboardId, { name: "F4.320 r9 edit 1" });
  await ctx.dashboards.update(admin(), first.dashboardId, { name: "F4.320 r9 edit 2" });
  const { rows } = await ctx.fleetPool.query<{ created_at: Date; email: string }>(
    `SELECT a.created_at, u.email FROM bms.audit_log a JOIN bms.users u ON u.id = a.actor_id
      WHERE a.entity_type = 'dashboard' AND a.entity_id = $1 ORDER BY a.created_at DESC, a.id DESC LIMIT 1`,
    [first.dashboardId],
  );
  const newest = rows[0];
  expect(newest?.email, "precondition: the builder writes are audited on the dashboard").toBe("admin@bms.local");

  const edited = await ctx.svc.previewReplaceForSite(admin(), site);
  expect(edited.sites[0]?.edits).toEqual({
    count: 2,
    lastEditedAt: newest?.created_at.toISOString(),
    lastEditedBy: "admin@bms.local",
  });

  const email = await newLocationAdmin(ctx, site, "r9");
  const asSiteAdmin = await ctx.svc.previewReplaceForSite(jwtFor(email, "location_admin"), site);
  const edits = asSiteAdmin.sites[0]?.edits;
  expect(edits).toEqual({ count: 2, lastEditedAt: newest?.created_at.toISOString() });
  expect(edits !== null && edits !== undefined && "lastEditedBy" in edits, "no actor for a location admin").toBe(false);

  const rebuilt = await ctx.svc.replaceForSite(jwtFor(email, "location_admin"), { locationId: site });
  const after = await ctx.svc.previewReplaceForSite(admin(), site);
  expect(after.sites[0]?.held?.dashboardId).toBe(rebuilt.dashboardId);
  expect(after.sites[0]?.edits, "the rebuilt copy has no recorded edit").toEqual({ count: 0, lastEditedAt: null, lastEditedBy: null });
}

/**
 * An `organization_admin` fixture user of `org`, granted that organization only
 * (`user_organization_access`), registered; the harness removes the grant and the user.
 */
async function newOrganizationAdmin(ctx: SiteLayoutCtx, org: string, suffix: string): Promise<string> {
  const email = `f373sl-${ctx.run}-${suffix}@bms.local`.toLowerCase();
  const { rows } = await ctx.superuserPool.query<{ id: string }>(
    `INSERT INTO bms.users (email, password_hash, display_name, role, organization_id)
     VALUES ($1, 'x', 'F4.320 organization admin', 'organization_admin', $2) RETURNING id`,
    [email, org],
  );
  const id = rows[0]?.id as string;
  ctx.created.users.push(id);
  rememberSubject(email, id);
  await ctx.superuserPool.query(`INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2)`, [id, org]);
  return email;
}

/** What org A holds that a refused call must leave as it was: its audit rows, the site's dashboards and view row. */
async function orgState(ctx: SiteLayoutCtx, org: string, site: string): Promise<unknown> {
  const { rows: audit } = await ctx.fleetPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bms.audit_log WHERE organization_id = $1`,
    [org],
  );
  const { rows: dashboards } = await ctx.fleetPool.query<{ id: string }>(
    `SELECT id FROM bms.dashboards WHERE location_id = $1 ORDER BY id`,
    [site],
  );
  return { audit: audit[0]?.n, dashboards: dashboards.map((row) => row.id), view: await viewRows(ctx, site) };
}

/**
 * R10 (security review, decision 10) — an `organization_admin` of organization B calls the four
 * routes' service methods on an organization-A site and template. Each answers 403 (the per-site
 * `canManageLocation` gate, the bulk `canManageTemplate` gate), and organization A's audit rows,
 * the site's dashboards and its view row are unchanged.
 * Mutation: drop `canManageLocation` from `authorizeSite` → the org B admin reaches the site → red.
 */
export async function assertAnotherOrganizationsAdminIsRefusedEverywhere(ctx: SiteLayoutCtx): Promise<void> {
  const { org, v1, v2 } = await twoVersions(ctx, "r10");
  const site = await zeroGroupSite(ctx, "r10", org);
  await ctx.svc.makeForSite(admin(), { locationId: site, templateId: v1 });
  const orgB = await newOrganization(ctx.fleetPool, `${ctx.run}-r10b`, ctx.created);
  const jwt = jwtFor(await newOrganizationAdmin(ctx, orgB, "r10b"), "organization_admin");

  const before = await orgState(ctx, org, site);
  const calls: ReadonlyArray<[string, () => Promise<unknown>]> = [
    ["replaceForSite", () => ctx.svc.replaceForSite(jwt, { locationId: site, templateId: v2 })],
    ["previewReplaceForSite", () => ctx.svc.previewReplaceForSite(jwt, site)],
    ["replaceForOrganization", () => ctx.svc.replaceForOrganization(jwt, v2)],
    ["previewReplaceForOrganization", () => ctx.svc.previewReplaceForOrganization(jwt, v2)],
  ];
  for (const [name, call] of calls) {
    const err = await caught(call());
    expect(err, name).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getStatus(), name).toBe(403);
  }
  expect(await orgState(ctx, org, site), "organization A is unchanged").toEqual(before);
}

/**
 * R11 (decision 9) — an `organization_admin` of the site's organization may read the audit log,
 * so the per-site preview of an edited copy gives it the newest actor's email (R9 holds the
 * `location_admin` twin, who gets no actor).
 * Mutation: key `readsAuditActors` on `admin` alone → `lastEditedBy` is absent → red.
 */
export async function assertAnOrganizationAdminGetsTheActor(ctx: SiteLayoutCtx): Promise<void> {
  const { org, v1 } = await twoVersions(ctx, "r11");
  const site = await zeroGroupSite(ctx, "r11", org);
  const copy = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: v1 });
  await ctx.dashboards.update(admin(), copy.dashboardId, { name: "F4.320 r11 edit" });
  const jwt = jwtFor(await newOrganizationAdmin(ctx, org, "r11"), "organization_admin");

  const preview = await ctx.svc.previewReplaceForSite(jwt, site);
  expect(preview.sites[0]?.held?.dashboardId).toBe(copy.dashboardId);
  expect(preview.sites[0]?.edits?.count).toBe(1);
  expect(preview.sites[0]?.edits?.lastEditedBy).toBe("admin@bms.local");
}

/**
 * R12 (decision 9, row-level security) — an audit row of ANOTHER organization with
 * `entity_type = 'dashboard'` and the held copy's id, newer than the copy's own edit, is not
 * counted: the read runs under the site organization's GUC. The count, the newest time and the
 * newest actor are the organization's own row's.
 * Mutation: read `bms.audit_log` on `fleetDb` (BYPASSRLS) → count 2 and the foreign time → red.
 */
export async function assertAnotherOrganizationsAuditRowIsNotCounted(ctx: SiteLayoutCtx): Promise<void> {
  const { org, v1 } = await twoVersions(ctx, "r12");
  const site = await zeroGroupSite(ctx, "r12", org);
  const copy = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: v1 });
  await ctx.dashboards.update(admin(), copy.dashboardId, { name: "F4.320 r12 edit" });
  const { rows: own } = await ctx.fleetPool.query<{ created_at: Date }>(
    `SELECT created_at FROM bms.audit_log WHERE entity_type = 'dashboard' AND entity_id = $1`,
    [copy.dashboardId],
  );
  expect(own, "precondition: one edit of organization A").toHaveLength(1);

  const orgB = await newOrganization(ctx.fleetPool, `${ctx.run}-r12b`, ctx.created);
  await ctx.fleetPool.query(
    `INSERT INTO bms.audit_log (organization_id, action, entity_type, entity_id, created_at)
     VALUES ($1, 'master.dashboard.update', 'dashboard', $2, now() + interval '1 minute')`,
    [orgB, copy.dashboardId],
  );
  expect(
    await count(ctx, `SELECT count(*)::int AS n FROM bms.audit_log WHERE entity_type = 'dashboard' AND entity_id = $1`, [
      copy.dashboardId,
    ]),
    "precondition: two rows carry the copy's id, one per organization",
  ).toBe(2);

  const preview = await ctx.svc.previewReplaceForSite(admin(), site);
  expect(preview.sites[0]?.edits).toEqual({
    count: 1,
    lastEditedAt: own[0]?.created_at.toISOString(),
    lastEditedBy: "admin@bms.local",
  });
}

/**
 * R12b (decision 5) — a per-site Replace and its preview with no `templateId`, whose copy's own
 * code has no published version left, answer 409 `COPY_TEMPLATE_NOT_PUBLISHED_MESSAGE` — not the
 * Make sentence, which would be false here: the organization still publishes another site
 * template. Nothing is written.
 * Mutation: throw `NO_SITE_TEMPLATE_MESSAGE` for the code arm too → red.
 */
export async function assertACopyWithNoPublishedVersionHasItsOwnSentence(ctx: SiteLayoutCtx): Promise<void> {
  const { org, v1, v2 } = await twoVersions(ctx, "r12b");
  await newSiteTemplate(ctx.fleetPool, org, `${ctx.run}-r12b-other`, ctx.created);
  const site = await zeroGroupSite(ctx, "r12b", org);
  const copy = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: v1 });
  await ctx.fleetPool.query(`UPDATE bms.dashboard_templates SET status = 'archived' WHERE id = ANY($1::uuid[])`, [[v1, v2]]);

  const calls = [() => ctx.svc.replaceForSite(admin(), { locationId: site }), () => ctx.svc.previewReplaceForSite(admin(), site)];
  for (const call of calls) {
    const err = await caught(call());
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toBe(COPY_TEMPLATE_NOT_PUBLISHED_MESSAGE);
  }
  expect(await viewRows(ctx, site)).toEqual([{ kind: "dashboard", dashboard_id: copy.dashboardId }]);
}

/** R9b (decisions 8, 9) — the bulk preview lists every active site with its outcome. */
export async function assertBulkPreviewListsEverySite(ctx: SiteLayoutCtx): Promise<void> {
  const { org, v1, v2 } = await twoVersions(ctx, "r9b");
  const older = await zeroGroupSite(ctx, "r9ba", org);
  const olderCopy = await ctx.svc.makeForSite(admin(), { locationId: older, templateId: v1 });
  const same = await zeroGroupSite(ctx, "r9bb", org);
  await ctx.svc.makeForSite(admin(), { locationId: same, templateId: v2 });
  const none = await zeroGroupSite(ctx, "r9bc", org);
  const sites = [older, same, none];

  await ctx.fleetPool.query(`UPDATE bms.locations SET active = true WHERE id = ANY($1::uuid[])`, [sites]);
  let preview;
  try {
    preview = await ctx.svc.previewReplaceForOrganization(admin(), v2);
  } finally {
    await ctx.fleetPool.query(`UPDATE bms.locations SET active = false WHERE id = ANY($1::uuid[])`, [sites]);
  }
  expect(preview).toMatchObject({ templateId: v2, version: 2 });
  expect(preview.sites.map((row) => [row.locationId, row.outcome, row.held?.version ?? null])).toEqual([
    [older, "replace", 1],
    [same, "same_version", 2],
    [none, "no_copy", null],
  ]);
  expect(preview.sites[0]?.held?.dashboardId).toBe(olderCopy.dashboardId);
  expect(preview.sites[2]?.edits).toBeNull();
  expect(await viewRows(ctx, older), "the preview writes nothing").toEqual([{ kind: "dashboard", dashboard_id: olderCopy.dashboardId }]);
}
