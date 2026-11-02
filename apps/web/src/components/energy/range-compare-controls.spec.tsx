import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, vi } from "vitest";

import { type RangeCompareValue, RangeCompareControls } from "./range-compare-controls";

/**
 * `F4.302` U3 (ADR 0108 Amendment 4 item 3) — the range select, the custom
 * pickers and the compare toggle, on their own. Controlled: each claim reads
 * what the controls render for a value, or the value they hand to `onChange`.
 * The custom picker works in the view's zone (ADR 0108 Status ruling c) — the
 * entry file pins the browser to `America/St_Johns`, which no fixture uses.
 */

const BASE: RangeCompareValue = { range: "24h" };

function Harness(props: { initial: RangeCompareValue; timeZone: string | null; onChange?: (next: RangeCompareValue) => void }) {
  const [value, setValue] = useState(props.initial);
  return (
    <RangeCompareControls
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

export function offersTheSevenRangesInOrder(): void {
  render(<Harness initial={BASE} timeZone="UTC" />);
  const select = screen.getByLabelText("Range") as HTMLSelectElement;
  expect(Array.from(select.options).map((option) => option.value)).toEqual(["today", "24h", "7d", "30d", "this_month", "1y", "custom"]);
}

export function rendersNoPickerForAPreset(): void {
  render(<Harness initial={BASE} timeZone="Asia/Kolkata" />);
  expect(screen.queryByLabelText("From")).toBeNull();
  expect(screen.queryByLabelText("To")).toBeNull();
  // Positive pair: the controls did render.
  expect(screen.getByLabelText("Range")).toBeTruthy();
}

export async function customSeedsTheLast24HoursInTheViewsZone(): Promise<void> {
  const onChange = vi.fn();
  render(<Harness initial={BASE} timeZone="Asia/Kolkata" onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("Range"), "custom");
  expect(onChange).toHaveBeenLastCalledWith({ range: "custom", from: "2026-10-30T05:00:00.000Z", to: "2026-10-31T05:00:00.000Z" });
  // 05:00Z is 10:30 in India — the inputs show the view's zone, not the browser's.
  expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("2026-10-31T10:30");
  expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-10-30T10:30");
  expect(screen.getByText("Times in Asia/Kolkata")).toBeTruthy();
}

export function aTypedStartIsReadInTheViewsZone(): void {
  const onChange = vi.fn();
  const initial: RangeCompareValue = { range: "custom", from: "2026-10-29T00:00:00.000Z", to: "2026-10-30T00:00:00.000Z" };
  render(<Harness initial={initial} timeZone="Asia/Kolkata" onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-29T00:00" } });
  expect(onChange).toHaveBeenLastCalledWith({ ...initial, from: "2026-10-28T18:30:00.000Z" });
}

export function thePickersWaitWhileTheZoneIsNull(): void {
  const initial: RangeCompareValue = { range: "custom", from: "2026-10-29T00:00:00.000Z", to: "2026-10-30T00:00:00.000Z" };
  render(<Harness initial={initial} timeZone={null} />);
  expect((screen.getByLabelText("From") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("To") as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByText(/^Times in /)).toBeNull();
}

export async function choosingAPresetDropsTheInstants(): Promise<void> {
  const onChange = vi.fn();
  const initial: RangeCompareValue = { range: "custom", from: "2026-10-29T00:00:00.000Z", to: "2026-10-30T00:00:00.000Z" };
  render(<Harness initial={initial} timeZone="UTC" onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("Range"), "7d");
  const last = onChange.mock.calls.at(-1)?.[0] as RangeCompareValue;
  expect(last).toEqual({ range: "7d" });
  expect(Object.keys(last)).toEqual(["range"]);
}

export async function choosingAPresetKeepsTheCompareToggle(): Promise<void> {
  const onChange = vi.fn();
  render(<Harness initial={{ range: "24h", compare: "previous" }} timeZone="UTC" onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("Range"), "7d");
  expect(onChange).toHaveBeenLastCalledWith({ range: "7d", compare: "previous" });
}

export async function togglingCompareSetsAndClearsPrevious(): Promise<void> {
  const onChange = vi.fn();
  render(<Harness initial={BASE} timeZone="UTC" onChange={onChange} />);
  const box = screen.getByLabelText("Compare with previous period");
  await userEvent.click(box);
  expect(onChange).toHaveBeenLastCalledWith({ range: "24h", compare: "previous" });
  await userEvent.click(box);
  const last = onChange.mock.calls.at(-1)?.[0] as RangeCompareValue;
  expect(last).toEqual({ range: "24h" });
  expect("compare" in last).toBe(false);
}
