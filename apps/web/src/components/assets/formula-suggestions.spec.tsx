import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import type { StockAssetTemplatesListResponse } from "@bms/shared";

import * as templatesApi from "../../api/admin/asset-templates";
import { stockEntry, templateRow, templateVersion } from "../../lib/formula-suggestions.spec";
import { FormulaSuggestions } from "./formula-suggestions";

/**
 * `F4.314` PR 2 (ADR 0038 Amendment 6 decision A3) — the Suggested formulas
 * section. Assertions live here; `formula-suggestions.test.tsx` is the Vitest
 * entry point (ADR 0014) and carries `@vitest-environment jsdom` (ADR 0042
 * decision 2). The three reads are spied on the API module, as the page
 * specs do; the fixtures are the lib spec's schema-parsed builders. Each
 * helper names the mutation that reddens it.
 */

const KW_STOCK = "{voltage_l1_v} * {current_l1_a} / 1000";

const STOCK: StockAssetTemplatesListResponse = {
  items: [
    stockEntry("Electrical feeder", [
      { pointKey: "kw", formula: KW_STOCK, calcTrigger: "scheduled", calcIntervalSeconds: 60, maxInputAgeSeconds: 300 },
    ]),
  ],
};

const PUBLISHED = templateVersion({ id: "t-pub", code: "PUMP-M", version: 2 }, [{ pointKey: "kw", formula: "{p_kw} * 1" }]);
const DRAFT = templateVersion({ id: "t-draft", code: "PUMP-M", version: 3, status: "draft" }, [
  { pointKey: "kw", formula: "{draft_kw} * 1" },
]);

type Reads = { list?: "ok" | "403"; stock?: "ok" | "fail" };

function stubReads(reads: Reads = {}) {
  const stock = vi.spyOn(templatesApi, "fetchAdminStockAssetTemplates");
  if (reads.stock === "fail") stock.mockRejectedValue(new Error("stock unavailable"));
  else stock.mockResolvedValue(STOCK);
  const list = vi.spyOn(templatesApi, "fetchAdminAssetTemplates");
  if (reads.list === "403") list.mockRejectedValue(new Error("Organization is outside your access scope"));
  else list.mockResolvedValue({ items: [templateRow({ id: "t-pub", version: 2 }), templateRow({ id: "t-draft", version: 3, status: "draft" })] });
  const one = vi
    .spyOn(templatesApi, "fetchAdminAssetTemplate")
    .mockImplementation(async (id: string) => (id === "t-pub" ? PUBLISHED : DRAFT));
  return { stock, list, one };
}

type Options = { organizationCode?: string | null; disabled?: boolean };

function renderSuggestions(options: Options = {}) {
  const onTake = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <FormulaSuggestions
        pointKey="kw"
        organizationCode={options.organizationCode === undefined ? "ESKOM" : options.organizationCode}
        domain="electrical"
        assetKeys={["current_l1_a"]}
        disabled={options.disabled ?? false}
        onTake={onTake}
      />
    </QueryClientProvider>,
  );
  return { onTake, container: view.container };
}

/** The stock catalog's `kw` formula is listed. Mutation: pass `stock: []` to `suggestedFormulas`. */
export async function listsTheStockFormula(): Promise<void> {
  stubReads();
  renderSuggestions();
  expect(await screen.findByText(KW_STOCK)).toBeInTheDocument();
}

/** The organization's published version is listed. Mutation: pass `templates: []` to `suggestedFormulas`. */
export async function listsThePublishedVersionsFormula(): Promise<void> {
  stubReads();
  renderSuggestions();
  expect(await screen.findByText("{p_kw} * 1")).toBeInTheDocument();
}

/** A draft list row is never read. Mutation: drop the `status` filter in `suggestionTemplateIds`. */
export async function readsNoDraftVersion(): Promise<void> {
  const { one } = stubReads();
  renderSuggestions();
  await screen.findByText("{p_kw} * 1");
  expect(one).not.toHaveBeenCalledWith("t-draft");
}

/** The input the asset lacks is named. Mutation: drop the missing-input sentence. */
export async function marksTheMissingInput(): Promise<void> {
  stubReads();
  renderSuggestions();
  expect(await screen.findByText("needs {voltage_l1_v}, which this asset does not have")).toBeInTheDocument();
}

/**
 * **Use this formula** hands the whole suggestion — formula, dialect and the
 * three timing fields — to `onTake`. Mutation: `onTake({ ...suggestion,
 * calcTrigger: null })`.
 */
export async function useHandsFormulaDialectAndTiming(): Promise<void> {
  stubReads();
  const { onTake } = renderSuggestions();
  await userEvent.click(await screen.findByRole("button", { name: "Use this formula from Stock · Electrical feeder" }));
  expect(onTake).toHaveBeenCalledWith(
    expect.objectContaining({
      formula: KW_STOCK,
      formulaDialect: "bms-calc-v1",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 60,
      maxInputAgeSeconds: 300,
    }),
  );
}

/** A 403 on the published list still lists the stock entries. Mutation: render nothing on a list error. */
export async function a403OnTheListStillListsStock(): Promise<void> {
  stubReads({ list: "403" });
  renderSuggestions();
  expect(await screen.findByText(KW_STOCK)).toBeInTheDocument();
}

/** The list is read without `organizationId` (the 403 fact). Mutation: pass one. */
export async function theListIsReadWithoutAnOrganization(): Promise<void> {
  const { list } = stubReads();
  renderSuggestions();
  await screen.findByText(KW_STOCK);
  expect(list).toHaveBeenCalledWith("published");
}

/** With no organization the list is not read. Mutation: drop `organizationCode !== null` from `enabled`. */
export async function noOrganizationReadsNoList(): Promise<void> {
  const { list } = stubReads();
  renderSuggestions({ organizationCode: null });
  await screen.findByText(KW_STOCK);
  expect(list).not.toHaveBeenCalled();
}

/** Every read failing renders nothing. Mutation: drop the `suggestions.length === 0` guard. */
export async function everyReadFailingRendersNothing(): Promise<void> {
  const { stock } = stubReads({ stock: "fail", list: "403" });
  const { container } = renderSuggestions();
  await waitFor(() => expect(stock).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(container).toBeEmptyDOMElement();
}

/** `disabled` disables **Use this formula** (decision A6). Mutation: drop `disabled` from the button. */
export async function disabledDisablesUse(): Promise<void> {
  stubReads();
  renderSuggestions({ disabled: true });
  expect(await screen.findByRole("button", { name: "Use this formula from Stock · Electrical feeder" })).toBeDisabled();
}
