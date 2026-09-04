import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import { adminAssetTemplateDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetTemplateDto, VocabulariesResponse } from "@bms/shared";

import * as vocabApi from "../../api/vocabularies";
import { AlarmsTab } from "./alarms-tab";

/**
 * `F2.13` / ADR 0019 Amendment 2 — the Alarms tab renders a paired-optional
 * `operator`/`thresholdValue`. Assertions live here; `alarms-tab.test.tsx` is
 * the Vitest entry point (ADR 0014).
 */

const VOCABULARIES: VocabulariesResponse = {
  ruleCategories: [{ code: "operations", label: "Operations", sortOrder: 10, active: true }],
  assetDomains: [],
  alarmSeverities: [{ code: "warning", label: "Warning", sortOrder: 10, active: true }],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
} as unknown as VocabulariesResponse;

/** One point, so a pair-absent alarm bound to it resolves cleanly. */
function template(alarms: unknown[]): AdminAssetTemplateDto {
  return adminAssetTemplateDtoSchema.parse({
    id: "t1",
    organizationId: "o1",
    organizationCode: "IONEX",
    organizationName: "Ion Exchange",
    code: "ELECTRICAL-FEEDER",
    version: 1,
    name: "Feeder",
    assetType: "feeder",
    domain: "electrical",
    description: null,
    status: "draft",
    content: { alarms },
    publishedAt: null,
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    points: [
      {
        id: "p1",
        templateId: "t1",
        pointKey: "current_a",
        label: "Current",
        unit: "A",
        kind: "measured",
        sourceDataKeyPattern: null,
        formula: null,
        formulaDialect: null,
        calcTrigger: null,
        calcIntervalSeconds: null,
        maxInputAgeSeconds: null,
        required: true,
        sortOrder: 0,
        meta: { tier: "core" },
        createdAt: "2026-09-02T00:00:00.000Z",
      },
    ],
  });
}

function renderTab(alarms: unknown[], editable = true): HTMLElement {
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <AlarmsTab
        template={template(alarms)}
        editable={editable}
        onSaved={vi.fn()}
        onDirtyChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return container;
}

/** The pair-absent row itself — ADR 0019 Amendment 2 decision 5's claim. */
export async function pairAbsentRowRendersCommissioningCopyAndAnEmptyOperator(): Promise<void> {
  renderTab([
    {
      code: "OVERLOAD",
      pointKey: "current_a",
      severity: "warning",
      message: "Load above the feeder's rating",
    },
  ]);

  await waitFor(() => {
    expect(screen.getByText("value set per site at commissioning")).toBeInTheDocument();
  });
  // No editable threshold box for a pair-absent row.
  expect(screen.queryByPlaceholderText("12")).not.toBeInTheDocument();

  const operatorSelect = screen.getByRole("combobox", { name: "Fires when the value is" });
  expect((operatorSelect as HTMLSelectElement).value).toBe("");
  expect(
    within(operatorSelect)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value),
  ).toContain("");
}

/** A full pair still renders the ordinary editable threshold box. */
export async function fullPairRendersAnEditableThresholdBox(): Promise<void> {
  renderTab([
    {
      code: "OVERLOAD",
      pointKey: "current_a",
      operator: "gt",
      thresholdValue: 112,
      severity: "warning",
      message: "Load above the feeder's rating",
    },
  ]);

  await waitFor(() => {
    expect(screen.getByPlaceholderText("12")).toBeInTheDocument();
  });
  expect(screen.queryByText("value set per site at commissioning")).not.toBeInTheDocument();

  const operatorSelect = screen.getByRole("combobox", { name: "Fires when the value is" });
  expect((operatorSelect as HTMLSelectElement).value).toBe("gt");
}

/**
 * `F2.20` — the philosophy block opens by default on a read-only template.
 *
 * Reading is the other half of what this tab is for, and a closed `<details>`
 * hides its content from `innerText` entirely: `E5.3`'s first browser pass
 * reported a `philosophy.skill` that was present in the data as missing from
 * the page, because the block was collapsed. On a version that can never be
 * saved there is no Save state to protect, so the block opens.
 *
 * The three cases below are one claim each, and the second and third are what
 * keep the change from being a deletion of the collapse.
 */

/** A valid alarm carrying one philosophy field — the subject of cases 1 and 2. */
const ALARM_WITH_CAUSE = {
  code: "OVERLOAD",
  pointKey: "current_a",
  severity: "warning",
  message: "Load above the feeder's rating",
  philosophy: { cause: "Bearing wear" },
};

/** Case 1 — read-only, so the philosophy is open and its content is readable. */
export async function philosophyIsOpenOnAReadOnlyTemplate(): Promise<void> {
  const container = renderTab([ALARM_WITH_CAUSE], false);

  // The vocabularies settle first, so `open` is read from the final render.
  await waitFor(() => {
    expect(screen.getByRole("option", { name: "Warning" })).toBeInTheDocument();
  });

  const block = container.querySelector("details");
  expect(block).not.toBeNull();
  expect((block as HTMLDetailsElement).open).toBe(true);
  expect(screen.getByDisplayValue("Bearing wear")).toBeInTheDocument();
}

/**
 * Case 2 — the baseline the protection needs.
 *
 * A clean, editable draft keeps the block collapsed. Without this the change
 * could be "always open", which is a different feature and loses the collapse
 * an author with twenty alarms depends on.
 */
export async function philosophyStaysCollapsedOnACleanDraft(): Promise<void> {
  const container = renderTab([ALARM_WITH_CAUSE], true);

  await waitFor(() => {
    expect(screen.getByRole("option", { name: "Warning" })).toBeInTheDocument();
  });

  expect((container.querySelector("details") as HTMLDetailsElement).open).toBe(false);
  expect(screen.queryByText("needs attention")).not.toBeInTheDocument();
}

/**
 * Case 3 — the forced-open protection, proved to have survived.
 *
 * `VOCABULARIES` loads `alarmSkills: []`, so any non-empty skill is refused by
 * `alarmFormErrors` with `field: "skill"`. On an editable draft that failing
 * field must be visible, or the author sees a disabled Save and a "fix the
 * problems above" message with nothing on screen to fix.
 */
export async function philosophyIsForcedOpenByAProblemOnADraft(): Promise<void> {
  const container = renderTab(
    [
      {
        code: "OVERLOAD",
        pointKey: "current_a",
        severity: "warning",
        message: "Load above the feeder's rating",
        philosophy: { skill: "electrician" },
      },
    ],
    true,
  );

  await waitFor(() => {
    expect(screen.getByRole("option", { name: "Warning" })).toBeInTheDocument();
  });

  expect((container.querySelector("details") as HTMLDetailsElement).open).toBe(true);
  expect(screen.getByText("needs attention")).toBeInTheDocument();
}
