import type { z } from "zod";

import type * as L from "../contracts/aggregate-level";
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
