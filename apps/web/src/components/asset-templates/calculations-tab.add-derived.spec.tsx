import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { adminAssetTemplateDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetTemplateDto } from "@bms/shared";

import * as templateApi from "../../api/admin/asset-templates";
import * as pointKeyApi from "../../api/admin/point-keys";
import { CalculationsTab } from "./calculations-tab";
import type { FormulaEditorProps } from "./formula-editor-lazy";

/**
 * `F4.389` — a new derived point can be added and saved from the Calculations
 * tab.
 *
 * Before this row no UI path created a derived point: the Points tab refused a
 * derived row with no formula and sent the author here, and this tab listed
 * only stored derived points. The fix (plan option (b)) is an **Add a derived
 * point** control on this tab.
 *
 * Assertions live here; `calculations-tab.add-derived.test.tsx` is the Vitest
 * entry point (ADR 0014) and carries `@vitest-environment jsdom` (ADR 0042
 * decision 2). The formula editor is the same `<textarea>` stand-in
 * `calculations-tab.spec.tsx` uses, for the reasons its docblock gives.
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
const ADD = "Add a derived point";
const TRIGGER_MISSING = "Choose when this formula runs: on every reading, or on a schedule.";

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
    createdAt: "2026-11-19T00:00:00.000Z",
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
    ...overrides,
  };
}

function template(points: readonly unknown[], status = "draft"): AdminAssetTemplateDto {
  return adminAssetTemplateDtoSchema.parse({
    id: "t1",
    organizationId: "o1",
    organizationCode: "PHE",
    organizationName: "Spec organization",
    code: "SPEC",
    version: 1,
    name: "Spec meter",
    assetType: "meter",
    domain: "electrical",
    description: null,
    status,
    content: {},
    publishedAt: status === "published" ? "2026-11-19T00:00:00.000Z" : null,
    archivedAt: null,
    workOrderPrefix: null,
    stockCode: null,
    stockVersion: null,
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    points,
  });
}

/** One measured point and nothing derived: the state the defect was found in. */
const MEASURED_ONLY = () => template([point("kw", 0)]);

function renderTab(
  dto: AdminAssetTemplateDto,
  editable: boolean,
  onDirtyChange: (dirty: boolean) => void = vi.fn(),
): void {
  vi.spyOn(pointKeyApi, "fetchAdminPointKeys").mockResolvedValue({
    items: [{ code: "kw" }, { code: "kw_avg" }],
  } as never);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CalculationsTab
        template={dto}
        editable={editable}
        onSaved={vi.fn()}
        onDirtyChange={onDirtyChange}
      />
    </QueryClientProvider>,
  );
}

const keyOfNew = (n: number) =>
  screen.getByRole("combobox", { name: `Point key of new point ${n}` }) as HTMLSelectElement;
const saveButton = () => screen.getByRole("button", { name: "Save calculations" });

/**
 * Case A — the defect's own path: add a derived point, give it a key, a
 * formula and a trigger, and save. The PATCH carries both points: the stored
 * measured one unchanged, and the new one as a complete derived point with no
 * `meta` key (`{}` is refused with a 400).
 */
export async function addsANewDerivedPointAndSavesIt(): Promise<void> {
  const dto = MEASURED_ONLY();
  const save = vi.spyOn(templateApi, "updateAdminAssetTemplate").mockResolvedValue(dto);
  renderTab(dto, true);

  await userEvent.click(screen.getByRole("button", { name: ADD }));

  // The catalog arrives asynchronously; the option is the proof it did.
  await screen.findByRole("option", { name: "kw_avg" });
  await userEvent.selectOptions(keyOfNew(1), "kw_avg");
  await userEvent.type(screen.getByRole("textbox", { name: "Label of new point 1" }), "Average power");
  await userEvent.type(screen.getByRole("textbox", { name: "Unit of new point 1" }), "kW");

  fireEvent.change(screen.getByRole("textbox", { name: "Formula for kw_avg" }), {
    target: { value: "{kw} * 1" },
  });
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Runs for kw_avg" }),
    "streaming",
  );

  expect(screen.queryByText("Fix the problems above to save.")).toBeNull();
  expect(saveButton()).toBeEnabled();
  await userEvent.click(saveButton());

  await waitFor(() => {
    expect(save).toHaveBeenCalledTimes(1);
  });
  const [id, body] = save.mock.calls[0];
  expect(id).toBe(dto.id);
  const points = body.points ?? [];
  expect(points).toHaveLength(2);
  expect(points[0]).toEqual({
    pointKey: "kw",
    label: null,
    unit: "kW",
    kind: "measured",
    sourceDataKeyPattern: null,
    required: true,
    sortOrder: 0,
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    minCoverageRatio: null,
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
  });
  expect(points[1]).toEqual({
    pointKey: "kw_avg",
    label: "Average power",
    unit: "kW",
    kind: "derived",
    sourceDataKeyPattern: null,
    required: true,
    sortOrder: 1,
    formula: "{kw} * 1",
    formulaDialect: V1,
    calcTrigger: "streaming",
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    minCoverageRatio: null,
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
  });
  expect("meta" in points[1]).toBe(false);
}

/**
 * Case B — an added point with no key, formula or trigger blocks the save and
 * says what is missing, rather than letting the server's 400 say it.
 */
export async function anIncompleteNewPointBlocksTheSave(): Promise<void> {
  const dto = MEASURED_ONLY();
  const save = vi.spyOn(templateApi, "updateAdminAssetTemplate").mockResolvedValue(dto);
  renderTab(dto, true);

  await userEvent.click(screen.getByRole("button", { name: ADD }));

  expect(screen.getByText("Choose a point key.")).toBeInTheDocument();
  expect(screen.getByText(TRIGGER_MISSING)).toBeInTheDocument();
  expect(screen.getByText("Fix the problems above to save.")).toBeInTheDocument();
  expect(saveButton()).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
}

/**
 * Case C — a published version offers no way to add a point: the control is
 * absent, not disabled, like Save on a frozen version.
 */
export async function aFrozenVersionOffersNoAdd(): Promise<void> {
  renderTab(
    template(
      [
        point("kw", 0),
        point("kw_avg", 1, {
          kind: "derived",
          formula: "{kw} * 1",
          formulaDialect: V1,
          calcTrigger: "streaming",
        }),
      ],
      "published",
    ),
    false,
  );
  expect(screen.getByRole("textbox", { name: "Formula for kw_avg" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: ADD })).toBeNull();
}

/**
 * Case D — a draft with no derived point says how to add one, and offers the
 * control. The old text sent the author to the Points tab, which could not
 * finish the point.
 */
export async function theEmptyStateOffersTheControl(): Promise<void> {
  renderTab(MEASURED_ONLY(), true);
  expect(screen.getByText(/This template has no derived points\./)).toHaveTextContent(ADD);
  expect(screen.queryByText(/Add a point on the Points tab/)).toBeNull();
  expect(screen.getByRole("button", { name: ADD })).toBeEnabled();
}

/**
 * Case E — an added point can be removed before it is saved, and the tab is
 * clean again, so the page's tab-switch guard stops prompting.
 */
export async function anAddedPointCanBeRemoved(): Promise<void> {
  const onDirtyChange = vi.fn();
  renderTab(MEASURED_ONLY(), true, onDirtyChange);

  await userEvent.click(screen.getByRole("button", { name: ADD }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);

  await userEvent.click(screen.getByRole("button", { name: "Remove new point 1" }));
  expect(screen.queryByRole("combobox", { name: "Point key of new point 1" })).toBeNull();
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
}
