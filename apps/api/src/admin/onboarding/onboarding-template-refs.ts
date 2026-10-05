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
  SOURCE_KEY_RESERVED_VAR,
  patternVariables,
  substituteSourceKeyPattern,
  type OnboardingDraft,
  type OnboardingDraftAssetTemplateRef,
  type OnboardingDraftStockTemplate,
  type OnboardingDraftTemplate,
} from "@bms/shared";

// F4.193: the instantiate guards take their bound from this same leaf module,
// so the onboarding check and `planAsset` cannot disagree, and this module
// stays pure (no Nest or database import).
import { SOURCE_DATA_KEY_MAX_LENGTH as SOURCE_DATA_KEY_MAX } from "../../calc/computed-source-data-key";
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
  /**
   * The dashboards one templated asset gets: one per view of `content.dashboards`
   * (`sortedViewNames`), which is what the instantiate core's `dashboardCount`
   * counts per asset. The commit proposal prints this one.
   */
  readonly dashboardCount: number;
  /** The `dashboard_widgets` rows one asset costs (`dashboardWidgetRowsFor`) — the bound's unit, not the one the proposal prints. */
  readonly dashboardWidgetCount: number;
};

/** A stock entry's ref, with the catalog release it would be imported from. */
export type StockTemplateRef = TemplateRef & { readonly stockVersion: number };

/** What a validation reads about templates: every organization version (all statuses), the stock catalog, and the point-key catalog. */
export type ValidateTemplateContext = {
  readonly organization: readonly TemplateRef[];
  readonly stock: readonly TemplateRef[];
  /**
   * `F4.196`: the fleet point-key catalog, code → `active`. An authored draft
   * template's point resolves at commit against this catalog or against a key
   * the draft declares, so validation reads the same rule as the commit.
   */
  readonly pointKeys: ReadonlyMap<string, boolean>;
};

/** For a caller with no organization and no catalog — a spec, or a draft that names no template. */
export const EMPTY_TEMPLATE_CONTEXT: ValidateTemplateContext = Object.freeze({
  organization: Object.freeze([]) as readonly TemplateRef[],
  stock: Object.freeze([]) as readonly TemplateRef[],
  pointKeys: new Map<string, boolean>() as ReadonlyMap<string, boolean>,
});

/**
 * `F4.196` — why an authored template's point key does not resolve at commit,
 * or `null` when it does. The commit inserts each draft key the catalog does
 * not hold, as active, and reuses the row of one it does hold; then
 * `assertPointKeysActive` refuses a template key that is not active. So a key
 * resolves when it is active in the catalog, or when the draft declares it and
 * the catalog does not hold it. Checked here because a `PATCH :id/draft` can
 * drop a declaration that `remove_point_key` (`F4.195`) would refuse. The
 * validator and both template-key tools (`add_template`, `remove_point_key`)
 * ask this one question, so a tool cannot accept what validation refuses.
 */
export function unresolvedPointKey(key: string, declared: ReadonlySet<string>, catalog: ReadonlyMap<string, boolean>): string | null {
  const active = catalog.get(key);
  if (active === true || (active === undefined && declared.has(key))) {
    return null;
  }
  return active === false
    ? `Point key ${quoteCell(key)} is inactive in the catalog`
    : `Point key ${quoteCell(key)} is neither in this draft nor in the catalog`;
}

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
    dashboardCount: 0,
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
    // F4.193: the commit publishes a draft entry as version 1, so any other
    // version names a template that will not exist; it is refused, not ignored.
    if (ref.version !== undefined && ref.version !== 1) {
      return {
        problem: `Template ${quoteCell(ref.code)} is in this draft and publishes as version 1, not ${ref.version}`,
        field: "version",
      };
    }
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

/** What one pattern resolves to for one asset, in the instantiate core's terms. */
export type TemplateSourceKey =
  | { readonly outcome: "key"; readonly key: string }
  | { readonly outcome: "unresolved"; readonly variable: string }
  | { readonly outcome: "empty" }
  | { readonly outcome: "too_long"; readonly length: number };

/**
 * `F3.22` (ADR 0091 decision 7, code review) — the one predicate the
 * validator, the tool-time check and the proposal's count share, so all three
 * agree with the instantiate core. `resolveSourceDataKey` refuses a pattern
 * with an unsupplied variable and one that resolves to `""`; `planAsset` then
 * refuses a resolved key over `bms.asset_points.source_data_key`'s 128
 * characters, on **every** measured point, optional or not. `asset_code` is the
 * asset's own code, spread last as the core spreads it.
 */
export function templateSourceKey(
  pattern: string,
  vars: Readonly<Record<string, string>>,
  assetCode: string,
): TemplateSourceKey {
  const { key, unresolved } = substituteSourceKeyPattern(pattern, { ...vars, [SOURCE_KEY_RESERVED_VAR]: assetCode });
  if (unresolved.length > 0) {
    return { outcome: "unresolved", variable: unresolved[0] ?? "" };
  }
  if (key === "") {
    return { outcome: "empty" };
  }
  return key.length > SOURCE_DATA_KEY_MAX ? { outcome: "too_long", length: key.length } : { outcome: "key", key };
}

/** A point of a template that one asset cannot build, and why. */
export type TemplateSourceKeyProblem = {
  readonly pointKey: string;
  readonly result: Exclude<TemplateSourceKey, { outcome: "key" }>;
};

/**
 * The first measured point `planAsset` would refuse for one asset, or `null`:
 * a required point whose key does not resolve or resolves to `""`, or any
 * point whose key resolves over the length limit. A required point with no
 * pattern at all is V5's, reported apart, so it is skipped here.
 */
export function templateSourceKeyProblem(
  ref: TemplateRef,
  vars: Readonly<Record<string, string>>,
  assetCode: string,
): TemplateSourceKeyProblem | null {
  for (const point of ref.points) {
    if (point.kind !== "measured" || point.sourceDataKeyPattern === null) {
      continue;
    }
    const result = templateSourceKey(point.sourceDataKeyPattern, vars, assetCode);
    if (result.outcome === "too_long" || (result.outcome !== "key" && point.required)) {
      return { pointKey: point.pointKey, result };
    }
  }
  return null;
}

/** {@link templateSourceKeyProblem} in words, with no closing full stop; `code` is already quoted. */
export function templateSourceKeyMessage(code: string, problem: TemplateSourceKeyProblem): string {
  const point = quoteCell(problem.pointKey);
  switch (problem.result.outcome) {
    case "unresolved":
      return `Template ${code} needs the variable ${quoteCell(problem.result.variable)} for its required point ${point}`;
    case "empty":
      return `Template ${code} resolves its required point ${point} to an empty source key; give its variables a value`;
    case "too_long":
      return (
        `Template ${code} resolves its point ${point} to a source key of ${problem.result.length} characters, ` +
        `over the ${SOURCE_DATA_KEY_MAX} limit`
      );
  }
}

/** Every version of `code` the organization holds, in any status, ascending (decision 6: "in any version"). */
export function heldVersions(ctx: ValidateTemplateContext, code: string): number[] {
  return ctx.organization
    .filter((candidate) => candidate.code === code && candidate.version !== null)
    .map((candidate) => candidate.version as number)
    .sort((a, b) => a - b);
}
