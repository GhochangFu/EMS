import { render, screen, within } from "@testing-library/react";
import { expect } from "vitest";

import type { MimicNodeDto } from "@bms/shared";

import { MimicPreviewInspector } from "./mimic-preview-inspector";
import { previewEntryFixture, previewReadingsFixture, previewResponseFixture } from "./mimic-preview-canvas.spec";

/**
 * `F4.308` T8 (ADR 0081 Amendment 2 decision 6, plan C13) — the preview's inspector: a selected
 * roled unit lists its bound asset (code and name), its shown points with their live values,
 * its state points with their state labels and its open-alarm count, or "No asset at this site".
 * A fan-out unit shows its first asset and the `+N` badge (owner ruling Q3 (a)).
 * `mimic-preview-inspector.test.tsx` is the Vitest entry.
 */

function nodeOf(key: string): MimicNodeDto {
  const node = previewEntryFixture().nodes.find((n) => n.key === key);
  if (node === undefined) throw new Error(`no node ${key}`);
  return node;
}

function renderInspector(selection: { label: string; node: MimicNodeDto | undefined } | null) {
  const entry = previewEntryFixture();
  render(
    <MimicPreviewInspector
      selection={selection}
      readings={previewReadingsFixture(entry)}
      stateMaps={previewResponseFixture().stateMaps}
    />,
  );
}

function rowsOf(listName: string): string[][] {
  return within(screen.getByRole("list", { name: listName }))
    .getAllByRole("listitem")
    .map((li) => [...li.querySelectorAll("span")].map((s) => s.textContent ?? ""));
}

/** I1 — the bound asset reads `code — name`. */
export function showsTheAssetsCodeAndName(): void {
  renderInspector({ label: "WTP", node: nodeOf("wtp") });
  expect(screen.getByText("WTR-WTP-01 — Water treatment plant")).toBeInTheDocument();
}

/** I2 — the shown points in the server's order, name or key, value and unit; no sample is "—". */
export function listsThePointsInOrderWithADash(): void {
  renderInspector({ label: "WTP", node: nodeOf("wtp") });
  expect(rowsOf("Points")).toEqual([
    ["Flow", "10 m3/h"],
    ["level", "—"],
    ["Pressure", "2.46 bar"],
  ]);
}

/** I3 — a state point reads its state map's label for the live value. */
export function listsTheStatePointsWithTheirStateLabel(): void {
  renderInspector({ label: "WTP", node: nodeOf("wtp") });
  expect(rowsOf("State points")).toEqual([["Breaker", "CLOSED"]]);
}

/** I4 — the open-alarm count. */
export function showsTheOpenAlarmCount(): void {
  renderInspector({ label: "WTP", node: nodeOf("wtp") });
  expect(screen.getByText("Open alarms: 2")).toBeInTheDocument();
}

/** I5 — a unit no member of the group carries reads "No asset at this site", and lists nothing. */
export function aUnitWithNoAssetReadsNoAssetAtThisSite(): void {
  renderInspector({ label: "RO", node: nodeOf("ro") });
  expect(screen.getByText("No asset at this site")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Points" })).toBeNull();
  expect(screen.queryByText(/Open alarms/)).toBeNull();
}

/** I5b — a roled unit the answer does not list reads the same. */
export function anUnlistedUnitReadsNoAssetAtThisSite(): void {
  renderInspector({ label: "RO", node: undefined });
  expect(screen.getByText("No asset at this site")).toBeInTheDocument();
}

/** I6 — a fan-out unit (3 members) shows its first asset and the `+2` badge. */
export function aFanOutUnitShowsTheBadge(): void {
  renderInspector({ label: "WTP", node: nodeOf("wtp") });
  expect(screen.getByText("+2")).toBeInTheDocument();
}

/** I6b — a single member shows no badge. */
export function aSingleMemberShowsNoBadge(): void {
  renderInspector({ label: "WTP", node: { ...nodeOf("wtp"), memberCount: 1 } });
  expect(screen.queryByText(/^\+\d+$/)).toBeNull();
}

/** I7 — the unit's label heads the inspector. */
export function theUnitsLabelHeadsTheInspector(): void {
  renderInspector({ label: "WTP", node: nodeOf("wtp") });
  expect(screen.getByRole("heading", { name: "WTP" })).toBeInTheDocument();
}

/** I8 — nothing selected: the prompt to select a unit. */
export function nothingSelectedPromptsASelection(): void {
  renderInspector(null);
  expect(screen.getByText("Select a unit to see its asset at this site.")).toBeInTheDocument();
}
