import type { MimicLayoutNodeDto, MimicLayoutPipeDto } from "@bms/shared";
import { type CatalogFormula, type FormulaSite, formulaSitesOf, writeNodeOfDto } from "@bms/shared/copilot";

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
  /**
   * `F4.246` (ADR 0099 §3, owner ruling 2026-10-20 option C): the whole value when `after` is
   * cut — the string itself, or pretty-printed JSON — for the card to open on demand. Absent
   * when `after` is the whole value already.
   */
  readonly afterFull?: string;
  /** `F4.246`: the same for `before` — the record's own value now, never the proposed one. */
  readonly beforeFull?: string;
  readonly changed: boolean;
};

/** The longest value a card shows in full; a longer one is cut with an ellipsis. */
export const CHANGE_VALUE_MAX = 160;

const compactText = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));

/** One value as a card shows it: text as-is, `null` as a dash, anything else as short JSON. */
export function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = compactText(value);
  return text.length > CHANGE_VALUE_MAX ? `${text.slice(0, CHANGE_VALUE_MAX - 1)}…` : text;
}

/**
 * `F4.246` — the whole of a value `formatChangeValue` cuts: the string itself, or JSON indented
 * two spaces. `undefined` when the summary is the whole value (no cut, nothing to open).
 */
export function fullChangeValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = compactText(value);
  if (text.length <= CHANGE_VALUE_MAX) return undefined;
  return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? text);
}

/** Field labels: `assetGroupId` → "Asset group id". */
export function fieldLabel(field: string): string {
  const words = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `F4.246` — a value as `same` compares it: object keys sorted, and a key whose value is `null` or
 * absent dropped, at every depth. The Now record lists every column (nulls in schema order, jsonb's
 * own key order); a model's body leaves the nulls out and orders keys its own way. Array order
 * counts. A default the body leaves out (a point's `required: true`) is not filled in here.
 */
function normalised(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalised);
  if (!isRecord(value)) return value ?? null;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== null && value[key] !== undefined)
      .sort()
      .map((key) => [key, normalised(value[key])]),
  );
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalised(a)) === JSON.stringify(normalised(b));
}

/** A row's full text under `key` — present only when the value is cut. */
function fullTexts(value: unknown, key: "afterFull" | "beforeFull"): Partial<Record<"afterFull" | "beforeFull", string>> {
  const full = fullChangeValue(value);
  return full === undefined ? {} : { [key]: full };
}

/**
 * The card's rows for `body`, in the body's key order. With `current`, each
 * row also carries the record's value and whether the change alters it.
 *
 * `F3.87` PR 5 (D14, D15): the keys in `skip` are not rows — an entry's
 * `cardOnly` keys (a layout's `baseline`), which the request never carries,
 * and any key the card shows another way (a layout's nodes and pipes).
 *
 * `F4.246` (ADR 0099 §3, "each formula in full"): a cut value carries its full text, and after
 * the field rows comes one row per site of each of the entry's `formulas` (`formulaRows`).
 */
export function changeRows(
  body: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>> | null,
  skip: readonly string[] = [],
  formulas: readonly CatalogFormula[] = [],
): ChangeRow[] {
  const fields = Object.entries(body).filter(([field]) => !skip.includes(field)).map(([field, value]) => {
    const row = { field, after: formatChangeValue(value), ...fullTexts(value, "afterFull") };
    if (current === null) return { ...row, changed: true };
    return {
      ...row,
      before: formatChangeValue(current[field]),
      ...fullTexts(current[field], "beforeFull"),
      changed: !same(current[field], value),
    };
  });
  return [...fields, ...formulaRows(body, current, formulas)];
}

/** The keys that name an array item across a reorder: a template point's `pointKey`, a KPI's `code`. */
const ITEM_IDENTITY_KEYS = ["pointKey", "code"] as const;

/**
 * Which item a formula site belongs to, stable across an insert or a reorder: `points.1.formula`
 * becomes `points[pointKey=eff].formula`. A site outside an array, or an item without an identity
 * key, keeps its issue path (index pairing — the only pairing it has).
 */
function siteIdentity(root: unknown, path: string): string {
  const segments = path.split(".");
  const leaf = segments.pop();
  const index = segments.at(-1);
  if (index === undefined || !/^\d+$/.test(index)) return path;
  let item: unknown = root;
  for (const segment of segments) {
    item = Array.isArray(item) ? item[Number(segment)] : isRecord(item) ? item[segment] : undefined;
  }
  if (!isRecord(item)) return path;
  for (const key of ITEM_IDENTITY_KEYS) {
    const id = item[key];
    if (typeof id === "string") return `${segments.slice(0, -1).join(".")}[${key}=${id}].${leaf}`;
  }
  return path;
}

/** A formula as its row shows it: the whole expression, never cut, then its dialect. */
const formulaText = (site: FormulaSite): string =>
  `${site.expression as string} (${typeof site.dialect === "string" ? site.dialect : "inherited dialect"})`;

/**
 * `F4.246` (ADR 0099 §3) — one row per formula site of the body, under the site's issue path
 * (`points.1.formula`, the path `formulaSitesOf` and the api's issues use), with the whole
 * expression: a 300-character formula inside a cut `points` summary is not reviewable. A site with
 * no expression (a measured point's `formula: null`) is no row. The Now value is the same item's
 * site in `current`, by `pointKey`/`code` (`siteIdentity`), formatted the same way — so an
 * unchanged formula is `changed: false` even when points were inserted ahead of it.
 */
function formulaRows(
  body: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>> | null,
  formulas: readonly CatalogFormula[],
): ChangeRow[] {
  const rows: ChangeRow[] = [];
  for (const formula of formulas) {
    const now =
      current === null
        ? null
        : new Map(formulaSitesOf(current, formula).map((site) => [siteIdentity(current, site.path), site]));
    for (const site of formulaSitesOf(body, formula)) {
      if (typeof site.expression !== "string") continue;
      const row = { field: site.path, label: `Formula ${site.path.replace(/\.[^.]+$/, "")}`, after: formulaText(site) };
      if (now === null) {
        rows.push({ ...row, changed: true });
        continue;
      }
      const was = now.get(siteIdentity(body, site.path));
      const before = was !== undefined && typeof was.expression === "string" ? formulaText(was) : "—";
      rows.push({ ...row, before, changed: before !== row.after });
    }
  }
  return rows;
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
