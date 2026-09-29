import { describe, expect, it } from "vitest";

import { surfaceCardCounts, surfaceCardFindings } from "./support/surface-card-scan";

/**
 * `F3.71` V1 — no spelled-out surface is left (ADR 0085 decisions 5 and 6, plan §4). A card a
 * call site still spells as `bg-surface` + `border-line`, or a form field whose class names
 * `border-line` / `rounded border`, is a surface the vocabulary does not style: it stays flat
 * under the neumorphic style. `tests/support/surface-card-scan.ts` finds them.
 *
 * The sweeps ran against a per-file floor (334 findings in 84 files at the foundation commit);
 * the floor is gone and V1 is exact: every file holds none, except the `KEPT` sites, each with
 * its reason. A kept count that no longer matches its file fails too, so the list cannot go stale.
 * The mimic editor files waited for `F3.32e` (plan unit D); they were converted after it merged.
 */

const KEPT: Record<string, { count: number; reason: string }> = {
  "apps/web/src/components/maintenance-schedules-panel.tsx": {
    count: 1,
    reason: "the neutral status-pill tone string (border-line bg-surface text-ink-muted), not a card",
  },
  "apps/web/src/lib/vocabulary.ts": {
    count: 1,
    reason: "the neutral pill tone of the shared vocabulary, not a card",
  },
};

describe("F3.71 V1 no spelled-out surface is left", () => {
  it("V1 every file holds exactly its KEPT count of spelled-out cards and fields (none for the rest)", () => {
    const actual = Object.fromEntries(surfaceCardCounts());
    const expected = Object.fromEntries(Object.entries(KEPT).map(([file, { count }]) => [file, count]));
    expect(actual).toEqual(expected);
  });

  it("V1 the scan is live: it finds a spelled-out card", () => {
    expect(surfaceCardFindings('const a = "rounded border border-line bg-surface p-4";')).toEqual(["card:1"]);
  });

  it("V1 the scan is live: it finds a spelled-out field", () => {
    expect(surfaceCardFindings('<input className="w-full rounded border px-2" />')).toEqual(["field:1"]);
  });

  it("V1 the scan does not count a vocabulary field", () => {
    expect(surfaceCardFindings('<select className="surface-field w-full px-2 py-1" />')).toEqual([]);
  });
});
