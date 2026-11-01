import type { TrendStripRange } from "@bms/shared";

import { TrendStripBody } from "../control-room/trend-strip-body";
import { SITE_WIDGET_BODY_CLASS } from "./site-widget-parts";
import { WidgetFrame } from "./widget-frame";

/** A dashboard with no location has no site to read, so the widget says so and reads nothing. */
export const TREND_STRIP_NO_SITE_SENTENCE = "Trends need a site: this dashboard has no location.";

type TrendStripWidgetProps = {
  title: string;
  /** The dashboard's own location; `null` draws {@link TREND_STRIP_NO_SITE_SENTENCE} and reads nothing. */
  locationId: string | null;
  /** The group the widget's `config.tabKey` resolves to; `null` is the whole site. */
  assetGroupId: string | null;
  defaultRange: TrendStripRange;
};

/**
 * `F4.305` U4 (ADR 0108 Amendment 3, items 1–3) — the `trend_strip` dashboard widget: the
 * `F4.301` strip body (`TrendStripBody`) inside a widget frame. Same read, same series, same click
 * to `/asset-history/:assetId?range=&points=`; a failed read (a group at another site answers 404)
 * draws the body's fixed sentence, never the error's text. The static draw is
 * `trend-strip-widget-preview.tsx`.
 *
 * The body is keyed on the default range, so an edited `defaultRange` restarts the switch on it.
 */
export function TrendStripWidget({ title, locationId, assetGroupId, defaultRange }: TrendStripWidgetProps) {
  return (
    <WidgetFrame title={title} status="ready">
      <div className={SITE_WIDGET_BODY_CLASS}>
        {locationId === null ? (
          <p className="text-xs text-ink-muted">{TREND_STRIP_NO_SITE_SENTENCE}</p>
        ) : (
          <TrendStripBody
            key={defaultRange}
            locationId={locationId}
            assetGroupId={assetGroupId}
            defaultRange={defaultRange}
          />
        )}
      </div>
    </WidgetFrame>
  );
}
