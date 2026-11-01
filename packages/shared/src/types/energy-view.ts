import type { z } from "zod";

import type * as L from "../contracts/aggregate-level";
import type * as O from "../contracts/energy-organization-views";
import type * as S from "../contracts/energy-view";

/** `F4.298` (ADR 0108 decision 2.11) — one of the four ADR 0023 rollup levels. Derived, never written by hand (ADR 0030). */
export type AggregateLevel = z.infer<typeof L.aggregateLevelSchema>;

/** `F4.298` (ADR 0108 decision 2) — derived from the schemas, never written by hand (ADR 0030). */
export type EnergyViewRange = z.infer<typeof S.energyViewRangeSchema>;

/** The parsed query of `GET /reports/energy/view`. */
export type EnergyViewQuery = z.infer<typeof S.energyViewQuerySchema>;

/** One period (current or compare) of {@link EnergyView}. */
export type EnergyViewPeriod = z.infer<typeof S.energyViewPeriodSchema>;

/** The two counts of a partial view. */
export type EnergyViewPartial = z.infer<typeof S.energyViewPartialSchema>;

/** `GET /reports/energy/view`. */
export type EnergyView = z.infer<typeof S.energyViewSchema>;

/** `GET /reports/energy/filter-options`. */
export type EnergyFilterOptions = z.infer<typeof S.energyFilterOptionsSchema>;

/** One readable location in {@link EnergyFilterOptions}. */
export type EnergyFilterLocation = z.infer<typeof S.energyFilterLocationSchema>;

/** One readable organization in {@link EnergyFilterOptions}. */
export type EnergyFilterOrganization = z.infer<typeof S.energyFilterOrganizationSchema>;

/** `F4.299` (ADR 0108 Amendment 1) — one site row of the ranking. */
export type EnergySiteEnergy = z.infer<typeof O.energySiteEnergySchema>;

/** The ranked sites, with the previous period when compare is on. */
export type EnergySiteRanking = z.infer<typeof O.energySiteRankingSchema>;

/** One column of the by-site trend: a site or the folded `other`. */
export type EnergySiteTrendColumn = z.infer<typeof O.energySiteTrendColumnSchema>;

/** The by-site stacked trend grid. */
export type EnergySiteTrend = z.infer<typeof O.energySiteTrendSchema>;

/** One day x hour cell of the heatmap. */
export type EnergyHeatmapCell = z.infer<typeof O.energyHeatmapCellSchema>;

/** One advisory abnormal-list entry. */
export type EnergyAbnormalEntry = z.infer<typeof O.energyAbnormalEntrySchema>;

/** `GET /reports/energy/organization-views`. */
export type EnergyOrganizationViews = z.infer<typeof O.energyOrganizationViewsSchema>;
