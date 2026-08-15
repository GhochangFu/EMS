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
import { StaticTspan } from "../components/static-value";
import { StatusPill } from "../components/status-pill";
import { AppShell } from "../layouts/app-shell";
import { freshValue, isStale } from "../lib/schematic-telemetry";
import { canAccessControlRoomArea } from "../lib/control-room-access";
import { useAuthStore, type AuthUser } from "../stores/auth-store";

type ControlRoomOverviewPageProps = {
  user: AuthUser;
};

function n(value: number | null, digits = 1): string {
  return value == null || Number.isNaN(value) ? "—" : value.toFixed(digits);
}

function useCr(code: string) {
  return useSchematicTelemetryByCode(code).slice;
}

/**
 * `offline` is distinct from `open` on purpose (ADR 0027 decision 5): `open`
 * means the breaker is open — knowledge about the plant — while `offline` means
 * we can no longer see the asset at all. Overloading one for the other would
 * make a disconnected breaker and a dead feed indistinguishable on the page
 * where breaker state matters most.
 */
type CrStatus = "normal" | "warning" | "critical" | "open" | "offline";

type RuleState = {
  status: CrStatus;
  matchedRule: RuleListItem | null;
  /** True when the asset has stopped reporting (ADR 0027). */
  stale: boolean;
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

/**
 * Tile status for one asset (ADR 0027).
 *
 * Staleness precedes the breaker test, and the two answers are different:
 * `open` asserts the breaker is open, which is only knowable from a current
 * reading. Once telemetry stops, `slice.breaker` is a frozen value and the page
 * must say `NO DATA` rather than keep asserting a breaker position.
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
  if (slice.breaker === 0) {
    return { status: "open", matchedRule: null, stale: false };
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

function mergeStatus(states: RuleState[]): RuleState {
  return (
    states.find((state) => state.status === "offline") ??
    states.find((state) => state.status === "critical") ??
    states.find((state) => state.status === "warning") ??
    states.find((state) => state.status === "open") ??
    { status: "normal", matchedRule: null, stale: false }
  );
}

function statusTone(status: CrStatus): "default" | "warning" | "critical" {
  if (status === "critical") {
    return "critical";
  }
  if (status === "warning" || status === "open" || status === "offline") {
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
    // Deliberately not the same muted grey as `open`: an open breaker is a
    // known plant state, a stale tile is an absence of knowledge, and an
    // operator must be able to tell them apart at a glance (ADR 0027).
    case "offline":
      return "border-gray-300 bg-gray-200 text-gray-600";
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
    case "offline":
      return "OFFLINE";
    case "normal":
      return "OK";
  }
}

function ControlRoomOverviewContent() {
  const scope = useAuthStore((state) => state.scope);
  const canElectrical = canAccessControlRoomArea(scope, "electrical");
  const canIt = canAccessControlRoomArea(scope, "it");
  const canUpsBattery = canAccessControlRoomArea(scope, "upsBattery");
  const canHvac = canAccessControlRoomArea(scope, "hvac");
  const canEnvironment = canAccessControlRoomArea(scope, "environment");
  const rulesQuery = useQuery({
    queryKey: ["rules"],
    queryFn: fetchRules,
    refetchInterval: 15_000,
  });
  const rules = rulesQuery.data?.items ?? [];
  // One clock per render. Thirty inline `Date.now()` calls could straddle a
  // millisecond boundary and made the staleness decision non-uniform across a
  // single frame.
  const nowMs = Date.now();
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
    state: deriveRuleState(row.code, breakerSlices[row.code], rules, nowMs),
  }));
  const pduStates = [
    { code: "CR-NET-RACK-PDU-A", state: deriveRuleState("CR-NET-RACK-PDU-A", netPduA, rules, nowMs) },
    { code: "CR-NET-RACK-PDU-B", state: deriveRuleState("CR-NET-RACK-PDU-B", netPduB, rules, nowMs) },
    { code: "CR-VW-RACK-PDU-A", state: deriveRuleState("CR-VW-RACK-PDU-A", vwPduA, rules, nowMs) },
    { code: "CR-VW-RACK-PDU-B", state: deriveRuleState("CR-VW-RACK-PDU-B", vwPduB, rules, nowMs) },
  ];
  const upsStates = [
    { code: "CR-UPS-1", state: deriveRuleState("CR-UPS-1", ups1, rules, nowMs) },
    { code: "CR-UPS-2", state: deriveRuleState("CR-UPS-2", ups2, rules, nowMs) },
  ];
  const batteryStates = [
    { code: "CR-BATT-1", state: deriveRuleState("CR-BATT-1", batt1, rules, nowMs) },
    { code: "CR-BATT-2", state: deriveRuleState("CR-BATT-2", batt2, rules, nowMs) },
  ];
  const hvacStates = [
    { code: "CR-HVAC-1", state: deriveRuleState("CR-HVAC-1", hvac1, rules, nowMs) },
    { code: "CR-HVAC-2", state: deriveRuleState("CR-HVAC-2", hvac2, rules, nowMs) },
  ];
  const environmentStates = [
    { code: "CR-ENV-OP-CONSOLE", state: deriveRuleState("CR-ENV-OP-CONSOLE", envConsole, rules, nowMs) },
    { code: "CR-ENV-VIDEOWALL", state: deriveRuleState("CR-ENV-VIDEOWALL", envVideowall, rules, nowMs) },
    { code: "CR-ENV-RACK-A", state: deriveRuleState("CR-ENV-RACK-A", envRackA, rules, nowMs) },
    { code: "CR-ENV-RACK-B", state: deriveRuleState("CR-ENV-RACK-B", envRackB, rules, nowMs) },
    { code: "CR-ENV-BATTERY-ROOM", state: deriveRuleState("CR-ENV-BATTERY-ROOM", envBattery, rules, nowMs) },
    { code: "CR-ENV-UPS-ROOM", state: deriveRuleState("CR-ENV-UPS-ROOM", envUps, rules, nowMs) },
    { code: "CR-LEAK-01", state: deriveRuleState("CR-LEAK-01", leak1, rules, nowMs) },
    { code: "CR-LEAK-02", state: deriveRuleState("CR-LEAK-02", leak2, rules, nowMs) },
    { code: "CR-LEAK-03", state: deriveRuleState("CR-LEAK-03", leak3, rules, nowMs) },
    { code: "CR-LEAK-04", state: deriveRuleState("CR-LEAK-04", leak4, rules, nowMs) },
    { code: "CR-SMOKE-01", state: deriveRuleState("CR-SMOKE-01", smoke1, rules, nowMs) },
    { code: "CR-SMOKE-02", state: deriveRuleState("CR-SMOKE-02", smoke2, rules, nowMs) },
    { code: "CR-SMOKE-03", state: deriveRuleState("CR-SMOKE-03", smoke3, rules, nowMs) },
    { code: "CR-SMOKE-04", state: deriveRuleState("CR-SMOKE-04", smoke4, rules, nowMs) },
  ];
  const activeRuleStates = [
    ...(canElectrical ? breakerStates : []),
    ...(canIt ? pduStates : []),
    ...(canUpsBattery ? [...upsStates, ...batteryStates] : []),
    ...(canHvac ? hvacStates : []),
    ...(canEnvironment ? environmentStates : []),
  ].filter(
    (item) => item.state.matchedRule,
  );
  const electricalStatus = mergeStatus(breakerStates.map((item) => item.state));
  const itStatus = mergeStatus(pduStates.map((item) => item.state));
  const upsStatus = mergeStatus(upsStates.map((item) => item.state));
  const batteryStatus = mergeStatus(batteryStates.map((item) => item.state));
  const hvacStatus = mergeStatus(hvacStates.map((item) => item.state));
  const environmentStatus = mergeStatus(environmentStates.map((item) => item.state));
  // ADR 0027 decision 4. These used `?? 0`, so a dead asset counted as zero
  // load / zero degrees and the KPI read as measured. `liveOnly` keeps `null`
  // ("nothing reporting") distinct from a genuine `0`.
  const liveOnly = (values: Array<[SchematicTelemetrySlice, number | null]>) => {
    const kept = values
      .filter(([slice]) => !isStale(slice.lastSeenMs, nowMs))
      .map(([, v]) => v)
      .filter((v): v is number => v != null && !Number.isNaN(v));
    return kept.length === 0 ? null : kept;
  };
  const sumLive = (values: Array<[SchematicTelemetrySlice, number | null]>) => {
    const kept = liveOnly(values);
    return kept === null ? null : kept.reduce((a, b) => a + b, 0);
  };
  const avgLive = (values: Array<[SchematicTelemetrySlice, number | null]>) => {
    const kept = liveOnly(values);
    return kept === null ? null : kept.reduce((a, b) => a + b, 0) / kept.length;
  };
  const totalLoad = sumLive([
    [main, main.kw],
    [netRack, netRack.rackKw],
    [vwRack, vwRack.rackKw],
  ]);
  const backupValues = liveOnly([
    [ups1, ups1.backupMin],
    [ups2, ups2.backupMin],
  ]);
  const worstBackup = backupValues === null ? null : Math.min(...backupValues);
  const rackLoad = sumLive([
    [netRack, netRack.rackKw],
    [vwRack, vwRack.rackKw],
  ]);
  const batteryHealth = avgLive([
    [batt1, batt1.healthPct],
    [batt2, batt2.healthPct],
  ]);
  const avgReturnAir = avgLive([
    [hvac1, hvac1.returnAirTempC],
    [hvac2, hvac2.returnAirTempC],
  ]);
  // The literal "a dead zone counted as 0 C" case.
  const avgRoomTemp = avgLive(
    [envConsole, envVideowall, envRackA, envRackB, envBattery, envUps].map(
      (slice) => [slice, slice.temperatureC] as [SchematicTelemetrySlice, number | null],
    ),
  );
  // ADR 0027 decision 2's mitigation on the page an operator opens first: with
  // `offline` outranking `critical`, one dead sensor turns a domain banner
  // OFFLINE while a live sensor is genuinely critical. This count is computed
  // from the per-asset states, which mergeStatus cannot outrank.
  const liveCritical = [
    ...breakerStates,
    ...pduStates,
    ...upsStates,
    ...batteryStates,
    ...hvacStates,
    ...environmentStates,
  ].filter((item) => item.state.status === "critical").length;
  return (
    <div className="mx-auto max-w-[1320px] space-y-4 pb-8">
      <PageHeader
        eyebrow="R.crOv"
        title="SMOC Control Room · Main Dashboard"
        subtitle={
          liveCritical > 0
            ? `${liveCritical} ACTIVE CRITICAL · operator console overview · SLD · UPS · Battery · HVAC · Environment`
            : "Operator console overview · CR Electrical SLD · UPS · Battery · HVAC · Environment"
        }
        actions={<StatusPill label="2D foundation" />}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiTile label="Rule Warnings" status="ready" value={String(activeRuleStates.length)} tone={activeRuleStates.length > 0 ? "warning" : "default"} hint="enabled rules inside your CR scope" />
        <KpiTile label="Total CR Load" status={canElectrical || canIt ? "ready" : "empty"} value={canElectrical || canIt ? n(totalLoad) : null} unit="kW" hint={canElectrical || canIt ? "main bus + IT racks" : "outside your asset-group scope"} />
        <KpiTile label="SLD Status" status={canElectrical ? "ready" : "empty"} value={canElectrical ? statusLabel(electricalStatus.status) : null} tone={statusTone(electricalStatus.status)} hint={canElectrical ? electricalStatus.matchedRule?.name ?? "electrical feeders" : "outside your asset-group scope"} />
        <KpiTile label="Rack Load" status={canIt ? "ready" : "empty"} value={canIt ? n(rackLoad) : null} unit="kW" tone={statusTone(itStatus.status)} hint={canIt ? itStatus.matchedRule?.name ?? "network + videowall racks" : "outside your asset-group scope"} />
        <KpiTile label="UPS Backup" status={canUpsBattery ? "ready" : "empty"} value={canUpsBattery ? n(worstBackup, 0) : null} unit="min" tone={statusTone(upsStatus.status)} hint={canUpsBattery ? upsStatus.matchedRule?.name ?? "worst-case reported backup" : "outside your asset-group scope"} />
        <KpiTile label="Environment" status={canEnvironment ? "ready" : "empty"} value={canEnvironment ? statusLabel(environmentStatus.status) : null} tone={statusTone(environmentStatus.status)} hint={canEnvironment ? environmentStatus.matchedRule?.name ?? `${n(avgRoomTemp, 1)} C avg room` : "outside your asset-group scope"} />
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
            <ScopedActionLink enabled={canElectrical} to="/cr-sld" label="Open Full SLD" />
          </div>
          {canElectrical ? <MiniSld rules={rules} /> : <ScopedUnavailable label="Electrical SLD" />}
        </section>

        <ActiveRulesPanel states={activeRuleStates} />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <ModuleSummaryCard enabled={canUpsBattery} title="UPS Monitoring" to="/cr-ups" status={upsStatus} primary={`${n(worstBackup, 0)} min`} secondary={`${n(freshValue(ups1.loadPct, isStale(ups1.lastSeenMs, nowMs)), 0)}% / ${n(freshValue(ups2.loadPct, isStale(ups2.lastSeenMs, nowMs)), 0)}% load`} />
        <ModuleSummaryCard enabled={canUpsBattery} title="Battery Bank" to="/cr-battery" status={batteryStatus} primary={`${n(batteryHealth, 0)}% health`} secondary={`${n(freshValue(batt1.batteryTempC, isStale(batt1.lastSeenMs, nowMs)), 1)} C / ${n(freshValue(batt2.batteryTempC, isStale(batt2.lastSeenMs, nowMs)), 1)} C`} />
        <ModuleSummaryCard enabled={canHvac} title="HVAC System" to="/cr-hvac" status={hvacStatus} primary={`${n(avgReturnAir, 1)} C return`} secondary={`${n(freshValue(hvac1.coolingKw, isStale(hvac1.lastSeenMs, nowMs)), 1)} + ${n(freshValue(hvac2.coolingKw, isStale(hvac2.lastSeenMs, nowMs)), 1)} kW cooling`} />
        <ModuleSummaryCard enabled={canEnvironment} title="Environment" to="/cr-env" status={environmentStatus} primary={`${n(avgRoomTemp, 1)} C avg`} secondary={`${environmentStates.filter((item) => item.state.matchedRule).length} active env rules`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ItRackLoadSummary enabled={canIt} rules={rules} />
        <CriticalSystemsSummary
          access={{ upsBattery: canUpsBattery, hvac: canHvac, environment: canEnvironment }}
          upsStatus={upsStatus}
          batteryStatus={batteryStatus}
          hvacStatus={hvacStatus}
          environmentStatus={environmentStatus}
        />
        <EnergySnapshot enabled={canElectrical || canIt} main={main} totalLoad={totalLoad} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <EnvironmentSnapshot
          enabled={canEnvironment}
          avgTemp={avgRoomTemp}
          envStatus={environmentStatus}
          wetCount={environmentStates.filter((item) => item.code.startsWith("CR-LEAK") && item.state.status === "critical").length}
          smokeCount={environmentStates.filter((item) => item.code.startsWith("CR-SMOKE") && item.state.status === "critical").length}
        />
        <QuickDrilldown
          access={{
            electrical: canElectrical,
            it: canIt,
            upsBattery: canUpsBattery,
            hvac: canHvac,
            environment: canEnvironment,
          }}
        />
      </div>
    </div>
  );
}

function svgStroke(status: CrStatus): string {
  // Ahead of every other arm: the default below is the *healthy* colour, so an
  // unnamed status draws as an energised green path.
  if (status === "offline") {
    return "#94a3b8";
  }
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
  if (status === "offline") {
    return "fill-gray-200 stroke-gray-400";
  }
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
  const q1State = deriveRuleState("CR-Q1", q1, rules, Date.now());
  const q4State = deriveRuleState("CR-Q4", q4, rules, Date.now());
  const q5State = deriveRuleState("CR-Q5", q5, rules, Date.now());
  const q6State = deriveRuleState("CR-Q6", q6, rules, Date.now());
  const q8State = deriveRuleState("CR-Q8", q8, rules, Date.now());
  const q9State = deriveRuleState("CR-Q9", q9, rules, Date.now());
  const q10State = deriveRuleState("CR-Q10", q10, rules, Date.now());
  const netState = mergeStatus([q6State]);
  const vwState = mergeStatus([q8State, q9State]);
  return (
    <svg className="mt-4 h-auto w-full" viewBox="0 0 720 240">
      <line x1="92" y1="120" x2="148" y2="120" stroke={svgStroke(q1State.status)} strokeWidth={3} />
      <rect x="14" y="92" width="78" height="56" rx="6" className={svgBoxClass(q1State.status)} />
      <text x="53" y="118" textAnchor="middle" className="fill-bms-ink font-condensed text-[13px] font-bold">UTILITY</text>
      <text x="53" y="134" textAnchor="middle" className="fill-bms-muted font-mono text-[10px]"><StaticTspan kind="nameplate">11 kV</StaticTspan></text>
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
  enabled,
  title,
  to,
  status,
  primary,
  secondary,
}: {
  enabled: boolean;
  title: string;
  to: string;
  status: RuleState;
  primary: string;
  secondary: string;
}) {
  return (
    <div className={`rounded border border-gray-200 bg-white p-4 ${enabled ? "" : "opacity-70"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-bms-ink">{title}</h3>
          <p className="mt-1 text-xs text-bms-muted">
            {enabled ? secondary : "Outside your asset-group scope"}
          </p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${enabled ? statusPillClass(status.status) : "border-gray-200 bg-gray-100 text-gray-600"}`}>
          {enabled ? statusLabel(status.status) : "LOCKED"}
        </span>
      </div>
      <div className="mt-3 font-condensed text-2xl font-bold text-bms-ink">
        {enabled ? primary : "—"}
      </div>
      {enabled && status.matchedRule ? (
        <p className="mt-2 text-xs font-medium text-amber-900">{status.matchedRule.name}</p>
      ) : null}
      <ScopedActionLink enabled={enabled} to={to} label="Detail" className="mt-3" />
    </div>
  );
}

function CriticalSystemsSummary({
  access,
  upsStatus,
  batteryStatus,
  hvacStatus,
  environmentStatus,
}: {
  access: { upsBattery: boolean; hvac: boolean; environment: boolean };
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
        <StatusRow enabled={access.upsBattery} label="UPS" status={upsStatus} />
        <StatusRow enabled={access.upsBattery} label="Battery" status={batteryStatus} />
        <StatusRow enabled={access.hvac} label="HVAC" status={hvacStatus} />
        <StatusRow enabled={access.environment} label="Environment" status={environmentStatus} />
      </div>
    </section>
  );
}

function StatusRow({
  enabled,
  label,
  status,
}: {
  enabled: boolean;
  label: string;
  status: RuleState;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={enabled ? "text-bms-muted" : "text-gray-400"}>{label}</span>
      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${enabled ? statusPillClass(status.status) : "border-gray-200 bg-gray-100 text-gray-600"}`}>
        {enabled ? statusLabel(status.status) : "LOCKED"}
      </span>
    </div>
  );
}

function EnvironmentSnapshot({
  enabled,
  avgTemp,
  envStatus,
  wetCount,
  smokeCount,
}: {
  enabled: boolean;
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
        <ScopedActionLink enabled={enabled} to="/cr-env" label="Detail" />
      </div>
      <div className="mt-3 space-y-2 text-sm">
        <Row label="Avg room temp" value={enabled ? `${n(avgTemp, 1)} C` : "—"} />
        <Row label="Leak sensors" value={enabled ? `${wetCount} wet` : "—"} />
        <Row label="Smoke sensors" value={enabled ? `${smokeCount} alerts` : "—"} />
        <Row label="Overall" value={enabled ? statusLabel(envStatus.status) : "Locked"} />
      </div>
      {!enabled ? (
        <p className="mt-2 text-xs text-bms-muted">Outside your asset-group scope.</p>
      ) : envStatus.matchedRule ? (
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

function ItRackLoadSummary({
  enabled,
  rules,
}: {
  enabled: boolean;
  rules: RuleListItem[];
}) {
  const net = useCr("CR-NET-RACK");
  const vw = useCr("CR-VW-SRV-RACK");
  const netA = useCr("CR-NET-RACK-PDU-A");
  const netB = useCr("CR-NET-RACK-PDU-B");
  const vwA = useCr("CR-VW-RACK-PDU-A");
  const vwB = useCr("CR-VW-RACK-PDU-B");
  const netState = mergeStatus([
    deriveRuleState("CR-NET-RACK-PDU-A", netA, rules, Date.now()),
    deriveRuleState("CR-NET-RACK-PDU-B", netB, rules, Date.now()),
  ]);
  const vwState = mergeStatus([
    deriveRuleState("CR-VW-RACK-PDU-A", vwA, rules, Date.now()),
    deriveRuleState("CR-VW-RACK-PDU-B", vwB, rules, Date.now()),
  ]);
  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-condensed text-lg font-bold text-bms-ink">
          IT Rack Load
        </h2>
        <ScopedActionLink enabled={enabled} to="/cr-it" label="Detail" />
      </div>
      {enabled ? (
        <div className="mt-4 space-y-4">
          <RackLoadRow title="Network Rack" load={net.rackKw} rated={3} outlets={net.outletsUsed} source="UPS-1" status={netState} />
          <RackLoadRow title="Videowall Server Rack" load={vw.rackKw} rated={2} outlets={vw.outletsUsed} source="UPS-2" status={vwState} />
        </div>
      ) : (
        <ScopedUnavailable label="IT Rack Load" />
      )}
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
  enabled,
  main,
  totalLoad,
}: {
  enabled: boolean;
  main: SchematicTelemetrySlice;
  totalLoad: number | null;
}) {
  // ADR 0027 decision 3: once the main incomer stops reporting, its last pf /
  // kWh / frequency are no longer readings and must not render as though they
  // were. `totalLoad` is already gated upstream by `ctx.totalKw`.
  const mainStale = isStale(main.lastSeenMs, Date.now());
  const kva = main.pf && !mainStale && totalLoad !== null ? totalLoad / main.pf : null;
  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="font-condensed text-lg font-bold text-bms-ink">
        Energy Snapshot
      </h2>
      <div className="mt-3 space-y-2 text-sm">
        <Row label="Real Power" value={enabled ? `${n(totalLoad, 2)} kW` : "—"} />
        <Row label="Apparent" value={enabled ? `${n(kva, 2)} kVA` : "—"} />
        <Row label="Power Factor" value={enabled ? `${n(freshValue(main.pf, mainStale), 2)} lag` : "—"} />
        <Row label="kWh Today" value={enabled ? `${n(freshValue(main.kwhToday, mainStale), 1)} kWh` : "—"} />
        <Row label="Frequency" value={enabled ? `${n(freshValue(main.frequencyHz, mainStale), 2)} Hz` : "—"} />
      </div>
      <div className={`mt-3 h-10 rounded ${enabled ? "bg-gradient-to-r from-bms-green/20 via-bms-green to-amber-400" : "bg-gray-100"}`} />
      <p className="mt-1 text-center font-mono text-[10px] text-bms-muted">
        {enabled ? "Live CR load · current simulator window" : "Outside your asset-group scope"}
      </p>
    </section>
  );
}

function QuickDrilldown({
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

function ScopedActionLink({
  enabled,
  to,
  label,
  className = "",
}: {
  enabled: boolean;
  to: string;
  label: string;
  className?: string;
}) {
  const classes = `${className} inline-flex rounded px-3 py-1.5 text-xs font-semibold ${
    enabled
      ? "bg-bms-green text-white"
      : "cursor-not-allowed bg-gray-100 text-gray-500"
  }`;
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

function ScopedUnavailable({ label }: { label: string }) {
  return (
    <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-4 text-sm text-bms-muted">
      {label} is outside your assigned asset-group scope.
    </div>
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
