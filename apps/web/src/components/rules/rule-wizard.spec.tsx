import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { RuleBuilderCatalogAsset, RuleListItem, VocabulariesResponse } from "@bms/shared";

import * as rulesApi from "../../api/rules";
import * as vocabApi from "../../api/vocabularies";
import { useWizardStore } from "../../stores/wizard-store";
import { RuleWizard } from "./rule-wizard";

/**
 * `F4.278` (ADR 0099 decision 6, Amendment 8) — the Rule Engine's rule form on
 * `WizardShell` (Rule → Condition → Action → Review). The seven clear-hold and
 * refusal claims moved here from `rule-builder-panel.spec.tsx` (`F3.10` U10,
 * Review 3, `F4.204`), now driven through the steps. Vitest entry point: the
 * sibling `.test.tsx` (jsdom docblock there).
 */

const asset: RuleBuilderCatalogAsset = {
  id: "55555555-5555-4555-8555-555555555555",
  code: "CH-01",
  name: "Chiller 1",
  siteName: "West Campus",
  domain: "hvac",
  pointKeys: ["supply_temp_c"],
};

const vocabularies: VocabulariesResponse = {
  ruleCategories: [{ code: "hvac", label: "HVAC", active: true, sortOrder: 1, tone: "neutral" }],
  assetDomains: [{ code: "hvac", label: "HVAC", active: true, sortOrder: 1 }],
  alarmSeverities: [{ code: "warning", label: "Warning", active: true, tone: "warning", rank: 1 }],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
  waterBalanceRoles: [],
};

const thresholdRule: RuleListItem = {
  id: "44444444-4444-4444-8444-444444444444",
  code: "CHILLER_HIGH_TEMP",
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
  id: "66666666-6666-4666-8666-666666666666",
  ruleType: "time_window",
  assetId: null,
  assetCode: null,
  assetName: null,
  assetDomain: null,
  pointKey: null,
  operator: null,
  thresholdValue: null,
  clearHoldSeconds: null,
  condition: { days: ["mon"], startTime: "08:00", endTime: "17:00" },
};

function stubApi(): void {
  // An unstubbed fetch reaches the real API on :4000.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no fetch expected"))));
  vi.spyOn(rulesApi, "fetchRuleBuilderCatalog").mockResolvedValue({ assets: [asset] });
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(vocabularies);
}

function renderWizard(rule: RuleListItem | null = null): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RuleWizard rule={rule} onCancel={() => {}} onDone={() => {}} />
    </QueryClientProvider>,
  );
}

const next = () => userEvent.click(screen.getByRole("button", { name: "Next" }));

/** The Rule step with a name, then Next to the Condition step. */
async function toCondition(name = "New draft rule"): Promise<void> {
  await userEvent.type(await screen.findByLabelText("Rule name"), name);
  await next();
  await screen.findByRole("option", { name: /Chiller 1/ });
}

/** A minimal threshold draft through to Review; `hold` is typed into the clear-hold field. */
async function toReview(hold = ""): Promise<void> {
  await toCondition();
  await userEvent.selectOptions(screen.getByLabelText("Asset"), asset.id);
  await userEvent.selectOptions(screen.getByLabelText("Telemetry point"), "supply_temp_c");
  await userEvent.type(screen.getByLabelText("Threshold"), "10");
  if (hold !== "") await userEvent.type(screen.getByLabelText("Clear hold (seconds)"), hold);
  await next();
  await next();
}

const submit = () => userEvent.click(screen.getByRole("button", { name: "Submit" }));

export async function showsThePlaceholderOnANewDraft(): Promise<void> {
  stubApi();
  renderWizard();
  await toCondition();
  expect(screen.getByPlaceholderText("120 (default)")).toBeInTheDocument();
}

export async function sendsNullForABlankClearHold(): Promise<void> {
  stubApi();
  vi.spyOn(rulesApi, "createRuleDraft").mockResolvedValue(thresholdRule);
  renderWizard();
  await toReview();
  await submit();
  expect(rulesApi.createRuleDraft).toHaveBeenCalledWith(expect.objectContaining({ clearHoldSeconds: null }));
}

export async function sendsTheParsedIntegerForANonBlankClearHold(): Promise<void> {
  stubApi();
  vi.spyOn(rulesApi, "createRuleDraft").mockResolvedValue(thresholdRule);
  renderWizard();
  await toReview("45");
  await submit();
  expect(rulesApi.createRuleDraft).toHaveBeenCalledWith(expect.objectContaining({ clearHoldSeconds: 45 }));
}

/** Review 3: a non-numeric hold is refused at the field, and Next stays on the step: never sent as `NaN` → `null`. */
export async function refusesANonNumericClearHold(): Promise<void> {
  stubApi();
  vi.spyOn(rulesApi, "createRuleDraft").mockResolvedValue(thresholdRule);
  renderWizard();
  await toCondition();
  await userEvent.selectOptions(screen.getByLabelText("Asset"), asset.id);
  await userEvent.selectOptions(screen.getByLabelText("Telemetry point"), "supply_temp_c");
  await userEvent.type(screen.getByLabelText("Threshold"), "10");
  await userEvent.type(screen.getByLabelText("Clear hold (seconds)"), "abc");
  await next();
  expect(screen.getByText(/clear hold as a number of seconds/i)).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Condition" })).toBeInTheDocument();
  expect(rulesApi.createRuleDraft).not.toHaveBeenCalled();
}

export async function showsAStoredValueWhenOpeningARule(): Promise<void> {
  stubApi();
  renderWizard(thresholdRule);
  await screen.findByLabelText("Rule name");
  await next();
  await waitFor(() => expect(screen.getByPlaceholderText("120 (default)")).toHaveValue("300"));
}

export async function hidesTheFieldForATimeWindowRule(): Promise<void> {
  stubApi();
  renderWizard(timeWindowRule);
  await screen.findByLabelText("Rule name");
  await next();
  await screen.findByLabelText("Start time");
  expect(screen.queryByPlaceholderText("120 (default)")).not.toBeInTheDocument();
}

/** `F4.204`: a refused save shows the server's sentence, not the Nest envelope. */
export async function aRefusedSaveShowsTheServerSentence(): Promise<void> {
  stubApi();
  const sentence = "A rule with code NEW_DRAFT_RULE already exists.";
  vi.spyOn(rulesApi, "createRuleDraft").mockRejectedValue(
    new Error(JSON.stringify({ statusCode: 409, message: sentence, error: "Conflict" })),
  );
  renderWizard();
  await toReview();
  await submit();
  const shown = await screen.findByText(sentence, { exact: false });
  expect(shown.textContent).not.toContain('{"');
}

/** Next on the Condition step with no asset stays, and shows the step's problem. */
export async function nextWithNoAssetStaysOnTheConditionStep(): Promise<void> {
  stubApi();
  renderWizard();
  await toCondition();
  await next();
  expect(screen.getByRole("region", { name: "Condition" })).toBeInTheDocument();
  expect(screen.getByRole("alert").textContent).toContain("assetId");
}

/** The Review card's sentence names the rule. */
export async function theReviewSummaryNamesTheRule(): Promise<void> {
  stubApi();
  renderWizard();
  await toReview();
  expect(screen.getByText(/Create the rule "New draft rule" on Chiller 1/)).toBeInTheDocument();
}

/** A copilot `fill_step` for `rule.create` step `condition` lands in the asset select. */
export async function aFillStepLandsInTheAssetSelect(): Promise<void> {
  stubApi();
  renderWizard();
  await screen.findByLabelText("Rule name");
  act(() =>
    useWizardStore
      .getState()
      .receiveFill({ catalogId: "rule.create", params: {}, stepId: "condition", values: { assetId: asset.id } }, null),
  );
  await toCondition();
  await waitFor(() => expect(screen.getByLabelText("Asset")).toHaveValue(asset.id));
}
