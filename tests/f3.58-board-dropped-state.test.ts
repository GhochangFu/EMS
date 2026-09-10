import { pathToFileURL } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `F3.58` — a dropped row must render as dropped, on every surface that
 * claims to say what state a row is in.
 *
 * **Why this file exists at all.** `F3.58` was the first dropped row this
 * repository ever had, and closing it exposed that the board could not render
 * one. Two separate code paths announced it as active work:
 *
 * 1. `stateOf`'s first branch claimed any row whose id a branch name spells,
 *    ahead of the `dropped` branch — so the row rendered "In flight" and, worse,
 *    the `dropped` branch never ran, which also cost it its own `stateKey`.
 * 2. The "In flight" stat tile, the "In flight now" section header and the
 *    cards under it read the in-progress set **directly** rather than
 *    `stateKey`, so guarding `stateOf` alone still left the client-facing card
 *    reading *"Actively being built now."* of a decision that had been dropped.
 *
 * **Both halves were extracted so this file can drive them.** The generator is
 * a top-level script — importing it reads `backlog-status.json` and writes
 * three HTML files — and the deciding input was a module-level `const` derived
 * from the repository's branches. A parameter is what a suite can move.
 *
 * **Generating the board and asserting on the HTML would not gate this.** CI's
 * checkout is shallow, so it derives no in-progress set at all: every case
 * below would pass vacuously against the one input that produced the defect.
 * That is why these are unit cases against a driven set, and it is the reason
 * to resist "just render it and grep" if this file is ever rewritten.
 */

type Row = {
  id: string;
  status: string;
  held?: boolean;
  readyToStart?: boolean;
  gate?: { kind: string };
};

type StateModule = {
  stateOf: (it: Row, inProgressIds: Set<string>) => { label: string; cls: string; key: string };
  STATE_KEYS: ReadonlyArray<{ key: string; label: string; token: string }>;
  scopeTotal: (counts: { total: number; dropped?: number }) => number;
  inFlightRows: <T extends { id: string }>(
    inProgress: readonly T[],
    lookup: (id: string) => Row | undefined,
  ) => T[];
};

// A variable path, so this stays a runtime import: the module is plain ESM
// JavaScript with no declaration file, and a static import would not typecheck.
const MODULE = join(process.cwd(), "docs", "scripts", "backlog-state.mjs");
const { stateOf, STATE_KEYS, scopeTotal, inFlightRows } = (await import(
  pathToFileURL(MODULE).href
)) as StateModule;

const row = (over: Partial<Row> & { id: string; status: string }): Row => ({
  held: false,
  readyToStart: false,
  ...over,
});

describe("F3.58 — a dropped row renders as dropped", () => {
  /**
   * THE case. A branch named `chore/agents-F3.58-wont-fix` puts `F3.58` in the
   * in-progress set while the row is being closed, which is exactly when the
   * board is regenerated. Remove `&& it.status !== "dropped"` from `stateOf`'s
   * first branch and this reddens on both assertions.
   */
  it("is not claimed by the in-flight branch even when a branch spells its id", () => {
    const dropped = row({ id: "F3.58", status: "dropped" });
    const state = stateOf(dropped, new Set(["F3.58"]));

    expect(state.label).toBe("Dropped");
    expect(state.key).toBe("dropped");
  });

  it("renders as dropped when no branch spells its id", () => {
    const state = stateOf(row({ id: "F3.58", status: "dropped" }), new Set());

    expect(state.label).toBe("Dropped");
    expect(state.key).toBe("dropped");
  });

  /**
   * The guard must not be over-broad. Widen it to skip the flight branch for
   * every row, or drop the `inProgressIds` test, and this reddens — which is
   * what stops the fix above from being "never show anything in flight".
   */
  it("still puts a genuinely in-progress row in flight", () => {
    const state = stateOf(row({ id: "F3.57", status: "pending" }), new Set(["F3.57"]));

    expect(state.label).toBe("In flight");
    expect(state.key).toBe("flight");
  });

  /** `done` was already excluded from the flight branch; this keeps it so. */
  it("keeps a done row done even while a branch spells its id", () => {
    const state = stateOf(row({ id: "F3.49", status: "done" }), new Set(["F3.49"]));

    expect(state.key).toBe("done");
  });
});

describe("F3.58 — dropped is its own state, not a synonym for waiting", () => {
  /**
   * `dropped` shared `waiting`'s key and `--lamp-idle`'s token when the row was
   * first closed, which is the same defect `planned` had until 2026-08-23: the
   * legend, the wave lanes, the priority matrix, the track bars and the state
   * chips all tally `stateKey`, so a shared key counts a closed decision as
   * waiting work and leaves no chip able to filter it.
   */
  it("has its own STATE_KEYS entry", () => {
    const entry = STATE_KEYS.find((s) => s.key === "dropped");

    expect(entry).toBeDefined();
    expect(entry?.label).toBe("Dropped");
  });

  it("shares neither its key nor its token with another state", () => {
    const keys = STATE_KEYS.map((s) => s.key);
    const tokens = STATE_KEYS.map((s) => s.token);

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  /**
   * A `stateOf` key with no `STATE_KEYS` entry is invisible to every aggregate
   * on the page. This is the general form of the defect, so a state added later
   * cannot repeat it — the reason it drives every branch rather than only the
   * dropped one.
   */
  it("gives every state stateOf can return an entry in STATE_KEYS", () => {
    const reachable = [
      stateOf(row({ id: "a", status: "pending" }), new Set(["a"])),
      stateOf(row({ id: "b", status: "done" }), new Set()),
      stateOf(row({ id: "c", status: "dropped" }), new Set()),
      stateOf(row({ id: "d", status: "pending", held: true }), new Set()),
      stateOf(row({ id: "e", status: "pending", held: true, gate: { kind: "client" } }), new Set()),
      stateOf(row({ id: "f", status: "planned" }), new Set()),
      stateOf(row({ id: "g", status: "pending", readyToStart: true }), new Set()),
      stateOf(row({ id: "h", status: "pending" }), new Set()),
    ].map((s) => s.key);

    const declared = new Set(STATE_KEYS.map((s) => s.key));
    expect([...new Set(reachable)].filter((k) => !declared.has(k))).toEqual([]);
    // Not vacuous: every declared key must also be reachable, so a dead entry
    // in STATE_KEYS is caught as well as a missing one.
    expect([...declared].filter((k) => !reachable.includes(k))).toEqual([]);
  });
});

describe("F3.58 — a dropped row is not remaining scope", () => {
  it("excludes dropped rows from the scope total", () => {
    expect(scopeTotal({ total: 278, dropped: 1 })).toBe(277);
  });

  it("treats an absent dropped count as zero rather than NaN", () => {
    expect(scopeTotal({ total: 278 })).toBe(278);
  });
});

describe("F3.58 — the second code path: the in-flight section", () => {
  /**
   * `stateOf`'s guard cannot reach the stat tile, the section header or the
   * cards, because all three read the in-progress set directly. Revert
   * `inFlightRows` to `inProgress` unfiltered and this reddens, while every
   * `stateOf` case above stays green — which is the whole reason it is a
   * separate case.
   */
  it("drops a dropped row from the in-flight list", () => {
    const rows: Row[] = [
      row({ id: "F3.58", status: "dropped" }),
      row({ id: "F4.57", status: "pending" }),
    ];
    const lookup = (id: string) => rows.find((r) => r.id === id);

    const kept = inFlightRows([{ id: "F3.58" }, { id: "F4.57" }], lookup);

    expect(kept.map((p) => p.id)).toEqual(["F4.57"]);
  });

  it("keeps a row the board does not know, rather than silently hiding it", () => {
    // An id with no board row is a different fault — a stale branch, or a row
    // deleted against the file's own rule — and hiding it would hide that too.
    const kept = inFlightRows([{ id: "F9.99" }], () => undefined);

    expect(kept.map((p) => p.id)).toEqual(["F9.99"]);
  });
});
