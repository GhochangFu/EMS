import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mimicCoreSymbolSchema } from "@bms/shared/contracts";
import { expect, vi } from "vitest";

import { MIMIC_SYMBOL_GROUPS, librarySymbolGroups, symbolLabel } from "../../lib/mimic-symbols";
import { orgCatalogFixture } from "../../lib/mimic-symbols.spec";
import * as glyphs from "../widgets/mimic-glyphs";
import { MimicEditorPalette, type MimicEditorPaletteProps } from "./palette";

/**
 * `F3.32c` U6b, `F3.32d` U3 (ADR 0082 decision 2) — the editor palette, now grouped into eight
 * headings over 29 symbols. `palette.test.tsx` is the Vitest entry.
 */

function renderPalette(overrides: Partial<MimicEditorPaletteProps> = {}): MimicEditorPaletteProps {
  const props: MimicEditorPaletteProps = {
    onAddUnit: vi.fn(),
    onAddPanel: vi.fn(),
    onAddLabel: vi.fn(),
    pipeMode: false,
    onTogglePipeMode: vi.fn(),
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canDelete: true,
    onDelete: vi.fn(),
    libraries: ["core"],
    catalog: null,
    ...overrides,
  };
  render(<MimicEditorPalette {...props} />);
  return props;
}

/** P1 — one glyph button per symbol, in group order (General last), named by `symbolLabel`. */
export function offersTheTwentyNineSymbolsInGroupOrder(): void {
  renderPalette();
  const names = screen.getAllByRole("button", { name: /^Add .* unit$/ }).map((b) => b.getAttribute("aria-label"));
  const expected = MIMIC_SYMBOL_GROUPS.flatMap((group) => group.symbols.map((s) => `Add ${symbolLabel(s)} unit`));
  expect(names).toEqual(expected);
  expect(names).toHaveLength(mimicCoreSymbolSchema.options.length);
}

/** P1b — eight group headings, in `MIMIC_SYMBOL_GROUPS` order, General last. */
export function offersEightGroupHeadingsInOrder(): void {
  renderPalette();
  const headings = screen.getAllByTestId("mimic-palette-group").map((section) => within(section).getByRole("heading").textContent);
  expect(headings).toEqual(MIMIC_SYMBOL_GROUPS.map((group) => group.label));
  expect(headings.at(-1)).toBe("General");
}

/** P1c — every symbol appears exactly once across the groups. */
export function everySymbolAppearsExactlyOnce(): void {
  renderPalette();
  const names = screen.getAllByRole("button", { name: /^Add .* unit$/ }).map((b) => b.getAttribute("aria-label"));
  expect(new Set(names).size).toBe(names.length);
  expect(names.length).toBe(mimicCoreSymbolSchema.options.length);
}

/** P2 — each glyph button draws its glyph, in group order. */
export function eachSymbolButtonDrawsItsGlyphInGroupOrder(): void {
  renderPalette();
  const glyphs = screen.getAllByTestId("mimic-glyph").map((g) => g.getAttribute("data-glyph"));
  expect(glyphs).toEqual(MIMIC_SYMBOL_GROUPS.flatMap((group) => [...group.symbols]));
}

/** P2b — Transformer adds a unit of that symbol (ADR 0082 decision 1, the new Electrical group). */
export async function transformerAddsThatUnit(): Promise<void> {
  const props = renderPalette();
  await userEvent.click(screen.getByRole("button", { name: "Add Transformer unit" }));
  expect(props.onAddUnit).toHaveBeenCalledWith("transformer", "Transformer");
}

/** P2c — UPS adds a unit of that symbol (ADR 0082 decision 1, the new IT and UPS group). */
export async function upsAddsThatUnit(): Promise<void> {
  const props = renderPalette();
  await userEvent.click(screen.getByRole("button", { name: "Add UPS unit" }));
  expect(props.onAddUnit).toHaveBeenCalledWith("ups", "UPS");
}

/** P3 — a glyph button adds a unit of that symbol. */
export async function aSymbolButtonAddsThatUnit(): Promise<void> {
  const props = renderPalette();
  await userEvent.click(screen.getByRole("button", { name: "Add Valve unit" }));
  expect(props.onAddUnit).toHaveBeenCalledWith("valve", "Valve");
}

/** P4 — Panel adds a panel. */
export async function panelAddsAPanel(): Promise<void> {
  const props = renderPalette();
  await userEvent.click(screen.getByRole("button", { name: "Panel" }));
  expect(props.onAddPanel).toHaveBeenCalledTimes(1);
}

/** P5 — Label adds a label. */
export async function labelAddsALabel(): Promise<void> {
  const props = renderPalette();
  await userEvent.click(screen.getByRole("button", { name: "Label" }));
  expect(props.onAddLabel).toHaveBeenCalledTimes(1);
}

/** P6 — Undo is disabled with nothing to undo. */
export function undoIsDisabledWhenEmpty(): void {
  renderPalette({ canUndo: false });
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
}

/** P7 — Redo is disabled with nothing to redo. */
export function redoIsDisabledWhenEmpty(): void {
  renderPalette({ canRedo: false });
  expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
}

/** P8 — Undo is enabled with something to undo (the positive control for P6). */
export function undoIsEnabledWithHistory(): void {
  renderPalette({ canUndo: true });
  expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
}

/** P9 — Delete is disabled with nothing selected. */
export function deleteIsDisabledWithNoSelection(): void {
  renderPalette({ canDelete: false });
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
}

/** P10 — Pipe mode reports its state as `aria-pressed`. */
export function pipeModeIsAToggle(): void {
  renderPalette({ pipeMode: true });
  expect(screen.getByRole("button", { name: "Pipe mode" })).toHaveAttribute("aria-pressed", "true");
}

// ---- symbol libraries (F3.32e, ADR 0084 decision 9) ----------------------------------------

const THREE: MimicEditorPaletteProps["libraries"] = ["mdi", "core", "tabler"];

async function search(text: string): Promise<void> {
  await userEvent.type(screen.getByRole("searchbox", { name: "Search symbols" }), text);
}

/** P11 — a core-only layout shows no tablist (the palette looks as before ADR 0084). */
export function aCoreOnlyLayoutShowsNoTablist(): void {
  renderPalette();
  // Positive control: the core palette rendered.
  expect(screen.getByRole("button", { name: "Add Tank unit" })).toBeInTheDocument();
  expect(screen.queryByRole("tablist")).toBeNull();
}

/** P12 — the search box is there on a core-only layout too. */
export function theSearchBoxIsAlwaysShown(): void {
  renderPalette();
  expect(screen.getByRole("searchbox", { name: "Search symbols" })).toBeInTheDocument();
}

/** P13 — one tab per chosen library, in registry order whatever the layout's order. */
export function threeLibrariesShowThreeTabsInRegistryOrder(): void {
  renderPalette({ libraries: THREE });
  const tabs = within(screen.getByRole("tablist")).getAllByRole("tab").map((t) => t.textContent);
  expect(tabs).toEqual(["Core", "Tabler Icons", "Material Design Icons"]);
}

/** P14 — the first tab is selected, the others are not. */
export function theFirstTabIsSelected(): void {
  renderPalette({ libraries: THREE });
  const selected = screen.getAllByRole("tab").map((t) => t.getAttribute("aria-selected"));
  expect(selected).toEqual(["true", "false", "false"]);
}

/** P15 — the MDI tab shows MDI's non-empty groups, in group order, with MDI's symbols. */
export async function theMdiTabShowsMdiGroups(): Promise<void> {
  renderPalette({ libraries: THREE });
  await userEvent.click(screen.getByRole("tab", { name: "Material Design Icons" }));
  const groups = librarySymbolGroups("mdi").filter((g) => g.symbols.length > 0);
  const headings = screen.getAllByTestId("mimic-palette-group").map((section) => within(section).getByRole("heading").textContent);
  expect(headings).toEqual(groups.map((g) => g.label));
  const names = screen.getAllByRole("button", { name: /^Add .* unit$/ }).map((b) => b.getAttribute("aria-label"));
  expect(names).toEqual(groups.flatMap((g) => g.symbols.map((sym) => `Add ${symbolLabel(sym)} unit`)));
}

/** P16 — a clicked tab is selected. */
export async function aClickedTabIsSelected(): Promise<void> {
  renderPalette({ libraries: THREE });
  await userEvent.click(screen.getByRole("tab", { name: "Material Design Icons" }));
  expect(screen.getByRole("tab", { name: "Material Design Icons" })).toHaveAttribute("aria-selected", "true");
}

/** P17 — the MDI tab names its library and licence. */
export async function theMdiTabShowsItsLicenceLine(): Promise<void> {
  renderPalette({ libraries: THREE });
  await userEvent.click(screen.getByRole("tab", { name: "Material Design Icons" }));
  expect(screen.getByText("Material Design Icons — Apache 2.0")).toBeInTheDocument();
}

/** P18 — the MDI tab holds the licence notice in a `<details>` (ruling R5). */
export async function theMdiTabHoldsTheNoticeInDetails(): Promise<void> {
  renderPalette({ libraries: THREE });
  await userEvent.click(screen.getByRole("tab", { name: "Material Design Icons" }));
  const details = screen.getByTestId("mimic-palette-licence");
  expect(details.tagName).toBe("DETAILS");
  expect(details.querySelector("summary")?.textContent).toBe("Licence notice");
  expect(details.querySelector("pre")?.textContent).toContain("Apache 2.0 (https://www.apache.org/licenses/LICENSE-2.0)");
}

/** P19 — the core tab shows its line and no `<details>` (no notice to show). */
export function theCoreTabShowsNoDetails(): void {
  renderPalette({ libraries: THREE });
  // Positive control: the core tab's panel rendered.
  expect(screen.getByText("Core — Own drawings")).toBeInTheDocument();
  expect(screen.queryByTestId("mimic-palette-licence")).toBeNull();
}

/** P20 — a search hides the tabs and shows the matches. */
export async function aSearchHidesTheTabs(): Promise<void> {
  renderPalette({ libraries: THREE });
  await search("pump");
  // Positive control: the search answered.
  expect(screen.getByRole("button", { name: "Add Water pump unit from Material Design Icons" })).toBeInTheDocument();
  expect(screen.queryByRole("tablist")).toBeNull();
}

/** P21 — a search finds the core Pump, named as on its tab. */
export async function aSearchFindsTheCorePump(): Promise<void> {
  renderPalette({ libraries: THREE });
  await search("pump");
  expect(screen.getByRole("button", { name: "Add Pump unit" })).toBeInTheDocument();
}

/** P22 — a search is case-insensitive. */
export async function aSearchIsCaseInsensitive(): Promise<void> {
  renderPalette({ libraries: THREE });
  await search("PUMP");
  expect(screen.getByRole("button", { name: "Add Water pump unit from Material Design Icons" })).toBeInTheDocument();
}

/** P23 — a search result adds that library's unit. */
export async function aSearchResultAddsItsUnit(): Promise<void> {
  const props = renderPalette({ libraries: THREE });
  await search("pump");
  await userEvent.click(screen.getByRole("button", { name: "Add Water pump unit from Material Design Icons" }));
  expect(props.onAddUnit).toHaveBeenCalledWith("mdi:water-pump", symbolLabel("mdi:water-pump"));
}

/** P24 — clearing the search restores the tabs. */
export async function clearingTheSearchRestoresTheTabs(): Promise<void> {
  renderPalette({ libraries: THREE });
  await search("pump");
  await userEvent.clear(screen.getByRole("searchbox", { name: "Search symbols" }));
  expect(within(screen.getByRole("tablist")).getAllByRole("tab")).toHaveLength(3);
}

/** P25 — a library the layout did not choose is not searched. */
export async function anUnchosenLibraryIsNotSearched(): Promise<void> {
  renderPalette({ libraries: ["core", "tabler"] });
  await search("pump");
  // Positive control: the search answered from core.
  expect(screen.getByRole("button", { name: "Add Pump unit" })).toBeInTheDocument();
  expect(screen.queryAllByRole("button", { name: /from Material Design Icons$/ })).toHaveLength(0);
}

/** P26 — a search with no match says so. */
export async function aSearchWithNoMatchSaysSo(): Promise<void> {
  renderPalette({ libraries: THREE });
  await search("zzzz");
  expect(screen.getByRole("status")).toHaveTextContent("No symbol matches");
}

/** P27 — a layout of one non-core library shows its tab (core is not mandatory, ruling R3). */
export function aSingleNonCoreLibraryShowsItsTab(): void {
  renderPalette({ libraries: ["mdi"] });
  expect(within(screen.getByRole("tablist")).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Material Design Icons"]);
}

// ---- the attributions link (F3.32f slice 1, ADR 0086 decision 8) ------------------------------

/** P28 — a vendored library's tab links to /attributions in a new tab (the editor holds unsaved state). */
export async function aVendoredTabLinksToTheAttributionsPage(): Promise<void> {
  renderPalette({ libraries: ["core", "lucide"] });
  await userEvent.click(screen.getByRole("tab", { name: "Lucide" }));
  expect(screen.getByText("Lucide — ISC and MIT")).toBeInTheDocument();
  const link = screen.getByRole("link", { name: "Attributions" });
  expect(link).toHaveAttribute("href", "/attributions");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
}

/** P29 — a core-only palette shows no Attributions link (positive control: the core palette rendered). */
export function aCoreOnlyPaletteShowsNoAttributionsLink(): void {
  renderPalette({ libraries: ["core"] });
  expect(screen.getByRole("button", { name: "Add Tank unit" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Attributions" })).toBeNull();
}

// ---- organization libraries (F3.32f slice 3, ADR 0086 decisions 4, 7; plan D9) -----------------

function tabNames(): (string | null)[] {
  return within(screen.getByRole("tablist")).getAllByRole("tab").map((t) => t.textContent);
}

async function openPlant(overrides: Partial<MimicEditorPaletteProps> = {}): Promise<MimicEditorPaletteProps> {
  const props = renderPalette({ libraries: ["core", "org.plant"], catalog: orgCatalogFixture(), ...overrides });
  await userEvent.click(screen.getByRole("tab", { name: "Plant" }));
  return props;
}

/** P30 — with the catalog, `["core", "org.plant"]` shows two tabs: Core, then Plant. */
export function anOrgLibraryIsATab(): void {
  renderPalette({ libraries: ["core", "org.plant"], catalog: orgCatalogFixture() });
  expect(tabNames()).toEqual(["Core", "Plant"]);
}

/** P31 — a chosen retired org library gets no tab (the active Plant is the positive control). */
export function aRetiredOrgLibraryGetsNoTab(): void {
  renderPalette({ libraries: ["core", "org.plant", "org.legacy"], catalog: orgCatalogFixture() });
  expect(tabNames()).toEqual(["Core", "Plant"]);
}

/** P32 — a chosen global library the organization turned off gets no tab. */
export function aDisabledGlobalLibraryGetsNoTab(): void {
  renderPalette({ libraries: ["core", "tabler", "org.plant"], catalog: orgCatalogFixture() });
  expect(tabNames()).toEqual(["Core", "Plant"]);
}

/** P33 — while the catalog loads the static tabs show and no org tab does (ruling R13). */
export function withoutTheCatalogTheStaticTabsShow(): void {
  renderPalette({ libraries: ["core", "tabler", "org.plant"], catalog: null });
  expect(tabNames()).toEqual(["Core", "Tabler Icons"]);
}

/** P34 — the Plant tab offers its active symbol. */
export async function thePlantTabOffersItsActiveSymbol(): Promise<void> {
  await openPlant();
  expect(screen.getByRole("button", { name: "Add Inlet screen unit" })).toBeInTheDocument();
}

/** P35 — the Plant tab does not offer its retired symbol (positive control: the active one). */
export async function thePlantTabOmitsItsRetiredSymbol(): Promise<void> {
  await openPlant();
  expect(screen.getByRole("button", { name: "Add Inlet screen unit" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add Old pump unit" })).toBeNull();
}

/** P36 — the Plant tab names its library and licence. */
export async function thePlantTabShowsItsLicenceLine(): Promise<void> {
  await openPlant();
  expect(screen.getByText("Plant — CC BY 4.0")).toBeInTheDocument();
}

/** P37 — the Plant tab shows its attribution text in a `<details>`. */
export async function thePlantTabShowsItsAttributionInDetails(): Promise<void> {
  await openPlant();
  const details = screen.getByTestId("mimic-palette-licence");
  expect(details.querySelector("summary")?.textContent).toBe("Licence notice");
  expect(details.querySelector("pre")?.textContent).toBe("Drawn by the plant team");
}

/** P38 — a search finds an org symbol and names its library. */
export async function aSearchFindsAnOrgSymbol(): Promise<void> {
  renderPalette({ libraries: ["core", "org.plant"], catalog: orgCatalogFixture() });
  await search("inlet");
  expect(screen.getByRole("button", { name: "Add Inlet screen unit from Plant" })).toBeInTheDocument();
}

/** P39 — an org symbol adds its unit with the catalog label. */
export async function anOrgSymbolAddsItsUnitWithItsLabel(): Promise<void> {
  const props = await openPlant();
  await userEvent.click(screen.getByRole("button", { name: "Add Inlet screen unit" }));
  expect(props.onAddUnit).toHaveBeenCalledWith("org.plant:inlet", "Inlet screen");
}

/** P40 — an org symbol's glyph is handed its stored symbol. */
export async function anOrgGlyphReceivesItsOrgSymbol(): Promise<void> {
  const spy = vi.spyOn(glyphs, "MimicGlyph");
  await openPlant();
  const orgCalls = spy.mock.calls.filter(([props]) => props.kind === "org.plant:inlet");
  expect(orgCalls.length).toBeGreaterThan(0);
  expect(orgCalls.every(([props]) => props.orgSymbol?.key === "org.plant:inlet")).toBe(true);
}

/** `orgCatalogFixture` with `mdi:water-pump` retired in `bms.mimic_symbols` (decision 7). */
function catalogRetiringWaterPump(): NonNullable<MimicEditorPaletteProps["catalog"]> {
  const catalog = orgCatalogFixture();
  return {
    ...catalog,
    global: catalog.global.map((g) => (g.code === "mdi" ? { ...g, inactiveSymbolKeys: ["mdi:water-pump"] } : g)),
  };
}

/** P41 — ADR 0086 decision 5: the mdi tab does not offer a retired global symbol. */
export async function theMdiTabOmitsARetiredGlobalSymbol(): Promise<void> {
  renderPalette({ libraries: ["core", "mdi"], catalog: catalogRetiringWaterPump() });
  await userEvent.click(screen.getByRole("tab", { name: "Material Design Icons" }));
  const offered = librarySymbolGroups("mdi").flatMap((g) => g.symbols).filter((s) => s !== "mdi:water-pump");
  // Positive control: every other mdi symbol is still offered.
  expect(screen.getByRole("button", { name: `Add ${symbolLabel(offered[0] ?? "unit")} unit` })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: `Add ${symbolLabel("mdi:water-pump")} unit` })).toBeNull();
}

/** P42 — ADR 0086 decision 5: a search does not find a retired global symbol. */
export async function aSearchOmitsARetiredGlobalSymbol(): Promise<void> {
  renderPalette({ libraries: ["core", "mdi"], catalog: catalogRetiringWaterPump() });
  await search("pump");
  // Positive control: the core Pump still matches.
  expect(screen.getByRole("button", { name: "Add Pump unit" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add Water pump unit from Material Design Icons" })).toBeNull();
}
