import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { adminAssetTemplateDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetTemplateDto } from "@bms/shared";

import * as templateApi from "../../api/admin/asset-templates";
import { COVERAGE_RATIO_HINT, V2_TRIGGER_LATENCY_HINT } from "../../lib/template-calc-config";
import { CalculationsTab } from "./calculations-tab";
import type { FormulaEditorProps } from "./formula-editor-lazy";

/**
 * `F2.22` T6 — the Calculations tab's `bms-calc-v2` controls: Grammar, the
 * `v2` trigger rule, Minimum coverage, and the within-template cycle mirror.
 *
 * Assertions live here; `calculations-tab.test.tsx` is the Vitest entry point
 * (ADR 0014) and carries `@vitest-environment jsdom` because that is the file
 * Vitest collects (ADR 0042 decision 2). This is the tab's first spec: the
 * trigger rules have been covered by `lib/template-calc-config.spec.ts` since
 * `F2.5`, but nothing has ever rendered the tab.
 *
 * **The formula editor is a stand-in.** `FormulaEditorLazy` is mocked as a
 * plain `<textarea>` that carries the tab's `ariaLabel`, `value`, `readOnly`
 * and `onChange` — the same shape as `dashboard-widget.spec.tsx` mocking
 * `echarts-for-react`. Two reasons: the lazy chunk is CodeMirror, whose input
 * handling in jsdom is a browser claim (`F2.22` T10), and case 3 must drive
 * the tab's formula `onChange` so the dialect-preservation line is
 * load-bearing under the named mutation. The real editor rendering read-only
 * on a frozen version is `asset-template-stock-view-page.spec.tsx`'s claim,
 * through `data-formula-readonly`; case 4 here reads the tab's `readOnly`
 * prop off the stand-in and sweeps the tab's own controls separately, because
 * on the real screen CodeMirror's contenteditable is not an
 * `input, select, textarea` and the stock viewer's sweep never covered it.
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
const STREAMING_OPTION = "on every reading";
const INTERVAL_MISSING = "A scheduled formula needs an interval.";
const CYCLE_SENTENCE = /lies on a dependency cycle/;

type PointOverrides = Record<string, unknown>;

function point(key: string, sortOrder: number, overrides: PointOverrides): unknown {
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

function template(points: readonly unknown[], status = "draft"): AdminAssetTemplateDto {
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
    content: {},
    publishedAt: status === "published" ? "2026-09-11T00:00:00.000Z" : null,
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
    points,
  });
}

/**
 * The plan's fixture: a measured `kw`, a `v1` streaming `d1`, and a `v2`
 * scheduled `site_kw` with no ratio (fail closed).
 */
const D1 = { kind: "derived", formula: "{kw} * 2", formulaDialect: V1, calcTrigger: "streaming" };
const SITE_KW = {
  kind: "derived",
  formula: "sum({kw} @site)",
  formulaDialect: V2,
  calcTrigger: "scheduled",
  calcIntervalSeconds: 60,
};

function fixture(status = "draft"): AdminAssetTemplateDto {
  return template(
    [point("kw", 0, {}), point("d1", 1, D1), point("site_kw", 2, SITE_KW)],
    status,
  );
}

/** One point as `buildPointsPayload` sends it, for the whole-entry comparison. */
function expectedPoint(key: string, sortOrder: number, overrides: PointOverrides) {
  return {
    pointKey: key,
    label: null,
    unit: "kW",
    kind: "measured",
    sourceDataKeyPattern: null,
    required: true,
    sortOrder,
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
    ...overrides,
  };
}

function renderTab(
  dto: AdminAssetTemplateDto,
  editable: boolean,
  onDirtyChange: (dirty: boolean) => void = vi.fn(),
): HTMLElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <CalculationsTab
        template={dto}
        editable={editable}
        onSaved={vi.fn()}
        onDirtyChange={onDirtyChange}
      />
    </QueryClientProvider>,
  );
  return container;
}

const grammarFor = (key: string) =>
  screen.getByRole("combobox", { name: `Grammar for ${key}` }) as HTMLSelectElement;
const runsFor = (key: string) =>
  screen.getByRole("combobox", { name: `Runs for ${key}` }) as HTMLSelectElement;
const coverageFor = (key: string) =>
  screen.getByRole("spinbutton", { name: `Minimum coverage for ${key}` }) as HTMLInputElement;
const formulaFor = (key: string) =>
  screen.getByRole("textbox", { name: `Formula for ${key}` }) as HTMLTextAreaElement;
const streamingOptionOf = (select: HTMLSelectElement) =>
  within(select).getByRole("option", { name: STREAMING_OPTION }) as HTMLOptionElement;

/**
 * Case 1 — what each row renders on a draft, by its stored dialect.
 *
 * The `v2` row: Grammar reads `bms-calc-v2`, the streaming option is disabled
 * (design decision 5 — disabled, not hidden), the coverage field is there with
 * its fail-closed placeholder and hint, the latency hint sits under Runs, and
 * the two reference forms are taught. The `v1` row is the negative control on
 * every one of those.
 */
export async function eachRowRendersItsDialectsControls(): Promise<void> {
  renderTab(fixture(), true);

  expect(grammarFor("site_kw").value).toBe(V2);
  expect(streamingOptionOf(runsFor("site_kw"))).toBeDisabled();
  expect(coverageFor("site_kw")).toBeEnabled();
  expect(coverageFor("site_kw").placeholder).toBe("fail closed");
  expect(coverageFor("site_kw").value).toBe("");
  expect(screen.getByText(COVERAGE_RATIO_HINT)).toBeInTheDocument();
  expect(screen.getByText(V2_TRIGGER_LATENCY_HINT)).toBeInTheDocument();
  // The `answers` phrases, not the examples: the aggregate example is also
  // `site_kw`'s formula, so a text query on it would find two nodes.
  expect(screen.getByText(/a total or ratio over a set/)).toBeInTheDocument();
  expect(screen.getByText(/a balance between named assets/)).toBeInTheDocument();

  expect(grammarFor("d1").value).toBe(V1);
  expect(streamingOptionOf(runsFor("d1"))).toBeEnabled();
  expect(screen.queryByRole("spinbutton", { name: "Minimum coverage for d1" })).toBeNull();
}

/**
 * Case 2 — choosing `bms-calc-v2` on a streaming `v1` row flips it to
 * `scheduled` and seeds no interval (design decision 3), so the tab asks for
 * one. The streaming option is disabled from that moment.
 */
export async function choosingV2FlipsAStreamingRowToScheduled(): Promise<void> {
  renderTab(fixture(), true);

  expect(screen.queryByText(INTERVAL_MISSING)).toBeNull();
  await userEvent.selectOptions(grammarFor("d1"), V2);

  expect(grammarFor("d1").value).toBe(V2);
  expect(runsFor("d1").value).toBe("scheduled");
  expect(streamingOptionOf(runsFor("d1"))).toBeDisabled();
  expect(screen.getByText(INTERVAL_MISSING)).toBeInTheDocument();
}

/**
 * Case 3 — a save carries the ratio, and a formula edit preserves the row's
 * dialect. `d1` is never touched: its whole payload entry reaching the server
 * unchanged is the untouched-row control (`points-tab.spec.tsx`'s `p2`).
 *
 * The ratio is typed before the formula edit on purpose. Under the named
 * mutation — the formula handler stamping `bms-calc-v1` — the edit turns
 * `site_kw` into a `v1` row holding a ratio, the coverage input unmounts and
 * Save is blocked by the ratio-placement rule; typing first means the
 * assertion that reddens is about the save, not about a missing field.
 */
export async function savingCarriesTheRatioAndPreservesTheDialect(): Promise<void> {
  const dto = fixture();
  const save = vi.spyOn(templateApi, "updateAdminAssetTemplate").mockResolvedValue(dto);
  renderTab(dto, true);

  // One change event with the whole value, not a keystroke each: jsdom
  // sanitises a `type="number"` field's intermediate `"0."` to `""`, so a
  // character-by-character type lands `5`.
  fireEvent.change(coverageFor("site_kw"), { target: { value: "0.5" } });
  expect(coverageFor("site_kw").value).toBe("0.5");

  await userEvent.type(formulaFor("site_kw"), " * 1");
  expect(formulaFor("site_kw").value).toBe("sum({kw} @site) * 1");

  expect(screen.queryByText("Fix the problems above to save.")).toBeNull();
  const saveButton = screen.getByRole("button", { name: "Save calculations" });
  expect(saveButton).toBeEnabled();
  await userEvent.click(saveButton);

  await waitFor(() => {
    expect(save).toHaveBeenCalledTimes(1);
  });

  const [id, body] = save.mock.calls[0];
  expect(id).toBe(dto.id);
  const points = body.points ?? [];
  expect(points).toHaveLength(3);
  expect(points[2]).toEqual(
    expectedPoint("site_kw", 2, {
      ...SITE_KW,
      formula: "sum({kw} @site) * 1",
      minCoverageRatio: 0.5,
    }),
  );
  expect(points[1]).toEqual(expectedPoint("d1", 1, D1));
  expect(points[0]).toEqual(expectedPoint("kw", 0, {}));
}

/**
 * Case 4 — a frozen version renders every control disabled and no Save.
 *
 * The same sweep `asset-template-stock-view-page.spec.tsx` runs over the
 * Points tab: every `input, select, textarea` must be disabled, not absent.
 * The formula stand-in is excluded from the sweep and read through its
 * `readOnly` — see the module docblock.
 */
export async function aFrozenVersionDisablesEveryControl(): Promise<void> {
  const container = renderTab(fixture("published"), false);

  const controls = [...container.querySelectorAll<HTMLElement>("input, select, textarea")];
  const own = controls.filter((field) => !/^Formula for /.test(field.getAttribute("aria-label") ?? ""));
  // Four fields on the `v1` row (Grammar, Runs, input age, and the preview's
  // one sample input for `kw`) and six on the `v2` row (plus the interval, the
  // coverage, and the preview's one sample input for `sum(kw) @site` — the
  // aggregate is one row, not a member list) — the positive control that the
  // sweep below is reading a rendered tab and not an empty one. `F2.22` T8
  // moved this from 8: the preview renders disabled on a frozen version, not
  // absent, so its inputs are swept too.
  expect(own).toHaveLength(10);
  expect(
    own.filter((field) => !(field as HTMLInputElement).disabled).map((field) => field.outerHTML),
  ).toEqual([]);
  expect(grammarFor("site_kw")).toBeDisabled();
  expect(runsFor("site_kw")).toBeDisabled();
  expect(coverageFor("site_kw")).toBeDisabled();

  expect(formulaFor("d1")).toHaveAttribute("readonly");
  expect(formulaFor("site_kw")).toHaveAttribute("readonly");
  expect(screen.queryByRole("button", { name: "Save calculations" })).toBeNull();
}

/**
 * Case 5 — the within-template cycle mirror. Two `v2` rows that read each
 * other render the server's cycle sentence under both, and Save is blocked.
 *
 * `D`'s ratio is edited first so `changed` is true: without a dirtying edit,
 * `!changed` alone disables Save and the assertion would pass for the wrong
 * reason. The edit having registered is read off the tab's own
 * `onDirtyChange(true)` — the only signal of `changed` while `blocked` holds
 * the footer on "Fix the problems above to save." — and the case was run once
 * without the edit to confirm it passed vacuously before that assertion was
 * added. "Fix the problems above to save." is driven by `blocked` alone.
 */
export async function aCycleBlocksTheSaveUnderBothRows(): Promise<void> {
  const cyclic = template([
    point("D", 0, { kind: "derived", formula: "{E}", formulaDialect: V2, calcTrigger: "scheduled", calcIntervalSeconds: 60 }),
    point("E", 1, { kind: "derived", formula: "{D}", formulaDialect: V2, calcTrigger: "scheduled", calcIntervalSeconds: 60 }),
  ]);
  const onDirtyChange = vi.fn();
  renderTab(cyclic, true, onDirtyChange);

  fireEvent.change(coverageFor("D"), { target: { value: "0.5" } });
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);

  expect(screen.getAllByText(CYCLE_SENTENCE)).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Save calculations" })).toBeDisabled();
  expect(screen.getByText("Fix the problems above to save.")).toBeInTheDocument();
}
