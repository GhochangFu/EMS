import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { RuleBuilderCatalogAsset, RuleListItem, VocabulariesResponse } from "@bms/shared";

import * as rulesApi from "../../api/rules";
import * as vocabApi from "../../api/vocabularies";
import { RulesPanel } from "../rules-panel";
import { RuleBatchWizard } from "./rule-batch-wizard";

/**
 * `F4.289` (ADR 0099 Amendment 9 E3; owner ruling P1) — the Rule Engine's
 * batch-create wizard: `rule.createBatch` on `WizardShell`, a table form of up
 * to 25 rows, Submit posting the plain `POST /rules/batch`. The builder catalog
 * and the vocabularies are spies; `fetch` is stubbed and read for the write (an
 * unstubbed fetch reaches `:4000`). Vitest entry point: the sibling
 * `.test.tsx` (jsdom docblock there).
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const asset: RuleBuilderCatalogAsset = {
  id: "55555555-5555-4555-8555-555555555555",
  code: "CH-01",
  name: "Chiller 1",
  siteName: "West Campus",
  domain: "hvac",
  pointKeys: ["supply_temp_c", "return_temp_c"],
};

const vocabularies: VocabulariesResponse = {
  ruleCategories: [{ code: "hvac", label: "HVAC", active: true, sortOrder: 1, tone: "neutral" }],
  assetDomains: [{ code: "hvac", label: "HVAC", active: true, sortOrder: 1 }],
  alarmSeverities: [
    { code: "warning", label: "Warning", active: true, tone: "warning", rank: 1 },
    { code: "critical", label: "Critical", active: true, tone: "critical", rank: 2 },
  ],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
  waterBalanceRoles: [],
};

type Seen = { url: string; init: RequestInit };

/** The spies, and a `fetch` stub that records the write and answers `{ items: [] }`. */
function stubApi(): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ items: [] }), { status: 201 });
    }),
  );
  vi.spyOn(rulesApi, "fetchRuleBuilderCatalog").mockResolvedValue({ assets: [asset] });
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(vocabularies);
  return seen;
}

function renderWizard(onDone: () => void = () => {}): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RuleBatchWizard onCancel={() => {}} onDone={onDone} />
    </QueryClientProvider>,
  );
}

const next = () => userEvent.click(screen.getByRole("button", { name: "Next" }));
const addRow = () => userEvent.click(screen.getByRole("button", { name: "Add row" }));

/** Fills row `n` (1-based) with a complete threshold rule. */
async function fillRow(n: number, name: string, pointKey: string, threshold: string): Promise<void> {
  await userEvent.type(screen.getByLabelText(`Row ${n} name`), name);
  await userEvent.selectOptions(await screen.findByLabelText(`Row ${n} asset`), asset.id);
  await userEvent.selectOptions(screen.getByLabelText(`Row ${n} point`), pointKey);
  await userEvent.type(screen.getByLabelText(`Row ${n} threshold`), threshold);
}

/** Two complete rows, the second `critical`, then Next to Review. */
async function twoRowsToReview(): Promise<void> {
  await screen.findByRole("option", { name: "CH-01" });
  await fillRow(1, "Supply high", "supply_temp_c", "12");
  await addRow();
  await fillRow(2, "Return high", "return_temp_c", "18.5");
  await userEvent.selectOptions(screen.getByLabelText("Row 2 severity"), "critical");
  await next();
  await screen.findByRole("button", { name: "Submit" });
}

/** The steps are the entry's Rules step, then Review. */
export async function theStepsAreRulesThenReview(): Promise<void> {
  stubApi();
  renderWizard();
  const steps = await screen.findByRole("list", { name: "Steps" });
  expect(within(steps).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["1. Rules", "2. Review"]);
}

/** Add row stops at the 25-row cap: 25 rows, and the button is disabled. */
export async function addRowStopsAtTwentyFive(): Promise<void> {
  stubApi();
  renderWizard();
  await screen.findByLabelText("Row 1 name");
  for (let at = 1; at < 25; at += 1) await addRow();
  expect(screen.getAllByLabelText(/^Row \d+ name$/)).toHaveLength(25);
  expect((screen.getByRole("button", { name: "Add row" }) as HTMLButtonElement).disabled).toBe(true);
}

/** Removing row 1 of two keeps row 2's values in row 1. */
export async function removingARowKeepsTheOthers(): Promise<void> {
  stubApi();
  renderWizard();
  await screen.findByLabelText("Row 1 name");
  await userEvent.type(screen.getByLabelText("Row 1 name"), "First");
  await addRow();
  await userEvent.type(screen.getByLabelText("Row 2 name"), "Second");
  await userEvent.click(screen.getByRole("button", { name: "Remove row 1" }));
  expect(screen.getAllByLabelText(/^Row \d+ name$/).map((input) => (input as HTMLInputElement).value)).toEqual(["Second"]);
}

/**
 * Next with a row that has no name stays on the Rules step and names that row
 * as the table numbers it (`#` from 1, the route's `Row N:`) — never the
 * 0-based Zod path `rules.1.name`, which reads as the complete row 1.
 */
export async function nextWithAnIncompleteRowStaysAndNamesIt(): Promise<void> {
  stubApi();
  renderWizard();
  await screen.findByRole("option", { name: "CH-01" });
  await fillRow(1, "Supply high", "supply_temp_c", "12");
  await addRow();
  await next();
  expect(screen.getByRole("region", { name: "Rules" })).toBeTruthy();
  const alert = screen.getByRole("alert").textContent ?? "";
  expect(alert).toContain("Row 2 name:");
  expect(alert).not.toContain("rules.");
}

/** A threshold that is not a number names the row and the table's column, `threshold`, not `thresholdValue`. */
export async function aTextThresholdNamesTheRowAndItsColumn(): Promise<void> {
  stubApi();
  renderWizard();
  await screen.findByRole("option", { name: "CH-01" });
  await fillRow(1, "Supply high", "supply_temp_c", "warm");
  await next();
  expect(screen.getByRole("alert").textContent).toContain("Row 1 threshold:");
}

/** Submit posts the rows, with numeric thresholds, to the batch route — the plain request, no copilot header. */
export async function submitPostsTheRowsToTheBatchRoute(): Promise<void> {
  const seen = stubApi();
  const onDone = vi.fn();
  renderWizard(onDone);
  await twoRowsToReview();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(seen).toHaveLength(1);
  expect(seen[0]!.url).toBe(`${BASE}/api/v1/rules/batch`);
  expect(seen[0]!.init.method).toBe("POST");
  expect(new Headers(seen[0]!.init.headers).get("X-Copilot-Change")).toBeNull();
  const shared = { ruleType: "threshold", assetId: asset.id, operator: "gt", condition: { window: "latest" }, action: { type: "notify", target: "Operations" } };
  expect(JSON.parse(seen[0]!.init.body as string)).toEqual({
    rules: [
      { ...shared, name: "Supply high", pointKey: "supply_temp_c", thresholdValue: 12, severity: "warning" },
      { ...shared, name: "Return high", pointKey: "return_temp_c", thresholdValue: 18.5, severity: "critical" },
    ],
  });
}

/** Ruling P2 on the wizard too: the Review card is red, and its sentence counts the rows and carries the live line. */
export async function theReviewCardIsRedAndCountsTheRows(): Promise<void> {
  stubApi();
  renderWizard();
  await twoRowsToReview();
  const card = screen.getByRole("region", { name: "Create and publish alarm rules" });
  expect(card.className).toContain("border-critical-line");
  expect(card.textContent).toContain("Create and publish 2 alarm rules on 1 asset. This changes live alarm behaviour now.");
}

/** The Review lists every row in a table — its name, asset code, point, operator, threshold and severity. */
export async function theReviewListsEachRowInATable(): Promise<void> {
  stubApi();
  renderWizard();
  await twoRowsToReview();
  const table = screen.getByRole("table", { name: "Rules to create" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(2);
  const cells = within(rows[1]!).getAllByRole("cell").map((cell) => cell.textContent);
  expect(cells[0]).toBe("2");
  expect(cells[1]).toContain("Return high");
  expect(cells.slice(2)).toEqual(["CH-01", "return_temp_c", "gt", "18.5", "critical"]);
}

/** The rows reach the Review only through the table: no field row shows them as JSON. */
export async function theReviewShowsNoRulesJson(): Promise<void> {
  stubApi();
  renderWizard();
  await twoRowsToReview();
  const card = screen.getByRole("region", { name: "Create and publish alarm rules" });
  expect(within(card).getByRole("table", { name: "Rules to create" })).toBeTruthy();
  expect(card.textContent).not.toContain('[{"name"');
}

/** The Rule Engine page opens the wizard from its New batch button. */
export async function theRulesPanelOpensTheBatchWizard(): Promise<void> {
  stubApi();
  vi.spyOn(rulesApi, "fetchRules").mockResolvedValue({ items: [] as RuleListItem[] });
  vi.spyOn(rulesApi, "fetchRuleExecutions").mockResolvedValue({ items: [] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RulesPanel />
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: "New batch" }));
  expect(await screen.findByRole("dialog", { name: "Create and publish alarm rules" })).toBeTruthy();
}
