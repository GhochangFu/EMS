import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mimicCoreSymbolSchema } from "@bms/shared/contracts";
import { expect, vi } from "vitest";

import { MIMIC_SYMBOL_GROUPS, librarySymbolGroups, symbolLabel } from "../../lib/mimic-symbols";
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
  expect(props.onAddUnit).toHaveBeenCalledWith("transformer");
}

/** P2c — UPS adds a unit of that symbol (ADR 0082 decision 1, the new IT and UPS group). */
export async function upsAddsThatUnit(): Promise<void> {
  const props = renderPalette();
  await userEvent.click(screen.getByRole("button", { name: "Add UPS unit" }));
  expect(props.onAddUnit).toHaveBeenCalledWith("ups");
}

/** P3 — a glyph button adds a unit of that symbol. */
export async function aSymbolButtonAddsThatUnit(): Promise<void> {
  const props = renderPalette();
  await userEvent.click(screen.getByRole("button", { name: "Add Valve unit" }));
  expect(props.onAddUnit).toHaveBeenCalledWith("valve");
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
  expect(props.onAddUnit).toHaveBeenCalledWith("mdi:water-pump");
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
