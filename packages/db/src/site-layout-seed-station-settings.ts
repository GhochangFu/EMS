import { mimicConfigSchema, trendStripWidgetConfigSchema } from "@bms/shared";

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
  /** The station config does not parse with the widget type's shared schema. */
  | "station_config_invalid"
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

/** The stamp a copy carries once the step has run on it (plan D3, "Why the stamp"). */
export const STATION_SETTINGS_STOCK_VERSION = 3;

function sameConfig(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function stationConfigParses(widgetType: string, config: unknown): boolean {
  if (widgetType === "mimic") return mimicConfigSchema.safeParse(config).success;
  if (widgetType === "trend_strip") return trendStripWidgetConfigSchema.safeParse(config).success;
  return false;
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
 * (b) the station config parses, and (c) for a mimic, both are `source: "preset"` on the same
 * preset. A site config already equal to the station's is `unchanged`. Configs compare
 * key-order-free (`canonicalJson`), since jsonb keeps its own key order.
 */
export function planStationSettingsCopy(
  siteWidgets: readonly StationSettingsWidget[],
  stationWidgets: readonly StationSettingsWidget[],
  asMade: StationSettingsAsMade,
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
    if (!stationConfigParses(station.widgetType, station.config)) {
      keep("station_config_invalid");
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
