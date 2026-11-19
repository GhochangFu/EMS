import type pg from "pg";

import {
  mimicConfigSchema,
  mimicLayoutConfigSchema,
  mimicPresetConfigSchema,
  sectionTemplateContentSchema,
  trendStripWidgetConfigSchema,
} from "@bms/shared";
import { PUMP_STATION_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import type { PheCatalogFile } from "./phe-pilot-seed";
import {
  pheSiteLayoutSites,
  pheSiteLayoutStations,
  planSiteCopy,
  resolvePhewbSiteLayoutLocations,
  type SeededSiteTemplate,
  siteLayoutSlug,
} from "./site-layout-seed";
import { activePointsByAsset, SITE_LAYOUT_CANDIDATE_SQL } from "./site-layout-seed-reads";
import { COPY_STAMP_SQL } from "./site-layout-seed-upgrade";
import { canonicalJson } from "./site-layout-stock-history";

/**
 * `F4.388` (ADR 0139 Amendment 1; plan D3) — the pure half of the step that gives a split site's
 * dashboard copy its station's `mimic` and `trend_strip` settings, one time per copy.
 *
 * The PHE split makes each site's copy from `pump-station-standard`, which holds no `glyphSet` on
 * its mimics and no selection on its trend strips; the station's own dashboard (the row the
 * unlink leaves, ADR 0139 decision 7) holds both. This module decides, per site widget, whether
 * the station's config is copied over it, and why not when it is not. The writer
 * (`copyStationWidgetSettings`, plan Task 3) reads the rows, writes each update with
 * `WHERE config = from`, and logs each kept widget (owner ruling Q4).
 */

/** One stored widget of a site copy or of its station's dashboard, as the planner reads it. */
export type StationSettingsWidget = {
  readonly id: string;
  /** The key of the widget's tab (`dashboard_tabs.tab_key`). */
  readonly tabKey: string;
  readonly widgetType: string;
  readonly gridX: number;
  readonly gridY: number;
  readonly gridW: number;
  readonly gridH: number;
  /** The widget's `config` jsonb, as read. Copied whole; never rebuilt from a parse. */
  readonly config: unknown;
};

/**
 * The config the seed wrote for each site widget when it made the copy, keyed by the **site
 * widget's id**. The writer builds it by pairing `planSiteCopy` (run with the copy's own template
 * row) with the stored widgets on tab key + widget type + rect. A site widget with no entry is
 * never copied over (`no_as_made`).
 */
export type StationSettingsAsMade = ReadonlyMap<string, unknown>;

/** Why a site widget keeps its config. */
export type StationSettingsKeptReason =
  /** The as-made map holds no config for the widget, so "as the seed made it" cannot be shown. */
  | "no_as_made"
  /** No station widget on the same tab key, widget type and rect. */
  | "no_station_match"
  /** Two or more station widgets on the same tab key, widget type and rect. */
  | "several_station_matches"
  /** The site config is not the as-made config: an administrator changed it. */
  | "edited"
  /**
   * The station config does not parse with the widget type's shared schema, or holds a key the
   * widget write API's `.strict()` arm refuses.
   */
  | "station_config_invalid"
  /** The station config's `tabKey` names a tab the site copy does not hold. */
  | "station_tab_absent"
  /** A mimic pair that is not two `source: "preset"` configs on the same preset. */
  | "mimic_not_same_preset";

export type StationSettingsUpdate = {
  readonly widgetId: string;
  /** The site config as read: the writer's `WHERE config = from` guard. */
  readonly from: unknown;
  /** The whole station config. */
  readonly to: unknown;
};

export type StationSettingsPlan = {
  readonly updates: readonly StationSettingsUpdate[];
  readonly kept: readonly { readonly widgetId: string; readonly reason: StationSettingsKeptReason }[];
  /** Site widgets whose config already equals the station's: no write. */
  readonly unchanged: readonly string[];
};

/** The widget types whose config the step copies (plan D3). Every other type is not considered. */
export const STATION_SETTINGS_WIDGET_TYPES: readonly string[] = ["mimic", "trend_strip"];

/**
 * The stamp a copy carries once the step has run on it (plan D3, "Why the stamp").
 *
 * **Stamp 3 means one of two things, and is not a layout version.** A copy made from stock v3 of
 * `pump-station-standard` (a cold start) carries 3 because the seed stamps a copy with its
 * template's stock version; a copy this step repaired carries 3 whatever template version it was
 * made from (on the demo host, a DB-v4 copy). A future `pump-station-standard` upgrade chain must
 * not read 3 as "holds the v3 layout".
 */
export const STATION_SETTINGS_STOCK_VERSION = 3;

function sameConfig(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * The widget write API's config arms: each shared schema `.strict()`, as `dashboard-writes.ts`
 * composes them (`bindsNothingArm`, `mimicConfigWriteSchema`). `@bms/shared` exports the arms, not
 * the composed write schema.
 */
const MIMIC_PRESET_WRITE = mimicPresetConfigSchema.strict();
const MIMIC_LAYOUT_WRITE = mimicLayoutConfigSchema.strict();
const TREND_STRIP_WRITE = trendStripWidgetConfigSchema.strict();

/**
 * The station config parsed as the write API would accept it, as its `tabKey` (absent: none), or
 * null when it does not parse: a config the API would refuse is never copied.
 */
function parseStationConfig(widgetType: string, config: unknown): { readonly tabKey: string | undefined } | null {
  if (widgetType === "trend_strip") {
    const parsed = TREND_STRIP_WRITE.safeParse(config);
    return parsed.success ? { tabKey: parsed.data.tabKey } : null;
  }
  if (widgetType !== "mimic") return null;
  const parsed = mimicConfigSchema.safeParse(config);
  if (!parsed.success) return null;
  const strict =
    parsed.data.source === "preset" ? MIMIC_PRESET_WRITE.safeParse(config) : MIMIC_LAYOUT_WRITE.safeParse(config);
  return strict.success ? { tabKey: parsed.data.tabKey } : null;
}

/** The preset a mimic config names on the preset arm, or null for any other config. */
function mimicPreset(config: unknown): string | null {
  const parsed = mimicConfigSchema.safeParse(config);
  return parsed.success && parsed.data.source === "preset" ? parsed.data.preset : null;
}

/**
 * Plan the copy of the station's settings onto one site's widgets. Per site widget of type
 * `mimic` or `trend_strip`: match the station widget on tab key + widget type + rect, exactly one
 * match; copy the whole station config when (a) the site config equals its as-made config,
 * (b) the station config parses as the write API accepts it, (c) a `tabKey` it names is one of
 * `siteTabKeys` (the site copy's own tabs), and (d) for a mimic, both are `source: "preset"` on
 * the same preset. A site config already equal to the station's is `unchanged`. Configs compare
 * key-order-free (`canonicalJson`), since jsonb keeps its own key order.
 */
export function planStationSettingsCopy(
  siteWidgets: readonly StationSettingsWidget[],
  stationWidgets: readonly StationSettingsWidget[],
  asMade: StationSettingsAsMade,
  siteTabKeys: ReadonlySet<string>,
): StationSettingsPlan {
  const updates: StationSettingsUpdate[] = [];
  const kept: { widgetId: string; reason: StationSettingsKeptReason }[] = [];
  const unchanged: string[] = [];

  for (const site of siteWidgets) {
    if (!STATION_SETTINGS_WIDGET_TYPES.includes(site.widgetType)) continue;
    const keep = (reason: StationSettingsKeptReason): void => {
      kept.push({ widgetId: site.id, reason });
    };

    const matches = stationWidgets.filter(
      (station) =>
        station.tabKey === site.tabKey &&
        station.widgetType === site.widgetType &&
        station.gridX === site.gridX &&
        station.gridY === site.gridY &&
        station.gridW === site.gridW &&
        station.gridH === site.gridH,
    );
    const [station] = matches;
    if (!station) {
      keep("no_station_match");
      continue;
    }
    if (matches.length > 1) {
      keep("several_station_matches");
      continue;
    }
    const parsed = parseStationConfig(station.widgetType, station.config);
    if (parsed === null) {
      keep("station_config_invalid");
      continue;
    }
    if (parsed.tabKey !== undefined && !siteTabKeys.has(parsed.tabKey)) {
      keep("station_tab_absent");
      continue;
    }
    if (site.widgetType === "mimic") {
      const stationPreset = mimicPreset(station.config);
      if (stationPreset === null || stationPreset !== mimicPreset(site.config)) {
        keep("mimic_not_same_preset");
        continue;
      }
    }
    if (sameConfig(site.config, station.config)) {
      unchanged.push(site.id);
      continue;
    }
    if (!asMade.has(site.id)) {
      keep("no_as_made");
      continue;
    }
    if (!sameConfig(site.config, asMade.get(site.id))) {
      keep("edited");
      continue;
    }
    updates.push({ widgetId: site.id, from: site.config, to: station.config });
  }

  return { updates, kept, unchanged };
}

/**
 * Whether the step looks at a site copy at all (plan D3): a copy this run made, or one whose
 * `stock_version` is NULL or below {@link STATION_SETTINGS_STOCK_VERSION}. A copy stamped 3 or
 * more has had its one copy, so an administrator's later return to a core config holds.
 */
export function considersCopy({
  madeThisRun,
  stockVersion,
}: {
  readonly madeThisRun: boolean;
  readonly stockVersion: number | null;
}): boolean {
  return madeThisRun || stockVersion === null || stockVersion < STATION_SETTINGS_STOCK_VERSION;
}

// ── The DB step (plan Task 3, D3/D4) ──────────────────────────────────────────────────────────

/** The station's own dashboard: the unlink's identity (`phe-site-split.ts`), any template, no view row. */
const STATION_DASHBOARD_SQL = `
  SELECT id FROM bms.dashboards WHERE organization_id = $1 AND location_id = $2 AND slug = $3
`;
const LOCATION_SLUG_SQL = `SELECT slug FROM bms.locations WHERE id = $1 AND organization_id = $2`;
/** A dashboard's widgets of `$3`'s types, with their tab key. Params: `[dashboardId, organizationId, types]`. */
const SETTINGS_WIDGETS_SQL = `
  SELECT w.id, COALESCE(t.tab_key, '') AS tab_key, w.widget_type,
         w.grid_x, w.grid_y, w.grid_w, w.grid_h, w.config
    FROM bms.dashboard_widgets w
    LEFT JOIN bms.dashboard_tabs t ON t.id = w.tab_id
   WHERE w.dashboard_id = $1 AND w.organization_id = $2 AND w.widget_type = ANY($3::varchar[])
`;
/** A dashboard's tab keys. Params: `[dashboardId, organizationId]`. */
const TAB_KEYS_SQL = `SELECT tab_key FROM bms.dashboard_tabs WHERE dashboard_id = $1 AND organization_id = $2`;
/** The copy's own template row, whatever its status: the shape the copy was made from. */
const TEMPLATE_BY_ID_SQL = `
  SELECT id, content, stock_version FROM bms.dashboard_templates WHERE id = $1 AND organization_id = $2
`;
/** One widget's config, only while it is still the config the planner read. Params: `[id, org, to, from]`. */
const WIDGET_CONFIG_UPDATE_SQL = `
  UPDATE bms.dashboard_widgets SET config = $3::jsonb, updated_at = now()
   WHERE id = $1 AND organization_id = $2 AND config = $4::jsonb
`;

type SettingsWidgetRow = {
  id: string;
  tab_key: string;
  widget_type: string;
  grid_x: number;
  grid_y: number;
  grid_w: number;
  grid_h: number;
  config: unknown;
};

type WidgetPlace = Pick<StationSettingsWidget, "tabKey" | "widgetType" | "gridX" | "gridY" | "gridW" | "gridH">;

/** One widget of the copy `planSiteCopy` plans: its place and the config the seed writes there. */
export type PlannedSettingsWidget = WidgetPlace & { readonly config: unknown };

function samePlace(a: WidgetPlace, b: WidgetPlace): boolean {
  return (
    a.tabKey === b.tabKey &&
    a.widgetType === b.widgetType &&
    a.gridX === b.gridX &&
    a.gridY === b.gridY &&
    a.gridW === b.gridW &&
    a.gridH === b.gridH
  );
}

async function readSettingsWidgets(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  dashboardId: string,
): Promise<StationSettingsWidget[]> {
  const res = await pool.query<SettingsWidgetRow>(SETTINGS_WIDGETS_SQL, [
    dashboardId,
    organizationId,
    STATION_SETTINGS_WIDGET_TYPES,
  ]);
  return res.rows.map((row) => ({
    id: row.id,
    tabKey: row.tab_key,
    widgetType: row.widget_type,
    gridX: row.grid_x,
    gridY: row.grid_y,
    gridW: row.grid_w,
    gridH: row.grid_h,
    config: row.config,
  }));
}

/**
 * Pairs each stored widget with the planned widget at its place (tab key + widget type + rect),
 * one pairing each way: a stored widget gets an as-made config only when exactly one planned
 * widget and no other stored widget share its place. Any other stored widget has no entry, so the
 * planner keeps it (`no_as_made`). Pure.
 */
export function pairAsMadeConfigs(
  siteWidgets: readonly StationSettingsWidget[],
  planned: readonly PlannedSettingsWidget[],
): Map<string, unknown> {
  const asMade = new Map<string, unknown>();
  for (const site of siteWidgets) {
    const matches = planned.filter((widget) => samePlace(widget, site));
    const [only] = matches;
    if (only && matches.length === 1 && siteWidgets.filter((other) => samePlace(other, site)).length === 1) {
      asMade.set(site.id, only.config);
    }
  }
  return asMade;
}

/**
 * The as-made map of one copy: `planSiteCopy` run on the copy's own `template_id` row (the
 * `F4.319` move's method), paired by {@link pairAsMadeConfigs}. A template row that is gone or does not parse, or a plan that
 * is not `planned`, gives an empty map, so every widget is kept (`no_as_made`).
 */
async function asMadeConfigs(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  locationId: string,
  templateId: string,
  siteWidgets: readonly StationSettingsWidget[],
  choiceByGroupCode: Readonly<Record<string, string>>,
  points: Map<string, string>,
): Promise<Map<string, unknown>> {
  const row = (
    await pool.query<{ id: string; content: unknown; stock_version: number | null }>(TEMPLATE_BY_ID_SQL, [
      templateId,
      organizationId,
    ])
  ).rows[0];
  const content = row ? sectionTemplateContentSchema.safeParse(row.content) : null;
  if (!row || !content?.success) return new Map();
  const template: SeededSiteTemplate = { id: row.id, content: content.data, stockVersion: row.stock_version };
  const plan = await planSiteCopy(pool, organizationId, locationId, template, choiceByGroupCode, points);
  if (plan.status !== "planned") return new Map();
  const planned = plan.tabs.flatMap(({ row: tabRow, widgets }) =>
    widgets.map(({ widget }) => ({ ...widget, tabKey: tabRow.tab.key })),
  );
  return pairAsMadeConfigs(siteWidgets, planned);
}

/** The site copies the step looked at. */
export type StationSettingsCopyOutcome = {
  readonly copies: readonly {
    readonly locationId: string;
    readonly dashboardId: string;
    readonly copied: number;
    readonly considered: number;
    readonly kept: StationSettingsPlan["kept"];
  }[];
};

function droppedRowError(prefix: string, what: string, rowCount: number | null): Error {
  return new Error(
    `${prefix}: ${what} ${rowCount} of 1 rows. A FORCE-RLS write can drop rows without raising: check this ` +
      "runs inside the organization's tenant bracket.",
  );
}

/**
 * `F4.388` (ADR 0139 Amendment 1; plan D3/D4) — gives each split site's copy its station's
 * `mimic` and `trend_strip` settings, one time per copy. For each station on `splitStationCodes`:
 * the station's own dashboard (`site-layout-<station slug>` at the station, any template, no view
 * row needed: the row the unlink leaves); each site's candidate copy on `pump-station-standard`
 * (the move's candidate rule, row-locked), only when {@link considersCopy}; the as-made configs
 * from the copy's own template row; then {@link planStationSettingsCopy}. Each update is written
 * with the read config in the predicate, and a copy looked at is stamped
 * {@link STATION_SETTINGS_STOCK_VERSION}, so the step runs once per copy.
 *
 * Logs one line per copy (`copied N of M`) and one per kept widget with its reason (owner ruling
 * Q4: keep and log, never throw on a mismatch; a widget edited between the read and the write is
 * kept and logged too). Throws only when the stamp of a copy the step read and row-locked writes no
 * row: a dropped write on a row the step can see. Runs in the caller's `withOrganization` bracket
 * and transaction, after `seedSiteLayouts`. With no tenant bracket, FORCE ROW LEVEL SECURITY hides
 * every copy from the candidate read, so the step finds no copy and does nothing; it does not throw.
 */
export async function copyStationWidgetSettings(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  options: {
    readonly catalog: PheCatalogFile;
    readonly splitStationCodes: readonly string[];
    /** The copies this run made (`SiteLayoutSeedOutcome.made`), considered whatever their stamp. */
    readonly madeDashboardIds: ReadonlySet<string>;
    readonly choiceByGroupCode: Readonly<Record<string, string>>;
    readonly log: (line: string) => void;
  },
): Promise<StationSettingsCopyOutcome> {
  const { log } = options;
  const copies: StationSettingsCopyOutcome["copies"][number][] = [];
  let points: Map<string, string> | null = null;
  const stations = pheSiteLayoutStations(options.catalog).filter((entry) =>
    options.splitStationCodes.includes(entry.stationCode),
  );

  for (const station of stations) {
    const [stationId] = await resolvePhewbSiteLayoutLocations(pool, organizationId, [station]);
    if (!stationId) continue;
    const siteIds = await resolvePhewbSiteLayoutLocations(
      pool,
      organizationId,
      pheSiteLayoutSites(options.catalog, [station.stationCode]).filter(
        (entry) => entry.stationCode === station.stationCode,
      ),
    );
    const stationDashboardId =
      (
        await pool.query<{ id: string }>(STATION_DASHBOARD_SQL, [
          organizationId,
          stationId,
          siteLayoutSlug(station.slug),
        ])
      ).rows[0]?.id ?? null;
    let stationWidgets: StationSettingsWidget[] | null = null;

    for (const siteId of siteIds) {
      const location = (await pool.query<{ slug: string }>(LOCATION_SLUG_SQL, [siteId, organizationId])).rows[0];
      if (!location) continue;
      const copy = (
        await pool.query<{ id: string; stock_version: number | null; template_id: string; template_code: string }>(
          SITE_LAYOUT_CANDIDATE_SQL,
          [siteId, organizationId, siteLayoutSlug(location.slug)],
        )
      ).rows[0];
      if (!copy || copy.template_code !== PUMP_STATION_STANDARD_SITE_TEMPLATE.code) continue;
      if (!considersCopy({ madeThisRun: options.madeDashboardIds.has(copy.id), stockVersion: copy.stock_version })) {
        continue;
      }
      const prefix = `copyStationWidgetSettings: ${location.slug} (copy ${copy.id})`;
      const siteWidgets = await readSettingsWidgets(pool, organizationId, copy.id);
      let plan: StationSettingsPlan = { updates: [], kept: [], unchanged: [] };
      let written = 0;
      if (stationDashboardId === null) {
        log(`${prefix}: station ${station.slug} has no dashboard; copied 0 of ${siteWidgets.length}`);
      } else {
        stationWidgets ??= await readSettingsWidgets(pool, organizationId, stationDashboardId);
        const siteTabKeys = new Set(
          (await pool.query<{ tab_key: string }>(TAB_KEYS_SQL, [copy.id, organizationId])).rows.map((row) => row.tab_key),
        );
        points ??= await activePointsByAsset(pool, organizationId);
        const asMade = await asMadeConfigs(
          pool,
          organizationId,
          siteId,
          copy.template_id,
          siteWidgets,
          options.choiceByGroupCode,
          points,
        );
        plan = planStationSettingsCopy(siteWidgets, stationWidgets, asMade, siteTabKeys);
        for (const update of plan.updates) {
          const res = await pool.query(WIDGET_CONFIG_UPDATE_SQL, [
            update.widgetId,
            organizationId,
            JSON.stringify(update.to),
            JSON.stringify(update.from),
          ]);
          // Only the dashboard row is locked: an edit committed between the read and this write
          // leaves the predicate false. Q4: keep it and log, the boot continues. With no tenant
          // bracket the step never gets here: FORCE RLS hides the copy from the candidate read. The
          // stamp's throw below guards a dropped write on a copy the step did read.
          if (res.rowCount === 1) written += 1;
          else log(`${prefix}: kept widget ${update.widgetId}: changed during the seed`);
        }
        log(
          `${prefix}: copied ${written} of ${siteWidgets.length} mimic and trend-strip settings ` +
            `from station ${station.slug} (${plan.unchanged.length} already equal, ${plan.kept.length} kept)`,
        );
        for (const kept of plan.kept) {
          const widget = siteWidgets.find((item) => item.id === kept.widgetId);
          log(`${prefix}: kept widget ${kept.widgetId} (${widget?.widgetType} on ${widget?.tabKey}): ${kept.reason}`);
        }
      }
      if (copy.stock_version === null || copy.stock_version < STATION_SETTINGS_STOCK_VERSION) {
        const stamped = await pool.query(COPY_STAMP_SQL, [
          copy.id,
          organizationId,
          STATION_SETTINGS_STOCK_VERSION,
          copy.stock_version,
        ]);
        if (stamped.rowCount !== 1) throw droppedRowError(prefix, "stamped", stamped.rowCount);
      }
      copies.push({
        locationId: siteId,
        dashboardId: copy.id,
        copied: written,
        considered: siteWidgets.length,
        kept: plan.kept,
      });
    }
  }
  return { copies };
}
