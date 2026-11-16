import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { AssetPointPickerRow } from "@bms/shared";

import * as telemetryApi from "../../api/telemetry";
import { PointList, thirdAxisSentence } from "./point-list";

/** `F4.297` U5 — the point list's selection rules. Entry point: `point-list.test.tsx`. */

const ASSET_ID = "11111111-1111-4111-8111-111111111111";

function point(pointKey: string, unit: string | null): AssetPointPickerRow {
  return { id: `p-${pointKey}`, assetId: ASSET_ID, assetName: "Chiller 1", pointKey, unit };
}

function renderList(
  points: AssetPointPickerRow[],
  selected: string[],
  onChange: (next: string[]) => void,
  value: number | null = null,
): void {
  vi.spyOn(telemetryApi, "fetchPointValuesAt").mockImplementation(async (refs) => ({
    at: "2026-10-31T06:20:00.000Z",
    items: refs.map((pointRef) => ({
      pointRef,
      time: value === null ? null : "2026-10-31T06:19:00.000Z",
      value,
      unit: null,
    })),
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PointList assetId={ASSET_ID} points={points} selected={selected} onChange={onChange} zone="Etc/UTC" />
    </QueryClientProvider>,
  );
}

/** Two units are charted: a point with a third unit is refused inline and the selection is unchanged. */
export async function aThirdUnitIsRefusedInline(): Promise<void> {
  const onChange = vi.fn();
  renderList([point("kw", "kW"), point("pf", null), point("temp", "°C")], ["kw", "pf"], onChange);
  await userEvent.click(screen.getByRole("checkbox", { name: "Chart temp" }));
  expect(screen.getByRole("status").textContent).toBe(thirdAxisSentence("°C"));
  expect(onChange).not.toHaveBeenCalled();
}

/** A point with a unit already on an axis is added (the positive beside the refusal). */
export async function aSecondPointOnAnExistingUnitIsAdded(): Promise<void> {
  const onChange = vi.fn();
  renderList([point("kw", "kW"), point("pf", null), point("kw2", "kW")], ["kw", "pf"], onChange);
  await userEvent.click(screen.getByRole("checkbox", { name: "Chart kw2" }));
  expect(onChange).toHaveBeenCalledWith(["kw", "pf", "kw2"]);
  expect(screen.queryByRole("status")).toBeNull();
}

/**
 * The Latest cell formats the reading like a dashboard tile (`formatWidgetValue`): a float's
 * binary tail never reaches the page. The AWS demo showed `1.2000000000000002 degC` (E1.4 demo
 * checks, 2026-11-16).
 */
export async function theLatestCellRoundsAFloatsBinaryTail(): Promise<void> {
  renderList([point("temp", "degC")], [], vi.fn(), 1.2000000000000002);
  const cell = await screen.findByText("1.2 degC");
  expect(cell.getAttribute("data-testid")).toBe("latest-value");
}

/** No reading is the dash, as before. */
export async function theLatestCellShowsADashWithoutAReading(): Promise<void> {
  renderList([point("temp", "degC")], [], vi.fn());
  expect((await screen.findByTestId("latest-value")).textContent).toBe("—");
}
