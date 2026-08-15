import {
  energyCentreSummarySchema,
  energySourceMixResponseSchema,
  energyTopConsumersResponseSchema,
} from "@bms/shared/contracts";
import type {
  EnergyCentreSummary,
  EnergySourceMixPoint,
  EnergyTopConsumer,
} from "@bms/shared";

import { withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function fetchEnergySummary(
  window: string,
): Promise<EnergyCentreSummary> {
  const q = new URLSearchParams({ window });
  const res = await fetch(
    `${base}/api/v1/dashboard/energy/summary?${q}`,
    withAuth(),
  );
  if (!res.ok) {
    throw new Error(`energy summary ${res.status}`);
  }
  return checkResponse(energyCentreSummarySchema, await res.json(), "dashboard/energy/summary");
}

export async function fetchEnergySourceMix(
  window: string,
): Promise<{ points: EnergySourceMixPoint[] }> {
  const q = new URLSearchParams({ window });
  const res = await fetch(
    `${base}/api/v1/dashboard/energy/source-mix?${q}`,
    withAuth(),
  );
  if (!res.ok) {
    throw new Error(`energy source-mix ${res.status}`);
  }
  return checkResponse(energySourceMixResponseSchema, await res.json(), "dashboard/energy/source-mix");
}

export async function fetchEnergyTopConsumers(
  window: string,
  limit = 10,
): Promise<{ consumers: EnergyTopConsumer[] }> {
  const q = new URLSearchParams({ window, limit: String(limit) });
  const res = await fetch(
    `${base}/api/v1/dashboard/energy/top-consumers?${q}`,
    withAuth(),
  );
  if (!res.ok) {
    throw new Error(`energy top-consumers ${res.status}`);
  }
  return checkResponse(energyTopConsumersResponseSchema, await res.json(), "dashboard/energy/top-consumers");
}
