import type { SiteTrendPointsDto } from "@bms/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchSiteTrendPoints } from "../../api/site-trend-points";
import type { WidgetConfigRow } from "../../lib/widget-config-form";

/** The stored selection fields (`stripStyles` since `F4.322`); an emptied one is `undefined`, never `[]` or `{}`. */
type Selection = Pick<WidgetConfigRow, "stripSegments" | "stripPoints" | "stripColors" | "stripStyles">;

type TrendStripSelectionSummaryProps = {
  /** The dashboard's site; `null` (no site) shows one sentence and reads nothing. */
  locationId: string | null;
  segments: Selection["stripSegments"];
  points: Selection["stripPoints"];
  colors: Selection["stripColors"];
  /** `F4.322` PR 3 — each point's draw style, dropped with its point. */
  styles?: Selection["stripStyles"];
  /** Receives every field, each `undefined` when emptied (the write schema's `.min(1)`). */
  onChange: (next: Selection) => void;
};

/** The marker on a stored code the site's effective list no longer holds. */
export const TREND_STRIP_STALE_MARKER = "Not on the site's list";

export const TREND_STRIP_SELECTION_NO_SITE_SENTENCE =
  "This dashboard has no site, so its trend strip selection cannot be checked.";

/** A list with no entry is absent: the stored config must never hold `[]`. */
function listOrUndefined(list: readonly string[]): string[] | undefined {
  return list.length > 0 ? [...list] : undefined;
}

/** The colours without the keys `drop` names; no entry left is absent. */
function coloursWithout(colors: Selection["stripColors"], drop: (key: string) => boolean): Selection["stripColors"] {
  if (colors === undefined) return undefined;
  const kept = Object.entries(colors).filter(([key]) => !drop(key));
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/** `F4.322` PR 3 — the styles without the keys `drop` names; no entry left is absent. */
function stylesWithout(styles: Selection["stripStyles"], drop: (key: string) => boolean): Selection["stripStyles"] {
  if (styles === undefined) return undefined;
  const kept = Object.entries(styles).filter(([key]) => !drop(key));
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/** `<segment>:<point code>` split at the first colon (each half is a catalog code, no colon). */
function splitKey(key: string): { domain: string; code: string } {
  const at = key.indexOf(":");
  return { domain: key.slice(0, at), code: key.slice(at + 1) };
}

/**
 * `F4.306` PR 2 U10 (ADR 0108 Amendment 7; owner OQ2, plan D3) — the builder's view of a
 * `trend_strip` row's stored selection. It reads the site's effective lists and marks an entry
 * they no longer hold — a segment the site does not list, or a point whose code is not on its
 * segment's list — with {@link TREND_STRIP_STALE_MARKER} and a Remove. A valid entry is edited
 * through the wizard, not here. A sibling of `widget-inspector.tsx` for its line cap; it names no
 * segment (ADR 0108 decision 5.4).
 */
export function TrendStripSelectionSummary({
  locationId,
  segments,
  points,
  colors,
  styles,
  onChange,
}: TrendStripSelectionSummaryProps) {
  const listsQ = useQuery({
    queryKey: ["control-room", "trend-points", locationId],
    queryFn: () => fetchSiteTrendPoints(locationId as string),
    enabled: locationId !== null && (segments !== undefined || points !== undefined),
  });
  const lists: SiteTrendPointsDto["segments"] | undefined = listsQ.data?.segments;
  const segmentOf = (domain: string) => lists?.find((segment) => segment.domain === domain);
  // Unknown until the lists arrive: nothing is marked from a read that has not answered.
  const segmentIsStale = (domain: string): boolean => lists !== undefined && segmentOf(domain) === undefined;
  const pointIsStale = (key: string): boolean => {
    if (lists === undefined) return false;
    const { domain, code } = splitKey(key);
    return !(segmentOf(domain)?.points.some((point) => point.code === code) ?? false);
  };

  function removePoint(key: string): void {
    onChange({
      stripSegments: segments,
      stripPoints: listOrUndefined((points ?? []).filter((entry) => entry !== key)),
      stripColors: coloursWithout(colors, (entry) => entry === key),
      stripStyles: stylesWithout(styles, (entry) => entry === key),
    });
  }

  function removeSegment(domain: string): void {
    const inSegment = (key: string): boolean => splitKey(key).domain === domain;
    onChange({
      stripSegments: listOrUndefined((segments ?? []).filter((entry) => entry !== domain)),
      stripPoints: listOrUndefined((points ?? []).filter((entry) => !inSegment(entry))),
      stripColors: coloursWithout(colors, inSegment),
      stripStyles: stylesWithout(styles, inSegment),
    });
  }

  const staleTail = (name: string, onRemove: () => void) => (
    <>
      <span className="text-[11px] text-critical-ink">{TREND_STRIP_STALE_MARKER}</span>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        className="surface-button px-2 py-0.5 text-[11px]"
      >
        Remove
      </button>
    </>
  );

  return (
    <section aria-label="Trend strip selection" className="grid gap-2 md:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-muted">Selection</span>
        <button
          type="button"
          onClick={() =>
            onChange({ stripSegments: undefined, stripPoints: undefined, stripColors: undefined, stripStyles: undefined })
          }
          className="surface-button px-2 py-1 text-[11px]"
        >
          Clear selection
        </button>
      </div>
      {locationId === null ? (
        <p className="text-xs text-ink-muted">{TREND_STRIP_SELECTION_NO_SITE_SENTENCE}</p>
      ) : (
        <>
          {listsQ.isError ? <p className="text-xs text-ink-muted">The site's trend-point lists could not be read.</p> : null}
          {segments !== undefined ? (
            <ul aria-label="Segments" className="grid gap-1 text-xs text-ink">
              {segments.map((domain) => (
                <li key={domain} className="flex flex-wrap items-center gap-2">
                  <span>{segmentOf(domain)?.label ?? domain}</span>
                  {segmentIsStale(domain) ? staleTail(domain, () => removeSegment(domain)) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {points !== undefined ? (
            <ul aria-label="Points" className="grid gap-1 text-xs text-ink">
              {points.map((key) => {
                const { domain, code } = splitKey(key);
                const name = segmentOf(domain)?.points.find((point) => point.code === code)?.name ?? key;
                return (
                  <li key={key} className="flex flex-wrap items-center gap-2">
                    <span>{name}</span>
                    <span className="text-ink-muted">{colors?.[key] ?? "Default"}</span>
                    {pointIsStale(key) ? staleTail(key, () => removePoint(key)) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
