import { energyFilterOptionsSchema, energyOrganizationViewsSchema, energyViewSchema } from "@bms/shared/contracts";
import type { EnergyFilterOptions, EnergyOrganizationViews, EnergyView, EnergyViewQuery } from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F4.298` (ADR 0108 decision 2) — the Energy page's two reads. The
 * `reports.ts` shape: `withAuth`, `clearSessionOnAuthFailure` on a non-OK
 * status, a plain thrown `Error` naming the route and status, and the body
 * checked against the contract.
 */

/** One `locationIds` key per id (the server folds the repeats); an absent value sends no key. */
function viewSearch(query: EnergyViewQuery): URLSearchParams {
  const params = new URLSearchParams({ range: query.range });
  if (query.organizationId !== undefined) {
    params.append("organizationId", query.organizationId);
  }
  for (const id of query.locationIds ?? []) {
    params.append("locationIds", id);
  }
  if (query.from !== undefined) {
    params.append("from", query.from);
  }
  if (query.to !== undefined) {
    params.append("to", query.to);
  }
  if (query.compare !== undefined) {
    params.append("compare", query.compare);
  }
  return params;
}

/** GET /api/v1/reports/energy/view */
export async function fetchEnergyView(query: EnergyViewQuery): Promise<EnergyView> {
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/reports/energy/view?${viewSearch(query)}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`reports/energy/view ${res.status}`);
  }
  return checkResponse(energyViewSchema, await res.json(), "reports/energy/view");
}

/** GET /api/v1/reports/energy/organization-views — the same query as {@link fetchEnergyView} (`F4.299`). */
export async function fetchEnergyOrganizationViews(query: EnergyViewQuery): Promise<EnergyOrganizationViews> {
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/reports/energy/organization-views?${viewSearch(query)}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`reports/energy/organization-views ${res.status}`);
  }
  return checkResponse(energyOrganizationViewsSchema, await res.json(), "reports/energy/organization-views");
}

/** GET /api/v1/reports/energy/filter-options — the caller's readable organizations and locations. */
export async function fetchEnergyFilterOptions(): Promise<EnergyFilterOptions> {
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/reports/energy/filter-options`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`reports/energy/filter-options ${res.status}`);
  }
  return checkResponse(energyFilterOptionsSchema, await res.json(), "reports/energy/filter-options");
}
