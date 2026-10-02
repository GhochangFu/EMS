import { z } from "zod";

import { dashboardTabKeySchema } from "./dashboard-tabs";

/**
 * `F3.32c` / ADR 0081 — the `mimic` widget's config, both arms (plan D1, D2).
 *
 * Moved out of `./dashboard-builder`, which sits at the AGENTS.md §4.5 1000-line cap and has no
 * room for a second arm. `./dashboard-builder` imports these; nothing re-exports them from
 * there, so `contracts/index.ts` sees each name once.
 *
 * Plain `z.object` throughout — no `.merge()`, `.extend()`, `.pick()`, `.omit()` or
 * `.readonly()` (ADR 0030 decision 2).
 */

/**
 * The mimic presets, closed (`F3.32`, ADR 0079 decision 2). A preset is a drawing shipped in
 * code — node positions, pipes and the role each node resolves — so a preset declared by data
 * would name a picture nobody drew. The definitions are `MIMIC_PRESETS` in
 * `packages/shared/src/mimic-presets.ts`; the coordinates are the web renderer's.
 *
 * `F3.32d` / ADR 0082 decision 3: one preset per asset domain. `water_train` stays FIRST — the
 * dashboard builder's default preset is `options[0]`, and every stored widget names it.
 */
export const mimicPresetSchema = z.enum([
  "water_train",
  "electrical_distribution",
  "hvac_chiller_plant",
  "it_power_cooling",
  "compressed_air",
  "environment_monitoring",
  "facility_services",
  "lv_single_line",
]);

/**
 * `F3.74` (ADR 0088 decision 11, plan D7) — the tab a mimic resolves through when the tab it sits
 * on binds no group: an Overview mimic names `sld` and draws that tab's group. Optional on both
 * arms, so every stored config still parses. The write guard (`mimicGroupFor`) refuses a key that
 * names no group-bound tab of the body with this sentence; the key is never echoed.
 */
export const MIMIC_TAB_MESSAGE =
  "a plant mimic's tabKey must name a tab of this dashboard that is bound to an asset group";

/**
 * The `tabKey` field of both arms. `.describe()` AFTER the shared refinement (ADR 0029 decision
 * 10), as `siteTemplateTabSchema.key` does: the document emits nothing for the reserved-key
 * refusal, and the guard on the named tab is the service's.
 */
const mimicTabKeySchema = dashboardTabKeySchema.describe(
  "The tab this mimic resolves through when the tab it sits on binds no asset group: " +
    "lowercase letters, digits and hyphens, 1 to 64 characters, and not `assets`. On a dashboard " +
    "it must name a tab of the same dashboard that binds a group; in a template, one of the " +
    "template's tabs that has a domain. Otherwise the write answers 400.",
);

/**
 * The preset arm (`F3.32`, ADR 0079 decision 2). Every field added since v1 is optional, so a
 * stored widget with `source: "preset"` never needs migrating; ADR 0082 only widens the enum, and
 * `F3.74` adds `tabKey` (see `MIMIC_TAB_MESSAGE`) and `compact` (draw labels, switches and pills
 * only — no value rows or callouts; ADR 0088 OQ9).
 *
 * **No `commonConfigFields`, deliberately (F3.32 plan D8).** A mimic draws several nodes, each
 * with its own points and units, so one widget-level `unit` or `decimals` has nothing to apply
 * to. Generic readers of those two fields guard with `"unit" in widget.config`.
 *
 * Flat, for the reason `valueTileConfigSchema`'s docblock gives: the write surface composes each
 * arm with `.strict()`, and `.strict()` does not descend.
 */
export const mimicPresetConfigSchema = z.object({
  source: z.literal("preset"),
  preset: mimicPresetSchema,
  tabKey: mimicTabKeySchema.optional(),
  compact: z.boolean().optional(),
});

/**
 * The layout arm (`F3.32c`, ADR 0081) — a drawing an organization admin stored as one
 * `bms.mimic_layouts` row. The widget holds the id only; the resolver reads the geometry.
 * Flat, for the same `.strict()` reason as the preset arm.
 *
 * **`layoutId` is lowercase, refused otherwise, never transformed.** `z.string().uuid()` accepts
 * an uppercase uuid, and the id is stored as sent: the resolver keys layouts by the database's
 * lowercase id, so an uppercase one would never render. A refusal keeps the field a plain string
 * schema, which the write surface's `.shape` rebuild and the OpenAPI walkers need.
 *
 * `F3.74` adds `tabKey`, as on the preset arm; `compact` is the preset arm's only (plan D7).
 */
export const MIMIC_LAYOUT_ID_CASE_MESSAGE = "layoutId must be a lowercase uuid";

export const mimicLayoutConfigSchema = z.object({
  source: z.literal("layout"),
  layoutId: z.string().uuid().regex(/^[0-9a-f-]+$/, MIMIC_LAYOUT_ID_CASE_MESSAGE),
  tabKey: mimicTabKeySchema.optional(),
});

/**
 * The `mimic` widget's config: a union on `source` (ADR 0079 decision 9, delivered by ADR 0081).
 * A `z.discriminatedUnion` has no `.strict()`, so the API composes `.strict()` per arm from the
 * two exported arms above (plan D2).
 */
export const mimicConfigSchema = z.discriminatedUnion("source", [
  mimicPresetConfigSchema,
  mimicLayoutConfigSchema,
]);
