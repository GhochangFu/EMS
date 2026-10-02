import { z } from "zod";

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
 * The preset arm (`F3.32`, ADR 0079 decision 2) — its shape unchanged since v1, so a stored
 * widget with `source: "preset"` never needs migrating; ADR 0082 only widens the enum.
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
 */
export const MIMIC_LAYOUT_ID_CASE_MESSAGE = "layoutId must be a lowercase uuid";

export const mimicLayoutConfigSchema = z.object({
  source: z.literal("layout"),
  layoutId: z.string().uuid().regex(/^[0-9a-f-]+$/, MIMIC_LAYOUT_ID_CASE_MESSAGE),
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
