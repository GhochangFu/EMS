import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { RtuDropHistoryResponse } from "@bms/shared";

import * as deviceHealthApi from "../../api/device-health";
import { RtuDropHistoryDrawer } from "./rtu-drop-history-drawer";

/**
 * `F3.16` / ADR 0127 decision 3 — one RTU's 30 days of hourly drop buckets.
 * Assertions live here; `rtu-drop-history-drawer.test.tsx` is the Vitest
 * entry point and carries the jsdom docblock (ADR 0014, ADR 0042 decision 2).
 */

const RTU = { id: "b0000000-0000-4000-8000-000000000001", code: "DR-1" };

const HISTORY: RtuDropHistoryResponse = {
  items: [
    {
      bucket: "2026-11-10T09:00:00.000Z",
      reason: "outOfRange",
      count: 4,
      first: { assetId: "a", assetCode: "CH-2", assetRtuName: null, assetLocationName: null, pointKey: "kw", sourceKey: "s1" },
    },
    {
      bucket: "2026-11-10T08:00:00.000Z",
      reason: "unmappedSourceKey",
      count: 11,
      first: { assetId: null, assetCode: null, assetRtuName: null, assetLocationName: null, pointKey: null, sourceKey: "<script>y</script>" },
    },
    { bucket: "2026-11-09T08:00:00.000Z", reason: "badQuality", count: 1, first: null },
  ],
};

function renderDrawer(history: RtuDropHistoryResponse, onClose = vi.fn()): typeof onClose {
  vi.spyOn(deviceHealthApi, "fetchRtuDropHistory").mockResolvedValue(history);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RtuDropHistoryDrawer rtu={RTU} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

/** D1 — the drawer loads that RTU's history and lists one row per bucket and reason. */
export async function theDrawerLoadsAndListsTheHistory(): Promise<void> {
  renderDrawer(HISTORY);
  const dialog = screen.getByRole("dialog", { name: "Drop history — DR-1" });
  expect(await within(dialog).findByText("CH-2 · kw")).toBeInTheDocument();
  expect(vi.mocked(deviceHealthApi.fetchRtuDropHistory)).toHaveBeenCalledWith(RTU.id);
  const rows = within(dialog).getAllByRole("row");
  // The header row and three buckets.
  expect(rows).toHaveLength(4);
  const second = within(rows[2] as HTMLElement);
  expect(second.getByText(new Date("2026-11-10T08:00:00.000Z").toLocaleString())).toBeInTheDocument();
  expect(second.getByText("Unmapped source key")).toBeInTheDocument();
  expect(second.getByText("11")).toBeInTheDocument();
  expect(second.getByText("<script>y</script>")).toBeInTheDocument();
  expect(dialog.querySelector("script")).toBeNull();
  expect(within(rows[3] as HTMLElement).getByText("—")).toBeInTheDocument();
}

/** D2 — an RTU with no drops says so. */
export async function anEmptyHistorySaysSo(): Promise<void> {
  renderDrawer({ items: [] });
  expect(await screen.findByText("No dropped readings in the last 30 days.")).toBeInTheDocument();
}

/** D3 — Close calls back. */
export async function closeCallsBack(): Promise<void> {
  const onClose = renderDrawer(HISTORY);
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
}
