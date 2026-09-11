import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { expect, vi } from "vitest";

import { assetPointCalcConfigDtoSchema } from "@bms/shared/contracts";
import type { AssetPointCalcConfigDto } from "@bms/shared";

import { EMPTY_DRAFT, type OverrideDraft } from "../../lib/asset-point-calc-override";
import { V2_TRIGGER_LATENCY_HINT } from "../../lib/template-calc-config";
import { PointCalcOverridePanel } from "./point-calc-override-panel";

/**
 * `F2.22` T12 — the override panel's `bms-calc-v2` controls: Grammar, the
 * `v2` trigger rule, the template's read-only coverage ratio, and the editor
 * mirrors that block Save.
 *
 * Assertions live here; `point-calc-override-panel.test.tsx` is the Vitest
 * entry point (ADR 0014) and carries `@vitest-environment jsdom` because that
 * is the file Vitest collects (ADR 0042 decision 2). This is the panel's first
 * spec: its rules have been covered by `lib/asset-point-calc-override.spec.ts`
 * since `F2.6`, but nothing has ever rendered it.
 *
 * The panel is controlled — the page owns the draft — so every case renders
 * it through {@link Harness}, a `useState` shell with the page's wiring and
 * nothing else. A `fireEvent.change` per control, never a keystroke each: the
 * `<select>`s take a whole value, and for the formula input one event is what
 * the page's `onChange` would see last anyway (plan correction 23 records why
 * the keystroke form is wrong on a `type="number"` field).
 */

const V1 = "bms-calc-v1";
const V2 = "bms-calc-v2";
const FAIL_CLOSED = "fail closed (every member must be fresh)";
const NOT_OVERRIDABLE = "from the template — not overridable per asset";
const PARSE_PROBLEM = /the formula does not parse: unexpected character at character 9\./;

const NOTHING = {
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
};

/**
 * A `v1` scheduled template point `KWH`, or a `v2` one on request. `override`
 * is `NOTHING` unless a case needs a stored row (case 4 does — Clear is
 * enabled only when there is something to clear).
 */
function config(
  dialect: typeof V1 | typeof V2 = V1,
  minCoverageRatio: number | null = null,
  override: Partial<AssetPointCalcConfigDto["override"]> = {},
): AssetPointCalcConfigDto {
  const template = {
    formula: dialect === V1 ? "{KW} * 2" : "sum({KW} @site)",
    formulaDialect: dialect,
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
    maxInputAgeSeconds: 600,
  };
  const stored = { ...NOTHING, ...override };
  const overridden = Object.values(stored).some((value) => value !== null);
  return assetPointCalcConfigDtoSchema.parse({
    pointKey: "KWH",
    templatePointId: "tp-1",
    label: "Energy",
    unit: "kWh",
    assetPointId: overridden ? "ap-1" : null,
    template,
    override: stored,
    effective: {
      formula: stored.formula ?? template.formula,
      formulaDialect: stored.formulaDialect ?? template.formulaDialect,
      calcTrigger: stored.calcTrigger ?? template.calcTrigger,
      calcIntervalSeconds: stored.calcIntervalSeconds ?? template.calcIntervalSeconds,
      maxInputAgeSeconds: stored.maxInputAgeSeconds ?? template.maxInputAgeSeconds,
    },
    minCoverageRatio,
    runtime: null,
  });
}

type HarnessProps = {
  config: AssetPointCalcConfigDto;
  busy?: boolean;
  onSave?: () => void;
  /** The draft the page would seed from `draftFromConfig`; `EMPTY_DRAFT` unless a case needs a submittable one. */
  initialDraft?: OverrideDraft;
};

/** The page's wiring: the draft lives above the panel and flows back down. */
function Harness({ config: dto, busy = false, onSave = () => undefined, initialDraft = EMPTY_DRAFT }: HarnessProps) {
  const [draft, setDraft] = useState<OverrideDraft>(initialDraft);
  return (
    <PointCalcOverridePanel
      config={dto}
      draft={draft}
      busy={busy}
      onDraftChange={setDraft}
      onSave={onSave}
      onClear={() => undefined}
      onCancel={() => undefined}
    />
  );
}

const grammar = () => screen.getByRole("combobox", { name: "Grammar for KWH" }) as HTMLSelectElement;
const runs = () => screen.getByRole("combobox", { name: "Runs for KWH" }) as HTMLSelectElement;
const formula = () => screen.getByRole("textbox", { name: "Formula for KWH" }) as HTMLInputElement;
const streamingOption = () =>
  within(runs()).getByRole("option", { name: "streaming" }) as HTMLOptionElement;
const saveButton = () => screen.getByRole("button", { name: "Save override" });

/**
 * Case 1 — Grammar opens on `inherit (<template dialect>)` with the empty
 * value that `draftToBody` sends as `null`, and lists the dialects after it.
 * Choosing `bms-calc-v2` disables the streaming option (design decision 5 —
 * disabled, not hidden), renders the latency hint under Runs and teaches the
 * two reference forms under the formula; before the choice, on a `v1`
 * template, none of the three is there — the negative control on each.
 */
export async function grammarShowsInheritAndChoosingV2DisablesStreaming(): Promise<void> {
  render(<Harness config={config(V1)} />);

  expect(grammar().value).toBe("");
  expect(grammar().selectedOptions[0]?.textContent).toBe(`inherit (${V1})`);
  expect(within(grammar()).getByRole("option", { name: new RegExp(`^${V2}`) })).toBeInTheDocument();
  expect(streamingOption()).toBeEnabled();
  expect(screen.queryByText(V2_TRIGGER_LATENCY_HINT)).toBeNull();
  expect(screen.queryByText(/a total or ratio over a set/)).toBeNull();

  fireEvent.change(grammar(), { target: { value: V2 } });

  expect(grammar().value).toBe(V2);
  expect(streamingOption()).toBeDisabled();
  expect(screen.getByText(V2_TRIGGER_LATENCY_HINT)).toBeInTheDocument();
  expect(screen.getByText(/a total or ratio over a set/)).toBeInTheDocument();
  expect(screen.getByText(/a balance between named assets/)).toBeInTheDocument();
}

/**
 * Case 2 — the coverage line is the template's value, read-only. `null` reads
 * as what it means (fail closed), `0.5` as itself, and the Source column says
 * the ratio is not this panel's to change (Q3 ruling). No input carries it:
 * ADR 0055 decision 11 refuses a per-asset override, so a field here would be
 * a control that only ever produced a 400.
 */
export async function theCoverageLineIsTheTemplatesAndReadOnly(): Promise<void> {
  const { unmount } = render(<Harness config={config(V2, null)} />);

  const failClosedRow = screen.getByRole("row", { name: /Minimum coverage/ });
  expect(within(failClosedRow).getAllByText(FAIL_CLOSED)).toHaveLength(2);
  expect(within(failClosedRow).getByText(NOT_OVERRIDABLE)).toBeInTheDocument();
  expect(screen.queryByRole("spinbutton", { name: /Minimum coverage/ })).toBeNull();
  unmount();

  render(<Harness config={config(V2, 0.5)} />);

  const ratioRow = screen.getByRole("row", { name: /Minimum coverage/ });
  expect(within(ratioRow).getAllByText("0.5")).toHaveLength(2);
  expect(within(ratioRow).queryByText(FAIL_CLOSED)).toBeNull();
  expect(within(ratioRow).getByText(NOT_OVERRIDABLE)).toBeInTheDocument();
}

/**
 * Case 3 — a `v2`-shaped formula against an inherited `v1` grammar lists the
 * parse problem and disables Save; choosing `bms-calc-v2` clears it and
 * enables Save, and the click reaches `onSave` — the positive control beside
 * the negative, so "Save is disabled" cannot pass on a button that is
 * disabled for every draft.
 */
export async function saveIsDisabledWhileAProblemIsListed(): Promise<void> {
  const onSave = vi.fn();
  render(<Harness config={config(V1)} onSave={onSave} />);

  fireEvent.change(formula(), { target: { value: "sum({KW} @site)" } });

  expect(screen.getByText(PARSE_PROBLEM)).toBeInTheDocument();
  expect(saveButton()).toBeDisabled();

  fireEvent.change(grammar(), { target: { value: V2 } });

  expect(screen.queryByText(PARSE_PROBLEM)).toBeNull();
  expect(saveButton()).toBeEnabled();
  fireEvent.click(saveButton());
  expect(onSave).toHaveBeenCalledTimes(1);
}

/**
 * Case 4 — `busy` disables every control, the new ones with the old: the
 * count is read off a red run and pins the control set, so a control added
 * without `disabled={busy}` fails here rather than accepting an edit during a
 * save.
 *
 * **Save and Clear are held by `busy` alone here.** Each has a second reason
 * to be disabled — `!canSubmit` on an empty draft, `!canClear` with nothing
 * stored — and under `EMPTY_DRAFT` on an override-less config both fired, so
 * removing `busy ||` from either button left the sweep green (step 5 of PR 2,
 * nit). The fixture therefore stores an interval override and seeds a draft
 * that changes it: `canClear` and `canSubmit` both hold, which the non-busy
 * render proves by finding Save, Clear and Grammar enabled — the positive
 * control that shows the sweep is not counting a control disabled for some
 * other reason.
 */
export async function busyDisablesEveryControl(): Promise<void> {
  const stored = config(V2, null, { calcIntervalSeconds: 120 });
  const submittable: OverrideDraft = { ...EMPTY_DRAFT, calcIntervalSeconds: "180" };

  const { container, unmount } = render(<Harness config={stored} initialDraft={submittable} busy />);

  const controls = container.querySelectorAll("input, select, textarea, button");
  expect(controls).toHaveLength(8);
  controls.forEach((control) => expect(control).toBeDisabled());
  unmount();

  render(<Harness config={stored} initialDraft={submittable} />);
  expect(grammar()).toBeEnabled();
  expect(saveButton()).toBeEnabled();
  expect(screen.getByRole("button", { name: "Clear override" })).toBeEnabled();
}
