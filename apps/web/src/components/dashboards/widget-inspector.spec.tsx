import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { blankDashboardWidgetRow, type DashboardBuilderProblem, type DashboardWidgetRow } from "../../lib/dashboard-builder-form";
import { WidgetInspector } from "./widget-inspector";

/**
 * `F3.32` U5 — the inspector's plant mimic surface (ADR 0079, plan D8).
 *
 * Assertions live here; `widget-inspector.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 *
 * **Every absence sits beside a positive control on a `value_tile`**, which renders the same
 * field, so a hidden field is a decision about the mimic rather than a render that produced
 * nothing. Each `it()` carries one claim.
 *
 * A `value_tile` renders `PointPicker` and `MetricSourcePicker`, which read through `fetch`;
 * `stubFetch` answers every call with an empty list so no spec reaches the real API on :4000.
 */

export function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })),
  );
}

function renderInspector(
  row: DashboardWidgetRow,
  options: { problems?: DashboardBuilderProblem[]; onChange?: (patch: Partial<DashboardWidgetRow>) => void } = {},
): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WidgetInspector
        row={row}
        problems={options.problems ?? []}
        role="admin"
        organizationId="org-1"
        onChange={options.onChange ?? (() => {})}
        onRemove={() => {}}
      />
    </QueryClientProvider>,
  );
}

function mimicRow(): DashboardWidgetRow {
  return blankDashboardWidgetRow("mimic");
}

export function aValueTileShowsTheUnitField(): void {
  renderInspector(blankDashboardWidgetRow("value_tile"));
  expect(screen.queryByText("Unit", { exact: true })).not.toBeNull();
}

export function aMimicHidesTheUnitField(): void {
  renderInspector(mimicRow());
  expect(screen.queryByText("Unit", { exact: true })).toBeNull();
}

export function aValueTileShowsTheDecimalsField(): void {
  renderInspector(blankDashboardWidgetRow("value_tile"));
  expect(screen.queryByText("Decimals", { exact: true })).not.toBeNull();
}

export function aMimicHidesTheDecimalsField(): void {
  renderInspector(mimicRow());
  expect(screen.queryByText("Decimals", { exact: true })).toBeNull();
}

export function aValueTileShowsTheBoundPointsField(): void {
  renderInspector(blankDashboardWidgetRow("value_tile"));
  expect(screen.queryByText("Bound points", { exact: true })).not.toBeNull();
}

export function aMimicHidesTheBoundPointsField(): void {
  renderInspector(mimicRow());
  expect(screen.queryByText("Bound points", { exact: true })).toBeNull();
}

export function aValueTileHasNoPresetField(): void {
  renderInspector(blankDashboardWidgetRow("value_tile"));
  expect(screen.queryByText("Preset", { exact: true })).toBeNull();
}

export function aMimicShowsThePresetSelectOnItsPreset(): void {
  renderInspector(mimicRow());
  const select = screen.getByRole("combobox", { name: /^Preset/ }) as HTMLSelectElement;
  expect(select.value).toBe("water_train");
}

export function thePresetOptionReadsThePresetLabel(): void {
  renderInspector(mimicRow());
  expect(screen.getByRole("option", { name: "Water train" })).not.toBeNull();
}

export async function choosingAPresetWritesItToTheConfig(): Promise<void> {
  const onChange = vi.fn();
  const row = mimicRow();
  const unchosen: DashboardWidgetRow = { ...row, config: { ...row.config, mimicPreset: undefined } };
  renderInspector(unchosen, { onChange });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Preset/ }), "water_train");
  expect(onChange).toHaveBeenCalledWith({ config: { ...unchosen.config, mimicPreset: "water_train" } });
}

export function thePresetProblemRendersUnderThePreset(): void {
  const row = mimicRow();
  renderInspector(
    { ...row, config: { ...row.config, mimicPreset: undefined } },
    { problems: [{ widget: 0, field: "preset", message: "Choose which plant drawing this mimic shows." }] },
  );
  expect(screen.getByText("Choose which plant drawing this mimic shows.")).not.toBeNull();
}
