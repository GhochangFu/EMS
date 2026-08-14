import type { AutomationRuleOperator, RuleListItem } from "@bms/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchRules } from "../api/rules";
import { KpiTile } from "../components/kpi-tile";
import {
  CR_POINT_KEYS,
  CR_TRACKED_ASSET_CODES,
} from "../components/live-svg/control-room-bindings";
import {
  type SchematicTelemetrySlice,
  SchematicTelemetryProvider,
  useSchematicTelemetryByCode,
} from "../components/live-svg/schematic-telemetry-context";
import { DisabledCommandButton } from "../components/disabled-command-button";
import { PageHeader } from "../components/page-header";
import { AppShell } from "../layouts/app-shell";
import {
  freshValue,
  isStale,
  STALE_VALUE,
} from "../lib/schematic-telemetry";
import type { AuthUser } from "../stores/auth-store";

type ControlRoomEnvPageProps = {
  user: AuthUser;
};

type EnvStatus = "normal" | "warning" | "critical" | "offline";

type RuleState = {
  status: EnvStatus;
  matchedRule: RuleListItem | null;
  /** True when the asset has stopped reporting (ADR 0027). */
  stale: boolean;
};

const ZONES = [
  { code: "CR-ENV-OP-CONSOLE", zone: "Operator Console", range: "18-26 C", x: 170, y: 120 },
  { code: "CR-ENV-VIDEOWALL", zone: "Videowall Bay", range: "18-26 C", x: 390, y: 86 },
  { code: "CR-ENV-RACK-A", zone: "Rack Bay A", range: "18-27 C", x: 547, y: 200 },
  { code: "CR-ENV-RACK-B", zone: "Rack Bay B", range: "18-27 C", x: 612, y: 200 },
  { code: "CR-ENV-BATTERY-ROOM", zone: "Battery Room", range: "20-30 C", x: 150, y: 260 },
  { code: "CR-ENV-UPS-ROOM", zone: "UPS Room", range: "20-30 C", x: 360, y: 260 },
] as const;

const LEAK_SENSORS = [
  { code: "CR-LEAK-01", id: "LK-01", location: "AHU-1 drain pan" },
  { code: "CR-LEAK-02", id: "LK-02", location: "AHU-2 drain pan" },
  { code: "CR-LEAK-03", id: "LK-03", location: "Under raised floor (NW)" },
  { code: "CR-LEAK-04", id: "LK-04", location: "Battery room floor" },
] as const;

const SMOKE_SENSORS = [
  { code: "CR-SMOKE-01", id: "SM-01", location: "Operator zone" },
  { code: "CR-SMOKE-02", id: "SM-02", location: "Videowall bay" },
  { code: "CR-SMOKE-03", id: "SM-03", location: "Rack bay" },
  { code: "CR-SMOKE-04", id: "SM-04", location: "Battery room" },
] as const;

function n(value: number | null, digits = 1): string {
  return value == null || Number.isNaN(value)
    ? STALE_VALUE
    : value.toFixed(digits);
}

function useCr(code: string) {
  return useSchematicTelemetryByCode(code).slice;
}

function compareValue(
  observed: number,
  operator: AutomationRuleOperator,
  threshold: number,
): boolean {
  switch (operator) {
    case "gt":
      return observed > threshold;
    case "gte":
      return observed >= threshold;
    case "lt":
      return observed < threshold;
    case "lte":
      return observed <= threshold;
    case "eq":
      return observed === threshold;
  }
}

function pointValue(slice: SchematicTelemetrySlice, pointKey: string): number | null {
  switch (pointKey) {
    case "temperature_c":
      return slice.temperatureC;
    case "humidity_pct":
      return slice.humidityPct;
    case "leak_state":
      return slice.leakState;
    case "smoke_state":
      return slice.smokeState;
    default:
      return null;
  }
}

function severityStatus(severity: string | null): EnvStatus {
  return severity === "critical" ? "critical" : "warning";
}

/**
 * Tile status for one asset (ADR 0027).
 *
 * **Staleness is a gate in front of the rules, not a state beside them.** It
 * used to test `lastSeenMs === null` only — "has this sensor ever reported" —
 * so a leak sensor that died reading dry stayed `normal` for ever and the
 * threshold rules kept evaluating a `leak_state` nobody could vouch for. Now a
 * sensor that has stopped reporting is `offline` whatever its last value said,
 * including `critical`: the honest statement is that we no longer know.
 */
function deriveRuleState(
  assetCode: string,
  slice: SchematicTelemetrySlice,
  rules: RuleListItem[],
  nowMs: number,
): RuleState {
  if (isStale(slice.lastSeenMs, nowMs)) {
    return { status: "offline", matchedRule: null, stale: true };
  }
  const matchedRule = rules.find((rule) => {
    if (
      !rule.enabled ||
      rule.ruleType !== "threshold" ||
      rule.assetCode !== assetCode ||
      !rule.pointKey ||
      !rule.operator ||
      rule.thresholdValue === null
    ) {
      return false;
    }
    const observed = pointValue(slice, rule.pointKey);
    return observed !== null && compareValue(observed, rule.operator, rule.thresholdValue);
  });
  return matchedRule
    ? { status: severityStatus(matchedRule.severity), matchedRule, stale: false }
    : { status: "normal", matchedRule: null, stale: false };
}

/**
 * Page banner status.
 *
 * `offline` is ranked **above** `critical` by ADR 0027 decision 2: if sensors
 * have stopped reporting, the headline fact is that the page cannot see the
 * room. The known cost is that one dead sensor outranks a different sensor's
 * live alarm, which is why the header carries a separate live-critical count —
 * see `liveCritical` in the page body. Do not "fix" the masking by re-ranking
 * here without revisiting the ADR.
 */
function mergeStatus(states: RuleState[]): RuleState {
  return (
    states.find((state) => state.status === "offline") ??
    states.find((state) => state.status === "critical") ??
    states.find((state) => state.status === "warning") ??
    { status: "normal", matchedRule: null, stale: false }
  );
}

function statusLabel(status: EnvStatus): string {
  switch (status) {
    case "critical":
      return "CRITICAL";
    case "warning":
      return "WARN";
    case "offline":
      return "OFFLINE";
    case "normal":
      return "NORMAL";
  }
}

function statusPillClass(status: EnvStatus): string {
  switch (status) {
    case "critical":
      return "border-red-200 bg-red-100 text-red-800";
    case "warning":
      return "border-amber-200 bg-amber-100 text-amber-900";
    case "offline":
      return "border-gray-200 bg-gray-100 text-gray-700";
    case "normal":
      return "border-bms-green/20 bg-bms-green/10 text-bms-green";
  }
}

function tileClass(status: EnvStatus): string {
  switch (status) {
    case "critical":
      return "border-red-200 bg-red-50";
    case "warning":
      return "border-amber-200 bg-amber-50";
    case "offline":
      return "border-gray-200 bg-gray-50";
    case "normal":
      return "border-bms-green/20 bg-bms-green/10";
  }
}

function statusTone(status: EnvStatus): "default" | "warning" | "critical" {
  if (status === "critical") {
    return "critical";
  }
  if (status === "warning" || status === "offline") {
    return "warning";
  }
  return "default";
}

function markerFill(status: EnvStatus): string {
  if (status === "critical") {
    return "#dc2626";
  }
  if (status === "warning") {
    return "#f59e0b";
  }
  if (status === "offline") {
    return "#94a3b8";
  }
  return "#22c55e";
}

function ControlRoomEnvContent() {
  const rulesQuery = useQuery({
    queryKey: ["rules", "cr-env"],
    queryFn: fetchRules,
    refetchInterval: 15_000,
  });
  const rules = rulesQuery.data?.items ?? [];

  const opConsole = useCr("CR-ENV-OP-CONSOLE");
  const videowall = useCr("CR-ENV-VIDEOWALL");
  const rackA = useCr("CR-ENV-RACK-A");
  const rackB = useCr("CR-ENV-RACK-B");
  const batteryRoom = useCr("CR-ENV-BATTERY-ROOM");
  const upsRoom = useCr("CR-ENV-UPS-ROOM");
  const leak01 = useCr("CR-LEAK-01");
  const leak02 = useCr("CR-LEAK-02");
  const leak03 = useCr("CR-LEAK-03");
  const leak04 = useCr("CR-LEAK-04");
  const smoke01 = useCr("CR-SMOKE-01");
  const smoke02 = useCr("CR-SMOKE-02");
  const smoke03 = useCr("CR-SMOKE-03");
  const smoke04 = useCr("CR-SMOKE-04");

  const zoneSlices = [opConsole, videowall, rackA, rackB, batteryRoom, upsRoom];
  const leakSlices = [leak01, leak02, leak03, leak04];
  const smokeSlices = [smoke01, smoke02, smoke03, smoke04];
  // Read at render. The provider's `staleTick` (F4.37) is what guarantees a
  // render happens while nothing is arriving, which is exactly when these
  // statuses need to change.
  const nowMs = Date.now();
  const zones = ZONES.map((zone, index) => ({
    ...zone,
    slice: zoneSlices[index],
    state: deriveRuleState(zone.code, zoneSlices[index], rules, nowMs),
  }));
  const leaks = LEAK_SENSORS.map((sensor, index) => ({
    ...sensor,
    slice: leakSlices[index],
    state: deriveRuleState(sensor.code, leakSlices[index], rules, nowMs),
  }));
  const smoke = SMOKE_SENSORS.map((sensor, index) => ({
    ...sensor,
    slice: smokeSlices[index],
    state: deriveRuleState(sensor.code, smokeSlices[index], rules, nowMs),
  }));
  const allStates = [
    ...zones.map((zone) => zone.state),
    ...leaks.map((sensor) => sensor.state),
    ...smoke.map((sensor) => sensor.state),
  ];
  const overall = mergeStatus(allStates);
  // Averages over the zones still reporting only (ADR 0027 decision 4). A dead
  // zone used to keep dragging its last temperature into the KPI, and worse,
  // `?? 0` counted a missing reading as 0 C.
  const liveZones = zones.filter((zone) => !zone.state.stale);
  const avgOf = (pick: (z: (typeof liveZones)[number]) => number | null) => {
    const vals = liveZones
      .map(pick)
      .filter((v): v is number => v != null && !Number.isNaN(v));
    return vals.length === 0
      ? null
      : vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const avgTemp = avgOf((zone) => zone.slice.temperatureC);
  const avgHumidity = avgOf((zone) => zone.slice.humidityPct);
  const staleZones = zones.length - liveZones.length;
  const wetCount = leaks.filter((sensor) => sensor.state.status === "critical").length;
  const smokeAlerts = smoke.filter((sensor) => sensor.state.status === "critical").length;
  // Counted per group, not pooled. A single `staleSensors` total was shown on
  // both tiles, so the Leak Sensors tile read "4 … 8 stale" — more stale than
  // it has sensors. Caught on the running deployment, not by a test.
  const staleLeaks = leaks.filter((s) => s.state.stale).length;
  const staleSmoke = smoke.filter((s) => s.state.stale).length;
  // ADR 0027's mitigation for decision 2: `offline` outranks `critical` in the
  // banner, so a live alarm could otherwise be hidden behind an unrelated dead
  // sensor. This count is never outranked by anything.
  const liveCritical = [...zones, ...leaks, ...smoke].filter(
    (item) => item.state.status === "critical",
  ).length;

  return (
    <div className="mx-auto max-w-[1320px] space-y-4 pb-8">
      <PageHeader
        eyebrow="R.crEnv"
        title="Environment Monitoring"
        subtitle={
          liveCritical > 0
            ? `${liveCritical} ACTIVE CRITICAL · temperature · humidity · water leak · smoke · rule-driven status`
            : "Temperature · humidity · water leak · smoke · zone-level sensors · rule-driven status"
        }
        actions={
          <>
            <DisabledCommandButton>Test Sensors · disabled</DisabledCommandButton>
            <DisabledCommandButton>Calibrate · disabled</DisabledCommandButton>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiTile
          label="Avg Room T"
          status="ready"
          value={n(avgTemp, 1)}
          unit="C"
          hint={staleZones > 0 ? `${staleZones} zone(s) stale` : undefined}
          tone={statusTone(overall.status)}
        />
        <KpiTile
          label="Avg Humidity"
          status="ready"
          value={n(avgHumidity, 0)}
          unit="%"
          hint={staleZones > 0 ? `${staleZones} zone(s) stale` : undefined}
        />
        <KpiTile
          label="Leak Sensors"
          status="ready"
          value={String(leaks.length)}
          hint={`${wetCount} wet${staleLeaks > 0 ? ` · ${staleLeaks} stale` : ""}`}
          tone={wetCount > 0 ? "critical" : "default"}
        />
        <KpiTile
          label="Smoke Sensors"
          status="ready"
          value={String(smoke.length)}
          hint={`${smokeAlerts} alerts${staleSmoke > 0 ? ` · ${staleSmoke} stale` : ""}`}
          tone={smokeAlerts > 0 ? "critical" : "default"}
        />
        <KpiTile label="Zones Monitored" status="ready" value={String(zones.length)} hint="editable thresholds in Rule Engine" />
      </div>

      <section className="rounded border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="font-condensed text-lg font-bold text-bms-ink">
            Zone Temperature & Humidity
          </h2>
          <p className="text-xs text-bms-muted">Live readings · thresholds set per zone in Rule Engine</p>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {zones.map((zone) => (
            <div key={zone.code} className={`rounded border p-3 ${tileClass(zone.state.status)}`}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-bms-ink">{zone.zone}</h3>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusPillClass(zone.state.status)}`}>
                  {statusLabel(zone.state.status)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Metric
                  label="Temperature"
                  value={n(freshValue(zone.slice.temperatureC, zone.state.stale), 1)}
                  unit="C"
                />
                <Metric
                  label="Humidity"
                  value={n(freshValue(zone.slice.humidityPct, zone.state.stale), 0)}
                  unit="%"
                />
              </div>
              <p className="mt-2 text-xs text-bms-muted">Range {zone.range}</p>
              {zone.state.matchedRule ? (
                <p className="mt-2 text-xs text-amber-800">Matched rule: {zone.state.matchedRule.name}</p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="font-condensed text-lg font-bold text-bms-ink">Sensor Floorplan</h2>
          <p className="text-xs text-bms-muted">Control room layout · simplified</p>
        </div>
        <div className="bg-gray-50 p-4">
          <FloorPlan zones={zones} leaks={leaks} smoke={smoke} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <SensorTable
          title="Water Leak Detection"
          rows={leaks.map((sensor) => ({
            id: sensor.id,
            location: sensor.location,
            state: sensor.state.stale
              ? STALE_VALUE
              : sensor.state.status === "critical"
                ? "WET"
                : "DRY",
            status: sensor.state.status,
          }))}
        />
        <SensorTable
          title="Smoke Detection"
          rows={smoke.map((sensor) => ({
            id: sensor.id,
            location: sensor.location,
            state: sensor.state.stale
              ? STALE_VALUE
              : sensor.state.status === "critical"
                ? "ALARM"
                : "NORMAL",
            status: sensor.state.status,
          }))}
        />
      </div>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-bms-muted">
        {label}
      </div>
      <div className="font-condensed text-2xl font-bold text-bms-ink">
        {value}
        <span className="ml-1 text-sm font-normal text-bms-muted">{unit}</span>
      </div>
    </div>
  );
}

function SensorTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; location: string; state: string; status: EnvStatus }>;
}) {
  return (
    <section className="rounded border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="font-condensed text-lg font-bold text-bms-ink">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-bms-muted">
            <tr>
              <th className="px-4 py-2 text-left">Sensor</th>
              <th className="px-4 py-2 text-left">Location</th>
              <th className="px-4 py-2 text-left">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-semibold text-bms-ink">{row.id}</td>
                <td className="px-4 py-3">{row.location}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPillClass(row.status)}`}>
                    {row.state}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FloorPlan({
  zones,
  leaks,
  smoke,
}: {
  zones: Array<(typeof ZONES)[number] & { state: RuleState }>;
  leaks: Array<(typeof LEAK_SENSORS)[number] & { state: RuleState }>;
  smoke: Array<(typeof SMOKE_SENSORS)[number] & { state: RuleState }>;
}) {
  return (
    <svg className="h-auto w-full" viewBox="0 0 700 320">
      <rect x="20" y="20" width="660" height="280" rx="6" fill="#fff" stroke="#1d3a8c" strokeWidth="1.6" />
      <rect x="60" y="50" width="220" height="120" rx="4" fill="#eff6ff" stroke="#3b82f6" />
      <text x="170" y="76" textAnchor="middle" className="fill-blue-900 font-condensed text-[13px] font-semibold">OPERATOR CONSOLE</text>
      <rect x="300" y="50" width="180" height="60" rx="4" fill="#fef3c7" stroke="#d97706" />
      <text x="390" y="84" textAnchor="middle" className="fill-amber-800 font-condensed text-[13px] font-semibold">VIDEOWALL</text>
      <rect x="500" y="50" width="160" height="220" rx="4" fill="#ecfeff" stroke="#0891b2" />
      <text x="580" y="76" textAnchor="middle" className="fill-cyan-800 font-condensed text-[13px] font-semibold">RACK BAY</text>
      <rect x="60" y="200" width="180" height="80" rx="4" fill="#fef2f2" stroke="#dc2626" />
      <text x="150" y="228" textAnchor="middle" className="fill-red-800 font-condensed text-[13px] font-semibold">BATTERY ROOM</text>
      <rect x="260" y="200" width="200" height="80" rx="4" fill="#f3e8ff" stroke="#7e22ce" />
      <text x="360" y="228" textAnchor="middle" className="fill-purple-900 font-condensed text-[13px] font-semibold">UPS ROOM</text>
      {zones.map((zone) => (
        <g key={zone.code}>
          <circle cx={zone.x} cy={zone.y} r="9" fill={markerFill(zone.state.status)} stroke="#fff" strokeWidth="1.5" />
          <text x={zone.x} y={zone.y + 3} textAnchor="middle" className="fill-white font-mono text-[9px] font-bold">T</text>
        </g>
      ))}
      {smoke.map((sensor, index) => {
        const coords = [
          [247, 62],
          [467, 62],
          [587, 252],
          [207, 252],
        ][index];
        return (
          <g key={sensor.code}>
            <rect x={coords[0] - 7} y={coords[1] - 7} width="14" height="14" rx="2" fill={markerFill(sensor.state.status)} stroke="#fff" strokeWidth="1.5" />
            <text x={coords[0]} y={coords[1] + 3} textAnchor="middle" className="fill-white font-mono text-[9px] font-bold">S</text>
          </g>
        );
      })}
      {leaks.map((sensor, index) => {
        const coords = [
          [225, 245],
          [430, 155],
          [160, 280],
          [320, 280],
        ][index];
        const fill = sensor.state.status === "critical" ? "#dc2626" : "#06b6d4";
        return (
          <polygon
            key={sensor.code}
            points={`${coords[0]},${coords[1] - 8} ${coords[0] + 10},${coords[1] + 6} ${coords[0] - 10},${coords[1] + 6}`}
            fill={fill}
            stroke="#fff"
            strokeWidth="1.5"
          />
        );
      })}
    </svg>
  );
}

export function ControlRoomEnvPage({ user }: ControlRoomEnvPageProps) {
  return (
    <AppShell
      user={user}
      kpiRibbon={<span className="text-bms-ink">IBMS Control Room · Environment</span>}
    >
      <SchematicTelemetryProvider
        assetCodes={CR_TRACKED_ASSET_CODES}
        pointKeys={CR_POINT_KEYS}
      >
        <ControlRoomEnvContent />
      </SchematicTelemetryProvider>
    </AppShell>
  );
}
