import { locationTariffDtoSchema, locationTariffsResponseSchema } from "@bms/shared/contracts";
import type {
  CreateLocationTariffBody,
  LocationTariffDto,
  LocationTariffsResponse,
  UpdateLocationTariffBody,
} from "@bms/shared/contracts";

import { ApiError } from "../lib/api-error";
import { adminFetch } from "./admin/client";
import { clearSessionOnAuthFailure, withAuth } from "./http";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F4.365` U8 (ADR 0134 decision 3) — a location's tariff mappings,
 * `/admin/locations/:locationId/tariffs`. A 400 names a wrong meter, an unknown
 * key or a load unit the basis does not take; a 409 names the overlapping
 * mapping. Both are sentences the page renders through `apiErrorMessage`.
 */

export function locationTariffsQueryKey(locationId: string) {
  return ["admin", "location-tariffs", locationId] as const;
}

function path(locationId: string, mappingId?: string): string {
  const root = `/admin/locations/${encodeURIComponent(locationId)}/tariffs`;
  return mappingId === undefined ? root : `${root}/${encodeURIComponent(mappingId)}`;
}

/** `GET` — the location's mappings. */
export async function fetchLocationTariffs(locationId: string): Promise<LocationTariffsResponse> {
  return adminFetch(path(locationId), locationTariffsResponseSchema);
}

/** `POST` — map the location to a tariff line over a month window. */
export async function createLocationTariff(
  locationId: string,
  body: CreateLocationTariffBody,
): Promise<LocationTariffDto> {
  return adminFetch(path(locationId), locationTariffDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** `PATCH` — meter, load and window only; the line itself is immutable. */
export async function updateLocationTariff(
  locationId: string,
  mappingId: string,
  body: UpdateLocationTariffBody,
): Promise<LocationTariffDto> {
  return adminFetch(path(locationId, mappingId), locationTariffDtoSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** `DELETE` — 204, no body (`deleteAdminCalcParameter`'s shape). */
export async function deleteLocationTariff(locationId: string, mappingId: string): Promise<void> {
  const sent = withAuth({ method: "DELETE" });
  const res = await fetch(`${base}/api/v1${path(locationId, mappingId)}`, sent);
  if (res.status === 204) {
    return;
  }
  clearSessionOnAuthFailure(res, sent);
  const text = await res.text();
  throw new ApiError(text || `admin /admin/locations/:id/tariffs/:id ${res.status}`, res.status);
}
