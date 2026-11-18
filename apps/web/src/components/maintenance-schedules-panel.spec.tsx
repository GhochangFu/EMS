import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { MaintenanceScheduleItem } from "@bms/shared";
import type { DegradationResponse } from "@bms/shared/contracts";

import type { AssetRow } from "../api/assets";
import * as degradationApi from "../api/degradation";
import * as maintenanceApi from "../api/maintenance";
import { anAsset, anIndicator } from "../lib/degradation.spec";
import { MaintenanceSchedulesPanel, priorityStyle } from "./maintenance-schedules-panel";

// `E1.5b` (ADR 0138, plan T2.5): the degradation read is a module mock; `renderPanel` sets each
// case's answer (default: no asset), so no case reaches a local API.
vi.mock("../api/degradation", () => ({ fetchDegradation: vi.fn(), fetchAssetDegradation: vi.fn() }));

/**
 * `F3.65b` owner ruling R-f (2026-09-28) — the schedule template's priority
 * pill uses the same split as the work-orders page: `high` on the solid warning
 * line and the strong wash, `medium` on the soft line and the plain wash.
 *
 * Assertions live here; `maintenance-schedules-panel.test.tsx` is the Vitest
 * entry point (ADR 0014).
 */

export function highAndMediumPillsDiffer(): void {
  expect(priorityStyle("high")).not.toBe(priorityStyle("medium"));
}

export function highPillIsTheRuledStrongWarning(): void {
  expect(priorityStyle("high")).toBe("border-warning bg-warning-wash-strong text-warning-ink");
}

export function mediumPillIsTheRuledSoftWarning(): void {
  expect(priorityStyle("medium")).toBe("border-warning-line bg-warning-wash text-warning-ink");
}

/**
 * `F4.204` — the `api/maintenance` writers throw an `Error` whose message is the
 * whole response body, so a refusal read through `.message` showed
 * `{"statusCode":409,…}` in the panel. The create, convert and update sites read
 * it through `apiErrorMessage`; one case per site, each with its own sentence,
 * each finding the error element by that sentence.
 */

const ASSET = {
  id: "asset-1",
  code: "AHU-01",
  name: "Air Handler One",
  siteName: "Plant A",
} as unknown as AssetRow;

const SCHEDULE: MaintenanceScheduleItem = {
  id: "5c4e1d2c-0000-4000-8000-000000000001",
  templateId: "template-1",
  assetId: "asset-1",
  title: "Quarterly filter change",
  description: null,
  category: "preventive",
  generationMode: "calendar",
  ownerTeam: null,
  vendorName: null,
  complianceRef: null,
  triggerSummary: null,
  safetyCritical: false,
  priority: "medium",
  estimatedMinutes: 60,
  intervalDays: 90,
  nextDueAt: "2026-12-01T09:00:00.000Z",
  lastCompletedAt: null,
  dueState: "upcoming",
  assetCode: "AHU-01",
  assetRtuName: "RTU 3",
  assetLocationName: "Plant A",
  assetName: "Air Handler One",
  siteName: "Plant A",
  activeWorkOrderId: null,
  active: true,
};

/** `F4.281`: a deactivated schedule, listed only with "Show inactive". */
const INACTIVE: MaintenanceScheduleItem = {
  ...SCHEDULE,
  id: "5c4e1d2c-0000-4000-8000-000000000002",
  title: "Seasonal coil clean",
  active: false,
};

function envelope(sentence: string): Error {
  return new Error(`{"statusCode":409,"message":"${sentence}","error":"Conflict"}`);
}

const NO_DEGRADATION: DegradationResponse = { asOf: "2026-11-16T10:20:00.000Z", candidates: 0, considered: 0, assets: [] };

async function renderPanel(
  row: MaintenanceScheduleItem = SCHEDULE,
  degradation: DegradationResponse | Error = NO_DEGRADATION,
  more: MaintenanceScheduleItem[] = [],
): Promise<void> {
  const degradationRead = vi.mocked(degradationApi.fetchDegradation);
  degradationRead.mockReset();
  if (degradation instanceof Error) {
    degradationRead.mockRejectedValue(degradation);
  } else {
    degradationRead.mockResolvedValue(degradation);
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("maintenance-schedules-panel.spec: no fetch expected"))),
  );
  // `F4.281`: the inactive row comes back only when the panel asks for it ("Show inactive").
  vi.spyOn(maintenanceApi, "fetchMaintenanceSchedules").mockImplementation(async (input) => ({
    items: input.includeInactive === true ? [row, ...more, INACTIVE] : [row, ...more],
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MaintenanceSchedulesPanel assetOptions={[ASSET]} />
    </QueryClientProvider>,
  );
  await screen.findByText(SCHEDULE.title);
}

/** The element carrying the refusal, found by its sentence; it must not carry the JSON. */
async function expectTheSentenceNotTheEnvelope(sentence: string): Promise<void> {
  const element = await screen.findByText(new RegExp(sentence));
  expect(element.textContent).toContain(sentence);
  expect(element.textContent).not.toContain('{"');
}

const CONVERT_SENTENCE = "This schedule already has an open work order";

/**
 * `F4.281` (Amendment 8 Q16): "+ New Schedule" mounts the `maintenanceSchedule.create` stepper.
 * The refused-create sentence (`MS1`) moved to `maintenance-schedule-wizard.spec.tsx`.
 */
export async function newScheduleMountsTheCreateStepper(): Promise<void> {
  await renderPanel();
  await userEvent.click(screen.getByRole("button", { name: "+ New Schedule" }));
  const dialog = await screen.findByRole("dialog", { name: "Create maintenance schedule" });
  expect(within(dialog).getByRole("list", { name: "Steps" })).toHaveTextContent("1. Schedule");
}

/** A refused convert-to-work-order shows the server sentence, not the JSON envelope. */
export async function aRefusedConvertShowsTheSentence(): Promise<void> {
  vi.spyOn(maintenanceApi, "convertMaintenanceSchedule").mockRejectedValue(envelope(CONVERT_SENTENCE));
  await renderPanel();

  await userEvent.click(screen.getByRole("button", { name: "Generate WO" }));
  // `F4.284` (ADR 0106 decision 5): Notes → Review on the shared `WizardShell`.
  const dialog = await screen.findByRole("dialog", { name: "Generate a work order" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

  await expectTheSentenceNotTheEnvelope(CONVERT_SENTENCE);
}

/**
 * `F4.281` (Amendment 8 Q16): a row's Deactivate mounts the direction stepper and sends nothing yet.
 * The refused-update sentence (`MS3`) moved to `maintenance-schedule-toggle-wizard.spec.tsx`.
 */
export async function deactivateMountsTheToggleStepper(): Promise<void> {
  const update = vi.spyOn(maintenanceApi, "updateMaintenanceSchedule");
  await renderPanel();
  await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));
  expect(await screen.findByRole("dialog", { name: "Deactivate a maintenance schedule" })).toBeInTheDocument();
  expect(update).not.toHaveBeenCalled();
}

/** `F4.281` (owner ruling DC3): "Show inactive" lists a deactivated schedule with an Activate button. */
export async function showInactiveListsAnInactiveRowWithActivate(): Promise<void> {
  await renderPanel();
  expect(screen.queryByText(INACTIVE.title)).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Show inactive"));
  const card = (await screen.findByText(INACTIVE.title)).closest("article");
  expect(card).not.toBeNull();
  expect(within(card as HTMLElement).getByRole("button", { name: "Activate" })).toBeInTheDocument();
}

/** `F4.316` PR 4a (ADR 0111): the innermost element whose whole text is `text`. */
function byWholeText(text: string): HTMLElement {
  return screen.getByText(
    (_content, element) =>
      element !== null &&
      element.textContent === text &&
      Array.from(element.children).every((child) => child.textContent !== text),
  );
}

/** The row's asset line reads `<code> · <RTU> · <asset name> · <site>`. */
export async function theRowNamesTheRtu(): Promise<void> {
  await renderPanel();
  expect(byWholeText("AHU-01 · RTU 3 · Air Handler One · Plant A")).toBeInTheDocument();
}

/** With no RTU the location names the asset. */
export async function theRowFallsBackToTheLocation(): Promise<void> {
  await renderPanel({ ...SCHEDULE, assetRtuName: null });
  expect(byWholeText("AHU-01 · Plant A · Air Handler One · Plant A")).toBeInTheDocument();
}

/** The `· where` part wraps rather than truncating. */
export async function theRowsWherePartWraps(): Promise<void> {
  await renderPanel();
  const where = screen.getByText("· RTU 3");
  expect(where).not.toHaveClass("truncate");
  expect(where).toHaveClass("whitespace-normal");
}

/**
 * `E1.5b` (ADR 0138 decision 4, plan T2.5, §4.7, R-t, Q4 (a)) — a display-only trend note beside a
 * schedule: the server's sentence and the *Advisory* pill, after the *Trigger* line, on the card
 * of the schedule the note names and no other. No button, no link, no state.
 */
const NOTE = "Trend reaches its limit in about 13–17 days; next service due in 60 days.";

/** A second schedule of the same asset, with no note of its own. */
const SAME_ASSET: MaintenanceScheduleItem = {
  ...SCHEDULE,
  id: "5c4e1d2c-0000-4000-8000-000000000003",
  title: "Monthly belt check",
  triggerSummary: "Every 30 days",
};

const WITH_NOTE: DegradationResponse = {
  ...NO_DEGRADATION,
  candidates: 1,
  considered: 1,
  assets: [
    {
      ...anAsset(1, [anIndicator({ daysToLimit: { min: 13, max: 17 } })]),
      assetId: SCHEDULE.assetId,
      scheduleNotes: [{ scheduleId: SCHEDULE.id, nextDueAt: SCHEDULE.nextDueAt, sentence: NOTE }],
    },
  ],
};

function cardOf(title: string): HTMLElement {
  return screen.getByText(title).closest("article") as HTMLElement;
}

/** A schedule whose id has a note shows it, with the info pill, after its Trigger line, in its own card. */
export async function aScheduleWithANoteShowsIt(): Promise<void> {
  await renderPanel({ ...SCHEDULE, triggerSummary: "Every 90 days" }, WITH_NOTE);
  const note = await screen.findByTestId("schedule-trend-note");
  expect(vi.mocked(degradationApi.fetchDegradation).mock.calls).toEqual([[{}]]);
  expect(cardOf(SCHEDULE.title)).toContainElement(note);
  expect(within(note).getByText(NOTE)).toBeInTheDocument();
  const pill = within(note).getByText("Advisory");
  expect(pill.getAttribute("class") ?? "").toContain("text-info-ink");
  expect(note.innerHTML).not.toMatch(/critical|warning/);
  const trigger = within(cardOf(SCHEDULE.title)).getByText("Trigger: Every 90 days");
  expect(trigger.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING, "after the Trigger line").toBeTruthy();
  expect(within(note).queryByRole("button")).toBeNull();
  expect(within(note).queryByRole("link")).toBeNull();
}

/** A schedule with no note — the same asset's other schedule — shows none. */
export async function aScheduleWithNoNoteShowsNone(): Promise<void> {
  await renderPanel(SCHEDULE, WITH_NOTE, [SAME_ASSET]);
  await screen.findByTestId("schedule-trend-note");
  expect(screen.getAllByTestId("schedule-trend-note")).toHaveLength(1);
  expect(within(cardOf(SAME_ASSET.title)).queryByTestId("schedule-trend-note")).toBeNull();
  expect(within(cardOf(SAME_ASSET.title)).queryByText(/Trend reaches/)).toBeNull();
}

/** A failed degradation read leaves the panel exactly as a read with no asset leaves it. */
export async function aFailedDegradationReadLeavesThePanel(): Promise<void> {
  await renderPanel(SCHEDULE, NO_DEGRADATION, [SAME_ASSET]);
  await waitFor(() => expect(degradationApi.fetchDegradation).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  const quiet = document.body.innerHTML;
  cleanup();

  await renderPanel(SCHEDULE, new Error("degradation 500"), [SAME_ASSET]);
  await waitFor(() => expect(degradationApi.fetchDegradation).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByTestId("schedule-trend-note")).toBeNull();
  expect(screen.queryByText(/degradation/i)).toBeNull();
  expect(document.body.innerHTML).toBe(quiet);
}
