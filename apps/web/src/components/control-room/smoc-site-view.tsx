import type { AccessibleScope } from "@bms/shared";
import { Link } from "react-router-dom";

import { ControlRoomBatteryContent } from "./smoc/battery";
import { ControlRoomEnvContent } from "./smoc/env";
import { ControlRoomHvacContent } from "./smoc/hvac";
import { ControlRoomItContent } from "./smoc/it";
import { ControlRoomOverviewContent } from "./smoc/overview";
import { ControlRoomSldContent } from "./smoc/sld";
import { ControlRoomUpsContent } from "./smoc/ups";
import { allowedSmocTabs, smocTabPath, type SmocTabKey } from "../../lib/smoc-pages";
import { CR_POINT_KEYS, CR_TRACKED_ASSET_CODES } from "../live-svg/control-room-bindings";
import { SchematicTelemetryProvider } from "../live-svg/schematic-telemetry-context";
import { SectionCard } from "../section-card";

type SmocSiteViewProps = {
  locationId: string;
  tab: SmocTabKey;
  scope: AccessibleScope | null;
};

/** One content per tab key; the record type makes a missing tab a compile error. */
const TAB_CONTENT: Record<SmocTabKey, JSX.Element> = {
  overview: <ControlRoomOverviewContent />,
  sld: <ControlRoomSldContent />,
  ups: <ControlRoomUpsContent />,
  battery: <ControlRoomBatteryContent />,
  hvac: <ControlRoomHvacContent />,
  env: <ControlRoomEnvContent />,
  it: <ControlRoomItContent />,
};

/**
 * `F3.70` U4 (ADR 0076 decision 9) — the `builtin/smoc` body of the site page:
 * a tab strip over the tabs the per-area rule allows (D3, D9), then the chosen
 * tab's content under one `SchematicTelemetryProvider` shared by all seven
 * (OQ1, D1). A tab outside the rule keeps the strip and shows the scoped-out
 * card; its content and the provider never mount (OQ2, D4). Which site may
 * show this view at all is the site page's decision, not this component's.
 */
export function SmocSiteView({ locationId, tab, scope }: SmocSiteViewProps) {
  const tabs = allowedSmocTabs(scope);
  const allowed = tabs.some((entry) => entry.key === tab);

  return (
    <>
      <nav
        aria-label="SMOC pages"
        data-testid="smoc-tabs"
        className="flex flex-wrap gap-1 border-b border-gray-200 pb-2"
      >
        {tabs.map((entry) => {
          const active = entry.key === tab;
          return (
            <Link
              key={entry.key}
              to={smocTabPath(locationId, entry.key)}
              aria-current={active ? "page" : undefined}
              className={`rounded px-3 py-1.5 text-xs font-semibold ${
                active ? "bg-bms-green text-white" : "text-bms-muted hover:bg-gray-100 hover:text-bms-ink"
              }`}
            >
              {entry.label}
            </Link>
          );
        })}
      </nav>
      {allowed ? (
        <SchematicTelemetryProvider assetCodes={CR_TRACKED_ASSET_CODES} pointKeys={CR_POINT_KEYS}>
          {TAB_CONTENT[tab]}
        </SchematicTelemetryProvider>
      ) : (
        <SectionCard title="Outside your asset-group scope" bodyClassName="p-4">
          <p className="text-sm text-bms-muted">
            This page is not part of the asset groups your access scope covers.
          </p>
        </SectionCard>
      )}
    </>
  );
}
