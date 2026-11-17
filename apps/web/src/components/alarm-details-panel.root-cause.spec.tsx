import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, type MockInstance, vi } from "vitest";

import type { AlarmDetailsResponse } from "@bms/shared";
import type { AlarmRootCauseSuggestionsResponse, RootCauseCandidate } from "@bms/shared/contracts";

import * as alarmsApi from "../api/alarms";
import * as assetsApi from "../api/assets";
import * as vocabApi from "../api/vocabularies";
import { AlarmDetailsPanel } from "./alarm-details-panel";

/**
 * `E2.3` (ADR 0136 decision 6, §17 Q5; plan §7 T2.4) — "Use as root cause" on the Alarm
 * Details panel. The button fills the enrichment wizard's `rootCause` only, wherever the wizard
 * stands, and sends nothing: the operator still submits. Existing text is never replaced
 * without asking (R-k), and a fill marks the wizard changed (R-l).
 */

const ALARM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECTION = "Possible causes — advisory";
const SUGGESTION = "Grease line cracked at the elbow.";
const STATUS =
  "Root cause filled from a suggestion (step 1, Analysis). Nothing is saved until you press Submit.";
const QUESTION = "The root cause field already has text. Replace it with this suggestion?";

const R4: RootCauseCandidate = {
  rule: "recorded_before",
  strength: "moderate",
  title: "Recorded before",
  quote: SUGGESTION,
  occurrences: 2,
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
const SUGGESTIONS: AlarmRootCauseSuggestionsResponse = {
  computedAt: "2026-11-17T10:00:00.000Z",
  candidates: [R4, R5],
  context: [],
};

function details(overrides: Partial<AlarmDetailsResponse> = {}): AlarmDetailsResponse {
  return {
    id: ALARM_ID,
    assetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    organizationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    source: "rule",
    rtuId: null,
    rtuCode: null,
    assetCode: "PMP-01",
    assetRtuName: "RTU 1",
    assetLocationName: "Plant A",
    assetName: "Raw water pump 1",
    assetDomain: "water",
    locationName: "Plant A",
    siteName: "Site A",
    severity: "warning",
    message: "Bearing temperature above 85 C",
    raisedAt: "2026-11-17T09:00:00.000Z",
    acknowledgedAt: null,
    acknowledgedBy: null,
    clearedAt: null,
    ruleId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    rulePointKey: null,
    thresholdOperator: "gte",
    thresholdValue: 85,
    currentValue: 91,
    currentValueUnit: "C",
    currentValueAt: "2026-11-17T09:01:00.000Z",
    enrichment: null,
    classPhilosophy: {
      templateId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      templateVersion: 3,
      templateName: "Centrifugal pump",
      alarmCode: "BEARING_TEMP_HIGH",
      cause: "Lubrication starvation or a failing bearing race.",
      impact: null,
      action: null,
      skillCode: null,
      skillLabel: null,
    },
    ...overrides,
  };
}

const ENRICHMENT: NonNullable<AlarmDetailsResponse["enrichment"]> = {
  rootCause: "Operator's own note.",
  impact: null,
  correctiveActions: null,
  energyImpact: null,
  waterImpact: null,
  productionImpact: null,
  etrAt: null,
  skillCode: null,
  updatedBy: null,
  updatedAt: "2026-11-17T09:30:00.000Z",
  affectedAssets: [],
};

async function renderPanel(
  payload: AlarmDetailsResponse,
  opts: { readOnly?: boolean; suggestions?: AlarmRootCauseSuggestionsResponse | Error } = {},
): Promise<{ suggestions: MockInstance; save: MockInstance; fetch: MockInstance }> {
  const answer = opts.suggestions ?? SUGGESTIONS;
  const suggestions = vi.spyOn(alarmsApi, "fetchRootCauseSuggestions");
  if (answer instanceof Error) suggestions.mockRejectedValue(answer);
  else suggestions.mockResolvedValue(answer);
  const save = vi.spyOn(alarmsApi, "saveAlarmEnrichment").mockResolvedValue(payload);
  vi.spyOn(alarmsApi, "fetchAlarmDetails").mockResolvedValue(payload);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({
    alarmSeverities: [{ code: "warning", label: "Warning", tone: "warning", rank: 20, active: true }],
    alarmSkills: [],
    ruleCategories: [],
    assetDomains: [],
    assetRoles: [],
  } as unknown as Awaited<ReturnType<typeof vocabApi.fetchVocabularies>>);
  // Every read above is stubbed, so any request that reaches `fetch` is one the panel made itself.
  const fetchSpy = vi.fn(() => Promise.reject(new Error("no fetch expected")));
  vi.stubGlobal("fetch", fetchSpy);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AlarmDetailsPanel alarmId={ALARM_ID} readOnly={opts.readOnly ?? false} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText(payload.message)).toBeTruthy());
  return { suggestions, save, fetch: fetchSpy };
}

const rootCauseBox = (): HTMLTextAreaElement => screen.getByLabelText("Root cause") as HTMLTextAreaElement;
const useButton = (): Promise<HTMLElement> => screen.findByRole("button", { name: /^Use as root cause/ });

async function toReviewAndSubmit(): Promise<void> {
  for (let step = 0; step < 3; step += 1) await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
}

/** The section sits between the class philosophy and the enrichment form. */
export async function theSectionSitsBetweenTheClassBlockAndTheForm(): Promise<void> {
  await renderPanel(details());
  const order = [
    screen.getByRole("region", { name: "Class philosophy" }),
    await screen.findByRole("region", { name: SECTION }),
    rootCauseBox(),
  ];
  expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

/** A click fills the Root cause box with the suggestion; nothing is saved and nothing is sent. */
export async function aClickFillsTheRootCauseAndSendsNothing(): Promise<void> {
  const spies = await renderPanel(details());
  await userEvent.click(await useButton());
  expect(rootCauseBox().value).toBe(SUGGESTION);
  expect(spies.save).not.toHaveBeenCalled();
  expect(spies.fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent(STATUS);
}

/** Submit sends the suggestion as `rootCause`, and every other field as it was. */
export async function submitSendsTheFilledRootCauseOnly(): Promise<void> {
  const spies = await renderPanel(details());
  await userEvent.click(await useButton());
  await toReviewAndSubmit();
  await waitFor(() => expect(spies.save).toHaveBeenCalledTimes(1));
  expect(spies.save.mock.calls[0]).toEqual([
    ALARM_ID,
    {
      rootCause: SUGGESTION,
      impact: null,
      correctiveActions: null,
      energyImpact: null,
      waterImpact: null,
      productionImpact: null,
      etrAt: null,
      skillCode: null,
      affectedAssetIds: [],
    },
  ]);
}

/** The filled text stays editable: what the operator types after the fill is what Submit sends. */
export async function theFilledTextStaysEditable(): Promise<void> {
  const spies = await renderPanel(details());
  await userEvent.click(await useButton());
  await userEvent.type(rootCauseBox(), " Checked on site.");
  await toReviewAndSubmit();
  await waitFor(() => expect(spies.save).toHaveBeenCalledTimes(1));
  expect((spies.save.mock.calls[0]?.[1] as { rootCause: unknown }).rootCause).toBe(`${SUGGESTION} Checked on site.`);
}

/** Saved text: the click asks and changes nothing; Keep leaves it; Replace sets exactly the suggestion. */
export async function savedTextAsksBeforeReplacing(): Promise<void> {
  await renderPanel(details({ enrichment: ENRICHMENT }));
  await userEvent.click(await useButton());
  const question = screen.getByRole("alertdialog");
  expect(question).toHaveTextContent(QUESTION);
  expect(rootCauseBox().value).toBe("Operator's own note.");

  await userEvent.click(within(question).getByRole("button", { name: "Keep current text" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(rootCauseBox().value).toBe("Operator's own note.");

  await userEvent.click(await useButton());
  await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Replace" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(rootCauseBox().value).toBe(SUGGESTION);
}

/** Typed text asks too, and Replace never appends. */
export async function typedTextAsksBeforeReplacing(): Promise<void> {
  await renderPanel(details());
  await userEvent.type(rootCauseBox(), "Typed by hand");
  await userEvent.click(await useButton());
  expect(screen.getByRole("alertdialog")).toHaveTextContent(QUESTION);
  expect(rootCauseBox().value).toBe("Typed by hand");
  await userEvent.click(screen.getByRole("button", { name: "Replace" }));
  expect(rootCauseBox().value).toBe(SUGGESTION);
}

/** The same text again asks nothing. */
export async function theSameTextAgainAsksNothing(): Promise<void> {
  await renderPanel(details());
  await userEvent.click(await useButton());
  await userEvent.click(await useButton());
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(rootCauseBox().value).toBe(SUGGESTION);
}

/** A viewer sees the section and its candidates, and no button. */
export async function aViewerSeesTheSectionAndNoButton(): Promise<void> {
  await renderPanel(details(), { readOnly: true });
  const region = await screen.findByRole("region", { name: SECTION });
  expect(await within(region).findByText(/Recorded before:/)).toBeInTheDocument();
  expect(within(region).queryAllByRole("button")).toHaveLength(0);
}

/** A device alarm gets no section, and the suggestions are never read (§17 Q4). */
export async function aDeviceAlarmGetsNoSection(): Promise<void> {
  const spies = await renderPanel(
    details({
      source: "rtu_comms",
      rtuId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      rtuCode: "RTU-07",
      assetId: null,
      assetCode: null,
      assetRtuName: null,
      assetLocationName: null,
      assetName: null,
      assetDomain: null,
      locationName: null,
      siteName: null,
      ruleId: null,
      classPhilosophy: null,
      message: "Communication lost: Pump house RTU",
    }),
  );
  expect(screen.queryByRole("region", { name: SECTION })).toBeNull();
  expect(spies.suggestions).not.toHaveBeenCalled();
}

/** A failed suggestions read leaves the class block and the wizard working, and Submit saves. */
export async function aFailedReadLeavesThePanelWorking(): Promise<void> {
  const spies = await renderPanel(details(), { suggestions: new Error("alarms/:id/root-cause-suggestions 500") });
  expect(await screen.findByText("Suggestions could not be loaded.")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Class philosophy" })).toBeInTheDocument();
  await userEvent.type(rootCauseBox(), "By hand");
  await toReviewAndSubmit();
  await waitFor(() => expect(spies.save).toHaveBeenCalledTimes(1));
}

/** Cancel after a fill asks before leaving (R-l): the fill marked the wizard changed. */
export async function cancelAfterAFillAsks(): Promise<void> {
  await renderPanel(details());
  await userEvent.click(await useButton());
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("alertdialog", { name: "Leave the wizard" })).toBeInTheDocument();
}

/** On step 3 the fill lands in step 1's field, the status line says so, and the wizard stays put. */
export async function aFillOnStepThreeShowsTheStatusLine(): Promise<void> {
  await renderPanel(details());
  for (let step = 0; step < 2; step += 1) await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("region", { name: "Details" })).toBeInTheDocument();
  await userEvent.click(await useButton());
  expect(screen.getByRole("status")).toHaveTextContent(STATUS);
  expect(screen.getByRole("region", { name: "Details" })).toBeInTheDocument();
  for (let step = 0; step < 2; step += 1) await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(rootCauseBox().value).toBe(SUGGESTION);
}
