import {
  cardPrimaryMetricSchema,
  energyFeaturesSchema,
  type ResolvedCardPrimaryMetric,
} from "@bms/shared";

/**
 * `F4.364` (ADR 0133 decision 2) — a location "has energy data" when one of its active assets has
 * a `kw` value newer than this many days. `locationKpis` passes it to its SQL as `$3`.
 */
export const ENERGY_DATA_WINDOW_DAYS = 30;

/** What `locationKpis`'s SQL reads for one location: the two stored settings and two facts. */
export interface LocationEnergyFacts {
  /** `bms.organizations.energy_features` as stored; an unknown value reads as `auto` (D3). */
  energyFeatures: unknown;
  /** `bms.organizations.card_primary_metric` as stored; an unknown value reads as `auto` (D3). */
  cardPrimaryMetric: unknown;
  /** An active in-scope asset has a `kw` value inside `ENERGY_DATA_WINDOW_DAYS`. */
  hasEnergyData: boolean;
  /** The summed latest `kw` of the in-scope assets, or `null` when none has a value. */
  totalKw: number | null;
}

/** The three resolved fields of the location KPI row. */
export interface LocationEnergy {
  energyShown: boolean;
  primaryMetric: ResolvedCardPrimaryMetric;
  totalKw: number | null;
}

/**
 * `F4.375` (ADR 0133 decision 2, plan D2) — the one "energy shown" rule: `on` → shown; `off` →
 * not; `auto` (and any unknown stored value, F4.364 D3) → `hasEnergyData`. The location cards
 * (`resolveLocationEnergy`) and the estate ribbon (`summariseEstateEnergy`) both call it; no SQL
 * restates it.
 */
export function isEnergyShown(energyFeatures: unknown, hasEnergyData: boolean): boolean {
  const energy = energyFeaturesSchema.safeParse(energyFeatures);
  const setting = energy.success ? energy.data : "auto";
  return setting === "on" || (setting === "auto" && hasEnergyData);
}

/**
 * `F4.364` (ADR 0133 decisions 2–4, plan ruling Q5) — resolves an organization's two settings for
 * one location: `on`/`off` win; `auto` follows `hasEnergyData`. A card setting other than `auto`
 * is honoured whether or not energy is shown; `auto` is `kw` with energy and `health` without.
 * `totalKw` is `null` whenever energy is not shown.
 */
export function resolveLocationEnergy(facts: LocationEnergyFacts): LocationEnergy {
  const card = cardPrimaryMetricSchema.safeParse(facts.cardPrimaryMetric);
  const cardPrimaryMetric = card.success ? card.data : "auto";

  const energyShown = isEnergyShown(facts.energyFeatures, facts.hasEnergyData);
  const primaryMetric: ResolvedCardPrimaryMetric =
    cardPrimaryMetric === "auto" ? (energyShown ? "kw" : "health") : cardPrimaryMetric;
  return { energyShown, primaryMetric, totalKw: energyShown ? facts.totalKw : null };
}
