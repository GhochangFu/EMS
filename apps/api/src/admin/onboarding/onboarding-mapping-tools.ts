import { z, type ZodTypeAny } from "zod";

import { echoedItems, moreTail, quoteCell } from "../spreadsheet-guard";
import { countOf } from "./onboarding-commit-proposal";
import { assetPointProblems } from "./onboarding-mapping-refs";
import { pointKeyDeclarationProblems } from "./onboarding-point-key-conflict";
import { unresolvedPointKey, type ValidateTemplateContext } from "./onboarding-template-refs";
import { fail, succeed, TOOL_LIST_MAX_ITEMS, write, type ToolOutcome, type ToolState } from "./onboarding-tool-outcome";
import { draftAssetPointSchema, draftPointKeySchema } from "./onboarding.schema";

/**
 * The batch point-key and mapping tools (`F3.23`, ADR 0092 decision 4).
 * Imported by `onboarding-agent-tools.ts`, never the reverse, on the
 * `onboarding-template-tools.ts` pattern.
 *
 * Both writes are all-or-none: one refused key or row refuses the call and
 * writes nothing. `add_point_keys` and `map_points` are in the registry's
 * `CREDENTIAL_CHECKED_TOOLS`, so the credential walk runs on every key and
 * string they carry before the schema does; this module holds no second
 * credential check. The draft caps (500 keys, 5,000 mappings) still bind
 * through `write()`.
 */

/** ADR 0092 *Left to the plan* 1: the most keys one `add_point_keys` call declares. */
export const MAX_POINT_KEYS_PER_CALL = 100;

/** ADR 0092 *Left to the plan* 1: the most rows one `map_points` call writes (as `MAX_INSTANTIATE_ASSETS`). */
export const MAX_ASSET_POINTS_PER_CALL = 200;

/** The most items an action line names; the rest are counted (`F4.105`). */
const LINE_ITEMS = 10;

export const MAPPING_TOOL_SCHEMAS = {
  add_point_keys: z.object({ keys: z.array(draftPointKeySchema).min(1).max(MAX_POINT_KEYS_PER_CALL) }).strict(),
  // The rows omit `assetIndex` and are strict, so a row that carries its own
  // index is refused rather than folded onto the call's asset: a batch across
  // two assets is one call per asset (F3.23 review).
  map_points: z
    .object({
      assetIndex: draftAssetPointSchema.shape.assetIndex,
      points: z.array(draftAssetPointSchema.omit({ assetIndex: true }).strict()).min(1).max(MAX_ASSET_POINTS_PER_CALL),
    })
    .strict(),
  get_asset_points: z.object({ assetIndex: z.number().int().min(0) }).strict(),
} as const satisfies Record<string, ZodTypeAny>;

export type MappingToolName = keyof typeof MAPPING_TOOL_SCHEMAS;

export const MAPPING_TOOL_DESCRIPTIONS: Record<MappingToolName, string> = {
  add_point_keys:
    `Declares up to ${MAX_POINT_KEYS_PER_CALL} point keys in this draft in one call, all or none. ` +
    "Refused when a code repeats in the call, is already declared in this draft, or is inactive in the catalog, " +
    "or when the catalog already holds the code with a different unit or domain (declare such a code without unit and domain " +
    "to accept the catalog's). " +
    "Call it before map_points for the keys the catalog does not hold; the result names the keys new to the catalog.",
  map_points:
    `Maps up to ${MAX_ASSET_POINTS_PER_CALL} source data keys on the plain asset at \`assetIndex\` to point keys in one call, all or none. ` +
    "Declare missing keys with add_point_keys first. Refused when the asset is missing or built from a template, " +
    "or when a row's key is neither declared nor active in the catalog, or repeats a point key or source data key on that asset.",
  get_asset_points:
    "Lists the mappings of the asset at `assetIndex`, each with its draft-wide `index` (the one remove_asset_point takes).",
};

/** Whether `name` is one of the three F3.23 mapping tools. */
export function isMappingToolName(name: string): name is MappingToolName {
  return Object.prototype.hasOwnProperty.call(MAPPING_TOOL_SCHEMAS, name);
}

/** What the mapping tools read, typed here so this module never imports the registry. */
export type MappingToolContext = {
  readonly templates: ValidateTemplateContext;
};

/** A bounded, quoted list: at most `LINE_ITEMS` items, the rest counted. */
function listOf(items: readonly string[], noun: string): string {
  const { shown, omitted } = echoedItems(items, LINE_ITEMS);
  return [...shown, moreTail(omitted, noun)].filter(Boolean).join(", ");
}

/** Runs one validated mapping-tool call against the working draft (ADR 0092 decision 4). */
export function dispatchMappingTool(
  name: MappingToolName,
  args: Record<string, unknown>,
  state: ToolState,
  ctx: MappingToolContext,
): ToolOutcome {
  const draft = state.working;
  switch (name) {
    case "add_point_keys": {
      const { keys } = args as z.infer<(typeof MAPPING_TOOL_SCHEMAS)["add_point_keys"]>;
      const existing = draft.pointKeys ?? [];
      const before = new Set(existing.map((key) => key.code));
      const declared = new Set([...before, ...keys.map((key) => key.code)]);
      const catalog = ctx.templates.pointKeys;
      const seen = new Set<string>();
      for (const [index, key] of keys.entries()) {
        if (seen.has(key.code)) {
          return fail(`keys.${index}: Point key ${quoteCell(key.code)} appears more than once in this call`);
        }
        seen.add(key.code);
        if (before.has(key.code)) {
          return fail(`keys.${index}: Point key ${quoteCell(key.code)} is already declared in this draft`);
        }
        // Declaring a key the catalog holds inactive does not make it resolve:
        // the commit's `assertPointKeysActive` refuses any mapping onto it.
        const unresolved = unresolvedPointKey(key.code, declared, catalog);
        if (unresolved !== null) {
          return fail(`keys.${index}: ${unresolved}`);
        }
      }
      // F4.225: the commit refuses a declared unit or domain the catalog
      // contradicts. The loop above already refuses a repeated or
      // already-declared code, so only the catalog sentence fires here; the
      // index is the key's place in this call.
      const conflict = pointKeyDeclarationProblems([...existing, ...keys], ctx.templates.pointKeyFields).find(
        (candidate) => candidate.index >= existing.length,
      );
      if (conflict) {
        return fail(`keys.${conflict.index - existing.length}: ${conflict.message}`);
      }
      const newToCatalog = keys.filter((key) => catalog.get(key.code) === undefined).map((key) => key.code);
      const fresh = newToCatalog.length > 0 ? ` (${newToCatalog.length} new to the catalog)` : "";
      return write(
        state,
        { pointKeys: [...existing, ...keys] },
        `Added ${countOf(keys.length, "point key")}: ${listOf(
          keys.map((key) => quoteCell(key.code)),
          "point keys",
        )}${fresh}`,
        { added: keys.length, newToCatalog },
      );
    }

    case "map_points": {
      const { assetIndex, points } = args as z.infer<(typeof MAPPING_TOOL_SCHEMAS)["map_points"]>;
      const rows = points.map((point) => ({ assetIndex, ...point }));
      const existing = draft.assetPoints ?? [];
      // ADR 0092 decision 2: the validator's mapping rule, so no row written
      // here fails the commit as 23503 or 23505.
      const problems = assetPointProblems(existing, rows, draft, ctx.templates.pointKeys);
      const first = problems[0];
      if (first !== undefined) {
        return fail(first.field === "assetIndex" ? first.message : `points.${first.index}: ${first.message}`);
      }
      const asset = draft.assets![assetIndex]!;
      return write(
        state,
        { assetPoints: [...existing, ...rows] },
        `Mapped ${countOf(rows.length, "point")} on asset ${quoteCell(asset.code)}: ${listOf(
          rows.map((row) => `${quoteCell(row.sourceDataKey)} → ${quoteCell(row.pointKey)}`),
          "mappings",
        )}`,
        { mapped: rows.length },
      );
    }

    case "get_asset_points": {
      const { assetIndex } = args as z.infer<(typeof MAPPING_TOOL_SCHEMAS)["get_asset_points"]>;
      const asset = draft.assets?.[assetIndex];
      if (asset === undefined) {
        return fail(`There is no asset at index ${assetIndex}; the draft has ${draft.assets?.length ?? 0}.`);
      }
      // The index is the draft-wide position, taken before the filter.
      const rows = (draft.assetPoints ?? [])
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.assetIndex === assetIndex)
        .map(({ row, index }) => ({
          index,
          pointKey: row.pointKey,
          sourceDataKey: row.sourceDataKey,
          sensorCode: row.sensorCode,
          unit: row.unit,
        }));
      const { shown, omitted } = echoedItems(rows, TOOL_LIST_MAX_ITEMS);
      return succeed({
        asset: { code: asset.code, name: asset.name, templated: Boolean(asset.template) },
        points: shown,
        more: moreTail(omitted, "mappings") || undefined,
      });
    }
  }
}
