import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AlarmRootCauseSuggestionsResponse, RootCauseCandidate } from "@bms/shared/contracts";

import * as alarmsApi from "../api/alarms";
import { AlarmRootCauseSection } from "./alarm-root-cause-section";

/**
 * `E2.3` (ADR 0136 decision 6, plan §7 T2.3) — the "Possible causes — advisory" section.
 *
 * The section is advisory by construction: a word for strength (never a number), the ink and
 * neutral roles (never an alarm colour), and a "Use as root cause" button only where the panel
 * passes `onUse` — and never on the class cause (R5).
 */

const ALARM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECTION = "Possible causes — advisory";

const R1: RootCauseCandidate = {
  rule: "maintenance",
  strength: "strong",
  title: "Maintenance on this asset",
  quote: null,
  occurrences: null,
  evidence: [
    {
      kind: "maintenance_window",
      at: "2026-11-17T08:00:00.000Z",
      endedAt: "2026-11-17T09:50:00.000Z",
      alarmId: null,
      assetId: null,
      assetCode: null,
      assetRtuName: null,
      assetLocationName: null,
      label: null,
    },
  ],
};
const R3: RootCauseCandidate = {
  rule: "linked_alarm",
  strength: "moderate",
  title: 'Linked to "Low suction pressure"',
  quote: null,
  occurrences: null,
  evidence: [],
};
const R4: RootCauseCandidate = {
  rule: "recorded_before",
  strength: "weak",
  title: "Recorded before",
  quote: "Grease line cracked at the elbow.",
  occurrences: 1,
  evidence: [],
};
const R5: RootCauseCandidate = {
  rule: "class_cause",
  strength: "weak",
  title: "Class cause",
  quote: "Lubrication starvation or a failing bearing race.",
  occurrences: null,
  evidence: [],
};

function body(overrides: Partial<AlarmRootCauseSuggestionsResponse> = {}): AlarmRootCauseSuggestionsResponse {
  return { computedAt: "2026-11-17T10:00:00.000Z", candidates: [R1, R3, R4], context: [], ...overrides };
}

async function renderSection(
  answer: AlarmRootCauseSuggestionsResponse | Error,
  onUse?: (text: string) => void,
): Promise<HTMLElement> {
  if (answer instanceof Error) vi.spyOn(alarmsApi, "fetchRootCauseSuggestions").mockRejectedValue(answer);
  else vi.spyOn(alarmsApi, "fetchRootCauseSuggestions").mockResolvedValue(answer);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AlarmRootCauseSection alarmId={ALARM_ID} assetId={ASSET_ID} onUse={onUse} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const region = screen.getByRole("region", { name: SECTION });
  await waitFor(() => expect(within(region).queryByText("Looking for likely causes…")).toBeNull());
  return region;
}

/** The summary says advisory, the pill is the Anomalies page's, and the disclaimer is there. */
export async function showsThePillAndTheDisclaimer(): Promise<void> {
  const region = await renderSection(body());
  const section = within(region);
  expect(section.getByText(SECTION)).toBeInTheDocument();
  expect(region.querySelector("details")).toHaveAttribute("open");
  expect(section.getByText("Advisory")).toBeInTheDocument();
  expect(section.getByText("Suggestions from past records and live data. Not a diagnosis — check on site.")).toBeInTheDocument();
}

/** Each strength is a word, and nothing in the section prints a percentage. */
export async function showsTheStrengthWordsAndNoPercentage(): Promise<void> {
  const region = await renderSection(body());
  const section = within(region);
  for (const word of ["Strong", "Moderate", "Weak"]) expect(section.getByText(`Strength: ${word}`)).toBeInTheDocument();
  expect(region.textContent).not.toMatch(/\d\s*%/);
}

/** No candidate reads as one plain sentence. */
export async function showsTheEmptySentence(): Promise<void> {
  const region = await renderSection(body({ candidates: [] }));
  expect(within(region).getByText("No likely cause found in the data.")).toBeInTheDocument();
}

/** A failed read is one muted sentence, not an alert. */
export async function aFailedReadShowsTheFailedSentence(): Promise<void> {
  const region = await renderSection(new Error("alarms/:id/root-cause-suggestions 500"));
  const failed = within(region).getByText("Suggestions could not be loaded.");
  expect(failed).toHaveClass("text-ink-muted");
  expect(within(region).queryByRole("alert")).toBeNull();
}

/** The ink and neutral roles only: no element carries an alarm or severity colour. */
export async function usesNoAlarmOrSeverityColour(): Promise<void> {
  const region = await renderSection(body({ candidates: [R1, R4, R5] }), () => {});
  for (const node of [region, ...Array.from(region.querySelectorAll("*"))]) {
    const cls = node.getAttribute("class") ?? "";
    expect(cls, cls).not.toMatch(/critical|warning|severity|ok-/);
  }
}

/** With no `onUse` (a viewer, a read-only panel) there is no button. */
export async function withoutOnUseThereIsNoButton(): Promise<void> {
  const region = await renderSection(body());
  expect(within(region).queryAllByRole("button")).toHaveLength(0);
}

/** R5 has no button; R1–R4 beside it each have one, named by their heading. */
export async function theClassCauseHasNoButton(): Promise<void> {
  const region = await renderSection(body({ candidates: [R1, R4, R5] }), () => {});
  const names = within(region)
    .getAllByRole("button", { name: /^Use as root cause/ })
    .map((button) => button.getAttribute("aria-label"));
  expect(names).toEqual([
    "Use as root cause: Maintenance on this asset",
    'Use as root cause: Recorded before: "Grease line cracked at the elbow."',
  ]);
  expect(within(region).getByRole("link", { name: /knowledge base/i })).toHaveAttribute("href", "/alarm-kb");
}

/** A click hands the fill text to `onUse` once and makes no request. */
export async function aClickCallsOnUseOnceAndNoFetch(): Promise<void> {
  const onUse = vi.fn();
  const region = await renderSection(body({ candidates: [R4] }), onUse);
  const fetchSpy = vi.fn(() => Promise.reject(new Error("no fetch expected")));
  vi.stubGlobal("fetch", fetchSpy);
  await userEvent.click(within(region).getByRole("button", { name: /^Use as root cause/ }));
  expect(onUse.mock.calls).toEqual([["Grease line cracked at the elbow."]]);
  expect(fetchSpy).not.toHaveBeenCalled();
}

/** The context line links to the asset's history for its window, with its points charted. */
export async function theContextLineLinksToTheHistoryWindow(): Promise<void> {
  const region = await renderSection(
    body({
      context: [
        {
          kind: "anomaly",
          from: "2026-11-17T03:00:00.000Z",
          to: "2026-11-17T09:00:00.000Z",
          unusualHours: 2,
          detectors: ["baseline_mad"],
          contributingPoints: ["kw", "pf"],
        },
      ],
    }),
  );
  const link = within(region).getByRole("link", { name: /Readings on this asset were unusual/ });
  const href = new URL(link.getAttribute("href") ?? "", "http://x");
  expect(href.pathname).toBe(`/asset-history/${ASSET_ID}`);
  expect([href.searchParams.get("from"), href.searchParams.get("to"), href.searchParams.get("points")]).toEqual([
    "2026-11-17T03:00:00.000Z",
    "2026-11-17T09:00:00.000Z",
    "kw,pf",
  ]);
}

/** No context item, no context line. */
export async function noContextNoLine(): Promise<void> {
  const region = await renderSection(body());
  expect(within(region).queryByText(/Readings on this asset were unusual/)).toBeNull();
}
