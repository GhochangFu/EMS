import { z } from "zod";

/**
 * `F3.32c` / ADR 0081 — the mimic layout library (`/api/v1/mimic-layouts`) response contracts
 * and the bounds every write surface and the database restate (plan D3, D4, D5).
 *
 * Plain `z.object` throughout — no `.merge()`, `.extend()`, `.pick()`, `.omit()` or
 * `.readonly()` (ADR 0030 decision 2). Nodes and pipes are referenced by `key`, never by id: a
 * node's id regenerates on every save (plan D5).
 */

/**
 * The layout grid (plan D4, owner ruling OQ5). `cell` is pixels per grid unit; a canvas is
 * `canvasW × canvasH` cells. `bms.mimic_layouts`' and `bms.mimic_layout_nodes`' CHECKs restate
 * these literals, and a static gate compares them.
 */
export const MIMIC_LAYOUT_BOUNDS = {
  cell: 10,
  canvasW: { min: 20, max: 240 },
  canvasH: { min: 20, max: 160 },
  z: { min: 0, max: 100 },
  maxNodes: 120,
  maxPipes: 160,
} as const;

/**
 * The 409 a `PUT` answers when it names a version the layout no longer has (ADR 0081 decision
 * 2). Shared, not restated: the API throws it and the editor tells a stale 409 from a slug 409
 * by it, so one copy is the only way the two cannot drift.
 */
export const MIMIC_LAYOUT_STALE_MESSAGE = "the layout changed since it was loaded; reload and apply the edit again";

/** A node's key within its layout: what pipes and the resolver name it by. */
export const MIMIC_LAYOUT_NODE_KEY = /^[a-z][a-z0-9_]{0,31}$/;

/** A layout's slug, unique per organization. */
export const MIMIC_LAYOUT_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** `unit` carries a symbol and may carry a role; `panel` is a tinted area; `label` is text. */
export const mimicLayoutNodeKindSchema = z.enum(["unit", "panel", "label"]);

/**
 * The closed symbol set a unit draws with (plan D12). Closed because a symbol is an SVG glyph in
 * code — the same §4.8 test `widgetTypeSchema` applies. `bms.mimic_layout_nodes_symbol_check`
 * restates this list in this order (migration `0089`, ADR 0082: twelve water and general symbols,
 * then seventeen for the other asset domains).
 */
export const mimicSymbolSchema = z.enum([
  "tank",
  "clarifier",
  "membrane",
  "vessel",
  "tower",
  "aeration",
  "dosing",
  "pump",
  "discharge",
  "valve",
  "filter",
  "unit",
  // ADR 0082 decision 1 — appended, never reordered: 0088's CHECK holds the first twelve, 0089's
  // all twenty-nine, in this order.
  "transformer",
  "breaker",
  "switchboard",
  "generator",
  "meter",
  "motor",
  "ups",
  "battery",
  "rack",
  "chiller",
  "ahu",
  "fan",
  "compressor",
  "boiler",
  "sensor",
  "lamp",
  "lift",
]);

/** A panel's tint — a colour role, never a colour value (F3.65 R14/R20). */
export const mimicPanelToneSchema = z.enum(["info", "neutral", "accent"]);

/**
 * One node as stored and served. `symbol` is `null` on a panel or label; `roleCode` is `null` on
 * a panel, a label, or a passive unit (plan D6); `tone` is non-null on a panel only. The
 * per-kind rules are the write body's and the database's, not this read contract's.
 */
export const mimicLayoutNodeSchema = z.object({
  key: z.string(),
  kind: mimicLayoutNodeKindSchema,
  symbol: mimicSymbolSchema.nullable(),
  label: z.string(),
  roleCode: z.string().nullable(),
  tone: mimicPanelToneSchema.nullable(),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int(),
  h: z.number().int(),
  z: z.number().int(),
});

/** A pipe between two units, by key (plan D5, D7). */
export const mimicLayoutPipeSchema = z.object({
  fromKey: z.string(),
  toKey: z.string(),
});

/** What the renderer needs to draw a layout — the resolver's `layout` field. */
export const mimicLayoutGeometrySchema = z.object({
  name: z.string(),
  canvasW: z.number().int(),
  canvasH: z.number().int(),
  nodes: z.array(mimicLayoutNodeSchema),
  pipes: z.array(mimicLayoutPipeSchema),
});

/** One row of `GET /api/v1/mimic-layouts`. `unitCount` counts `kind = 'unit'` nodes. */
export const mimicLayoutSummarySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  canvasW: z.number().int(),
  canvasH: z.number().int(),
  version: z.number().int(),
  unitCount: z.number().int(),
  updatedAt: z.string(),
});

/** `GET /api/v1/mimic-layouts/:id`, and the answer to `POST` and `PUT`. */
export const mimicLayoutDtoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  canvasW: z.number().int(),
  canvasH: z.number().int(),
  version: z.number().int(),
  nodes: z.array(mimicLayoutNodeSchema),
  pipes: z.array(mimicLayoutPipeSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * `GET /api/v1/mimic-layouts` — the `{ items }` envelope. Spelled out rather than through
 * `./envelopes`' `itemsOf`, which that file does not export; the shape is the same.
 */
export const mimicLayoutsListResponseSchema = z.object({
  items: z.array(mimicLayoutSummarySchema),
});

/** `DELETE /api/v1/mimic-layouts/:id`. */
export const mimicLayoutDeletedResponseSchema = z.object({
  id: z.string().uuid(),
  deleted: z.literal(true),
});
