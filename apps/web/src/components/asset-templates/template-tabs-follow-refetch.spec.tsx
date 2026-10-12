import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { expect, vi } from "vitest";

import { adminAssetTemplateDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetTemplateDto, VocabulariesResponse } from "@bms/shared";

import * as pointKeyApi from "../../api/admin/point-keys";
import * as vocabApi from "../../api/vocabularies";
import { AlarmsTab } from "./alarms-tab";
import { CalculationsTab } from "./calculations-tab";
import { DashboardsTab } from "./dashboards-tab";
import { DetailsTab } from "./details-tab";
import type { FormulaEditorProps } from "./formula-editor-lazy";
import { MaintenanceTab } from "./maintenance-tab";
import { PointsTab } from "./points-tab";

/**
 * `F3.85` post-merge finding F3 — every asset-template tab follows a refetched
 * template under the **same id and status** while it is clean, and keeps an
 * edit in progress.
 *
 * The refetch is what a dock Confirm of `assetTemplate.update` causes:
 * `copilot-invalidations.ts` invalidates `["admin", "asset-template"]` and the
 * page hands the tab a new DTO. Before the fix every tab here reseeded only on
 * `[template.id, template.status]`, so a clean tab kept its old rows, reported
 * dirty, and its next Save sent the old rows back over the copilot's write.
 * The KPIs tab's own cases live in `kpis-tab.spec.tsx` (C2 and F1).
 *
 * Each tab has two arrangements: a clean tab shows the new stored value and
 * reports clean; an edited tab keeps the edit (the positive) and stays dirty.
 * The Details tab adds a third (review finding R2): its four fields are judged
 * one by one, so an untouched field follows while an edited one is kept.
 *
 * Assertions live here; `template-tabs-follow-refetch.test.tsx` is the Vitest
 * entry point (ADR 0014) and carries `@vitest-environment jsdom` (ADR 0042
 * decision 2). The formula editor is the same stand-in `calculations-tab.spec.tsx`
 * uses.
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

type TabProps = {
  template: AdminAssetTemplateDto;
  editable: boolean;
  onSaved: (next: AdminAssetTemplateDto) => void;
  onDirtyChange: (dirty: boolean) => void;
};

const VOCABULARIES: VocabulariesResponse = {
  ruleCategories: [{ code: "operations", label: "Operations", sortOrder: 10, active: true }],
  assetDomains: [{ code: "electrical", label: "Electrical", sortOrder: 10, active: true }],
  alarmSeverities: [{ code: "warning", label: "Warning", sortOrder: 10, active: true }],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
  waterBalanceRoles: [],
} as unknown as VocabulariesResponse;

function point(key: string, sortOrder: number, overrides: Record<string, unknown> = {}): unknown {
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
    sortOrder,
    meta: null,
    createdAt: "2026-09-11T00:00:00.000Z",
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
    ...overrides,
  };
}

const D1 = { kind: "derived", formula: "{kw} * 2", formulaDialect: "bms-calc-v1", calcTrigger: "streaming" };
const D2 = { kind: "derived", formula: "{kw} * 3", formulaDialect: "bms-calc-v1", calcTrigger: "streaming" };
const BASE_POINTS = [point("kw", 0), point("d1", 1, D1)];

const OVERLOAD = {
  code: "OVERLOAD",
  pointKey: "kw",
  operator: "gt",
  thresholdValue: 112,
  severity: "warning",
  message: "Load above the feeder's rating",
};
const PLAN_A = { title: "Membrane CIP", intervalDays: 90 };
const VIEW = { featured: ["kw"], widgets: [] };

const BASE_CONTENT = {
  alarms: [OVERLOAD],
  maintenance: [PLAN_A],
  dashboards: { Overview: VIEW },
};

/** The template, same id and status in every case; `overrides` is the copilot's write. */
function template(overrides: Record<string, unknown> = {}): AdminAssetTemplateDto {
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
    status: "draft",
    content: BASE_CONTENT,
    publishedAt: null,
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
    points: BASE_POINTS,
    ...overrides,
  });
}

/** The tab, rendered so a case can hand it a refetched template. */
function renderRefetchable(Tab: ComponentType<TabProps>) {
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES);
  vi.spyOn(pointKeyApi, "fetchAdminPointKeys").mockResolvedValue({
    items: [{ code: "kw" }, { code: "kw2" }, { code: "d1" }, { code: "d2" }],
  } as never);
  const onDirtyChange = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (dto: AdminAssetTemplateDto) => (
    <QueryClientProvider client={queryClient}>
      <Tab template={dto} editable onSaved={vi.fn()} onDirtyChange={onDirtyChange} />
    </QueryClientProvider>
  );
  const { rerender } = render(tree(template()));
  return { onDirtyChange, refetch: (dto: AdminAssetTemplateDto) => rerender(tree(dto)) };
}

const values = (label: string): string[] =>
  screen.getAllByLabelText(label).map((element) => (element as HTMLInputElement).value);

/*
 * One claim per it() (post-merge review finding R3): each arrangement below is
 * asserted twice, once on what the tab shows and once on what it reports up.
 * An edited tab's dirty report reads the last `onDirtyChange` call after the
 * refetch: a correct tab makes no new call (its `changed` stays `true`), and a
 * tab whose refetch reported clean would make that last call `false`.
 */

// ---------------------------------------------------------------- Details

function detailsClean() {
  const tab = renderRefetchable(DetailsTab);
  tab.refetch(template({ name: "Copilot name" }));
  return tab;
}

function detailsEdited() {
  const tab = renderRefetchable(DetailsTab);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Feeder x" } });
  tab.refetch(template({ name: "Copilot name" }));
  return tab;
}

/** Description typed, then a copilot rename: the fields are judged one by one (review finding R2). */
function detailsOtherFieldEdited() {
  const tab = renderRefetchable(DetailsTab);
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Typed" } });
  tab.refetch(template({ name: "Copilot name" }));
  return tab;
}

export async function detailsFollowsARefetchWhileClean(): Promise<void> {
  detailsClean();
  expect(await screen.findByDisplayValue("Copilot name")).toBeInTheDocument();
}

export async function detailsReportsCleanAfterARefetch(): Promise<void> {
  const { onDirtyChange } = detailsClean();
  await screen.findByDisplayValue("Copilot name");
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
}

export async function detailsKeepsAnEditOnARefetch(): Promise<void> {
  detailsEdited();
  expect(screen.getByLabelText("Name")).toHaveValue("Feeder x");
}

export async function detailsStaysDirtyAfterARefetch(): Promise<void> {
  const { onDirtyChange } = detailsEdited();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
}

export async function detailsFollowsAnUntouchedFieldBesideAnEdit(): Promise<void> {
  detailsOtherFieldEdited();
  expect(screen.getByLabelText("Name")).toHaveValue("Copilot name");
}

export async function detailsKeepsTheEditedFieldBesideAFollowedOne(): Promise<void> {
  detailsOtherFieldEdited();
  expect(screen.getByLabelText("Description")).toHaveValue("Typed");
}

// ---------------------------------------------------------------- Points

const PLUS_KW2 = () => template({ points: [...BASE_POINTS, point("kw2", 2)] });

function pointsClean() {
  const tab = renderRefetchable(PointsTab);
  tab.refetch(PLUS_KW2());
  return tab;
}

function pointsEdited() {
  const tab = renderRefetchable(PointsTab);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Scale multiplier for kw" }), {
    target: { value: "2" },
  });
  tab.refetch(PLUS_KW2());
  return tab;
}

export async function pointsFollowsARefetchWhileClean(): Promise<void> {
  pointsClean();
  expect(await screen.findByRole("combobox", { name: "Tier for kw2" })).toBeInTheDocument();
}

export async function pointsReportsCleanAfterARefetch(): Promise<void> {
  const { onDirtyChange } = pointsClean();
  await screen.findByRole("combobox", { name: "Tier for kw2" });
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
}

export async function pointsKeepsAnEditOnARefetch(): Promise<void> {
  pointsEdited();
  expect(screen.getByRole("spinbutton", { name: "Scale multiplier for kw" })).toHaveValue(2);
  expect(screen.queryByRole("combobox", { name: "Tier for kw2" })).toBeNull();
}

export async function pointsStaysDirtyAfterARefetch(): Promise<void> {
  const { onDirtyChange } = pointsEdited();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
}

// ---------------------------------------------------------------- Calculations

const PLUS_D2 = () => template({ points: [...BASE_POINTS, point("d2", 2, D2)] });

function calculationsClean() {
  const tab = renderRefetchable(CalculationsTab);
  tab.refetch(PLUS_D2());
  return tab;
}

function calculationsEdited() {
  const tab = renderRefetchable(CalculationsTab);
  fireEvent.change(screen.getByRole("textbox", { name: "Formula for d1" }), {
    target: { value: "{kw} * 4" },
  });
  tab.refetch(PLUS_D2());
  return tab;
}

export async function calculationsFollowsARefetchWhileClean(): Promise<void> {
  calculationsClean();
  expect(await screen.findByRole("combobox", { name: "Grammar for d2" })).toBeInTheDocument();
}

export async function calculationsReportsCleanAfterARefetch(): Promise<void> {
  const { onDirtyChange } = calculationsClean();
  await screen.findByRole("combobox", { name: "Grammar for d2" });
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
}

export async function calculationsKeepsAnEditOnARefetch(): Promise<void> {
  calculationsEdited();
  expect(screen.getByRole("textbox", { name: "Formula for d1" })).toHaveValue("{kw} * 4");
  expect(screen.queryByRole("combobox", { name: "Grammar for d2" })).toBeNull();
}

export async function calculationsStaysDirtyAfterARefetch(): Promise<void> {
  const { onDirtyChange } = calculationsEdited();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
}

// ---------------------------------------------------------------- Alarms

const UNDERLOAD = { ...OVERLOAD, code: "UNDERLOAD", operator: "lt", thresholdValue: 5 };
const PLUS_UNDERLOAD = () => template({ content: { ...BASE_CONTENT, alarms: [OVERLOAD, UNDERLOAD] } });

function alarmsClean() {
  const tab = renderRefetchable(AlarmsTab);
  tab.refetch(PLUS_UNDERLOAD());
  return tab;
}

function alarmsEdited() {
  const tab = renderRefetchable(AlarmsTab);
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Edited" } });
  tab.refetch(PLUS_UNDERLOAD());
  return tab;
}

export async function alarmsFollowsARefetchWhileClean(): Promise<void> {
  alarmsClean();
  expect(values("Code")).toEqual(["OVERLOAD", "UNDERLOAD"]);
}

export async function alarmsReportsCleanAfterARefetch(): Promise<void> {
  const { onDirtyChange } = alarmsClean();
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
}

export async function alarmsKeepsAnEditOnARefetch(): Promise<void> {
  alarmsEdited();
  expect(values("Message")).toEqual(["Edited"]);
}

export async function alarmsStaysDirtyAfterARefetch(): Promise<void> {
  const { onDirtyChange } = alarmsEdited();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
}

// ---------------------------------------------------------------- Maintenance

const PLAN_C = { title: "Filter change", intervalDays: 30 };
const PLUS_PLAN_C = () => template({ content: { ...BASE_CONTENT, maintenance: [PLAN_A, PLAN_C] } });

function maintenanceClean() {
  const tab = renderRefetchable(MaintenanceTab);
  tab.refetch(PLUS_PLAN_C());
  return tab;
}

function maintenanceEdited() {
  const tab = renderRefetchable(MaintenanceTab);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Membrane CIP x" } });
  tab.refetch(PLUS_PLAN_C());
  return tab;
}

export async function maintenanceFollowsARefetchWhileClean(): Promise<void> {
  maintenanceClean();
  expect(values("Title")).toEqual(["Membrane CIP", "Filter change"]);
}

export async function maintenanceReportsCleanAfterARefetch(): Promise<void> {
  const { onDirtyChange } = maintenanceClean();
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
}

export async function maintenanceKeepsAnEditOnARefetch(): Promise<void> {
  maintenanceEdited();
  expect(values("Title")).toEqual(["Membrane CIP x"]);
}

export async function maintenanceStaysDirtyAfterARefetch(): Promise<void> {
  const { onDirtyChange } = maintenanceEdited();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
}

// ---------------------------------------------------------------- Dashboards

const PLUS_ENERGY = () =>
  template({ content: { ...BASE_CONTENT, dashboards: { Overview: VIEW, Energy: VIEW } } });

function dashboardsClean() {
  const tab = renderRefetchable(DashboardsTab);
  tab.refetch(PLUS_ENERGY());
  return tab;
}

function dashboardsEdited() {
  const tab = renderRefetchable(DashboardsTab);
  fireEvent.change(screen.getByPlaceholderText("New view name"), { target: { value: "Mine" } });
  fireEvent.click(screen.getByRole("button", { name: "Add a view" }));
  tab.refetch(PLUS_ENERGY());
  return tab;
}

export async function dashboardsFollowsARefetchWhileClean(): Promise<void> {
  dashboardsClean();
  expect(screen.getByRole("button", { name: "Delete Energy" })).toBeInTheDocument();
}

export async function dashboardsReportsCleanAfterARefetch(): Promise<void> {
  const { onDirtyChange } = dashboardsClean();
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
}

export async function dashboardsKeepsAnEditOnARefetch(): Promise<void> {
  dashboardsEdited();
  expect(screen.getByRole("button", { name: "Delete Mine" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete Energy" })).toBeNull();
}

export async function dashboardsStaysDirtyAfterARefetch(): Promise<void> {
  const { onDirtyChange } = dashboardsEdited();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
}
