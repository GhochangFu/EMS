import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect } from "vitest";

import type { Crumb } from "../../lib/control-room-levels";
import { ControlRoomBreadcrumb } from "./control-room-breadcrumb";

/**
 * `F3.66` plan D2 — `ControlRoomBreadcrumb` on its own. Assertions live here;
 * `control-room-breadcrumb.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 *
 * Every fixture crumb carries a `to`, the last one too: `controlRoomCrumbs`
 * never gives the last crumb a `to`, so a page spec cannot tell "the last
 * crumb is text" from "the last crumb has no link target". Here only the
 * component's own rule keeps the last crumb as text.
 *
 * The absence cases render a sentinel beside the breadcrumb and assert it
 * first, so "no navigation" is read from a rendered tree.
 */

const THREE: readonly Crumb[] = [
  { label: "Control Room", to: "/control-room" },
  { label: "Alpha Utilities", to: "/control-room/org/org-a" },
  { label: "Alpha One", to: "/control-room/site/a1" },
];

function renderCrumbs(crumbs: readonly Crumb[]): void {
  render(
    <MemoryRouter>
      <p>SENTINEL</p>
      <ControlRoomBreadcrumb crumbs={crumbs} />
    </MemoryRouter>,
  );
}

/** K1 — no crumbs: no breadcrumb. */
export function rendersNothingForNoCrumbs(): void {
  renderCrumbs([]);
  expect(screen.getByText("SENTINEL")).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).toBeNull();
}

/** K2 — one crumb: no breadcrumb (D2, the `AdminBreadcrumb` rule). */
export function rendersNothingForOneCrumb(): void {
  renderCrumbs([{ label: "Control Room", to: "/control-room" }]);
  expect(screen.getByText("SENTINEL")).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).toBeNull();
}

/** K3 — three crumbs: a navigation landmark named Breadcrumb. */
export function rendersANamedNavigationForThreeCrumbs(): void {
  renderCrumbs(THREE);
  expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
}

/** K4 — every crumb above the last with a `to` is a link to it. */
export function linksEveryEarlierCrumb(): void {
  renderCrumbs(THREE);
  const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
  const hrefs = within(nav)
    .getAllByRole("link")
    .slice(0, 2)
    .map((link) => [link.textContent, link.getAttribute("href")]);
  expect(hrefs).toEqual([
    ["Control Room", "/control-room"],
    ["Alpha Utilities", "/control-room/org/org-a"],
  ]);
}

/** K5 — the last crumb is text, even when it carries a `to` (after K4's positive control). */
export function rendersTheLastCrumbAsText(): void {
  renderCrumbs(THREE);
  const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
  expect(within(nav).getByRole("link", { name: "Alpha Utilities" })).toBeInTheDocument();
  const current = within(nav).getByText("Alpha One");
  expect(current.closest("a"), "the current crumb must not be a link").toBeNull();
}

export function cleanupBreadcrumb(): void {
  cleanup();
}
