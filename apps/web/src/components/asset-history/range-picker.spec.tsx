import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { rangeToSearch, type HistoryRange } from "../../lib/asset-history-range";
import { RangePicker } from "./range-picker";

/** `F4.297` U5 — the range controls. Entry point: `range-picker.test.tsx` (pins `TZ`). */

const DEFAULT: HistoryRange = { range: "24h", compare: false, points: ["kw"], fn: "avg" };

/** A preset button sets that preset, and its URL form is `range=<key>`. */
export async function aPresetSetsTheRangeInTheUrl(): Promise<void> {
  const onChange = vi.fn();
  render(<RangePicker range={DEFAULT} zone="Asia/Kolkata" zoneLabel="Asia/Kolkata" onChange={onChange} />);
  await userEvent.click(screen.getByRole("button", { name: "7d" }));
  const next = onChange.mock.calls[0][0] as HistoryRange;
  expect(rangeToSearch(next).toString()).toBe("range=7d&points=kw");
}

/** The custom pair is read as wall time in the site zone, not the browser's. */
export async function aCustomPairIsReadInTheSiteZone(): Promise<void> {
  const onChange = vi.fn();
  render(<RangePicker range={DEFAULT} zone="Asia/Kolkata" zoneLabel="Asia/Kolkata" onChange={onChange} />);
  await userEvent.type(screen.getByLabelText("From"), "2026-10-31T00:00");
  await userEvent.type(screen.getByLabelText("To"), "2026-10-31T06:00");
  await userEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ range: "custom", from: "2026-10-30T18:30:00.000Z", to: "2026-10-31T00:30:00.000Z" }),
  );
}

/** The function select offers all four functions (owner answer Q3). */
export function theFunctionSelectOffersAllFour(): void {
  render(<RangePicker range={DEFAULT} zone="Etc/UTC" zoneLabel="UTC" onChange={vi.fn()} />);
  const options = Array.from((screen.getByLabelText("Bucket function") as HTMLSelectElement).options, (o) => o.value);
  expect(options).toEqual(["sum", "avg", "min", "max"]);
}
