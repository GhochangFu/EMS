import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BOARD_SPANS, BOARD_TILES } from "../apps/web/src/lib/board-spans";
import { DESIGN_SYSTEMS } from "../packages/shared/src/contracts/design-system";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.341` PR 11 (ADR 0118 decision 2, Amendment 1 A5) — the fixed span table. Its keys are the tile
 * ids the two overview pages really render (`data-tile="…"`), a design system may only give a span
 * to a listed tile, and the one large span goes to the active alarms, never to a quantity.
 */
const PAGE_FILE: Record<keyof typeof BOARD_TILES, string> = {
  "site-overview": "apps/web/src/components/control-room/generated-site-view.tsx",
  "organization-overview": "apps/web/src/pages/control-room/organization-page.tsx",
};

describe("F4.341 the board spans", () => {
  it("BS1 each page's tile list is exactly the data-tile ids the page renders, in order", () => {
    for (const [page, tiles] of Object.entries(BOARD_TILES) as Array<[keyof typeof BOARD_TILES, readonly string[]]>) {
      const src = readFileSync(join(repoRoot, PAGE_FILE[page]), "utf8");
      expect([...src.matchAll(/data-tile="([a-z-]+)"/g)].map((m) => m[1]), page).toEqual([...tiles]);
    }
  });

  it("BS2 every span is on a listed tile of a contract design system", () => {
    for (const [design, boards] of Object.entries(BOARD_SPANS)) {
      expect((DESIGN_SYSTEMS as readonly string[]).includes(design), design).toBe(true);
      for (const [page, board] of Object.entries(boards ?? {})) {
        const tiles = BOARD_TILES[page as keyof typeof BOARD_TILES] as readonly string[];
        for (const tile of Object.keys(board.spans)) expect(tiles, `${design} ${page}`).toContain(tile);
      }
    }
  });

  it("BS3 the large span (two rows) goes only to the active alarms", () => {
    const large = Object.values(BOARD_SPANS).flatMap((boards) =>
      Object.values(boards ?? {}).flatMap((board) => Object.entries(board.spans as Record<string, string>).filter(([, cls]) => /row-span-[2-9]/.test(cls)).map(([tile]) => tile)),
    );
    expect(large.length).toBeGreaterThan(0);
    expect(large.every((tile) => tile === "open-alarms" || tile === "active-alarms")).toBe(true);
  });
});
