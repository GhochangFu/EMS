import { z } from "zod";

import { DRAWIO_SYMBOL_KEYS } from "../mimic-symbol-libraries/drawio.generated";
import { LUCIDE_SYMBOL_KEYS } from "../mimic-symbol-libraries/lucide.generated";
import { MDI_SYMBOL_KEYS } from "../mimic-symbol-libraries/mdi.generated";
import { QET_SYMBOL_KEYS } from "../mimic-symbol-libraries/qet.generated";
import { TABLER_SYMBOL_KEYS } from "../mimic-symbol-libraries/tabler.generated";
import { WMPID_SYMBOL_KEYS } from "../mimic-symbol-libraries/wmpid.generated";
import { mimicShapeSchema } from "./mimic-shapes";
import {
  MAX_MIMIC_SYMBOL_SHAPES,
  mimicOrgLibraryKeySchema,
  mimicOrgSymbolKeySchema,
  mimicSymbolStyleSchema,
  mimicViewBoxSchema,
} from "./mimic-symbol-libraries";

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
 * The core library's symbols (plan D12), each an SVG glyph drawn in code. Migration `0089`'s
 * `mimic_layout_nodes_symbol_check` restated this list in this order (ADR 0082: twelve water and
 * general symbols, then seventeen for the other asset domains); since `F3.32e` (ADR 0084)
 * migration `0090` holds them as the `core` rows of `bms.mimic_symbols`, in this order.
 */
export const mimicCoreSymbolSchema = z.enum([
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

/**
 * `F3.32e` / ADR 0084 decision 4 — the four preloaded symbol libraries, then (`F3.32f` / ADR 0086
 * decision 9) QElectroTech, Wikimedia Commons P&ID and draw.io, in palette order. The rows of
 * `bms.mimic_symbol_libraries` restate them: migration `0090` the first four, `0092` the other three.
 */
export const mimicSymbolLibraryCodeSchema = z.enum(["core", "tabler", "lucide", "mdi", "qet", "wmpid", "drawio"]);

/**
 * The eight palette groups (ADR 0082 decision 2), in order. `mimic_symbols_group_code_check`
 * (migration `0090`) restates them; every library symbol belongs to one.
 */
export const MIMIC_SYMBOL_GROUP_CODES = [
  "water",
  "electrical",
  "it_ups",
  "hvac",
  "mechanical",
  "environment",
  "facility",
  "general",
] as const;

export type MimicSymbolGroupCode = (typeof MIMIC_SYMBOL_GROUP_CODES)[number];

/**
 * Every static symbol a unit can draw with: the core keys, then each library's curated keys in library
 * order (ADR 0084 decisions 2 and 7). A core key is bare, every other key is
 * `<library>:<name>`. An unknown key is a 400 here, before it reaches
 * `mimic_layout_nodes_symbol_fkey`. The library keys are generated
 * (`scripts/mimic-symbols/generate.mjs`) and `tests/f3.32e-mimic-symbol-libraries.test.ts` compares
 * them with migration `0090`'s rows. The refusal message is short: Zod's default lists every
 * option, about 7 KB for each refused symbol.
 */
export const mimicStaticSymbolSchema = z.enum(
  [
    ...mimicCoreSymbolSchema.options,
    ...TABLER_SYMBOL_KEYS,
    ...LUCIDE_SYMBOL_KEYS,
    ...MDI_SYMBOL_KEYS,
    ...QET_SYMBOL_KEYS,
    ...WMPID_SYMBOL_KEYS,
    ...DRAWIO_SYMBOL_KEYS,
  ],
  { errorMap: () => ({ message: "Unknown mimic symbol" }) },
);

/**
 * `F3.32f` slice 3 / ADR 0086 decision 2 (amends ADR 0084 decision 7) — a unit's symbol is a
 * static key or an organization key, `org.<code>:<name>`. Whether an organization key exists in
 * the caller's organization is the service's check, then the composite foreign key's. The
 * refusal stays one short message.
 */
export const mimicSymbolSchema = z.union([mimicStaticSymbolSchema, mimicOrgSymbolKeySchema], {
  errorMap: () => ({ message: "Unknown mimic symbol" }),
});

/** A layout's chosen library: a static code, or `org.<code>` for an organization library. */
export const mimicSymbolLibrarySelectionSchema = z.union([mimicSymbolLibraryCodeSchema, mimicOrgLibraryKeySchema], {
  errorMap: () => ({ message: "Unknown symbol library" }),
});

/**
 * One organization symbol as stored and served (ADR 0086 decisions 6 and 7): its geometry, re-checked
 * on the way out by `mimicShapeSchema` — seven tags, the attribute list, each value in its
 * grammar — because a row can reach the table by a path other than the upload. `style` is its
 * library's. A layout read embeds the ones its units draw, retired ones included.
 */
export const mimicOrgSymbolDtoSchema = z.object({
  id: z.string().uuid(),
  libraryId: z.string().uuid(),
  key: mimicOrgSymbolKeySchema,
  label: z.string(),
  group: z.enum(MIMIC_SYMBOL_GROUP_CODES),
  style: mimicSymbolStyleSchema,
  viewBox: mimicViewBoxSchema,
  shapes: z.array(mimicShapeSchema).max(MAX_MIMIC_SYMBOL_SHAPES),
  active: z.boolean(),
  sourceFilename: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  updatedAt: z.string(),
});

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
  /**
   * `F3.74` / ADR 0088 Amendment 1 (OQ3b) — a unit that draws every member of its role
   * (`fan_out`), and a unit the energy walk starts from (`is_source`). Always `false` on a panel
   * or label: migration `0097`'s `mimic_layout_nodes_flags_units_check`.
   */
  fanOut: z.boolean(),
  isSource: z.boolean(),
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
  /** The organization symbols the units draw (`F3.32f` slice 3); `[]` when none. */
  orgSymbols: z.array(mimicOrgSymbolDtoSchema),
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
  symbolLibraries: z.array(mimicSymbolLibrarySelectionSchema),
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
  symbolLibraries: z.array(mimicSymbolLibrarySelectionSchema),
  nodes: z.array(mimicLayoutNodeSchema),
  pipes: z.array(mimicLayoutPipeSchema),
  orgSymbols: z.array(mimicOrgSymbolDtoSchema),
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
