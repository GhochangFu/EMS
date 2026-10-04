import { SOURCE_KEY_RESERVED_VAR, substituteSourceKeyPattern, type OnboardingDraft } from "@bms/shared";
import { z, type ZodTypeAny } from "zod";

import { MAX_INSTANTIATE_ASSETS } from "../asset-templates/asset-templates.schema";
import { echoedItems, MAX_ECHOED_ITEMS, moreTail, quoteCell } from "../spreadsheet-guard";
import { countOf } from "./onboarding-commit-proposal";
import { fail, succeed, TOOL_LIST_MAX_ITEMS, write, type ToolOutcome, type ToolState } from "./onboarding-tool-outcome";
import {
  draftTemplateCode,
  heldVersions,
  patternGrammarProblem,
  resolveTemplateForAsset,
  templateVariables,
  type TemplateRef,
  type ValidateTemplateContext,
} from "./onboarding-template-refs";
import {
  draftAssetSchema,
  draftAssetTemplateRefSchema,
  draftAuthoredTemplateSchema,
  draftStockTemplateSchema,
} from "./onboarding.schema";

/**
 * The template tools (`F3.22`, ADR 0091 decision 3). Imported by
 * `onboarding-agent-tools.ts`, never the reverse: the outcome helpers live in
 * `onboarding-tool-outcome.ts`, so there is no import cycle.
 *
 * The four writes parse their arguments with the draft's own element schemas,
 * as every other write does (ADR 0090 decision 4). `add_template`,
 * `import_stock_template` and `add_template_assets` are in the registry's
 * `CREDENTIAL_CHECKED_TOOLS` (decision 9): the credential walk runs on every
 * key and string they carry — each label, pattern and variable value — before
 * the schema does, so this module holds no second credential check.
 */

/** One template-placing call: a template, an RTU of the draft, and a batch of assets (decision 3). */
const templateAssetsArgs = z
  .object({
    code: draftAssetTemplateRefSchema.shape.code,
    version: draftAssetTemplateRefSchema.shape.version,
    rtuIndex: draftAssetSchema.shape.rtuIndex,
    assets: z
      .array(
        z.object({
          code: draftAssetSchema.shape.code,
          name: draftAssetSchema.shape.name,
          siteName: draftAssetSchema.shape.siteName,
          sourceDataKeyVars: draftAssetTemplateRefSchema.shape.sourceDataKeyVars,
        }),
      )
      .min(1)
      .max(MAX_INSTANTIATE_ASSETS),
  })
  .strict();

export const TEMPLATE_TOOL_SCHEMAS = {
  list_templates: z.object({ search: z.string().max(64).optional() }).strict(),
  get_template: z.union([
    z.object({ code: z.string().min(1).max(64), version: z.number().int().min(1).optional() }).strict(),
    z.object({ stockCode: z.string().min(1).max(64) }).strict(),
  ]),
  list_stock_templates: z.object({ search: z.string().max(64).optional() }).strict(),
  add_template: draftAuthoredTemplateSchema,
  import_stock_template: draftStockTemplateSchema,
  remove_template: z.object({ code: draftAssetTemplateRefSchema.shape.code }).strict(),
  add_template_assets: templateAssetsArgs,
} as const satisfies Record<string, ZodTypeAny>;

export type TemplateToolName = keyof typeof TEMPLATE_TOOL_SCHEMAS;

export const TEMPLATE_TOOL_DESCRIPTIONS: Record<TemplateToolName, string> = {
  list_templates:
    "Lists the organization's published asset templates (code, highest published version, domain, point count). Optional `search` filters code and name.",
  get_template:
    "Returns one template's points and the variables an asset must supply. Give `code` (and optionally `version`) for an organization template, or `stockCode` for a stock one.",
  list_stock_templates:
    "Lists the stock templates the catalog ships (stockCode, name, domain, point count). Optional `search` filters code and name.",
  add_template:
    "Adds a template to this draft in one call: code, name, domain and its measured points (pointKey, label, unit, sourceDataKeyPattern, required). Each pointKey is a draft or catalog point key; a pattern uses {variable} tokens. The commit publishes it, and a published template cannot be edited.",
  import_stock_template:
    "Imports a stock template into this draft. `patterns` gives a source-key pattern for a measured point of the entry; every required measured point needs one before assets can be built from it.",
  remove_template: "Removes the draft template with this `code`. Refused while an asset is built from it.",
  add_template_assets:
    "Adds assets built from one template (a draft template, or the organization's published version — the one given, or the highest) on the RTU at `rtuIndex`. Each asset gives code, name, siteName and `sourceDataKeyVars` for every variable get_template names.",
};

export function isTemplateToolName(name: string): name is TemplateToolName {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_TOOL_SCHEMAS, name);
}

/** What the template tools read, typed here so this module never imports the registry. */
export type TemplateToolContext = {
  readonly organizationId: string;
  readonly catalog: { listPointKeys(organizationId: string): Promise<ReadonlyArray<{ readonly code: string }>> };
  readonly templates: ValidateTemplateContext;
};

function matches(search: string, ref: TemplateRef): boolean {
  return !search || ref.code.toLowerCase().includes(search) || ref.name.toLowerCase().includes(search);
}

function searchOf(args: Record<string, unknown>): string {
  return typeof args.search === "string" ? args.search.toLowerCase() : "";
}

function pointsOf(ref: TemplateRef) {
  return ref.points.map((p) => ({
    pointKey: p.pointKey,
    kind: p.kind,
    required: p.required,
    sourceDataKeyPattern: p.sourceDataKeyPattern,
  }));
}

function highestPublished(refs: readonly TemplateRef[]): TemplateRef | undefined {
  return refs
    .filter((ref) => ref.status === "published")
    .reduce<TemplateRef | undefined>((best, ref) => (best === undefined || (ref.version ?? 0) > (best.version ?? 0) ? ref : best), undefined);
}

/** A bounded, quoted list: at most `max` items, the rest counted (`F4.105`). */
function listOf(items: readonly string[], noun: string, max: number = 10): string {
  const { shown, omitted } = echoedItems(items, max);
  return [...shown, moreTail(omitted, noun)].filter(Boolean).join(", ");
}

/**
 * Decision 6: a code is used, never re-authored. A code the draft holds, or one
 * the organization holds in any version and status, is refused; the second
 * names the versions.
 */
function heldCodeProblem(draft: OnboardingDraft, ctx: ValidateTemplateContext, code: string): string | null {
  if ((draft.templates ?? []).some((entry) => draftTemplateCode(entry) === code)) {
    return `Template ${quoteCell(code)} is already in this draft. Add assets from it with add_template_assets.`;
  }
  const held = heldVersions(ctx, code);
  if (held.length > 0) {
    return (
      `This organization already holds template ${quoteCell(code)} (versions: ${listOf(held.map(String), "versions")}). ` +
      "Add assets from it with add_template_assets; a new version is made on the template editor."
    );
  }
  return null;
}

/** The first pattern that breaks the token grammar, or `null`. */
function grammarProblem(patterns: ReadonlyArray<string | undefined>): string | null {
  for (const pattern of patterns) {
    const problem = pattern === undefined ? null : patternGrammarProblem(pattern);
    if (problem !== null) {
      return `${problem}.`;
    }
  }
  return null;
}

/** The catalog release a stock ref comes from (`StockTemplateRef`), or `null` for a ref that carries none. */
function stockVersionOf(ref: TemplateRef): number | null {
  const version = (ref as { stockVersion?: unknown }).stockVersion;
  return typeof version === "number" ? version : null;
}

/**
 * Decision 7 and owner ruling Q1-C at tool time, so the model learns at the
 * call what validation would refuse later: every required measured point has a
 * pattern (V5), every variable is one the template asks for (V7), and every
 * required pattern resolves with the asset's variables and its own code (V6).
 */
function templatedAssetsProblem(ref: TemplateRef, assets: z.infer<typeof templateAssetsArgs>["assets"]): string | null {
  const code = quoteCell(ref.code);
  const required = ref.points.filter((point) => point.kind === "measured" && point.required);
  const missing = required.find((point) => point.sourceDataKeyPattern === null);
  if (missing !== undefined) {
    return (
      `Template ${code} has no source-key pattern for its required point ${quoteCell(missing.pointKey)}; ` +
      "give that point a pattern before assets are built from it."
    );
  }
  const variables = templateVariables(ref);
  for (const asset of assets) {
    const vars = asset.sourceDataKeyVars ?? {};
    const stranger = Object.keys(vars).find((key) => !variables.includes(key));
    if (stranger !== undefined) {
      return (
        `${quoteCell(stranger)} (asset ${quoteCell(asset.code)}) is not a variable of template ${code}; ` +
        (variables.length === 0 ? "it has no variables." : `its variables are: ${listOf(variables.map((v) => quoteCell(v)), "variables")}.`)
      );
    }
    const withCode = { ...vars, [SOURCE_KEY_RESERVED_VAR]: asset.code };
    for (const point of required) {
      const unresolved = substituteSourceKeyPattern(point.sourceDataKeyPattern ?? "", withCode).unresolved;
      if (unresolved.length > 0) {
        return (
          `Asset ${quoteCell(asset.code)} needs the variable ${quoteCell(unresolved[0] ?? "")} ` +
          `for the required point ${quoteCell(point.pointKey)} of template ${code}.`
        );
      }
    }
  }
  return null;
}

/** Runs one of the seven template tools. `args` has passed `TEMPLATE_TOOL_SCHEMAS[name]`. */
export async function dispatchTemplateTool(
  name: TemplateToolName,
  args: Record<string, unknown>,
  state: ToolState,
  ctx: TemplateToolContext,
): Promise<ToolOutcome> {
  const draft = state.working;
  switch (name) {
    case "list_templates": {
      const search = searchOf(args);
      const codes = [...new Set(ctx.templates.organization.map((ref) => ref.code))];
      const rows = codes
        .map((code) => highestPublished(ctx.templates.organization.filter((ref) => ref.code === code)))
        .filter((ref): ref is TemplateRef => ref !== undefined && matches(search, ref))
        .map((ref) => ({ code: ref.code, version: ref.version, domain: ref.domain, pointCount: ref.points.length }));
      const { shown, omitted } = echoedItems(rows, TOOL_LIST_MAX_ITEMS);
      return succeed({ templates: shown, more: moreTail(omitted, "templates") || undefined });
    }

    case "get_template": {
      if (typeof args.stockCode === "string") {
        const stock = ctx.templates.stock.find((ref) => ref.code === args.stockCode);
        return stock === undefined
          ? fail(`There is no stock template ${quoteCell(args.stockCode)}.`)
          : succeed({ stockCode: stock.code, name: stock.name, domain: stock.domain, points: pointsOf(stock), variables: templateVariables(stock) });
      }
      const code = String(args.code);
      const version = typeof args.version === "number" ? args.version : undefined;
      const named = ctx.templates.organization.filter((ref) => ref.code === code && (version === undefined || ref.version === version));
      const found = highestPublished(named);
      if (found === undefined) {
        return fail(
          version !== undefined && heldVersions(ctx.templates, code).length > 0
            ? `Template ${quoteCell(code)} has no published version ${version}.`
            : `There is no published template ${quoteCell(code)} in this organization.`,
        );
      }
      return succeed({ code: found.code, version: found.version, name: found.name, domain: found.domain, points: pointsOf(found), variables: templateVariables(found) });
    }

    case "list_stock_templates": {
      const search = searchOf(args);
      const rows = ctx.templates.stock
        .filter((ref) => matches(search, ref))
        .map((ref) => ({ stockCode: ref.code, name: ref.name, domain: ref.domain, pointCount: ref.points.length }));
      const { shown, omitted } = echoedItems(rows, TOOL_LIST_MAX_ITEMS);
      return succeed({ templates: shown, more: moreTail(omitted, "stock templates") || undefined });
    }

    case "add_template": {
      const entry = args as z.infer<typeof draftAuthoredTemplateSchema>;
      const held = heldCodeProblem(draft, ctx.templates, entry.code);
      if (held !== null) {
        return fail(held);
      }
      const draftKeys = new Set((draft.pointKeys ?? []).map((key) => key.code));
      let unknown = [...new Set(entry.points.map((point) => point.pointKey))].filter((key) => !draftKeys.has(key));
      if (unknown.length > 0) {
        const catalog = new Set((await ctx.catalog.listPointKeys(ctx.organizationId)).map((key) => key.code));
        unknown = unknown.filter((key) => !catalog.has(key));
      }
      if (unknown.length > 0) {
        return fail(
          `Template ${quoteCell(entry.code)} names point keys that are neither in this draft nor in the catalog: ` +
            `${listOf(unknown.map((key) => quoteCell(key)), "point keys")}. Add them with add_point_key first.`,
        );
      }
      const grammar = grammarProblem(entry.points.map((point) => point.sourceDataKeyPattern));
      if (grammar !== null) {
        return fail(grammar);
      }
      return write(state, { templates: [...(draft.templates ?? []), entry] }, `Added template ${entry.code} (${countOf(entry.points.length, "point")})`);
    }

    case "import_stock_template": {
      const entry = args as z.infer<typeof draftStockTemplateSchema>;
      const stock = ctx.templates.stock.find((ref) => ref.code === entry.stockCode);
      if (stock === undefined) {
        const codes = ctx.templates.stock.map((ref) => quoteCell(ref.code));
        return fail(`There is no stock template ${quoteCell(entry.stockCode)}. Stock templates: ${listOf(codes, "stock templates", MAX_ECHOED_ITEMS)}.`);
      }
      const held = heldCodeProblem(draft, ctx.templates, entry.stockCode);
      if (held !== null) {
        return fail(held);
      }
      const patterns = entry.patterns ?? {};
      const measured = new Set(stock.points.filter((point) => point.kind === "measured").map((point) => point.pointKey));
      const strangers = Object.keys(patterns).filter((key) => !measured.has(key));
      if (strangers.length > 0) {
        return fail(
          `${listOf(strangers.map((key) => quoteCell(key)), "keys")}: not a measured point of stock template ${quoteCell(stock.code)}. ` +
            "A pattern is given only for a measured point.",
        );
      }
      const grammar = grammarProblem(Object.values(patterns));
      if (grammar !== null) {
        return fail(grammar);
      }
      const version = stockVersionOf(stock);
      return write(
        state,
        { templates: [...(draft.templates ?? []), entry] },
        `Imported stock template ${stock.code}${version === null ? "" : ` v${version}`} (${countOf(stock.points.length, "point")})`,
      );
    }

    case "remove_template": {
      const code = (args as { code: string }).code;
      const templates = draft.templates ?? [];
      const index = templates.findIndex((entry) => draftTemplateCode(entry) === code);
      if (index < 0) {
        return fail(`There is no template ${quoteCell(code)} in this draft.`);
      }
      const users = (draft.assets ?? []).filter((asset) => asset.template?.code === code).map((asset) => quoteCell(asset.code));
      if (users.length > 0) {
        return fail(`Template ${quoteCell(code)} still has assets: ${listOf(users, "assets")}. Remove them first.`);
      }
      return write(state, { templates: templates.filter((_, i) => i !== index) }, `Removed template ${code}`);
    }

    case "add_template_assets": {
      const input = args as z.infer<typeof templateAssetsArgs>;
      const rtus = draft.rtus ?? [];
      const rtu = rtus[input.rtuIndex];
      if (rtu === undefined) {
        return fail(`There is no RTU at index ${input.rtuIndex}; the draft has ${rtus.length}.`);
      }
      const resolved = resolveTemplateForAsset(
        draft,
        { code: input.code, ...(input.version !== undefined ? { version: input.version } : {}) },
        ctx.templates,
      );
      if ("problem" in resolved) {
        return fail(`${resolved.problem}.`);
      }
      const problem = templatedAssetsProblem(resolved.ref, input.assets);
      if (problem !== null) {
        return fail(problem);
      }
      // A draft entry's code is held by no organization version (decision 6),
      // so the commit publishes it as version 1; an organization template is
      // pinned to the version that resolved.
      const version = resolved.source === "organization" ? resolved.ref.version : null;
      const assets = input.assets.map((asset) => ({
        rtuIndex: input.rtuIndex,
        code: asset.code,
        name: asset.name,
        siteName: asset.siteName,
        domain: resolved.ref.domain,
        template: {
          code: input.code,
          ...(version !== null ? { version } : {}),
          ...(asset.sourceDataKeyVars !== undefined ? { sourceDataKeyVars: asset.sourceDataKeyVars } : {}),
        },
      }));
      return write(
        state,
        { assets: [...(draft.assets ?? []), ...assets] },
        `Added ${countOf(assets.length, "asset")} from ${input.code} v${version ?? 1} on ${rtu.code}`,
      );
    }
  }
}
