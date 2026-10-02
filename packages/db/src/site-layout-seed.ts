import type pg from "pg";

import {
  type GroupMember,
  omitUnboundTiles,
  planSiteLayout,
  planTemplateWidget,
  type SectionTemplateContent,
  sectionTemplateContentSchema,
  type SiteLayoutChoice,
  type SiteLayoutGroup,
  type SiteLayoutOmittedTile,
} from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import {
  eskomCanonicalLocationRows,
  eskomSeedLocationIdentity,
  findSeedLocation,
  type MapLocationSeedRow,
  type SeedLocationIdentity,
} from "./eskom-locations-seed";
import { type PheCatalogFile, stationSlug } from "./phe-pilot-seed";
import { activePointsByAsset, membersByRole } from "./site-layout-seed-reads";
import {
  SITE_LAYOUT_COPY_DESCRIPTION,
  upgradeSeededSiteLayoutCopies,
  upgradeSeedSiteTemplate,
} from "./site-layout-seed-upgrade";

/**
 * `F3.73` plan D12 (ADR 0087 decision 11, ruling Q4) — the SMOC standard site layout on the
 * seed-owned demo sites.
 *
 * **What this seeds, per organization (ESKOM, PHEWB).** (a) The SMOC standard template as a
 * published stock import at version 1, insert-if-absent, holding the current stock content; a
 * database an earlier seed already ran is moved to the current stock version by the upgrade
 * chain in `site-layout-seed-upgrade.ts` (its own seed-owned rows only) — since `F3.74` that is
 * stock v4, which reaches an untouched seeded copy per tab (ADR 0088 Amendment 2): the compact
 * electrical diagram on its Overview, `lv_single_line` and the breaker table on its electrical
 * tab. (b) For each seed-owned location with
 * no `bms.site_control_room_views` row and no dashboard holding its slug, one tabbed copy of the
 * organization's newest published `smoc-standard` version, planned by the SAME shared planner
 * the API's copy action runs (`planSiteLayout` and `planTemplateWidget`, `@bms/shared`), and the
 * view row `{ kind: 'dashboard', dashboard_id }` pointing at it.
 *
 * **Never overwrites, never replaces (ruling Q4).** Any view row skips the site, whatever it
 * holds: RSMOC-WC's `builtin` row (it is not in either list anyway), an admin's `generated` or
 * `dashboard` row, and a removed copy (`kind = 'dashboard'`, `dashboard_id` NULL after an admin
 * deleted the copy — `0082`'s `ON DELETE SET NULL`). Re-making a removed copy is the API's
 * action, not the boot's. So a seed run twice makes nothing the second time, and a renamed copy
 * keeps its name.
 *
 * **Seed ownership is per organization.** ESKOM: the rows `findSeedLocation` resolves for the
 * identities in {@link SITE_LAYOUT_ESKOM_LOCATION_KEYS} (the `meta.seedKey` rule, owner ruling
 * 16) — CSMOC Gauteng only; RSMOC-WC keeps its `builtin` view. PHEWB: the six catalog stations,
 * matched on the slug `stationSlug` gives AND the `meta.phe.stationCode` `seedPheCatalog` writes
 * ({@link PHE_SITE_LAYOUT_LOCATIONS_SQL}).
 *
 * **Explicit choices by group code** ({@link SITE_LAYOUT_ESKOM_CHOICE},
 * {@link SITE_LAYOUT_PHEWB_CHOICE}), mapped to the site's group ids before the planner runs, so
 * no seeded site is ambiguous whatever the tab-order rule says. A code the site does not hold
 * is left out, and the planner then decides that tab alone.
 *
 * **Reads first, then writes, in one tenant transaction.** The caller holds the organization's
 * `withOrganization` bracket, which is one transaction: a caught `23505` would abort it
 * (`25P02`), so every refusal is a pre-read, and the two inserts that could conflict are
 * `ON CONFLICT DO NOTHING`. Each copy is read back afterwards (a FORCE-RLS write can drop a row
 * without raising — `water-mimic-demo-seed.ts`).
 *
 * **Where it runs (`seed.ts`).** LAST: after both `seedAssetGroups` passes (the groups, their
 * `domain` and roles are what the planner binds), after `seedPointKeyCatalog` and every
 * `asset_points` writer (the tiles bind points), and after `seedWaterMimicDemo` (the second
 * water-domain group at CSMOC Gauteng).
 */

/** The copy's slug is this prefix and the location's slug. */
export const SITE_LAYOUT_SLUG_PREFIX = "site-layout-";

/** `bms.dashboards.slug` is `varchar(64)`. */
const DASHBOARD_SLUG_MAX = 64;

/**
 * The version the seed imports: the first. A later version is an administrator's, or the one
 * `upgradeSeedSiteTemplate` adds when it supersedes the seed's own row at an older stock version.
 */
export const SITE_LAYOUT_SEED_TEMPLATE_VERSION = 1;

/** The ESKOM seed identities (`meta.seedKey`) that receive a copy: CSMOC Gauteng. */
export const SITE_LAYOUT_ESKOM_LOCATION_KEYS: readonly string[] = ["csmoc-gauteng"];

/** ESKOM's explicit choices, tab key → group code (plan D12). */
export const SITE_LAYOUT_ESKOM_CHOICE: Readonly<Record<string, string>> = {
  sld: "electrical",
  ups: "ups-battery",
  water: "water",
};

/** PHEWB's explicit choice, tab key → group code (plan D12). */
export const SITE_LAYOUT_PHEWB_CHOICE: Readonly<Record<string, string>> = { sld: "electrical" };

/** The copy's slug at a location with slug `locationSlug`. */
export function siteLayoutSlug(locationSlug: string): string {
  return `${SITE_LAYOUT_SLUG_PREFIX}${locationSlug}`;
}

/** One PHE catalog station, as the ownership predicate matches it. */
export type PheSiteLayoutStation = { readonly slug: string; readonly stationCode: string };

/** The ESKOM identities of {@link SITE_LAYOUT_ESKOM_LOCATION_KEYS}; throws on a key the map lacks. */
export function eskomSiteLayoutIdentities(
  mapLocationRows: readonly MapLocationSeedRow[],
): SeedLocationIdentity[] {
  const identities = eskomCanonicalLocationRows(mapLocationRows).map(eskomSeedLocationIdentity);
  return SITE_LAYOUT_ESKOM_LOCATION_KEYS.map((key) => {
    const identity = identities.find((row) => row.key === key);
    if (!identity) {
      throw new Error(`eskomSiteLayoutIdentities: no canonical ESKOM location has the seed key ${key}`);
    }
    return identity;
  });
}

/** One entry per catalog station, in catalog order. */
export function pheSiteLayoutStations(catalog: PheCatalogFile): PheSiteLayoutStation[] {
  const byCode = new Map<string, PheSiteLayoutStation>();
  for (const row of catalog.rows) {
    if (!byCode.has(row.StationCode)) {
      byCode.set(row.StationCode, { slug: stationSlug(row.StationName), stationCode: row.StationCode });
    }
  }
  return [...byCode.values()];
}

/** The ids `findSeedLocation` resolves for `identities`; an unresolved identity adds none. */
export async function resolveEskomSiteLayoutLocations(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  identities: readonly SeedLocationIdentity[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const identity of identities) {
    const found = await findSeedLocation(pool, organizationId, identity);
    if (found.id !== null) ids.push(found.id);
  }
  return ids;
}

/**
 * The PHEWB locations the seed owns: the catalog's slug AND the catalog's station code in the
 * `meta.phe` block `seedPheCatalog` writes, as one pair. Neither alone: an admin location may
 * take a free slug, and the slug is the only column an admin write cannot give two rows.
 * (`meta.source = 'phe-catalog'` is on `bms.map_locations`, not `bms.locations`.)
 * Params: `[organizationId, slugs, stationCodes]`, the two arrays paired by index.
 */
export const PHE_SITE_LAYOUT_LOCATIONS_SQL = `
  SELECT l.id
    FROM bms.locations l
   WHERE l.organization_id = $1
     AND (l.slug, l.meta->'phe'->>'stationCode') IN (
       SELECT x.slug, x.station_code
         FROM unnest($2::varchar[], $3::varchar[]) AS x(slug, station_code)
     )
   ORDER BY l.slug
`;

export async function resolvePhewbSiteLayoutLocations(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  stations: readonly PheSiteLayoutStation[],
): Promise<string[]> {
  const res = await pool.query<{ id: string }>(PHE_SITE_LAYOUT_LOCATIONS_SQL, [
    organizationId,
    stations.map((station) => station.slug),
    stations.map((station) => station.stationCode),
  ]);
  return res.rows.map((row) => row.id);
}

/**
 * The template row: a published stock import, insert-if-absent on the `(organization_id, code,
 * version)` unique index of `0056` (`dashboard_templates_org_code_version_unique`).
 * Params: `[organizationId, code, version, name, section, target, description, content,
 * stockVersion]`.
 */
export const SITE_TEMPLATE_INSERT_SQL = `
  INSERT INTO bms.dashboard_templates
    (organization_id, code, version, name, section, target, description, status, content,
     published_at, stock_code, stock_version)
  VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', $8::jsonb, now(), $2, $9)
  ON CONFLICT (organization_id, code, version) DO NOTHING
`;

/** The organization's newest published `smoc-standard` version — what a copy is made from. */
const SITE_TEMPLATE_READ_SQL = `
  SELECT id, content
    FROM bms.dashboard_templates
   WHERE organization_id = $1 AND code = $2 AND status = 'published' AND target = 'site'
   ORDER BY version DESC
   LIMIT 1
`;

/** A published site template, parsed. */
export type SeededSiteTemplate = { readonly id: string; readonly content: SectionTemplateContent };

/**
 * Inserts v1 when absent and returns the newest published version, or `null` when there is none
 * (an administrator imported v1 as a draft before the seed ran, and has not published it).
 */
export async function ensureSiteTemplate(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
): Promise<SeededSiteTemplate | null> {
  const entry = SMOC_STANDARD_SITE_TEMPLATE;
  await pool.query(SITE_TEMPLATE_INSERT_SQL, [
    organizationId,
    entry.code,
    SITE_LAYOUT_SEED_TEMPLATE_VERSION,
    entry.name,
    entry.section,
    entry.target,
    entry.description,
    JSON.stringify(entry.content),
    entry.stockVersion,
  ]);
  await upgradeSeedSiteTemplate(pool, organizationId);
  const res = await pool.query<{ id: string; content: unknown }>(SITE_TEMPLATE_READ_SQL, [
    organizationId,
    entry.code,
  ]);
  const row = res.rows[0];
  if (!row) return null;
  const parsed = sectionTemplateContentSchema.safeParse(row.content);
  if (!parsed.success) {
    throw new Error(
      `ensureSiteTemplate: the published ${entry.code} template ${row.id} does not parse: ${parsed.error.message}`,
    );
  }
  return { id: row.id, content: parsed.data };
}

/** Why a location got no copy. */
export type SiteLayoutSeedSkipReason =
  | "no_location"
  | "has_view"
  | "slug_too_long"
  | "slug_taken"
  | "ambiguous"
  | "refused";

export type SiteLayoutSeedOutcome = {
  readonly made: readonly {
    readonly locationId: string;
    readonly dashboardId: string;
    readonly tabKeys: readonly string[];
    /** The role tiles left out because they bound no point at the site (`omitUnboundTiles`). */
    readonly omittedTiles: readonly SiteLayoutOmittedTile[];
  }[];
  readonly skipped: readonly { readonly locationId: string; readonly reason: SiteLayoutSeedSkipReason }[];
};

const LOCATION_SQL = `SELECT slug, name FROM bms.locations WHERE id = $1 AND organization_id = $2`;
const VIEW_ROW_SQL = `SELECT 1 FROM bms.site_control_room_views WHERE location_id = $1`;
const SLUG_TAKEN_SQL = `SELECT 1 FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`;
const GROUPS_SQL = `
  SELECT id, code, name, domain FROM bms.asset_groups
   WHERE organization_id = $1 AND location_id = $2
   ORDER BY code
`;
const DASHBOARD_INSERT_SQL = `
  INSERT INTO bms.dashboards (organization_id, slug, name, description, location_id, template_id)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (organization_id, slug) DO NOTHING
  RETURNING id
`;
const TAB_INSERT_SQL = `
  INSERT INTO bms.dashboard_tabs
    (organization_id, dashboard_id, location_id, asset_group_id, tab_key, label, sort_order)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING id
`;
const WIDGET_INSERT_SQL = `
  INSERT INTO bms.dashboard_widgets
    (organization_id, dashboard_id, tab_id, widget_type, title, grid_x, grid_y, grid_w, grid_h, config)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
  RETURNING id
`;
const POINT_INSERT_SQL = `
  INSERT INTO bms.dashboard_widget_points (organization_id, widget_id, point_id, role, sort_order)
  VALUES ($1, $2, $3, $4, $5)
`;
const SOURCE_INSERT_SQL = `
  INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key, params, sort_order)
  VALUES ($1, $2, $3, $4::jsonb, $5)
`;
/** `DO NOTHING`, never an update: the pre-read is advisory and this insert is the rule (Q4). */
const VIEW_INSERT_SQL = `
  INSERT INTO bms.site_control_room_views (location_id, organization_id, kind, dashboard_id)
  VALUES ($1, $2, 'dashboard', $3)
  ON CONFLICT (location_id) DO NOTHING
`;
const READ_BACK_SQL = `
  SELECT
    (SELECT count(*)::int FROM bms.dashboard_tabs WHERE dashboard_id = $1) AS tabs,
    (SELECT count(*)::int FROM bms.dashboard_widgets WHERE dashboard_id = $1) AS widgets,
    (SELECT count(*)::int FROM bms.site_control_room_views
      WHERE location_id = $2 AND dashboard_id = $1) AS views
`;

/**
 * Makes one copy per location of `locationIds` that has no view row and whose slug is free.
 * The caller holds the organization's tenant bracket and resolved the seed-owned locations.
 */
export async function seedSiteLayouts(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  options: {
    readonly template: SeededSiteTemplate;
    readonly locationIds: readonly string[];
    readonly choiceByGroupCode: Readonly<Record<string, string>>;
    readonly log?: (line: string) => void;
  },
): Promise<SiteLayoutSeedOutcome> {
  const log = options.log ?? ((line: string) => console.error(line));
  const made: SiteLayoutSeedOutcome["made"][number][] = [];
  const skipped: { locationId: string; reason: SiteLayoutSeedSkipReason }[] = [];
  const skip = (locationId: string, reason: SiteLayoutSeedSkipReason): void => {
    skipped.push({ locationId, reason });
    if (reason !== "has_view") log(`seedSiteLayouts: no copy at location ${locationId}: ${reason}`);
  };
  let pointsByAsset: Map<string, string> | null = null;

  for (const locationId of options.locationIds) {
    const location = (
      await pool.query<{ slug: string; name: string }>(LOCATION_SQL, [locationId, organizationId])
    ).rows[0];
    if (!location) {
      skip(locationId, "no_location");
      continue;
    }
    if ((await pool.query(VIEW_ROW_SQL, [locationId])).rows.length > 0) {
      skip(locationId, "has_view");
      continue;
    }
    const slug = siteLayoutSlug(location.slug);
    if (slug.length > DASHBOARD_SLUG_MAX) {
      skip(locationId, "slug_too_long");
      continue;
    }
    if ((await pool.query(SLUG_TAKEN_SQL, [organizationId, slug])).rows.length > 0) {
      skip(locationId, "slug_taken");
      continue;
    }

    const groups = (
      await pool.query<SiteLayoutGroup>(GROUPS_SQL, [organizationId, locationId])
    ).rows;
    const choice: Record<string, string> = {};
    for (const [tabKey, groupCode] of Object.entries(options.choiceByGroupCode)) {
      const group = groups.find((row) => row.code === groupCode);
      if (group) choice[tabKey] = group.id;
    }
    const plan = planSiteLayout(options.template.content.tabs, groups, choice as SiteLayoutChoice);
    if (plan.status !== "planned") {
      skip(locationId, plan.status);
      continue;
    }

    pointsByAsset ??= await activePointsByAsset(pool, organizationId);
    const points = pointsByAsset;
    const tabs = [];
    const omittedTiles: SiteLayoutOmittedTile[] = [];
    for (const row of plan.tabs) {
      const members =
        row.group === null
          ? new Map<string, GroupMember[]>()
          : await membersByRole(pool, organizationId, row.group.id);
      // The API copy's rule: a role tile with no point at this site is left out, the tab re-packed.
      const kept = omitUnboundTiles(
        row.tab.key,
        row.tab.widgets.map((widget) => planTemplateWidget(widget, members, points)),
      );
      omittedTiles.push(...kept.omittedTiles);
      tabs.push({ row, widgets: kept.plans });
    }

    const dashboard = await pool.query<{ id: string }>(DASHBOARD_INSERT_SQL, [
      organizationId,
      slug,
      `${location.name} site layout`,
      SITE_LAYOUT_COPY_DESCRIPTION,
      locationId,
      options.template.id,
    ]);
    const dashboardId = dashboard.rows[0]?.id;
    if (!dashboardId) {
      skip(locationId, "slug_taken");
      continue;
    }
    let widgetCount = 0;
    for (const { row, widgets } of tabs) {
      const tab = await pool.query<{ id: string }>(TAB_INSERT_SQL, [
        organizationId,
        dashboardId,
        // The Overview binds no group and stores no location (plan D1), so its row is inert
        // to the composite foreign keys; a group tab stores the dashboard's location.
        row.group === null ? null : locationId,
        row.group?.id ?? null,
        row.tab.key,
        row.tab.label,
        row.tab.sortOrder,
      ]);
      const tabId = tab.rows[0]?.id;
      if (!tabId) throw new Error(`seedSiteLayouts: tab ${row.tab.key} at ${locationId} returned no id`);
      for (const widgetPlan of widgets) {
        const { widget } = widgetPlan;
        const inserted = await pool.query<{ id: string }>(WIDGET_INSERT_SQL, [
          organizationId,
          dashboardId,
          tabId,
          widget.widgetType,
          widget.title,
          widget.gridX,
          widget.gridY,
          widget.gridW,
          widget.gridH,
          JSON.stringify(widget.config),
        ]);
        const widgetId = inserted.rows[0]?.id;
        if (!widgetId) throw new Error(`seedSiteLayouts: widget ${widget.key} at ${locationId} returned no id`);
        widgetCount += 1;
        for (const [index, point] of widgetPlan.points.entries()) {
          await pool.query(POINT_INSERT_SQL, [organizationId, widgetId, point.pointId, widgetPlan.pointRole, index]);
        }
        for (const [index, source] of widget.sources.entries()) {
          await pool.query(SOURCE_INSERT_SQL, [
            organizationId,
            widgetId,
            source.catalogKey,
            JSON.stringify(source.params),
            source.sortOrder ?? index,
          ]);
        }
      }
    }
    await pool.query(VIEW_INSERT_SQL, [locationId, organizationId, dashboardId]);

    const check = (
      await pool.query<{ tabs: number; widgets: number; views: number }>(READ_BACK_SQL, [dashboardId, locationId])
    ).rows[0];
    if (check?.tabs !== tabs.length || check.widgets !== widgetCount || check.views !== 1) {
      throw new Error(
        `seedSiteLayouts: the copy at ${locationId} reads back ${check?.tabs} of ${tabs.length} tabs, ` +
          `${check?.widgets} of ${widgetCount} widgets and ${check?.views} of 1 view rows. A FORCE-RLS write ` +
          "can drop rows without raising: check this runs inside the organization's tenant bracket.",
      );
    }
    made.push({ locationId, dashboardId, tabKeys: tabs.map(({ row }) => row.tab.key), omittedTiles });
  }
  return { made, skipped };
}

/** ESKOM: the template, then a copy at each resolved seed identity. */
export async function seedEskomSiteLayouts(
  pool: Pick<pg.Pool, "query">,
  eskomOrgId: string,
  mapLocationRows: readonly MapLocationSeedRow[],
  log?: (line: string) => void,
): Promise<SiteLayoutSeedOutcome> {
  const template = await ensureSiteTemplate(pool, eskomOrgId);
  if (template === null) {
    (log ?? console.error)("seedEskomSiteLayouts: no published smoc-standard template; no copy made");
    return { made: [], skipped: [] };
  }
  const locationIds = await resolveEskomSiteLayoutLocations(
    pool,
    eskomOrgId,
    eskomSiteLayoutIdentities(mapLocationRows),
  );
  await upgradeSeededSiteLayoutCopies(pool, eskomOrgId, locationIds, SITE_LAYOUT_SLUG_PREFIX);
  return seedSiteLayouts(pool, eskomOrgId, {
    template,
    locationIds,
    choiceByGroupCode: SITE_LAYOUT_ESKOM_CHOICE,
    ...(log ? { log } : {}),
  });
}

/** PHEWB: the template, then a copy at each catalog station. */
export async function seedPhewbSiteLayouts(
  pool: Pick<pg.Pool, "query">,
  phewbOrgId: string,
  pheCatalog: PheCatalogFile,
  log?: (line: string) => void,
): Promise<SiteLayoutSeedOutcome> {
  const template = await ensureSiteTemplate(pool, phewbOrgId);
  if (template === null) {
    (log ?? console.error)("seedPhewbSiteLayouts: no published smoc-standard template; no copy made");
    return { made: [], skipped: [] };
  }
  const locationIds = await resolvePhewbSiteLayoutLocations(pool, phewbOrgId, pheSiteLayoutStations(pheCatalog));
  await upgradeSeededSiteLayoutCopies(pool, phewbOrgId, locationIds, SITE_LAYOUT_SLUG_PREFIX);
  return seedSiteLayouts(pool, phewbOrgId, {
    template,
    locationIds,
    choiceByGroupCode: SITE_LAYOUT_PHEWB_CHOICE,
    ...(log ? { log } : {}),
  });
}
