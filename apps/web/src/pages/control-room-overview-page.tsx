import { Link } from "react-router-dom";
import type { AutomationRuleOperator, RuleListItem } from "@bms/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchRules } from "../api/rules";
import { KpiTile } from "../components/kpi-tile";
import {
  CR_BREAKERS,
  CR_POINT_KEYS,
  CR_TRACKED_ASSET_CODES,
} from "../components/live-svg/control-room-bindings";
import {
  type SchematicTelemetrySlice,
  SchematicTelemetryProvider,
  useSchematicTelemetryByCode,
} from "../components/live-svg/schematic-telemetry-context";
import { PageHeader } from "../components/page-header";
import { StatusPill } from "../components/status-pill";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";

type ControlRoomOverviewPageProps = {
  user: AuthUser;
};

function n(value: number | null, digits = 1): string {
  return value == null || Number.isNaN(value) ? "—" : value.toFixed(digits);
}

function useCr(code: string) {
  return useSchematicTelemetryByCode(code).slice;
}

type CrStatus = "normal" | "warning" | "critical" | "open";

type RuleState = {
  status: CrStatus;
  matchedRule: RuleListItem | null;
};

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
    case "current_a":
      return slice.current;
    case "kw":
      return slice.kw;
    case "pf":
      return slice.pf;
    case "breaker_main":
      return slice.breaker;
    case "pdu_util_pct":
      return slice.pduUtilPct;
    case "rack_kw":
      return slice.rackKw;
    case "rack_temp_c":
      return slice.rackTempC;
    case "load_pct":
      return slice.loadPct;
    case "health_pct":
      return slice.healthPct;
    case "battery_temp_c":
      return slice.batteryTempC;
    case "backup_min":
      return slice.backupMin;
    case "supply_air_temp_c":
      return slice.supplyAirTempC;
    case "return_air_temp_c":
      return slice.returnAirTempC;
    case "fan_speed_pct":
      return slice.fanSpeedPct;
    case "compressor_ok":
      return slice.compressorOk;
    case "cooling_kw":
      return slice.coolingKw;
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

function severityStatus(severity: string | null): CrStatus {
  return severity === "critical" ? "critical" : "warning";
}

function deriveRuleState(
  assetCode: string,
  slice: SchematicTelemetrySlice,
  rules: RuleListItem[],
): RuleState {
  if (slice.breaker === 0) {
    return { status: "open", matchedRule: null };
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
    ? { status: severityStatus(matchedRule.severity), matchedRule }
    : { status: "normal", matchedRule: null };
}

function mergeStatus(states: RuleState[]): RuleState {
  return (
    states.find((state) => state.status === "critical") ??
    states.find((state) => state.status === "warning") ??
    states.find((state) => state.status === "open") ??
    { status: "normal", matchedRule: null }
  );
}

function statusTone(status: CrStatus): "default" | "warning" | "critical" {
  if (status === "critical") {
    return "critical";
  }
  if (status === "warning" || status === "open") {
    return "warning";
  }
  return "default";
}

function statusPillClass(status: CrStatus): string {
  switch (status) {
    case "critical":
      return "border-red-200 bg-red-100 text-red-800";
    case "warning":
      return "border-amber-200 bg-amber-100 text-amber-900";
    case "open":
      return "border-gray-200 bg-gray-100 text-gray-700";
    case "normal":
      return "border-bms-green/20 bg-bms-green/10 text-bms-green";
  }
}

function statusLabel(status: CrStatus): string {
  switch (status) {
    case "critical":
      return "CRITICAL";
    case "warning":
      return "WARN";
    case "open":
      return "OPEN";
    case "normal":
      return "OK";
  }
}

function ControlRoomOverviewContent() {
  const rulesQuery = useQuery({
    queryKey: ["rules"],
    queryFn: fetchRules,
    refetchInterval: 15_000,
  });
  const rules = rulesQuery.data?.items ?? [];
  const ups1 = useCr("CR-UPS-1");
  const ups2 = useCr("CR-UPS-2");
  const batt1 = useCr("CR-BATT-1");
  const batt2 = useCr("CR-BATT-2");
  const hvac1 = useCr("CR-HVAC-1");
  const hvac2 = useCr("CR-HVAC-2");
  const envConsole = useCr("CR-ENV-OP-CONSOLE");
  const envVideowall = useCr("CR-ENV-VIDEOWALL");
  const envRackA = useCr("CR-ENV-RACK-A");
  const envRackB = useCr("CR-ENV-RACK-B");
  const envBattery = useCr("CR-ENV-BATTERY-ROOM");
  const envUps = useCr("CR-ENV-UPS-ROOM");
  const leak1 = useCr("CR-LEAK-01");
  const leak2 = useCr("CR-LEAK-02");
  const leak3 = useCr("CR-LEAK-03");
  const leak4 = useCr("CR-LEAK-04");
  const smoke1 = useCr("CR-SMOKE-01");
  const smoke2 = useCr("CR-SMOKE-02");
  const smoke3 = useCr("CR-SMOKE-03");
  const smoke4 = useCr("CR-SMOKE-04");
  const netRack = useCr("CR-NET-RACK");
  const vwRack = useCr("CR-VW-SRV-RACK");
  const main = useCr("CR-Q1");
  const q2 = useCr("CR-Q2");
  const q3 = useCr("CR-Q3");
  const q4 = useCr("CR-Q4");
  const q5 = useCr("CR-Q5");
  const q6 = useCr("CR-Q6");
  const q7 = useCr("CR-Q7");
  const q8 = useCr("CR-Q8");
  const q9 = useCr("CR-Q9");
  const q10 = useCr("CR-Q10");
  const q11 = useCr("CR-Q11");
  const q12 = useCr("CR-Q12");
  const netPduA = useCr("CR-NET-RACK-PDU-A");
  const netPduB = useCr("CR-NET-RACK-PDU-B");
  const vwPduA = useCr("CR-VW-RACK-PDU-A");
  const vwPduB = useCr("CR-VW-RACK-PDU-B");
  const breakerSlices: Record<string, SchematicTelemetrySlice> = {
    "CR-Q1": main,
    "CR-Q2": q2,
    "CR-Q3": q3,
    "CR-Q4": q4,
    "CR-Q5": q5,
    "CR-Q6": q6,
    "CR-Q7": q7,
    "CR-Q8": q8,
    "CR-Q9": q9,
    "CR-Q10": q10,
    "CR-Q11": q11,
    "CR-Q12": q12,
  };
  const breakerStates = CR_BREAKERS.map((row) => ({
    code: row.code,
    state: deriveRuleState(row.code, breakerSlices[row.code], rules),
  }));
  const pduStates = [
    { code: "CR-NET-RACK-PDU-A", state: deriveRuleState("CR-NET-RACK-PDU-A", netPduA, rules) },
    { code: "CR-NET-RACK-PDU-B", state: deriveRuleState("CR-NET-RACK-PDU-B", netPduB, rules) },
    { code: "CR-VW-RACK-PDU-A", state: deriveRuleState("CR-VW-RACK-PDU-A", vwPduA, rules) },
    { code: "CR-VW-RACK-PDU-B", state: deriveRuleState("CR-VW-RACK-PDU-B", vwPduB, rules) },
  ];
  const upsStates = [
    { code: "CR-UPS-1", state: deriveRuleState("CR-UPS-1", ups1, rules) },
    { code: "CR-UPS-2", state: deriveRuleState("CR-UPS-2", ups2, rules) },
  ];
  const batteryStates = [
    { code: "CR-BATT-1", state: deriveRuleState("CR-BATT-1", batt1, rules) },
    { code: "CR-BATT-2", state: deriveRuleState("CR-BATT-2", batt2, rules) },
  ];
  const hvacStates = [
    { code: "CR-HVAC-1", state: deriveRuleState("CR-HVAC-1", hvac1, rules) },
    { code: "CR-HVAC-2", state: deriveRuleState("CR-HVAC-2", hvac2, rules) },
  ];
  const environmentStates = [
    { code: "CR-ENV-OP-CONSOLE", state: deriveRuleState("CR-ENV-OP-CONSOLE", envConsole, rules) },
    { code: "CR-ENV-VIDEOWALL", state: deriveRuleState("CR-ENV-VIDEOWALL", envVideowall, rules) },
    { code: "CR-ENV-RACK-A", state: deriveRuleState("CR-ENV-RACK-A", envRackA, rules) },
    { code: "CR-ENV-RACK-B", state: deriveRuleState("CR-ENV-RACK-B", envRackB, rules) },
    { code: "CR-ENV-BATTERY-ROOM", state: deriveRuleState("CR-ENV-BATTERY-ROOM", envBattery, rules) },
    { code: "CR-ENV-UPS-ROOM", state: deriveRuleState("CR-ENV-UPS-ROOM", envUps, rules) },
    { code: "CR-LEAK-01", state: deriveRuleState("CR-LEAK-01", leak1, rules) },
    { code: "CR-LEAK-02", state: deriveRuleState("CR-LEAK-02", leak2, rules) },
    { code: "CR-LEAK-03", state: deriveRuleState("CR-LEAK-03", leak3, rules) },
    { code: "CR-LEAK-04", state: deriveRuleState("CR-LEAK-04", leak4, rules) },
    { code: "CR-SMOKE-01", state: deriveRuleState("CR-SMOKE-01", smoke1, rules) },
    { code: "CR-SMOKE-02", state: deriveRuleState("CR-SMOKE-02", smoke2, rules) },
    { code: "CR-SMOKE-03", state: deriveRuleState("CR-SMOKE-03", smoke3, rules) },
    { code: "CR-SMOKE-04", state: deriveRuleState("CR-SMOKE-04", smoke4, rules) },
  ];
  const activeRuleStates = [
    ...breakerStates,
    ...pduStates,
    ...upsStates,
    ...batteryStates,
    ...hvacStates,
    ...environmentStates,
  ].filter(
    (item) => item.state.matchedRule,
  );
  const electricalStatus = mergeStatus(breakerStates.map((item) => item.state));
  const itStatus = mergeStatus(pduStates.map((item) => item.state));
  const upsStatus = mergeStatus(upsStates.map((item) => item.state));
  const batteryStatus = mergeStatus(batteryStates.map((item) => item.state));
  const hvacStatus = mergeStatus(hvacStates.map((item) => item.state));
  const environmentStatus = mergeStatus(environmentStates.map((item) => item.state));
  const totalLoad = (main.kw ?? 0) + (netRack.rackKw ?? 0) + (vwRack.rackKw ?? 0);
  const backupValues = [ups1.backupMin, ups2.backupMin].filter(
    (value): value is number => value !== null,
  );
  const worstBackup =
    backupValues.length > 0 ? Math.min(...backupValues) : null;
  const rackLoad = (netRack.rackKw ?? 0) + (vwRack.rackKw ?? 0);
  const batteryHealth =
    ((batt1.healthPct ?? 0) + (batt2.healthPct ?? 0)) /
    ([batt1.healthPct, batt2.healthPct].filter((value) => value !== null).length || 1);
  const avgReturnAir =
    ((hvac1.returnAirTempC ?? 0) + (hvac2.returnAirTempC ?? 0)) /
    ([hvac1.returnAirTempC, hvac2.returnAirTempC].filter((value) => value !== null).length || 1);
  const avgRoomTemp =
    [envConsole, envVideowall, envRackA, envRackB, envBattery, envUps].reduce(
      (sum, slice) => sum + (slice.temperatureC ?? 0),
      0,
    ) /
    ([envConsole, envVideowall, envRackA, envRackB, envBattery, envUps].filter(
      (slice) => slice.temperatureC !== null,
    ).length || 1);
  return (
    <div className="mx-auto max-w-[1320px] space-y-4 pb-8">
      <PageHeader
        eyebrow="R.crOv"
        title="SMOC Control Room · Main Dashboard"
        subtitle="Operator console overview · CR Electrical SLD · UPS · Battery · HVAC · Environment"
        actions={<StatusPill label="2D foundation" />}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiTile label="Rule Warnings" status="ready" value={String(activeRuleStates.length)} tone={activeRuleStates.length > 0 ? "warning" : "default"} hint="enabled CR rules currently matched" />
        <KpiTile label="Total CR Load" status="ready" value={n(totalLoad)} unit="kW" hint="main bus + IT racks" />
        <KpiTile label="SLD Status" status="ready" value={statusLabel(electricalStatus.status)} tone={statusTone(electricalStatus.status)} hint={electricalStatus.matchedRule?.name ?? "electrical feeders"} />
        <KpiTile label="Rack Load" status="ready" value={n(rackLoad)} unit="kW" tone={statusTone(itStatus.status)} hint={itStatus.matchedRule?.name ?? "network + videowall racks"} />
        <KpiTile label="UPS Backup" status="ready" value={n(worstBackup, 0)} unit="min" tone={statusTone(upsStatus.status)} hint={upsStatus.matchedRule?.name ?? "worst-case reported backup"} />
        <KpiTile label="Environment" status="ready" value={statusLabel(environmentStatus.status)} tone={statusTone(environmentStatus.status)} hint={environmentStatus.matchedRule?.name ?? `${n(avgRoomTemp, 1)} C avg room`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <section className="rounded border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-condensed text-lg font-bold text-bms-ink">
                Single Line Diagram · Power Flow
              </h2>
              <p className="text-xs text-bms-muted">
                Utility → Main Panel → 2x30 kVA UPS → critical loads
              </p>
            </div>
            <Link className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white" to="/cr-sld">
              Open Full SLD
            </Link>
          </div>
          <MiniSld rules={rules} />
        </section>

        <ActiveRulesPanel states={activeRuleStates} />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <ModuleSummaryCard title="UPS Monitoring" to="/cr-ups" status={upsStatus} primary={`${n(worstBackup, 0)} min`} secondary={`${n(ups1.loadPct, 0)}% / ${n(ups2.loadPct, 0)}% load`} />
        <ModuleSummaryCard title="Battery Bank" to="/cr-battery" status={batteryStatus} primary={`${n(batteryHealth, 0)}% health`} secondary={`${n(batt1.batteryTempC, 1)} C / ${n(batt2.batteryTempC, 1)} C`} />
        <ModuleSummaryCard title="HVAC System" to="/cr-hvac" status={hvacStatus} primary={`${n(avgReturnAir, 1)} C return`} secondary={`${n(hvac1.coolingKw, 1)} + ${n(hvac2.coolingKw, 1)} kW cooling`} />
        <ModuleSummaryCard title="Environment" to="/cr-env" status={environmentStatus} primary={`${n(avgRoomTemp, 1)} C avg`} secondary={`${environmentStates.filter((item) => item.state.matchedRule).length} active env rules`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ItRackLoadSummary rules={rules} />
        <CriticalSystemsSummary
          upsStatus={upsStatus}
          batteryStatus={batteryStatus}
          hvacStatus={hvacStatus}
          environmentStatus={environmentStatus}
        />
        <EnergySnapshot main={main} totalLoad={totalLoad} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <EnvironmentSnapshot
          avgTemp={avgRoomTemp}
          envStatus={environmentStatus}
          wetCount={environmentStates.filter((item) => item.code.startsWith("CR-LEAK") && item.state.status === "critical").length}
          smokeCount={environmentStates.filter((item) => item.code.startsWith("CR-SMOKE") && item.state.status === "critical").length}
        />
        <QuickDrilldown />
      </div>
    </div>
  );
}

function svgStroke(status: CrStatus): string {
  if (status === "critical") {
    return "#dc2626";
  }
  if (status === "warning") {
    return "#f59e0b";
  }
  if (status === "open") {
    return "#94a3b8";
  }
  return "#039855";
}

function svgBoxClass(status: CrStatus): string {
  if (status === "critical") {
    return "fill-red-50 stroke-red-600";
  }
  if (status === "warning") {
    return "fill-amber-50 stroke-amber-500";
  }
  if (status === "open") {
    return "fill-gray-100 stroke-gray-400";
  }
  return "fill-white stroke-bms-green";
}

function MiniSld({ rules }: { rules: RuleListItem[] }) {
  const q1 = useCr("CR-Q1");
  const q4 = useCr("CR-Q4");
  const q5 = useCr("CR-Q5");
  const q6 = useCr("CR-Q6");
  const q8 = useCr("CR-Q8");
  const q9 = useCr("CR-Q9");
  const q10 = useCr("CR-Q10");
  const ups1 = useCr("CR-UPS-1");
  const ups2 = useCr("CR-UPS-2");
  const hvac1 = useCr("CR-HVAC-1");
  const netRack = useCr("CR-NET-RACK");
  const vwRack = useCr("CR-VW-SRV-RACK");
  const q1State = deriveRuleState("CR-Q1", q1, rules);
  const q4State = deriveRuleState("CR-Q4", q4, rules);
  const q5State = deriveRuleState("CR-Q5", q5, rules);
  const q6State = deriveRuleState("CR-Q6", q6, rules);
  const q8State = deriveRuleState("CR-Q8", q8, rules);
  const q9State = deriveRuleState("CR-Q9", q9, rules);
  const q10State = deriveRuleState("CR-Q10", q10, rules);
  const netState = mergeStatus([q6State]);
  const vwState = mergeStatus([q8State, q9State]);
  return (
    <svg className="mt-4 h-auto w-full" viewBox="0 0 720 240">
      <line x1="92" y1="120" x2="148" y2="120" stroke={svgStroke(q1State.status)} strokeWidth={3} />
      <rect x="14" y="92" width="78" height="56" rx="6" className={svgBoxClass(q1State.status)} />
      <text x="53" y="118" textAnchor="middle" className="fill-bms-ink font-condensed text-[13px] font-bold">UTILITY</text>
      <text x="53" y="134" textAnchor="middle" className="fill-bms-muted font-mono text-[10px]">11 kV</text>
      <circle cx="170" cy="120" r="14" className={svgBoxClass(q1State.status)} strokeWidth={2} />
      <text x="170" y="124" textAnchor="middle" className="fill-bms-green font-mono text-[9px] font-bold">Q1</text>
      <line x1="184" y1="120" x2="240" y2="120" stroke={svgStroke(q1State.status)} strokeWidth={3} />
      <rect x="240" y="50" width="6" height="146" rx="2" fill={svgStroke(mergeStatus([q4State, q5State, q6State, q8State, q9State]).status)} />
      <SldMiniBranch y={80} label="UPS-1" sub={`${n(ups1.loadPct, 0)}% · ${n(ups1.backupMin, 0)} min`} status={q4State.status} />
      <SldMiniBranch y={120} label="UPS-2" sub={`${n(ups2.loadPct, 0)}% · ${n(ups2.backupMin, 0)} min`} status={q5State.status} />
      <SldMiniBranch y={170} label="HVAC 1" sub={`${n(hvac1.kw, 2)} kW`} status={q10State.status} />
      <rect x="478" y="58" width="120" height="44" rx="5" className={svgBoxClass(netState.status)} />
      <text x="538" y="84" textAnchor="middle" className="fill-bms-ink font-condensed text-[12px] font-bold">NETWORK RACK</text>
      <text x="538" y="97" textAnchor="middle" className="fill-bms-muted font-mono text-[9px]">{n(netRack.rackKw, 2)} kW</text>
      <line x1="410" y1="80" x2="478" y2="80" stroke={svgStroke(netState.status)} strokeWidth={3} />
      <rect x="478" y="110" width="120" height="44" rx="5" className={svgBoxClass(vwState.status)} />
      <text x="538" y="136" textAnchor="middle" className="fill-bms-ink font-condensed text-[12px] font-bold">VW SERVER</text>
      <text x="538" y="149" textAnchor="middle" className="fill-bms-muted font-mono text-[9px]">{n(vwRack.rackKw, 2)} kW</text>
      <line x1="410" y1="120" x2="478" y2="132" stroke={svgStroke(vwState.status)} strokeWidth={3} />
    </svg>
  );
}

function SldMiniBranch({
  y,
  label,
  sub,
  status,
}: {
  y: number;
  label: string;
  sub: string;
  status: CrStatus;
}) {
  return (
    <g>
      <line x1="246" y1={y} x2="320" y2={y} stroke={svgStroke(status)} strokeWidth={3} />
      <rect x="320" y={y - 22} width="90" height="44" rx="5" className={svgBoxClass(status)} />
      <text x="365" y={y - 2} textAnchor="middle" className="fill-bms-ink font-condensed text-[13px] font-bold">{label}</text>
      <text x="365" y={y + 12} textAnchor="middle" className="fill-bms-muted font-mono text-[9px]">{sub}</text>
    </g>
  );
}

function ModuleSummaryCard({
  title,
  to,
  status,
  primary,
  secondary,
}: {
  title: string;
  to: string;
  status: RuleState;
  primary: string;
  secondary: string;
}) {
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-bms-ink">{title}</h3>
          <p className="mt-1 text-xs text-bms-muted">{secondary}</p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusPillClass(status.status)}`}>
          {statusLabel(status.status)}
        </span>
      </div>
      <div className="mt-3 font-condensed text-2xl font-bold text-bms-ink">{primary}</div>
      {status.matchedRule ? (
        <p className="mt-2 text-xs font-medium text-amber-900">{status.matchedRule.name}</p>
      ) : null}
      <Link className="mt-3 inline-flex rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white" to={to}>
        Detail
      </Link>
    </div>
  );
}

function CriticalSystemsSummary({
  upsStatus,
  batteryStatus,
  hvacStatus,
  environmentStatus,
}: {
  upsStatus: RuleState;
  batteryStatus: RuleState;
  hvacStatus: RuleState;
  environmentStatus: RuleState;
}) {
  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="font-condensed text-lg font-bold text-bms-ink">
        Critical Systems Summary
      </h2>
      <div className="mt-3 space-y-2 text-sm">
        <StatusRow label="UPS" status={upsStatus} />
        <StatusRow label="Battery" status={batteryStatus} />
        <StatusRow label="HVAC" status={hvacStatus} />
        <StatusRow label="Environment" status={environmentStatus} />
      </div>
    </section>
  );
}

function StatusRow({ label, status }: { label: string; status: RuleState }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-bms-muted">{label}</span>
      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPillClass(status.status)}`}>
        {statusLabel(status.status)}
      </span>
    </div>
  );
}

function EnvironmentSnapshot({
  avgTemp,
  envStatus,
  wetCount,
  smokeCount,
}: {
  avgTemp: number | null;
  envStatus: RuleState;
  wetCount: number;
  smokeCount: number;
}) {
  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-condensed text-lg font-bold text-bms-ink">
          Environment Snapshot
        </h2>
        <Link className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white" to="/cr-env">
          Detail
        </Link>
      </div>
      <div className="mt-3 space-y-2 text-sm">
        <Row label="Avg room temp" value={`${n(avgTemp, 1)} C`} />
        <Row label="Leak sensors" value={`${wetCount} wet`} />
        <Row label="Smoke sensors" value={`${smokeCount} alerts`} />
        <Row label="Overall" value={statusLabel(envStatus.status)} />
      </div>
      {envStatus.matchedRule ? (
        <p className="mt-2 text-xs font-medium text-amber-900">{envStatus.matchedRule.name}</p>
      ) : null}
    </section>
  );
}

function ActiveRulesPanel({
  states,
}: {
  states: { code: string; state: RuleState }[];
}) {
  const active = states
    .filter((item) => item.state.matchedRule)
    .slice(0, 6);
  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-condensed text-lg font-bold text-bms-ink">
            Active Rule Warnings
          </h2>
          <p className="text-xs text-bms-muted">
            SLD, IT, UPS, Battery, HVAC, and Environment rules
          </p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${active.length > 0 ? "border-amber-200 bg-amber-100 text-amber-900" : "border-bms-green/20 bg-bms-green/10 text-bms-green"}`}>
          {active.length} active
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {active.length === 0 ? (
          <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-bms-muted">
            No enabled CR SLD or rack-power rules are currently matched.
          </div>
        ) : (
          active.map((item) => (
            <div key={`${item.code}-${item.state.matchedRule?.id}`} className={`rounded border p-3 text-sm ${statusPillClass(item.state.status)}`}>
              <div className="font-semibold">{item.code}</div>
              <div className="mt-1 text-xs">{item.state.matchedRule?.name}</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ItRackLoadSummary({ rules }: { rules: RuleListItem[] }) {
  const net = useCr("CR-NET-RACK");
  const vw = useCr("CR-VW-SRV-RACK");
  const netA = useCr("CR-NET-RACK-PDU-A");
  const netB = useCr("CR-NET-RACK-PDU-B");
  const vwA = useCr("CR-VW-RACK-PDU-A");
  const vwB = useCr("CR-VW-RACK-PDU-B");
  const netState = mergeStatus([
    deriveRuleState("CR-NET-RACK-PDU-A", netA, rules),
    deriveRuleState("CR-NET-RACK-PDU-B", netB, rules),
  ]);
  const vwState = mergeStatus([
    deriveRuleState("CR-VW-RACK-PDU-A", vwA, rules),
    deriveRuleState("CR-VW-RACK-PDU-B", vwB, rules),
  ]);
  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-condensed text-lg font-bold text-bms-ink">
          IT Rack Load
        </h2>
        <Link className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white" to="/cr-it">
          Detail
        </Link>
      </div>
      <div className="mt-4 space-y-4">
        <RackLoadRow title="Network Rack" load={net.rackKw} rated={3} outlets={net.outletsUsed} source="UPS-1" status={netState} />
        <RackLoadRow title="Videowall Server Rack" load={vw.rackKw} rated={2} outlets={vw.outletsUsed} source="UPS-2" status={vwState} />
      </div>
    </section>
  );
}

function RackLoadRow({
  title,
  load,
  rated,
  outlets,
  source,
  status,
}: {
  title: string;
  load: number | null;
  rated: number;
  outlets: number | null;
  source: string;
  status: RuleState;
}) {
  const pct = load == null ? 0 : Math.min(100, (load / rated) * 100);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-bms-ink">{title}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPillClass(status.status)}`}>
          {statusLabel(status.status)}
        </span>
      </div>
      <div className="mt-2 h-2 rounded bg-gray-200">
        <div className="h-2 rounded bg-bms-green" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-bms-muted">
        <span>{n(load, 2)} kW / {rated.toFixed(1)} kW</span>
        <span className="text-right">{n(outlets, 0)}/24 outlets</span>
        <span>UPS source</span>
        <span className="text-right font-mono text-bms-ink">{source}</span>
      </div>
      {status.matchedRule ? (
        <p className="mt-2 text-xs font-medium text-amber-900">{status.matchedRule.name}</p>
      ) : null}
    </div>
  );
}

function EnergySnapshot({
  main,
  totalLoad,
}: {
  main: SchematicTelemetrySlice;
  totalLoad: number;
}) {
  const kva = main.pf ? totalLoad / main.pf : null;
  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="font-condensed text-lg font-bold text-bms-ink">
        Energy Snapshot
      </h2>
      <div className="mt-3 space-y-2 text-sm">
        <Row label="Real Power" value={`${n(totalLoad, 2)} kW`} />
        <Row label="Apparent" value={`${n(kva, 2)} kVA`} />
        <Row label="Power Factor" value={`${n(main.pf, 2)} lag`} />
        <Row label="kWh Today" value={`${n(main.kwhToday, 1)} kWh`} />
        <Row label="Frequency" value={`${n(main.frequencyHz, 2)} Hz`} />
      </div>
      <div className="mt-3 h-10 rounded bg-gradient-to-r from-bms-green/20 via-bms-green to-amber-400" />
      <p className="mt-1 text-center font-mono text-[10px] text-bms-muted">
        Live CR load · current simulator window
      </p>
    </section>
  );
}

function QuickDrilldown() {
  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="font-condensed text-lg font-bold text-bms-ink">
        Quick Drilldown
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Link className="rounded border border-bms-green/30 bg-bms-green/10 p-3 font-semibold text-bms-green hover:bg-bms-green/15" to="/cr-sld">
          Electrical SLD
        </Link>
        <Link className="rounded border border-bms-green/30 bg-bms-green/10 p-3 font-semibold text-bms-green hover:bg-bms-green/15" to="/cr-it">
          IT & Racks
        </Link>
        <Link className="rounded border border-bms-green/30 bg-bms-green/10 p-3 font-semibold text-bms-green hover:bg-bms-green/15" to="/cr-ups">
          UPS Monitoring
        </Link>
        <Link className="rounded border border-bms-green/30 bg-bms-green/10 p-3 font-semibold text-bms-green hover:bg-bms-green/15" to="/cr-battery">
          Battery Bank
        </Link>
        <Link className="rounded border border-bms-green/30 bg-bms-green/10 p-3 font-semibold text-bms-green hover:bg-bms-green/15" to="/cr-hvac">
          HVAC System
        </Link>
        <Link className="rounded border border-bms-green/30 bg-bms-green/10 p-3 font-semibold text-bms-green hover:bg-bms-green/15" to="/cr-env">
          Environment
        </Link>
        {["Security", "Trends"].map((label) => (
          <span key={label} className="cursor-not-allowed rounded border border-gray-200 p-3 text-bms-muted">
            {label} · deferred
          </span>
        ))}
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-bms-muted">{label}</span>
      <span className="font-mono font-semibold text-bms-ink">{value}</span>
    </div>
  );
}

export function ControlRoomOverviewPage({ user }: ControlRoomOverviewPageProps) {
  return (
    <AppShell
      user={user}
      kpiRibbon={<span className="text-bms-ink">IBMS Control Room · Main Dashboard</span>}
    >
      <SchematicTelemetryProvider
        assetCodes={CR_TRACKED_ASSET_CODES}
        pointKeys={CR_POINT_KEYS}
      >
        <ControlRoomOverviewContent />
      </SchematicTelemetryProvider>
    </AppShell>
  );
}
