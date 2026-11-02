import type { WidgetStatus } from "../../lib/widget-catalog";
import { WidgetFrame } from "./widget-frame";

/** The static draw (no live binding): the strip reads only on a live dashboard. */
export const TREND_STRIP_STATIC_SENTENCE = "Trends of the site's key points draw on the live dashboard.";

/**
 * `F4.305` U4 — the static draw of the `trend_strip` widget, for the dispatcher that has no site and
 * no tabs (`DashboardWidget`): the frame, its non-ready states, and one fixed sentence. It reads
 * nothing. Its own file since the `F4.305` review (AGENTS.md §4.2, one exported component per file).
 */
export function TrendStripWidgetPreview({ title, status }: { title: string; status: WidgetStatus }) {
  return (
    <WidgetFrame title={title} status={status}>
      <p className="text-xs text-ink-muted">{TREND_STRIP_STATIC_SENTENCE}</p>
    </WidgetFrame>
  );
}
