import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, walk, withoutComments } from "./support/source-scan";

/**
 * `F4.310` PR A (ADR 0110 decision 3, plan OQ6) — a named **state** paints with the fixed `ok` /
 * `ok-strong` roles, never with the brand `accent` / `accent-strong`, so a colour profile that
 * changes the brand colour never changes what "normal" looks like.
 *
 * The scan finds three source shapes that name a state and then paint it:
 *  - a `case "<state>":` whose `return "…"` string holds an `accent` class;
 *  - an object key `<state>: "…"` whose string is `accent` or holds an `accent` class
 *    (`ok: "accent"`, `good: "text-accent"`);
 *  - a comparison `=== "<state>" ? "…"` whose first branch holds an `accent` class.
 *
 * It does not prove every state site moved (a default `return` after the alarm cases names no
 * state); the PR body lists each moved site. **`PENDING`** holds the mimic files, which move in a
 * follow-up PR after `F4.307`–`F4.309` (owner ruling OQ6, 2026-11-05): an exact per-file count
 * that may only fall, and must be empty before the profile values land (PR D).
 */
const STATES = "normal|ok|healthy|running|energised|energized|closed|good|sent|on|live";
const ACCENT_CLASS = String.raw`\b(?:bg|text|border|fill|stroke|ring)-accent(?:-strong)?\b`;
const SHAPES: RegExp[] = [
  new RegExp(String.raw`case "(?:${STATES})":\s*return\s*"[^"]*${ACCENT_CLASS}`, "g"),
  new RegExp(String.raw`\b(?:${STATES})\s*:\s*"(?:accent(?:-strong)?"|[^"]*${ACCENT_CLASS})`, "g"),
  new RegExp(String.raw`===\s*"(?:${STATES})"\s*\?\s*"[^"]*${ACCENT_CLASS}`, "g"),
];

const PENDING: Record<string, number> = { "lib/mimic.ts": 1 };

const WEB_SRC = join(repoRoot, "apps/web/src");

function hits(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of walk(WEB_SRC)) {
    if (!/\.(ts|tsx)$/.test(file) || /\.(spec|test)\.tsx?$/.test(file)) continue;
    const text = withoutComments(readFileSync(file, "utf8"));
    const n = SHAPES.reduce((sum, re) => sum + [...text.matchAll(re)].length, 0);
    if (n > 0) out[relative(WEB_SRC, file)] = n;
  }
  return out;
}

describe("F4.310: a named state paints with ok, not accent (ADR 0110 decision 3)", () => {
  it("K1 no state site outside PENDING paints with an accent class", () => {
    const found = hits();
    const outside = Object.entries(found).filter(([file]) => !(file in PENDING));
    expect(outside).toEqual([]);
  });

  it("K2 each PENDING file holds exactly its recorded count (the ratchet may only fall)", () => {
    const found = hits();
    const drift = Object.entries(PENDING)
      .map(([file, n]) => [file, n, found[file] ?? 0] as const)
      .filter(([, n, got]) => n !== got);
    expect(drift).toEqual([]);
  });

  it("K3 the scan sees each shape (self-test on fixed text)", () => {
    const sample = [
      'case "normal":\n      return "border-accent/20 bg-accent/10";',
      'ok: "accent",',
      'good: "text-accent",',
      'x === "normal" ? "bg-accent" : "bg-critical"',
    ];
    expect(sample.map((s) => SHAPES.some((re) => new RegExp(re.source).test(s)))).toEqual([true, true, true, true]);
  });
});
