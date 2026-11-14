import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi, type MockInstance } from "vitest";

import type { RuleListItem, VocabulariesResponse } from "@bms/shared";

import * as filterOptionsApi from "../api/filter-options";
import * as rulesApi from "../api/rules";
import * as vocabApi from "../api/vocabularies";
import { IDS, OPTIONS } from "../lib/scope-filter.spec";
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

type ListSpy = MockInstance<typeof rulesApi.fetchRuleList>;

/** `answer` decides what the list returns for the filter it was asked with. */
async function renderPanel(
  rules: RuleListItem[],
  entry = "/rules",
  answer: (filter: rulesApi.RuleListQuery) => RuleListItem[] = () => rules,
): Promise<ListSpy> {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no fetch expected"))));
  const list = vi
    .spyOn(rulesApi, "fetchRuleList")
    .mockImplementation(async (filter) => ({ items: answer(filter) }));
  vi.spyOn(rulesApi, "fetchRuleExecutions").mockResolvedValue({ items: [] });
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(vocabularies);
  vi.spyOn(filterOptionsApi, "fetchFilterOptions").mockResolvedValue(OPTIONS);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <RulesPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText(rules[0]?.name ?? "");
  return list;
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

const otherRule: RuleListItem = {
  ...thresholdRule,
  id: "66666666-6666-4666-8666-666666666666",
  code: "AHU_LOW_FLOW",
  name: "AHU low flow",
  category: "electrical" as RuleListItem["category"],
  enabled: false,
};

/** Choosing a location reads the list again with `locationId`, and the counters follow the answer. */
export async function choosingALocationRefetchesWithIt(): Promise<void> {
  const list = await renderPanel(
    [thresholdRule, otherRule],
    "/rules",
    (filter) => (filter.locationId ? [thresholdRule] : [thresholdRule, otherRule]),
  );
  expect(list.mock.calls.at(-1)?.[0]).toEqual({});
  await vi.waitFor(() => expect((screen.getByRole("combobox", { name: "Organization" }) as HTMLSelectElement).disabled).toBe(false));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Organization" }), IDS.ORG_A);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Location" }), IDS.SITE_A);
  await vi.waitFor(() =>
    expect(list.mock.calls.at(-1)?.[0]).toEqual({ organizationId: IDS.ORG_A, locationId: IDS.SITE_A }),
  );
  await screen.findByText("Active Rules (1/1)");
}

/** The heading's count is the filtered list's: one enabled published rule of two returned is 1/2, one of one is 1/1. */
export async function theActiveCountIsOfTheFilteredRules(): Promise<void> {
  await renderPanel([thresholdRule, otherRule], `/rules?organizationId=${IDS.ORG_A}`, () => [thresholdRule, otherRule]);
  await screen.findByText("Active Rules (1/2)");
}

/** The browser-side category filter still narrows what the server returned. */
export async function theCategoryFilterStillWorks(): Promise<void> {
  await renderPanel([thresholdRule, otherRule]);
  expect(screen.getByText("AHU low flow")).toBeTruthy();
  const select = screen.getAllByRole("combobox").find((el) => within(el).queryByText("HVAC")) as HTMLSelectElement;
  await userEvent.selectOptions(select, "hvac");
  await vi.waitFor(() => expect(screen.queryByText("AHU low flow")).toBeNull());
  expect(screen.getByText("Chiller high temperature")).toBeTruthy();
}
