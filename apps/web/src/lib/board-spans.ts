import type { DesignSystem } from "@bms/shared";

import { useDesignSystem } from "../stores/theme-store";

/**
 * `F4.341` PR 11 (ADR 0118 decision 2 "board arrangement", Amendment 1 A5) — the fixed tile spans a
 * design system gives the two fixed overview pages. Never free placement: each page's tiles are a
 * closed list (`BOARD_TILES`), and a design system may only widen a tile or change the grid's
 * column split, so no tile (an alarm least of all) can be hidden. The large neutral span goes to
 * what is abnormal now, the active alarms, never to a quantity. User-built dashboards keep their
 * stored layout and are not in this table. `tests/f4.341-board-spans.test.ts` holds the keys to the
 * tile ids the pages render.
 */
export const BOARD_TILES = {
  "site-overview": ["total-load", "assets-fresh", "open-alarms", "critical-alarms", "open-work-orders", "rtus"],
  "organization-overview": ["sites", "active-alarms"],
} as const;

export type BoardPage = keyof typeof BOARD_TILES;
export type BoardTile<P extends BoardPage> = (typeof BOARD_TILES)[P][number];

type Board<P extends BoardPage> = { grid?: string; spans: Partial<Record<BoardTile<P>, string>> };
type Boards = { [P in BoardPage]: Board<P> };

/** The arrangements, by design system. A design system with no entry keeps every page as built. */
export const BOARD_SPANS: Partial<Record<DesignSystem, Boards>> = {
  "bento-ops": {
    "site-overview": { spans: { "open-alarms": "lg:col-span-2 lg:row-span-2" } },
    "organization-overview": { grid: "xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]", spans: {} },
  },
};

/** The current design system's arrangement of `page`: the grid class (or `fallback`) and each tile's span class. */
export function useBoard<P extends BoardPage>(page: P, fallback: string): { grid: string; span: (tile: BoardTile<P>) => string } {
  const board = BOARD_SPANS[useDesignSystem()]?.[page] as Board<P> | undefined;
  return { grid: board?.grid ?? fallback, span: (tile) => board?.spans[tile] ?? "" };
}
