import { z, type ZodTypeAny } from "zod";

import { echoedItems, moreTail, quoteCell } from "../spreadsheet-guard";
import { fail, succeed, TOOL_LIST_MAX_ITEMS, type ToolOutcome, type ToolState } from "./onboarding-tool-outcome";
import { heldVersions, templateVariables, type TemplateRef, type ValidateTemplateContext } from "./onboarding-template-refs";

/**
 * The template tools (`F3.22`, ADR 0091 decision 3). Imported by
 * `onboarding-agent-tools.ts`, never the reverse: the outcome helpers live in
 * `onboarding-tool-outcome.ts`, so there is no import cycle.
 */

export const TEMPLATE_TOOL_SCHEMAS = {
  list_templates: z.object({ search: z.string().max(64).optional() }).strict(),
  get_template: z.union([
    z.object({ code: z.string().min(1).max(64), version: z.number().int().min(1).optional() }).strict(),
    z.object({ stockCode: z.string().min(1).max(64) }).strict(),
  ]),
  list_stock_templates: z.object({ search: z.string().max(64).optional() }).strict(),
} as const satisfies Record<string, ZodTypeAny>;

export type TemplateToolName = keyof typeof TEMPLATE_TOOL_SCHEMAS;

export const TEMPLATE_TOOL_DESCRIPTIONS: Record<TemplateToolName, string> = {
  list_templates:
    "Lists the organization's published asset templates (code, highest published version, domain, point count). Optional `search` filters code and name.",
  get_template:
    "Returns one template's points and the variables an asset must supply. Give `code` (and optionally `version`) for an organization template, or `stockCode` for a stock one.",
  list_stock_templates:
    "Lists the stock templates the catalog ships (stockCode, name, domain, point count). Optional `search` filters code and name.",
};

export function isTemplateToolName(name: string): name is TemplateToolName {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_TOOL_SCHEMAS, name);
}

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

/** Runs one of the three read tools. `args` has passed `TEMPLATE_TOOL_SCHEMAS[name]`. */
export function dispatchTemplateTool(
  name: TemplateToolName,
  args: Record<string, unknown>,
  _state: ToolState,
  ctx: { readonly templates: ValidateTemplateContext },
): ToolOutcome {
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
  }
}
