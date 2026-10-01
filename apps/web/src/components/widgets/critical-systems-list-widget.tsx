import { Link } from "react-router-dom";

import {
  SITE_WIDGET_BODY_CLASS,
  tabCountsText,
  TabStatusPill,
  type SiteTabHref,
  type SiteWidgetCommon,
} from "./site-widget-parts";
import { WidgetFrame } from "./widget-frame";
import { TAB_FOCUS_CLASS } from "../dashboards/dashboard-tab-strip";

/**
 * `F3.73` (plan D9) — one row per group tab: its name, status pill and counts; "Outside scope"
 * for an unreadable tab. Each name links to its tab through `tabHref`, when there is one.
 */
export function CriticalSystemsListWidget({
  title,
  status,
  data,
  severities,
  tabHref,
}: SiteWidgetCommon & { tabHref: SiteTabHref | null }) {
  const tabs = data?.tabs ?? [];
  return (
    <WidgetFrame title={title} status={status}>
      <div className={SITE_WIDGET_BODY_CLASS}>
        {tabs.length === 0 ? (
          <p className="text-xs text-ink-muted">No system tabs</p>
        ) : (
          <ul className="space-y-2" aria-label="Critical systems">
            {tabs.map((tab) => (
              <li key={tab.tabKey} className="flex items-center justify-between gap-3 text-xs">
                {tabHref !== null ? (
                  <Link className={`rounded font-medium text-ink hover:underline ${TAB_FOCUS_CLASS}`} to={tabHref(tab.tabKey)}>
                    {tab.label}
                  </Link>
                ) : (
                  <span className="font-medium text-ink">{tab.label}</span>
                )}
                {tab.status !== null ? (
                  <span className="flex items-center gap-2">
                    <span className="text-ink-muted">{tabCountsText(tab.status)}</span>
                    <TabStatusPill status={tab.status} severities={severities} />
                  </span>
                ) : (
                  <span className="text-ink-muted">Outside scope</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </WidgetFrame>
  );
}
