import { useState, type ReactNode } from "react";
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
import { StaticTspan, StaticValue } from "../components/static-value";
import { AppShell } from "../layouts/app-shell";
import {
  freshValue,
  ownElse,
  isStale,
  STALE_VALUE,
} from "../lib/schematic-telemetry";
import type { AuthUser } from "../stores/auth-store";

type ControlRoomUpsPageProps = {
  user: AuthUser;
};

type UpsTab = "CR-UPS-1" | "CR-UPS-2" | "combined";
type UpsStatus = "normal" | "warning" | "critical" | "offline";

type RuleState = {
  status: UpsStatus;
  matchedRule: RuleListItem | null;
  /** True when the asset has stopped reporting (ADR 0027). */
  stale: boolean;
};

const UPS_UNITS = [
  { code: "CR-UPS-1", label: "UPS-1", batteryCode: "CR-BATT-1", capacityKva: 30 },
  { code: "CR-UPS-2", label: "UPS-2", batteryCode: "CR-BATT-2", capacityKva: 30 },
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
    case "load_pct":
      return slice.loadPct;
    case "output_voltage_v":
      return slice.outputVoltageV;
    case "output_freq_hz":
      return slice.outputFreqHz;
    case "battery_v":
      return slice.batteryV;
    case "battery_temp_c":
      return slice.batteryTempC;
    case "backup_min":
      return slice.backupMin;
    case "health_pct":
      return slice.healthPct;
    case "kw":
      return slice.kw;
    case "current_a":
      return slice.current;
    default:
      return null;
  }
}

function severityStatus(severity: string | null): UpsStatus {
  return severity === "critical" ? "critical" : "warning";
}

/**
 * Tile status for one asset (ADR 0027).
 *
 * **Two different things both render `offline` here and the order matters.**
 * The existing `breaker === 0 || healthPct === 0` test is a statement about the
 * *plant* — disconnected, or a dead string — read from the last values we
 * received. Staleness is a statement about our *knowledge*, and it has to come
 * first: those two fields are frozen once telemetry stops, so a unit that died
 * while healthy reported `normal` for ever, and one that died tripped kept
 * asserting a trip nobody could confirm.
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
  if (slice.breaker === 0 || slice.healthPct === 0) {
    return { status: "offline", matchedRule: null, stale: false };
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

function statusLabel(status: UpsStatus): string {
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

function statusPillClass(status: UpsStatus): string {
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

function statusTone(status: UpsStatus): "default" | "warning" | "critical" {
  if (status === "critical") {
    return "critical";
  }
  if (status === "warning" || status === "offline") {
    return "warning";
  }
  return "default";
}

function stroke(status: UpsStatus): string {
  if (status === "critical") {
    return "#dc2626";
  }
  if (status === "warning") {
    return "#f59e0b";
  }
  if (status === "offline") {
    return "#94a3b8";
  }
  return "#039855";
}

function boxClass(status: UpsStatus): string {
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

function modeFor(slice: SchematicTelemetrySlice, status: UpsStatus): string {
  if (status === "offline") {
    return "offline";
  }
  if ((slice.backupMin ?? 0) < 15) {
    return "battery";
  }
  return "online";
}

function capacityKw(loadPct: number | null, capacityKva: number): number | null {
  return loadPct == null ? null : (loadPct / 100) * capacityKva * 0.9;
}

function ControlRoomUpsContent() {
  const [tab, setTab] = useState<UpsTab>("CR-UPS-1");
  const rulesQuery = useQuery({
    queryKey: ["rules", "cr-ups"],
    queryFn: fetchRules,
    refetchInterval: 15_000,
  });
  const rules = rulesQuery.data?.items ?? [];
  const ups1 = useCr("CR-UPS-1");
  const ups2 = useCr("CR-UPS-2");
  const batt1 = useCr("CR-BATT-1");
  const batt2 = useCr("CR-BATT-2");
  const nowMs = Date.now();
  const units = [
    // `battStale` is the **battery** asset's clock. The Battery card below reads
    // some values from `CR-BATT-n` rather than from the UPS, and gating those on
    // the UPS's flag lets a dead string keep rendering its last volts, current
    // and temperature for as long as its UPS reports. Pre-existing, and the
    // mirror image of the defect F4.39 fixed on the Battery page — raised by the
    // same review, fixed here because it is the same one-line class of error.
    { ...UPS_UNITS[0], slice: ups1, battery: batt1, battStale: isStale(batt1.lastSeenMs, nowMs), state: deriveRuleState("CR-UPS-1", ups1, rules, nowMs) },
    { ...UPS_UNITS[1], slice: ups2, battery: batt2, battStale: isStale(batt2.lastSeenMs, nowMs), state: deriveRuleState("CR-UPS-2", ups2, rules, nowMs) },
  ];
  const selected = units.find((unit) => unit.code === tab) ?? units[0];
  const totalCapacity = units.reduce((sum, unit) => sum + unit.capacityKva, 0);
  // Aggregates count only the units still reporting (ADR 0027 decision 4).
  const liveUnits = units.filter((unit) => !unit.state.stale);
  const staleUnits = units.length - liveUnits.length;
  const liveCritical = units.filter((u) => u.state.status === "critical").length;
  const kws = liveUnits
    .map((unit) => capacityKw(unit.slice.loadPct, unit.capacityKva))
    .filter((v): v is number => v != null && !Number.isNaN(v));
  const totalKw = kws.length === 0 ? null : kws.reduce((a, b) => a + b, 0);
  const loads = liveUnits
    .map((unit) => unit.slice.loadPct)
    .filter((v): v is number => v != null && !Number.isNaN(v));
  const avgLoad =
    loads.length === 0 ? null : loads.reduce((a, b) => a + b, 0) / loads.length;
  const backups = liveUnits
    .map((unit) => unit.slice.backupMin)
    .filter((value): value is number => value !== null);
  const worstBackup = backups.length > 0 ? Math.min(...backups) : null;
  const overall = mergeStatus(units.map((unit) => unit.state));

  return (
    <div className="mx-auto max-w-[1320px] space-y-4 pb-8">
      <PageHeader
        eyebrow="R.crUps"
        title="UPS Monitoring · 2 x 30 kVA"
        subtitle={
          liveCritical > 0
            ? `${liveCritical} ACTIVE CRITICAL · per-unit and combined view · rule-driven status`
            : "Per-unit and combined view · rectifier to battery to inverter to load · rule-driven status"
        }
        actions={
          <>
            <DisabledCommandButton>Manual Bypass · disabled</DisabledCommandButton>
            <DisabledCommandButton>Battery Test · disabled</DisabledCommandButton>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Total Capacity" status="ready" value={String(totalCapacity)} unit="kVA" />
        <KpiTile label="Total Load" status="ready" value={n(totalKw, 2)} unit="kW" hint={staleUnits > 0 ? `${staleUnits} unit(s) stale` : undefined} />
        <KpiTile label="Average Load" status="ready" value={n(avgLoad, 0)} unit="%" hint={staleUnits > 0 ? `${staleUnits} unit(s) stale` : undefined} />
        <KpiTile label="Worst Backup" status="ready" value={n(worstBackup, 0)} unit="min" tone={statusTone(overall.status)} />
      </div>

      <div className="flex flex-wrap gap-2 rounded border border-gray-200 bg-white p-3">
        {units.map((unit) => (
          <button
            key={unit.code}
            className={`rounded border px-3 py-2 text-sm font-semibold ${
              tab === unit.code
                ? "border-bms-green bg-bms-green text-white"
                : "border-gray-200 bg-gray-50 text-bms-muted"
            }`}
            onClick={() => setTab(unit.code)}
          >
            {unit.label} · {unit.capacityKva} kVA
            <span className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] ${statusPillClass(unit.state.status)}`}>
              {statusLabel(unit.state.status)}
            </span>
          </button>
        ))}
        <button
          className={`rounded border px-3 py-2 text-sm font-semibold ${
            tab === "combined"
              ? "border-bms-green bg-bms-green text-white"
              : "border-gray-200 bg-gray-50 text-bms-muted"
          }`}
          onClick={() => setTab("combined")}
        >
          Combined Summary
        </button>
      </div>

      {tab === "combined" ? (
        <CombinedSummary units={units} />
      ) : (
        <UnitDetail unit={selected} />
      )}
    </div>
  );
}

function CombinedSummary({
  units,
}: {
  units: Array<{
    code: "CR-UPS-1" | "CR-UPS-2";
    label: "UPS-1" | "UPS-2";
    capacityKva: 30;
    slice: SchematicTelemetrySlice;
    battery: SchematicTelemetrySlice;
    battStale: boolean;
    state: RuleState;
  }>;
}) {
  return (
    <section className="rounded border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="font-condensed text-lg font-bold text-bms-ink">
          All UPS Units
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-bms-muted">
            <tr>
              <th className="px-4 py-2 text-left">UPS</th>
              <th className="px-4 py-2 text-left">Mode</th>
              <th className="px-4 py-2 text-left">Load</th>
              <th className="px-4 py-2 text-left">Output V/Hz</th>
              <th className="px-4 py-2 text-left">Battery V</th>
              <th className="px-4 py-2 text-left">Backup</th>
              <th className="px-4 py-2 text-left">Health</th>
              <th className="px-4 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {units.map((unit) => (
              <tr key={unit.code}>
                <td className="px-4 py-3 font-semibold text-bms-ink">{unit.label}</td>
                {/* `offline` is a real statement (the asset stopped reporting);
                    `online`/`battery` is an inference from `backupMin < 15`,
                    and no point reports UPS operating mode — the same reason
                    `ONLINE` was dropped from the SLD boxes (ADR 0028 decision
                    1). Marked rather than removed, because the column is
                    load-bearing in the table and the inference is reasonable;
                    what it must not do is read as measured. */}
                <td className="px-4 py-3 uppercase">
                  {unit.state.status === "offline" ? (
                    modeFor(unit.slice, unit.state.status)
                  ) : (
                    <StaticValue kind="simulated">
                      {modeFor(unit.slice, unit.state.status)}
                    </StaticValue>
                  )}
                </td>
                <td className="px-4 py-3">{n(freshValue(unit.slice.loadPct, unit.state.stale), 0)}%</td>
                <td className="px-4 py-3">{n(freshValue(unit.slice.outputVoltageV, unit.state.stale), 1)} / {n(freshValue(unit.slice.outputFreqHz, unit.state.stale), 2)}</td>
                {/* The detail card below was converted to `ownElse` first and
                    this row was missed, so the `??`-before-the-gate pattern
                    survived in the one place that lists both units at once.
                    Caught by the F4.39 re-review. */}
                <td className="px-4 py-3">{n(ownElse(unit.slice.batteryV, unit.state.stale, unit.battery.batteryV, unit.battStale), 1)} V</td>
                <td className="px-4 py-3">{n(freshValue(unit.slice.backupMin, unit.state.stale), 0)} min</td>
                <td className="px-4 py-3">{n(freshValue(unit.slice.healthPct, unit.state.stale), 0)}%</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPillClass(unit.state.status)}`}>
                    {statusLabel(unit.state.status)}
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

function UnitDetail({
  unit,
}: {
  unit: {
    code: "CR-UPS-1" | "CR-UPS-2";
    label: "UPS-1" | "UPS-2";
    capacityKva: 30;
    slice: SchematicTelemetrySlice;
    battery: SchematicTelemetrySlice;
    battStale: boolean;
    state: RuleState;
  };
}) {
  const mode = modeFor(unit.slice, unit.state.status);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Mode" status="ready" value={mode.toUpperCase()} tone={statusTone(unit.state.status)} />
        <KpiTile label="Load" status="ready" value={n(freshValue(unit.slice.loadPct, unit.state.stale), 0)} unit="%" hint={`${n(freshValue(capacityKw(unit.slice.loadPct, unit.capacityKva), unit.state.stale), 2)} kW`} />
        <KpiTile label="Backup Time" status="ready" value={n(freshValue(unit.slice.backupMin, unit.state.stale), 0)} unit="min" />
        <KpiTile label="Health" status="ready" value={n(freshValue(unit.slice.healthPct, unit.state.stale), 0)} unit="%" tone={statusTone(unit.state.status)} />
      </div>

      <section className="rounded border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="font-condensed text-lg font-bold text-bms-ink">
            {unit.label} · Block Diagram
          </h2>
          <p className="text-xs text-bms-muted">
            Rectifier → battery → inverter → critical load
          </p>
        </div>
        <div className="bg-gray-50 p-4">
          <UpsBlockDiagram slice={unit.slice} battery={unit.battery} status={unit.state.status} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailCard title="Input / Output">
          <Row label="Output voltage" value={`${n(freshValue(unit.slice.outputVoltageV, unit.state.stale), 1)} V`} />
          <Row label="Output frequency" value={`${n(freshValue(unit.slice.outputFreqHz, unit.state.stale), 2)} Hz`} />
          <Row label="Output current" value={`${n(freshValue(unit.slice.current, unit.state.stale), 1)} A`} />
          <Row label="Power factor" value={`${n(freshValue(unit.slice.pf, unit.state.stale), 2)} lag`} />
          <Row label="Real power" value={`${n(freshValue(unit.slice.kw, unit.state.stale), 2)} kW`} />
        </DetailCard>
        <DetailCard title="Battery">
          {/* Each value takes the clock of the asset it came from. The `??`
              forms genuinely span two assets, so the flag has to be chosen with
              the source rather than applied to the result — see `ownElse`. */}
          <Row label="Battery voltage" value={`${n(ownElse(unit.slice.batteryV, unit.state.stale, unit.battery.batteryV, unit.battStale), 1)} V`} />
          <Row label="Battery current" value={`${n(freshValue(unit.battery.current, unit.battStale), 1)} A`} />
          <Row label="Backup time" value={`${n(freshValue(unit.slice.backupMin, unit.state.stale), 0)} min @ ${n(freshValue(unit.slice.loadPct, unit.state.stale), 0)}% load`} />
          <Row label="Battery temp" value={`${n(ownElse(unit.slice.batteryTempC, unit.state.stale, unit.battery.batteryTempC, unit.battStale), 1)} C`} />
          <Row
            label="String count"
            value={<StaticValue kind="nameplate">32 cells · 12V VRLA</StaticValue>}
          />
        </DetailCard>
      </div>

      <section className="rounded border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-condensed text-lg font-bold text-bms-ink">
              Recent Trend
            </h2>
            <p className="text-xs text-bms-muted">Live load snapshot · simulator window</p>
          </div>
          {unit.state.matchedRule ? (
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPillClass(unit.state.status)}`}>
              {unit.state.matchedRule.name}
            </span>
          ) : null}
        </div>
        <div className="mt-4 h-28 rounded bg-gradient-to-r from-bms-green/10 via-bms-green/40 to-amber-300/50" />
        <p className="mt-2 text-center font-mono text-[10px] text-bms-muted">
          Load trend placeholder uses live current value until historical charting is promoted.
        </p>
      </section>
    </div>
  );
}

function UpsBlockDiagram({
  slice,
  battery,
  status,
}: {
  slice: SchematicTelemetrySlice;
  battery: SchematicTelemetrySlice;
  status: UpsStatus;
}) {
  const line = stroke(status);
  const dark = status === "offline";
  const battV = slice.batteryV ?? battery.batteryV;
  const battTemp = slice.batteryTempC ?? battery.batteryTempC;
  return (
    <svg className="h-auto w-full" viewBox="0 0 900 240">
      <defs>
        <marker id="upsArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={line} />
        </marker>
      </defs>
      {/* ADR 0027 decision 3: these SVG labels are the same readings as the
          detail rows and were the last place showing frozen numbers. */}
      <Block x={14} y={80} title="AC INPUT" sub={`${n(freshValue(slice.outputVoltageV, dark), 1)} V`} status={status} />
      <Flow x1={134} y1={110} x2={178} y2={110} color={line} />
      <Block x={178} y={80} title="RECTIFIER" sub="AC -> DC" status={status} />
      <Flow x1={298} y1={110} x2={342} y2={110} color={line} />
      <Block x={342} y={80} title="DC BUS" sub={`${n(freshValue(battV, dark), 0)} V`} status={status} />
      <line x1="402" y1="138" x2="402" y2="170" stroke={line} strokeWidth={2} strokeDasharray="4 3" />
      <Block x={342} y={170} title="BATTERY" sub={`${n(freshValue(battV, dark), 1)} V · ${n(freshValue(battTemp, dark), 1)} C`} status={status} />
      <Flow x1={462} y1={110} x2={506} y2={110} color={line} />
      <Block x={506} y={80} title="INVERTER" sub="DC -> AC" status={status} />
      <Flow x1={626} y1={110} x2={670} y2={110} color={line} />
      {/* `F4.39`: `NORMAL` sits in a row where every other sub-line is a live
          reading, and it is a claim about switch position that no point
          reports. The block's colour still comes from real status; the word is
          marked so it is not read as a fourth measurement. */}
      <Block x={670} y={80} w={100} title="STATIC SW" sub={<StaticTspan kind="simulated">NORMAL</StaticTspan>} status={status} />
      <Flow x1={770} y1={110} x2={810} y2={110} color={line} />
      <Block x={810} y={80} w={80} title="LOAD" sub={`${n(freshValue(slice.loadPct, dark), 0)}%`} status={status} />
      <text x="450" y="40" textAnchor="middle" className="fill-gray-400 font-mono text-[10px]">BYPASS LINE (auto)</text>
      <line x1="74" y1="60" x2="850" y2="60" stroke="#94a3b8" strokeWidth={1.4} strokeDasharray="5 5" />
    </svg>
  );
}

function Block({
  x,
  y,
  w = 120,
  title,
  sub,
  status,
}: {
  x: number;
  y: number;
  w?: number;
  title: string;
  sub: ReactNode;
  status: UpsStatus;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={58} rx={6} className={boxClass(status)} />
      <text x={x + w / 2} y={y + 24} textAnchor="middle" className="fill-bms-ink font-condensed text-[13px] font-bold">{title}</text>
      <text x={x + w / 2} y={y + 42} textAnchor="middle" className="fill-bms-muted font-mono text-[10px]">{sub}</text>
    </g>
  );
}

function Flow({
  x1,
  y1,
  x2,
  y2,
  color,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={3} markerEnd="url(#upsArrow)" />;
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="font-condensed text-lg font-bold text-bms-ink">{title}</h2>
      </div>
      <div className="space-y-2 p-4 text-sm">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-bms-muted">{label}</span>
      <span className="font-mono font-semibold text-bms-ink">{value}</span>
    </div>
  );
}

export function ControlRoomUpsPage({ user }: ControlRoomUpsPageProps) {
  return (
    <AppShell
      user={user}
      kpiRibbon={<span className="text-bms-ink">IBMS Control Room · UPS Monitoring</span>}
    >
      <SchematicTelemetryProvider
        assetCodes={CR_TRACKED_ASSET_CODES}
        pointKeys={CR_POINT_KEYS}
      >
        <ControlRoomUpsContent />
      </SchematicTelemetryProvider>
    </AppShell>
  );
}
