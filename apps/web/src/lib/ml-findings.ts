import type {
  MlFindingAsset,
  MlFindingFact,
  MlFindingsCard,
  MlFindingSegment,
  MlFindingsKind,
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

/**
 * A piece of a drawn sentence: plain text, or a named asset with its link (`null`: no link).
 * `E1.9g`: an asset draws its `code` as a chip, with the full `label` as its title.
 */
export type FindingPart =
  | { readonly text: string }
  | { readonly code: string; readonly label: string; readonly href: string | null };

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
    return asset ? { code: asset.code, label: asset.label, href: safeAssetHref(asset.href) } : { text: UNKNOWN_ASSET };
  });
}

/** `E1.9g` (Amendment 10 decision 2): at most this many key points under the headline. */
export const ML_SUMMARY_MAX_POINTS = 4;

/** `E1.9g` (plan 4.7): the compact control-room card shows the headline and at most this many. */
export const ML_SUMMARY_COMPACT_POINTS = 2;

/** One unit of the split: a character of a text part (by its part), or a whole asset part. */
type SplitUnit = { readonly part: number; readonly char: string } | { readonly part: number; readonly asset: FindingPart };

const SENTENCE_END = new Set([".", "!", "?"]);

/** What may start a sentence after a cut: an ASCII capital, a literal `[`, or an asset part. */
const startsSentence = (unit: SplitUnit | undefined): boolean =>
  unit !== undefined && ("asset" in unit || /^[A-Z[]$/.test(unit.char));

/** The units of one sentence put back into parts: consecutive characters of a part join again. */
function partsOf(units: readonly SplitUnit[]): FindingPart[] {
  const out: FindingPart[] = [];
  let text = "";
  let from = -1;
  const flush = () => {
    if (text !== "") out.push({ text });
    text = "";
  };
  for (const unit of units) {
    if ("asset" in unit) {
      flush();
      out.push(unit.asset);
    } else {
      if (unit.part !== from) flush();
      text += unit.char;
    }
    from = unit.part;
  }
  flush();
  return out;
}

/**
 * `E1.9g` (ADR 0135 Amendment 10 decision 2; plan 4.3) — the AI paragraph's sentences, on screen
 * only (the stored text stays one paragraph). A cut follows a `.`, `!` or `?` in a text part when a
 * space comes next and, after the run of spaces, an ASCII capital, a `[` or an asset part; the
 * look-ahead crosses part boundaries. The spaces at a cut are dropped; nothing else is. An asset
 * part is one unit and is never scanned, so its code or label can never cause a cut.
 */
export function splitSentences(parts: readonly FindingPart[]): FindingPart[][] {
  const units: SplitUnit[] = [];
  parts.forEach((part, index) => {
    if ("text" in part) {
      for (const char of part.text) units.push({ part: index, char });
    } else {
      units.push({ part: index, asset: part });
    }
  });
  const sentences: FindingPart[][] = [];
  let start = 0;
  for (let at = 0; at < units.length; at += 1) {
    const unit = units[at] as SplitUnit;
    if ("asset" in unit || !SENTENCE_END.has(unit.char)) continue;
    let next = at + 1;
    while (next < units.length && (units[next] as { char?: string }).char === " ") next += 1;
    if (next === at + 1 || !startsSentence(units[next])) continue;
    sentences.push(partsOf(units.slice(start, at + 1)));
    start = next;
    at = next - 1;
  }
  sentences.push(partsOf(units.slice(start)));
  return sentences.filter((sentence) => sentence.length > 0);
}

/** The word "weak", whole and case-folded, in a sentence's text parts (asset parts are not read). */
const holdsWeak = (sentence: readonly FindingPart[]): boolean =>
  sentence.some((part) => "text" in part && /\bweak\b/i.test(part.text));

/**
 * `E1.9g` (plan 4.3) — the headline (sentence 1) and at most `maxPoints` points (the next ones).
 * OQ-1 (a), owner 2026-11-17: when no shown sentence holds the word "weak" but a hidden one does,
 * that sentence takes the last shown point slot, so the guard's Baseline-only word stays on screen.
 */
export function summaryOf(
  parts: readonly FindingPart[],
  maxPoints: number,
): { headline: FindingPart[]; points: FindingPart[][] } {
  const [headline = [], ...rest] = splitSentences(parts);
  let points = rest.slice(0, maxPoints);
  const hiddenWeak = rest.slice(maxPoints).find(holdsWeak);
  if (hiddenWeak !== undefined && points.length > 0 && !holdsWeak(headline) && !points.some(holdsWeak)) {
    points = [...points.slice(0, -1), hiddenWeak];
  }
  return { headline, points };
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

/** Decision 13: per kind, the strong line first, then the overview line, then the "none" line. */
const COMPACT_ORDER: Record<MlFindingsKind, readonly MlFindingFact["id"][]> = {
  anomalies: ["A2", "A1", "A_NONE"],
  forecasts: ["F5", "F1", "F_NONE"],
};

/**
 * `E1.9d` (plan T4.2, decision 13) — the compact card's lines when there is no paragraph: the A2
 * lines when present, else A1; the F5 lines when present, else F1. A card with neither keeps its
 * "none" sentence.
 */
export function compactLines(card: MlFindingsCard, kind: MlFindingsKind): MlFindingFact[] {
  for (const id of COMPACT_ORDER[kind]) {
    const lines = card.facts.filter((fact) => fact.id === id);
    if (lines.length > 0) {
      return lines;
    }
  }
  return [];
}

/** `E1.9d` (plan T4.2, decision 13) — the kind's page with the filter set: organization and location only. */
export function mlPageHref(kind: MlFindingsKind, scope: ScopeFilter): string {
  const query = new URLSearchParams();
  for (const key of ML_PAGE_FILTER_KEYS) {
    const value = scope[key];
    if (value) {
      query.set(key, value);
    }
  }
  const search = query.toString();
  return `/${kind}${search ? `?${search}` : ""}`;
}
