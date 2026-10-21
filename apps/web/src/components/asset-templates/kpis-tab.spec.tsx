import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { adminAssetTemplateDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetTemplateDto, TemplateKpi } from "@bms/shared";

import * as templateApi from "../../api/admin/asset-templates";
import { resetWizardStore, useWizardStore } from "../../stores/wizard-store";
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
const TEMPLATE_ID = "a1a1a1a1-0000-4000-8000-0000000000a1";
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
    templateId: TEMPLATE_ID,
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
    id: TEMPLATE_ID,
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
 * `F3.85` PR 11a (ADR 0099 decision 6, plan §11.3 unit 3) — **Save KPIs**
 * opens the `assetTemplate.update` wizard, and only its Review's **Submit**
 * sends. The entry's field steps are content, points and details, so three
 * **Next** clicks reach Review.
 */
async function submitThroughTheWizard(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: SAVE }));
  for (let step = 0; step < 3; step += 1) {
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
  }
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
}

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

  expect(screen.getByRole("button", { name: SAVE })).toBeEnabled();
  await submitThroughTheWizard();
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

  expect(screen.getByRole("button", { name: SAVE })).toBeEnabled();
  await submitThroughTheWizard();
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
  // Six on the checked row (Code, Name, Unit, Direction, Grammar, and the
  // preview's one sample input for `sum(kw) @site`) and six on the
  // unvalidated row (plus the manual points list, and no preview — ADR 0038
  // decision 9) — the positive control that the sweep below is reading a
  // rendered tab and not an empty one. `F2.22` T8 moved this from 11: the
  // preview renders disabled on a frozen version, not absent.
  expect(own).toHaveLength(12);
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

/** The one edit the wizard cases make: a name on the unvalidated row. */
async function renameDouble(): Promise<void> {
  await userEvent.type(within(rowOf("double")).getByRole("textbox", { name: "Name" }), " x");
}

const RENAMED_BODY = { content: { kpis: [SITE_LOAD, { ...DOUBLE, name: "Double x" }] } };

/**
 * Case 5 — **Save KPIs** opens the wizard on its first step and sends nothing.
 * The absence (no call) sits beside its positive: the wizard's step list is
 * on screen with the first step current.
 */
export async function saveOpensTheWizardAndSendsNothing(): Promise<void> {
  const dto = fixture();
  const save = vi.spyOn(templateApi, "updateAdminAssetTemplate").mockResolvedValue(dto);
  renderTab(dto, true);
  await renameDouble();

  await userEvent.click(screen.getByRole("button", { name: SAVE }));

  const steps = screen.getByRole("list", { name: "Steps" });
  expect(within(steps).getByText(/KPIs and content/)).toHaveAttribute("aria-current", "step");
  expect(save).not.toHaveBeenCalled();
}

/**
 * Case 6 — the wizard's content step lists every KPI with its expression in
 * full (the Review card's JSON cell is cut at 160 characters; this step is not).
 */
export async function theContentStepShowsEveryExpressionInFull(): Promise<void> {
  renderTab(fixture(), true);
  await renameDouble();

  await userEvent.click(screen.getByRole("button", { name: SAVE }));

  const step = screen.getByRole("region", { name: "KPIs and content" });
  expect(within(step).getByText(SITE_LOAD.expression)).toBeInTheDocument();
  expect(within(step).getByText(DOUBLE.expression)).toBeInTheDocument();
}

/**
 * Case 7 — Submit sends exactly the merged body: `content` alone, with the
 * stored KPI unchanged and the edited one renamed.
 */
export async function submitSendsTheMergedContentAlone(): Promise<void> {
  const dto = fixture();
  const save = vi.spyOn(templateApi, "updateAdminAssetTemplate").mockResolvedValue(dto);
  renderTab(dto, true);
  await renameDouble();

  await submitThroughTheWizard();
  await waitFor(() => {
    expect(save).toHaveBeenCalledTimes(1);
  });

  expect(save.mock.calls[0]).toEqual([TEMPLATE_ID, RENAMED_BODY]);
}

/**
 * Case 8 — the Review shows the stored content beside the new: the card has a
 * **Now** column, which `ChangeCard` renders only when a row carries a before.
 */
export async function theReviewShowsTheStoredContentBesideTheNew(): Promise<void> {
  renderTab(fixture(), true);
  await renameDouble();

  await userEvent.click(screen.getByRole("button", { name: SAVE }));
  for (let step = 0; step < 3; step += 1) {
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
  }

  expect(screen.getByRole("columnheader", { name: "Now" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "After" })).toBeInTheDocument();
}

/**
 * Case 9 — the wizard alone sends **no** `X-Copilot-Change` header (plan §10.5
 * as built: a copilot write goes only through the dock's ConfirmCard). The
 * global `fetch` is stubbed, not the wrapper, because the header is only
 * observable on the request. The positive comes first: the `PATCH` fired, at
 * this template, with the merged body.
 */
export async function theWizardAloneSendsNoCopilotHeader(): Promise<void> {
  const dto = fixture();
  const seen: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(dto), { status: 200 });
  });
  try {
    renderTab(dto, true);
    await renameDouble();

    await submitThroughTheWizard();
    await waitFor(() => {
      expect(seen).toHaveLength(1);
    });

    const [{ url, init }] = seen;
    expect(url).toMatch(new RegExp(`/api/v1/admin/asset-templates/${TEMPLATE_ID}$`));
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual(RENAMED_BODY);
    const headers = new Headers(init.headers);
    expect([...headers.keys()].filter((name) => name.toLowerCase() === "x-copilot-change")).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
}

/** A stored non-KPI section — the one a wholesale content fill would delete. */
const STORED_MAINTENANCE = [{ title: "Quarterly check", intervalDays: 90 }];
/** The KPI a copilot fill names. */
const FILLED: TemplateKpi = { ...DOUBLE, code: "filled", name: "Filled" };

function fixtureWith(content: Record<string, unknown>): AdminAssetTemplateDto {
  return adminAssetTemplateDtoSchema.parse({ ...fixture(), content });
}

/**
 * Case 10 — review finding C1. A copilot `fill_step` on the content step that
 * names only `kpis` replaces that section and carries every other stored
 * section: the `PATCH` still holds `maintenance`. The positive sits beside
 * it: the body's KPIs are the filled list, so the fill did reach the body.
 */
export async function aCopilotContentFillKeepsEveryOtherStoredSection(): Promise<void> {
  resetWizardStore();
  const dto = fixtureWith({ kpis: [SITE_LOAD, DOUBLE], maintenance: STORED_MAINTENANCE });
  const save = vi.spyOn(templateApi, "updateAdminAssetTemplate").mockResolvedValue(dto);
  try {
    renderTab(dto, true);
    await renameDouble();
    await userEvent.click(screen.getByRole("button", { name: SAVE }));

    act(() => {
      useWizardStore.getState().receiveFill({
        catalogId: "assetTemplate.update", params: { id: TEMPLATE_ID },
        stepId: "content",
        values: { content: { kpis: [FILLED] } },
      }, null);
    });
    for (let step = 0; step < 3; step += 1) {
      await userEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });

    const [, body] = save.mock.calls[0] as [string, { content: Record<string, unknown> }];
    expect(body.content.kpis).toEqual([FILLED]);
    expect(body.content.maintenance).toEqual(STORED_MAINTENANCE);
  } finally {
    resetWizardStore();
  }
}

const EXTRA: TemplateKpi = { ...DOUBLE, code: "extra", name: "Extra" };

/** The tab, rendered so a spec can hand it a refetched template. */
function renderRefetchable(dto: AdminAssetTemplateDto, onDirtyChange: (dirty: boolean) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (template: AdminAssetTemplateDto) => (
    <QueryClientProvider client={queryClient}>
      <KpisTab template={template} editable onSaved={vi.fn()} onDirtyChange={onDirtyChange} />
    </QueryClientProvider>
  );
  const { rerender } = render(tree(dto));
  return (next: AdminAssetTemplateDto) => rerender(tree(next));
}

/**
 * Case 11 — review finding C2. A clean tab handed a refetched template whose
 * KPI section gained an entry (a dock Confirm, same id and status) shows the
 * new row and stays clean.
 */
export async function aRefetchedKpiSectionReseedsACleanTab(): Promise<void> {
  const onDirtyChange = vi.fn();
  const refetch = renderRefetchable(fixture(), onDirtyChange);

  refetch(fixtureWith({ kpis: [SITE_LOAD, DOUBLE, EXTRA] }));

  expect(await screen.findByRole("combobox", { name: "Grammar for extra" })).toBeInTheDocument();
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole("button", { name: SAVE })).toBeDisabled();
}

/**
 * Case 12 — the other half of C2: a refetch never overwrites an edit in
 * progress. The rename survives (the positive) and the new stored row is not
 * pulled in.
 */
export async function aRefetchKeepsAnEditInProgress(): Promise<void> {
  const onDirtyChange = vi.fn();
  const refetch = renderRefetchable(fixture(), onDirtyChange);
  await renameDouble();

  refetch(fixtureWith({ kpis: [SITE_LOAD, DOUBLE, EXTRA] }));

  expect(within(rowOf("double")).getByRole("textbox", { name: "Name" })).toHaveValue("Double x");
  expect(screen.queryByRole("combobox", { name: "Grammar for extra" })).toBeNull();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
}

/**
 * Case 13's arrangement — post-merge finding F1. A Save whose content a copilot
 * `fill_step` replaced answers with the filled list; the page's refetch then
 * hands the tab that saved template.
 */
async function saveAFilledContentThenRefetch(onDirtyChange: (dirty: boolean) => void): Promise<void> {
  const saved = fixtureWith({ kpis: [FILLED] });
  vi.spyOn(templateApi, "updateAdminAssetTemplate").mockResolvedValue(saved);
  const refetch = renderRefetchable(fixture(), onDirtyChange);
  await renameDouble();
  await userEvent.click(screen.getByRole("button", { name: SAVE }));
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "assetTemplate.update", params: { id: TEMPLATE_ID },
      stepId: "content",
      values: { content: { kpis: [FILLED] } },
    }, null);
  });
  for (let step = 0; step < 3; step += 1) {
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
  }
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await screen.findByRole("button", { name: SAVE });

  refetch(saved);
}

/**
 * Case 13a — the tab shows the server's rows: the filled KPI, and not the
 * renamed row the wizard opened on.
 */
export async function aSaveAnsweredWithFilledContentShowsTheSavedRows(): Promise<void> {
  resetWizardStore();
  try {
    await saveAFilledContentThenRefetch(vi.fn());

    expect(await screen.findByRole("combobox", { name: "Grammar for filled" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Grammar for double" })).toBeNull();
  } finally {
    resetWizardStore();
  }
}

/** Case 13b — after that save and refetch the tab reports clean. */
export async function aSaveAnsweredWithFilledContentReportsClean(): Promise<void> {
  resetWizardStore();
  const onDirtyChange = vi.fn();
  try {
    await saveAFilledContentThenRefetch(onDirtyChange);

    await screen.findByRole("combobox", { name: "Grammar for filled" });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  } finally {
    resetWizardStore();
  }
}

/**
 * The KPI a failed Validate is pressed on: `"unvalidated"`, and an expression
 * the `v1` parser refuses at the same `@` as case 3 (`V1_REFUSES_AT`).
 */
const AGGREGATE: TemplateKpi = { ...DOUBLE, code: "aggregate", name: "Aggregate", expression: "sum({kw} @site)" };

/**
 * Case 14 — post-merge review finding R1. A failed Validate leaves the rows
 * unchanged, so the tab is clean; a refetch then replaces the list. The old
 * row's error is keyed by row position, and it must not reappear under the new
 * KPI at that position. The positive: the new row is on screen.
 */
export async function aRefetchDropsAStaleValidationError(): Promise<void> {
  const refetch = renderRefetchable(fixtureWith({ kpis: [AGGREGATE] }), vi.fn());
  await userEvent.click(within(rowOf("aggregate")).getByRole("button", { name: VALIDATE }));
  expect(within(rowOf("aggregate")).getByText(V1_REFUSES_AT)).toBeInTheDocument();

  refetch(fixtureWith({ kpis: [EXTRA] }));

  const extra = rowOf("extra");
  expect(within(extra).getByRole("button", { name: VALIDATE })).toBeInTheDocument();
  expect(within(extra).queryByText(V1_REFUSES_AT)).toBeNull();
}

/**
 * Case 15 — the other position-keyed map. A Grammar picked on an unvalidated
 * row (not yet applied) leaves the rows unchanged; after a refetch the new
 * unvalidated KPI at that position reads the default grammar, not the old
 * row's choice.
 */
export async function aRefetchDropsAStaleValidateTarget(): Promise<void> {
  const refetch = renderRefetchable(fixture(), vi.fn());
  await userEvent.selectOptions(grammarFor("double"), V2);

  refetch(fixtureWith({ kpis: [SITE_LOAD, EXTRA] }));

  expect(grammarFor("extra").value).toBe(V1);
}

/**
 * Case 16 — compliance review finding R1. The wizard's Cancel stays live while
 * Submit is pending; the user can leave, edit a KPI, and only then does the
 * save answer. The answer must not overwrite that edit. The positive control
 * that the answer did land is `onSaved`'s call.
 */
export async function aSaveAnsweredAfterACancelKeepsTheNewEdit(): Promise<void> {
  resetWizardStore();
  let answer: (dto: AdminAssetTemplateDto) => void = () => undefined;
  vi.spyOn(templateApi, "updateAdminAssetTemplate").mockReturnValue(
    new Promise<AdminAssetTemplateDto>((resolve) => {
      answer = resolve;
    }),
  );
  const onSaved = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <KpisTab template={fixture()} editable onSaved={onSaved} onDirtyChange={vi.fn()} />
    </QueryClientProvider>,
  );
  try {
    await renameDouble();
    await submitThroughTheWizard();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const leave = screen.queryByRole("button", { name: "Discard and leave" });
    if (leave !== null) await userEvent.click(leave);
    await userEvent.type(within(rowOf("double")).getByRole("textbox", { name: "Name" }), " y");

    await act(async () => {
      answer(fixtureWith({ kpis: [SITE_LOAD, { ...DOUBLE, name: "Double x" }] }));
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(within(rowOf("double")).getByRole("textbox", { name: "Name" })).toHaveValue("Double x y");
  } finally {
    resetWizardStore();
  }
}
