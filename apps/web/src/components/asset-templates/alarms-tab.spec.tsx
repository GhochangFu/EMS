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
        createdAt: "2026-09-02T00:00:00.000Z",
      },
    ],
  });
}

function renderTab(alarms: unknown[]) {
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AlarmsTab
        template={template(alarms)}
        editable={true}
        onSaved={vi.fn()}
        onDirtyChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
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
