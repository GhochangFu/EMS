import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type {
  RuleBuilderCatalogAsset,
  RuleListItem,
  VocabulariesResponse,
} from "@bms/shared";

import * as rulesApi from "../api/rules";
import * as vocabApi from "../api/vocabularies";
import { RuleBuilderPanel } from "./rule-builder-panel";

/**
 * `F3.10` Unit U10 — the rules card's clear-hold field (ADR 0057 decision 16 /
 * D16 in `docs/plans/f3.10-alarm-lifecycle-escalation.md`).
 *
 * Assertions live here; `rule-builder-panel.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0042
 * decision 2, same split `rule-channels-editor.spec.tsx` uses).
 */

const asset: RuleBuilderCatalogAsset = {
  id: "55555555-5555-5555-5555-555555555555",
  code: "CH-01",
  name: "Chiller 1",
  siteName: "West Campus",
  domain: "hvac",
  pointKeys: ["supply_temp_c"],
};

const vocabularies: VocabulariesResponse = {
  ruleCategories: [
    { code: "hvac", label: "HVAC", active: true, sortOrder: 1, tone: "neutral" },
  ],
  assetDomains: [{ code: "hvac", label: "HVAC", active: true, sortOrder: 1 }],
  alarmSeverities: [
    { code: "warning", label: "Warning", active: true, tone: "warning", rank: 1 },
  ],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
};

const thresholdRule: RuleListItem = {
  id: "44444444-4444-4444-4444-444444444444",
  code: "chiller_high_temp",
  name: "Chiller high temperature",
  description: "Raises when the chiller runs hot.",
  category: "hvac",
  ruleType: "threshold",
  source: "operator_rule",
  enabled: true,
  assetId: asset.id,
  assetCode: asset.code,
  assetName: asset.name,
  siteName: asset.siteName,
  assetDomain: "hvac",
  pointKey: "supply_temp_c",
  operator: "gte",
  thresholdValue: 12,
  severity: "warning",
  clearHoldSeconds: 300,
  lifecycleStatus: "published",
  condition: { window: "latest" },
  action: { type: "notify", target: "Operations" },
  lastEvaluatedAt: null,
  publishedAt: new Date(0).toISOString(),
  archivedAt: null,
  duplicatedFromRuleId: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const timeWindowRule: RuleListItem = {
  ...thresholdRule,
  id: "66666666-6666-6666-6666-666666666666",
  ruleType: "time_window",
  assetId: null,
  assetCode: null,
  assetName: null,
  assetDomain: null,
  pointKey: null,
  operator: null,
  thresholdValue: null,
  clearHoldSeconds: null,
  condition: {
    days: ["mon"],
    startTime: "08:00",
    endTime: "17:00",
  },
};

function stubApi(): void {
  vi.spyOn(rulesApi, "fetchRuleBuilderCatalog").mockResolvedValue({ assets: [asset] });
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(vocabularies);
}

function renderPanel(selectedRule: RuleListItem | null = null): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RuleBuilderPanel selectedRule={selectedRule} onClearSelected={() => {}} />
    </QueryClientProvider>,
  );
}

export async function showsThePlaceholderOnANewDraft(): Promise<void> {
  stubApi();
  renderPanel();

  expect(await screen.findByPlaceholderText("120 (default)")).toBeInTheDocument();
}

export async function sendsNullForABlankClearHold(): Promise<void> {
  stubApi();
  vi.spyOn(rulesApi, "createRuleDraft").mockResolvedValue(thresholdRule);
  renderPanel();

  await fillMinimalThresholdForm();
  await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

  expect(rulesApi.createRuleDraft).toHaveBeenCalledWith(
    expect.objectContaining({ clearHoldSeconds: null }),
    expect.anything(),
  );
}

export async function sendsTheParsedIntegerForANonBlankClearHold(): Promise<void> {
  stubApi();
  vi.spyOn(rulesApi, "createRuleDraft").mockResolvedValue(thresholdRule);
  renderPanel();

  await fillMinimalThresholdForm();
  await userEvent.type(screen.getByPlaceholderText("120 (default)"), "45");
  await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

  expect(rulesApi.createRuleDraft).toHaveBeenCalledWith(
    expect.objectContaining({ clearHoldSeconds: 45 }),
    expect.anything(),
  );
}

/** Review 3: a non-numeric, non-blank hold is refused at the field — never sent as `NaN` → `null`. */
export async function refusesANonNumericClearHold(): Promise<void> {
  stubApi();
  vi.spyOn(rulesApi, "createRuleDraft").mockResolvedValue(thresholdRule);
  renderPanel();

  await fillMinimalThresholdForm();
  await userEvent.type(screen.getByPlaceholderText("120 (default)"), "abc");
  await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

  expect(screen.getByText(/clear hold as a number of seconds/i)).toBeInTheDocument();
  expect(rulesApi.createRuleDraft).not.toHaveBeenCalled();
}

export async function showsAStoredValueWhenOpeningARule(): Promise<void> {
  stubApi();
  renderPanel(thresholdRule);

  await waitFor(() => {
    expect(screen.getByPlaceholderText("120 (default)")).toHaveValue("300");
  });
}

export async function hidesTheFieldForATimeWindowRule(): Promise<void> {
  stubApi();
  renderPanel(timeWindowRule);

  await screen.findByText("Rule name", { exact: false });
  expect(screen.queryByPlaceholderText("120 (default)")).not.toBeInTheDocument();
}

async function fillMinimalThresholdForm(): Promise<void> {
  await screen.findByRole("option", { name: /Chiller 1/ });
  await userEvent.type(screen.getByPlaceholderText("CR Q9 current warning"), "New draft rule");
  await userEvent.selectOptions(screen.getByDisplayValue("Select asset"), asset.id);
  await userEvent.selectOptions(screen.getByDisplayValue("Select point"), "supply_temp_c");
  await userEvent.type(screen.getByPlaceholderText("3"), "10");
}
