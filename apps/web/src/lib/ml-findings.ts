import type {
  MlFindingAsset,
  MlFindingFact,
  MlFindingsCard,
  MlFindingSegment,
  MlFindingsParagraphResponse,
  MlFindingsSummaryResponse,
} from "@bms/shared/contracts";

import { FORECAST_REFETCH_MS } from "./forecast-series";
import { SCOPE_FILTER_KEYS, type ScopeFilter, type ScopeFilterKey } from "./scope-filter";

/**
 * `E1.9b` (ADR 0135 Amendment 8 decisions 8 and 14; plan T2.2) — the pure helpers behind the
 * "Findings — advisory" card and the ML pages' filter. A card's sentences arrive as segments; an
 * asset reference is put back from the card's own asset list, and its `href` is drawn as a link
 * only when it is the asset history page (R-g). The browser never builds a link from text.
 */

/** Decision 8: the pickers of `/forecasts` and `/anomalies`, and the only keys their reads send. */
export const ML_PAGE_FILTER_KEYS: readonly ScopeFilterKey[] = ["organizationId", "locationId"];

/** The keys of `filter` named in `keys` that are set; every other key is dropped. */
export function pickScope(filter: ScopeFilter, keys: readonly ScopeFilterKey[]): ScopeFilter {
  const out: { -readonly [K in ScopeFilterKey]?: string } = {};
  for (const key of keys) {
    const value = filter[key];
    if (value) {
      out[key] = value;
    }
  }
  return out;
}

/** One stable string per scope, for a query key: the four keys in their fixed order. */
export function scopeKey(scope: ScopeFilter): string {
  return SCOPE_FILTER_KEYS.map((key) => `${key}=${scope[key] ?? ""}`).join("&");
}

/**
 * Exactly the shape the shared builders emit: `/asset-history/<uuid>`, optionally a query with no
 * `#` or `\`. No dot segment, no second path segment, no other host.
 */
const SAFE_HISTORY_HREF = /^\/asset-history\/[0-9a-f-]{36}(\?[^#\\]*)?$/i;

/** The `href` when it is exactly an asset history link the builders make, else `null`. */
export function safeAssetHref(href: string): string | null {
  return SAFE_HISTORY_HREF.test(href) ? href : null;
}

/** A piece of a drawn sentence: plain text, or a named asset with its link (`null`: no link). */
export type FindingPart = { readonly text: string } | { readonly label: string; readonly href: string | null };

/** Said in place of a reference the card's asset list does not hold. Never a link. */
const UNKNOWN_ASSET = "an asset";

/** The segments of one sentence with each asset reference put back from `assets`. */
export function resolveSegments(
  segments: readonly MlFindingSegment[],
  assets: readonly MlFindingAsset[],
): FindingPart[] {
  const byRef = new Map(assets.map((asset) => [asset.ref, asset]));
  return segments.map((segment) => {
    if ("text" in segment) {
      return { text: segment.text };
    }
    const asset = byRef.get(segment.assetRef);
    return asset ? { label: asset.label, href: safeAssetHref(asset.href) } : { text: UNKNOWN_ASSET };
  });
}

/** The title of an F5 line (a forecast crossing an alarm-rule limit). */
export const F5_TOOLTIP =
  "The alarm engine checks every reading. A forecast is an hourly average, so a short spike can raise an alarm the forecast does not show, and the reverse.";

/** R-n: the gap between two asks while a paragraph is still being written. */
export const PARAGRAPH_POLL_MS = 4_000;

/** R-n: at most this many asks again in a row; then the 15-minute refetch. */
export const PARAGRAPH_MAX_POLLS = 6;

/**
 * `E1.9d` (plan T4.2, R-n) — the paragraph read's next refetch. `polls` is how many times it has
 * already asked again in a row while some card was `pending`. Bounded: never more than
 * `PARAGRAPH_MAX_POLLS` quick asks, then the ML cycle's own 15 minutes.
 */
export function paragraphPollMs(data: MlFindingsParagraphResponse | undefined, polls: number): number {
  const waiting = data?.cards.some((card) => card.state === "pending") ?? false;
  return waiting && polls < PARAGRAPH_MAX_POLLS ? PARAGRAPH_POLL_MS : FORECAST_REFETCH_MS;
}

/** The lines that say there is nothing to report. */
const NONE_FACTS: ReadonlySet<MlFindingFact["id"]> = new Set(["F_NONE", "A_NONE"]);

/** R-m: a card holds something to write about — any fact other than a "none" sentence. */
export function isParagraphWorthy(card: MlFindingsCard): boolean {
  return card.facts.some((fact) => !NONE_FACTS.has(fact.id));
}

/** Plan T4.3: the paragraph is asked for only when some card of the summary has findings. */
export function hasParagraphWorthyCard(summary: MlFindingsSummaryResponse | undefined): boolean {
  return summary?.cards.some(isParagraphWorthy) ?? false;
}
