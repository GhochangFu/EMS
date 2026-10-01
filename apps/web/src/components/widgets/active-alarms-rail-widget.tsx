import { ActiveAlarmsRailBody } from "../control-room/active-alarms-rail-body";
import { SITE_WIDGET_BODY_CLASS, type ActiveAlarmsRailConfig, type SiteWidgetCommon } from "./site-widget-parts";
import { WidgetFrame } from "./widget-frame";

/** `F3.73` (plan D9) — the rail of active alarms in the widget's tab scope. */
export function ActiveAlarmsRailWidget({
  title,
  status,
  data,
  severities,
  config,
}: SiteWidgetCommon & { config: ActiveAlarmsRailConfig }) {
  const counts = data?.alarms.summary ?? [];
  return (
    <WidgetFrame title={title} status={status}>
      <div className={SITE_WIDGET_BODY_CLASS}>
        <ActiveAlarmsRailBody
          active={{ status: "ready", items: data?.alarms.active ?? [] }}
          summary={{ status: "ready", items: counts }}
          total={counts.reduce((sum, row) => sum + row.count, 0)}
          severities={severities}
          noIdsNote={null}
          rowBudget={config.rows}
          showSummary={config.showSummary}
        />
      </div>
    </WidgetFrame>
  );
}
