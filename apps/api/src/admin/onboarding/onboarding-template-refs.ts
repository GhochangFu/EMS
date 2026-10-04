/**
 * `F3.22` (ADR 0091 decisions 2 and 6) — the template read seam, pure.
 *
 * One shape, {@link TemplateRef}, for the three places a template comes from:
 * a draft entry the chat authored, a stock entry the draft imports (with its
 * `patterns` overlay, owner ruling Q1-C), and a version the organization
 * already holds. The validator, the template tools and the commit read
 * templates through this module, so the three agree on which template an
 * asset names and which variables it asks for.
 *
 * No zod here (`tests/adr-0029-openapi-contract.test.ts`), no database: the
 * caller reads the context once per request through
 * `OnboardingTemplateCatalogService.context` and hands it in.
 */
import {
  SOURCE_KEY_PATTERN_TOKEN,
  patternVariables,
  type OnboardingDraft,
  type OnboardingDraftAssetTemplateRef,
  type OnboardingDraftStockTemplate,
  type OnboardingDraftTemplate,
} from "@bms/shared";

import { quoteCell } from "../spreadsheet-guard";

export type TemplatePointRef = {
  readonly pointKey: string;
  readonly kind: "measured" | "derived";
  readonly required: boolean;
  readonly sourceDataKeyPattern: string | null;
};

export type TemplateRef = {
  readonly code: string;
  /** The organization version; `null` for a draft entry or a stock entry. */
  readonly version: number | null;
  readonly name: string;
  readonly domain: string;
  /** The organization version's status; `null` for a draft entry or a stock entry. */
  readonly status: "draft" | "published" | "archived" | null;
  /** Empty for an organization version that is not published (the catalog reads no points for it). */
  readonly points: readonly TemplatePointRef[];
  readonly alarmCount: number;
  readonly dashboardWidgetCount: number;
};

/** A stock entry's ref, with the catalog release it would be imported from. */
export type StockTemplateRef = TemplateRef & { readonly stockVersion: number };

/** What a validation reads about templates: every organization version (all statuses), and the stock catalog. */
export type ValidateTemplateContext = {
  readonly organization: readonly TemplateRef[];
  readonly stock: readonly TemplateRef[];
};

/** For a caller with no organization and no catalog — a spec, or a draft that names no template. */
export const EMPTY_TEMPLATE_CONTEXT: ValidateTemplateContext = Object.freeze({
  organization: Object.freeze([]) as readonly TemplateRef[],
  stock: Object.freeze([]) as readonly TemplateRef[],
});

/** A stock import, as opposed to an authored template: the union's stock branch carries `stockCode`. */
export function isStockEntry(entry: OnboardingDraftTemplate): entry is OnboardingDraftStockTemplate {
  return "stockCode" in entry;
}

/** The code a draft entry creates: an authored `code`, or the stock entry's own code. */
export function draftTemplateCode(entry: OnboardingDraftTemplate): string {
  return isStockEntry(entry) ? entry.stockCode : entry.code;
}

/** `""` is no pattern, as `resolveSourceDataKey`'s `!pattern` reads it at instantiate time. */
function patternOrNull(pattern: string | null | undefined): string | null {
  return pattern ? pattern : null;
}

/**
 * A draft entry as a ref. An authored point takes the commit's defaults
 * (`kind: "measured"`, `required ?? true`, ruling Q2-A); a stock entry is the
 * catalog's ref with `patterns` laid over its **measured** points (ruling
 * Q1-C). `null` for a stock code the catalog does not ship.
 */
export function draftTemplateRef(entry: OnboardingDraftTemplate, ctx: ValidateTemplateContext): TemplateRef | null {
  if (isStockEntry(entry)) {
    const stock = ctx.stock.find((candidate) => candidate.code === entry.stockCode);
    if (stock === undefined) {
      return null;
    }
    const patterns = entry.patterns ?? {};
    return {
      ...stock,
      points: stock.points.map((point) =>
        point.kind === "measured" && Object.prototype.hasOwnProperty.call(patterns, point.pointKey)
          ? { ...point, sourceDataKeyPattern: patternOrNull(patterns[point.pointKey]) }
          : point,
      ),
    };
  }
  return {
    code: entry.code,
    version: null,
    name: entry.name,
    domain: entry.domain,
    status: null,
    points: entry.points.map((point) => ({
      pointKey: point.pointKey,
      kind: "measured" as const,
      required: point.required ?? true,
      sourceDataKeyPattern: patternOrNull(point.sourceDataKeyPattern),
    })),
    alarmCount: 0,
    dashboardWidgetCount: 0,
  };
}

export type TemplateResolution =
  | { readonly ref: TemplateRef; readonly source: "draft" | "organization" }
  | { readonly problem: string; readonly field: "code" | "version" };

/**
 * The template an asset's `template` names (decision 6): the draft entry with
 * that code first, then the organization's published version — the named one,
 * or the highest when none is named. A draft or archived version never
 * resolves: an asset is only ever built from a published one.
 */
export function resolveTemplateForAsset(
  draft: OnboardingDraft,
  ref: OnboardingDraftAssetTemplateRef,
  ctx: ValidateTemplateContext,
): TemplateResolution {
  const entry = (draft.templates ?? []).find((candidate) => draftTemplateCode(candidate) === ref.code);
  if (entry !== undefined) {
    const resolved = draftTemplateRef(entry, ctx);
    return resolved === null
      ? { problem: `${quoteCell(ref.code)} is not a stock template this release ships`, field: "code" }
      : { ref: resolved, source: "draft" };
  }
  const published = ctx.organization.filter(
    (candidate) => candidate.code === ref.code && candidate.status === "published",
  );
  if (ref.version !== undefined && heldVersions(ctx, ref.code).length > 0) {
    const named = published.find((candidate) => candidate.version === ref.version);
    return named === undefined
      ? { problem: `Template ${quoteCell(ref.code)} has no published version ${ref.version}`, field: "version" }
      : { ref: named, source: "organization" };
  }
  const highest = published.reduce<TemplateRef | undefined>(
    (best, candidate) => (best === undefined || (candidate.version ?? 0) > (best.version ?? 0) ? candidate : best),
    undefined,
  );
  return highest === undefined
    ? {
        problem: `Template ${quoteCell(ref.code)} is not in this draft and has no published version in this organization`,
        field: "code",
      }
    : { ref: highest, source: "organization" };
}

/** The variables a template asks an asset for: its measured patterns' tokens minus `asset_code` (the dialog's rule). */
export function templateVariables(ref: TemplateRef): string[] {
  return patternVariables(
    ref.points.filter((point) => point.kind === "measured").map((point) => point.sourceDataKeyPattern),
  );
}

/**
 * A refusal for a pattern with a brace outside a `{token}`, or `null`. Every
 * `SOURCE_KEY_PATTERN_TOKEN` match is removed first; any `{` or `}` left over
 * is a token the substitution would leave literal in a `source_data_key`.
 */
export function patternGrammarProblem(pattern: string): string | null {
  const rest = pattern.replace(SOURCE_KEY_PATTERN_TOKEN, "");
  return rest.includes("{") || rest.includes("}")
    ? `Pattern ${quoteCell(pattern)} has a brace outside a {variable}; a variable is letters, digits or _ inside braces`
    : null;
}

/** Every version of `code` the organization holds, in any status, ascending (decision 6: "in any version"). */
export function heldVersions(ctx: ValidateTemplateContext, code: string): number[] {
  return ctx.organization
    .filter((candidate) => candidate.code === code && candidate.version !== null)
    .map((candidate) => candidate.version as number)
    .sort((a, b) => a - b);
}
