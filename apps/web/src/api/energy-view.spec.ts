import { expect, vi } from "vitest";

import { fetchEnergyFilterOptions, fetchEnergyView } from "./energy-view";

/**
 * `F4.298` U5 (ADR 0108 decision 2) — the two Energy view clients reach the
 * right URL and check the body against the contract. `node` environment, as
 * `asset-kpis.spec.ts`.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOC_1 = "11111111-1111-4111-8111-111111111111";
const LOC_2 = "22222222-2222-4222-8222-222222222222";

const PERIOD = {
  from: "2026-10-30T00:00:00.000Z",
  to: "2026-10-30T23:59:59.999Z",
  durationHours: 24,
  hasData: true,
  totalKwh: 100,
  peakKw: 40,
  peakAt: "2026-10-30T12:00:00.000Z",
  avgPf: 0.9,
  pueEstimate: null,
  indicativeCost: null,
  tariffPerKwh: null,
  currency: null,
  sourceTotals: { gridKwh: 100, solarKwh: 0, dgKwh: 0 },
  series: [],
};

const VIEW = {
  organizationId: ORG,
  timeZone: "Asia/Kolkata",
  generatedAt: "2026-10-31T00:00:00.000Z",
  level: "5m",
  bucket: "5m",
  current: PERIOD,
  compare: null,
  topConsumers: [],
  partial: null,
};

function stubFetch(body: unknown, status = 200): () => string {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify(body), { status });
  });
  return () => seen;
}

/** One `locationIds` per id (the server folds the repeats), and no key for an absent value. */
export async function fetchesTheViewWithARepeatedLocationKey(): Promise<void> {
  const seen = stubFetch(VIEW);
  const view = await fetchEnergyView({ range: "24h", organizationId: ORG, locationIds: [LOC_1, LOC_2], compare: "previous" });
  expect(seen()).toBe(
    `${BASE}/api/v1/reports/energy/view?range=24h&organizationId=${ORG}&locationIds=${LOC_1}&locationIds=${LOC_2}&compare=previous`,
  );
  expect(view.timeZone).toBe("Asia/Kolkata");
}

export async function fetchesACustomViewWithBothInstants(): Promise<void> {
  const seen = stubFetch(VIEW);
  await fetchEnergyView({ range: "custom", organizationId: ORG, from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" });
  const url = new URL(seen());
  expect(url.pathname).toBe("/api/v1/reports/energy/view");
  expect([...url.searchParams.keys()]).toEqual(["range", "organizationId", "from", "to"]);
  expect(url.searchParams.get("from")).toBe("2026-10-01T00:00:00.000Z");
}

export async function refusesAViewOutsideTheContract(): Promise<void> {
  stubFetch({ ...VIEW, level: "15m" });
  await expect(fetchEnergyView({ range: "24h", organizationId: ORG })).rejects.toThrow();
}

export async function throwsOnANonOkView(): Promise<void> {
  stubFetch({ message: "Forbidden" }, 403);
  await expect(fetchEnergyView({ range: "24h", organizationId: ORG })).rejects.toThrow(/403/);
}

export async function fetchesTheFilterOptions(): Promise<void> {
  const seen = stubFetch({ organizations: [{ id: ORG, code: "A", name: "Org A" }], locations: [] });
  const options = await fetchEnergyFilterOptions();
  expect(seen()).toBe(`${BASE}/api/v1/reports/energy/filter-options`);
  expect(options.organizations[0]?.id).toBe(ORG);
}

export async function throwsOnANonOkFilterOptions(): Promise<void> {
  stubFetch({ message: "Forbidden" }, 403);
  await expect(fetchEnergyFilterOptions()).rejects.toThrow(/403/);
}
