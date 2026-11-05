import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, vi } from "vitest";

import { assetPointCalcConfigDtoSchema } from "@bms/shared/contracts";
import type { AssetPointCalcConfigDto } from "@bms/shared";

import * as templatesApi from "../../api/admin/asset-templates";
import { EMPTY_DRAFT, type OverrideDraft } from "../../lib/asset-point-calc-override";
import { stockEntry } from "../../lib/formula-suggestions.spec";
import { PointCalcOverridePanel } from "./point-calc-override-panel";

/**
 * `F4.314` PR 2 (ADR 0038 Amendment 6 A3, rulings 6 and 7) — Suggested
 * formulas on the override panel, through `PointCalcFormulaFields`' own draft
 * setter (the same part the override wizard, the Add panel and the bulk
 * wizard render). One claim per carried field: taking a suggestion fills the
 * formula, the Grammar, Runs, Every and Inputs valid for. Assertions live
 * here; `point-calc-override-panel.suggestions.test.tsx` is the jsdom entry
 * point (ADR 0042 decision 2).
 */

const TAKEN_FORMULA = "{voltage_l1_v} * 3";

function config(): AssetPointCalcConfigDto {
  const template = {
    formula: "{KW} * 2",
    formulaDialect: "bms-calc-v1",
    calcTrigger: "streaming",
    calcIntervalSeconds: null,
    maxInputAgeSeconds: 600,
  };
  return assetPointCalcConfigDtoSchema.parse({
    pointKey: "kw",
    kind: "override",
    templatePointId: "tp-1",
    label: "Power",
    unit: "kW",
    assetPointId: null,
    template,
    override: { formula: null, formulaDialect: null, calcTrigger: null, calcIntervalSeconds: null, maxInputAgeSeconds: null },
    effective: template,
    minCoverageRatio: null,
    runtime: null,
    backfill: null,
  });
}

function stubReads(): void {
  vi.spyOn(templatesApi, "fetchAdminStockAssetTemplates").mockResolvedValue({
    items: [
      stockEntry("Electrical feeder", [
        {
          pointKey: "kw",
          formula: TAKEN_FORMULA,
          formulaDialect: "bms-calc-v2",
          calcTrigger: "scheduled",
          calcIntervalSeconds: 120,
          maxInputAgeSeconds: 900,
        },
      ]),
    ],
  });
  vi.spyOn(templatesApi, "fetchAdminAssetTemplates").mockResolvedValue({ items: [] });
}

/** The page's wiring: the draft lives above the panel and flows back down. */
function Harness() {
  const [draft, setDraft] = useState<OverrideDraft>(EMPTY_DRAFT);
  return (
    <PointCalcOverridePanel
      config={config()}
      draft={draft}
      saving={false}
      clearing={false}
      onDraftChange={setDraft}
      onSave={() => undefined}
      onClear={() => undefined}
      onCancel={() => undefined}
      suggestions={{ organizationCode: "ESKOM", domain: "electrical", assetKeys: ["current_l1_a"] }}
    />
  );
}

async function takeTheStockSuggestion(): Promise<void> {
  stubReads();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: "Use this formula from Stock · Electrical feeder" }));
}

/** Mutation: `onTake` does nothing in `PointCalcFormulaFields`. */
export async function takingFillsTheFormula(): Promise<void> {
  await takeTheStockSuggestion();
  expect((screen.getByRole("textbox", { name: "Formula for kw" }) as HTMLInputElement).value).toBe(TAKEN_FORMULA);
}

/** Mutation: `onTake` writes `{ formula }` alone (this and the three timing claims below). */
export async function takingSetsTheGrammar(): Promise<void> {
  await takeTheStockSuggestion();
  expect((screen.getByRole("combobox", { name: "Grammar for kw" }) as HTMLSelectElement).value).toBe("bms-calc-v2");
}

export async function takingSetsRuns(): Promise<void> {
  await takeTheStockSuggestion();
  expect((screen.getByRole("combobox", { name: "Runs for kw" }) as HTMLSelectElement).value).toBe("scheduled");
}

export async function takingSetsEvery(): Promise<void> {
  await takeTheStockSuggestion();
  expect((screen.getByLabelText("Every (seconds)") as HTMLInputElement).value).toBe("120");
}

export async function takingSetsInputsValidFor(): Promise<void> {
  await takeTheStockSuggestion();
  expect((screen.getByLabelText("Inputs valid for (seconds)") as HTMLInputElement).value).toBe("900");
}

/** The asset keys mark the missing input. Mutation: the panel does not pass `suggestions` to its fields. */
export async function thePanelMarksTheMissingInput(): Promise<void> {
  await takeTheStockSuggestion();
  expect(screen.getByText("needs {voltage_l1_v}, which this asset does not have")).toBeInTheDocument();
}
