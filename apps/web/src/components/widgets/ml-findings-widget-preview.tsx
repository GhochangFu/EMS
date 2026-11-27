import type { WidgetStatus } from "../../lib/widget-catalog";
import { WidgetFrame } from "./widget-frame";

/** `E1.9f` (ADR 0135 Amendment 8 decision 13) — the widget's one advisory line, word for word. */
export const ML_FINDINGS_WIDGET_NOTE = "Advisory. Forecast and anomaly findings for this dashboard's scope.";

/**
 * `E1.9f` — the static draw of the `ml_findings` widget: the frame, its title and the advisory
 * line, reading nothing. It exists so `DashboardWidget`'s switch stays exhaustive over the widget
 * types; no production path reaches that arm, because the live canvas branches to
 * `MlFindingsWidgetLive` first (`DashboardWidgetLive`). It is not the builder's canvas.
 */
export function MlFindingsWidgetPreview({ title, status }: { title: string; status: WidgetStatus }) {
  return (
    <WidgetFrame title={title} status={status}>
      <p className="text-xs text-ink-muted">{ML_FINDINGS_WIDGET_NOTE}</p>
    </WidgetFrame>
  );
}
