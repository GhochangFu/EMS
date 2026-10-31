/**
 * `F4.298` (ADR 0108 decision 2.10) — the nominal grid / DG split, one rule for
 * its callers: `dashboard/energy-centre.ts` (each source-mix point, in kW),
 * `reports/reports.service.ts` (the report's source totals, in kWh) and the
 * energy view (`reports/energy-view-read.ts`).
 *
 * The simulator has no separate DG meter, so DG is a nominal slice: 4 % of the
 * load solar does not cover, capped at 10 % of the total; grid is the rest of
 * that net load. The figures are unit-free and unrounded — each caller keeps
 * its own rounding.
 */
export function nominalSourceSplit(total: number, solar: number): { dg: number; grid: number } {
  const net = Math.max(total - solar, 0);
  const dg = Math.min(net * 0.04, total * 0.1);
  return { dg, grid: Math.max(net - dg, 0) };
}
