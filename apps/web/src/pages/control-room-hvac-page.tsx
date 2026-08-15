import type { ReactNode } from "react";
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
import { StaticValue } from "../components/static-value";
import { AppShell } from "../layouts/app-shell";
import {
  freshValue,
  isStale,
  STALE_VALUE,
} from "../lib/schematic-telemetry";
import type { AuthUser } from "../stores/auth-store";

type ControlRoomHvacPageProps = {
  user: AuthUser;
};

type HvacStatus = "normal" | "warning" | "critical" | "offline";

type RuleState = {
  status: HvacStatus;
  matchedRule: RuleListItem | null;
  /** True when the unit has stopped reporting (ADR 0027). */
  stale: boolean;
};

const HVAC_UNITS = [
  { code: "CR-HVAC-1", label: "AC-1", role: "LEAD", runHours: 12840, service: "12 Mar 2026" },
  { code: "CR-HVAC-2", label: "AC-2", role: "STANDBY", runHours: 12388, service: "05 Apr 2026" },
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
    case "supply_air_temp_c":
      return slice.supplyAirTempC;
    case "return_air_temp_c":
      return slice.returnAirTempC;
    case "fan_rpm":
      return slice.fanRpm;
    case "fan_speed_pct":
      return slice.fanSpeedPct;
    case "chw_flow_lps":
      return slice.chwFlowLps;
    case "chw_supply_temp_c":
      return slice.chwSupplyTempC;
    case "chw_return_temp_c":
      return slice.chwReturnTempC;
    case "compressor_ok":
      return slice.compressorOk;
    case "cooling_kw":
      return slice.coolingKw;
    default:
      return null;
  }
}

function severityStatus(severity: string | null): HvacStatus {
  return severity === "critical" ? "critical" : "warning";
}

/**
 * Tile status for one CRAC unit (ADR 0027).
 *
 * Staleness gates the rules rather than sitting beside them: a unit that has
 * stopped reporting is `offline` whatever its last reading said. It previously
 * tested `lastSeenMs === null` only, so a dead unit kept rendering its final
 * temperatures as a live cooling state.
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

/** `offline` outranks `critical` — ADR 0027 decision 2; see the env page note. */
function mergeStatus(states: RuleState[]): RuleState {
  return (
    states.find((state) => state.status === "offline") ??
    states.find((state) => state.status === "critical") ??
    states.find((state) => state.status === "warning") ??
    { status: "normal", matchedRule: null, stale: false }
  );
}

function statusLabel(status: HvacStatus): string {
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

function statusPillClass(status: HvacStatus): string {
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

function statusTone(status: HvacStatus): "default" | "warning" | "critical" {
  if (status === "critical") {
    return "critical";
  }
  if (status === "warning" || status === "offline") {
    return "warning";
  }
  return "default";
}

function unitBoxClass(status: HvacStatus): string {
  if (status === "critical") {
    return "fill-red-50 stroke-red-600";
  }
  if (status === "warning") {
    return "fill-amber-50 stroke-amber-500";
  }
  if (status === "offline") {
    return "fill-gray-100 stroke-gray-400";
  }
  return "fill-white stroke-bms-green";
}

function ControlRoomHvacContent() {
  const rulesQuery = useQuery({
    queryKey: ["rules", "cr-hvac"],
    queryFn: fetchRules,
    refetchInterval: 15_000,
  });
  const rules = rulesQuery.data?.items ?? [];
  const hvac1 = useCr("CR-HVAC-1");
  const hvac2 = useCr("CR-HVAC-2");
  const nowMs = Date.now();
  const units = [
    { ...HVAC_UNITS[0], slice: hvac1, state: deriveRuleState("CR-HVAC-1", hvac1, rules, nowMs) },
    { ...HVAC_UNITS[1], slice: hvac2, state: deriveRuleState("CR-HVAC-2", hvac2, rules, nowMs) },
  ];
  const overall = mergeStatus(units.map((unit) => unit.state));
  // Aggregates count only the units still reporting (ADR 0027 decision 4). The
  // `?? 0` forms below used to fold a dead unit in as 0 kW / 0 C, which reads
  // as measured rather than missing.
  const liveUnits = units.filter((unit) => !unit.state.stale);
  const staleUnits = units.length - liveUnits.length;
  const returns = liveUnits
    .map((unit) => unit.slice.returnAirTempC)
    .filter((v): v is number => v != null && !Number.isNaN(v));
  const avgReturn =
    returns.length === 0 ? null : returns.reduce((a, b) => a + b, 0) / returns.length;
  const coolings = liveUnits
    .map((unit) => unit.slice.coolingKw)
    .filter((v): v is number => v != null && !Number.isNaN(v));
  const totalCooling =
    coolings.length === 0 ? null : coolings.reduce((a, b) => a + b, 0);
  const activeUnits = liveUnits.filter((unit) => (unit.slice.fanSpeedPct ?? 0) > 20).length;
  const liveCritical = units.filter((u) => u.state.status === "critical").length;

  return (
    <div className="mx-auto max-w-[1320px] space-y-4 pb-8">
      <PageHeader
        eyebrow="R.crHvac"
        title="HVAC System · 2 x 4 TR Precision AC"
        subtitle={
          liveCritical > 0
            ? `${liveCritical} ACTIVE CRITICAL · lead/lag operation · auto changeover · rule-driven status`
            : "Lead/Lag operation · auto changeover · airflow indication · rule-driven status"
        }
        actions={
          <>
            <DisabledCommandButton>Force Changeover · disabled</DisabledCommandButton>
            <DisabledCommandButton>Set Schedule · disabled</DisabledCommandButton>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiTile label="Overall Status" status="ready" value={statusLabel(overall.status)} tone={statusTone(overall.status)} />
        <KpiTile label="Active Units" status="ready" value={String(activeUnits)} unit="/ 2" />
        <KpiTile
          label="Avg Return Air"
          status="ready"
          value={n(avgReturn, 1)}
          unit="C"
          hint={staleUnits > 0 ? `${staleUnits} unit(s) stale` : undefined}
        />
        <KpiTile
          label="Cooling Output"
          status="ready"
          value={n(totalCooling, 1)}
          unit="kW"
          hint={staleUnits > 0 ? `${staleUnits} unit(s) stale` : undefined}
        />
        <KpiTile label="Rule Alerts" status="ready" value={String(units.filter((unit) => unit.state.matchedRule).length)} hint="editable in Rule Engine" tone={statusTone(overall.status)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {units.map((unit) => (
          <HvacUnitCard key={unit.code} unit={unit} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* `F4.39`: "Elapsed 96 / 168 h" and the progress bar under it are gone.
            Nothing counts changeover hours — the number and the 58% bar were
            invented, and a progress bar is read as a live countdown. The three
            rows that remain are configuration: they describe how the pair is
            set up, which is static and correctly so (ADR 0028 decision 3). */}
        <DetailCard title="Lead / Lag Strategy">
          <Row
            label="Current cycle"
            value={<StaticValue kind="configuration">AC-1 LEAD · AC-2 STANDBY</StaticValue>}
          />
          <Row
            label="Changeover interval"
            value={<StaticValue kind="configuration">168 h</StaticValue>}
          />
          <Row
            label="Trip response"
            value={<StaticValue kind="configuration">Standby auto-start in &lt; 30 s</StaticValue>}
          />
        </DetailCard>
        {/* Run hours are module-level constants (`runHours: 12840`), not a
            counter — marked `simulated` rather than removed, because they are
            plausible maintenance data and the maintenance module is where they
            would come from. The "Imbalance 452 h · within 5% tolerance" line is
            deleted: it stated a tolerance verdict, which is a diagnostic
            conclusion drawn from numbers nobody measured. */}
        <DetailCard title="Run-Hour Balance">
          {units.map((unit) => (
            <div key={unit.code} className="space-y-1">
              <Row
                label={unit.label}
                value={
                  <StaticValue kind="simulated">{`${unit.runHours.toLocaleString()} h`}</StaticValue>
                }
              />
              <div className="h-2 rounded-full bg-gray-100">
                <div
                  className="h-2 rounded-full bg-slate-300"
                  style={{ width: `${Math.min(100, unit.runHours / 200)}%` }}
                />
              </div>
            </div>
          ))}
        </DetailCard>
      </div>
    </div>
  );
}

function HvacUnitCard({
  unit,
}: {
  unit: {
    code: "CR-HVAC-1" | "CR-HVAC-2";
    label: "AC-1" | "AC-2";
    role: "LEAD" | "STANDBY";
    runHours: number;
    service: string;
    slice: SchematicTelemetrySlice;
    state: RuleState;
  };
}) {
  const running = unit.state.status !== "offline" && (unit.slice.fanSpeedPct ?? 0) > 20;
  return (
    <section className="rounded border border-gray-200 bg-white">
      <div className="flex flex-col gap-2 border-b border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-condensed text-lg font-bold text-bms-ink">
            {unit.label} · 4 TR · {unit.role}
          </h2>
          <p className="text-xs text-bms-muted">{running ? "cooling" : "idle"} · {unit.code}</p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPillClass(unit.state.status)}`}>
          {statusLabel(unit.state.status)}
        </span>
      </div>
      <div className="space-y-4 p-4">
        <HvacDiagram slice={unit.slice} status={unit.state.status} label={unit.label} running={running} />
        <div className="grid grid-cols-3 gap-3 text-center">
          <Metric
            label="Setpoint"
            value={<StaticValue kind="configuration">22.0</StaticValue>}
            unit="C"
          />
          <Metric label="Return Air" value={n(freshValue(unit.slice.returnAirTempC, unit.state.stale), 1)} unit="C" tone={statusTone(unit.state.status)} />
          <Metric label="Supply Air" value={n(freshValue(unit.slice.supplyAirTempC, unit.state.stale), 1)} unit="C" />
        </div>
        <div className="border-t border-gray-200 pt-3">
          <Row label="Compressor" value={unit.state.stale ? STALE_VALUE : `${unit.slice.compressorOk === 0 ? "FAULT" : running ? "ON" : "READY"}`} />
          <Row label="Fan" value={`${n(freshValue(unit.slice.fanSpeedPct, unit.state.stale), 0)}% · ${n(freshValue(unit.slice.fanRpm, unit.state.stale), 0)} rpm`} />
          <Row label="Cooling" value={`${n(freshValue(unit.slice.coolingKw, unit.state.stale), 1)} kW`} />
          <Row
            label="Run hours"
            value={<StaticValue kind="simulated">{`${unit.runHours.toLocaleString()} h`}</StaticValue>}
          />
          {/* `F4.39`: "Health" is deleted. It was `status === "critical" ? "82%"
              : "96%"` — two invented percentages wearing the ADR 0027 staleness
              gate, so it blanked honestly when the unit died and lied the rest
              of the time. A health index reads as a computed diagnostic, which
              is precisely what it was not. */}
          <Row label="Last service" value={<StaticValue kind="simulated">{unit.service}</StaticValue>} />
        </div>
        {unit.state.matchedRule ? (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Matched rule: {unit.state.matchedRule.name}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function HvacDiagram({
  slice,
  status,
  label,
  running,
}: {
  slice: SchematicTelemetrySlice;
  status: HvacStatus;
  label: string;
  running: boolean;
}) {
  const airStroke = running ? "#06b6d4" : "#94a3b8";
  return (
    <svg className="h-auto w-full" viewBox="0 0 600 200">
      <defs>
        <marker id={`airArrow-${label}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={airStroke} />
        </marker>
      </defs>
      <rect x="40" y="60" width="200" height="80" rx="8" className={unitBoxClass(status)} />
      <text x="140" y="86" textAnchor="middle" className="fill-bms-ink font-condensed text-[13px] font-bold">INDOOR UNIT</text>
      <text x="140" y="102" textAnchor="middle" className="fill-bms-muted font-mono text-[10px]">{label} · 4 TR</text>
      <circle cx="100" cy="120" r="14" fill="none" stroke={airStroke} strokeWidth="1.6" />
      <line x1="86" y1="120" x2="114" y2="120" stroke={airStroke} strokeWidth="1.6" />
      <line x1="100" y1="106" x2="100" y2="134" stroke={airStroke} strokeWidth="1.6" />
      <text x="100" y="160" textAnchor="middle" className="fill-bms-muted font-mono text-[9px]">FAN {n(freshValue(slice.fanSpeedPct, status === "offline"), 0)}%</text>
      <rect x="160" y="106" width="60" height="28" rx="4" className={status === "offline" ? "fill-gray-200 stroke-gray-400" : slice.compressorOk === 0 ? "fill-red-100 stroke-red-600" : "fill-emerald-50 stroke-bms-green"} />
      <text x="190" y="124" textAnchor="middle" className="fill-bms-green font-mono text-[10px] font-bold">COMP</text>
      <line x1="240" y1="80" x2="320" y2="80" stroke="#f97316" strokeWidth="3" markerEnd={`url(#airArrow-${label})`} strokeDasharray={running ? "0" : "4 3"} />
      <text x="280" y="74" textAnchor="middle" className="fill-orange-500 font-mono text-[9px]">RETURN {n(freshValue(slice.returnAirTempC, status === "offline"), 1)}C</text>
      <line x1="320" y1="120" x2="240" y2="120" stroke={airStroke} strokeWidth="3" markerEnd={`url(#airArrow-${label})`} strokeDasharray={running ? "0" : "4 3"} />
      <text x="280" y="138" textAnchor="middle" className="fill-cyan-600 font-mono text-[9px]">SUPPLY {n(freshValue(slice.supplyAirTempC, status === "offline"), 1)}C</text>
      <rect x="320" y="60" width="240" height="80" rx="8" fill="#fafbfc" stroke="#cbd5e1" strokeDasharray="4 3" strokeWidth="1.4" />
      <text x="440" y="92" textAnchor="middle" className="fill-bms-ink font-condensed text-[14px] font-bold">CONTROL ROOM</text>
      <text x="440" y="110" textAnchor="middle" className="fill-bms-muted font-mono text-[10px]">setpoint 22.0C</text>
      <text x="440" y="124" textAnchor="middle" className="fill-bms-muted font-mono text-[10px]">racks + operators</text>
    </svg>
  );
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="font-condensed text-lg font-bold text-bms-ink">{title}</h2>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function Metric({
  label,
  value,
  unit,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  unit: string;
  tone?: "default" | "warning" | "critical";
}) {
  const color =
    tone === "critical" ? "text-red-700" : tone === "warning" ? "text-amber-700" : "text-bms-ink";
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-bms-muted">{label}</div>
      <div className={`font-condensed text-2xl font-bold ${color}`}>
        {value}
        <span className="ml-1 text-sm font-normal text-bms-muted">{unit}</span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-bms-muted">{label}</span>
      <span className="font-mono font-semibold text-bms-ink">{value}</span>
    </div>
  );
}

export function ControlRoomHvacPage({ user }: ControlRoomHvacPageProps) {
  return (
    <AppShell
      user={user}
      kpiRibbon={<span className="text-bms-ink">IBMS Control Room · HVAC System</span>}
    >
      <SchematicTelemetryProvider
        assetCodes={CR_TRACKED_ASSET_CODES}
        pointKeys={CR_POINT_KEYS}
      >
        <ControlRoomHvacContent />
      </SchematicTelemetryProvider>
    </AppShell>
  );
}
