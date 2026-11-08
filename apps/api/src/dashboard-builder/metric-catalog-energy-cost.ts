import { energyCostDayRowSchema, type EnergyCostPeriod } from "@bms/shared";

import { periodDays, readEnergyCostByDay, sumCostDays } from "../telemetry/energy-cost-by-day";
import type { Resolver } from "./metric-catalog-types";

/**
 * `F4.332` (ADR 0112 Amendment 3 item 1, ADR 0070 Amendment 7) — the two energy-cost catalog
 * entries. Both read `readEnergyCostByDay` over the resolved scope (the dashboard's scope
 * intersected with the reader's readable assets, inside the organization), through `deps.pool`
 * and `deps.tariffs`, so both are in `RESOLVE_AFTER_COMMIT` and never touch `tx`.
 *
 * `energy.cost.total` is the sum of the same daily rows `energy.cost_by_day` returns
 * (`sumCostDays`), so a tile and a chart from these keys cannot disagree.
 */

export const energyCostByDay: Resolver = async (_tx, organizationId, scope, deps, params) => {
  const { days } = params as { days: number };
  const rows = await readEnergyCostByDay(deps.pool, deps.tariffs, organizationId, scope, () => days, new Date());
  return {
    shape: "dataset",
    key: "energy.cost_by_day",
    columns: ["day", "kwh", "cost", "currency", "reason"],
    // Parsed through the shared row schema (ADR 0030): a row the read cannot vouch for throws
    // here, inside the after-commit read, rather than reaching a chart as a malformed cell.
    rows: rows.map((row) => ({ ...energyCostDayRowSchema.parse(row) })),
    truncated: false,
  };
};

export const energyCostTotal: Resolver = async (_tx, organizationId, scope, deps, params) => {
  const { period } = params as { period: EnergyCostPeriod };
  const rows = await readEnergyCostByDay(
    deps.pool,
    deps.tariffs,
    organizationId,
    scope,
    (today) => periodDays(period, today),
    new Date(),
  );
  const total = sumCostDays(rows);
  return {
    shape: "metric",
    key: "energy.cost.total",
    value: total.value,
    // No unit: the cost is shown in `currency` (ADR 0070 decision 8 gives money no unit of its
    // own), as `sustainability.total` does for its cost points.
    unit: null,
    currency: total.currency,
    coverage: total.coverage,
    reason: total.reason,
  };
};
