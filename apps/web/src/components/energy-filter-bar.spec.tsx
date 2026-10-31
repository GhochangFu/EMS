import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, vi } from "vitest";

import type { EnergyFilterOptions } from "@bms/shared";

import type { EnergyFilterValue } from "../lib/energy-view-filter";
import { EnergyFilterBar } from "./energy-filter-bar";

/**
 * `F4.298` U5 (ADR 0108 decision 2) — the Energy page's filter bar.
 *
 * Controlled: every claim reads either what the bar renders for a value, or
 * the value it hands to `onChange`. The custom picker works in the view's zone
 * (ADR 0108 Status ruling c) — `typesACustomStartInTheViewsZone` passes
 * `Asia/Kolkata` while the wrapper pins the browser to `America/St_Johns`.
 */

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function options(organizationIds: readonly string[]): EnergyFilterOptions {
  return {
    organizations: organizationIds.map((id) => ({ id, code: id === ORG_A ? "ORGA" : "ORGB", name: id === ORG_A ? "Org A" : "Org B" })),
    locations: [
      { id: "loc-a1", name: "Plant A", parentId: null, organizationId: ORG_A },
      { id: "loc-a2", name: "Hall A", parentId: "loc-a1", organizationId: ORG_A },
      { id: "loc-b1", name: "Plant B", parentId: null, organizationId: ORG_B },
    ],
  };
}

const BASE_VALUE: EnergyFilterValue = { organizationId: ORG_A, locationIds: [], range: "24h" };

/** A stateful parent, so a change re-renders the bar the way the page will. */
function Harness(props: { options: EnergyFilterOptions; initial: EnergyFilterValue; timeZone: string | null; onChange?: (next: EnergyFilterValue) => void }) {
  const [value, setValue] = useState(props.initial);
  return (
    <EnergyFilterBar
      options={props.options}
      value={value}
      timeZone={props.timeZone}
      now={() => new Date("2026-10-31T05:00:30.000Z")}
      onChange={(next) => {
        props.onChange?.(next);
        setValue(next);
      }}
    />
  );
}

export function hidesTheOrganizationSelectForOneOrganization(): void {
  render(<Harness options={options([ORG_A])} initial={BASE_VALUE} timeZone="UTC" />);
  expect(screen.queryByLabelText("Organization")).toBeNull();
  // Positive pair: the bar did render, with its range control.
  expect(screen.getByLabelText("Range")).toBeTruthy();
}

export function offersAnOrganizationSelectForTwoOrganizations(): void {
  render(<Harness options={options([ORG_A, ORG_B])} initial={BASE_VALUE} timeZone="UTC" />);
  const select = screen.getByLabelText("Organization") as HTMLSelectElement;
  expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["ORGA · Org A", "ORGB · Org B"]);
  expect(select.value).toBe(ORG_A);
}

export function listsOnlyTheChosenOrganizationsTreeWithDepthLabels(): void {
  render(<Harness options={options([ORG_A, ORG_B])} initial={BASE_VALUE} timeZone="UTC" />);
  const select = screen.getByLabelText("Locations") as HTMLSelectElement;
  expect(select.multiple).toBe(true);
  expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["Plant A", "— Hall A"]);
}

export async function choosingAnotherOrganizationClearsTheLocations(): Promise<void> {
  const onChange = vi.fn();
  render(<Harness options={options([ORG_A, ORG_B])} initial={{ ...BASE_VALUE, locationIds: ["loc-a1"] }} timeZone="UTC" onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("Organization"), ORG_B);
  expect(onChange).toHaveBeenLastCalledWith({ organizationId: ORG_B, locationIds: [], range: "24h" });
  const locations = screen.getByLabelText("Locations") as HTMLSelectElement;
  expect(Array.from(locations.options).map((option) => option.textContent)).toEqual(["Plant B"]);
}

export async function pickingLocationsHandsTheirIdsToOnChange(): Promise<void> {
  const onChange = vi.fn();
  render(<Harness options={options([ORG_A])} initial={BASE_VALUE} timeZone="UTC" onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("Locations"), ["loc-a2"]);
  expect(onChange).toHaveBeenLastCalledWith({ ...BASE_VALUE, locationIds: ["loc-a2"] });
}

export function offersTheSevenRanges(): void {
  render(<Harness options={options([ORG_A])} initial={BASE_VALUE} timeZone="UTC" />);
  const select = screen.getByLabelText("Range") as HTMLSelectElement;
  expect(Array.from(select.options).map((option) => option.value)).toEqual(["today", "24h", "7d", "30d", "this_month", "1y", "custom"]);
}

export function rendersNoPickerForAPreset(): void {
  render(<Harness options={options([ORG_A])} initial={BASE_VALUE} timeZone="Asia/Kolkata" />);
  expect(screen.queryByLabelText("From")).toBeNull();
  expect(screen.queryByLabelText("To")).toBeNull();
}

/** Choosing custom renders two `datetime-local` inputs, seeded with the last 24 h in the view's zone. */
export async function choosingCustomRendersTwoPickersInTheViewsZone(): Promise<void> {
  const onChange = vi.fn();
  render(<Harness options={options([ORG_A])} initial={BASE_VALUE} timeZone="Asia/Kolkata" onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("Range"), "custom");
  const from = screen.getByLabelText("From") as HTMLInputElement;
  const to = screen.getByLabelText("To") as HTMLInputElement;
  expect(from.type).toBe("datetime-local");
  expect(to.type).toBe("datetime-local");
  expect(onChange).toHaveBeenLastCalledWith({
    ...BASE_VALUE,
    range: "custom",
    from: "2026-10-30T05:00:00.000Z",
    to: "2026-10-31T05:00:00.000Z",
  });
  // 05:00Z is 10:30 in India — the inputs show the view's zone, not the browser's.
  expect(to.value).toBe("2026-10-31T10:30");
  expect(from.value).toBe("2026-10-30T10:30");
  expect(screen.getByText("Times in Asia/Kolkata")).toBeTruthy();
}

export function typesACustomStartInTheViewsZone(): void {
  const onChange = vi.fn();
  const initial: EnergyFilterValue = { ...BASE_VALUE, range: "custom", from: "2026-10-29T00:00:00.000Z", to: "2026-10-30T00:00:00.000Z" };
  render(<Harness options={options([ORG_A])} initial={initial} timeZone="Asia/Kolkata" onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-29T00:00" } });
  expect(onChange).toHaveBeenLastCalledWith({ ...initial, from: "2026-10-28T18:30:00.000Z" });
}

/** Before the first view answers there is no zone to type in, so the pickers wait for it. */
export function disablesThePickersUntilTheViewNamesAZone(): void {
  const initial: EnergyFilterValue = { ...BASE_VALUE, range: "custom", from: "2026-10-29T00:00:00.000Z", to: "2026-10-30T00:00:00.000Z" };
  render(<Harness options={options([ORG_A])} initial={initial} timeZone={null} />);
  expect((screen.getByLabelText("From") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("To") as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByText(/^Times in /)).toBeNull();
}

export async function choosingAPresetDropsTheInstants(): Promise<void> {
  const onChange = vi.fn();
  const initial: EnergyFilterValue = { ...BASE_VALUE, range: "custom", from: "2026-10-29T00:00:00.000Z", to: "2026-10-30T00:00:00.000Z" };
  render(<Harness options={options([ORG_A])} initial={initial} timeZone="UTC" onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("Range"), "7d");
  expect(onChange).toHaveBeenLastCalledWith({ ...BASE_VALUE, range: "7d" });
}

export async function togglingCompareSetsAndClearsPrevious(): Promise<void> {
  const onChange = vi.fn();
  render(<Harness options={options([ORG_A])} initial={BASE_VALUE} timeZone="UTC" onChange={onChange} />);
  const box = within(screen.getByTestId("energy-filter-bar")).getByLabelText("Compare with previous period");
  await userEvent.click(box);
  expect(onChange).toHaveBeenLastCalledWith({ ...BASE_VALUE, compare: "previous" });
  await userEvent.click(box);
  expect(onChange).toHaveBeenLastCalledWith({ ...BASE_VALUE, compare: undefined });
}
