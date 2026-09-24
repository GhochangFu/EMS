import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { AlarmSeverityDto, VocabulariesResponse } from "@bms/shared";

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

function renderLegend(severities: AlarmSeverityDto[] = SEVERITIES): void {
  mocks.fetchVocabularies.mockImplementation(
    (): Promise<VocabulariesResponse> =>
      Promise.resolve({
        ruleCategories: [],
        assetDomains: [],
        alarmSeverities: severities,
        alarmSkills: [],
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
