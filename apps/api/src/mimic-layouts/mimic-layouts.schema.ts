import { z } from "zod";

import {
  MIMIC_LAYOUT_BOUNDS,
  MIMIC_LAYOUT_NODE_KEY,
  MIMIC_LAYOUT_SLUG,
  MIMIC_LAYOUT_STALE_MESSAGE,
  mimicLayoutNodeKindSchema,
  libraryOfSymbol,
  mimicPanelToneSchema,
  mimicSymbolLibrary,
  mimicSymbolLibraryCodeSchema,
  mimicSymbolSchema,
} from "@bms/shared";

/**
 * `F3.32c` / ADR 0081 decisions 1–3 — the `POST` and `PUT
 * /api/v1/mimic-layouts` bodies (plan U2). The vocabularies and the bounds are
 * imported from `@bms/shared`, never restated (ADR 0030); migration `0088`'s
 * CHECKs restate the same literals and `tests/f3.32c-mimic-layouts-schema.test.ts`
 * compares them.
 *
 * Nodes and pipes are named by `key`, never by id (plan D5): a save replaces
 * every node, so an id would not survive it.
 *
 * What the database cannot see is checked here: containment in the layout's
 * own canvas (a CHECK cannot read the parent row), unique keys and pipe ends
 * before any row is written, so a bad body answers 400 with a path rather than
 * a constraint name.
 */

/** A `PUT` names a version the layout no longer has (ADR 0081 decision 2). Defined in
 * `@bms/shared` because the web editor matches it; re-exported so API imports stay here. */
export { MIMIC_LAYOUT_STALE_MESSAGE };

/** `DELETE` while a dashboard widget still names the layout (ADR 0081 decision 3). */
export const MIMIC_LAYOUT_IN_USE_MESSAGE = (n: number): string =>
  `${n} dashboard widget(s) still use this layout`;

const { canvasW, canvasH, z: zBounds, maxNodes, maxPipes } = MIMIC_LAYOUT_BOUNDS;

/**
 * One node. `symbol`, `roleCode` and `tone` are optional, and the per-kind
 * rule says which a kind carries — the `_kind_fields_check` of migration
 * `0088`, stated here first so the caller gets a path.
 */
export const mimicLayoutWriteNodeSchema = z
  .object({
    key: z.string().regex(MIMIC_LAYOUT_NODE_KEY),
    kind: mimicLayoutNodeKindSchema,
    symbol: mimicSymbolSchema.nullish(),
    label: z.string().trim().min(1).max(64),
    roleCode: z.string().min(1).max(64).nullish(),
    tone: mimicPanelToneSchema.nullish(),
    x: z.number().int().min(0).max(canvasW.max - 1),
    y: z.number().int().min(0).max(canvasH.max - 1),
    w: z.number().int().min(1).max(canvasW.max),
    h: z.number().int().min(1).max(canvasH.max),
    z: z.number().int().min(zBounds.min).max(zBounds.max).optional(),
  })
  .strict()
  .superRefine((node, ctx) => {
    const refuse = (path: string, message: string): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    if (node.kind === "unit") {
      if (node.symbol == null) refuse("symbol", "A unit needs a symbol");
      if (node.tone != null) refuse("tone", "A unit carries no tone");
      return;
    }
    if (node.symbol != null) refuse("symbol", `A ${node.kind} carries no symbol`);
    if (node.roleCode != null) refuse("roleCode", `A ${node.kind} carries no role`);
    if (node.kind === "panel" && node.tone == null) refuse("tone", "A panel needs a tone");
    if (node.kind === "label" && node.tone != null) refuse("tone", "A label carries no tone");
  })
  .describe(
    "A unit needs a symbol and carries no tone; a panel needs a tone and carries no symbol " +
      "or role; a label carries none of the three.",
  );

/** One pipe, between two unit keys of the same body. */
export const mimicLayoutWritePipeSchema = z
  .object({
    fromKey: z.string().regex(MIMIC_LAYOUT_NODE_KEY),
    toKey: z.string().regex(MIMIC_LAYOUT_NODE_KEY),
  })
  .strict();

/** The fields a create and a replace share. Spread into each `z.object`, not composed. */
const layoutFields = {
  name: z.string().trim().min(1).max(120),
  slug: z.string().regex(MIMIC_LAYOUT_SLUG),
  canvasW: z.number().int().min(canvasW.min).max(canvasW.max),
  canvasH: z.number().int().min(canvasH.min).max(canvasH.max),
  nodes: z.array(mimicLayoutWriteNodeSchema).max(maxNodes),
  pipes: z.array(mimicLayoutWritePipeSchema).max(maxPipes),
  /**
   * `F3.32e` / ADR 0084 decision 8 — the libraries the layout draws from. An absent list is
   * `["core"]` (plan ruling R2); `core` is not mandatory (R3). Migration `0090`'s cardinality
   * CHECK restates `.min(1)`.
   */
  symbolLibraries: z.array(mimicSymbolLibraryCodeSchema).min(1).default(["core"]),
};

type LayoutBody = {
  canvasW: number;
  canvasH: number;
  symbolLibraries: readonly string[];
  nodes: Array<{ key: string; kind: string; symbol?: string | null; x: number; y: number; w: number; h: number }>;
  pipes: Array<{ fromKey: string; toKey: string }>;
};

/**
 * The whole-body rules: unique keys, pipe ends that are unit keys of this
 * body, no pipe from a unit to itself, no pipe twice, every node inside
 * the layout's own canvas, no library listed twice, and every unit's symbol
 * from a library the layout chose (`F3.32e`, ADR 0084 decision 8).
 */
function refineLayoutBody(body: LayoutBody, ctx: z.RefinementCtx): void {
  body.symbolLibraries.forEach((code, index) => {
    if (body.symbolLibraries.indexOf(code) !== index) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["symbolLibraries", index],
        message: `Library "${code}" is listed twice`,
      });
    }
  });
  // An empty list is already refused by `.min(1)`, and Zod still runs this refine on it: checking
  // the units against no library would add an issue on every unit for that one mistake.
  const chosen = new Set(body.symbolLibraries);
  const kinds = new Map<string, string>();
  body.nodes.forEach((node, index) => {
    if (kinds.has(node.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes", index, "key"],
        message: `Node key "${node.key}" is used twice`,
      });
    }
    kinds.set(node.key, node.kind);
    if (node.kind === "unit" && node.symbol != null && chosen.size > 0) {
      const library = libraryOfSymbol(node.symbol);
      if (!chosen.has(library)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", index, "symbol"],
          message: `Symbol "${node.symbol}" belongs to the ${mimicSymbolLibrary(library).label} library, which this layout did not choose`,
        });
      }
    }
    if (node.x + node.w > body.canvasW || node.y + node.h > body.canvasH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes", index],
        message: `Node "${node.key}" lies outside the ${body.canvasW} x ${body.canvasH} canvas`,
      });
    }
  });

  const seen = new Set<string>();
  body.pipes.forEach((pipe, index) => {
    for (const end of ["fromKey", "toKey"] as const) {
      if (kinds.get(pipe[end]) !== "unit") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pipes", index, end],
          message: `A pipe joins two units; "${pipe[end]}" is not a unit of this layout`,
        });
      }
    }
    if (pipe.fromKey === pipe.toKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pipes", index],
        message: "A pipe cannot join a unit to itself",
      });
    }
    const id = `${pipe.fromKey}\u0000${pipe.toKey}`;
    if (seen.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pipes", index],
        message: `The pipe from "${pipe.fromKey}" to "${pipe.toKey}" is listed twice`,
      });
    }
    seen.add(id);
  });
}

const LAYOUT_BODY_RULES =
  "Node keys are unique; every node lies inside canvasW x canvasH; a pipe joins two " +
  "different unit keys of this body, and appears once; symbolLibraries names each library " +
  "once, and every unit's symbol belongs to one of them.";

/** `POST /api/v1/mimic-layouts`. `organizationId` names the owner (owner ruling OQ3). */
export const createMimicLayoutBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    ...layoutFields,
  })
  .strict()
  .superRefine(refineLayoutBody)
  .describe(LAYOUT_BODY_RULES);

/** `PUT /api/v1/mimic-layouts/:id` — the whole layout, plus the version it was loaded at. */
export const putMimicLayoutBodySchema = z
  .object({
    version: z.number().int().min(1),
    ...layoutFields,
  })
  .strict()
  .superRefine(refineLayoutBody)
  .describe(LAYOUT_BODY_RULES);

export type MimicLayoutWriteNode = z.infer<typeof mimicLayoutWriteNodeSchema>;
export type MimicLayoutWritePipe = z.infer<typeof mimicLayoutWritePipeSchema>;
export type CreateMimicLayoutBody = z.infer<typeof createMimicLayoutBodySchema>;
export type PutMimicLayoutBody = z.infer<typeof putMimicLayoutBodySchema>;
