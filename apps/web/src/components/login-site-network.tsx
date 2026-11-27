import { useLayoutEffect, useRef, useState } from "react";

/**
 * `F4.398` (ADR 0142 Amendment 4, with Amendment 3 items 4 and 6) — the site network behind the
 * login hero: a faint drawing of sites joined by lines, spread evenly over the whole panel, where
 * single sites brighten in turn. Decoration only: hidden from assistive technology, never
 * focusable, drawn from the ADR 0078 roles through `currentColor`.
 *
 * **It never sits under text** (the owner's condition). The hero's text blocks move with the size
 * of the window, so no fixed area can hold them. The network measures them instead:
 *  - the page marks each container of text blocks with `data-network-clear`; every direct child
 *    of such a container is one block (the logo, the headline, the description, the chip row,
 *    each feature tile);
 *  - a site is drawn only when its centre is at least `SITE_CLEAR_PX` from every block;
 *  - a line is drawn only when both its sites are drawn and it stays at least `LINE_CLEAR_PX`
 *    from every block;
 *  - the measure runs in a layout effect, so the first paint is already clear, and again when the
 *    panel or a block changes size. Until a measure has run, and where there is no layout to
 *    measure, nothing is drawn;
 *  - the network is drawn only from `lg` up, where the hero is a column of its own.
 *
 * `drawnNetwork` is the rule as a pure function; `login-site-network.spec.tsx` SN1 and SN4 hold it.
 *
 * Positions are a fixed list, not random numbers: the page looks the same on every load. The list
 * was made once by best-candidate sampling (each new site is the candidate farthest from the
 * sites before it) in a 600 x 800 panel, then written down; SN6 holds its evenness. The lines join
 * near neighbours, shortest first: at most three to a site, none crossing another.
 */

/** A site, as `[x, y]` in per cent of the panel. */
export type Site = readonly [number, number];

/** A text block, in px from the panel's top left corner. */
export type Box = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

/** The least distance, in px, from a drawn site's centre to a text block. */
export const SITE_CLEAR_PX = 16;
/** The least distance, in px, from a drawn line to a text block. */
export const LINE_CLEAR_PX = 10;
/** The attribute the page puts on each container of text blocks. */
export const CLEAR_ATTRIBUTE = "data-network-clear";

export const SITES: readonly Site[] = [
  [82, 6.5], [16, 7.5], [30, 7.5], [64, 8], [41, 12], [64, 18],
  [92, 19.5], [76, 20], [21, 21], [37.5, 23.5], [10, 26], [50.5, 27],
  [87, 28], [28.5, 34.5], [63.5, 35], [6.5, 36], [80.5, 37.5], [18, 46.5],
  [80, 47], [33, 47.5], [49, 47.5], [66.5, 53], [84.5, 56], [48, 59],
  [10.5, 62], [30, 62.5], [73, 63], [54.5, 68], [22.5, 71], [39.5, 71],
  [90, 72], [7.5, 75], [62, 78], [75.5, 80], [27, 80.5], [43.5, 81.5],
  [91, 83.5], [14, 90], [55.5, 91], [83.5, 93], [68, 94.5], [31.5, 95],
];

/** Lines between sites, as pairs of indexes into `SITES`. */
export const LINKS: ReadonlyArray<readonly [number, number]> = [
  [0, 3], [0, 6], [0, 7], [1, 2], [1, 8], [2, 4], [3, 5], [4, 9], [5, 7],
  [5, 11], [6, 12], [7, 12], [8, 9], [8, 10], [9, 11], [10, 15], [11, 14], [12, 16],
  [13, 19], [14, 16], [15, 17], [16, 18], [17, 19], [18, 21], [18, 22], [19, 20], [20, 21],
  [20, 23], [21, 26], [22, 26], [23, 25], [23, 27], [24, 31], [25, 28], [25, 29], [26, 30],
  [27, 29], [27, 32], [28, 31], [28, 34], [29, 35], [30, 36], [31, 37], [32, 33], [32, 38],
  [33, 36], [33, 40], [34, 35], [34, 37], [35, 38], [36, 39], [37, 41], [38, 40], [39, 40],
];

/** The distance in px from a point to a box; 0 inside it. */
export function distanceToBox(x: number, y: number, box: Box): number {
  const dx = Math.max(box.left - x, 0, x - (box.left + box.width));
  const dy = Math.max(box.top - y, 0, y - (box.top + box.height));
  return Math.hypot(dx, dy);
}

/** True when the segment a–b passes through the box grown by `margin` on every side. */
export function segmentCrossesBox(ax: number, ay: number, bx: number, by: number, box: Box, margin: number): boolean {
  // Liang–Barsky: clip the segment's parameter range against the four sides.
  let enter = 0;
  let leave = 1;
  const sides: ReadonlyArray<readonly [number, number]> = [
    [ax - bx, ax - (box.left - margin)],
    [bx - ax, box.left + box.width + margin - ax],
    [ay - by, ay - (box.top - margin)],
    [by - ay, box.top + box.height + margin - ay],
  ];
  for (const [direction, room] of sides) {
    if (direction === 0) {
      if (room < 0) return false;
      continue;
    }
    const at = room / direction;
    if (direction < 0) enter = Math.max(enter, at);
    else leave = Math.min(leave, at);
    if (enter > leave) return false;
  }
  return true;
}

/** Which sites and lines are drawn, by index into `SITES` and `LINKS`. */
export type DrawnNetwork = { readonly sites: readonly boolean[]; readonly links: readonly boolean[] };

/**
 * The rule that keeps the network out from under text: for a panel of this size and these text
 * blocks, the sites and the lines that are drawn. A panel with no size draws nothing.
 */
export function drawnNetwork(panel: { readonly width: number; readonly height: number }, boxes: readonly Box[]): DrawnNetwork {
  if (panel.width <= 0 || panel.height <= 0) {
    return { sites: SITES.map(() => false), links: LINKS.map(() => false) };
  }
  const at = SITES.map(([x, y]) => [(x * panel.width) / 100, (y * panel.height) / 100] as const);
  const sites = at.map(([x, y]) => boxes.every((box) => distanceToBox(x, y, box) >= SITE_CLEAR_PX));
  const links = LINKS.map(([from, to]) => {
    if (sites[from] !== true || sites[to] !== true) return false;
    const [ax, ay] = at[from]!;
    const [bx, by] = at[to]!;
    return boxes.every((box) => !segmentCrossesBox(ax, ay, bx, by, box, LINE_CLEAR_PX));
  });
  return { sites, links };
}

/** A block's box in the panel's px. Layout offsets, so a block's own rise-in transform is not read. */
function boxOf(block: Element, root: HTMLElement): Box {
  if (block instanceof HTMLElement) {
    const panel = root.offsetParent;
    let left = 0;
    let top = 0;
    let node: HTMLElement | null = block;
    while (node !== null && node !== panel) {
      left += node.offsetLeft;
      top += node.offsetTop;
      node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
    }
    return { left, top, width: block.offsetWidth, height: block.offsetHeight };
  }
  // An SVG element (the logo) has no layout offsets; neither it nor its ancestors are transformed.
  const origin = root.getBoundingClientRect();
  const rect = block.getBoundingClientRect();
  return { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height };
}

/** Seconds between one site's brightening and the next one's; the cycle itself is in `index.css`. */
const STAGGER_SECONDS = 0.7;
const CYCLE_SECONDS = 5;

/** The decorative site network; fills its positioned parent and keeps clear of its text blocks. */
export function LoginSiteNetwork() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState<DrawnNetwork | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const panel = root?.parentElement ?? null;
    if (root === null || panel === null) return undefined;
    const blocks = [...panel.querySelectorAll(`[${CLEAR_ATTRIBUTE}] > *`)];
    const measure = () => {
      const next = drawnNetwork(
        { width: root.offsetWidth, height: root.offsetHeight },
        blocks.map((block) => boxOf(block, root)),
      );
      // The same answer keeps the same object, so a resize that changes nothing renders nothing.
      setDrawn((last) => (last !== null && JSON.stringify(last) === JSON.stringify(next) ? last : next));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(root);
    for (const block of blocks) observer?.observe(block);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-part="site-network"
      className="pointer-events-none absolute inset-0 hidden text-accent-on-chrome lg:block"
    >
      <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
        {LINKS.map(([from, to], index) =>
          drawn?.links[index] === true ? (
            <line
              key={`${from}-${to}`}
              x1={SITES[from]![0]}
              y1={SITES[from]![1]}
              x2={SITES[to]![0]}
              y2={SITES[to]![1]}
              stroke="currentColor"
              strokeOpacity={0.2}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ) : null,
        )}
      </svg>
      {SITES.map(([x, y], index) =>
        drawn?.sites[index] === true ? (
          <span
            key={`${x}-${y}`}
            data-part="site"
            className="login-site absolute -ml-[3px] -mt-[3px] h-1.5 w-1.5 rounded-full bg-current opacity-30"
            style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${((index * STAGGER_SECONDS) % CYCLE_SECONDS).toFixed(1)}s` }}
          />
        ) : null,
      )}
    </div>
  );
}
