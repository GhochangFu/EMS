import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { AlarmSeverityDto, SwitchingStateDto, VocabulariesResponse } from "@bms/shared";

import { StateLegend } from "./state-legend";

/**
 * `F3.28` task 3.4 — the `/cr-overview` state legend.
 *
 * The vocabulary fetch is replaced by a `vi.fn`, matching
 * `active-alarms-rail.spec.tsx`'s harness — the same module, the same key.
 */

const mocks = vi.hoisted(() => ({
  fetchVocabularies: vi.fn(),
}));

vi.mock("../../api/vocabularies", () => ({
  vocabulariesQueryKey: ["vocabularies"],
  fetchVocabularies: mocks.fetchVocabularies,
}));

/** Out of rank order on purpose — `[critical 30, info 10, warning 20, high 25]`, the plan's spec input. */
const SEVERITIES: AlarmSeverityDto[] = [
  { code: "critical", label: "Critical", tone: "critical", rank: 30, active: true },
  { code: "info", label: "Info", tone: "info", rank: 10, active: true },
  { code: "warning", label: "Warning", tone: "warning", rank: 20, active: true },
  { code: "high", label: "High", tone: "warning", rank: 25, active: true },
];

function renderLegend(
  severities: AlarmSeverityDto[] = SEVERITIES,
  switchingStates: SwitchingStateDto[] = [],
): void {
  mocks.fetchVocabularies.mockImplementation(
    (): Promise<VocabulariesResponse> =>
      Promise.resolve({
        ruleCategories: [],
        assetDomains: [],
        alarmSeverities: severities,
        alarmSkills: [],
        switchingStates,
      } as unknown as VocabulariesResponse),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StateLegend />
    </QueryClientProvider>,
  );
}

/**
 * Each `StatusPill` is one direct child of the legend `div`, an outer `span`
 * whose only text is the label — the dot beside it is an empty `span`. Direct
 * children in DOM order therefore give the legend's order without depending
 * on any particular pill markup beyond that.
 */
async function legendLabels(): Promise<string[]> {
  const legend = await screen.findByLabelText("State legend");
  // Normal and Offline render at once; the vocabulary read settles after —
  // wait for a severity pill so a slow query cannot read as "no severities".
  await waitFor(() => expect(legend.children.length).toBeGreaterThan(2));
  return Array.from(legend.children).map((child) => child.textContent ?? "");
}

/**
 * Normal first, then the severities by rank ascending, then Offline last —
 * no Standby.
 */
export async function rendersInRankOrderWithNormalFirstAndOfflineLast(): Promise<void> {
  renderLegend();
  const labels = await legendLabels();
  expect(labels).toEqual(["Normal", "Info", "Warning", "High", "Critical", "Offline"]);
}

/** There is no Standby pill anywhere in the legend. */
export async function rendersNoStandbyPill(): Promise<void> {
  renderLegend();
  await legendLabels();
  expect(screen.queryByText("Standby")).not.toBeInTheDocument();
}

/**
 * An inactive severity ("Minor", rank 15) renders no pill. One claim: Minor
 * absent and High, an active severity in the same render, present — so a
 * legend that rendered no severity at all could not pass.
 */
export async function omitsAnInactiveSeverity(): Promise<void> {
  renderLegend([
    ...SEVERITIES,
    { code: "minor", label: "Minor", tone: "info", rank: 15, active: false },
  ]);
  const labels = await legendLabels();
  expect([labels.includes("Minor"), labels.includes("High")]).toEqual([false, true]);
}

// ---------------------------------------------------------------------------
// `F4.309` T10 (ADR 0088 Amendment 3 decision 5, plan C16) — the switching states.
// ---------------------------------------------------------------------------

/**
 * The seven seeded rows plus two admin rows, out of every order on purpose: the valve and the
 * damper repeat `(OPEN, flowing)` and `(CLOSED, shut)`, `EARTHED` shares the `open` tone with
 * `OPEN` and sorts before it, and one label is markup, which must render as its own text.
 */
const SWITCHING: SwitchingStateDto[] = [
  { pointKey: "valve_open", value: 0, label: "CLOSED", tone: "shut" },
  { pointKey: "breaker_trip", value: 1, label: "TRIPPED", tone: "tripped" },
  { pointKey: "damper_open", value: 1, label: "OPEN", tone: "flowing" },
  { pointKey: "breaker_main", value: 0, label: "OPEN", tone: "open" },
  { pointKey: "valve_open", value: 1, label: "OPEN", tone: "flowing" },
  { pointKey: "breaker_main", value: 1, label: "CLOSED", tone: "closed" },
  { pointKey: "damper_open", value: 0, label: "CLOSED", tone: "shut" },
  { pointKey: "isolator_pos", value: 2, label: "EARTHED", tone: "open" },
  { pointKey: "isolator_pos", value: 3, label: "<b>TEST</b>", tone: "tripped" },
];

/** The switching group's entries, as `[label, data-breaker-state]`, in DOM order. */
async function switchingEntries(): Promise<[string, string | null][]> {
  const group = await screen.findByRole("group", { name: "Switching states" });
  return Array.from(group.children).map((child) => [
    child.textContent ?? "",
    child.querySelector("[data-breaker-state]")?.getAttribute("data-breaker-state") ?? null,
  ]);
}

/**
 * Each distinct `(label, tone)` once, in tone order (`pointKeyStateToneSchema.options`: closed,
 * open, tripped, flowing, shut), then by label, each drawing the switch in its tone.
 */
export async function listsEachSwitchingStateOnceInToneThenLabelOrder(): Promise<void> {
  renderLegend(SEVERITIES, SWITCHING);
  expect(await switchingEntries()).toEqual([
    ["CLOSED", "closed"],
    ["EARTHED", "open"],
    ["OPEN", "open"],
    ["<b>TEST</b>", "tripped"],
    ["TRIPPED", "tripped"],
    ["OPEN", "flowing"],
    ["CLOSED", "shut"],
  ]);
}

/** Each entry draws the mimic's switch (`BreakerSwitch`), hidden from a screen reader; the label names it. */
export async function eachEntryDrawsTheMimicSwitchGlyph(): Promise<void> {
  renderLegend(SEVERITIES, SWITCHING);
  const group = await screen.findByRole("group", { name: "Switching states" });
  const switches = group.querySelectorAll('[data-testid="mimic-breaker-switch"]');
  expect(switches).toHaveLength(group.children.length);
  for (const glyph of Array.from(switches)) {
    expect(glyph.closest('[aria-hidden="true"]')).not.toBeNull();
  }
}

/** A label is text, never markup: `<b>TEST</b>` shows as written and adds no `<b>`. */
export async function rendersALabelAsPlainText(): Promise<void> {
  renderLegend(SEVERITIES, SWITCHING);
  const group = await screen.findByRole("group", { name: "Switching states" });
  expect(within(group).getByText("<b>TEST</b>")).toBeInTheDocument();
  expect(group.querySelector("b")).toBeNull();
}

/** The "State legend" group is unchanged beside the switching states: the same pills, the same order. */
export async function keepsTheStateLegendGroupUnchangedBesideThem(): Promise<void> {
  renderLegend(SEVERITIES, SWITCHING);
  await switchingEntries();
  expect(await legendLabels()).toEqual(["Normal", "Info", "Warning", "High", "Critical", "Offline"]);
}

/** No switching state → no group. The severities are the positive control that the read settled. */
export async function drawsNoSwitchingGroupWhenThereAreNone(): Promise<void> {
  renderLegend(SEVERITIES, []);
  await legendLabels();
  expect(screen.queryByRole("group", { name: "Switching states" })).toBeNull();
  expect(screen.queryByLabelText("Switching states")).toBeNull();
}
