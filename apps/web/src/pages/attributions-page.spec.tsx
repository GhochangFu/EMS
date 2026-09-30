import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { MimicSymbolLibrariesResponse } from "@bms/shared";

import type { AttributionEntry } from "../lib/attributions";
import { orgCatalogFixture } from "../lib/mimic-symbols.spec";
import type { AuthUser } from "../stores/auth-store";
import { AttributionsList } from "../components/attributions-list";
import { MIMIC_LIBRARY_CREDITS, libraryCredits } from "../components/widgets/mimic-symbol-libraries/credits";
import { AttributionsPage } from "./attributions-page";

// Slice 2 (plan U5) — the per-file credits come from `libraryCredits`; the mock defaults to the real
// one so T1–T8 read the vendored modules, and the credits claims set an implementation.
vi.mock("../components/widgets/mimic-symbol-libraries/credits", async (importOriginal) => {
  const original = await importOriginal<typeof import("../components/widgets/mimic-symbol-libraries/credits")>();
  return { ...original, libraryCredits: vi.fn(original.libraryCredits) };
});

/**
 * `F3.32f` slice 1 (ADR 0086 decision 8) — the attributions page. `attributions-page.test.tsx`
 * is the Vitest entry.
 */

const viewer = {
  id: "u1",
  email: "viewer@bms.local",
  displayName: "Viewer",
  role: "viewer",
} as unknown as AuthUser;

function renderPage(): void {
  // AppShell's status indicator fetches; an unstubbed fetch would reach the real API on :4000.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AttributionsPage user={viewer} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function entryNamed(name: RegExp): HTMLElement {
  const section = screen.getAllByTestId("attribution-entry").find((el) => name.test(el.querySelector("h2")?.textContent ?? ""));
  if (section === undefined) {
    throw new Error(`no attribution entry matches ${String(name)}`);
  }
  return section;
}

/** Serves `catalog` for the symbol-library read and `{}` for every other fetch. */
function renderPageWithCatalog(catalog: MimicSymbolLibrariesResponse): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/api/v1/mimic-symbol-libraries") ? catalog : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AttributionsPage user={viewer} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return fetchMock;
}

/** T9 — the organization section names each library, its licence and its attribution. */
export async function theOrgSectionListsEachLibrary(): Promise<void> {
  renderPageWithCatalog(orgCatalogFixture());
  const section = await screen.findByRole("region", { name: "Your organization's libraries" });
  const plant = (await within(section).findAllByTestId("attribution-org-entry")).find(
    (el) => el.querySelector("h3")?.textContent === "Plant",
  );
  expect(plant).toBeDefined();
  expect(plant?.textContent).toContain("Licence: CC BY 4.0");
  expect(plant?.querySelector("pre")?.textContent).toBe("Drawn by the plant team");
}

/** T10 — every organization library is listed, retired ones too (their drawings still draw). */
export async function theOrgSectionListsEveryLibrary(): Promise<void> {
  renderPageWithCatalog(orgCatalogFixture());
  const section = await screen.findByRole("region", { name: "Your organization's libraries" });
  const names = (await within(section).findAllByTestId("attribution-org-entry")).map((el) => el.querySelector("h3")?.textContent);
  expect(names).toEqual(["Plant", "Legacy"]);
}

/** T11 — no organization library: the section says so. */
export async function theOrgSectionSaysWhenThereIsNone(): Promise<void> {
  renderPageWithCatalog({ global: [], organization: [] });
  const section = screen.getByRole("region", { name: "Your organization's libraries" });
  expect(await within(section).findByText("No organization library")).toBeInTheDocument();
}

/** T12 — the catalog is read with no organization: every organization the caller reads. */
export async function theCatalogIsReadUnscoped(): Promise<void> {
  const fetchMock = renderPageWithCatalog(orgCatalogFixture());
  await screen.findAllByTestId("attribution-org-entry");
  const urls = fetchMock.mock.calls.map(([input]) => String(input)).filter((u) => u.includes("/mimic-symbol-libraries"));
  expect(urls).toHaveLength(1);
  expect(urls[0]?.endsWith("/api/v1/mimic-symbol-libraries")).toBe(true);
}

/** T13 — the organization section leaves the global list at seven entries. */
export async function theOrgSectionIsNotAGlobalEntry(): Promise<void> {
  renderPageWithCatalog(orgCatalogFixture());
  await screen.findAllByTestId("attribution-org-entry");
  expect(screen.getAllByTestId("attribution-entry")).toHaveLength(7);
}

/** T1 — the page names itself. */
export function theHeadingRenders(): void {
  renderPage();
  expect(screen.getByRole("heading", { name: "Attributions" })).toBeInTheDocument();
}

/** T2 — one section per library. */
export function sevenEntriesRender(): void {
  renderPage();
  expect(screen.getAllByTestId("attribution-entry")).toHaveLength(7);
}

/** T3 — Lucide's heading and licence line. */
export function lucideShowsItsVersionAndLicence(): void {
  renderPage();
  const lucide = entryNamed(/^Lucide/);
  expect(within(lucide).getByRole("heading").textContent).toBe("Lucide 1.48.0");
  expect(within(lucide).getByText("Licence: ISC and MIT")).toBeInTheDocument();
}

/** T4 — Lucide's Source link opens its site in a new tab, safely. */
export function lucideSourceLinkOpensSafely(): void {
  renderPage();
  const link = within(entryNamed(/^Lucide/)).getByRole("link", { name: "Source" });
  expect(link).toHaveAttribute("href", "https://lucide.dev");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
}

/** T5 — Core has no link and no notice. */
export function coreHasNoLinkAndNoNotice(): void {
  renderPage();
  const core = entryNamed(/^Core/);
  // Positive control: the Core section rendered its licence.
  expect(within(core).getByText("Licence: Own drawings")).toBeInTheDocument();
  expect(core.querySelector("a")).toBeNull();
  expect(core.querySelector("details")).toBeNull();
}

/** T6 — the MDI notice is shown. */
export function mdiShowsItsNotice(): void {
  renderPage();
  expect(entryNamed(/^Material Design Icons/).querySelector("pre")?.textContent).toContain("Pictogrammers Free License");
}

/** T7 — a notice is text, never markup. */
export function aNoticeIsTextNotMarkup(): void {
  const entry: AttributionEntry = {
    code: "x",
    name: "X",
    version: "1",
    licence: "MIT",
    sourceUrl: null,
    notice: "<b>x</b>",
    credits: [],
    symbolCredits: [],
  };
  const { container } = render(<AttributionsList entries={[entry]} />);
  expect(container.querySelector("pre")?.textContent).toBe("<b>x</b>");
  expect(container.querySelector("b")).toBeNull();
}

/** T8 — one credit renders one list item naming file, author and licence. */
export function aCreditRendersOneListItem(): void {
  const entry: AttributionEntry = {
    code: "x",
    name: "X",
    version: "1",
    licence: "MIT",
    sourceUrl: null,
    notice: null,
    credits: [{ file: "pump.svg", author: "A. Author", licence: "CC-BY 4.0" }],
    symbolCredits: [],
  };
  const { container } = render(<AttributionsList entries={[entry]} />);
  const items = container.querySelectorAll("li");
  expect(items).toHaveLength(1);
  expect(items[0]?.textContent).toContain("pump.svg");
  expect(items[0]?.textContent).toContain("A. Author");
  expect(items[0]?.textContent).toContain("CC-BY 4.0");
}

const CC_BY_3 = "https://creativecommons.org/licenses/by/3.0/";

/** Two QElectroTech credits (one relative source path, one https URL); Tabler has none. */
function stubTwoQetCredits(): void {
  vi.mocked(libraryCredits).mockImplementation((code) =>
    code === "qet"
      ? [
          { key: "qet:a", author: "A", source: "p/a.elmt", licence: "CC BY 3.0", licenceUrl: CC_BY_3, pin: "abc", adaptation: "Adapted: a" },
          { key: "qet:b", author: "B", source: "https://example.org/b.elmt", licence: "CC BY 3.0", licenceUrl: "", pin: "abc", adaptation: "Adapted: b" },
        ]
      : [],
  );
}

/** T9 — a library with credits lists one row per key, a link only for an https source. */
export function aLibraryWithCreditsListsOneRowPerKey(): void {
  stubTwoQetCredits();
  renderPage();
  const qet = entryNamed(/^QElectroTech/);
  const details = qet.querySelector("details:has(table)");
  expect(details?.querySelector("summary")?.textContent).toBe("Per-file credits (2)");
  const table = within(qet).getByRole("table", { name: "QElectroTech per-file credits" });
  const rows = within(table).getAllByRole("row");
  expect(rows).toHaveLength(3); // header + two credits
  const first = rows[1] as HTMLElement;
  expect(within(first).getByRole("cell", { name: "A" })).toBeInTheDocument();
  expect(within(first).getByRole("link", { name: "CC BY 3.0" })).toHaveAttribute("href", CC_BY_3);
  // A relative source path is text, not a link.
  expect(within(first).getByText("p/a.elmt")).toBeInTheDocument();
  expect(within(first).queryByRole("link", { name: "p/a.elmt" })).toBeNull();
  // An https source is a link.
  const second = rows[2] as HTMLElement;
  expect(within(second).getByRole("link", { name: "https://example.org/b.elmt" })).toHaveAttribute(
    "href",
    "https://example.org/b.elmt",
  );
  // A credit without a licence URL shows the licence as text.
  expect(within(second).queryByRole("link", { name: "CC BY 3.0" })).toBeNull();
  expect(within(second).getByText("CC BY 3.0")).toBeInTheDocument();
}

/**
 * T11 — ADR 0086 decision 9: a vendored QElectroTech row says the symbol is an adaptation (CC BY
 * 3.0 §4(b)), beside its author. Reads the generated credits, not a stub.
 */
export function aQetRowSaysTheSymbolIsAnAdaptation(): void {
  // Only the QElectroTech credits, and a direct row lookup: a role query over every library's
  // 425 rows runs past the 5 s timeout on a loaded machine.
  vi.mocked(libraryCredits).mockImplementation((code) =>
    code === "qet" ? Object.entries(MIMIC_LIBRARY_CREDITS.qet ?? {}).map(([key, credit]) => ({ key, ...credit })) : [],
  );
  renderPage();
  const table = within(entryNamed(/^QElectroTech/)).getByRole("table", { name: "QElectroTech per-file credits" });
  const head = table.querySelector("thead") as HTMLElement;
  expect(within(head).getByRole("columnheader", { name: "Adaptation" })).toBeInTheDocument();
  const row = [...table.querySelectorAll("tbody tr")].find((tr) => tr.firstElementChild?.textContent === "qet:circulating-pump");
  const cells = [...(row?.children ?? [])].map((td) => td.textContent);
  expect(cells[1]).toBe("Rafael Ferrando");
  expect(cells[5]).toBe(
    "Adapted: converted to geometry, scaled into a 24-unit box; texts, terminals, line-end markers, fills and line styles removed.",
  );
}

/** T10 — a library without credits (Tabler) shows no table. */
export function aLibraryWithoutCreditsShowsNoTable(): void {
  stubTwoQetCredits();
  renderPage();
  // Positive control: the QElectroTech section does have its table.
  expect(within(entryNamed(/^QElectroTech/)).getByRole("table")).toBeInTheDocument();
  const tabler = entryNamed(/^Tabler/);
  expect(tabler.querySelector("table")).toBeNull();
  expect(within(tabler).queryByText(/Per-file credits/)).toBeNull();
}
