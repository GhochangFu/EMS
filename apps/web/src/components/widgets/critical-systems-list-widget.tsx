import { Link } from "react-router-dom";

import {
  SITE_WIDGET_BODY_CLASS,
  siteTabHref,
  tabCountsText,
  TabStatusPill,
  type SiteWidgetCommon,
} from "./site-widget-parts";
import { WidgetFrame } from "./widget-frame";

/**
 * `F3.73` (plan D9) — one row per group tab: its name, status pill and counts; "Outside scope"
 * for an unreadable tab. Each name links to its tab under `sitePath`, when there is one.
 */
export function CriticalSystemsListWidget({
  title,
  status,
  data,
  severities,
  sitePath,
}: SiteWidgetCommon & { sitePath: string | null }) {
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
                {sitePath !== null ? (
                  <Link className="font-medium text-ink hover:underline" to={siteTabHref(sitePath, tab.tabKey)}>
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
