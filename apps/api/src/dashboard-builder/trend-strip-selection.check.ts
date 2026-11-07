import { BadRequestException } from "@nestjs/common";

import type { TrendPointSegmentDto, WidgetWriteBody } from "@bms/shared";

/**
 * `F4.306` / ADR 0108 Amendment 7 — the write-path check of a `trend_strip` widget's selection
 * (`segments`, `points`, `colors`, and since `F4.323` `styles`) against the organization's effective trend-point lists
 * (`TrendPointsService.effective(organizationId, {})`, the `F4.300` lists the strip route reads).
 *
 * The config schema admits the three fields without a refinement (the arm must stay a plain
 * `ZodObject`), so the rules that need the lists, and the two that need the whole widget (a
 * repeat, a `colors` key outside `points`), live here. Every refusal names the widget index and
 * the field index only, never a code: a stored code is the caller's, and an answer that echoed a
 * code not on the lists would say which codes are.
 *
 * Pure over the lists: the caller reads them only when {@link hasTrendStripSelection} holds for
 * some widget, so a save without a selection runs no extra statement, and this function does not
 * touch `lists` unless a widget has a selection.
 */

export const trendStripPointsNeedSegmentsMessage = (widget: number): string =>
  `widgets[${widget}].config.points requires segments`;

export const trendStripNoSiteMessage = (widget: number): string =>
  `widgets[${widget}].config selects trend points, but the dashboard has no site`;

export const trendStripSegmentRepeatMessage = (widget: number, index: number): string =>
  `widgets[${widget}].config.segments[${index}] repeats an earlier entry`;

export const trendStripSegmentNoListMessage = (widget: number, index: number): string =>
  `widgets[${widget}].config.segments[${index}] has no trend-point list`;

export const trendStripPointRepeatMessage = (widget: number, index: number): string =>
  `widgets[${widget}].config.points[${index}] repeats an earlier entry`;

export const trendStripPointSegmentMessage = (widget: number, index: number): string =>
  `widgets[${widget}].config.points[${index}] is not in a chosen segment`;

export const trendStripPointOffListMessage = (widget: number, index: number): string =>
  `widgets[${widget}].config.points[${index}] is not on its segment's trend-point list`;

export const trendStripColorKeyMessage = (widget: number, index: number): string =>
  `widgets[${widget}].config.colors key ${index} is not in points`;

/** `F4.323` PR 3 / ADR 0108 Amendment 8 — the `colors` rule, for `styles`. */
export const trendStripStyleKeyMessage = (widget: number, index: number): string =>
  `widgets[${widget}].config.styles key ${index} is not in points`;

type TrendStripConfig = Extract<WidgetWriteBody, { widgetType: "trend_strip" }>["config"];

function selectionOf(widget: WidgetWriteBody): TrendStripConfig | null {
  if (widget.widgetType !== "trend_strip") return null;
  const { segments, points, colors, styles } = widget.config;
  return segments === undefined && points === undefined && colors === undefined && styles === undefined
    ? null
    : widget.config;
}

/** True when the widget is a `trend_strip` that carries any selection field (`styles` since `F4.323`). */
export function hasTrendStripSelection(widget: WidgetWriteBody): boolean {
  return selectionOf(widget) !== null;
}

/** The index of the first entry that repeats an earlier one, or -1. */
function firstRepeat(entries: readonly string[]): number {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry)) return index;
    seen.add(entry);
  }
  return -1;
}

/** Throws a 400 for the first trend strip selection that the effective trend-point lists refuse. */
export function assertTrendStripSelections(
  lists: readonly TrendPointSegmentDto[],
  dashboard: { readonly locationId: string | null },
  widgets: readonly WidgetWriteBody[],
): void {
  let byDomain: Map<string, ReadonlySet<string>> | null = null;
  const listFor = (domain: string): ReadonlySet<string> | undefined => {
    byDomain ??= new Map(lists.map((segment) => [segment.domain, new Set(segment.points.map((p) => p.code))]));
    return byDomain.get(domain);
  };

  for (const [w, widget] of widgets.entries()) {
    const config = selectionOf(widget);
    if (config === null) continue;
    if (dashboard.locationId === null) throw new BadRequestException(trendStripNoSiteMessage(w));

    const segments = config.segments ?? [];
    const points = config.points ?? [];
    if (config.segments === undefined && config.points !== undefined) {
      throw new BadRequestException(trendStripPointsNeedSegmentsMessage(w));
    }

    const segmentRepeat = firstRepeat(segments);
    if (segmentRepeat >= 0) throw new BadRequestException(trendStripSegmentRepeatMessage(w, segmentRepeat));
    for (const [index, segment] of segments.entries()) {
      if (listFor(segment) === undefined) throw new BadRequestException(trendStripSegmentNoListMessage(w, index));
    }

    const pointRepeat = firstRepeat(points);
    if (pointRepeat >= 0) throw new BadRequestException(trendStripPointRepeatMessage(w, pointRepeat));
    const chosen = new Set(segments);
    for (const [index, entry] of points.entries()) {
      // The config pattern holds exactly one `:` (a catalog code has none).
      const at = entry.indexOf(":");
      const domain = entry.slice(0, at);
      if (!chosen.has(domain)) throw new BadRequestException(trendStripPointSegmentMessage(w, index));
      if (!listFor(domain)?.has(entry.slice(at + 1))) {
        throw new BadRequestException(trendStripPointOffListMessage(w, index));
      }
    }

    const selected = new Set(points);
    for (const [index, key] of Object.keys(config.colors ?? {}).entries()) {
      if (!selected.has(key)) throw new BadRequestException(trendStripColorKeyMessage(w, index));
    }
    for (const [index, key] of Object.keys(config.styles ?? {}).entries()) {
      if (!selected.has(key)) throw new BadRequestException(trendStripStyleKeyMessage(w, index));
    }
  }
}
