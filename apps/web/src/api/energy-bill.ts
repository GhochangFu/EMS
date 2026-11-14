import { energyBillSchema } from "@bms/shared/contracts";
import type { EnergyBill } from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F4.365` U10 (ADR 0134 decision 6) — a location's monthly energy bill. The
 * `energy-view.ts` shape: `withAuth`, `clearSessionOnAuthFailure`, a plain
 * thrown `Error` naming the route and status, and the body checked against the
 * contract. An absent `month` sends no key, so the API picks the current month
 * in the location's own zone.
 */

/** GET /api/v1/locations/:locationId/energy-bill */
export async function fetchEnergyBill(locationId: string, month?: string): Promise<EnergyBill> {
  const sent = withAuth();
  const search = month === undefined ? "" : `?${new URLSearchParams({ month })}`;
  const res = await fetch(`${base}/api/v1/locations/${encodeURIComponent(locationId)}/energy-bill${search}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`locations/energy-bill ${res.status}`);
  }
  return checkResponse(energyBillSchema, await res.json(), "locations/energy-bill");
}
