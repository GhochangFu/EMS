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

/** The warning texts alone, in order. */
const texts = (layout: Parameters<typeof layoutWarnings>[0]): string[] => layoutWarnings(layout).map((w) => w.text);

const pipe = (fromKey: string, toKey: string): EditorPipe => ({ fromKey, toKey });

/** A layout with no switching unit gets no warning. */
export function noSwitchingUnitNoWarning(): void {
  const nodes = [unit("a", { symbol: "pump", isSwitching: false, isSource: false, roleCode: null })];
  expect(texts({ nodes, pipes: [] })).toEqual([]);
}

/** A switching unit with no source anywhere gives the no-source warning and nothing else. */
export function noSourceWarns(): void {
  const nodes = [unit("v")];
  const out = texts({ nodes, pipes: [] });
  expect(out).toHaveLength(1);
  expect(out[0]).toContain("No unit is marked as an energy source");
}

/** A switching unit with no role warns by its label. */
export function noRoleWarns(): void {
  const nodes = [unit("s", { symbol: "pump", isSource: true }), unit("v", { roleCode: null })];
  const out = texts({ nodes, pipes: [pipe("s", "v")] });
  expect(out).toEqual(['"V" switches but has no role, so it shows no state.']);
}

/** A switching unit no pipe leads to from a source warns; an isSwitching flag counts as switching. */
export function unreachedWarns(): void {
  const nodes = [unit("s", { symbol: "pump", isSource: true }), unit("p", { symbol: "pump", isSwitching: true })];
  const out = texts({ nodes, pipes: [] });
  expect(out).toEqual(['"P" switches but no source reaches it along the pipes.']);
}

/** A connected, roled, sourced layout gets no warning, a path through a passive unit included. */
export function aSoundLayoutNoWarning(): void {
  const nodes = [unit("s", { symbol: "pump", isSource: true }), unit("m", { symbol: "pump" }), unit("v")];
  expect(texts({ nodes, pipes: [pipe("s", "m"), pipe("m", "v")] })).toEqual([]);
}

/** A pipe drawn from the switching unit to the source does not reach it. */
export function aPipeTheWrongWayDoesNotReach(): void {
  const nodes = [unit("s", { symbol: "pump", isSource: true }), unit("v")];
  const out = texts({ nodes, pipes: [pipe("v", "s")] });
  expect(out).toEqual(['"V" switches but no source reaches it along the pipes.']);
}

/**
 * Two switching units that share a label (the palette names each new unit after its symbol) give
 * two warnings with the same text but distinct keys, so the editor's list keys never collide.
 */
export function sameLabelUnitsGetDistinctKeys(): void {
  const nodes = [
    unit("s", { symbol: "pump", isSource: true }),
    unit("a", { label: "Breaker", roleCode: null }),
    unit("b", { label: "Breaker", roleCode: null }),
  ];
  const out = layoutWarnings({ nodes, pipes: [pipe("s", "a"), pipe("s", "b")] });
  expect(out.map((w) => w.text)).toEqual([
    '"Breaker" switches but has no role, so it shows no state.',
    '"Breaker" switches but has no role, so it shows no state.',
  ]);
  expect(new Set(out.map((w) => w.key)).size).toBe(2);
}
