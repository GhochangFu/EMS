import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VocabulariesResponse } from "@bms/shared";
import { expect, vi } from "vitest";

import * as vocabApi from "../../api/vocabularies";
import { fromPreset, type EditorNode } from "../../lib/mimic-editor";
import { MIMIC_SYMBOL_GROUPS } from "../../lib/mimic-symbols";
import { MimicEditorInspector, type MimicEditorInspectorProps } from "./inspector";

/**
 * `F3.32c` U6b, `F3.32d` U3 (ADR 0082 decision 2) — the editor inspector. `fetchVocabularies` is
 * stubbed (an unstubbed read reaches a local API on `:4000`). `inspector.test.tsx` is the Vitest
 * entry.
 */

const VOCAB = {
  assetRoles: [
    { code: "wtp", label: "Water treatment plant" },
    { code: "ro", label: "Reverse osmosis" },
  ],
} as unknown as VocabulariesResponse;

const layout = fromPreset("water_train");

function nodeOf(key: string): EditorNode {
  const found = layout.nodes.find((n) => n.key === key);
  if (found === undefined) throw new Error(key);
  return found;
}

function renderInspector(selectedKey: string | null, overrides: Partial<MimicEditorInspectorProps> = {}) {
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCAB);
  const props: MimicEditorInspectorProps = {
    layout,
    selected: selectedKey === null ? null : nodeOf(selectedKey),
    onLayoutChange: vi.fn(),
    onNodeChange: vi.fn(),
    ...overrides,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MimicEditorInspector {...props} />
    </QueryClientProvider>,
  );
  return props;
}

/** N1 — a unit's Role select offers "none — passive" and every vocabulary role. */
export async function roleOffersPassiveAndTheVocabulary(): Promise<void> {
  renderInspector("wtp");
  const select = screen.getByRole("combobox", { name: "Role" });
  await within(select).findByRole("option", { name: "Reverse osmosis" });
  expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
    "none — passive",
    "Water treatment plant",
    "Reverse osmosis",
  ]);
}

/** N2 — choosing "none — passive" unbinds the role (`roleCode: null`). */
export async function choosingPassiveUnbindsTheRole(): Promise<void> {
  const props = renderInspector("wtp");
  const select = screen.getByRole("combobox", { name: "Role" });
  await within(select).findByRole("option", { name: "Reverse osmosis" });
  await userEvent.selectOptions(select, "");
  expect(props.onNodeChange).toHaveBeenCalledWith("wtp", { roleCode: null });
}

/** N3 — a passive unit shows "none — passive" selected. */
export function aPassiveUnitShowsNone(): void {
  renderInspector("discharge");
  expect(screen.getByRole("combobox", { name: "Role" })).toHaveValue("");
}

/** N4 — a unit's Symbol select changes its symbol. */
export async function symbolChangesTheSymbol(): Promise<void> {
  const props = renderInspector("ro");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Symbol" }), "filter");
  expect(props.onNodeChange).toHaveBeenCalledWith("ro", { symbol: "filter" });
}

/** N4b — the Symbol select has eight `optgroup`s, labelled in `MIMIC_SYMBOL_GROUPS` order. */
export function symbolSelectHasEightGroupsInOrder(): void {
  renderInspector("ro");
  const select = screen.getByRole("combobox", { name: "Symbol" });
  const groups = select.querySelectorAll("optgroup");
  expect(Array.from(groups).map((g) => g.getAttribute("label"))).toEqual(MIMIC_SYMBOL_GROUPS.map((g) => g.label));
}

/** N4c — the option for `ups` reads "UPS". */
export function upsOptionReadsUps(): void {
  renderInspector("ro");
  const select = screen.getByRole("combobox", { name: "Symbol" });
  expect(within(select).getByRole("option", { name: "UPS" })).toHaveValue("ups");
}

/** N4d — choosing UPS reports `{ symbol: "ups" }`. */
export async function choosingUpsReportsUps(): Promise<void> {
  const props = renderInspector("ro");
  const select = screen.getByRole("combobox", { name: "Symbol" });
  await userEvent.selectOptions(select, "ups");
  expect(props.onNodeChange).toHaveBeenCalledWith("ro", { symbol: "ups" });
}

/** N5 — a panel has a Tone select and no Role. */
export function aPanelHasToneAndNoRole(): void {
  renderInspector("wastewater");
  expect(screen.getByRole("combobox", { name: "Tone" })).toHaveValue("accent");
  expect(screen.queryByRole("combobox", { name: "Role" })).toBeNull();
}

/** N6 — a unit has no Tone select. */
export function aUnitHasNoTone(): void {
  renderInspector("ro");
  expect(screen.queryByRole("combobox", { name: "Tone" })).toBeNull();
}

/** N7 — the label commits once, on blur — not per keystroke. */
export async function theLabelCommitsOnceOnBlur(): Promise<void> {
  const props = renderInspector("ro");
  const field = screen.getByRole("textbox", { name: "Label" });
  await userEvent.clear(field);
  await userEvent.type(field, "RO train");
  await userEvent.tab();
  expect(props.onNodeChange).toHaveBeenCalledTimes(1);
  expect(props.onNodeChange).toHaveBeenCalledWith("ro", { label: "RO train" });
}

/** N8 — the canvas width commits the whole number on Enter. */
export async function canvasWidthCommitsOnEnter(): Promise<void> {
  const props = renderInspector(null);
  const field = screen.getByRole("spinbutton", { name: "Canvas width" });
  await userEvent.clear(field);
  await userEvent.type(field, "140{Enter}");
  expect(props.onLayoutChange).toHaveBeenCalledWith({ canvasW: 140 });
}

/** N9 — a node's X commits as a whole number. */
export async function xCommitsAsAWholeNumber(): Promise<void> {
  const props = renderInspector("ro");
  const field = screen.getByRole("spinbutton", { name: "X" });
  await userEvent.clear(field);
  await userEvent.type(field, "60{Enter}");
  expect(props.onNodeChange).toHaveBeenCalledWith("ro", { x: 60 });
}

/** N10 — the Organization select appears only when the caller passes one (a new layout). */
export function organizationOnlyOnANewLayout(): void {
  renderInspector(null);
  expect(screen.queryByRole("combobox", { name: "Organization" })).toBeNull();
}

/** N11 — the Organization select lists the options it is given. */
export function organizationListsItsOptions(): void {
  renderInspector(null, {
    organization: { options: [{ id: "o1", label: "ION — Ion Exchange" }], value: "", onChange: vi.fn() },
  });
  expect(screen.getByRole("option", { name: "ION — Ion Exchange" })).toBeInTheDocument();
}
