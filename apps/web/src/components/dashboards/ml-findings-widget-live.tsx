import type { DashboardWidgetDto } from "@bms/shared";
import type { MlFindingsKind, MlFindingsWidgetShow } from "@bms/shared/contracts";

import type { ScopeFilter } from "../../lib/scope-filter";
import { widgetTitle } from "../../lib/widget-value";
import { MlFindingsCard } from "../ml/ml-findings-card";
import { WidgetFrame } from "../widgets/widget-frame";

/**
 * The dashboard's own scope, as `bms.dashboards` holds it: the organization, plus the one of
 * location, asset group or asset that is set (`dashboards_scope_check`); the others are `null`.
 */
export type MlFindingsWidgetScope = {
  readonly organizationId: string;
  readonly locationId: string | null;
  readonly assetGroupId: string | null;
  readonly assetId: string | null;
};

const KINDS_BY_SHOW: Readonly<Record<MlFindingsWidgetShow, readonly MlFindingsKind[]>> = {
  both: ["forecasts", "anomalies"],
  forecasts: ["forecasts"],
  anomalies: ["anomalies"],
};

/** The summary routes' filter: the organization and each set id; a `null` key is not sent. */
function scopeFilterOf(scope: MlFindingsWidgetScope): ScopeFilter {
  return {
    organizationId: scope.organizationId,
    ...(scope.locationId === null ? {} : { locationId: scope.locationId }),
    ...(scope.assetGroupId === null ? {} : { assetGroupId: scope.assetGroupId }),
    ...(scope.assetId === null ? {} : { assetId: scope.assetId }),
  };
}

type MlFindingsWidgetLiveProps = {
  widget: Extract<DashboardWidgetDto, { widgetType: "ml_findings" }>;
  scope: MlFindingsWidgetScope;
};

/**
 * `E1.9f` / ADR 0135 Amendment 8 decision 13 — one `ml_findings` widget on a live dashboard: the
 * shared `MlFindingsCard` inside the widget frame, on its dashboard's own scope. It binds no point
 * and no source. `show` picks the kinds (`"both"` when absent) and `paragraph: false` never asks
 * for the AI paragraph (`true` when absent; plan R-u). The card reads every 15 minutes; it asks
 * only while mounted, so only while its tab is the selected one (R-q). Access is still the
 * viewer's: the summary routes narrow to what the reader may see.
 */
export function MlFindingsWidgetLive({ widget, scope }: MlFindingsWidgetLiveProps) {
  const title = widgetTitle(widget.title, widget.widgetType);
  const kinds = KINDS_BY_SHOW[widget.config.show ?? "both"];
  return (
    <WidgetFrame title={title} status="ready">
      <div className="min-h-0 flex-1 overflow-auto">
        <MlFindingsCard kinds={kinds} scope={scopeFilterOf(scope)} paragraph={widget.config.paragraph ?? true} />
      </div>
    </WidgetFrame>
  );
}
