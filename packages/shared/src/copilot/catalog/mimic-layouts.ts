import { createMimicLayoutBodySchema, putMimicLayoutBodySchema } from "../../contracts/mimic-layout-writes";
import {
  MIMIC_LAYOUT_BOUNDS,
  MIMIC_LAYOUT_NODE_KEY,
  mimicCoreSymbolSchema,
  mimicLayoutNodeKindSchema,
  mimicPanelToneSchema,
} from "../../contracts/mimic-layouts";
import { plural, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, ExcludedRoute } from "./types";

/** "a, b or c" — a vocabulary as one phrase. */
function orList(values: readonly string[]): string {
  return values.length < 2 ? values.join("") : `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

const { canvasW, canvasH } = MIMIC_LAYOUT_BOUNDS;

/**
 * `F4.266` (ADR 0090 Amendment 3 C6) — the node and pipe shape of a layout
 * body, as the two layout tools state it after their field list. A live turn
 * (2026-10-17) spent its tool calls reading this shape with `describe_change`
 * and never proposed. Every vocabulary and bound comes from the write schemas'
 * own sources, so a new kind, tone, symbol or bound reaches it
 * without an edit here; the per-kind rule restates `mimicLayoutWriteNodeSchema`.
 */
export const MIMIC_LAYOUT_BODY_GUIDE =
  `A node is {"key", "kind", "label", "x", "y", "w", "h"}; key matches ${MIMIC_LAYOUT_NODE_KEY.source} and is unique in the body; ` +
  `kind is ${orList(mimicLayoutNodeKindSchema.options)}. A unit also takes symbol (required) and optionally roleCode, ` +
  `fanOut, isSource and isSwitching (booleans); a panel takes tone (${orList(mimicPanelToneSchema.options)}) and no symbol; ` +
  `a label takes neither. A pipe is {"fromKey", "toKey"}: two different unit keys of this body. x, y, w, h are whole grid ` +
  `cells and each node lies inside canvasW x canvasH (canvasW ${canvasW.min}-${canvasW.max}, canvasH ${canvasH.min}-${canvasH.max}). ` +
  `symbolLibraries defaults to ["core"]; core symbols: ${mimicCoreSymbolSchema.options.join(", ")}. Propose without describe_change.`;

/** "N units, M panels, P pipes" — what a layout body draws, counted from the body alone. */
function graphCounts(body: Readonly<Record<string, unknown>>): string {
  const nodes = Array.isArray(body.nodes) ? (body.nodes as unknown[]) : [];
  const pipes = Array.isArray(body.pipes) ? (body.pipes as unknown[]) : [];
  const kindOf = (node: unknown): unknown =>
    node !== null && typeof node === "object" ? (node as { kind?: unknown }).kind : undefined;
  const units = nodes.filter((node) => kindOf(node) === "unit").length;
  const panels = nodes.filter((node) => kindOf(node) === "panel").length;
  return `${plural(units, "unit")}, ${plural(panels, "panel")}, ${plural(pipes.length, "pipe")}`;
}

/** The layouts' authoring roles (ADR 0081 decision 3); the route's own check still runs on Confirm. */
const AUTHORS = ["admin", "organization_admin"] as const;

/**
 * `F3.87` PR 5 (ADR 0099 Amendment 3 A1, A2) — the mimic layout writes: one
 * whole body on one card that draws the layout. Both are canvas entries
 * (owner ruling Q1): no steps, and `tests/f3.85-stepper-coverage` takes each
 * from the layout editor page. A replace stores the layout it was built from
 * under the `cardOnly` key `baseline` (ruling Q5), which the card's node diff
 * reads and the browser strips before it sends the write. The layout
 * `DELETE` stays excluded for good (`EXCLUDED_ROUTES`, decision 3).
 */
export const MIMIC_LAYOUT_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "mimicLayout.create",
    title: "Create a mimic layout",
    method: "POST",
    path: "/mimic-layouts",
    params: {},
    body: createMimicLayoutBodySchema,
    bodyName: "createMimicLayoutBodySchema",
    bodyGuide: MIMIC_LAYOUT_BODY_GUIDE,
    clientOnly: [],
    offeredTo: AUTHORS,
    risk: "create",
    target: { kind: "organization", manage: "mimic" },
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ body, organizationName }) =>
      `Create the layout ${quoted(text(body, "name"))} in ${organizationName}: ${graphCounts(body)}.`,
  },
  {
    id: "mimicLayout.replace",
    title: "Replace a mimic layout",
    method: "PUT",
    path: "/mimic-layouts/:id",
    params: { id: uuidParam },
    body: putMimicLayoutBodySchema,
    bodyName: "putMimicLayoutBodySchema",
    bodyGuide: MIMIC_LAYOUT_BODY_GUIDE,
    clientOnly: [],
    offeredTo: AUTHORS,
    cardOnly: ["baseline"],
    risk: "edit",
    target: { kind: "mimicLayout", param: "id" },
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ body, targetName }) =>
      `Replace the layout ${quoted(targetName)} (version ${typeof body.version === "number" ? body.version : "?"}): ${graphCounts(body)}.`,
  },
];

/** `F3.87` PR 5: every layout route is now an entry or excluded for good; nothing waits on a later PR. */
export const MIMIC_LAYOUT_PENDING: readonly ExcludedRoute[] = [];
