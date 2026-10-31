import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import * as telemetryApi from "../../api/telemetry";
import { RawRecordsTable } from "./raw-records-table";

/** `F4.297` U5 — the raw records table. Entry point: `raw-records-table.test.tsx`. */

function renderTable(): void {
  vi.spyOn(telemetryApi, "fetchPointRawRecords").mockResolvedValue({
    pointRef: "ref",
    items: [
      { time: "2026-10-31T06:00:00.000Z", deviceTime: null, value: 1, unit: "kW" },
      { time: "2026-10-31T05:59:00.000Z", deviceTime: "2026-10-31T05:58:30.000Z", value: 2, unit: "kW" },
    ],
    nextBefore: null,
  });
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
