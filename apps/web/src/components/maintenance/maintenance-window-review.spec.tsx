import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";

import { localInputOf, localMinuteOf, localZoneLabel } from "../../lib/maintenance-window-time";
import { renderWizard, windowItem } from "./maintenance-window-wizards.spec";

/**
 * `F4.360` defects 4, 5 and 6 (AWS check, 2026-11-14) — the wizards' Review steps say times in the
 * browser's zone with its label and name the targets, never a raw ISO string or a JSON list; the
 * End and Cancel Review show the typed reason; every radio and checkbox has its own name and value.
 * Vitest entry point: the sibling `.test.tsx`, which pins `TZ=Asia/Kolkata`.
 */

const DAY = 24 * 60 * 60 * 1000;
/** An ISO date-time as `toISOString` writes it ("2026-11-13T08:00"), or a JSON target list. */
const RAW = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|"kind"|assetId/;
const reviewText = (dialog: HTMLElement): string => within(dialog).getByRole("table").textContent ?? "";
const next = async (dialog: HTMLElement): Promise<void> => userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
const local = (iso: string): string => `${localMinuteOf(iso)} (${localZoneLabel(new Date(iso))})`;
/** A local time as a pattern: its brackets and plus sign escaped. */
const pattern = (text: string): string => text.replace(/[()+]/g, "\\$&");

/** R1 — the create Review: no raw ISO or JSON anywhere; the times are local and labelled, the targets named. */
export async function theCreateReviewSaysLocalTimesAndNames(): Promise<void> {
  renderWizard({ kind: "create" });
  const dialog = screen.getByRole("dialog", { name: "Create maintenance window" });
  const end = localInputOf(new Date(Date.now() + DAY));
  await userEvent.type(within(dialog).getByLabelText("Reason"), "Pump overhaul");
  fireEvent.change(within(dialog).getByLabelText(`End (${localZoneLabel()})`), { target: { value: end } });
  await next(dialog);
  await userEvent.click(await within(dialog).findByLabelText("Asset Pump 1 (P-001)"));
  await next(dialog);
  await next(dialog);
  expect(dialog.textContent).not.toMatch(RAW);
  const endIso = new Date(end).toISOString();
  expect(reviewText(dialog)).toContain(`End${local(endIso)}`);
  expect(reviewText(dialog)).toContain("TargetsPump 1 (P-001)");
  expect(within(dialog).getByText(new RegExp(`to ${pattern(local(endIso))} on 1 target`))).toBeInTheDocument();
}

/** R2 — the extend Review: the current and the new end in local time, no raw ISO. */
export async function theExtendReviewSaysLocalTimes(): Promise<void> {
  const window = windowItem();
  renderWizard({ kind: "extend", window });
  const dialog = screen.getByRole("dialog", { name: "Extend maintenance window" });
  const end = localInputOf(new Date(Date.now() + 2 * DAY));
  fireEvent.change(within(dialog).getByLabelText(`New end (${localZoneLabel()})`, { selector: "input" }), { target: { value: end } });
  await next(dialog);
  expect(dialog.textContent).not.toMatch(RAW);
  expect(reviewText(dialog)).toContain(`End${local(window.endsAt)}${local(new Date(end).toISOString())}`);
}

/** How often `text` appears in the dialog's text. */
const timesIn = (dialog: HTMLElement, text: string): number => (dialog.textContent ?? "").split(text).length - 1;

/**
 * R3 — the End Review shows the typed reason (defect 6), and says when none was given. `F4.362` leftover 2: the
 * reason shows twice — the summary sentence and the Field table — never a third time in a line of its own.
 * Mutation: put the `Reason: "…"` line back → red.
 */
export async function theEndReviewShowsTheTypedReason(): Promise<void> {
  renderWizard({ kind: "end", window: windowItem() });
  const dialog = screen.getByRole("dialog", { name: "End maintenance window" });
  await userEvent.type(within(dialog).getByLabelText("Reason (optional)"), "Done early");
  await next(dialog);
  expect(timesIn(dialog, "Done early")).toBe(2);
  expect(reviewText(dialog)).toContain("ReasonDone early");
  expect(within(dialog).queryByText('Reason: "Done early"')).toBeNull();
  await userEvent.click(within(dialog).getByRole("button", { name: "Back" }));
  await userEvent.clear(within(dialog).getByLabelText("Reason (optional)"));
  await next(dialog);
  expect(within(dialog).getByText("No reason given.")).toBeInTheDocument();
}

/** R4 — the Cancel Review: the start in local time, no raw ISO, and the typed reason twice, not three times (`F4.362`). */
export async function theCancelReviewSaysLocalTimeAndTheReason(): Promise<void> {
  const window = windowItem({ state: "future", startsAt: new Date(Date.now() + DAY).toISOString(), endsAt: new Date(Date.now() + 2 * DAY).toISOString() });
  renderWizard({ kind: "cancel", window });
  const dialog = screen.getByRole("dialog", { name: "Cancel maintenance window" });
  await userEvent.type(within(dialog).getByLabelText("Reason (optional)"), "Postponed");
  await next(dialog);
  expect(dialog.textContent).not.toMatch(RAW);
  expect(within(dialog).getByText(new RegExp(`that starts at ${pattern(local(window.startsAt))}`))).toBeInTheDocument();
  expect(timesIn(dialog, "Postponed")).toBe(2);
  expect(reviewText(dialog)).toContain("ReasonPostponed");
}

/** R5 — each radio and target checkbox has its own accessible name and a value of its own, never the default "on". */
export async function theRadiosAndCheckboxesHaveNames(): Promise<void> {
  renderWizard({ kind: "create" });
  const dialog = screen.getByRole("dialog", { name: "Create maintenance window" });
  const now = within(dialog).getByRole("radio", { name: "Start now" });
  const atTime = within(dialog).getByRole("radio", { name: "Start at a time" });
  expect([now.getAttribute("value"), atTime.getAttribute("value")]).toEqual(["now", "at-a-time"]);
  await userEvent.type(within(dialog).getByLabelText("Reason"), "Pump overhaul");
  fireEvent.change(within(dialog).getByLabelText(`End (${localZoneLabel()})`), { target: { value: localInputOf(new Date(Date.now() + DAY)) } });
  await next(dialog);
  const asset = await within(dialog).findByRole("checkbox", { name: "Asset Pump 1 (P-001)" });
  const location = within(dialog).getByRole("checkbox", { name: "Location Lakwa plant" });
  const rule = within(dialog).getByRole("checkbox", { name: "Rule High pressure" });
  for (const box of [asset, location, rule]) expect(box.getAttribute("value")).not.toBe("on");
}
