import type { MlFindingAsset, MlFindingSegment } from "@bms/shared/contracts";

import { SCOPE_FILTER_KEYS, type ScopeFilter, type ScopeFilterKey } from "./scope-filter";

/**
 * `E1.9b` (ADR 0135 Amendment 8 decisions 8 and 14; plan T2.2) — the pure helpers behind the
 * "Findings — advisory" card and the ML pages' filter. A card's sentences arrive as segments; an
 * asset reference is put back from the card's own asset list, and its `href` is drawn as a link
 * only when it is the asset history page (R-g). The browser never builds a link from text.
 */

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

const HISTORY_PREFIX = "/asset-history/";

/** The `href` when it is an asset history path with no `//` after its first character, else `null`. */
export function safeAssetHref(href: string): string | null {
  return href.startsWith(HISTORY_PREFIX) && !href.slice(1).includes("//") ? href : null;
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
