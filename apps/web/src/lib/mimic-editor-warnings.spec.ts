import { expect } from "vitest";

import type { EditorNode, EditorPipe } from "./mimic-editor";
import { layoutWarnings } from "./mimic-editor-warnings";

/**
 * `F3.80` / ADR 0101 d14 — the editor warnings for a layout with switching units. Assertions live
 * here; `mimic-editor-warnings.test.ts` is the vitest entry point (ADR 0014).
 */

function unit(key: string, over: Partial<EditorNode> = {}): EditorNode {
  return {
    key,
    kind: "unit",
    symbol: "breaker",
    label: key.toUpperCase(),
    roleCode: "r",
    tone: null,
    x: 0,
    y: 0,
    w: 2,
    h: 2,
    z: 0,
    fanOut: false,
    isSource: false,
    isSwitching: false,
    ...over,
  };
}

const pipe = (fromKey: string, toKey: string): EditorPipe => ({ fromKey, toKey });

/** A layout with no switching unit gets no warning. */
export function noSwitchingUnitNoWarning(): void {
  const nodes = [unit("a", { symbol: "pump", isSwitching: false, isSource: false, roleCode: null })];
  expect(layoutWarnings({ nodes, pipes: [] })).toEqual([]);
}

/** A switching unit with no source anywhere gives the no-source warning and nothing else. */
export function noSourceWarns(): void {
  const nodes = [unit("v")];
  const out = layoutWarnings({ nodes, pipes: [] });
  expect(out).toHaveLength(1);
  expect(out[0]).toContain("No unit is marked as an energy source");
}

/** A switching unit with no role warns by its label. */
export function noRoleWarns(): void {
  const nodes = [unit("s", { symbol: "pump", isSource: true }), unit("v", { roleCode: null })];
  const out = layoutWarnings({ nodes, pipes: [pipe("s", "v")] });
  expect(out).toEqual(['"V" switches but has no role, so it shows no state.']);
}

/** A switching unit no pipe leads to from a source warns; an isSwitching flag counts as switching. */
export function unreachedWarns(): void {
  const nodes = [unit("s", { symbol: "pump", isSource: true }), unit("p", { symbol: "pump", isSwitching: true })];
  const out = layoutWarnings({ nodes, pipes: [] });
  expect(out).toEqual(['"P" switches but no source reaches it along the pipes.']);
}

/** A connected, roled, sourced layout gets no warning, a path through a passive unit included. */
export function aSoundLayoutNoWarning(): void {
  const nodes = [unit("s", { symbol: "pump", isSource: true }), unit("m", { symbol: "pump" }), unit("v")];
  expect(layoutWarnings({ nodes, pipes: [pipe("s", "m"), pipe("m", "v")] })).toEqual([]);
}

/** A pipe drawn from the switching unit to the source does not reach it. */
export function aPipeTheWrongWayDoesNotReach(): void {
  const nodes = [unit("s", { symbol: "pump", isSource: true }), unit("v")];
  const out = layoutWarnings({ nodes, pipes: [pipe("v", "s")] });
  expect(out).toEqual(['"V" switches but no source reaches it along the pipes.']);
}
