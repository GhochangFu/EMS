/**
 * `F4.398` (ADR 0142 Amendment 3 items 4–6) — the site network behind the login hero: a faint
 * drawing of sites joined by lines, where single sites brighten in turn. Decoration only: hidden
 * from assistive technology, never focusable, drawn from the ADR 0078 roles through `currentColor`.
 *
 * **It never sits under text** (the owner's condition). The hero's logo, headline, description and
 * chips stand inside the *clear zone*, an ellipse given in per cent of the panel:
 *  - no site is inside the clear zone — `login-site-network.spec.tsx` SN1 holds that for this list;
 *  - the lines fade out before they reach it — the mask on `.login-network-lines` in `index.css`
 *    is the same ellipse, and SN4 holds the two equal;
 *  - the feature tiles at the foot are opaque, so a site behind one does not show;
 *  - the network is drawn only from `lg` up, where the hero is a column of its own. Below that the
 *    text reflows over the whole panel and there is no clear zone to promise.
 *
 * Positions are a fixed list, not random numbers: the page looks the same on every load and the
 * rule above can be tested.
 */
export const CLEAR_ZONE = { cx: 50, cy: 44, rx: 44, ry: 36 } as const;

/** A site, as `[x, y]` in per cent of the panel. */
export type Site = readonly [number, number];

export const SITES: readonly Site[] = [
  // top left
  [5, 6],
  [12, 4],
  [20, 7],
  [8, 15],
  [3, 24],
  [27, 5],
  [36, 3],
  // top right
  [95, 5],
  [88, 8],
  [80, 5],
  [93, 16],
  [97, 27],
  [70, 4],
  [60, 2.5],
  // left and right edges
  [2.5, 40],
  [2, 56],
  [97.5, 45],
  [98, 60],
  // bottom left
  [4, 70],
  [3, 80],
  [4, 90],
  [1.5, 63],
  // bottom right
  [96, 68],
  [97, 79],
  [96.5, 89],
  [98.5, 52],
  // top centre
  [45, 1.5],
];

/** Lines between sites, as pairs of indexes into `SITES`. */
export const LINKS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [0, 3],
  [3, 4],
  [2, 5],
  [5, 6],
  [1, 3],
  [7, 8],
  [8, 9],
  [7, 10],
  [10, 11],
  [9, 12],
  [12, 13],
  [8, 10],
  [6, 13],
  [4, 14],
  [14, 15],
  [15, 18],
  [11, 16],
  [16, 17],
  [17, 22],
  [18, 19],
  [19, 20],
  [15, 21],
  [21, 18],
  [22, 23],
  [23, 24],
  [16, 25],
  [25, 17],
  [13, 26],
  [26, 6],
];

/** True when a point, in per cent of the panel, lies inside the clear zone. */
export function insideClearZone([x, y]: Site): boolean {
  const { cx, cy, rx, ry } = CLEAR_ZONE;
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
}

/** Seconds between one site's brightening and the next one's; the cycle itself is in `index.css`. */
const STAGGER_SECONDS = 0.7;
const CYCLE_SECONDS = 5;

/** The decorative site network; fills its positioned parent. */
export function LoginSiteNetwork() {
  return (
    <div
      aria-hidden="true"
      data-part="site-network"
      className="pointer-events-none absolute inset-0 hidden text-accent-on-chrome lg:block"
    >
      <svg className="login-network-lines h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
        {LINKS.map(([from, to]) => (
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
        ))}
      </svg>
      {SITES.map(([x, y], index) => (
        <span
          key={`${x}-${y}`}
          data-part="site"
          className="login-site absolute -ml-[3px] -mt-[3px] h-1.5 w-1.5 rounded-full bg-current opacity-30"
          style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${((index * STAGGER_SECONDS) % CYCLE_SECONDS).toFixed(1)}s` }}
        />
      ))}
    </div>
  );
}
