import { act, render } from "@testing-library/react";
import { expect, vi } from "vitest";

import indexCss from "../index.css?raw";
import {
  type Box,
  CLEAR_ATTRIBUTE,
  LINE_CLEAR_PX,
  LINKS,
  LoginSiteNetwork,
  SITE_CLEAR_PX,
  SITES,
  distanceToBox,
  drawnNetwork,
} from "./login-site-network";

/**
 * `F4.398` (ADR 0142 Amendment 4, with Amendment 3 items 4 and 6) — the login page's site network
 * is decoration that never sits under text and is spread evenly over the panel: no drawn site near
 * a text block, no drawn line near one, the list of sites even, the whole thing hidden from
 * assistive technology and drawn only from `lg` up, and moving only when motion is allowed.
 *
 * Assertions live here; `login-site-network.test.tsx` is the Vitest entry point (ADR 0014).
 */

const css = indexCss.split("\r\n").join("\n");

type Layout = { readonly name: string; readonly panel: { readonly width: number; readonly height: number }; readonly boxes: readonly Box[] };

function box(left: number, top: number, width: number, height: number): Box {
  return { left, top, width, height };
}

/**
 * The hero's text blocks as a browser laid them out at five window sizes (measured 2026-11-23:
 * logo, headline, description, chip row, three tiles), and a panel with no text at all.
 */
const LAYOUTS: readonly Layout[] = [
  {
    name: "1024x600",
    panel: { width: 554, height: 654 },
    boxes: [box(117, 75, 320, 144), box(53, 251, 449, 48), box(40, 315, 474, 48), box(53, 387, 449, 26), box(40, 488, 150, 126), box(202, 488, 150, 126), box(364, 488, 150, 126)],
  },
  {
    name: "1024x768",
    panel: { width: 554, height: 702 },
    boxes: [box(117, 99, 320, 144), box(53, 275, 449, 48), box(40, 339, 474, 48), box(53, 411, 449, 26), box(40, 536, 150, 126), box(202, 536, 150, 126), box(364, 536, 150, 126)],
  },
  {
    name: "1280x720",
    panel: { width: 644, height: 654 },
    boxes: [box(162, 85, 320, 144), box(98, 261, 449, 48), box(66, 325, 512, 48), box(97, 397, 449, 26), box(40, 508, 180, 106), box(232, 508, 180, 106), box(424, 508, 180, 106)],
  },
  {
    name: "1440x900",
    panel: { width: 644, height: 834 },
    boxes: [box(162, 175, 320, 144), box(98, 351, 449, 48), box(66, 415, 512, 48), box(97, 487, 449, 26), box(40, 688, 180, 106), box(232, 688, 180, 106), box(424, 688, 180, 106)],
  },
  {
    name: "1920x1080",
    panel: { width: 644, height: 1014 },
    boxes: [box(162, 265, 320, 144), box(98, 441, 449, 48), box(66, 505, 512, 48), box(97, 577, 449, 26), box(40, 868, 180, 106), box(232, 868, 180, 106), box(424, 868, 180, 106)],
  },
];

/** A site's centre in px of a panel. */
function px(index: number, panel: Layout["panel"]): readonly [number, number] {
  const [x, y] = SITES[index]!;
  return [(x * panel.width) / 100, (y * panel.height) / 100];
}

/** The least distance from any of 400 points along a line to a box: a check that shares no code with the rule. */
function lineDistance(link: readonly [number, number], layout: Layout, to: Box): number {
  const [ax, ay] = px(link[0], layout.panel);
  const [bx, by] = px(link[1], layout.panel);
  let least = Number.POSITIVE_INFINITY;
  for (let step = 0; step <= 400; step += 1) {
    const t = step / 400;
    least = Math.min(least, distanceToBox(ax + (bx - ax) * t, ay + (by - ay) * t, to));
  }
  return least;
}

/** A box swept over a panel in steps, so the rule is held at many places, not five. */
function sweptLayouts(): Layout[] {
  const panel = { width: 600, height: 800 };
  const layouts: Layout[] = [];
  for (let left = -40; left <= 560; left += 60) {
    for (let top = -40; top <= 760; top += 80) {
      layouts.push({ name: `sweep ${left},${top}`, panel, boxes: [box(left, top, 170, 90)] });
    }
  }
  return layouts;
}

/** SN1 — no drawn site is near a text block; a box put on a site takes it away, so the rule can fail. */
export function keepsEverySiteClearOfText(): void {
  expect(distanceToBox(50, 50, box(40, 40, 20, 20))).toBe(0);
  expect(distanceToBox(70, 50, box(40, 40, 20, 20))).toBe(10);
  expect(distanceToBox(63, 64, box(40, 40, 20, 20))).toBe(5);
  expect(distanceToBox(30, 50, box(40, 40, 20, 20))).toBe(10);
  expect(distanceToBox(50, 30, box(40, 40, 20, 20))).toBe(10);
  expect(distanceToBox(50, 75, box(40, 40, 20, 20))).toBe(15);

  const open = { width: 600, height: 800 };
  expect(drawnNetwork(open, []).sites.every(Boolean)).toBe(true);
  // Positive twin: a small box on site 20 hides that site and no site far from it.
  const [x, y] = px(20, open);
  const onSite = drawnNetwork(open, [box(x - 5, y - 5, 10, 10)]);
  expect(onSite.sites[20]).toBe(false);
  expect(onSite.sites.filter((site) => !site)).toHaveLength(1);
  // The margin itself: a box whose edge is one px inside the margin hides the site, one px outside does not.
  expect(drawnNetwork(open, [box(x + SITE_CLEAR_PX - 1, y - 5, 10, 10)]).sites[20]).toBe(false);
  expect(drawnNetwork(open, [box(x + SITE_CLEAR_PX + 1, y - 5, 10, 10)]).sites[20]).toBe(true);

  for (const layout of [...LAYOUTS, ...sweptLayouts()]) {
    const { sites } = drawnNetwork(layout.panel, layout.boxes);
    for (const [index, shown] of sites.entries()) {
      const [sx, sy] = px(index, layout.panel);
      const least = Math.min(...layout.boxes.map((to) => distanceToBox(sx, sy, to)));
      // Drawn exactly when clear: nothing near text is drawn, and nothing clear is lost.
      expect(shown, `${layout.name} site ${index}`).toBe(least >= SITE_CLEAR_PX);
    }
  }
  // The rule has work to do at every measured size, and leaves a network behind.
  for (const layout of LAYOUTS) {
    const count = drawnNetwork(layout.panel, layout.boxes).sites.filter(Boolean).length;
    expect(count, layout.name).toBeGreaterThanOrEqual(10);
    expect(count, layout.name).toBeLessThan(SITES.length);
  }
  // A panel with no size (no layout to measure) draws nothing.
  const none = drawnNetwork({ width: 0, height: 0 }, []);
  expect(none.sites.some(Boolean)).toBe(false);
  expect(none.links.some(Boolean)).toBe(false);
}

/** SN2 — every line joins two different, existing sites, and no line is drawn twice. */
export function joinsOnlyRealSites(): void {
  expect(LINKS.length).toBeGreaterThan(0);
  for (const [from, to] of LINKS) {
    expect(SITES[from]).toBeDefined();
    expect(SITES[to]).toBeDefined();
    expect(from).not.toBe(to);
  }
  expect(new Set(LINKS.map(([a, b]) => [a, b].sort((p, q) => p - q).join("-"))).size).toBe(LINKS.length);
}

const PANEL = { width: 600, height: 800 };
/** Where the stubbed layout puts the network's top left corner in the window. */
const ORIGIN = { left: 30, top: 40 };

/**
 * Lays the rendered blocks out for jsdom, which lays nothing out. An HTML element's offsets are
 * its `data-box` (`left,top,width,height`, from its offset parent) and its offset parent is the
 * nearest ancestor marked `data-positioned`; the network itself fills the panel. An SVG element's
 * window rectangle is its `data-rect`. `ResizeObserver` is a fake that records what it observes.
 */
function withLayout(run: (observer: { observed: Element[]; fire: () => void }) => void): void {
  const part = (index: number) =>
    function read(this: HTMLElement): number {
      const own = this.getAttribute("data-box");
      const fallback = this.getAttribute("data-part") === "site-network" ? `0,0,${PANEL.width},${PANEL.height}` : "0,0,0,0";
      return Number((own ?? fallback).split(",")[index]);
    };
  const rect = function read(this: Element): DOMRect {
    const [left = 0, top = 0, width = 0, height = 0] =
      this.getAttribute("data-part") === "site-network"
        ? [ORIGIN.left, ORIGIN.top, PANEL.width, PANEL.height]
        : (this.getAttribute("data-rect") ?? "0,0,0,0").split(",").map(Number);
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
  };
  const observer = { observed: [] as Element[], callback: (): void => undefined, fire: (): void => observer.callback() };
  class FakeResizeObserver {
    constructor(callback: () => void) {
      observer.callback = callback;
    }
    observe(target: Element): void {
      observer.observed.push(target);
    }
    disconnect(): void {
      observer.observed.length = 0;
    }
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const spies = [
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(part(0)),
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(part(1)),
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(part(2)),
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(part(3)),
    vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function read(this: HTMLElement) {
      return this.parentElement?.closest("[data-positioned]") ?? null;
    }),
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(rect),
  ];
  try {
    run(observer);
  } finally {
    for (const spy of spies) spy.mockRestore();
    vi.unstubAllGlobals();
  }
}

/** The `left top` of each drawn site, in document order. */
function drawnSites(network: Element | null): string[] {
  return [...(network?.querySelectorAll<HTMLElement>("[data-part='site']") ?? [])].map((site) => `${site.style.left} ${site.style.top}`);
}

function expectedSites(boxes: readonly Box[]): string[] {
  const expected = drawnNetwork(PANEL, boxes);
  return SITES.filter((_, index) => expected.sites[index]).map(([x, y]) => `${x}% ${y}%`);
}

/**
 * SN3 — decoration: hidden from assistive technology, no text, not clickable, only from `lg` up;
 * and the component draws what the rule gives for the blocks it measures on the page: a block's
 * offsets are summed up to the panel, the logo (an SVG) is read by its rectangle, an unmarked
 * element is not a block, and a block that changes size is measured again.
 */
export function isDecorationOnly(): void {
  // The headline sits in a positioned column at (50, 200): its box in the panel is (100, 300).
  const logo = box(200, 100, 200, 60);
  const headline = box(100, 300, 400, 120);
  const tile = box(40, 660, 160, 100);
  const tallerTile = box(40, 560, 160, 200);
  withLayout((observer) => {
    const { container } = render(
      <section data-positioned="">
        <LoginSiteNetwork />
        <div data-positioned="" data-box="50,200,500,300" {...{ [CLEAR_ATTRIBUTE]: "" }}>
          <svg data-rect={`${ORIGIN.left + logo.left},${ORIGIN.top + logo.top},${logo.width},${logo.height}`} />
          <h1 data-box="50,100,400,120">Headline</h1>
        </div>
        <ul {...{ [CLEAR_ATTRIBUTE]: "" }}>
          <li data-box={`${tile.left},${tile.top},${tile.width},${tile.height}`}>Tile</li>
        </ul>
        <p data-box={`0,0,${PANEL.width},${PANEL.height}`}>Not a marked block</p>
      </section>,
    );
    const network = container.querySelector("[data-part='site-network']");
    expect(network?.getAttribute("aria-hidden")).toBe("true");
    expect(network?.textContent).toBe("");
    const classes = network?.getAttribute("class")?.split(" ") ?? [];
    expect(classes).toContain("pointer-events-none");
    expect(classes).toContain("hidden");
    expect(classes).toContain("lg:block");
    expect(network?.querySelector("a, button, [tabindex]")).toBeNull();

    const first = expectedSites([logo, headline, tile]);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(SITES.length);
    // Each block does its own work: without any one of them, more sites would be drawn.
    for (const without of [[headline, tile], [logo, tile], [logo, headline]]) {
      expect(expectedSites(without).length).toBeGreaterThan(first.length);
    }
    expect(drawnSites(network)).toEqual(first);
    expect(network?.querySelectorAll("line")).toHaveLength(drawnNetwork(PANEL, [logo, headline, tile]).links.filter(Boolean).length);

    // The network and every block are watched; a block that grows is measured again.
    const tileElement = container.querySelector("li");
    expect(observer.observed).toEqual([network, container.querySelector("svg[data-rect]"), container.querySelector("h1"), tileElement]);
    tileElement?.setAttribute("data-box", `${tallerTile.left},${tallerTile.top},${tallerTile.width},${tallerTile.height}`);
    act(() => observer.fire());
    const second = expectedSites([logo, headline, tallerTile]);
    expect(second.length).toBeLessThan(first.length);
    expect(drawnSites(network)).toEqual(second);
  });
}

/** SN4 — no drawn line passes near a text block; a box across a line takes the line away. */
export function keepsEveryLineClearOfText(): void {
  const open = { width: 600, height: 800 };
  expect(drawnNetwork(open, []).links.every(Boolean)).toBe(true);
  // Positive twin: a thin box across the middle of the first line. Both its sites stay; the line goes.
  const [from, to] = LINKS[0]!;
  const [ax, ay] = px(from, open);
  const [bx, by] = px(to, open);
  const across = drawnNetwork(open, [box((ax + bx) / 2 - 2, (ay + by) / 2 - 2, 4, 4)]);
  expect(Math.hypot(bx - ax, by - ay)).toBeGreaterThan(2 * (SITE_CLEAR_PX + 4));
  expect(across.sites[from]).toBe(true);
  expect(across.sites[to]).toBe(true);
  expect(across.links[0]).toBe(false);

  let hiddenWithBothSitesDrawn = 0;
  for (const layout of [...LAYOUTS, ...sweptLayouts()]) {
    const { sites, links } = drawnNetwork(layout.panel, layout.boxes);
    for (const [index, shown] of links.entries()) {
      const link = LINKS[index]!;
      const least = Math.min(...layout.boxes.map((to) => lineDistance(link, layout, to)));
      if (shown) {
        expect(sites[link[0]], `${layout.name} line ${index}`).toBe(true);
        expect(sites[link[1]], `${layout.name} line ${index}`).toBe(true);
        expect(least, `${layout.name} line ${index}`).toBeGreaterThanOrEqual(LINE_CLEAR_PX);
      } else if (sites[link[0]] === true && sites[link[1]] === true) {
        // Hidden for the line's own sake: it does come near a block (the grown box has square corners).
        expect(least, `${layout.name} line ${index}`).toBeLessThan(LINE_CLEAR_PX * Math.SQRT2);
        hiddenWithBothSitesDrawn += 1;
      }
    }
  }
  expect(hiddenWithBothSitesDrawn).toBeGreaterThan(0);
}

/** SN5 — the sites and the rise-in move only when motion is allowed, by transform and opacity. */
export function movesOnlyWhenMotionIsAllowed(): void {
  const block = /@media \(prefers-reduced-motion: no-preference\) \{\s*\.login-site \{[\s\S]*?\n\}\n/.exec(css)?.[0] ?? "";
  for (const name of ["login-site", "login-rise"]) {
    expect(block, name).toMatch(new RegExp(`\\.${name} \\{[^}]*animation: ${name} `));
    const frames = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}\\n`).exec(css)?.[1] ?? "";
    const props = [...frames.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1]);
    expect(props.length, name).toBeGreaterThan(0);
    expect(props.every((prop) => prop === "transform" || prop === "opacity"), name).toBe(true);
  }
  expect(css.replace(block, "")).not.toMatch(/animation: login-(site|rise)/);
  // One brightening every 5 s for a site: far under three flashes a second (WCAG 2.3.1).
  expect(block).toMatch(/animation: login-site 5s /);
}

/** How many of the given sites fall in each cell of a 4 x 4 split of the panel, row by row. */
function cellCounts(indexes: readonly number[]): number[] {
  const cells = Array.from({ length: 16 }, () => 0);
  for (const index of indexes) {
    const [x, y] = SITES[index]!;
    cells[Math.min(3, Math.floor(y / 25)) * 4 + Math.min(3, Math.floor(x / 25))]! += 1;
  }
  return cells;
}

/**
 * SN6 — the network is spread evenly, not a border and not a ring: every sixteenth of the panel
 * holds a site and none holds a crowd; lines are short and few to a site; and at every measured
 * size each sixteenth with no text in or near it still shows a site.
 */
export function spreadsTheSitesEvenly(): void {
  expect(SITES.length).toBeGreaterThanOrEqual(36);
  expect(SITES.length).toBeLessThanOrEqual(44);
  for (const [x, y] of SITES) {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(100);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(100);
  }
  expect(new Set(SITES.map(([x, y]) => `${x},${y}`)).size).toBe(SITES.length);

  const all = cellCounts(SITES.map((_, index) => index));
  const mean = SITES.length / 16;
  expect(Math.min(...all)).toBeGreaterThanOrEqual(1);
  expect(Math.max(...all)).toBeLessThanOrEqual(3 * mean);
  // Not a ring: the four middle cells hold their share of the sites.
  expect(all[5]! + all[6]! + all[9]! + all[10]!).toBeGreaterThanOrEqual(Math.floor(4 * mean * 0.75));

  // Lines: one to three to a site, and none longer than a quarter of the reference panel's diagonal.
  const reference = { width: 600, height: 800 };
  const degree = SITES.map(() => 0);
  for (const [from, to] of LINKS) {
    degree[from]! += 1;
    degree[to]! += 1;
    const [ax, ay] = px(from, reference);
    const [bx, by] = px(to, reference);
    expect(Math.hypot(bx - ax, by - ay), `line ${from}-${to}`).toBeLessThanOrEqual(250);
  }
  expect(Math.min(...degree)).toBeGreaterThanOrEqual(1);
  expect(Math.max(...degree)).toBeLessThanOrEqual(3);

  for (const layout of LAYOUTS) {
    const { sites } = drawnNetwork(layout.panel, layout.boxes);
    const drawn = cellCounts(sites.flatMap((shown, index) => (shown ? [index] : [])));
    for (let cell = 0; cell < 16; cell += 1) {
      const cellBox = box(((cell % 4) * layout.panel.width) / 4, (Math.floor(cell / 4) * layout.panel.height) / 4, layout.panel.width / 4, layout.panel.height / 4);
      const nearText = layout.boxes.some(
        (to) =>
          to.left - SITE_CLEAR_PX < cellBox.left + cellBox.width &&
          to.left + to.width + SITE_CLEAR_PX > cellBox.left &&
          to.top - SITE_CLEAR_PX < cellBox.top + cellBox.height &&
          to.top + to.height + SITE_CLEAR_PX > cellBox.top,
      );
      if (!nearText) expect(drawn[cell], `${layout.name} cell ${cell}`).toBeGreaterThanOrEqual(1);
    }
    // Not a border: sites are drawn in the two middle columns, between and beside the text blocks.
    const middle = [1, 2, 5, 6, 9, 10, 13, 14].reduce((sum, cell) => sum + drawn[cell]!, 0);
    expect(middle, layout.name).toBeGreaterThanOrEqual(3);
  }
}
