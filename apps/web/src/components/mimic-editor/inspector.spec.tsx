import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VocabulariesResponse } from "@bms/shared";
import { expect, vi } from "vitest";

import * as vocabApi from "../../api/vocabularies";
import { editorReducer, fromPreset, initialEditorState, type EditorLayout, type EditorNode } from "../../lib/mimic-editor";
import { MIMIC_SYMBOL_GROUPS, librarySymbolGroups, symbolLabel } from "../../lib/mimic-symbols";
import { orgCatalogFixture } from "../../lib/mimic-symbols.spec";
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
    catalog: null,
    // A stored layout by default: what it chooses is what was stored (the kept exemption's set).
    storedLibraries: (overrides.layout ?? layout).symbolLibraries,
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
  // Each group holds its own symbols: eight empty groups with the options after them fail here.
  expect(Array.from(groups).map((g) => Array.from(g.querySelectorAll("option")).map((o) => o.value))).toEqual(
    MIMIC_SYMBOL_GROUPS.map((g) => [...g.symbols]),
  );
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

// ---- symbol libraries (F3.32e, ADR 0084 decisions 8 and 9) ----------------------------------

/** A layout choosing core and MDI with one MDI unit, `heat_pump_1`, selected. */
function mdiLayout(): EditorLayout {
  const s = [
    { type: "update-layout", patch: { symbolLibraries: ["core", "mdi"] } },
    { type: "add-unit", symbol: "mdi:heat-pump", label: symbolLabel("mdi:heat-pump") },
  ] as const;
  return s.reduce(editorReducer, initialEditorState()).layout;
}

function renderWith(l: EditorLayout, selectedKey: string | null = null) {
  const selected = selectedKey === null ? null : (l.nodes.find((n) => n.key === selectedKey) ?? null);
  return renderInspector(null, { layout: l, selected });
}

/** N12 — one check box per library, in registry order. */
export function sevenLibraryBoxesInRegistryOrder(): void {
  renderInspector(null);
  const boxes = screen.getAllByRole("checkbox", { name: /^Library / }).map((b) => b.getAttribute("aria-label"));
  expect(boxes).toEqual([
    "Library Core",
    "Library Tabler Icons",
    "Library Lucide",
    "Library Material Design Icons",
    "Library QElectroTech",
    "Library Wikimedia Commons P&ID",
    "Library draw.io",
  ]);
}

/** N13 — a core-only layout has Core checked and the other six unchecked. */
export function coreIsCheckedOnACoreLayout(): void {
  renderInspector(null);
  const checked = screen.getAllByRole("checkbox", { name: /^Library / }).map((b) => (b as HTMLInputElement).checked);
  expect(checked).toEqual([true, false, false, false, false, false, false]);
}

/** N14 — checking Tabler reports the list with Tabler added, in registry order. */
export async function checkingTablerAddsIt(): Promise<void> {
  const props = renderInspector(null);
  await userEvent.click(screen.getByRole("checkbox", { name: "Library Tabler Icons" }));
  expect(props.onLayoutChange).toHaveBeenCalledWith({ symbolLibraries: ["core", "tabler"] });
}

/** N15 — unchecking an unused library reports the list without it. */
export async function uncheckingAnUnusedLibraryDropsIt(): Promise<void> {
  const props = renderWith({ ...layout, symbolLibraries: ["core", "tabler"] });
  await userEvent.click(screen.getByRole("checkbox", { name: "Library Tabler Icons" }));
  expect(props.onLayoutChange).toHaveBeenCalledWith({ symbolLibraries: ["core"] });
}

/** N16 — a library a unit uses is disabled; an unused one beside it is not. */
export function aUsedLibraryBoxIsDisabled(): void {
  renderWith(mdiLayout());
  // Positive control: an unused library stays enabled.
  expect(screen.getByRole("checkbox", { name: "Library Tabler Icons" })).toBeEnabled();
  expect(screen.getByRole("checkbox", { name: "Library Material Design Icons" })).toBeDisabled();
}

/** N17 — a used library names the units that use it. */
export function aUsedLibraryNamesItsUnits(): void {
  renderWith(mdiLayout());
  expect(screen.getByText("Material Design Icons is used by: heat_pump_1")).toBeInTheDocument();
}

/** N18 — the Symbol select adds one `optgroup` per chosen library's non-empty group. */
export function symbolSelectGroupsEachChosenLibrary(): void {
  renderWith(mdiLayout(), "heat_pump_1");
  const select = screen.getByRole("combobox", { name: "Symbol" });
  const labels = Array.from(select.querySelectorAll("optgroup")).map((g) => g.getAttribute("label"));
  const mdi = librarySymbolGroups("mdi")
    .filter((g) => g.symbols.length > 0)
    .map((g) => `Material Design Icons · ${g.label}`);
  expect(labels).toEqual([...MIMIC_SYMBOL_GROUPS.map((g) => g.label), ...mdi]);
}

/** N19 — a unit whose library is not chosen shows its symbol as one leading option. */
export function anUnchosenLibraryUnitShowsALeadingOption(): void {
  const l = mdiLayout();
  renderWith({ ...l, symbolLibraries: ["core"] }, "heat_pump_1");
  const select = screen.getByRole("combobox", { name: "Symbol" });
  expect(select).toHaveValue("mdi:heat-pump");
  const first = select.firstElementChild;
  expect(first?.tagName).toBe("OPTION");
  expect(first?.textContent).toBe("Heat pump (Material Design Icons)");
}

/** N20 — a unit whose library IS chosen gets no leading option (the control for N19). */
export function aChosenLibraryUnitHasNoLeadingOption(): void {
  renderWith(mdiLayout(), "heat_pump_1");
  const select = screen.getByRole("combobox", { name: "Symbol" });
  expect(select).toHaveValue("mdi:heat-pump");
  expect(select.firstElementChild?.tagName).toBe("OPTGROUP");
}

// ---- organization libraries (F3.32f slice 3, ADR 0086 decisions 4, 7; plan D9) -----------------

/** A layout choosing core and Plant, with `inlet_1` (active) and `old_pump_1` (a retired symbol). */
function plantLayout(libraries: EditorLayout["symbolLibraries"] = ["core", "org.plant"]): EditorLayout {
  const s = [
    { type: "update-layout", patch: { symbolLibraries: libraries } },
    { type: "add-unit", symbol: "org.plant:inlet", label: "Inlet screen" },
    { type: "add-unit", symbol: "org.plant:old-pump", label: "Old pump" },
  ] as const;
  return s.reduce(editorReducer, initialEditorState()).layout;
}

function renderWithCatalog(l: EditorLayout, selectedKey: string | null = null) {
  const selected = selectedKey === null ? null : (l.nodes.find((n) => n.key === selectedKey) ?? null);
  return renderInspector(null, { layout: l, selected, catalog: orgCatalogFixture() });
}

function libraryBoxNames(): (string | null)[] {
  return screen.getAllByRole("checkbox", { name: /^Library / }).map((b) => b.getAttribute("aria-label"));
}

/** N21 — with the catalog: one box per enabled global library, then one per active org library. */
export function oneBoxPerEnabledGlobalAndActiveOrgLibrary(): void {
  renderWithCatalog(layout);
  expect(libraryBoxNames()).toEqual(["Library Core", "Library Lucide", "Library Material Design Icons", "Library Plant"]);
}

/** N22 — a chosen library the organization turned off is checked and disabled. */
export function aChosenDisabledLibraryIsCheckedAndDisabled(): void {
  renderWithCatalog({ ...layout, symbolLibraries: ["core", "tabler"] });
  const box = screen.getByRole("checkbox", { name: "Library Tabler Icons" });
  expect(box).toBeChecked();
  expect(box).toBeDisabled();
}

/** N23 — a chosen library the organization turned off says so. */
export function aChosenDisabledLibraryShowsTheRetiredHint(): void {
  renderWithCatalog({ ...layout, symbolLibraries: ["core", "tabler"] });
  expect(screen.getByText("Tabler Icons is retired")).toBeInTheDocument();
}

/** N24 — a chosen retired org library is checked and disabled with the hint. */
export function aChosenRetiredOrgLibraryIsCheckedAndDisabled(): void {
  renderWithCatalog({ ...layout, symbolLibraries: ["core", "org.legacy"] });
  const box = screen.getByRole("checkbox", { name: "Library Legacy" });
  expect(box).toBeChecked();
  expect(box).toBeDisabled();
  expect(screen.getByText("Legacy is retired")).toBeInTheDocument();
}

/** N25 — checking Plant reports the list with `org.plant` after the static codes. */
export async function checkingPlantAddsTheOrgLibrary(): Promise<void> {
  const props = renderWithCatalog({ ...layout, symbolLibraries: ["core", "lucide"] });
  await userEvent.click(screen.getByRole("checkbox", { name: "Library Plant" }));
  expect(props.onLayoutChange).toHaveBeenCalledWith({ symbolLibraries: ["core", "lucide", "org.plant"] });
}

/** N26 — unchecking a static library keeps the chosen org library. */
export async function uncheckingAStaticLibraryKeepsTheOrgLibrary(): Promise<void> {
  const props = renderWithCatalog({ ...layout, symbolLibraries: ["core", "lucide", "org.plant"] });
  await userEvent.click(screen.getByRole("checkbox", { name: "Library Lucide" }));
  expect(props.onLayoutChange).toHaveBeenCalledWith({ symbolLibraries: ["core", "org.plant"] });
}

/** N27 — an org library in use is disabled and names its units. */
export function aUsedOrgLibraryNamesItsUnits(): void {
  renderWithCatalog(plantLayout());
  expect(screen.getByRole("checkbox", { name: "Library Plant" })).toBeDisabled();
  expect(screen.getByText("Plant is used by: inlet_1, old_pump_1")).toBeInTheDocument();
}

/** N28 — the Symbol select has a `Plant · Water` optgroup holding the active symbol. */
export function theSymbolSelectHasAPlantWaterOptgroup(): void {
  renderWithCatalog(plantLayout(), "inlet_1");
  const group = screen.getByRole("combobox", { name: "Symbol" }).querySelector('optgroup[label="Plant · Water"]');
  expect(group).not.toBeNull();
  expect(Array.from(group?.querySelectorAll("option") ?? []).map((o) => o.textContent)).toEqual(["Inlet screen"]);
}

/** N29 — an org unit's select shows its own symbol by its catalog label. */
export function anOrgUnitShowsItsLabelInTheSelect(): void {
  renderWithCatalog(plantLayout(), "inlet_1");
  const select = screen.getByRole("combobox", { name: "Symbol" }) as HTMLSelectElement;
  expect(select).toHaveValue("org.plant:inlet");
  expect(select.selectedOptions[0]?.textContent).toBe("Inlet screen");
}

/** N30 — a unit on a retired org symbol keeps it as one leading option. */
export function aRetiredOrgSymbolIsKeptAsALeadingOption(): void {
  renderWithCatalog(plantLayout(), "old_pump_1");
  const select = screen.getByRole("combobox", { name: "Symbol" });
  expect(select).toHaveValue("org.plant:old-pump");
  expect(select.firstElementChild?.tagName).toBe("OPTION");
  expect(select.firstElementChild?.textContent).toBe("Old pump (Plant)");
}

/** N31 — without the catalog an org unit still renders its select, on its own key (never throws). */
export function withoutTheCatalogAnOrgUnitRenders(): void {
  const l = plantLayout();
  renderInspector(null, { layout: l, selected: l.nodes[0] ?? null, catalog: null });
  expect(screen.getByRole("combobox", { name: "Symbol" })).toHaveValue("org.plant:inlet");
}

// ---- review fixes: what a save would refuse is neither offered nor trapped ----------------------

/** A layout choosing core and `libraries`, with one core unit selected. */
function withLibraries(libraries: EditorLayout["symbolLibraries"]): EditorLayout {
  const s = [
    { type: "update-layout", patch: { symbolLibraries: libraries } },
    { type: "add-unit", symbol: "pump", label: "Pump" },
  ] as const;
  return s.reduce(editorReducer, initialEditorState()).layout;
}

function symbolGroupLabels(): (string | null)[] {
  return Array.from(screen.getByRole("combobox", { name: "Symbol" }).querySelectorAll("optgroup")).map((g) =>
    g.getAttribute("label"),
  );
}

function symbolValues(): string[] {
  return Array.from(screen.getByRole("combobox", { name: "Symbol" }).querySelectorAll("option")).map((o) => o.value);
}

/** N32 — a chosen library the organization turned off lists no optgroup (the palette hides its tab). */
export function aDisabledChosenLibraryHasNoOptgroup(): void {
  const l = withLibraries(["core", "tabler", "lucide"]);
  renderInspector(null, { layout: l, selected: l.nodes[0] ?? null, catalog: orgCatalogFixture() });
  // Positive control: the live Lucide still lists.
  expect(symbolGroupLabels().some((label) => label?.startsWith("Lucide · "))).toBe(true);
  expect(symbolGroupLabels().filter((label) => label?.startsWith("Tabler Icons · "))).toEqual([]);
}

/** N33 — ADR 0086 decision 5: a retired global symbol is not offered in the Symbol select. */
export function aRetiredGlobalSymbolIsNotOffered(): void {
  const catalog = orgCatalogFixture();
  const retiring = { ...catalog, global: catalog.global.map((g) => (g.code === "mdi" ? { ...g, inactiveSymbolKeys: ["mdi:water-pump"] } : g)) };
  const l = withLibraries(["core", "mdi"]);
  renderInspector(null, { layout: l, selected: l.nodes[0] ?? null, catalog: retiring });
  // Positive control: another mdi symbol is still offered.
  expect(symbolValues().some((v) => v.startsWith("mdi:"))).toBe(true);
  expect(symbolValues()).not.toContain("mdi:water-pump");
}

/** N34 — a unit already on a retired global symbol keeps it as the leading option. */
export function aUnitOnARetiredGlobalSymbolKeepsIt(): void {
  const catalog = orgCatalogFixture();
  const retiring = { ...catalog, global: catalog.global.map((g) => (g.code === "mdi" ? { ...g, inactiveSymbolKeys: ["mdi:water-pump"] } : g)) };
  const s = [
    { type: "update-layout", patch: { symbolLibraries: ["core", "mdi"] } },
    { type: "add-unit", symbol: "mdi:water-pump", label: "Water pump" },
  ] as const;
  const l = s.reduce(editorReducer, initialEditorState()).layout;
  renderInspector(null, { layout: l, selected: l.nodes[0] ?? null, catalog: retiring });
  const select = screen.getByRole("combobox", { name: "Symbol" });
  expect(select).toHaveValue("mdi:water-pump");
  expect(select.firstElementChild?.tagName).toBe("OPTION");
}

/** N35 — on a new layout a chosen, switched-off library is not locked: the save would refuse it. */
export async function aNewLayoutCanUncheckADisabledLibrary(): Promise<void> {
  const props = renderInspector(null, {
    layout: { ...layout, symbolLibraries: ["core", "tabler"] },
    catalog: orgCatalogFixture(),
    storedLibraries: [],
  });
  const box = screen.getByRole("checkbox", { name: "Library Tabler Icons" });
  expect(box).toBeChecked();
  expect(box).toBeEnabled();
  await userEvent.click(box);
  expect(props.onLayoutChange).toHaveBeenCalledWith({ symbolLibraries: ["core"] });
}

/** N36 — on a new layout an `org.` key the new organization does not hold can be unchecked. */
export async function aNewLayoutCanUncheckAnUnknownOrgLibrary(): Promise<void> {
  const props = renderInspector(null, {
    layout: { ...layout, symbolLibraries: ["core", "org.other"] },
    catalog: orgCatalogFixture(),
    storedLibraries: [],
  });
  const box = screen.getByRole("checkbox", { name: "Library org.other" });
  expect(box).toBeEnabled();
  await userEvent.click(box);
  expect(props.onLayoutChange).toHaveBeenCalledWith({ symbolLibraries: ["core"] });
}

/** N-new1 — a unit offers "Fan out" and "Energy source"; toggling Fan out reports the patch. */
export async function fanOutToggleReportsThePatch(): Promise<void> {
  const props = renderInspector("wtp");
  await userEvent.click(screen.getByRole("checkbox", { name: /Fan out/ }));
  expect(props.onNodeChange).toHaveBeenCalledWith("wtp", { fanOut: true });
}

/** N-new2 — toggling Energy source reports the patch. */
export async function sourceToggleReportsThePatch(): Promise<void> {
  const props = renderInspector("wtp");
  await userEvent.click(screen.getByRole("checkbox", { name: /Energy source/ }));
  expect(props.onNodeChange).toHaveBeenCalledWith("wtp", { isSource: true });
}

/** N-new3 — a set flag shows checked; toggling it off reports false. */
export async function aSetFlagShowsCheckedAndClears(): Promise<void> {
  const flagged: EditorLayout = {
    ...layout,
    nodes: layout.nodes.map((n) => (n.key === "wtp" ? { ...n, fanOut: true } : n)),
  };
  const props = renderInspector("wtp", { layout: flagged, selected: flagged.nodes.find((n) => n.key === "wtp") ?? null });
  const box = screen.getByRole("checkbox", { name: /Fan out/ });
  expect(box).toBeChecked();
  await userEvent.click(box);
  expect(props.onNodeChange).toHaveBeenCalledWith("wtp", { fanOut: false });
}

/** N-new4 — a panel shows neither checkbox, and a unit does show one (adjacent positive). */
export function aPanelShowsNeitherFlag(): void {
  const panel = layout.nodes.find((n) => n.kind === "panel");
  if (panel === undefined) throw new Error("water_train has a panel");
  renderInspector(null, { selected: panel });
  expect(screen.getByRole("combobox", { name: "Tone" })).toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: /Fan out/ })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: /Energy source/ })).toBeNull();
}
