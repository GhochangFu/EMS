import { ActiveAlarmsRailBody } from "../control-room/active-alarms-rail-body";
import { SITE_WIDGET_BODY_CLASS, type ActiveAlarmsRailConfig, type SiteWidgetCommon } from "./site-widget-parts";
import { WidgetFrame } from "./widget-frame";

/** The rail's own tab label; a frame title that only repeats it is a doubled heading. */
const TAB_LABEL = "active alarms";

/** `F3.73` (plan D9) — the rail of active alarms in the widget's tab scope. */
export function ActiveAlarmsRailWidget({
  title,
  status,
  data,
  severities,
  config,
}: SiteWidgetCommon & { config: ActiveAlarmsRailConfig }) {
  const counts = data?.alarms.summary ?? [];
  const body = (
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
  );
  // The tab strip already says "Active Alarms" (Impeccable critique, F3.73). A ready rail whose
  // title only repeats it drops the frame heading; the non-ready placeholder has no tab strip
  // and keeps its title, as does a rail the author renamed.
  if (status === "ready" && title.trim().toLowerCase() === TAB_LABEL) {
    return <div className="surface-raised flex h-full flex-col p-3">{body}</div>;
  }
  return (
    <WidgetFrame title={title} status={status}>
      {body}
    </WidgetFrame>
  );
}
