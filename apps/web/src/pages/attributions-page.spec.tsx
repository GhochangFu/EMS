import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AttributionEntry } from "../lib/attributions";
import type { AuthUser } from "../stores/auth-store";
import { AttributionsList, AttributionsPage } from "./attributions-page";

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

/** T1 — the page names itself. */
export function theHeadingRenders(): void {
  renderPage();
  expect(screen.getByRole("heading", { name: "Attributions" })).toBeInTheDocument();
}

/** T2 — one section per library. */
export function fourEntriesRender(): void {
  renderPage();
  expect(screen.getAllByTestId("attribution-entry")).toHaveLength(4);
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
  };
  const { container } = render(<AttributionsList entries={[entry]} />);
  const items = container.querySelectorAll("li");
  expect(items).toHaveLength(1);
  expect(items[0]?.textContent).toContain("pump.svg");
  expect(items[0]?.textContent).toContain("A. Author");
  expect(items[0]?.textContent).toContain("CC-BY 4.0");
}
