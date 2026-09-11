import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { adminAssetTemplateDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetTemplateDto, TemplateKpi } from "@bms/shared";

import * as templateApi from "../../api/admin/asset-templates";
import type { FormulaEditorProps } from "./formula-editor-lazy";
import { KpisTab } from "./kpis-tab";

/**
 * `F2.22` T7 — the KPIs tab treats a stored `bms-calc-v2` KPI as checked, and
 * gains Grammar: the target Validate upgrades an `"unvalidated"` row to, and
 * the one control that moves a checked row between dialects.
 *
 * Assertions live here; `kpis-tab.test.tsx` is the Vitest entry point (ADR
 * 0014) and carries `@vitest-environment jsdom` because that is the file
 * Vitest collects (ADR 0042 decision 2). This is the tab's first spec: its
 * form rules have been covered by `lib/template-kpi-form.spec.ts` since `F2.5`,
 * but nothing has ever rendered the tab.
 *
 * **The formula editor is a stand-in**, exactly as `calculations-tab.spec.tsx`
 * mocks it: a plain `<textarea>` carrying the tab's `ariaLabel`, `value`,
 * `readOnly` and `onChange`. The real editor rendering read-only on a frozen
 * version is `asset-template-stock-view-page.spec.tsx`'s claim, through
 * `data-formula-readonly`; case 4 here reads the tab's `readOnly` prop off the
 * stand-in and sweeps the tab's own controls separately.
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

const V1 = "bms-calc-v1";
const V2 = "bms-calc-v2";
const READS_LABEL = /Points this KPI reads/;
const VALIDATE = "Validate this expression";
const SAVE = "Save KPIs";
/**
 * `formatCalcError` of the `v1` parser's refusal at the `@` of
 * `sum({kw} @site)` — read off the red run, not predicted. Under `v1` `sum(`
 * and `{kw}` lex, the space is skipped, and the first character the lexer
 * cannot place is the `@` at offset 9.
 */
const V1_REFUSES_AT = "unexpected character at character 9";

/** The two stored KPIs, exactly as `buildKpiPayload` sends an unchanged row. */
const SITE_LOAD: TemplateKpi = {
  code: "site_load",
  name: "Site load",
  pointKeys: [],
  expression: "sum({kw} @site)",
  dialect: V2,
};
const DOUBLE: TemplateKpi = {
  code: "double",
  name: "Double",
  pointKeys: ["kw"],
  expression: "{kw} * 2",
  dialect: "unvalidated",
};

function measuredPoint(key: string): unknown {
  return {
    id: `id-${key}`,
    templateId: "t1",
    pointKey: key,
    label: null,
    unit: "kW",
    kind: "measured",
    sourceDataKeyPattern: null,
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    minCoverageRatio: null,
    required: true,
    sortOrder: 0,
    meta: null,
    createdAt: "2026-09-11T00:00:00.000Z",
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
  };
}

/**
 * The fixture: one measured `kw`, a stored `v2` KPI that reads only an
 * aggregate, and an `"unvalidated"` KPI with a manual list. The second row is
 * every case's positive control for what the first must *not* render.
 */
function fixture(status = "draft"): AdminAssetTemplateDto {
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
    status,
    content: { kpis: [SITE_LOAD, DOUBLE] },
    publishedAt: status === "published" ? "2026-09-11T00:00:00.000Z" : null,
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
    points: [measuredPoint("kw")],
  });
}

function renderTab(
  dto: AdminAssetTemplateDto,
  editable: boolean,
  onDirtyChange: (dirty: boolean) => void = vi.fn(),
): HTMLElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <KpisTab template={dto} editable={editable} onSaved={vi.fn()} onDirtyChange={onDirtyChange} />
    </QueryClientProvider>,
  );
  return container;
}

const grammarFor = (code: string) =>
  screen.getByRole("combobox", { name: `Grammar for ${code}` }) as HTMLSelectElement;
const expressionFor = (code: string) =>
  screen.getByRole("textbox", { name: `Expression for ${code}` }) as HTMLTextAreaElement;
/** The row's `<section>`, found from its Grammar select so every query is row-scoped. */
const rowOf = (code: string): HTMLElement => {
  const section = grammarFor(code).closest("section");
  if (section === null) {
    throw new Error(`no <section> encloses the Grammar select for ${code}`);
  }
  return section;
};
/** A `<select multiple>` is a listbox, not a combobox — the wrong role passes vacuously. */
const readsSelectIn = (row: HTMLElement) =>
  within(row).queryByRole("listbox", { name: READS_LABEL });
const sentKpis = (save: { mock: { calls: unknown[][] } }): TemplateKpi[] => {
  const [, body] = save.mock.calls[0] as [string, templateApi.UpdateAssetTemplateInput];
  return (body.content?.kpis ?? []) as TemplateKpi[];
};

/**
 * Case 1 — a stored `v2` KPI renders as checked: "Checked · reads nothing" (its
 * one reference is cross-asset, so the derived local list is empty), no manual
 * `Points this KPI reads` select, no Validate button, Grammar reading
 * `bms-calc-v2`, and the two reference forms taught underneath. The
 * `"unvalidated"` row is the positive control on each absence: it still has
 * the manual select and the Validate button, and teaches nothing.
 */
export async function aStoredV2KpiRendersAsChecked(): Promise<void> {
  renderTab(fixture(), true);

  const siteLoad = rowOf("site_load");
  expect(within(siteLoad).getByText("Checked · reads nothing")).toBeInTheDocument();
  expect(readsSelectIn(siteLoad)).toBeNull();
  expect(within(siteLoad).queryByRole("button", { name: VALIDATE })).toBeNull();
  expect(grammarFor("site_load").value).toBe(V2);
  expect(within(siteLoad).getByText(/a total or ratio over a set/)).toBeInTheDocument();
  expect(within(siteLoad).getByText(/a balance between named assets/)).toBeInTheDocument();

  const double = rowOf("double");
  expect(within(double).getByText(/^Not checked/)).toBeInTheDocument();
  expect(readsSelectIn(double)).not.toBeNull();
  expect(within(double).getByRole("button", { name: VALIDATE })).toBeInTheDocument();
  expect(grammarFor("double").value).toBe(V1);
  expect(within(double).queryByText(/a total or ratio over a set/)).toBeNull();
}

/**
 * Case 2 — Grammar on an `"unvalidated"` row is the target Validate upgrades
 * to. Set to `bms-calc-v2`, Validate turns `{kw} * 2` into a checked `v2` row
 * whose `pointKeys` are derived, and Save sends it that way. The `v2` row is
 * never touched: its whole payload entry reaching the server unchanged is the
 * untouched-row control.
 */
export async function validateUpgradesToTheChosenGrammar(): Promise<void> {
  const dto = fixture();
  const save = vi.spyOn(templateApi, "updateAdminAssetTemplate").mockResolvedValue(dto);
  renderTab(dto, true);

  await userEvent.selectOptions(grammarFor("double"), V2);
  await userEvent.click(within(rowOf("double")).getByRole("button", { name: VALIDATE }));

  const double = rowOf("double");
  expect(within(double).getByText("Checked · reads kw")).toBeInTheDocument();
  expect(readsSelectIn(double)).toBeNull();
  expect(grammarFor("double").value).toBe(V2);

  const saveButton = screen.getByRole("button", { name: SAVE });
  expect(saveButton).toBeEnabled();
  await userEvent.click(saveButton);
  await waitFor(() => {
    expect(save).toHaveBeenCalledTimes(1);
  });

  const kpis = sentKpis(save);
  expect(kpis).toHaveLength(2);
  expect(kpis[1]).toEqual({ ...DOUBLE, dialect: V2, pointKeys: ["kw"] });
  expect(kpis[0]).toEqual(SITE_LOAD);
}

/**
 * Case 3 — a refused dialect change leaves the row alone (design decision 2,
 * through `setKpiDialect`). Moving `sum({kw} @site)` to `bms-calc-v1` renders
 * the `v1` parser's refusal in that row only, the select still reads
 * `bms-calc-v2`, and after a dirtying edit on the *other* row Save still sends
 * the `v2` row exactly as stored. The dirtying edit is what makes the Save
 * assertion non-vacuous: without it `!changed` alone disables Save.
 */
export async function aRefusedGrammarChangeLeavesTheRowAlone(): Promise<void> {
  const dto = fixture();
  const save = vi.spyOn(templateApi, "updateAdminAssetTemplate").mockResolvedValue(dto);
  const onDirtyChange = vi.fn();
  renderTab(dto, true, onDirtyChange);

  await userEvent.selectOptions(grammarFor("site_load"), V1);

  const siteLoad = rowOf("site_load");
  expect(within(siteLoad).getByText(V1_REFUSES_AT)).toBeInTheDocument();
  expect(within(rowOf("double")).queryByText(V1_REFUSES_AT)).toBeNull();
  expect(grammarFor("site_load").value).toBe(V2);
  expect(within(siteLoad).getByText("Checked · reads nothing")).toBeInTheDocument();
  expect(readsSelectIn(siteLoad)).toBeNull();

  await userEvent.type(within(rowOf("double")).getByRole("textbox", { name: "Name" }), " x");
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);

  const saveButton = screen.getByRole("button", { name: SAVE });
  expect(saveButton).toBeEnabled();
  await userEvent.click(saveButton);
  await waitFor(() => {
    expect(save).toHaveBeenCalledTimes(1);
  });

  const kpis = sentKpis(save);
  expect(kpis).toHaveLength(2);
  expect(kpis[0]).toEqual(SITE_LOAD);
  expect(kpis[1]).toEqual({ ...DOUBLE, name: "Double x" });
}

/**
 * Case 4 — a frozen version renders every control disabled and no Save.
 *
 * The same sweep `asset-template-stock-view-page.spec.tsx` runs: every
 * `input, select, textarea` must be disabled, not absent. The expression
 * stand-in is excluded from the sweep and read through its `readOnly` — see
 * the module docblock.
 */
export async function aFrozenVersionDisablesEveryControl(): Promise<void> {
  const container = renderTab(fixture("published"), false);

  const controls = [...container.querySelectorAll<HTMLElement>("input, select, textarea")];
  const own = controls.filter(
    (field) => !/^Expression for /.test(field.getAttribute("aria-label") ?? ""),
  );
  // Five on the checked row (Code, Name, Unit, Direction, Grammar) and six on
  // the unvalidated row (plus the manual points list) — the positive control
  // that the sweep below is reading a rendered tab and not an empty one.
  expect(own).toHaveLength(11);
  expect(
    own.filter((field) => !(field as HTMLInputElement).disabled).map((field) => field.outerHTML),
  ).toEqual([]);
  expect(grammarFor("site_load")).toBeDisabled();
  expect(grammarFor("double")).toBeDisabled();
  expect(readsSelectIn(rowOf("double"))).toBeDisabled();

  expect(expressionFor("site_load")).toHaveAttribute("readonly");
  expect(expressionFor("double")).toHaveAttribute("readonly");
  expect(screen.queryByRole("button", { name: SAVE })).toBeNull();
  expect(screen.queryByRole("button", { name: VALIDATE })).toBeNull();
}
