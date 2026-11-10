import { render } from "@testing-library/react";
import { expect } from "vitest";

import { LUCIDE_SHAPES } from "../../components/widgets/mimic-symbol-libraries/lucide.generated";
import { NavIcon } from "./nav-icon";
import { NAV_ICONS, type NavIconKey } from "./navigation-model";

/**
 * `F4.348` (ADR 0118 Amendment 4 decisions 2–3, plan I4) — `NavIcon` draws a Lucide key's shapes,
 * element for element, as a decorative `svg.nav-icon` that strokes `currentColor` and fills `none`.
 */
export function drawsEachIconFromItsLucideShapes(): void {
  for (const icon of Object.values(NAV_ICONS) as NavIconKey[]) {
    const { container, unmount } = render(<NavIcon icon={icon} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("class")).toBe("nav-icon");
    expect(svg.getAttribute("data-icon")).toBe(icon);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    const shapes = LUCIDE_SHAPES[`lucide:${icon}`];
    expect([...svg.children].map((el) => el.tagName.toLowerCase()), icon).toEqual(shapes.map(([tag]) => tag));
    shapes.forEach(([, attrs], i) => {
      for (const [name, value] of Object.entries(attrs)) expect(svg.children[i]!.getAttribute(name), `${icon} ${name}`).toBe(value);
    });
    unmount();
  }
}
