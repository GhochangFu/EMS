import { AssetClassStripBody } from "../control-room/asset-class-strip-body";
import { SITE_WIDGET_BODY_CLASS, type SiteWidgetCommon } from "./site-widget-parts";
import { WidgetFrame } from "./widget-frame";

/** `F3.73` (plan D9) — the per-class asset strip over the roles in the widget's tab scope. */
export function AssetClassStripWidget({ title, status, data }: Omit<SiteWidgetCommon, "severities">) {
  return (
    <WidgetFrame title={title} status={status}>
      <div className={SITE_WIDGET_BODY_CLASS}>
        <AssetClassStripBody status="ready" items={data?.roles ?? []} noIdsNote={null} />
      </div>
    </WidgetFrame>
  );
}
