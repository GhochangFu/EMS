import { createElement } from "react";

import { LUCIDE_SHAPES } from "../../components/widgets/mimic-symbol-libraries/lucide.generated";
import type { NavIconKey } from "./navigation-model";

/** The geometry attributes a Lucide shape may carry; anything else never reaches React. */
const SHAPE_ATTRS = ["d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points"] as const;

function shapeAttrs(attrs: object, key: number): Record<string, string | number> {
  const out: Record<string, string | number> = { key };
  for (const name of SHAPE_ATTRS) {
    const value: unknown = (attrs as Record<string, unknown>)[name];
    if (Object.prototype.hasOwnProperty.call(attrs, name) && typeof value === "string") out[name] = value;
  }
  return out;
}

/**
 * `F4.348` (ADR 0118 Amendment 4 decisions 2–4) — a navigation item's icon: the item's Lucide
 * shapes from the repo's generated `LUCIDE_SHAPES` (lucide-static 1.48.0, ISC/MIT; the notice is
 * `LUCIDE_LICENCE_NOTICE`), in a 24×24 box. It strokes `currentColor`, so it takes the item's ink in
 * every profile and theme; `.nav-icon` in `index.css` sizes and strokes it from the design system's
 * four `--icon-*` tokens. Decorative: the link carries the name.
 */
export function NavIcon({ icon }: { icon: NavIconKey }) {
  const shapes = LUCIDE_SHAPES[`lucide:${icon}`];
  return (
    <svg
      className="nav-icon"
      data-icon={icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {shapes.map(([tag, attrs], i) => createElement(tag, shapeAttrs(attrs, i)))}
    </svg>
  );
}
