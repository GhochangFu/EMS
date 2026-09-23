import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type {
  SectionTemplateBindingInput,
  SectionTemplateSourceInput,
  SectionTemplateWidgetInput,
} from "../../api/admin/dashboard-templates";
import * as vocabApi from "../../api/vocabularies";
import { WidgetEditor } from "./widget-editor";

/**
 * `F3.61` — the template `WidgetEditor`'s Named metric block.
 *
 * Assertions live here; `widget-editor.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 *
 * **What this file exists to hold: three gates whose wrong reading is silent.** The block is
 * rendered only for a type whose `WIDGET_CATALOG[type].sources.max > 0` (cases 2 and 3); the
 * role picker hides once a metric is bound and the metric picker hides once a role is bound
 * (cases 7 and 8 — the contract refuses both kinds, so offering both pickers would invite a
 * state the next `PATCH` answers 400 for); and the metric picker hides at the cardinality
 * maximum (case 9). Each gate has its own case, with the positive control in the same render so
 * an absence cannot pass on an empty render.
 *
 * The two patch cases (4 and 6) assert with `toEqual` on the WHOLE patch, so an extra key —
 * `params` carrying an id (the ADR 0019 problem), or a `config` clear (plan §5.3) — fails
 * rather than slipping past a `toMatchObject`.
 */

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [{ code: "incoming-supply", label: "Incoming Supply", sortOrder: 10, active: true }],
  dashboardSections: [],
  waterBalanceRoles: [],
};

const ROLE: SectionTemplateBindingInput = {
  assetRoleCode: "incoming-supply",
  pointKey: "kW",
  pointRole: "primary",
  sortOrder: 0,
};
const METRIC: SectionTemplateSourceInput = { catalogKey: "alarms.active.count", params: {}, sortOrder: 0 };

type Overrides = Partial<Pick<SectionTemplateWidgetInput, "bindings" | "sources">>;

const base: Omit<SectionTemplateWidgetInput, "widgetType" | "config"> = {
  key: "w1",
  title: "Load",
  gridX: 0,
  gridY: 0,
  gridW: 4,
  gridH: 4,
  bindings: [],
  sources: [],
};

function tile(overrides: Overrides = {}): SectionTemplateWidgetInput {
  return { ...base, ...overrides, widgetType: "value_tile", config: {} };
}

function chart(overrides: Overrides = {}): SectionTemplateWidgetInput {
  return { ...base, ...overrides, widgetType: "chart", config: { series: "line" } };
}

function tableWidget(overrides: Overrides = {}): SectionTemplateWidgetInput {
  return { ...base, ...overrides, widgetType: "table", config: {} };
}

function renderEditor(row: SectionTemplateWidgetInput, editable: boolean) {
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  const onChange = vi.fn();
  const onRemove = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <WidgetEditor row={row} editable={editable} onChange={onChange} onRemove={onRemove} />
    </QueryClientProvider>,
  );
  return { onChange, onRemove };
}

/** Case 1 — read-only: the label, never the key, and no writable control. */
export function listsEachSourceByItsCatalogLabelReadOnly(): void {
  renderEditor(tile({ sources: [METRIC] }), false);

  expect(screen.getByText("Active alarms")).toBeInTheDocument();
  expect(
    screen.queryByText("alarms.active.count"),
    "the raw catalog key rendered where the label belongs",
  ).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Add named metric" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: /^Remove metric/ }),
    "the metric × rendered on a read-only editor — the `editable` guard is gone",
  ).toBeNull();
}

/** Case 2 — a chart binds no metric, so the block is absent rather than empty. */
export function hidesTheBlockForATypeThatBindsNoMetric(): void {
  renderEditor(chart(), true);

  expect(
    screen.queryByText("Named metric"),
    "the Named metric block rendered for a chart — `WIDGET_CATALOG.chart.sources.max` is 0",
  ).toBeNull();
  expect(screen.getByText("Bindings")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Asset role" })).toBeInTheDocument();
}

/** Case 3 — the gate reads the catalog, not a `value_tile` literal: a table shows the block. */
export function showsTheBlockForATable(): void {
  renderEditor(tableWidget({ sources: [{ catalogKey: "alarms.active", params: {}, sortOrder: 0 }] }), true);

  expect(screen.getByText("Active alarm list")).toBeInTheDocument();
  // `table` is `{1,1}`: one bound, so the picker is at its maximum.
  expect(screen.queryByRole("combobox", { name: "Add named metric" })).toBeNull();
}

/** Case 4 — add patches `sources` with `params: {}` and `sortOrder`, and nothing else. */
export async function addingAMetricPatchesSourcesWithEmptyParams(): Promise<void> {
  const { onChange } = renderEditor(tile(), true);

  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Add named metric" }),
    "alarms.active.count",
  );

  expect(onChange.mock.calls[0]?.[0]).toEqual({
    sources: [{ catalogKey: "alarms.active.count", params: {}, sortOrder: 0 }],
  });
}

/*
 * Case 5 — deliberately not written. An "appends after existing sources" case collapses into
 * case 4: measured, no widget type allows two sources (`WIDGET_SOURCE_CARDINALITY.max` is 0
 * or 1 for every type). Recorded so the next reader does not add it.
 */

/** Case 6 — remove patches `sources` only; no `config` clear (plan §5.3). */
export async function removingAMetricPatchesOnlySources(): Promise<void> {
  const { onChange } = renderEditor(tile({ sources: [METRIC] }), true);

  await userEvent.click(screen.getByRole("button", { name: "Remove metric Active alarms" }));

  const patch = onChange.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(patch).toEqual({ sources: [] });
  expect("config" in patch, "the remove patch carries a `config` key").toBe(false);
}

/** Case 7 — a bound metric hides the role picker. */
export function hidesTheRolePickerOnceAMetricIsBound(): void {
  renderEditor(tile({ sources: [METRIC] }), true);

  expect(
    screen.queryByRole("combobox", { name: "Asset role" }),
    "the role picker rendered beside a bound metric — the contract refuses both kinds",
  ).toBeNull();
  expect(screen.getByText("Active alarms")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove metric Active alarms" })).toBeInTheDocument();
}

/** Case 8 — a bound role hides the metric picker; the block itself still renders. */
export function hidesTheMetricPickerOnceARoleIsBound(): void {
  renderEditor(tile({ bindings: [ROLE] }), true);

  expect(
    screen.queryByRole("combobox", { name: "Add named metric" }),
    "the metric picker rendered beside a bound role — the contract refuses both kinds",
  ).toBeNull();
  expect(screen.getByText("Named metric")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Asset role" })).toBeInTheDocument();
}

/** Case 9 — at the cardinality maximum the metric picker hides; `bindings` is empty. */
export function hidesTheMetricPickerAtTheCardinalityMax(): void {
  renderEditor(tile({ sources: [METRIC] }), true);

  expect(
    screen.queryByRole("combobox", { name: "Add named metric" }),
    "the metric picker rendered at `WIDGET_CATALOG.value_tile.sources.max`",
  ).toBeNull();
}

/**
 * `E4.3` U10, ADR 0073 "Ruled here without a question" / Q6 clarification —
 * the water-balance-role note.
 *
 * Cases 10–13 below hold both directions plus two negative controls. Each is
 * its own `it`, and each absence case carries a positive control in the same
 * render (the source label), per the discipline `hidesTheRolePickerOnceAMetricIsBound`
 * already follows.
 */
const KL_TODAY_NO_ROLE: SectionTemplateSourceInput = {
  catalogKey: "sustainability.total",
  params: { pointKey: "kl_today", aggregate: "sum" },
  sortOrder: 0,
};
const KL_TODAY_WITH_ROLE: SectionTemplateSourceInput = {
  catalogKey: "sustainability.total",
  params: { pointKey: "kl_today", aggregate: "sum", balanceRole: "intake" },
  sortOrder: 0,
};
const KWH_TODAY_NO_ROLE: SectionTemplateSourceInput = {
  catalogKey: "sustainability.total",
  params: { pointKey: "kwh_today", aggregate: "sum" },
  sortOrder: 0,
};
const OUTLET_KL_TODAY_NO_ROLE: SectionTemplateSourceInput = {
  catalogKey: "sustainability.total",
  params: { pointKey: "outlet_kl_today", aggregate: "sum" },
  sortOrder: 0,
};
const NOTE_TEXT = /sums every stage's inlet/;

/** Case 10 — a `kl_*` source with no `balanceRole` shows the note. */
export function showsTheWaterBalanceNoteForAnUnroledWaterVolumeSource(): void {
  renderEditor(tile({ sources: [KL_TODAY_NO_ROLE] }), true);

  expect(screen.getByText("Sustainability total")).toBeInTheDocument();
  expect(screen.getByText(NOTE_TEXT)).toBeInTheDocument();
}

/** Case 11 — the same `kl_*` source WITH `balanceRole` shows no note. */
export function hidesTheWaterBalanceNoteForARoledWaterVolumeSource(): void {
  renderEditor(tile({ sources: [KL_TODAY_WITH_ROLE] }), true);

  expect(screen.getByText("Sustainability total")).toBeInTheDocument();
  expect(screen.queryByText(NOTE_TEXT)).toBeNull();
}

/** Case 12 — a non-water `pointKey` (energy) with no `balanceRole` shows no note. */
export function hidesTheWaterBalanceNoteForANonWaterSource(): void {
  renderEditor(tile({ sources: [KWH_TODAY_NO_ROLE] }), true);

  expect(screen.getByText("Sustainability total")).toBeInTheDocument();
  expect(screen.queryByText(NOTE_TEXT)).toBeNull();
}

/**
 * Case 13 — `outlet_kl_today`, an outlet-volume code, shows no note even
 * without `balanceRole`. The Q6 ruling names `kl_*` (the intake volumes)
 * only; the note's own sentence names "every stage's INLET", which would be
 * a false claim under an outlet-keyed tile, and no stock template binds
 * `outlet_kl_*` today to prove the note is even wanted there.
 */
export function hidesTheWaterBalanceNoteForAnOutletVolumeSource(): void {
  renderEditor(tile({ sources: [OUTLET_KL_TODAY_NO_ROLE] }), true);

  expect(screen.getByText("Sustainability total")).toBeInTheDocument();
  expect(screen.queryByText(NOTE_TEXT)).toBeNull();
}

/** Case 14 — read-only: the stock viewer (`F3.44`) renders the same block, and the note must still fire there. */
export function showsTheWaterBalanceNoteReadOnlyToo(): void {
  renderEditor(tile({ sources: [KL_TODAY_NO_ROLE] }), false);

  expect(screen.getByText(NOTE_TEXT)).toBeInTheDocument();
}
