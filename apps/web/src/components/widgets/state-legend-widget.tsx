import type { WidgetStatus } from "../../lib/widget-catalog";
import { StateLegend } from "../control-room/state-legend";
import { SITE_WIDGET_BODY_CLASS } from "./site-widget-parts";
import { WidgetFrame } from "./widget-frame";

/**
 * `F3.73` (plan D9) — the severity and state legend. It reads the vocabulary itself, so the
 * site-widgets read adds nothing to it.
 */
export function StateLegendWidget({ title, status }: { title: string; status: WidgetStatus }) {
  return (
    <WidgetFrame title={title} status={status}>
      <div className={SITE_WIDGET_BODY_CLASS}>
        <StateLegend />
      </div>
    </WidgetFrame>
  );
}
