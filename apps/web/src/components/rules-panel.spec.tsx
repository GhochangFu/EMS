import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { RuleListItem, VocabulariesResponse } from "@bms/shared";

import * as rulesApi from "../api/rules";
import * as vocabApi from "../api/vocabularies";
import { RulesPanel } from "./rules-panel";

/**
 * `F4.316` PR 4b (ADR 0111) — the Rule Engine card names its asset as
 * `<code> · <RTU or location> · <point> …`, and `Asset` for a rule with no asset. Vitest entry
 * point: the sibling `.test.tsx` (jsdom docblock there).
 */

const vocabularies: VocabulariesResponse = {
  ruleCategories: [{ code: "hvac", label: "HVAC", active: true, sortOrder: 1, tone: "neutral" }],
  assetDomains: [{ code: "hvac", label: "HVAC", active: true, sortOrder: 1 }],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
  waterBalanceRoles: [],
  switchingStates: [],
};

const thresholdRule: RuleListItem = {
  id: "44444444-4444-4444-8444-444444444444",
  code: "CHILLER_HIGH_TEMP",
  name: "Chiller high temperature",
  description: null,
  category: "hvac",
  ruleType: "threshold",
  source: "operator_rule",
  enabled: true,
  assetId: "55555555-5555-4555-8555-555555555555",
  assetCode: "CH-01",
  assetRtuName: "RTU 1",
  assetLocationName: "Plant A",
  assetName: "Chiller 1",
  siteName: "West Campus",
  assetDomain: "hvac",
  pointKey: "supply_temp_c",
  operator: "gte",
  thresholdValue: 12,
  severity: "warning",
  clearHoldSeconds: null,
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

async function renderPanel(rules: RuleListItem[]): Promise<void> {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no fetch expected"))));
  vi.spyOn(rulesApi, "fetchRules").mockResolvedValue({ items: rules });
  vi.spyOn(rulesApi, "fetchRuleExecutions").mockResolvedValue({ items: [] });
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(vocabularies);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RulesPanel />
    </QueryClientProvider>,
  );
  await screen.findByText(rules[0]?.name ?? "");
}

/** An asset with an RTU: the summary reads `CH-01 · RTU 1 · supply_temp_c gte 12`. */
export async function theSummaryNamesTheAssetByCodeAndRtu(): Promise<void> {
  await renderPanel([thresholdRule]);
  expect(screen.getByText("CH-01 · RTU 1 · supply_temp_c gte 12")).toBeTruthy();
}

/** The RTU-less twin falls back to the location name. */
export async function theSummaryFallsBackToTheLocation(): Promise<void> {
  await renderPanel([{ ...thresholdRule, assetRtuName: null }]);
  expect(screen.getByText("CH-01 · Plant A · supply_temp_c gte 12")).toBeTruthy();
}

/** A threshold rule with no asset keeps the `Asset` placeholder (nullable twin: no code, no parts). */
export async function aRuleWithNoAssetKeepsThePlaceholder(): Promise<void> {
  await renderPanel([{ ...thresholdRule, assetCode: null, assetRtuName: null, assetLocationName: null }]);
  expect(screen.getByText("Asset · supply_temp_c gte 12")).toBeTruthy();
}
