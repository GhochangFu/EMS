import type { AutomationRuleOperator, RuleListItem } from "@bms/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchRules } from "../api/rules";
import {
  CR_POINT_KEYS,
  CR_SERVERS,
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
import { freshValue, isStale } from "../lib/schematic-telemetry";
import type { AuthUser } from "../stores/auth-store";

type ControlRoomItPageProps = {
  user: AuthUser;
};

function n(value: number | null, digits = 1): string {
  return value == null || Number.isNaN(value) ? "—" : value.toFixed(digits);
}

function useCr(code: string) {
  return useSchematicTelemetryByCode(code).slice;
}

type RackPowerStatus = "normal" | "warning" | "critical" | "offline";

type RuleMatchState = {
  status: RackPowerStatus;
  matchedRule: RuleListItem | null;
  /** True when the asset has stopped reporting (ADR 0027). */
  stale: boolean;
};

function statusLabel(status: RackPowerStatus): string {
  switch (status) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warn";
    case "offline":
      return "Offline";
    case "normal":
      return "OK";
  }
}

function statusPillClass(status: RackPowerStatus): string {
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
    case "rack_kw":
      return slice.rackKw;
    case "rack_temp_c":
      return slice.rackTempC;
    case "pdu_a_status":
      return slice.pduAStatus;
    case "pdu_b_status":
      return slice.pduBStatus;
    case "pdu_util_pct":
      return slice.pduUtilPct;
    case "outlets_used":
      return slice.outletsUsed;
    case "load_pct":
      return slice.loadPct;
    case "health_pct":
      return slice.healthPct;
    default:
      return null;
  }
}

function severityStatus(severity: string | null): RackPowerStatus {
  return severity === "critical" ? "critical" : "warning";
}

/**
 * Tile status for one rack or PDU (ADR 0027).
 *
 * Staleness is checked before the PDU/health test, because those fields are
 * frozen last-known values: a rack that lost telemetry while both PDUs read
 * healthy would otherwise render `normal` indefinitely.
 */
function deriveRuleStatus(
  assetCode: string,
  slice: SchematicTelemetrySlice,
  rules: RuleListItem[],
  nowMs: number,
): RuleMatchState {
  if (isStale(slice.lastSeenMs, nowMs)) {
    return { status: "offline", matchedRule: null, stale: true };
  }
  const offline =
    slice.pduAStatus === 0 || slice.pduBStatus === 0 || slice.healthPct === 0;
  if (offline) {
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
function mergeStatus(states: RuleMatchState[]): RuleMatchState {
  return (
    states.find((state) => state.status === "offline") ??
    states.find((state) => state.status === "critical") ??
    states.find((state) => state.status === "warning") ??
    { status: "normal", matchedRule: null, stale: false }
  );
}

function ControlRoomItContent() {
  const rulesQuery = useQuery({
    queryKey: ["rules"],
    queryFn: fetchRules,
    refetchInterval: 15_000,
  });
  const rules = rulesQuery.data?.items ?? [];
  const net = useCr("CR-NET-RACK");
  const vw = useCr("CR-VW-SRV-RACK");
  const nowMs = Date.now();
  // ADR 0027 decisions 3 and 4. `?? 0` meant two dead racks summed to
  // "0.00 kW", which reads as a measurement rather than an absence.
  const netStale = isStale(net.lastSeenMs, nowMs);
  const vwStale = isStale(vw.lastSeenMs, nowMs);
  const rackKws = [
    freshValue(net.rackKw, netStale),
    freshValue(vw.rackKw, vwStale),
  ].filter((v): v is number => v != null && !Number.isNaN(v));
  const totalKw = rackKws.length === 0 ? null : rackKws.reduce((a, b) => a + b, 0);
  const staleRacks = [netStale, vwStale].filter(Boolean).length;
  // ADR 0027 decision 2's mitigation — offline now outranks critical here too.
  const liveCritical = [
    deriveRuleStatus("CR-NET-RACK", net, rules, nowMs),
    deriveRuleStatus("CR-VW-SRV-RACK", vw, rules, nowMs),
  ].filter((state) => state.status === "critical").length;

  return (
    <div className="mx-auto max-w-[1320px] space-y-4 pb-8">
      <PageHeader
        eyebrow="R.crIT"
        title="IT & Rack Load Monitoring"
        subtitle={
          liveCritical > 0
            ? `${liveCritical} ACTIVE CRITICAL · network rack · videowall server rack · PDU status`
            : "Network rack · Videowall server rack · PDU status · UPS source mapping"
        }
        actions={<StatusPill label="Live rack telemetry" />}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary label="Total rack load" value={`${n(totalKw, 2)} kW${staleRacks > 0 ? ` · ${staleRacks} stale` : ""}`} />
        <Summary label="Network rack temp" value={`${n(freshValue(net.rackTempC, netStale), 1)} °C`} />
        <Summary label="Videowall rack temp" value={`${n(freshValue(vw.rackTempC, vwStale), 1)} °C`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RackCard title="Network Rack" code="CR-NET-RACK" pduA="CR-NET-RACK-PDU-A" pduB="CR-NET-RACK-PDU-B" ups="UPS-1" ratedKw={3} rules={rules} />
        <RackCard title="Videowall Server Rack" code="CR-VW-SRV-RACK" pduA="CR-VW-RACK-PDU-A" pduB="CR-VW-RACK-PDU-B" ups="UPS-2" ratedKw={2} rules={rules} />
      </div>

      <UpsSourceMap rules={rules} />

      <section className="rounded border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="font-condensed text-lg font-bold text-bms-ink">
            Server Inventory
          </h2>
          <p className="text-xs text-bms-muted">
            Static rack metadata from the mockup, paired with live rack/PDU load.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-bms-muted">
              <tr>
                <th className="px-3 py-2">Rack</th>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Watts</th>
                <th className="px-3 py-2">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {CR_SERVERS.map((server) => (
                <tr key={server.id}>
                  <td className="px-3 py-2 text-bms-muted">{server.rack}</td>
                  <td className="px-3 py-2 font-medium text-bms-ink">{server.id}</td>
                  <td className="px-3 py-2">{server.type}</td>
                  <td className="px-3 py-2 text-right font-mono">{server.watts}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full border border-bms-green/20 bg-bms-green/10 px-2 py-0.5 text-[11px] font-semibold text-bms-green">
                      ON
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-200 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-bms-muted">{label}</div>
      <div className="mt-1 font-condensed text-2xl font-bold text-bms-ink">
        {value}
      </div>
    </div>
  );
}

function RackCard({
  title,
  code,
  pduA,
  pduB,
  ups,
  ratedKw,
  rules,
}: {
  title: string;
  code: string;
  pduA: string;
  pduB: string;
  ups: string;
  ratedKw: number;
  rules: RuleListItem[];
}) {
  const rack = useCr(code);
  const a = useCr(pduA);
  const b = useCr(pduB);
  const nowMs = Date.now();
  const aState = deriveRuleStatus(pduA, a, rules, nowMs);
  const bState = deriveRuleStatus(pduB, b, rules, nowMs);
  const rackSelf = deriveRuleStatus(code, rack, rules, nowMs);
  const rackState = mergeStatus([aState, bState, rackSelf]);
  const pct = rack.rackKw == null ? 0 : Math.min(100, (rack.rackKw / ratedKw) * 100);
  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-condensed text-lg font-bold text-bms-ink">{title}</h2>
          <p className="text-xs text-bms-muted">UPS source · {ups}</p>
        </div>
        <span className={`rounded border px-2 py-1 text-xs font-semibold ${statusPillClass(rackState.status)}`}>
          {statusLabel(rackState.status)}
        </span>
      </div>
      <div className="mt-4">
        <div className="flex justify-between text-sm">
          <span className="text-bms-muted">Load</span>
          <span className="font-mono font-semibold text-bms-ink">{n(freshValue(rack.rackKw, rackSelf.stale), 2)} kW</span>
        </div>
        <div className="mt-2 h-2 rounded bg-gray-200">
          <div className="h-2 rounded bg-bms-green" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PduBadge label="PDU-A" code={pduA} status={aState} util={a.pduUtilPct} />
        <PduBadge label="PDU-B" code={pduB} status={bState} util={b.pduUtilPct} />
      </div>
      <div className="mt-4 text-sm">
        <Row label="Outlets" value={`${n(freshValue(rack.outletsUsed, rackSelf.stale), 0)}/24`} />
        <Row label="Rack temperature" value={`${n(freshValue(rack.rackTempC, rackSelf.stale), 1)} °C`} />
        <Row label="Rated load" value={`${ratedKw.toFixed(1)} kW`} />
        {rackState.matchedRule ? (
          <Row label="Rule" value={rackState.matchedRule.name} />
        ) : null}
      </div>
    </section>
  );
}

function UpsSourceMap({ rules }: { rules: RuleListItem[] }) {
  const mapNow = Date.now();
  const ups1 = useCr("CR-UPS-1");
  const ups2 = useCr("CR-UPS-2");
  const net = useCr("CR-NET-RACK");
  const vw = useCr("CR-VW-SRV-RACK");
  const netPduA = useCr("CR-NET-RACK-PDU-A");
  const netPduB = useCr("CR-NET-RACK-PDU-B");
  const vwPduA = useCr("CR-VW-RACK-PDU-A");
  const vwPduB = useCr("CR-VW-RACK-PDU-B");
  const pduNodes = [
    {
      code: "CR-NET-RACK-PDU-A",
      label: "NET PDU-A",
      slice: netPduA,
      ups: "UPS-1",
      rack: "NETWORK RACK",
      x: 280,
      y: 20,
      lineY: 36,
      rackLineY: 50,
    },
    {
      code: "CR-NET-RACK-PDU-B",
      label: "NET PDU-B",
      slice: netPduB,
      ups: "UPS-1",
      rack: "NETWORK RACK",
      x: 280,
      y: 60,
      lineY: 76,
      rackLineY: 60,
    },
    {
      code: "CR-VW-RACK-PDU-A",
      label: "VW PDU-A",
      slice: vwPduA,
      ups: "UPS-2",
      rack: "VW SERVER RACK",
      x: 280,
      y: 108,
      lineY: 124,
      rackLineY: 140,
    },
    {
      code: "CR-VW-RACK-PDU-B",
      label: "VW PDU-B",
      slice: vwPduB,
      ups: "UPS-2",
      rack: "VW SERVER RACK",
      x: 280,
      y: 148,
      lineY: 164,
      rackLineY: 150,
    },
  ] as const;
  const pduStates = pduNodes.map((node) => ({
    ...node,
    state: deriveRuleStatus(node.code, node.slice, rules, mapNow),
  }));
  const netState = mergeStatus(pduStates.slice(0, 2).map((node) => node.state));
  const vwState = mergeStatus(pduStates.slice(2).map((node) => node.state));
  const ups1State = deriveRuleStatus("CR-UPS-1", ups1, rules, mapNow);
  const ups2State = deriveRuleStatus("CR-UPS-2", ups2, rules, mapNow);
  const netStale = isStale(net.lastSeenMs, mapNow);
  const vwStale = isStale(vw.lastSeenMs, mapNow);

  return (
    <section className="rounded border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="font-condensed text-lg font-bold text-bms-ink">
          UPS Source Map
        </h2>
        <p className="text-xs text-bms-muted">
          Which rack draws from which UPS · colors follow enabled Rule Engine thresholds
        </p>
      </div>
      <div className="overflow-x-auto p-4">
        <svg viewBox="0 0 700 200" className="h-auto min-w-[700px]">
          <defs>
            <marker id="itArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#039855" />
            </marker>
          </defs>
          {/* ADR 0027 decision 3 — these SVG labels sit inside boxes whose
              colour already reflects staleness, so a frozen number here reads
              as current. */}
          <MapBox x={20} y={40} w={120} h={40} title="UPS-1 · 30 kVA" sub={`${n(freshValue(ups1.loadPct, ups1State.stale), 0)}% · ${n(freshValue(ups1.backupMin, ups1State.stale), 0)} min`} status={ups1State.status} />
          <MapBox x={20} y={120} w={120} h={40} title="UPS-2 · 30 kVA" sub={`${n(freshValue(ups2.loadPct, ups2State.stale), 0)}% · ${n(freshValue(ups2.backupMin, ups2State.stale), 0)} min`} status={ups2State.status} />

          {pduStates.map((node) => (
            <g key={node.code}>
              <MapLine x1={140} y1={node.ups === "UPS-1" ? 60 : 140} x2={node.x} y2={node.lineY} status={node.state.status} />
              <MapBox
                x={node.x}
                y={node.y}
                w={120}
                h={32}
                title={node.label}
                sub={`${n(freshValue(node.slice.pduUtilPct, node.state.stale), 0)}%`}
                status={node.state.status}
              />
              <MapLine x1={400} y1={node.lineY} x2={500} y2={node.rackLineY} status={node.state.status} />
            </g>
          ))}

          <MapBox x={500} y={30} w={180} h={50} title="NETWORK RACK" sub={`${n(freshValue(net.rackKw, netStale), 2)} kW · ${n(freshValue(net.outletsUsed, netStale), 0)}/24 outlets`} status={netState.status} />
          <MapBox x={500} y={120} w={180} h={50} title="VW SERVER RACK" sub={`${n(freshValue(vw.rackKw, vwStale), 2)} kW · ${n(freshValue(vw.outletsUsed, vwStale), 0)}/24 outlets`} status={vwState.status} />
        </svg>
        <div className="mt-3 grid gap-2 text-xs text-bms-muted sm:grid-cols-2">
          {[netState, vwState]
            .map((state) => state.matchedRule)
            .filter((rule): rule is RuleListItem => Boolean(rule))
            .map((rule) => (
              <div key={rule.id} className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                Active rule: {rule.name}
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}

function mapStroke(status: RackPowerStatus): string {
  switch (status) {
    case "critical":
      return "#dc2626";
    case "warning":
      return "#f59e0b";
    case "offline":
      return "#94a3b8";
    case "normal":
      return "#039855";
  }
}

function mapBoxClasses(status: RackPowerStatus): { rect: string; text: string; sub: string } {
  switch (status) {
    case "critical":
      return { rect: "fill-red-50 stroke-red-600", text: "fill-red-800", sub: "fill-red-700" };
    case "warning":
      return { rect: "fill-amber-50 stroke-amber-500", text: "fill-amber-900", sub: "fill-amber-700" };
    case "offline":
      return { rect: "fill-gray-100 stroke-gray-400", text: "fill-gray-700", sub: "fill-gray-500" };
    case "normal":
      return { rect: "fill-white stroke-bms-green", text: "fill-[#1d3a8c]", sub: "fill-slate-600" };
  }
}

function MapLine({
  x1,
  y1,
  x2,
  y2,
  status,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  status: RackPowerStatus;
}) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={mapStroke(status)}
      strokeWidth={status === "offline" ? 1.5 : 2.5}
      fill="none"
      strokeDasharray={status === "offline" ? "4 4" : undefined}
      markerEnd={status === "offline" ? undefined : "url(#itArrow)"}
    />
  );
}

function MapBox({
  x,
  y,
  w,
  h,
  title,
  sub,
  status,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string;
  status: RackPowerStatus;
}) {
  const classes = mapBoxClasses(status);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} className={classes.rect} strokeWidth={1.5} />
      <text x={x + w / 2} y={y + h / 2 - 2} textAnchor="middle" className={`${classes.text} font-condensed text-[12px] font-bold`}>
        {title}
      </text>
      <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" className={`${classes.sub} font-mono text-[9px]`}>
        {sub} · {statusLabel(status).toUpperCase()}
      </text>
    </g>
  );
}

function PduBadge({
  label,
  code,
  status,
  util,
}: {
  label: string;
  code: string;
  status: RuleMatchState;
  util: number | null;
}) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-bms-ink">{label}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPillClass(status.status)}`}>
          {statusLabel(status.status)}
        </span>
      </div>
      <p className="mt-2 text-xs text-bms-muted">
        {code} · Utilisation {n(util, 0)}%
      </p>
      {status.matchedRule ? (
        <p className="mt-1 text-xs font-medium text-amber-900">
          {status.matchedRule.name}
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 flex justify-between gap-3">
      <span className="text-bms-muted">{label}</span>
      <span className="font-mono font-semibold text-bms-ink">{value}</span>
    </div>
  );
}

export function ControlRoomItPage({ user }: ControlRoomItPageProps) {
  return (
    <AppShell
      user={user}
      kpiRibbon={<span className="text-bms-ink">IBMS Control Room · IT & Rack Load</span>}
    >
      <SchematicTelemetryProvider
        assetCodes={CR_TRACKED_ASSET_CODES}
        pointKeys={CR_POINT_KEYS}
      >
        <ControlRoomItContent />
      </SchematicTelemetryProvider>
    </AppShell>
  );
}
