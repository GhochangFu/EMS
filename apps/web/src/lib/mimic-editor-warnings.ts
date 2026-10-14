import { isSwitchingSymbol } from "@bms/shared";

import type { EditorLayout } from "./mimic-editor";

/**
 * `F3.80` / ADR 0101 decision 14 — what the editor says about a layout that has switching units.
 * It warns; it never blocks a save, and a layout with no switching unit gets no warning at all.
 *
 * On a layout with at least one switching unit, in this order: no source unit; each switching
 * unit with no role (node order); each switching unit no source reaches (node order). A pipe
 * carries the walk from `fromKey` to `toKey` only, so a pipe the wrong way round does not reach.
 * With no source every switching unit is unreached, so that case is the first warning alone.
 *
 * Each warning carries a `key` unique within the list (the kind plus the node key): two units may
 * share a label — the palette names a new unit after its symbol — so the text is not a key.
 */
export type LayoutWarning = { readonly key: string; readonly text: string };

export function layoutWarnings(layout: Pick<EditorLayout, "nodes" | "pipes">): readonly LayoutWarning[] {
  const units = layout.nodes.filter((n) => n.kind === "unit");
  const switching = units.filter((n) => n.isSwitching || (n.symbol !== null && isSwitchingSymbol(n.symbol)));
  if (switching.length === 0) return [];

  const warnings: LayoutWarning[] = [];
  const sources = units.filter((n) => n.isSource);
  if (sources.length === 0) {
    warnings.push({ key: "no-source", text: "No unit is marked as an energy source, so nothing is energised." });
  }

  for (const n of switching) {
    if (n.roleCode === null) {
      warnings.push({ key: `no-role:${n.key}`, text: `"${n.label}" switches but has no role, so it shows no state.` });
    }
  }

  if (sources.length > 0) {
    const reached = new Set(sources.map((n) => n.key));
    const queue = [...reached];
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      for (const p of layout.pipes) {
        if (p.fromKey === key && !reached.has(p.toKey)) {
          reached.add(p.toKey);
          queue.push(p.toKey);
        }
      }
    }
    for (const n of switching) {
      if (!reached.has(n.key)) {
        const text = `"${n.label}" switches but no source reaches it along the pipes.`;
        warnings.push({ key: `unreached:${n.key}`, text });
      }
    }
  }
  return warnings;
}
