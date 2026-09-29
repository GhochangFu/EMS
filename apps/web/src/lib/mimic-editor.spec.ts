import { MIMIC_LAYOUT_BOUNDS, MIMIC_LAYOUT_NODE_KEY, mimicPresetSchema } from "@bms/shared/contracts";
import { MIMIC_PRESETS } from "@bms/shared";

import { MIMIC_PANELS } from "./mimic";
import {
  clampBox,
  editorReducer,
  fromPreset,
  initialEditorState,
  keyboardAction,
  nextNodeKey,
  toWriteBody,
  type EditorAction,
  type EditorKeyEvent,
  type EditorLayout,
  type EditorNode,
  type EditorState,
} from "./mimic-editor";

/**
 * `F3.32c` U6a — the editor reducer, its history, the preset copy, the write body and the key
 * map. One claim per exported function; `mimic-editor.test.ts` gives each its own `it()`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

function node(state: EditorState, key: string): EditorNode {
  const found = state.layout.nodes.find((n) => n.key === key);
  if (found === undefined) {
    throw new Error(`no node ${key}`);
  }
  return found;
}

/** Two tanks and a panel on the default canvas; tank_1 is selected. */
function twoTanksAndAPanel(): EditorState {
  const s = run(initialEditorState(), { type: "add-unit", symbol: "tank" }, { type: "add-unit", symbol: "tank" }, {
    type: "add-panel",
  });
  return run(s, { type: "select", key: "tank_1" });
}

function key(k: string, extra: Partial<EditorKeyEvent> = {}): EditorKeyEvent {
  return { key: k, shiftKey: false, ctrlKey: false, target: { tagName: "DIV" }, ...extra };
}

// ---- add ----------------------------------------------------------------------------------

export function runAddUnitAddsAUnitWithItsSymbol(): void {
  const s = run(initialEditorState(), { type: "add-unit", symbol: "clarifier" });
  const n = node(s, "clarifier_1");
  assert(n.kind === "unit" && n.symbol === "clarifier" && n.roleCode === null, "add-unit adds a passive unit of the symbol");
}

export function runAddUnitSelectsTheNewNode(): void {
  const s = run(initialEditorState(), { type: "add-unit", symbol: "pump" });
  assert(s.selected === "pump_1", `the new unit is selected, got ${String(s.selected)}`);
}

export function runAddPanelAddsAnInfoPanelWithNoSymbol(): void {
  const s = run(initialEditorState(), { type: "add-panel" });
  const n = node(s, "panel_1");
  assert(n.kind === "panel" && n.symbol === null && n.tone === "info", "add-panel adds an info panel without a symbol");
}

export function runAddLabelAddsANonEmptyLabel(): void {
  const s = run(initialEditorState(), { type: "add-label" });
  const n = node(s, "label_1");
  assert(n.kind === "label" && n.label.length > 0 && n.tone === null, "add-label adds a label with non-empty text");
}

export function runNewKeysFollowTheHighestSuffix(): void {
  let s = run(initialEditorState(), ...Array.from({ length: 3 }, () => ({ type: "add-unit", symbol: "tank" }) as const));
  s = run(s, { type: "delete", key: "tank_2" }, { type: "add-unit", symbol: "tank" });
  assert(s.layout.nodes.some((n) => n.key === "tank_4"), "after deleting tank_2 the next tank is tank_4");
}

export function runNewKeysMatchTheContractPattern(): void {
  const s = run(initialEditorState(), { type: "add-unit", symbol: "discharge" }, { type: "add-panel" }, { type: "add-label" });
  assert(s.layout.nodes.every((n) => MIMIC_LAYOUT_NODE_KEY.test(n.key)), "every generated key matches MIMIC_LAYOUT_NODE_KEY");
}

export function runNextNodeKeyStartsAtOne(): void {
  assert(nextNodeKey([], "valve") === "valve_1", "the first key of a prefix is _1");
}

// ---- clampBox -----------------------------------------------------------------------------

export function runClampBoxCapsSizeBeforePosition(): void {
  const b = clampBox({ x: 5, y: 5, w: 20, h: 25 }, 40, 20);
  assert(b.h === 20 && b.y === 0, `a 25-tall box on a 20-tall canvas is capped to 20 at y 0, got ${JSON.stringify(b)}`);
}

export function runClampBoxHoldsTheRightEdge(): void {
  const b = clampBox({ x: 120, y: 0, w: 20, h: 5 }, 126, 68);
  assert(b.x === 106, `x + w never passes canvasW, got x ${b.x}`);
}

export function runClampBoxKeepsAtLeastOneCell(): void {
  const b = clampBox({ x: -3, y: -1, w: 0, h: -4 }, 126, 68);
  assert(b.x === 0 && b.y === 0 && b.w === 1 && b.h === 1, `negative is 0 and size is at least 1, got ${JSON.stringify(b)}`);
}

// ---- preview / set-box --------------------------------------------------------------------

function dragTank1(s: EditorState): EditorState {
  return run(
    s,
    { type: "preview", key: "tank_1", box: { x: 3, y: 2, w: 20, h: 25 } },
    { type: "preview", key: "tank_1", box: { x: 4, y: 3, w: 20, h: 25 } },
    { type: "preview", key: "tank_1", box: { x: 9, y: 7, w: 20, h: 25 } },
    { type: "set-box", key: "tank_1", box: { x: 9, y: 7, w: 20, h: 25 } },
  );
}

export function runPreviewPushesNoHistory(): void {
  const s = twoTanksAndAPanel();
  const after = run(s, { type: "preview", key: "tank_1", box: { x: 30, y: 30, w: 20, h: 25 } });
  assert(after.past.length === s.past.length, `preview pushes nothing, past went ${s.past.length} → ${after.past.length}`);
}

export function runPreviewMovesTheNode(): void {
  const s = run(twoTanksAndAPanel(), { type: "preview", key: "tank_1", box: { x: 30, y: 31, w: 20, h: 25 } });
  assert(node(s, "tank_1").x === 30 && node(s, "tank_1").y === 31, "preview draws the node at the frame's box");
}

export function runADragPushesExactlyOnce(): void {
  const s = twoTanksAndAPanel();
  const after = dragTank1(s);
  assert(after.past.length === s.past.length + 1, `a whole drag pushes once, past went ${s.past.length} → ${after.past.length}`);
}

export function runUndoAfterADragRestoresThePreDragBox(): void {
  const s = twoTanksAndAPanel();
  const before = node(s, "tank_1");
  const undone = run(dragTank1(s), { type: "undo" });
  const n = node(undone, "tank_1");
  assert(n.x === before.x && n.y === before.y, `undo returns the box from before the drag, got ${n.x},${n.y}`);
}

export function runSetBoxWhereItBeganPushesNothing(): void {
  const s = twoTanksAndAPanel();
  const t = node(s, "tank_1");
  const after = run(s, { type: "set-box", key: "tank_1", box: { x: t.x, y: t.y, w: t.w, h: t.h } });
  assert(after.past.length === s.past.length, "a click with no movement leaves the history as it was");
}

export function runSetBoxClampsToTheCanvas(): void {
  const s = run(twoTanksAndAPanel(), { type: "set-box", key: "tank_1", box: { x: 500, y: 500, w: 20, h: 25 } });
  const n = node(s, "tank_1");
  assert(n.x + n.w === s.layout.canvasW && n.y + n.h === s.layout.canvasH, "set-box holds the node inside the canvas");
}

// ---- select -------------------------------------------------------------------------------

export function runSelectPushesNoHistory(): void {
  const s = twoTanksAndAPanel();
  const after = run(s, { type: "select", key: "tank_2" });
  assert(after.selected === "tank_2" && after.past.length === s.past.length, "select changes the selection only");
}

export function runSelectOfAnUnknownKeyClears(): void {
  const s = run(twoTanksAndAPanel(), { type: "select", key: "nope" });
  assert(s.selected === null, "selecting a key no node holds selects nothing");
}

// ---- update-node / update-layout ----------------------------------------------------------

export function runUpdateNodeSetsTheLabel(): void {
  const s = run(twoTanksAndAPanel(), { type: "update-node", key: "tank_1", patch: { label: "Raw water" } });
  assert(node(s, "tank_1").label === "Raw water", "update-node renames the node");
}

export function runUpdateNodeBindsARole(): void {
  const s = run(twoTanksAndAPanel(), { type: "update-node", key: "tank_1", patch: { roleCode: "wtp" } });
  assert(node(s, "tank_1").roleCode === "wtp", "update-node binds a unit to a role");
}

export function runUpdateNodeUnbindsARole(): void {
  const s = run(
    twoTanksAndAPanel(),
    { type: "update-node", key: "tank_1", patch: { roleCode: "wtp" } },
    { type: "update-node", key: "tank_1", patch: { roleCode: null } },
  );
  assert(node(s, "tank_1").roleCode === null, "roleCode null makes the unit passive again");
}

export function runUpdateNodeGivesAPanelNoRole(): void {
  const s = run(twoTanksAndAPanel(), { type: "update-node", key: "panel_1", patch: { roleCode: "wtp", tone: "accent" } });
  const n = node(s, "panel_1");
  assert(n.roleCode === null && n.tone === "accent", "a panel takes a tone and never a role");
}

export function runUpdateNodePushesHistory(): void {
  const s = twoTanksAndAPanel();
  const after = run(s, { type: "update-node", key: "tank_1", patch: { label: "X" } });
  assert(after.past.length === s.past.length + 1, "an inspector edit is one history entry");
}

export function runUpdateLayoutRenames(): void {
  const s = run(initialEditorState(), { type: "update-layout", patch: { name: "Plant 2", slug: "plant-2" } });
  assert(s.layout.name === "Plant 2" && s.layout.slug === "plant-2", "update-layout sets the name and slug");
}

export function runUpdateLayoutRefusesACanvasOutOfBounds(): void {
  const s = initialEditorState();
  const after = run(s, { type: "update-layout", patch: { canvasW: 241 } });
  assert(after === s, "a canvas wider than 240 cells is refused");
}

export function runUpdateLayoutRefusesAShrinkThatStrandsANode(): void {
  const s = run(twoTanksAndAPanel(), { type: "set-box", key: "tank_1", box: { x: 100, y: 2, w: 20, h: 25 } });
  const after = run(s, { type: "update-layout", patch: { canvasW: 60 } });
  assert(after === s, "a shrink that leaves a node outside the canvas is refused");
}

// ---- delete -------------------------------------------------------------------------------

export function runDeleteRemovesTheSelectedNode(): void {
  const s = run(twoTanksAndAPanel(), { type: "delete" });
  assert(!s.layout.nodes.some((n) => n.key === "tank_1") && s.selected === null, "delete removes the selection");
}

export function runDeleteRemovesItsPipes(): void {
  const s = run(twoTanksAndAPanel(), { type: "add-pipe", fromKey: "tank_1", toKey: "tank_2" }, { type: "delete", key: "tank_2" });
  assert(s.layout.pipes.length === 0, "deleting a pipe end deletes the pipe");
}

export function runDeleteKeepsOtherPipes(): void {
  const s = run(
    twoTanksAndAPanel(),
    { type: "add-unit", symbol: "tank" },
    { type: "add-pipe", fromKey: "tank_1", toKey: "tank_2" },
    { type: "add-pipe", fromKey: "tank_2", toKey: "tank_3" },
    { type: "delete", key: "tank_3" },
  );
  assert(s.layout.pipes.length === 1 && s.layout.pipes[0]?.toKey === "tank_2", "a pipe not touching the node stays");
}

// ---- add-pipe -----------------------------------------------------------------------------

export function runAddPipeJoinsTwoUnits(): void {
  const s = run(twoTanksAndAPanel(), { type: "add-pipe", fromKey: "tank_1", toKey: "tank_2" });
  assert(s.layout.pipes.length === 1, "a pipe between two units is added");
}

export function runAddPipeRefusesSelf(): void {
  const s = twoTanksAndAPanel();
  assert(run(s, { type: "add-pipe", fromKey: "tank_1", toKey: "tank_1" }) === s, "a pipe from a unit to itself is refused");
}

export function runAddPipeRefusesAPanelEnd(): void {
  const s = twoTanksAndAPanel();
  assert(run(s, { type: "add-pipe", fromKey: "tank_1", toKey: "panel_1" }) === s, "a pipe to a panel is refused");
}

export function runAddPipeRefusesALabelEnd(): void {
  const s = run(twoTanksAndAPanel(), { type: "add-label" });
  assert(run(s, { type: "add-pipe", fromKey: "label_1", toKey: "tank_1" }) === s, "a pipe from a label is refused");
}

export function runAddPipeRefusesADuplicate(): void {
  const s = run(twoTanksAndAPanel(), { type: "add-pipe", fromKey: "tank_1", toKey: "tank_2" });
  assert(run(s, { type: "add-pipe", fromKey: "tank_1", toKey: "tank_2" }) === s, "the same pipe twice is refused");
}

export function runAddPipeAllowsTheReverse(): void {
  const s = run(
    twoTanksAndAPanel(),
    { type: "add-pipe", fromKey: "tank_1", toKey: "tank_2" },
    { type: "add-pipe", fromKey: "tank_2", toKey: "tank_1" },
  );
  assert(s.layout.pipes.length === 2, "the reverse direction is a second pipe (the unique key is ordered)");
}

// ---- undo / redo --------------------------------------------------------------------------

export function runUndoRevertsTheLastEdit(): void {
  const s = run(twoTanksAndAPanel(), { type: "undo" });
  assert(!s.layout.nodes.some((n) => n.key === "panel_1"), "undo removes the panel added last");
}

export function runRedoReappliesIt(): void {
  const s = run(twoTanksAndAPanel(), { type: "undo" }, { type: "redo" });
  assert(s.layout.nodes.some((n) => n.key === "panel_1"), "redo puts the panel back");
}

export function runUndoOnAnEmptyHistoryIsANoOp(): void {
  const s = initialEditorState();
  assert(run(s, { type: "undo" }) === s, "undo with nothing to undo returns the state");
}

export function runAnEditClearsTheFuture(): void {
  const s = run(twoTanksAndAPanel(), { type: "undo" }, { type: "add-label" });
  assert(s.future.length === 0, "an edit after undo discards the redo stack");
}

export function runUndoThatRemovesTheSelectionClearsIt(): void {
  const s = run(initialEditorState(), { type: "add-unit", symbol: "tank" }, { type: "undo" });
  assert(s.selected === null, "undoing the add of the selected node clears the selection");
}

// ---- toWriteBody --------------------------------------------------------------------------

function presetBodyNode(k: string) {
  const found = toWriteBody(fromPreset("water_train")).nodes.find((n) => n.key === k);
  if (found === undefined) {
    throw new Error(`no body node ${k}`);
  }
  return found;
}

export function runWriteBodyOmitsAPanelsSymbol(): void {
  assert(!("symbol" in presetBodyNode("treatment")), "a panel's body node has no symbol property");
}

export function runWriteBodyOmitsAPassiveUnitsRole(): void {
  assert(!("roleCode" in presetBodyNode("discharge")), "a passive unit's body node has no roleCode property");
}

export function runWriteBodyOmitsAUnitsTone(): void {
  assert(!("tone" in presetBodyNode("wtp")), "a unit's body node has no tone property");
}

export function runWriteBodyKeepsARoledUnitsFields(): void {
  const n = presetBodyNode("wtp");
  assert(n.symbol === "clarifier" && n.roleCode === "wtp" && n.z === 10, "a roled unit keeps symbol, role and z");
}

export function runWriteBodyCarriesPipesByKey(): void {
  const body = toWriteBody(fromPreset("water_train"));
  assert(JSON.stringify(body.pipes[0]) === JSON.stringify({ fromKey: "water_intake", toKey: "wtp" }), "pipes are {fromKey,toKey}");
}

// ---- fromPreset ---------------------------------------------------------------------------

const preset = (): EditorLayout => fromPreset("water_train");

function presetNode(k: string): EditorNode {
  const found = preset().nodes.find((n) => n.key === k);
  if (found === undefined) {
    throw new Error(`no preset node ${k}`);
  }
  return found;
}

export function runPresetHasEightRoledUnits(): void {
  const roled = preset().nodes.filter((n) => n.kind === "unit" && n.roleCode !== null);
  assert(roled.length === 8, `8 roled units, got ${roled.length}`);
}

export function runPresetHasAPassiveDischarge(): void {
  const d = presetNode("discharge");
  assert(d.kind === "unit" && d.symbol === "discharge" && d.roleCode === null, "discharge is a passive discharge unit");
}

export function runPresetHasThreePanels(): void {
  const panels = preset().nodes.filter((n) => n.kind === "panel").map((n) => `${n.key}:${n.tone}`);
  assert(
    JSON.stringify(panels) === JSON.stringify(["treatment:info", "utilities:neutral", "wastewater:accent"]),
    `three panels with their tones, got ${JSON.stringify(panels)}`,
  );
}

export function runPresetHasEightPipes(): void {
  assert(preset().pipes.length === 8, `7 preset pipes + ETP → Discharge, got ${preset().pipes.length}`);
}

export function runPresetEndsInEtpToDischarge(): void {
  const last = preset().pipes.at(-1);
  assert(last?.fromKey === "etp" && last.toKey === "discharge", "the eighth pipe runs ETP → Discharge");
}

export function runPresetRowOneRoundsToTheGrid(): void {
  const xs = ["water_intake", "wtp", "ro", "softener", "water_storage"].map((k) => `${presetNode(k).x},${presetNode(k).y}`);
  assert(JSON.stringify(xs) === JSON.stringify(["4,4", "29,4", "53,4", "78,4", "102,4"]), `row 1 cells, got ${JSON.stringify(xs)}`);
}

export function runPresetRowTwoRoundsToTheGrid(): void {
  const xs = ["cooling_tower", "stp", "etp", "discharge"].map((k) => `${presetNode(k).x},${presetNode(k).y}`);
  assert(JSON.stringify(xs) === JSON.stringify(["102,41", "77,41", "51,41", "27,41"]), `row 2 cells, got ${JSON.stringify(xs)}`);
}

export function runPresetUnitsAreTwentyByTwentyFive(): void {
  assert(
    preset().nodes.filter((n) => n.kind === "unit").every((n) => n.w === 20 && n.h === 25),
    "every unit is the 200 × 250 slot at 10 px per cell",
  );
}

export function runPresetCoolingTowerIsTheUtilitiesRole(): void {
  assert(presetNode("cooling_tower").roleCode === "utilities", "the cooling tower resolves against `utilities`");
}

export function runPresetCanvasIsTheViewBoxInCells(): void {
  const p = preset();
  assert(p.canvasW === 126 && p.canvasH === 68, `canvas 126 × 68, got ${p.canvasW} × ${p.canvasH}`);
}

export function runPresetNodesAreInsideTheCanvas(): void {
  const p = preset();
  assert(
    p.nodes.every((n) => n.x >= 0 && n.y >= 0 && n.x + n.w <= p.canvasW && n.y + n.h <= p.canvasH),
    "every node, panels included, lies inside the canvas",
  );
}

export function runPresetWastewaterPanelHoldsDischarge(): void {
  const panel = presetNode("wastewater");
  const d = presetNode("discharge");
  assert(panel.x <= d.x && panel.x + panel.w >= d.x + d.w, "the wastewater panel spans the discharge unit");
}

export function runPresetPanelsDrawUnderUnits(): void {
  const p = preset();
  const panelZ = Math.max(...p.nodes.filter((n) => n.kind === "panel").map((n) => n.z));
  const unitZ = Math.min(...p.nodes.filter((n) => n.kind === "unit").map((n) => n.z));
  assert(panelZ < unitZ, "every panel's z is below every unit's z");
}

export function runPresetUnitsDoNotOverlap(): void {
  const units = preset().nodes.filter((n) => n.kind === "unit");
  const overlaps = units.some((a, i) =>
    units.slice(i + 1).some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h),
  );
  assert(!overlaps, "no two units of the copy overlap");
}

// ---- fromPreset, the six domain presets (F3.32d, ADR 0082 decision 5) ---------------------

/** Every preset but `water_train`: none has a sink, so each copy is its nodes, panels and pipes. */
const DOMAIN_PRESETS = mimicPresetSchema.options.filter((p) => p !== "water_train");

export function runDomainPresetsAreSix(): void {
  assert(DOMAIN_PRESETS.length === 6, `six domain presets, got ${DOMAIN_PRESETS.length}`);
}

/**
 * A starter's panel keys become stored node keys beside its unit keys, and the API refuses a
 * duplicate or a malformed key with a 400 — so every copied key is unique and a layout node key.
 */
export function runDomainPresetKeysAreUniqueLayoutKeys(): void {
  for (const p of DOMAIN_PRESETS) {
    const keys = fromPreset(p).nodes.map((n) => n.key);
    assert(new Set(keys).size === keys.length, `${p}: node keys repeat: ${JSON.stringify(keys)}`);
    for (const key of keys) {
      assert(MIMIC_LAYOUT_NODE_KEY.test(key), `${p}: key ${key} is not a layout node key`);
    }
  }
}

export function runDomainPresetNodesAreInsideTheCanvas(): void {
  for (const p of DOMAIN_PRESETS) {
    const l = fromPreset(p);
    assert(
      l.nodes.every((n) => n.x >= 0 && n.y >= 0 && n.x + n.w <= l.canvasW && n.y + n.h <= l.canvasH),
      `${p}: every node, panels included, lies inside the canvas`,
    );
  }
}

export function runDomainPresetUnitsDoNotOverlap(): void {
  for (const p of DOMAIN_PRESETS) {
    const units = fromPreset(p).nodes.filter((n) => n.kind === "unit");
    const overlaps = units.some((a, i) =>
      units.slice(i + 1).some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h),
    );
    assert(!overlaps, `${p}: no two units of the copy overlap`);
  }
}

export function runDomainPresetRoledUnitsAreThePresetNodes(): void {
  for (const p of DOMAIN_PRESETS) {
    const roled = fromPreset(p).nodes.filter((n) => n.kind === "unit" && n.roleCode !== null);
    const want = MIMIC_PRESETS[p].nodes.length;
    assert(roled.length === want, `${p}: ${want} roled units, got ${roled.length}`);
  }
}

export function runDomainPresetHasNoDischarge(): void {
  for (const p of DOMAIN_PRESETS) {
    assert(!fromPreset(p).nodes.some((n) => n.key === "discharge"), `${p}: no sink, so no discharge unit`);
  }
}

export function runDomainPresetPipesAreThePresetPipes(): void {
  for (const p of DOMAIN_PRESETS) {
    const got = fromPreset(p).pipes.length;
    const want = MIMIC_PRESETS[p].pipes.length;
    assert(got === want, `${p}: ${want} pipes and no sink pipe, got ${got}`);
  }
}

export function runEnvironmentMonitoringCopyHasNoPipes(): void {
  const got = fromPreset("environment_monitoring").pipes.length;
  assert(got === 0, `environment_monitoring copies no pipe, got ${got}`);
}

export function runDomainPresetPanelsAreThePresetPanels(): void {
  for (const p of DOMAIN_PRESETS) {
    const got = fromPreset(p).nodes.filter((n) => n.kind === "panel").length;
    const want = MIMIC_PANELS[p].length;
    assert(got === want, `${p}: ${want} panels, got ${got}`);
  }
}

export function runDomainPresetPanelsDrawUnderUnits(): void {
  for (const p of DOMAIN_PRESETS) {
    const l = fromPreset(p);
    const panelZ = Math.max(...l.nodes.filter((n) => n.kind === "panel").map((n) => n.z));
    const unitZ = Math.min(...l.nodes.filter((n) => n.kind === "unit").map((n) => n.z));
    assert(panelZ < unitZ, `${p}: every panel's z is below every unit's z`);
  }
}

export function runDomainPresetSlugIsThePresetKey(): void {
  for (const p of DOMAIN_PRESETS) {
    const slug = fromPreset(p).slug;
    assert(slug === p.replace(/_/g, "-"), `${p}: slug is the hyphenated key, got ${slug}`);
  }
}

export function runDomainPresetCanvasMeetsTheBounds(): void {
  for (const p of DOMAIN_PRESETS) {
    const l = fromPreset(p);
    assert(
      l.canvasW >= MIMIC_LAYOUT_BOUNDS.canvasW.min &&
        l.canvasW <= MIMIC_LAYOUT_BOUNDS.canvasW.max &&
        l.canvasH >= MIMIC_LAYOUT_BOUNDS.canvasH.min &&
        l.canvasH <= MIMIC_LAYOUT_BOUNDS.canvasH.max,
      `${p}: canvas ${l.canvasW} × ${l.canvasH} lies inside the bounds`,
    );
  }
}

export function runDomainPresetNameIsThePresetLabel(): void {
  for (const p of DOMAIN_PRESETS) {
    const name = fromPreset(p).name;
    assert(name === MIMIC_PRESETS[p].label, `${p}: name is the preset label, got ${name}`);
  }
}

export function runCompressedAirCanvasIsFourSlotsByOne(): void {
  const l = fromPreset("compressed_air");
  assert(l.canvasW === 102 && l.canvasH === 31, `canvas 102 × 31, got ${l.canvasW} × ${l.canvasH}`);
}

// ---- keyboardAction -----------------------------------------------------------------------

export function runArrowMovesOneCell(): void {
  const s = twoTanksAndAPanel();
  const t = node(s, "tank_1");
  const a = keyboardAction(key("ArrowRight"), s);
  assert(
    a?.type === "set-box" && a.box.x === t.x + 1 && a.box.y === t.y && a.box.w === t.w,
    `ArrowRight moves one cell right, got ${JSON.stringify(a)}`,
  );
}

export function runShiftArrowResizesOneCell(): void {
  const s = twoTanksAndAPanel();
  const t = node(s, "tank_1");
  const a = keyboardAction(key("ArrowDown", { shiftKey: true }), s);
  assert(
    a?.type === "set-box" && a.box.h === t.h + 1 && a.box.y === t.y && a.box.x === t.x,
    `Shift+ArrowDown grows the height by one, got ${JSON.stringify(a)}`,
  );
}

export function runDeleteKeyDeletesTheSelection(): void {
  const a = keyboardAction(key("Delete"), twoTanksAndAPanel());
  assert(a?.type === "delete" && a.key === "tank_1", `Delete removes the selection, got ${JSON.stringify(a)}`);
}

export function runCtrlZUndoes(): void {
  assert(keyboardAction(key("z", { ctrlKey: true }), twoTanksAndAPanel())?.type === "undo", "Ctrl+Z undoes");
}

export function runCtrlYRedoes(): void {
  assert(keyboardAction(key("y", { ctrlKey: true }), twoTanksAndAPanel())?.type === "redo", "Ctrl+Y redoes");
}

export function runCtrlShiftZRedoes(): void {
  const a = keyboardAction(key("Z", { ctrlKey: true, shiftKey: true }), twoTanksAndAPanel());
  assert(a?.type === "redo", "Ctrl+Shift+Z (key 'Z') redoes");
}

export function runArrowWithNoSelectionIsNull(): void {
  const s = run(twoTanksAndAPanel(), { type: "select", key: null });
  assert(keyboardAction(key("ArrowLeft"), s) === null, "an arrow with nothing selected does nothing");
}

export function runKeysInAnInputAreNull(): void {
  assert(keyboardAction(key("Delete", { target: { tagName: "INPUT" } }), twoTanksAndAPanel()) === null, "Delete in an input is the input's");
}

export function runKeysInASelectAreNull(): void {
  assert(keyboardAction(key("ArrowDown", { target: { tagName: "SELECT" } }), twoTanksAndAPanel()) === null, "an arrow in a select is the select's");
}

export function runCtrlZInATextareaIsNull(): void {
  assert(
    keyboardAction(key("z", { ctrlKey: true, target: { tagName: "TEXTAREA" } }), twoTanksAndAPanel()) === null,
    "Ctrl+Z in a textarea is the textarea's",
  );
}

export function runOtherKeysAreNull(): void {
  assert(keyboardAction(key("a"), twoTanksAndAPanel()) === null, "an unmapped key does nothing");
}
