import { createMimicLayoutBodySchema, putMimicLayoutBodySchema } from "../../contracts/mimic-layout-writes";
import { plural, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, ExcludedRoute } from "./types";

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
