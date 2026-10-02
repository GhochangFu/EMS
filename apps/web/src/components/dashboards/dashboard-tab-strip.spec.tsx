import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect } from "vitest";

import type { SiteWidgetTab } from "@bms/shared";

import type { TabMarkers } from "../../hooks/use-tab-markers";
import type { TabWritePayload } from "../../lib/dashboard-builder-form";
import { DashboardTabStrip } from "./dashboard-tab-strip";

/**
 * `F3.73` critique fix — the dashboard tab strip is one ARIA tabs pattern: a `tablist` of `tab`
 * buttons with a roving tabindex, ArrowLeft / ArrowRight / Home / End, and a `tabpanel` each tab
 * controls. The critique found `role="tablist"` on a `<nav>` with no panel and no arrow keys.
 * `dashboard-tab-strip.test.tsx` is the Vitest entry point.
 */

const TABS: TabWritePayload[] = [
  { key: "overview", label: "Overview", sortOrder: 0, assetGroupId: null },
  { key: "electrical", label: "Electrical", sortOrder: 1, assetGroupId: null },
  { key: "hvac", label: "HVAC", sortOrder: 2, assetGroupId: null },
];

function Harness({ initial = "overview" }: { initial?: string }) {
  const [selected, setSelected] = useState(initial);
  return (
    <DashboardTabStrip tabs={TABS} selectedKey={selected} onSelect={setSelected}>
      <p>Panel of {selected}</p>
    </DashboardTabStrip>
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });

/** Only the selected tab is in the tab order. Mutation: give every tab `tabIndex={0}` => red. */
export function onlyTheSelectedTabIsInTheTabOrder(): void {
  render(<Harness initial="electrical" />);
  expect(TABS.map((t) => tab(t.label).tabIndex)).toEqual([-1, 0, -1]);
}

/** ArrowRight selects and focuses the next tab. Mutation: drop the ArrowRight case => red. */
export async function arrowRightSelectsAndFocusesTheNextTab(): Promise<void> {
  render(<Harness />);
  tab("Overview").focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(tab("Electrical")).toHaveAttribute("aria-selected", "true");
  expect(tab("Electrical")).toHaveFocus();
}

/** ArrowLeft on the first tab wraps to the last. Mutation: drop the wrap (clamp at 0) => red. */
export async function arrowLeftOnTheFirstTabWrapsToTheLast(): Promise<void> {
  render(<Harness />);
  tab("Overview").focus();
  await userEvent.keyboard("{ArrowLeft}");
  expect(tab("HVAC")).toHaveAttribute("aria-selected", "true");
  expect(tab("HVAC")).toHaveFocus();
}

/** Home selects the first tab. Mutation: drop the Home case => red. */
export async function homeSelectsTheFirstTab(): Promise<void> {
  render(<Harness initial="hvac" />);
  tab("HVAC").focus();
  await userEvent.keyboard("{Home}");
  expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
  expect(tab("Overview")).toHaveFocus();
}

/** End selects the last tab. Mutation: drop the End case => red. */
export async function endSelectsTheLastTab(): Promise<void> {
  render(<Harness />);
  tab("Overview").focus();
  await userEvent.keyboard("{End}");
  expect(tab("HVAC")).toHaveAttribute("aria-selected", "true");
  expect(tab("HVAC")).toHaveFocus();
}

/** Every tab controls the panel, and the panel is labelled by the selected tab and holds the
 * children. Mutation: drop `aria-controls` => red. */
export function everyTabControlsTheLabelledPanel(): void {
  render(<Harness initial="electrical" />);
  const panel = screen.getByRole("tabpanel");
  expect(panel).toHaveTextContent("Panel of electrical");
  expect(TABS.map((t) => tab(t.label).getAttribute("aria-controls"))).toEqual([panel.id, panel.id, panel.id]);
  expect(panel).toHaveAttribute("aria-labelledby", tab("Electrical").id);
}

/** The tablist is a plain container, not a `<nav>` landmark overridden into a tablist. */
export function theTablistIsNotANavLandmark(): void {
  render(<Harness />);
  const list = screen.getByRole("tablist", { name: "Dashboard tabs" });
  expect(list.tagName).toBe("DIV");
}

/**
 * `F3.77` (plan D4) — the markers the hosts pass: HVAC readable with two warnings, Electrical
 * outside the caller's scope, the Overview absent (it is no group tab, so `tabs[]` never lists it).
 */
const MARKERS: TabMarkers = {
  byTab: new Map<string, SiteWidgetTab>([
    [
      "hvac",
      {
        tabKey: "hvac",
        label: "HVAC",
        assetGroupId: null,
        status: { worstSeverity: "warning", tone: "warning", activeAlarms: 2, offlineAssets: 0, assets: 4 },
      },
    ],
    ["electrical", { tabKey: "electrical", label: "Electrical", assetGroupId: null, status: null }],
  ]),
  severities: [{ code: "warning", label: "Warning", tone: "warning", rank: 20, active: true }],
};

function renderMarked(): void {
  render(
    <DashboardTabStrip tabs={TABS} selectedKey="overview" onSelect={() => undefined} markers={MARKERS}>
      <p>Panel</p>
    </DashboardTabStrip>,
  );
}

/** A marked tab's accessible name is the composed one, and it shows the count. */
export function aMarkedTabIsNamedByItsStatus(): void {
  renderMarked();
  const hvac = screen.getByRole("tab", { name: "HVAC, Warning, 2 alarms" });
  expect(hvac).toHaveTextContent("2 alarms");
}

/** A tab outside the caller's scope says so — never a zero. */
export function aTabOutsideScopeSaysSo(): void {
  renderMarked();
  const electrical = screen.getByRole("tab", { name: "Electrical, Outside scope" });
  expect(electrical).toHaveTextContent("Outside scope");
  expect(electrical.textContent).not.toMatch(/\d/);
}

/** A tab absent from the markers (the Overview) keeps its label as its name and draws no marker.
 * Mutation: mark every tab (a missing entry read as outside scope) => red. */
export function anUnmarkedTabKeepsItsLabel(): void {
  renderMarked();
  const overview = screen.getByRole("tab", { name: "Overview" });
  expect(overview).not.toHaveAttribute("aria-label");
  expect(overview.textContent).toBe("Overview");
}

/** A tab draws the project's `--focus` outline on keyboard focus (an outline, not a ring: the
 * selected tab's pressed `box-shadow` would compete with a ring). Mutation: drop the class => red. */
export function aTabDrawsTheFocusOutline(): void {
  render(<Harness />);
  expect(tab("Electrical").className).toContain("focus-visible:outline-focus");
}
