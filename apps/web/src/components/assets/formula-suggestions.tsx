/**
 * The Suggested formulas section (`F4.314` PR 2, ADR 0038 Amendment 6
 * decision A3).
 *
 * For the chosen point key, a collapsed `<details>` listing the derived points
 * of that key in the stock catalog and in the organization's published
 * versions of the asset's domain, each with where it comes from, its formula
 * and dialect, and the inputs the asset does not have. **Use this formula**
 * hands the suggestion — formula, dialect and timing (ruling 6) — to
 * `onTake`, which each surface applies through its own draft setters.
 *
 * Three reads, all existing routes (decision A5), under the query keys the
 * template pages already use so the caches are shared:
 * `["admin", "asset-templates", "stock"]`, `["admin", "asset-templates",
 * "published"]` — read **without** `organizationId`, which is a 403 for a
 * caller who cannot manage the organization, and filtered in
 * `suggestionTemplateIds` — and `["admin", "asset-template", id]` per chosen
 * version. **A failed read renders nothing:** the section is an offer, never a
 * blocker, so a 403 on the list still lists the stock entries, and nothing at
 * all renders when no read answers.
 *
 * Presentation only; the rules are `lib/formula-suggestions.ts`. Imports no
 * CodeMirror (decision A4, `tests/adr-0038-formula-editor.test.ts`).
 */
import { useQueries, useQuery } from "@tanstack/react-query";

import {
  fetchAdminAssetTemplate,
  fetchAdminAssetTemplates,
  fetchAdminStockAssetTemplates,
} from "../../api/admin/asset-templates";
import { suggestedFormulas, suggestionTemplateIds, type FormulaSuggestion } from "../../lib/formula-suggestions";

type Props = {
  /** The key the formula is for; `""` before one is chosen renders nothing. */
  pointKey: string;
  /** The organization whose published versions are read; `null` reads the stock catalog only. */
  organizationCode: string | null;
  /** The asset's domain; `null` (the bulk wizard's mixed selection) reads the stock catalog only. */
  domain: string | null;
  /** The asset's point keys, for the missing-input mark; `null` marks nothing (the bulk wizard). */
  assetKeys: readonly string[] | null;
  /** The Calculations tab's own version. */
  excludeTemplateId?: string | null;
  /** The override's template point: the version declaring it is not offered. */
  excludeTemplatePointId?: string | null;
  /** Whose keys `assetKeys` are, for the missing-input sentence: `"this asset"` unless the tab says `"this template"`. */
  keysOf?: string;
  /** A frozen version or a pending save: every **Use this formula** is disabled (decision A6). */
  disabled: boolean;
  /** `F4.315` C3: why it is disabled, shown under the list while `disabled`; none says nothing. */
  disabledReason?: string;
  onTake: (suggestion: FormulaSuggestion) => void;
};

/** The collapsed Suggested formulas for a key; **Use this formula** hands one to `onTake`. */
export function FormulaSuggestions({
  pointKey,
  organizationCode,
  domain,
  assetKeys,
  excludeTemplateId = null,
  excludeTemplatePointId = null,
  keysOf = "this asset",
  disabled,
  disabledReason,
  onTake,
}: Props) {
  const wanted = pointKey !== "";
  // The catalog is repository data: it changes with a deploy, not a session.
  const stockQ = useQuery({
    queryKey: ["admin", "asset-templates", "stock"],
    queryFn: fetchAdminStockAssetTemplates,
    staleTime: Infinity,
    enabled: wanted,
  });
  const listQ = useQuery({
    queryKey: ["admin", "asset-templates", "published"],
    queryFn: () => fetchAdminAssetTemplates("published"),
    enabled: wanted && organizationCode !== null && domain !== null,
  });
  const ids = suggestionTemplateIds(listQ.data?.items ?? [], { organizationCode, domain, excludeTemplateId });
  const versionQs = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["admin", "asset-template", id],
      queryFn: () => fetchAdminAssetTemplate(id),
      // A warm list cache (another page read it) must not read versions for no key.
      enabled: wanted,
    })),
  });
  const suggestions = wanted
    ? suggestedFormulas(pointKey, {
        stock: stockQ.data?.items ?? [],
        templates: versionQs.flatMap((query) => (query.data ? [query.data] : [])),
        assetKeys,
        excludeTemplateId,
        excludeTemplatePointId,
      })
    : [];
  if (suggestions.length === 0) {
    return null;
  }
  return (
    <details className="mt-1 text-[11px] text-ink-muted sm:col-span-2">
      <summary className="cursor-pointer select-none font-semibold">
        Suggested formulas for <code>{`{${pointKey}}`}</code>
      </summary>
      <ul aria-label={`Suggested formulas for ${pointKey}`} className="mt-1 space-y-1">
        {suggestions.map((suggestion) => (
          <li key={`${suggestion.formulaDialect} ${suggestion.formula}`} className="space-y-0.5">
            <p>
              <span className="font-semibold">{suggestion.from}</span> ·{" "}
              <span className="font-mono">{suggestion.formulaDialect}</span>
            </p>
            <code className="block rounded bg-well-deep px-1 font-mono text-ink">{suggestion.formula}</code>
            {suggestion.missingInputs.length > 0 ? (
              <p className="text-warning-ink">
                needs {suggestion.missingInputs.map((key) => `{${key}}`).join(", ")}, which {keysOf} does not have
              </p>
            ) : null}
            <button
              type="button"
              aria-label={`Use this formula from ${suggestion.from}`}
              disabled={disabled}
              onClick={() => onTake(suggestion)}
              className="surface-button px-2 py-0.5 text-[11px] disabled:opacity-60"
            >
              Use this formula
            </button>
          </li>
        ))}
      </ul>
      {disabled && disabledReason ? <p className="mt-1">{disabledReason}</p> : null}
    </details>
  );
}
