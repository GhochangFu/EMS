import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect } from "vitest";

import { Breadcrumb } from "./breadcrumb";

/** `F4.341` R6 — the breadcrumb renders a named nav with an ordered list; the last step is the current page. */
export function rendersANamedNavWithAnOrderedList(): void {
  render(
    <MemoryRouter>
      <Breadcrumb steps={[{ label: "Control Room", to: "/control-room" }, { label: "PHE West Bengal", to: "/x" }, { label: "Bhutnirghat WTP" }]} />
    </MemoryRouter>,
  );
  const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
  const list = within(nav).getByRole("list");
  expect(list.tagName).toBe("OL");
  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/control-room", "/x"]);
  expect(within(nav).getByText("Bhutnirghat WTP").getAttribute("aria-current")).toBe("page");
}

export function rendersNothingForOneStep(): void {
  const { container } = render(
    <MemoryRouter>
      <Breadcrumb steps={[{ label: "Only" }]} />
    </MemoryRouter>,
  );
  expect(container.innerHTML).toBe("");
}
