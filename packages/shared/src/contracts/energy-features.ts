import { z } from "zod";

/**
 * `F4.364` (ADR 0133 decision 1) — whether an organization's locations show energy: `auto` (the
 * default) shows it where a location has energy data, `on` always, `off` never. Migration `0153`'s
 * CHECK is held to this list by a test.
 */
export const ENERGY_FEATURES = ["auto", "on", "off"] as const;

/**
 * `F4.364` (ADR 0133 decision 3) — the location card's first figure once resolved. `auto` is not
 * here: the API resolves it, so it never reaches the wire.
 */
export const RESOLVED_CARD_PRIMARY_METRICS = ["kw", "health", "critical_alarms", "none"] as const;

/** `F4.364` (ADR 0133 decisions 1 and 3) — the stored setting: `auto` plus the resolved figures. Migration `0153`'s CHECK is held to it. */
export const CARD_PRIMARY_METRICS = ["auto", ...RESOLVED_CARD_PRIMARY_METRICS] as const;

export const energyFeaturesSchema = z
  .enum(ENERGY_FEATURES)
  .describe("Energy features (ADR 0133 decision 1): auto (default — shown where a location has energy data), on or off.");

export const cardPrimaryMetricSchema = z
  .enum(CARD_PRIMARY_METRICS)
  .describe(
    "Location card first figure (ADR 0133 decision 3): auto (default — kW with energy, asset health without), kw, health, critical_alarms or none.",
  );

export const resolvedCardPrimaryMetricSchema = z
  .enum(RESOLVED_CARD_PRIMARY_METRICS)
  .describe("The location card's first figure as resolved by the API — never auto (ADR 0133 decision 4).");

/** `F4.364` — one of `auto`, `on`, `off`. Exported from here: `src/index.ts` sits at the line cap. */
export type EnergyFeatures = z.infer<typeof energyFeaturesSchema>;

/** `F4.364` — a stored card setting, `auto` included. */
export type CardPrimaryMetric = z.infer<typeof cardPrimaryMetricSchema>;

/** `F4.364` — a resolved card figure, never `auto`. */
export type ResolvedCardPrimaryMetric = z.infer<typeof resolvedCardPrimaryMetricSchema>;
