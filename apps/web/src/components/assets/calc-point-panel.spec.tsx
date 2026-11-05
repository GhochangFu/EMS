import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useState } from "react";
import { expect, vi } from "vitest";
import type { AssetPointCalcConfigDto } from "@bms/shared";

import * as assetPointsApi from "../../api/admin/asset-points";
import * as pointKeysApi from "../../api/admin/point-keys";
import { emptyCalcPointDraft, standaloneConfigFor, type CalcPointDraft } from "../../lib/calc-point-draft";
import type { FormulaEditorProps } from "../asset-templates/formula-editor-lazy";
import { CalcPointPanel } from "./calc-point-panel";
import { PointCalcFormulaFields, PointCalcScheduleFields } from "./point-calc-override-panel";

/**
 * `F4.311` PR 6a (ADR 0109 decision 5) — the standalone calculated point's
 * panel. Assertions live here; `calc-point-panel.test.tsx` is the Vitest
 * entry point (ADR 0014) and carries `@vitest-environment jsdom` (ADR 0042
 * decision 2).
 *
 * **The formula editor is a stand-in**, as in `calculations-tab.spec.tsx`:
 * the lazy chunk is CodeMirror, whose input handling in jsdom is a browser
 * claim, and a `<textarea>` carrying the props drives the panel's `onChange`
 * one keystroke at a time. Beside it, a button edits the formula the way
 * CodeMirror does — through `onChange` with no DOM `change` event — so the
 * dirty-guard claims cannot pass on the shell's own bubbled `change`.
 */

vi.mock("../asset-templates/formula-editor-lazy", () => ({
  FormulaEditorLazy: (props: FormulaEditorProps) => (
    <>
      <textarea
        aria-label={props.ariaLabel}
        value={props.value}
        readOnly={props.readOnly === true}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {/* CodeMirror edits a contenteditable: no DOM `change` reaches the shell. */}
      <button type="button" onClick={() => props.onChange(`${props.value} + 1`)}>
        Edit the formula as CodeMirror does
      </button>
    </>
  ),
}));

const ASSET = "f4311000-0000-4000-8000-0000000000a1";

const STORED: AssetPointCalcConfigDto = {
  ...standaloneConfigFor("pf"),
  label: "Power factor",
  assetPointId: "f4311000-0000-4000-8000-0000000000d1",
  override: {
    formula: "{kw} * 2",
    formulaDialect: "bms-calc-v1",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
    maxInputAgeSeconds: 600,
  },
  effective: {
    formula: "{kw} * 2",
    formulaDialect: "bms-calc-v1",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
    maxInputAgeSeconds: 600,
  },
};

function pointKey(code: string) {
  return {
    id: `id-${code}`,
    code,
    name: `${code} name`,
    domain: "electrical",
    unit: null,
    description: null,
    active: true,
    createdAt: new Date(0).toISOString(),
    headlineRank: null,
    trendDefault: false,
  };
}

function stubApi(): void {
  vi.spyOn(assetPointsApi, "fetchAdminAssetPoints").mockResolvedValue({
    items: [{ pointKey: "kw", sourceKind: "measured" }],
  } as never);
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockResolvedValue({
    items: [pointKey("kw"), pointKey("pf")],
  } as never);
}

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

type Spies = {
  onSubmit: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
};

function renderPanel(config: AssetPointCalcConfigDto | null): Spies {
  stubApi();
  const spies = { onSubmit: vi.fn(), onDelete: vi.fn(), onCancel: vi.fn() };
  render(
    withClient(
      <CalcPointPanel
        assetId={ASSET}
        config={config}
        saving={false}
        saveError={null}
        onEdited={() => undefined}
        onSubmit={spies.onSubmit}
        onDelete={config ? spies.onDelete : null}
        onCancel={spies.onCancel}
      />,
    ),
  );
  return spies;
}

async function next(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

/** The two field parts in their standalone form, over a page-owned draft. */
function FieldsHarness() {
  const [draft, setDraft] = useState<CalcPointDraft>(emptyCalcPointDraft("pf"));
  const fields = {
    config: standaloneConfigFor("pf"),
    draft,
    busy: false,
    standalone: true,
    onDraftChange: (patch: Partial<CalcPointDraft>) => setDraft({ ...draft, ...patch }),
  };
  return (
    <>
      <PointCalcFormulaFields {...fields} />
      <PointCalcScheduleFields {...fields} />
    </>
  );
}

export function inStandaloneModeNoOptionHasAnEmptyValue(): void {
  const { container } = render(<FieldsHarness />);
  const options = [...container.querySelectorAll("option")];
  expect([options.length > 0, options.filter((option) => option.value === "").length]).toEqual([true, 0]);
}

export function inStandaloneModeNoFieldHasATemplatePlaceholder(): void {
  const { container } = render(<FieldsHarness />);
  expect([...container.querySelectorAll("input[placeholder]")].map((input) => input.getAttribute("placeholder"))).toEqual(
    [],
  );
}

export async function thePreviewUpdatesOnAKeystroke(): Promise<void> {
  renderPanel(STORED);
  // The sample row renders only once the stored formula has been read into the draft.
  await userEvent.type(await screen.findByLabelText("Sample value for kw"), "3");
  expect(screen.getByRole("status", { name: "Preview result" }).textContent).toBe("= 6");
  await userEvent.type(screen.getByRole("textbox", { name: "Formula for pf" }), "0");
  expect(screen.getByRole("status", { name: "Preview result" }).textContent).toBe("= 60");
}

export async function addOpensTheWizardOnlyOnceAKeyIsChosen(): Promise<void> {
  renderPanel(null);
  const select = screen.getByLabelText("Point key");
  await within(select).findByText("pf · pf name");
  const before = screen.queryByRole("list", { name: "Steps" });
  await userEvent.selectOptions(select, "pf");
  expect([before, screen.getByRole("list", { name: "Steps" }).textContent]).toEqual([
    null,
    "1. Formula2. Schedule3. Backfill4. Review",
  ]);
}

export async function addOffersNoKeyTheAssetAlreadyHas(): Promise<void> {
  renderPanel(null);
  const select = screen.getByLabelText("Point key");
  await within(select).findByText("pf · pf name");
  expect(within(select).queryByText("kw · kw name")).toBeNull();
}

export async function anUnknownReferenceIsListedBeforeSubmit(): Promise<void> {
  renderPanel(STORED);
  const formula = await screen.findByRole("textbox", { name: "Formula for pf" });
  await userEvent.clear(formula);
  await userEvent.type(formula, "{{nope}");
  expect(await screen.findByText(/It may reference only the point keys this asset declares: kw\./)).toBeTruthy();
}

export async function submitSendsTheBackfillChosen(): Promise<void> {
  const { onSubmit } = renderPanel(STORED);
  await screen.findByLabelText("Sample value for kw");
  await next();
  await next();
  await userEvent.selectOptions(screen.getByLabelText("Backfill history"), "7");
  await next();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(onSubmit.mock.calls).toEqual([
    [
      "pf",
      {
        formula: "{kw} * 2",
        formulaDialect: "bms-calc-v1",
        calcTrigger: "scheduled",
        calcIntervalSeconds: 300,
        maxInputAgeSeconds: 600,
        backfillDays: 7,
      },
      null,
    ],
  ]);
}

export async function editOffersDeleteThatCallsOnDelete(): Promise<void> {
  const { onDelete } = renderPanel(STORED);
  await userEvent.click(screen.getByRole("button", { name: "Delete calculated point" }));
  expect(onDelete).toHaveBeenCalledTimes(1);
}

/** The leave prompt is up and the panel did not close. */
function askedBeforeLeaving(spies: Spies): [boolean, number] {
  return [screen.queryByRole("alertdialog", { name: "Leave the wizard" }) !== null, spies.onCancel.mock.calls.length];
}

export async function cancelAfterAFormulaOnlyEditOnEditAsks(): Promise<void> {
  const spies = renderPanel(STORED);
  await screen.findByLabelText("Sample value for kw");
  await userEvent.click(screen.getByRole("button", { name: "Edit the formula as CodeMirror does" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(askedBeforeLeaving(spies)).toEqual([true, 0]);
}

export async function cancelAfterAFormulaOnlyEditOnAddAsks(): Promise<void> {
  const spies = renderPanel(null);
  const select = screen.getByLabelText("Point key");
  await within(select).findByText("pf · pf name");
  await userEvent.selectOptions(select, "pf");
  await userEvent.click(screen.getByRole("button", { name: "Edit the formula as CodeMirror does" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(askedBeforeLeaving(spies)).toEqual([true, 0]);
}

export async function cancelOnAnUntouchedEditLeavesAtOnce(): Promise<void> {
  const spies = renderPanel(STORED);
  await screen.findByLabelText("Sample value for kw");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(askedBeforeLeaving(spies)).toEqual([false, 1]);
}

/**
 * `F4.314` (ADR 0038 Amendment 6 A1, ruling 3) — on the Add calculated point
 * panel a Formula help entry appends to the editor's text, through
 * `PointCalcFormulaFields`' draft setter.
 *
 * Mutation: replace the draft's formula with the entry's text instead of
 * appending it.
 */
export async function aHelpEntryAppendsToTheEditorsFormula(): Promise<void> {
  renderPanel(STORED);
  const formula = (await screen.findByRole("textbox", { name: "Formula for pf" })) as HTMLTextAreaElement;
  await screen.findByLabelText("Sample value for kw");
  await userEvent.click(screen.getByRole("button", { name: "Insert abs" }));
  expect(formula.value).toBe("{kw} * 2abs(");
}
