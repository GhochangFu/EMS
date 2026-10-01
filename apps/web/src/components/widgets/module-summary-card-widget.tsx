import { Link } from "react-router-dom";

import {
  SITE_WIDGET_BODY_CLASS,
  siteTabHref,
  tabCountsText,
  TabStatusPill,
  type ModuleSummaryCardConfig,
  type SiteWidgetCommon,
} from "./site-widget-parts";
import { WidgetFrame } from "./widget-frame";

/**
 * `F3.73` (plan D9) — one domain tab's card: status pill and "n alarms · m offline · k assets",
 * linking to the tab the config names. `sitePath` is the site page's own path
 * (`/control-room/site/:locationId`), or null off the site page — a dashboard viewed elsewhere has
 * no tab to link to, so the card is not a link. A tab the read does not list, or whose members
 * the caller cannot read, says "Outside scope".
 */
export function ModuleSummaryCardWidget({
  title,
  status,
  data,
  severities,
  config,
  sitePath,
}: SiteWidgetCommon & { config: ModuleSummaryCardConfig; sitePath: string | null }) {
  const tab = data?.tabs.find((candidate) => candidate.tabKey === config.targetTabKey);
  const tabStatus = tab?.status ?? null;
  const label = tab?.label ?? config.targetTabKey;
  return (
    <WidgetFrame title={title} status={status}>
      <div className={SITE_WIDGET_BODY_CLASS}>
        <div className="space-y-2">
          {tabStatus !== null ? (
            <>
              <TabStatusPill status={tabStatus} severities={severities} />
              <p className="text-xs text-ink">{tabCountsText(tabStatus)}</p>
            </>
          ) : (
            <p className="text-xs text-ink-muted">Outside scope</p>
          )}
          {sitePath !== null ? (
            <Link
              className="text-xs font-semibold text-accent-strong hover:underline"
              to={siteTabHref(sitePath, config.targetTabKey)}
            >
              Open {label}
            </Link>
          ) : null}
        </div>
      </div>
    </WidgetFrame>
  );
}
