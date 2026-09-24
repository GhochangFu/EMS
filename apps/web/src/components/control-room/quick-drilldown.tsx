import { Link } from "react-router-dom";

export function QuickDrilldown({
  access,
}: {
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
        <DrilldownItem enabled={access.electrical} to="/cr-sld" label="Electrical SLD" />
        <DrilldownItem enabled={access.it} to="/cr-it" label="IT & Racks" />
        <DrilldownItem enabled={access.upsBattery} to="/cr-ups" label="UPS Monitoring" />
        <DrilldownItem enabled={access.upsBattery} to="/cr-battery" label="Battery Bank" />
        <DrilldownItem enabled={access.hvac} to="/cr-hvac" label="HVAC System" />
        <DrilldownItem enabled={access.environment} to="/cr-env" label="Environment" />
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
