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

function renderList(points: AssetPointPickerRow[], selected: string[], onChange: (next: string[]) => void): void {
  vi.spyOn(telemetryApi, "fetchPointValuesAt").mockImplementation(async (refs) => ({
    at: "2026-10-31T06:20:00.000Z",
    items: refs.map((pointRef) => ({ pointRef, time: null, value: null, unit: null })),
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
