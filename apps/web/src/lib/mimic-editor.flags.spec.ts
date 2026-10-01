import { emptyEditorLayout, toWriteBody, type EditorLayout } from "./mimic-editor";

/**
 * F3.74 (OQ3b) — the editor's save body carries a unit's `fanOut` and `isSource`.
 * A layout save replaces every node, so a flag `toWriteBody` drops is a flag the
 * save clears. Claims live here, not in the 894-line `mimic-editor.spec.ts`.
 */

function layoutWithOneUnit(flags: { fanOut: boolean; isSource: boolean }): EditorLayout {
  const base = emptyEditorLayout();
  return {
    ...base,
    nodes: [
      {
        key: "u1",
        kind: "unit",
        symbol: "breaker",
        label: "Main breaker",
        roleCode: "main-breaker",
        tone: null,
        x: 2,
        y: 2,
        w: 12,
        h: 8,
        z: 0,
        ...flags,
      },
    ],
  };
}

export function runToWriteBodyCarriesASetFanOutFlag(): void {
  const node = toWriteBody(layoutWithOneUnit({ fanOut: true, isSource: false })).nodes[0];
  if (node?.fanOut !== true) {
    throw new Error(`fanOut true must reach the save body, got ${String(node?.fanOut)}`);
  }
}

export function runToWriteBodyCarriesASetSourceFlag(): void {
  const node = toWriteBody(layoutWithOneUnit({ fanOut: false, isSource: true })).nodes[0];
  if (node?.isSource !== true) {
    throw new Error(`isSource true must reach the save body, got ${String(node?.isSource)}`);
  }
}

export function runToWriteBodyOmitsUnsetFlags(): void {
  const node = toWriteBody(layoutWithOneUnit({ fanOut: false, isSource: false })).nodes[0];
  if (node === undefined || "fanOut" in node || "isSource" in node) {
    throw new Error("an unset flag must be omitted from the save body");
  }
}
