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

/** One node of a preset. `roleCode` is a `bms.asset_roles` code. */
export type MimicPresetNode = {
  readonly key: string;
  readonly label: string;
  readonly roleCode: string;
};

/** One pipe between two nodes of the same preset, drawn in flow direction. */
export type MimicPresetPipe = {
  readonly from: string;
  readonly to: string;
};

/**
 * A preset's topology. `sink` is a drawn label after a node, not a node — it resolves to no
 * asset (owner ruling 1, 2026-09-28: Discharge is a sink label after ETP, not a ninth node).
 */
export type MimicPresetDef = {
  readonly label: string;
  readonly nodes: readonly MimicPresetNode[];
  readonly pipes: readonly MimicPresetPipe[];
  readonly sink: { readonly from: string; readonly label: string };
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
} as const satisfies Record<MimicPreset, MimicPresetDef>;
