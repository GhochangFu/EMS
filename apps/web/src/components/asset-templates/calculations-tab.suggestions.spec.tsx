import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import type { AdminAssetTemplateDto } from "@bms/shared";

import * as templatesApi from "../../api/admin/asset-templates";
import { stockEntry, templateRow, templateVersion } from "../../lib/formula-suggestions.spec";
import { CalculationsTab } from "./calculations-tab";
import type { FormulaEditorProps } from "./formula-editor-lazy";

/**
 * `F4.314` PR 2 (ADR 0038 Amendment 6 A3, ruling 6) — Suggested formulas on
 * the template Calculations tab. Taking one goes through `suggestionRow`
 * (`setCalcTrigger`, then `setFormulaDialect`), one claim per carried field;
 * the tab's own version is never read; a published version disables **Use
 * this formula** (A6). Assertions live here;
 * `calculations-tab.suggestions.test.tsx` is the jsdom entry point. The
 * editor is `calculations-tab.spec.tsx`'s `<textarea>` stand-in.
 */

vi.mock("./formula-editor-lazy", () => ({
  FormulaEditorLazy: (props: FormulaEditorProps) => (
    <textarea
      aria-label={props.ariaLabel}
      value={props.value}
      readOnly={props.readOnly === true}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

const TAKEN_FORMULA = "sum({kw} @site)";

/** The tab's own version `own`: a measured `kw` and a `v1` streaming derived `d1`. */
function tabTemplate(status: "draft" | "published" = "draft"): AdminAssetTemplateDto {
  return templateVersion({ id: "own", code: "FEEDER", version: 3, status }, [
    { pointKey: "kw", kind: "measured" },
    { pointKey: "d1", formula: "{kw} * 2", formulaDialect: "bms-calc-v1", calcTrigger: "streaming", calcIntervalSeconds: null },
  ]);
}

function stubReads() {
  vi.spyOn(templatesApi, "fetchAdminStockAssetTemplates").mockResolvedValue({
    items: [
      stockEntry("Electrical feeder", [
        {
          pointKey: "d1",
          formula: TAKEN_FORMULA,
          formulaDialect: "bms-calc-v2",
          calcTrigger: "scheduled",
          calcIntervalSeconds: 120,
          maxInputAgeSeconds: 900,
        },
      ]),
    ],
  });
  vi.spyOn(templatesApi, "fetchAdminAssetTemplates").mockResolvedValue({
    items: [templateRow({ id: "own", code: "FEEDER", version: 3 }), templateRow({ id: "other", code: "FEEDER", version: 2 })],
  });
  return vi
    .spyOn(templatesApi, "fetchAdminAssetTemplate")
    .mockResolvedValue(templateVersion({ id: "other", code: "FEEDER", version: 2 }, [{ pointKey: "d1", formula: "{kw} * 7" }]));
}

function renderTab(status: "draft" | "published" = "draft") {
  const one = stubReads();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CalculationsTab template={tabTemplate(status)} editable={status === "draft"} onSaved={vi.fn()} onDirtyChange={vi.fn()} />
    </QueryClientProvider>,
  );
  return one;
}

const USE = "Use this formula from Stock · Electrical feeder";

async function takeTheStockSuggestion(): Promise<void> {
  renderTab();
  await userEvent.click(await screen.findByRole("button", { name: USE }));
}

/** Mutation: `onTake` does nothing. */
export async function takingFillsTheRowsFormula(): Promise<void> {
  await takeTheStockSuggestion();
  expect((screen.getByRole("textbox", { name: "Formula for d1" }) as HTMLTextAreaElement).value).toBe(TAKEN_FORMULA);
}

/** Mutation: `onTake` writes `{ ...entry, formula }` instead of `suggestionRow` (this and the three below). */
export async function takingSetsTheRowsGrammar(): Promise<void> {
  await takeTheStockSuggestion();
  expect((screen.getByRole("combobox", { name: "Grammar for d1" }) as HTMLSelectElement).value).toBe("bms-calc-v2");
}

/** …sets the row's Runs. Mutation: `onTake` writes `{ ...entry, formula }`. */
export async function takingSetsTheRowsRuns(): Promise<void> {
  await takeTheStockSuggestion();
  expect((screen.getByRole("combobox", { name: "Runs for d1" }) as HTMLSelectElement).value).toBe("scheduled");
}

/** …sets the row's Every. Mutation: `onTake` writes `{ ...entry, formula }`. */
export async function takingSetsTheRowsEvery(): Promise<void> {
  await takeTheStockSuggestion();
  expect((screen.getByLabelText("Every (seconds)") as HTMLInputElement).value).toBe("120");
}

/** …sets the row's Ignore inputs older than. Mutation: `onTake` writes `{ ...entry, formula }`. */
export async function takingSetsTheRowsInputAge(): Promise<void> {
  await takeTheStockSuggestion();
  expect((screen.getByLabelText("Ignore inputs older than") as HTMLInputElement).value).toBe("900");
}

/** The tab's own version is never read; another published version is. Mutation: drop `excludeTemplateId`. */
export async function theTabsOwnVersionIsNotRead(): Promise<void> {
  const one = renderTab();
  await screen.findByText("{kw} * 7");
  expect(one.mock.calls.map(([id]) => id)).toEqual(["other"]);
}

/** On a published version **Use this formula** is disabled (A6). Mutation: `disabled={false}`. */
export async function aPublishedVersionDisablesUse(): Promise<void> {
  renderTab("published");
  expect(await screen.findByRole("button", { name: USE })).toBeDisabled();
}
