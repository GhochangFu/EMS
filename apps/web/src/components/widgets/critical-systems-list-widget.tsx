import { Link } from "react-router-dom";

import { FOCUS_OUTLINE_CLASS } from "../../lib/focus-classes";

import {
  SITE_WIDGET_BODY_CLASS,
  tabCountsText,
  TabStatusPill,
  type SiteTabHref,
  type SiteWidgetCommon,
} from "./site-widget-parts";
import { WidgetFrame } from "./widget-frame";

/**
 * `F3.73` (plan D9) — one row per group tab: its name, status pill and counts; "Outside scope"
 * for an unreadable tab. The name is text; an `Open` link follows each row's status when `tabHref`
 * builds one (`F3.77`, ADR 0087 Amendment 3, plan D3). The list is named by the widget's title.
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
          <ul className="space-y-2" aria-label={title}>
            {tabs.map((tab) => (
              <li key={tab.tabKey} className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-ink">{tab.label}</span>
                <span className="flex items-center gap-2">
                  {tab.status !== null ? (
                    <>
                      <span className="text-ink-muted">{tabCountsText(tab.status)}</span>
                      <TabStatusPill status={tab.status} severities={severities} />
                    </>
                  ) : (
                    <span className="text-ink-muted">Outside scope</span>
                  )}
                  {tabHref !== null ? (
                    <Link
                      className={`rounded font-semibold text-accent-strong hover:underline ${FOCUS_OUTLINE_CLASS}`}
                      to={tabHref(tab.tabKey)}
                      aria-label={`Open ${tab.label}`}
                    >
                      Open
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </WidgetFrame>
  );
}
