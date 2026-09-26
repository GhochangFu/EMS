import { Link } from "react-router-dom";

import { smocTabPath, type SmocTabKey } from "../../lib/smoc-pages";

/**
 * `F3.70` U3 — the link to one SMOC tab on this site. The `locationId` is
 * empty only while the content is still served at `/cr-overview`, which has
 * no `:locationId`; the old `/cr-*` path keeps the link working there.
 * Dead from U5a, when every `/cr-*` route redirects; U5b removes the branch.
 */
function tabPath(locationId: string, tab: SmocTabKey): string {
  return locationId ? smocTabPath(locationId, tab) : `/cr-${tab}`;
}

export function QuickDrilldown({
  locationId,
  access,
}: {
  /** `F3.70` U3 — the site whose SMOC tabs the six links target. */
  locationId: string;
  access: {
    electrical: boolean;
    it: boolean;
    upsBattery: boolean;
    hvac: boolean;
    environment: boolean;
  };
}) {
  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="font-condensed text-lg font-bold text-bms-ink">
        Quick Drilldown
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <DrilldownItem enabled={access.electrical} to={tabPath(locationId, "sld")} label="Electrical SLD" />
        <DrilldownItem enabled={access.it} to={tabPath(locationId, "it")} label="IT & Racks" />
        <DrilldownItem enabled={access.upsBattery} to={tabPath(locationId, "ups")} label="UPS Monitoring" />
        <DrilldownItem enabled={access.upsBattery} to={tabPath(locationId, "battery")} label="Battery Bank" />
        <DrilldownItem enabled={access.hvac} to={tabPath(locationId, "hvac")} label="HVAC System" />
        <DrilldownItem enabled={access.environment} to={tabPath(locationId, "env")} label="Environment" />
        {["Security", "Trends"].map((label) => (
          <span key={label} className="cursor-not-allowed rounded border border-gray-200 p-3 text-bms-muted">
            {label} · deferred
          </span>
        ))}
      </div>
    </section>
  );
}

function DrilldownItem({
  enabled,
  to,
  label,
}: {
  enabled: boolean;
  to: string;
  label: string;
}) {
  const classes = enabled
    ? "rounded border border-bms-green/30 bg-bms-green/10 p-3 font-semibold text-bms-green hover:bg-bms-green/15"
    : "cursor-not-allowed rounded border border-gray-200 bg-gray-50 p-3 font-semibold text-gray-400";
  return enabled ? (
    <Link className={classes} to={to}>
      {label}
    </Link>
  ) : (
    <span className={classes} title="Outside your asset-group scope">
      {label}
    </span>
  );
}
