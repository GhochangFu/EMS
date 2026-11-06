import type pg from "pg";

import { planTemplateWidget, sectionTemplateContentSchema, type SectionTemplateContent } from "@bms/shared";
import { ORGANIZATION_STANDARD_TEMPLATE } from "@bms/shared/site-templates";

/**
 * `F4.317` PR 6 (ADR 0112, owner ruling Q3) — a custom organization Control Room layout on the two
 * seed-owned demo organizations, ESKOM and PHEWB, on the `site-layout-seed.ts` shape.
 *
 * **What this seeds, per organization.** (a) The `organization-standard` template as a published
 * stock import, insert-if-absent (when none is published, at the next free version), and only when
 * a copy is about to be made (an organization with a pointer row or the seed slug is left untouched). (b) When the organization has no
 * `bms.organization_control_room_views` row and no dashboard holding {@link ORGANIZATION_LAYOUT_SEED_SLUG},
 * one organization-wide copy of the organization's newest published `organization-standard`
 * version, planned by the SAME shared planner the API's "Make organization layout" runs
 * (`planTemplateWidget`, no bindings on an organization template), and the pointer row naming it.
 *
 * **Never overwrites, never replaces.** Any pointer row skips the organization, whatever it
 * holds (an administrator's copy, or a removed one: `dashboard_id` NULL after the copy was
 * deleted). Re-making a removed copy is the API's action, not the boot's. A seed run twice makes
 * nothing the second time, and a renamed copy keeps its name.
 *
 * **Reads first, then writes, in one tenant transaction** (the caller's `withOrganization`
 * bracket): a caught `23505` would abort it, so every refusal is a pre-read and the inserts that
 * could conflict are `ON CONFLICT DO NOTHING`. The copy is read back afterwards (a FORCE-RLS write
 * can drop a row without raising).
 *
 * **Where it runs (`seed.ts`).** After each organization's site layouts, in the same bracket.
 */

/** The seeded copy's slug (the API's copies are `organization-layout-<id8>`, so never this). */
export const ORGANIZATION_LAYOUT_SEED_SLUG = "organization-layout-seed";

/**
 * Insert-if-absent: only when the organization holds no published version of the code, and then at
 * `MAX(version) + 1` (the stock import's own next-version rule, so a lingering draft or archived
 * v1 from an earlier stock import never blocks it; a fresh database gets 1). `ON CONFLICT` on the
 * `(organization_id, code, version)` unique index of `0056` keeps a racing writer harmless.
 * Params: `[organizationId, code, name, section, target, description, content, stockVersion]`.
 */
export const ORGANIZATION_TEMPLATE_INSERT_SQL = `
  INSERT INTO bms.dashboard_templates
    (organization_id, code, version, name, section, target, description, status, content,
     published_at, stock_code, stock_version)
  SELECT $1::uuid, $2::text,
         COALESCE((SELECT MAX(version) FROM bms.dashboard_templates WHERE organization_id = $1::uuid AND code = $2::text), 0) + 1,
         $3, $4, $5, $6, 'published', $7::jsonb, now(), $2::text, $8::int
   WHERE NOT EXISTS (
     SELECT 1 FROM bms.dashboard_templates
      WHERE organization_id = $1::uuid AND code = $2::text AND status = 'published' AND target = 'organization')
  ON CONFLICT (organization_id, code, version) DO NOTHING
`;

const TEMPLATE_READ_SQL = `
  SELECT id, name, content, stock_version
    FROM bms.dashboard_templates
   WHERE organization_id = $1 AND code = $2 AND status = 'published' AND target = 'organization'
   ORDER BY version DESC
   LIMIT 1
`;
const VIEW_ROW_SQL = `SELECT 1 FROM bms.organization_control_room_views WHERE organization_id = $1`;
const SLUG_TAKEN_SQL = `SELECT 1 FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`;
const DASHBOARD_INSERT_SQL = `
  INSERT INTO bms.dashboards (organization_id, slug, name, description, template_id, stock_version)
  VALUES ($1, $2, $3, NULL, $4, $5)
  ON CONFLICT (organization_id, slug) DO NOTHING
  RETURNING id
`;
const WIDGET_INSERT_SQL = `
  INSERT INTO bms.dashboard_widgets
    (organization_id, dashboard_id, tab_id, widget_type, title, grid_x, grid_y, grid_w, grid_h, config)
  VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9::jsonb)
  RETURNING id
`;
const SOURCE_INSERT_SQL = `
  INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key, params, sort_order)
  VALUES ($1, $2, $3, $4::jsonb, $5)
`;
/** `DO NOTHING`, never an update: the pre-read is advisory and this insert is the rule. */
const VIEW_INSERT_SQL = `
  INSERT INTO bms.organization_control_room_views (organization_id, dashboard_id)
  VALUES ($1, $2)
  ON CONFLICT (organization_id) DO NOTHING
`;
const READ_BACK_SQL = `
  SELECT
    (SELECT count(*)::int FROM bms.dashboard_widgets WHERE dashboard_id = $1) AS widgets,
    (SELECT count(*)::int FROM bms.dashboard_widget_sources WHERE widget_id IN
       (SELECT id FROM bms.dashboard_widgets WHERE dashboard_id = $1)) AS sources,
    (SELECT count(*)::int FROM bms.organization_control_room_views
      WHERE organization_id = $2 AND dashboard_id = $1) AS views
`;

/** A published organization template, parsed, with its stock stamp. */
export type SeededOrganizationTemplate = {
  readonly id: string;
  readonly name: string;
  readonly content: SectionTemplateContent;
  readonly stockVersion: number | null;
};

/** Inserts a published stock version when none is published and returns the newest published version, or `null` when there is none. */
export async function ensureOrganizationTemplate(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
): Promise<SeededOrganizationTemplate | null> {
  const entry = ORGANIZATION_STANDARD_TEMPLATE;
  await pool.query(ORGANIZATION_TEMPLATE_INSERT_SQL, [
    organizationId,
    entry.code,
    entry.name,
    entry.section,
    entry.target,
    entry.description,
    JSON.stringify(entry.content),
    entry.stockVersion,
  ]);
  const res = await pool.query<{ id: string; name: string; content: unknown; stock_version: number | null }>(
    TEMPLATE_READ_SQL,
    [organizationId, entry.code],
  );
  const row = res.rows[0];
  if (!row) return null;
  const parsed = sectionTemplateContentSchema.safeParse(row.content);
  if (!parsed.success) {
    throw new Error(
      `ensureOrganizationTemplate: the published ${entry.code} template ${row.id} does not parse: ${parsed.error.message}`,
    );
  }
  return { id: row.id, name: row.name, content: parsed.data, stockVersion: row.stock_version ?? null };
}

/** Why an organization got no copy. */
export type OrganizationLayoutSeedSkipReason = "no_template" | "has_view" | "slug_taken";

export type OrganizationLayoutSeedOutcome =
  | { readonly made: true; readonly dashboardId: string; readonly widgets: number; readonly sources: number }
  | { readonly made: false; readonly reason: OrganizationLayoutSeedSkipReason };

/**
 * One organization-wide copy and its pointer row when the organization has neither. The checks
 * run first; the template is provisioned only when a copy will be made. The caller holds the
 * organization's tenant bracket.
 */
export async function seedOrganizationLayout(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  log: (line: string) => void = (line) => console.error(line),
): Promise<OrganizationLayoutSeedOutcome> {
  // Pre-reads first: the template is provisioned only when a copy will be made, so an
  // administrator's archive of the stock template is never undone by a boot.
  if ((await pool.query(VIEW_ROW_SQL, [organizationId])).rows.length > 0) {
    return { made: false, reason: "has_view" };
  }
  if ((await pool.query(SLUG_TAKEN_SQL, [organizationId, ORGANIZATION_LAYOUT_SEED_SLUG])).rows.length > 0) {
    log(`seedOrganizationLayout: no copy at ${organizationId}: slug_taken`);
    return { made: false, reason: "slug_taken" };
  }
  const template = await ensureOrganizationTemplate(pool, organizationId);
  if (template === null) {
    log(`seedOrganizationLayout: no published organization-standard template at ${organizationId}; no copy made`);
    return { made: false, reason: "no_template" };
  }

  const dashboard = await pool.query<{ id: string }>(DASHBOARD_INSERT_SQL, [
    organizationId,
    ORGANIZATION_LAYOUT_SEED_SLUG,
    template.name.slice(0, 255),
    template.id,
    template.stockVersion,
  ]);
  const dashboardId = dashboard.rows[0]?.id;
  if (!dashboardId) return { made: false, reason: "slug_taken" };

  let widgetCount = 0;
  let sourceCount = 0;
  for (const templateWidget of template.content.widgets) {
    const { widget } = planTemplateWidget(templateWidget, new Map(), new Map());
    const inserted = await pool.query<{ id: string }>(WIDGET_INSERT_SQL, [
      organizationId,
      dashboardId,
      widget.widgetType,
      widget.title,
      widget.gridX,
      widget.gridY,
      widget.gridW,
      widget.gridH,
      JSON.stringify(widget.config),
    ]);
    const widgetId = inserted.rows[0]?.id;
    if (!widgetId) throw new Error(`seedOrganizationLayout: widget ${widget.key} returned no id`);
    widgetCount += 1;
    for (const [index, source] of widget.sources.entries()) {
      await pool.query(SOURCE_INSERT_SQL, [
        organizationId,
        widgetId,
        source.catalogKey,
        JSON.stringify(source.params),
        source.sortOrder ?? index,
      ]);
      sourceCount += 1;
    }
  }
  await pool.query(VIEW_INSERT_SQL, [organizationId, dashboardId]);

  const check = (
    await pool.query<{ widgets: number; sources: number; views: number }>(READ_BACK_SQL, [dashboardId, organizationId])
  ).rows[0];
  if (check?.widgets !== widgetCount || check.sources !== sourceCount || check.views !== 1) {
    throw new Error(
      `seedOrganizationLayout: the copy at ${organizationId} reads back ${check?.widgets} of ${widgetCount} widgets, ` +
        `${check?.sources} of ${sourceCount} sources and ${check?.views} of 1 view rows. A FORCE-RLS write can ` +
        "drop rows without raising: check this runs inside the organization's tenant bracket.",
    );
  }
  return { made: true, dashboardId, widgets: widgetCount, sources: sourceCount };
}
