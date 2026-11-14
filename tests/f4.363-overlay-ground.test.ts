import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { DESIGN_SYSTEMS } from "../packages/shared/src/contracts/design-system";
import { classStrings, webColourSourceFiles } from "./support/colour-scan";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.363` defect 2 — a panel that floats over the page **without a scrim** (the alarm bar, its
 * "New alarms" popup, its "All alarms" and maintenance panels, the Copilot dock) is drawn with
 * `.surface-overlay`, never `.surface-raised`. `swiss-grid` draws `.surface-raised` as a transparent
 * card under an ink rule, so the alarm bar, drawer and popup showed the page through their text
 * (owner report 2026-11-14, AWS, light and dark). The owner also found the popup hard to tell from
 * the page in every design system, so the overlay carries an edge on every side and a drop shadow
 * as well as an opaque ground.
 *
 * Held here: the overlays carry the class; no fixed or sticky class string carries
 * `surface-raised`; `.surface-overlay` paints an opaque ground, a full border and a shadow in both
 * surface variants, and no design system's own rule takes them away. The fixed/sticky sweep reads
 * literal class strings only: a `fixed` that arrives through a `${…}` hole (the Copilot frame's
 * `layered()`) is invisible to it, which is why `OVERLAYS` names the files as well.
 */
const CSS = readFileSync(join(repoRoot, "apps/web/src/index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
const read = (file: string): string => readFileSync(join(repoRoot, file), "utf8");

const OVERLAYS = [
  "apps/web/src/components/alarm-bar/alarm-bar.tsx",
  "apps/web/src/components/alarm-bar/alarm-bar-popup.tsx",
  "apps/web/src/components/alarm-bar/alarm-bar-list.tsx",
  "apps/web/src/components/alarm-bar/alarm-bar-maintenance.tsx",
  "apps/web/src/components/copilot/copilot-dock-frame.tsx",
] as const;

/** Each declaration block whose selector list holds exactly `selector` (whitespace-normalised). */
function bodiesOf(selector: string): string[] {
  const out: string[] = [];
  for (const m of CSS.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (selectors.includes(selector)) out.push(m[2]!);
  }
  return out;
}

/** Whether a design system's own overlay rule removes a side, the edge's style or colour, or the shadow. */
function takesTheEdgeAway(body: string): boolean {
  return (
    /box-shadow:\s*none/.test(body) ||
    /border(?:-width)?:\s*[^;]*(?:^|\s)0(?:px)?(?=[\s;]|$)/m.test(body) ||
    /border-(?:top|right|bottom|left)(?:-width)?:\s*0(?:px)?[\s;]/.test(body) ||
    /border(?:-[a-z]+)?-style:\s*none|border-style:\s*none/.test(body) ||
    /border(?:-[a-z]+)?-color:\s*transparent/.test(body)
  );
}

const TRANSPARENT = /transparent|card-ground|\/\s*0(\.\d+)?\)|rgba?\([^)]*,\s*0(\.\d+)?\)/;
const BASE = ".surface-overlay";
const FLAT = ':where([data-surface="flat"]) .surface-overlay';

describe("F4.363 overlays over the page are opaque and set apart", () => {
  it.each(OVERLAYS)("%s draws its panel with surface-overlay, not surface-raised", (file) => {
    const strings = classStrings(read(file)).map((s) => s.body.split(/\s+/));
    expect(strings.some((tokens) => tokens.includes("surface-overlay")), file).toBe(true);
    expect(strings.filter((tokens) => tokens.includes("surface-raised")), file).toEqual([]);
  });

  it("no fixed or sticky class string in the web tree carries surface-raised", () => {
    const hits = webColourSourceFiles()
      .filter((f) => f.endsWith(".tsx"))
      .flatMap((f) =>
        classStrings(read(relative(repoRoot, f)))
          .map((s) => s.body.split(/\s+/))
          .filter((t) => t.includes("surface-raised") && (t.includes("fixed") || t.includes("sticky")))
          .map((t) => `${relative(repoRoot, f)}: ${t.join(" ")}`),
      );
    expect(hits).toEqual([]);
  });

  it.each([BASE, FLAT])("%s paints an opaque ground, a border on every side and a shadow", (selector) => {
    const body = bodiesOf(selector).join(";");
    const ground = /background-color:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? "";
    expect(ground, selector).not.toBe("");
    expect(ground, selector).not.toMatch(TRANSPARENT);
    expect(body, selector).toMatch(/(?:^|[;\s])border:\s*1px solid rgb\(var\(--ink-muted\) \/ 0\.45\)/);
    expect(/box-shadow:\s*([^;]+);/.exec(body)?.[1] ?? "none", selector).not.toMatch(/^none$|^0 0 0 0/);
  });

  it("the dark theme lifts the overlay onto well-deep, above the surface cards", () => {
    const body = bodiesOf(':where(html[data-theme="dark"]) .surface-overlay').join(";");
    expect(/background-color:\s*([^;]+);/.exec(body)?.[1]?.trim()).toBe("rgb(var(--well-deep))");
  });

  it.each([...DESIGN_SYSTEMS])("%s keeps the overlay's ground, edge and shadow", (design) => {
    const own = bodiesOf(`:where(html[data-design="${design}"]) .surface-overlay`).join(";");
    const ground = /background-color:\s*([^;]+);/.exec(own)?.[1];
    if (ground) expect(ground, design).not.toMatch(TRANSPARENT);
    expect(takesTheEdgeAway(own), design).toBe(false);
  });

  it("the edge check is live: it catches the shapes that remove a side", () => {
    for (const body of [
      "border-width: 3px 0 0 0;",
      "border: 0;",
      "border-left: 0;",
      "border-bottom-width: 0;",
      "border-style: none;",
      "border-color: transparent;",
      "box-shadow: none;",
    ]) {
      expect(takesTheEdgeAway(body), body).toBe(true);
    }
    expect(takesTheEdgeAway("border-top: 3px solid rgb(var(--ink));"), "swiss-grid's own rule").toBe(false);
  });

  it("swiss-grid's cards stay transparent (the gate is not vacuous)", () => {
    expect(CSS).toMatch(/html\[data-design="swiss-grid"\][^{]*\{[^}]*--card-ground:\s*transparent/);
  });
});
