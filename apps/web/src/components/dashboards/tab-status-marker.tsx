import type { SiteWidgetTab } from "@bms/shared";

import { OUTSIDE_SCOPE_TEXT, tabAlarmsText } from "../widgets/site-widget-parts";

/** The dot's colour per tab tone — the `StatusPill` ink, so the marker and the pill agree. */
const DOT_TONE_CLASS: Record<NonNullable<SiteWidgetTab["status"]>["tone"], string> = {
  critical: "text-critical-ink-strong",
  warning: "text-warning-ink",
  offline: "text-neutral-ink",
  info: "text-info-ink",
  ok: "text-ok-ink",
};

/**
 * `F3.77` (plan D4, ADR 0087 Amendment 3 ruling 5) — the status marker on a group tab in the site
 * view, the viewer and the builder: a dot in the tab's tone plus text, never colour alone. The text
 * is the active alarm count ("2 alarms", "1 alarm"), or "Outside scope" when the caller can read
 * none of the tab's members (`status` null) — never a zero that would read as healthy. The dot is
 * decoration (`aria-hidden`); the host names the whole tab with `tabAccessibleName`.
 *
 * The host draws a marker only for a tab the site-widgets read lists in `tabs[]`, so the Overview
 * (no group) and a tab with no group draw none.
 */
export function TabStatusMarker({ status }: { status: SiteWidgetTab["status"] }) {
  return (
    <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted">
      <span
        aria-hidden="true"
        data-tab-marker-dot
        className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${status === null ? "text-ink-muted" : DOT_TONE_CLASS[status.tone]}`}
      />
      {status === null ? OUTSIDE_SCOPE_TEXT : tabAlarmsText(status.activeAlarms)}
    </span>
  );
}
