/**
 * Suggested formulas (`F4.314` PR 2, ADR 0038 Amendment 6 decision A3).
 *
 * For the point key an author is writing a formula for, the derived points of
 * that key that already exist: the stock catalog's
 * (`GET /admin/asset-templates/stock`) and the organization's published
 * versions of the asset's domain (`GET /admin/asset-templates?status=published`
 * read without `organizationId` — passing it is a 403 for a caller who cannot
 * manage the organization — filtered here, then `GET /:id` per version for its
 * points). Each carries where it comes from, the formula, its dialect and
 * timing (ruling 6), and the local inputs the asset does not have.
 *
 * Pure, and here rather than in the component, because the coverage gate
 * reaches `src/lib/**` and nothing above it. Imports no CodeMirror (decision
 * A4). Taking a suggestion goes through each surface's own setters —
 * {@link suggestionRow} for the Calculations tab's row, {@link suggestionDraft}
 * for the text draft `PointCalcFormulaFields` edits — so the dialect-change
 * rules still run.
 */
import { CALC_DIALECT, isCrossAssetDialect } from "@bms/shared";
import type {
  AdminAssetTemplateDto,
  AdminAssetTemplateSummaryDto,
  CalcDialect,
  CalcTrigger,
  StockAssetTemplateDto,
} from "@bms/shared";

import { draftFromFields, type OverrideDraft } from "./asset-point-calc-override";
import { previewInputKeys } from "./calc-preview";
import { setCalcTrigger, setFormulaDialect } from "./template-calc-config";
import type { TemplatePointRow } from "./template-points-grid";

/** One existing formula for the chosen key, with what taking it fills. */
export type FormulaSuggestion = {
  readonly formula: string;
  readonly formulaDialect: CalcDialect;
  /** Where it comes from: `Stock · <entry name>` or `Template · <code> v<version>`. */
  readonly from: string;
  readonly calcTrigger: CalcTrigger | null;
  readonly calcIntervalSeconds: number | null;
  readonly maxInputAgeSeconds: number | null;
  /** The formula's local `{key}` inputs the asset does not have; always empty with no asset keys. */
  readonly missingInputs: readonly string[];
};

/** The sources and the asset the suggestions are for. */
export type SuggestionSources = {
  readonly stock: readonly StockAssetTemplateDto[];
  /** Full versions (with points), already chosen by {@link suggestionTemplateIds}. */
  readonly templates: readonly AdminAssetTemplateDto[];
  /** The asset's point keys, or `null` where there is no single asset (the bulk wizard). */
  readonly assetKeys: readonly string[] | null;
  /** The Calculations tab's own version. */
  readonly excludeTemplateId?: string | null;
  /** The override's template point: the version that declares it is the asset's own. */
  readonly excludeTemplatePointId?: string | null;
};

/** Which versions to read: the organization's published versions of the domain. */
export type SuggestionScope = {
  readonly organizationCode: string | null;
  readonly domain: string | null;
  readonly excludeTemplateId?: string | null;
};

type SourcePoint = {
  readonly pointKey: string;
  readonly kind: string;
  readonly formula: string | null;
  readonly formulaDialect: CalcDialect | null;
  readonly calcTrigger: CalcTrigger | null;
  readonly calcIntervalSeconds: number | null;
  readonly maxInputAgeSeconds: number | null;
};

/**
 * The list rows whose points are worth a `GET /:id`: published (a draft or
 * archived formula is never offered), the organization's, the domain's, and
 * not the excluded version. No organization or no domain (`null`) matches no row.
 */
export function suggestionTemplateIds(
  rows: readonly AdminAssetTemplateSummaryDto[],
  scope: SuggestionScope,
): string[] {
  return rows
    .filter(
      (row) =>
        row.status === "published" &&
        row.organizationCode === scope.organizationCode &&
        row.domain === scope.domain &&
        row.id !== scope.excludeTemplateId,
    )
    .map((row) => row.id);
}

/**
 * The suggestions for `pointKey`: every derived point of that key with a
 * formula, stock first, de-duplicated by formula and dialect (the first
 * source's label kept), those the asset can run first, then by source.
 */
export function suggestedFormulas(pointKey: string, sources: SuggestionSources): FormulaSuggestion[] {
  const candidates: { from: string; point: SourcePoint }[] = [
    ...sources.stock.flatMap((entry) => entry.points.map((point) => ({ from: `Stock · ${entry.name}`, point }))),
    ...sources.templates
      .filter(
        (template) =>
          template.status === "published" &&
          template.id !== sources.excludeTemplateId &&
          !template.points.some((point) => point.id === sources.excludeTemplatePointId),
      )
      .flatMap((template) =>
        template.points.map((point) => ({ from: `Template · ${template.code} v${template.version}`, point })),
      ),
  ];
  const have = sources.assetKeys === null ? null : new Set(sources.assetKeys);
  const seen = new Set<string>();
  const found: FormulaSuggestion[] = [];
  for (const { from, point } of candidates) {
    if (point.kind !== "derived" || point.pointKey !== pointKey || point.formula === null) {
      continue;
    }
    const formulaDialect = point.formulaDialect ?? CALC_DIALECT;
    const identity = `${formulaDialect}\u0000${point.formula}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    found.push({
      formula: point.formula,
      formulaDialect,
      from,
      calcTrigger: point.calcTrigger,
      calcIntervalSeconds: point.calcIntervalSeconds,
      maxInputAgeSeconds: point.maxInputAgeSeconds,
      missingInputs:
        have === null ? [] : previewInputKeys(point.formula, formulaDialect).filter((key) => !have.has(key)),
    });
  }
  return found.sort(
    (a, b) =>
      Number(a.missingInputs.length > 0) - Number(b.missingInputs.length > 0) || a.from.localeCompare(b.from),
  );
}

/**
 * The trigger a suggestion lands with: a cross-asset formula runs on a
 * schedule only (ADR 0055 decision 10), the rule `setFormulaDialect` applies
 * on a dialect change, held here too for a row already on that dialect.
 */
function takenTrigger(suggestion: FormulaSuggestion): CalcTrigger | null {
  return isCrossAssetDialect(suggestion.formulaDialect) && suggestion.calcTrigger === "streaming"
    ? "scheduled"
    : suggestion.calcTrigger;
}

/**
 * The Calculations tab's row after taking a suggestion: formula and timing,
 * then the trigger through `setCalcTrigger` (streaming clears the interval)
 * and the dialect through `setFormulaDialect` (to `v1` clears the ratio).
 */
export function suggestionRow(row: TemplatePointRow, suggestion: FormulaSuggestion): TemplatePointRow {
  const timed: TemplatePointRow = {
    ...row,
    formula: suggestion.formula,
    calcIntervalSeconds: suggestion.calcIntervalSeconds,
    maxInputAgeSeconds: suggestion.maxInputAgeSeconds,
  };
  const trigger = takenTrigger(suggestion);
  const triggered = trigger === null ? { ...timed, calcTrigger: null } : setCalcTrigger(timed, trigger);
  return setFormulaDialect(triggered, suggestion.formulaDialect);
}

/**
 * The text draft's five calc fields after taking a suggestion, for
 * `PointCalcFormulaFields`' `onDraftChange` to merge over the draft (the
 * key and the backfill choice are the draft's own and stay).
 */
export function suggestionDraft(suggestion: FormulaSuggestion): OverrideDraft {
  return draftFromFields({
    formula: suggestion.formula,
    formulaDialect: suggestion.formulaDialect,
    calcTrigger: takenTrigger(suggestion),
    calcIntervalSeconds: suggestion.calcIntervalSeconds,
    maxInputAgeSeconds: suggestion.maxInputAgeSeconds,
  });
}
