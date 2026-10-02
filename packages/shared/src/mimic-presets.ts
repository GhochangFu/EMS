import type { z } from "zod";

import type { mimicPresetSchema } from "./contracts/mimic-config";

/**
 * `F3.32` / ADR 0079 decision 2 — the fixed plant mimic presets (plan D3).
 *
 * **Topology here, coordinates in the web.** Which nodes a preset draws, the role each resolves
 * against, and which pipes join them is something the API needs too — it answers the nodes in
 * this order. Where each node sits on the canvas is presentation, and lives beside the renderer
 * in `apps/web`.
 *
 * A preset is code, not data, for the reason `widgetTypeSchema`'s docblock gives: its
 * behaviour is a drawing, and no column holds one. A new preset is a release.
 */

type MimicPreset = z.infer<typeof mimicPresetSchema>;

/**
 * One node of a preset. `roleCode` is a `bms.asset_roles` code, or `null` for a passive node
 * (`F3.74` / ADR 0088 OQ8: a bus resolves to no asset and is absent from the resolver's nodes).
 * `fanOut` (`F3.74` plan D4) makes the node stand for every member of its role, up to the
 * resolver's cap, rather than the first one; optional, so a node that does not fan out leaves
 * the key out.
 */
export type MimicPresetNode = {
  readonly key: string;
  readonly label: string;
  readonly roleCode: string | null;
  readonly fanOut?: true;
};

/** One pipe between two nodes of the same preset, drawn in flow direction. */
export type MimicPresetPipe = {
  readonly from: string;
  readonly to: string;
};

/**
 * A preset's topology. `sink` is a drawn label after a node, not a node — it resolves to no
 * asset (owner ruling 1, 2026-09-28: Discharge is a sink label after ETP, not a ninth node).
 *
 * `sink` is optional (`F3.32d`, ADR 0082 decision 3): only `water_train` has one, and every
 * reader guards `def.sink !== undefined`. Optional, not nullable, so a preset without a sink
 * simply leaves the key out. A preset with no pipes is valid too.
 *
 * `sources` (`F3.74` plan D3) names the nodes energy enters at; a preset that names any is walked
 * by `energiseGraph`. Optional for the same reason as `sink`: a preset without it is not walked.
 */
export type MimicPresetDef = {
  readonly label: string;
  readonly nodes: readonly MimicPresetNode[];
  readonly pipes: readonly MimicPresetPipe[];
  readonly sink?: { readonly from: string; readonly label: string };
  readonly sources?: readonly string[];
};

/**
 * Every preset, keyed by the closed enum. `satisfies` forces a key per enum member at compile
 * time and keeps the literal types for the web layout; `mimic-presets.spec.ts` holds the
 * runtime keys to `mimicPresetSchema.options` in both directions.
 *
 * `water_train`: intake → WTP → RO → softener → storage; the cooling tower, and STP → ETP, off
 * storage; discharge after ETP. The cooling tower resolves against the existing `utilities`
 * role (migration `0051`); the other seven codes are ADR 0079's, spelled as the owner ruled
 * (ruling 3: `water_intake`, `water_storage`).
 *
 * The six domain presets are ADR 0082 decision 3's table (plan §3). Node keys are snake_case,
 * because "Start from" copies them into a stored layout, whose keys take no hyphen; role codes
 * are the vocabulary's hyphenated codes — the existing ones from migrations `0051` and `0060`,
 * the new ones from `0089` (decision 4).
 */
export const MIMIC_PRESETS = {
  water_train: {
    label: "Water train",
    nodes: [
      { key: "water_intake", label: "Water Intake", roleCode: "water_intake" },
      { key: "wtp", label: "WTP", roleCode: "wtp" },
      { key: "ro", label: "RO", roleCode: "ro" },
      { key: "softener", label: "Softener", roleCode: "softener" },
      { key: "water_storage", label: "Water Storage", roleCode: "water_storage" },
      { key: "cooling_tower", label: "Cooling Tower", roleCode: "utilities" },
      { key: "stp", label: "STP", roleCode: "stp" },
      { key: "etp", label: "ETP", roleCode: "etp" },
    ],
    pipes: [
      { from: "water_intake", to: "wtp" },
      { from: "wtp", to: "ro" },
      { from: "ro", to: "softener" },
      { from: "softener", to: "water_storage" },
      { from: "water_storage", to: "cooling_tower" },
      { from: "water_storage", to: "stp" },
      { from: "stp", to: "etp" },
    ],
    sink: { from: "etp", label: "Discharge" },
  },
  electrical_distribution: {
    label: "Electrical distribution",
    nodes: [
      { key: "incoming", label: "Incoming", roleCode: "incoming-supply" },
      { key: "ht_panel", label: "HT Panel", roleCode: "ht-panel" },
      { key: "transformer", label: "Transformer", roleCode: "transformer" },
      { key: "lt_panel", label: "LT Panel", roleCode: "lt-panel" },
      { key: "mcc", label: "MCC", roleCode: "mcc" },
      { key: "dg_set", label: "DG Set", roleCode: "dg-set" },
      { key: "ups", label: "UPS", roleCode: "ups" },
    ],
    pipes: [
      { from: "incoming", to: "ht_panel" },
      { from: "ht_panel", to: "transformer" },
      { from: "transformer", to: "lt_panel" },
      { from: "lt_panel", to: "mcc" },
      { from: "dg_set", to: "lt_panel" },
      { from: "lt_panel", to: "ups" },
    ],
  },
  hvac_chiller_plant: {
    label: "HVAC chiller plant",
    nodes: [
      { key: "cooling_tower", label: "Cooling Tower", roleCode: "cooling-tower" },
      { key: "chiller", label: "Chiller", roleCode: "chiller" },
      { key: "primary_pumps", label: "Primary Pumps", roleCode: "primary-pump" },
      { key: "secondary_pumps", label: "Secondary Pumps", roleCode: "secondary-pump" },
      { key: "ahu_fcu", label: "AHU / FCU", roleCode: "ahu-fcu" },
    ],
    pipes: [
      { from: "cooling_tower", to: "chiller" },
      { from: "chiller", to: "primary_pumps" },
      { from: "primary_pumps", to: "secondary_pumps" },
      { from: "secondary_pumps", to: "ahu_fcu" },
    ],
  },
  it_power_cooling: {
    label: "IT power and cooling",
    nodes: [
      { key: "utility_feed", label: "Utility Feed", roleCode: "lt-panel" },
      { key: "ups", label: "UPS", roleCode: "ups" },
      { key: "battery", label: "Battery", roleCode: "battery" },
      { key: "pdu", label: "PDU", roleCode: "pdu" },
      { key: "it_racks", label: "IT Racks", roleCode: "it-rack" },
      { key: "crac", label: "CRAC", roleCode: "crac" },
    ],
    pipes: [
      { from: "utility_feed", to: "ups" },
      { from: "battery", to: "ups" },
      { from: "ups", to: "pdu" },
      { from: "pdu", to: "it_racks" },
      { from: "crac", to: "it_racks" },
    ],
  },
  compressed_air: {
    label: "Compressed air",
    nodes: [
      { key: "compressor", label: "Compressor", roleCode: "air-compressor" },
      { key: "dryer", label: "Dryer", roleCode: "air-dryer" },
      { key: "receiver", label: "Receiver", roleCode: "air-receiver" },
      { key: "header", label: "Header", roleCode: "air-header" },
    ],
    pipes: [
      { from: "compressor", to: "dryer" },
      { from: "dryer", to: "receiver" },
      { from: "receiver", to: "header" },
    ],
  },
  environment_monitoring: {
    label: "Environment monitoring",
    nodes: [
      { key: "ambient", label: "Ambient", roleCode: "ambient-station" },
      { key: "indoor_air", label: "Indoor Air", roleCode: "indoor-air" },
      { key: "stack", label: "Stack", roleCode: "stack-monitor" },
      { key: "effluent", label: "Effluent", roleCode: "effluent-monitor" },
    ],
    pipes: [],
  },
  facility_services: {
    label: "Facility services",
    nodes: [
      { key: "main_meter", label: "Main Meter", roleCode: "meter" },
      { key: "lighting", label: "Lighting", roleCode: "lighting" },
      { key: "lifts", label: "Lifts", roleCode: "lifts" },
      { key: "fire_pumps", label: "Fire Pumps", roleCode: "fire-pump" },
      { key: "utilities", label: "Utilities", roleCode: "utilities" },
    ],
    pipes: [
      { from: "main_meter", to: "lighting" },
      { from: "main_meter", to: "lifts" },
      { from: "main_meter", to: "fire_pumps" },
      { from: "main_meter", to: "utilities" },
    ],
  },
} as const satisfies Record<MimicPreset, MimicPresetDef>;
