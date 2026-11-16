import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import * as telemetryApi from "../../api/telemetry";
import { RawRecordsTable } from "./raw-records-table";

/** `F4.297` U5 — the raw records table. Entry point: `raw-records-table.test.tsx`. */

const TWO_ITEMS = [
  { time: "2026-10-31T06:00:00.000Z", deviceTime: null, value: 1, unit: "kW" },
  { time: "2026-10-31T05:59:00.000Z", deviceTime: "2026-10-31T05:58:30.000Z", value: 2, unit: "kW" },
];

function renderTable(items: { time: string; deviceTime: string | null; value: number; unit: string | null }[] = TWO_ITEMS): void {
  vi.spyOn(telemetryApi, "fetchPointRawRecords").mockResolvedValue({ pointRef: "ref", items, nextBefore: null });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RawRecordsTable pointRef="ref" pointKey="kw" zone="Etc/UTC" />
    </QueryClientProvider>,
  );
}

/** A null device time is "—"; a set one is its time (the positive beside it). */
export async function aNullDeviceTimeIsADash(): Promise<void> {
  renderTable();
  const rows = await screen.findAllByTestId("raw-record");
  expect(rows[0].children[1].textContent).toBe("—");
  expect(rows[1].children[1].textContent).toBe("31 Oct 2026, 05:58:30");
}

/** The last page (`nextBefore: null`) offers no "Load older". */
export async function theLastPageOffersNoLoadOlder(): Promise<void> {
  renderTable();
  await screen.findAllByTestId("raw-record");
  expect(screen.queryByRole("button", { name: "Load older" })).toBeNull();
}

/**
 * `F4.379` (the owner's AWS check, 2026-11-16) — a WBLDC cold room's value is an int16 × 0.1, so
 * the stored double carries a binary tail. The Value cell drops it as the Latest cell does
 * (`formatReading`) and keeps every real digit: 49.96 stays 49.96, 0.0125 stays 0.0125.
 */
export async function theValueCellDropsFloatNoiseAndKeepsRealDigits(): Promise<void> {
  const values = [0.3000000000000007, -6.3999999999999995, 1.0000000000000009, 49.96, 0.0125, Math.fround(12.3)];
  renderTable(
    values.map((value, i) => ({ time: new Date(Date.UTC(2026, 9, 31, 6, 0, 0) - i * 60_000).toISOString(), deviceTime: null, value, unit: "°C" })),
  );
  const rows = await screen.findAllByTestId("raw-record");
  expect(rows.map((row) => row.children[2].textContent)).toEqual(["0.3", "-6.4", "1", "49.96", "0.0125", "12.3"]);
}
