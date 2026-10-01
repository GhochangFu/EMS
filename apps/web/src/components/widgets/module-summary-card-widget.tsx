import { Link } from "react-router-dom";

import { FOCUS_OUTLINE_CLASS } from "../../lib/focus-classes";

import {
  SITE_WIDGET_BODY_CLASS,
  tabCountsText,
  TabStatusPill,
  type ModuleSummaryCardConfig,
  type SiteTabHref,
  type SiteWidgetCommon,
} from "./site-widget-parts";
import { WidgetFrame } from "./widget-frame";

/**
 * `F3.73` (plan D9) — one domain tab's card: status pill and "n alarms · m offline · k assets",
 * linking to the tab the config names. `tabHref` builds that tab's URL: a path under the site page,
 * a `?tab=` link in the dashboard viewer (critique fix), or null where there is no tab to open (the
 * builder), so the card is not a link. A tab the read does not list, or whose members
 * the caller cannot read, says "Outside scope".
 */
export function ModuleSummaryCardWidget({
  title,
  status,
  data,
  severities,
  config,
  tabHref,
}: SiteWidgetCommon & { config: ModuleSummaryCardConfig; tabHref: SiteTabHref | null }) {
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
          {tabHref !== null ? (
            <Link
              className={`rounded text-xs font-semibold text-accent-strong hover:underline ${FOCUS_OUTLINE_CLASS}`}
              to={tabHref(config.targetTabKey)}
            >
              Open {label}
            </Link>
          ) : null}
        </div>
      </div>
    </WidgetFrame>
  );
}
