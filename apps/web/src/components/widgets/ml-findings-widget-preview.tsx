import type { WidgetStatus } from "../../lib/widget-catalog";
import { WidgetFrame } from "./widget-frame";

/** `E1.9f` (ADR 0135 Amendment 8 decision 13) — the widget's one advisory line, word for word. */
export const ML_FINDINGS_WIDGET_NOTE = "Advisory. Forecast and anomaly findings for this dashboard's scope.";

/**
 * `E1.9f` — the static draw of the `ml_findings` widget, for the dispatcher that has no dashboard
 * scope (`DashboardWidget`, the builder's canvas): the frame, its title and the advisory line. It
 * reads nothing; the live canvas branches to `MlFindingsWidgetLive` before it gets here.
 */
export function MlFindingsWidgetPreview({ title, status }: { title: string; status: WidgetStatus }) {
  return (
    <WidgetFrame title={title} status={status}>
      <p className="text-xs text-ink-muted">{ML_FINDINGS_WIDGET_NOTE}</p>
    </WidgetFrame>
  );
}
