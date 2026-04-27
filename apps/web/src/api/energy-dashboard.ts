import type {
  EnergyCentreSummary,
  EnergySourceMixPoint,
  EnergyTopConsumer,
} from "@bms/shared";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function fetchEnergySummary(
  window: string,
): Promise<EnergyCentreSummary> {
  const q = new URLSearchParams({ window });
  const res = await fetch(`${base}/api/v1/dashboard/energy/summary?${q}`);
  if (!res.ok) {
    throw new Error(`energy summary ${res.status}`);
  }
  return res.json() as Promise<EnergyCentreSummary>;
}

export async function fetchEnergySourceMix(
  window: string,
): Promise<{ points: EnergySourceMixPoint[] }> {
  const q = new URLSearchParams({ window });
  const res = await fetch(`${base}/api/v1/dashboard/energy/source-mix?${q}`);
  if (!res.ok) {
    throw new Error(`energy source-mix ${res.status}`);
  }
  return res.json() as Promise<{ points: EnergySourceMixPoint[] }>;
}

export async function fetchEnergyTopConsumers(
  window: string,
  limit = 10,
): Promise<{ consumers: EnergyTopConsumer[] }> {
  const q = new URLSearchParams({ window, limit: String(limit) });
  const res = await fetch(
    `${base}/api/v1/dashboard/energy/top-consumers?${q}`,
  );
  if (!res.ok) {
    throw new Error(`energy top-consumers ${res.status}`);
  }
  return res.json() as Promise<{ consumers: EnergyTopConsumer[] }>;
}
