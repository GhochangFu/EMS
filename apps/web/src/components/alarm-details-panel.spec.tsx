import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { AlarmDetailsResponse } from "@bms/shared";

import * as alarmsApi from "../api/alarms";
import * as assetsApi from "../api/assets";
import * as vocabApi from "../api/vocabularies";
import { AlarmDetailsPanel } from "./alarm-details-panel";

/**
 * `E2.2` (ADR 0059) — the class philosophy block on the Alarm Details panel.
 *
 * **This file is the first test coverage `alarm-details-panel.tsx` has ever
 * had** (plan §4). The claims below are only `E2.2`'s; the ADR 0034 half of the
 * panel stays uncovered, and that is a gap worth naming rather than implying.
 *
 * The sharpest claim is `keepsTheClassBlockDistinctFromTheInstanceEnrichment`.
 * ADR 0034 §Context draws a line between what engineering decided about an
 * asset **class** and what an operator recorded about **this** alarm, and this
 * panel is the one screen where both appear at once. Two blocks of
 * near-identical headings is exactly how that line stops being visible.
 */

const TEMPLATE_ID = "11111111-1111-1111-1111-111111111111";

function details(overrides: Partial<AlarmDetailsResponse> = {}): AlarmDetailsResponse {
  return {
    id: "alarm-1",
    assetId: "asset-1",
    organizationId: "org-1",
    assetCode: "PMP-01",
    assetName: "Raw water pump 1",
    assetDomain: "water",
    locationName: "Plant A",
    siteName: "Site A",
    severity: "warning",
    message: "Bearing temperature above 85 C",
    raisedAt: new Date("2026-09-08T04:00:00Z").toISOString(),
    acknowledgedAt: null,
    acknowledgedBy: null,
    clearedAt: null,
    ruleId: "rule-1",
    thresholdOperator: "gte",
    thresholdValue: 85,
    currentValue: 91,
    currentValueUnit: "C",
    currentValueAt: new Date("2026-09-08T04:01:00Z").toISOString(),
    enrichment: null,
    classPhilosophy: null,
    ...overrides,
  };
}

const PHILOSOPHY: NonNullable<AlarmDetailsResponse["classPhilosophy"]> = {
  templateId: TEMPLATE_ID,
  templateVersion: 3,
  templateName: "Centrifugal pump",
  alarmCode: "BEARING_TEMP_HIGH",
  cause: "Lubrication starvation or a failing bearing race.",
  impact: "Unplanned outage of the driven train within hours.",
  action: "Reduce load, verify lubrication, schedule a bearing change.",
  skillCode: "mechanical",
  skillLabel: "Mechanical",
};

/** An instance enrichment whose four text fields deliberately differ from the class text. */
const ENRICHMENT: NonNullable<AlarmDetailsResponse["enrichment"]> = {
  rootCause: "Grease line cracked at the elbow.",
  impact: "Pump 1 offline; pump 2 carrying full duty.",
  correctiveActions: "Replaced the grease line, re-greased, monitoring.",
  energyImpact: null,
  waterImpact: null,
  productionImpact: null,
  etrAt: null,
  skillCode: "mechanical",
  updatedBy: null,
  updatedAt: new Date("2026-09-08T04:30:00Z").toISOString(),
  affectedAssets: [],
};

async function renderPanel(payload: AlarmDetailsResponse, readOnly = false): Promise<void> {
  vi.spyOn(alarmsApi, "fetchAlarmDetails").mockResolvedValue(payload);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({
    alarmSeverities: [
      { code: "warning", label: "Warning", tone: "warning", rank: 20, active: true },
    ],
    alarmSkills: [{ code: "mechanical", label: "Mechanical", sortOrder: 10, active: true }],
    ruleCategories: [],
    assetDomains: [],
    assetRoles: [],
  } as unknown as Awaited<ReturnType<typeof vocabApi.fetchVocabularies>>);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AlarmDetailsPanel alarmId="alarm-1" readOnly={readOnly} onClose={() => {}} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(screen.getByText("Bearing temperature above 85 C")).toBeTruthy();
  });
}

/**
 * The happy path. The block names the template and version it came from, which
 * is ADR 0059 decision 6: the text is the **pinned** version's, not the current
 * one's, so a reader must be able to see which they are looking at.
 */
export async function showsTheClassPhilosophyWithItsTemplateAndVersion(): Promise<void> {
  await renderPanel(details({ classPhilosophy: PHILOSOPHY }));

  // Scoped to the block, not the document. The panel also renders the skill
  // *vocabulary* in the enrichment form's select, so an unscoped
  // `getByText("Mechanical")` would match two nodes and pass or fail for
  // reasons that have nothing to do with the class philosophy.
  const block = within(screen.getByRole("region", { name: "Class philosophy" }));

  expect(block.getByText(/Centrifugal pump/)).toBeTruthy();
  expect(block.getByText(/v3/)).toBeTruthy();
  expect(block.getByText("Lubrication starvation or a failing bearing race.")).toBeTruthy();
  expect(block.getByText("Unplanned outage of the driven train within hours.")).toBeTruthy();
  expect(
    block.getByText("Reduce load, verify lubrication, schedule a bearing change."),
  ).toBeTruthy();
  // The label, never the raw `mechanical` code (ADR 0059 decision 7).
  expect(block.getByText("Mechanical")).toBeTruthy();
}

/**
 * The case that is nearly every alarm on the current database — 0 of 290 rules
 * carry provenance (plan §2). The block must be **absent**, not an empty
 * heading over four dashes, or the panel gains permanent dead space.
 */
export async function omitsTheClassBlockEntirelyWhenThereIsNoProvenance(): Promise<void> {
  await renderPanel(details({ classPhilosophy: null }));

  expect(screen.queryByRole("region", { name: "Class philosophy" })).toBeNull();
  expect(screen.queryByText(/Likely cause/)).toBeNull();
  expect(screen.queryByText(/Recommended action/)).toBeNull();
}

/**
 * ADR 0034's class-vs-instance boundary, rendered. Both blocks are on screen at
 * once and every heading must say which side it is on — otherwise the reader
 * sees two "Impact" fields disagreeing and reads it as a bug.
 */
export async function keepsTheClassBlockDistinctFromTheInstanceEnrichment(): Promise<void> {
  await renderPanel(details({ classPhilosophy: PHILOSOPHY, enrichment: ENRICHMENT }), true);

  // The class side.
  expect(screen.getByText("Class philosophy")).toBeTruthy();
  expect(screen.getByText("Likely cause")).toBeTruthy();
  expect(screen.getByText("Typical impact")).toBeTruthy();
  expect(screen.getByText("Recommended action")).toBeTruthy();
  expect(screen.getByText("Skill required")).toBeTruthy();

  // The instance side keeps ADR 0034's own labels, unchanged by E2.2.
  expect(screen.getByText("Root cause")).toBeTruthy();
  expect(screen.getByText("Corrective actions")).toBeTruthy();

  // And the two texts are both present and different — the panel is not
  // showing one where the other belongs.
  expect(screen.getByText("Lubrication starvation or a failing bearing race.")).toBeTruthy();
  expect(screen.getByText("Grease line cracked at the elbow.")).toBeTruthy();
}

/**
 * Ruling Q0b's sibling claim: the class philosophy is a read, and `readOnly`
 * hides the enrichment **write form** only. A viewer who cannot record what
 * happened can still read what engineering decided.
 */
export async function showsTheClassPhilosophyToAViewer(): Promise<void> {
  await renderPanel(details({ classPhilosophy: PHILOSOPHY }), true);

  const block = within(screen.getByRole("region", { name: "Class philosophy" }));
  expect(block.getByText("Lubrication starvation or a failing bearing race.")).toBeTruthy();

  // …and the write half really is hidden, so this is a claim about `readOnly`
  // rather than a second copy of the happy-path test.
  expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  expect(screen.queryByLabelText("Root cause")).toBeNull();
}

/**
 * Ruling Q1, asserted as an **absence** so a later well-meaning addition fails
 * this test rather than sliding in. Copying the class text into the instance
 * form would make the two indistinguishable in the data, which is the one
 * outcome ADR 0034's two-table split exists to prevent.
 */
export async function offersNoControlThatCopiesTheClassTextIntoTheForm(): Promise<void> {
  await renderPanel(details({ classPhilosophy: PHILOSOPHY }));

  for (const label of [/copy/i, /use this/i, /apply to enrichment/i, /prefill/i]) {
    expect(screen.queryByRole("button", { name: label })).toBeNull();
  }

  // And the form is genuinely empty rather than silently seeded from the class.
  const rootCause = screen.getByLabelText("Root cause") as HTMLTextAreaElement;
  expect(rootCause.value).toBe("");
}
