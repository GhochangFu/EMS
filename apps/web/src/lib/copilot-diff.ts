import type { MimicLayoutNodeDto, MimicLayoutPipeDto } from "@bms/shared";
import { writeNodeOfDto } from "@bms/shared/copilot";

import type { MimicLayoutWriteBody, MimicLayoutWriteNode } from "../api/mimic-layouts";

/**
 * `F3.85` PR 8 (plan §10.3, decision 4.9) — the rows a Confirm card shows: one
 * per field the change sends, with the value it sends and, for an edit, the
 * record's value now.
 *
 * Pure: the card fetches the current record and passes it in. `before` is
 * absent for a create (there is no record) and when the current record could
 * not be read; `changed` is then `true`.
 */
export type ChangeRow = {
  readonly field: string;
  /** `F3.87` PR 5: the row's own heading, when the field is not a body key (a layout node by key). */
  readonly label?: string;
  readonly after: string;
  readonly before?: string;
  readonly changed: boolean;
};

/** The longest value a card shows in full; a longer one is cut with an ellipsis. */
export const CHANGE_VALUE_MAX = 160;

/** One value as a card shows it: text as-is, `null` as a dash, anything else as short JSON. */
export function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return text.length > CHANGE_VALUE_MAX ? `${text.slice(0, CHANGE_VALUE_MAX - 1)}…` : text;
}

/** Field labels: `assetGroupId` → "Asset group id". */
export function fieldLabel(field: string): string {
  const words = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * The card's rows for `body`, in the body's key order. With `current`, each
 * row also carries the record's value and whether the change alters it.
 *
 * `F3.87` PR 5 (D14, D15): the keys in `skip` are not rows — an entry's
 * `cardOnly` keys (a layout's `baseline`), which the request never carries,
 * and any key the card shows another way (a layout's nodes and pipes).
 */
export function changeRows(
  body: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>> | null,
  skip: readonly string[] = [],
): ChangeRow[] {
  return Object.entries(body).filter(([field]) => !skip.includes(field)).map(([field, value]) => {
    const row = { field, after: formatChangeValue(value) };
    if (current === null) return { ...row, changed: true };
    return { ...row, before: formatChangeValue(current[field]), changed: !same(current[field], value) };
  });
}

/** `F3.87` PR 5 / owner ruling Q5 — the layout a replace card was built from (`validateProposal`'s, DTO shape). */
export type LayoutBaseline = {
  readonly version: number;
  readonly nodes: readonly MimicLayoutNodeDto[];
  readonly pipes: readonly MimicLayoutPipeDto[];
};

/** A write node's fields, in the order a changed row lists them. */
const NODE_FIELDS = ["kind", "symbol", "label", "roleCode", "tone", "x", "y", "w", "h", "z", "fanOut", "isSource", "isSwitching"] as const;
type NodeField = (typeof NODE_FIELDS)[number];

/** A write node as the store writes it: an absent `z` is `0`, an absent flag `false`, an absent symbol, role or tone `null`. */
function storedValue(node: MimicLayoutWriteNode, field: NodeField): unknown {
  const value = node[field];
  if (value !== undefined && value !== null) return value;
  if (field === "z") return 0;
  if (field === "fanOut" || field === "isSource" || field === "isSwitching") return false;
  return null;
}

const describeNode = (node: MimicLayoutWriteNode): string => `${node.kind} "${node.label}"`;
const fieldsText = (node: MimicLayoutWriteNode, fields: readonly NodeField[]): string =>
  fields.map((field) => `${field} ${formatChangeValue(storedValue(node, field))}`).join(", ");

/**
 * `F3.87` PR 5 (ADR 0099 Amendment 3 A2, owner ruling Q5) — a replace card's graph rows: the
 * body's nodes against the baseline's **by key** (added, changed in any write field, removed),
 * then its pipes by `fromKey→toKey` (added, removed). An unchanged node or pipe has no row. The
 * baseline is the layout the card was built from, stored at propose time — never the layout now.
 */
export function layoutGraphRows(body: Pick<MimicLayoutWriteBody, "nodes" | "pipes">, baseline: LayoutBaseline): ChangeRow[] {
  const rows: ChangeRow[] = [];
  const before = new Map(baseline.nodes.map((node) => [node.key, writeNodeOfDto(node)]));
  const after = new Set(body.nodes.map((node) => node.key));
  for (const node of body.nodes) {
    const label = `Node ${node.key}`;
    const was = before.get(node.key);
    if (was === undefined) {
      rows.push({ field: `node:${node.key}`, label, before: "—", after: `added: ${describeNode(node)}`, changed: true });
      continue;
    }
    const differs = NODE_FIELDS.filter((field) => JSON.stringify(storedValue(was, field)) !== JSON.stringify(storedValue(node, field)));
    if (differs.length > 0) {
      rows.push({ field: `node:${node.key}`, label, before: fieldsText(was, differs), after: fieldsText(node, differs), changed: true });
    }
  }
  for (const [key, was] of before) {
    if (!after.has(key)) rows.push({ field: `node:${key}`, label: `Node ${key}`, before: describeNode(was), after: "removed", changed: true });
  }
  const pipeId = (pipe: { readonly fromKey: string; readonly toKey: string }) => `${pipe.fromKey}→${pipe.toKey}`;
  const pipesBefore = new Set(baseline.pipes.map(pipeId));
  const pipesAfter = new Set(body.pipes.map(pipeId));
  for (const id of pipesAfter) {
    if (!pipesBefore.has(id)) rows.push({ field: `pipe:${id}`, label: `Pipe ${id}`, before: "—", after: "added", changed: true });
  }
  for (const id of pipesBefore) {
    if (!pipesAfter.has(id)) rows.push({ field: `pipe:${id}`, label: `Pipe ${id}`, before: "present", after: "removed", changed: true });
  }
  return rows;
}
