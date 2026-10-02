import { editorReducer, emptyEditorLayout, fromPreset, initialEditorState, toWriteBody, type EditorLayout } from "./mimic-editor";

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

const SLD = fromPreset("lv_single_line");

function flagsOf(key: string): { fanOut: boolean; isSource: boolean; roleCode: string | null } {
  const node = SLD.nodes.find((n) => n.key === key);
  if (node === undefined) throw new Error(`no node ${key}`);
  return { fanOut: node.fanOut === true, isSource: node.isSource === true, roleCode: node.roleCode };
}

/** Start from lv_single_line: the breakers, ups, pdu and hvac fan out. */
export function runFromPresetFansOutTheBreakersAndTheRoleUnits(): void {
  for (const key of ["main_breaker", "ups_input", "ups_output", "load_feeders", "mains_feeders", "ups", "pdu", "hvac"]) {
    if (!flagsOf(key).fanOut) throw new Error(`${key} must fan out`);
  }
}

/** Start from lv_single_line: `incoming` alone is a source; the buses are passive. */
export function runFromPresetMarksIncomingAsTheOnlySource(): void {
  const sources = SLD.nodes.filter((n) => n.isSource === true).map((n) => n.key);
  if (sources.join() !== "incoming") throw new Error(`sources: ${sources.join()}`);
  if (flagsOf("main_bus").roleCode !== null || flagsOf("load_bus").roleCode !== null) {
    throw new Error("the buses must be passive");
  }
}

function patched(key: string, patch: { fanOut?: boolean; isSource?: boolean }, base: EditorLayout): EditorLayout {
  return editorReducer(initialEditorState(base), { type: "update-node", key, patch }).layout;
}

/** patchNode sets both flags on a unit. */
export function runPatchNodeSetsFlagsOnAUnit(): void {
  const out = patched("incoming", { fanOut: true, isSource: false }, SLD).nodes.find((n) => n.key === "incoming");
  if (out?.fanOut !== true || out.isSource !== false) throw new Error("a unit takes fanOut and isSource");
  const back = patched("incoming", { isSource: false }, SLD).nodes.find((n) => n.key === "incoming");
  if (back?.isSource !== false) throw new Error("isSource false clears the flag");
}

/** patchNode ignores both flags on a panel. */
export function runPatchNodeIgnoresFlagsOnAPanel(): void {
  const panel = SLD.nodes.find((n) => n.kind === "panel");
  if (panel === undefined) throw new Error("lv_single_line has a panel");
  const out = patched(panel.key, { fanOut: true, isSource: true }, SLD).nodes.find((n) => n.key === panel.key);
  if (out?.fanOut !== false || out.isSource !== false) throw new Error("a panel must stay without flags");
}

/** A new unit defaults both flags to false. */
export function runANewUnitHasNoFlags(): void {
  const next = editorReducer(initialEditorState(emptyEditorLayout()), { type: "add-unit", symbol: "breaker", label: "B" });
  const node = next.layout.nodes[0];
  if (node?.fanOut !== false || node.isSource !== false) throw new Error("a new unit has both flags false");
}

/** Round trip: a started layout writes the flags that its preset implies. */
export function runStartedLayoutWritesItsFlags(): void {
  const nodes = toWriteBody(SLD).nodes;
  const main = nodes.find((n) => n.key === "main_breaker");
  const incoming = nodes.find((n) => n.key === "incoming");
  if (main?.fanOut !== true || incoming?.isSource !== true) throw new Error("flags must reach the write body");
}
