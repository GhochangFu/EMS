import { expect, vi } from "vitest";

import { fetchEnergyBill } from "./energy-bill";

/** `F4.365` U10 — the energy-bill client reaches the right URL and checks the body. `node` environment. */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const LOC = "11111111-1111-4111-8111-111111111111";

const UNBILLED = {
  locationId: LOC,
  month: "2026-10",
  timeZone: "Asia/Kolkata",
  from: "2026-09-30T18:30:00.000Z",
  to: "2026-10-31T18:30:00.000Z",
  complete: true,
  currency: "INR",
  reason: "no_mapping",
  dataStatus: null,
  tariff: null,
  mapping: null,
  bill: null,
};

function stubFetch(body: unknown, status = 200): () => string {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify(body), { status });
  });
  return () => seen;
}

export async function fetchesTheBillWithAMonth(): Promise<void> {
  const seen = stubFetch(UNBILLED);
  const bill = await fetchEnergyBill(LOC, "2026-10");
  expect(seen()).toBe(`${BASE}/api/v1/locations/${LOC}/energy-bill?month=2026-10`);
  expect(bill.reason).toBe("no_mapping");
}

export async function sendsNoMonthKeyWhenAbsent(): Promise<void> {
  const seen = stubFetch(UNBILLED);
  await fetchEnergyBill(LOC);
  expect(seen()).toBe(`${BASE}/api/v1/locations/${LOC}/energy-bill`);
}

export async function refusesABillOutsideTheContract(): Promise<void> {
  stubFetch({ ...UNBILLED, reason: "something_else" });
  await expect(fetchEnergyBill(LOC)).rejects.toThrow();
}

export async function throwsOnANonOkBill(): Promise<void> {
  stubFetch({ message: "no" }, 400);
  await expect(fetchEnergyBill(LOC, "2030-01")).rejects.toThrow("locations/energy-bill 400");
}
