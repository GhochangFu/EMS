import type { AutomationRuleOperator, RuleListItem } from "@bms/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchRules } from "../api/rules";
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
import {
  freshValue,
  isStale,
  STALE_VALUE,
} from "../lib/schematic-telemetry";
import type { AuthUser } from "../stores/auth-store";

type ControlRoomSldPageProps = {
  user: AuthUser;
};

function n(value: number | null, digits = 1): string {
  return value == null || Number.isNaN(value) ? "—" : value.toFixed(digits);
}

function useCr(code: string) {
  return useSchematicTelemetryByCode(code).slice;
}

/**
 * `offline` is distinct from `open` (ADR 0027 decision 5). `open` asserts the
 * breaker is open — a fact about the plant, only knowable from a current
 * reading. `offline` says we cannot see the breaker at all. On a single-line
 * diagram those must never look the same.
 */
type BreakerVisualStatus =
  | "normal"
  | "warning"
  | "critical"
  | "open"
  | "offline";

type BreakerRuleState = {
  status: BreakerVisualStatus;
  matchedRule: RuleListItem | null;
  /** True when the asset has stopped reporting (ADR 0027). */
  stale: boolean;
};

function statusClass(status: BreakerVisualStatus): string {
  if (status === "open") {
    return "border-gray-200 bg-gray-100 text-gray-700";
  }
  // A deliberately different grey from `open` — see BreakerVisualStatus.
  if (status === "offline") {
    return "border-gray-300 bg-gray-200 text-gray-600";
  }
  if (status === "critical") {
    return "border-red-200 bg-red-100 text-red-800";
  }
  if (status === "warning") {
    return "border-amber-200 bg-amber-100 text-amber-900";
  }
  return "border-bms-green/20 bg-bms-green/10 text-bms-green";
}

function pointValue(slice: SchematicTelemetrySlice, pointKey: string): number | null {
  switch (pointKey) {
    case "voltage_l1_v":
      return slice.voltage;
    case "current_a":
      return slice.current;
    case "kw":
      return slice.kw;
    case "kvar":
      return slice.kvar;
    case "pf":
      return slice.pf;
    case "breaker_main":
      return slice.breaker;
    case "frequency_hz":
      return slice.frequencyHz;
    case "kwh_today":
      return slice.kwhToday;
    default:
      return null;
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

function severityStatus(severity: string | null): BreakerVisualStatus {
  return severity === "critical" ? "critical" : "warning";
}

/**
 * Breaker tile status (ADR 0027).
 *
 * Staleness precedes the breaker test because `slice.breaker` freezes when
 * telemetry stops: a dead feed would otherwise keep asserting a closed breaker
 * indefinitely, which on an SLD reads as "this path is energised".
 */
function deriveBreakerRuleState(
  code: string,
  slice: SchematicTelemetrySlice,
  rules: RuleListItem[],
  nowMs: number,
): BreakerRuleState {
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
      rule.assetCode !== code ||
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

function ControlRoomSldContent() {
  const rulesQuery = useQuery({
    queryKey: ["rules"],
    queryFn: fetchRules,
    refetchInterval: 15_000,
  });
  const rules = rulesQuery.data?.items ?? [];
  const q1 = useCr("CR-Q1");
  // The header meters are all the incomer's own readings (ADR 0027 decision 3).
  // The `?? 0` forms below were left ungated in the first pass, so a dead CR-Q1
  // rendered "0.00 / 0.00 kW·kVA" and "0.0 kWh" — measured-looking zeroes,
  // three columns from four meters that correctly blanked. Found in review.
  const q1Stale = isStale(q1.lastSeenMs, Date.now());
  const totalKw = freshValue(q1.kw, q1Stale);
  const kva = q1.pf && totalKw !== null ? totalKw / q1.pf : null;
  const kwhToday = freshValue(q1.kwhToday, q1Stale);

  return (
    <div className="mx-auto max-w-[1320px] space-y-4 pb-8">
      <PageHeader
        eyebrow="R.crSld"
        title="Electrical Power · Single Line Diagram"
        subtitle="Incoming feeder to main panel to UPS input/output to load distribution"
        actions={<StatusPill label="Live" />}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Meter label="Voltage R" value={n(freshValue(q1.voltage, q1Stale), 1)} unit="V" />
        <Meter label="Voltage Y" value={n(freshValue(q1.voltage == null ? null : q1.voltage + 0.7, q1Stale), 1)} unit="V" />
        <Meter label="Voltage B" value={n(freshValue(q1.voltage == null ? null : q1.voltage - 0.8, q1Stale), 1)} unit="V" />
        <Meter label="Frequency" value={n(freshValue(q1.frequencyHz, q1Stale), 2)} unit="Hz" />
        <Meter label="kW · kVA" value={`${n(totalKw, 2)} / ${n(kva, 2)}`} unit="" />
        <Meter label="kWh Today" value={n(kwhToday, 1)} unit="kWh" />
      </div>

      <section className="rounded border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="font-condensed text-lg font-bold text-bms-ink">
            Detailed SLD
          </h2>
          <p className="text-xs text-bms-muted">Live 2D rendering of mockup R.crSld</p>
        </div>
        <div className="overflow-x-auto bg-[#FAFBFC] p-4">
          <CrSldSvg rules={rules} />
        </div>
      </section>

      <BreakerTable rules={rules} />
    </div>
  );
}

function Meter({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded border border-gray-200 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-bms-muted">{label}</div>
      <div className="mt-1 font-condensed text-2xl font-bold text-bms-ink">
        {value} {unit ? <span className="text-sm text-bms-muted">{unit}</span> : null}
      </div>
    </div>
  );
}

function CrSldSvg({ rules }: { rules: RuleListItem[] }) {
  return (
    <svg viewBox="0 0 1100 460" className="h-auto min-w-[1000px]">
      <defs>
        <marker id="crArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#039855" />
        </marker>
      </defs>
      <SldBox x={20} y={200} w={100} h={60} title="UTILITY" sub="11 kV INCOMER" />
      <Flow x1={120} y1={230} x2={160} y2={230} />
      <circle cx={180} cy={220} r={13} className="fill-white stroke-bms-green" strokeWidth={2} />
      <circle cx={180} cy={240} r={13} className="fill-white stroke-bms-green" strokeWidth={2} />
      <text x={180} y={200} textAnchor="middle" className="fill-bms-green font-mono text-[9px]">XFMR 100 kVA</text>
      <Flow x1={200} y1={230} x2={240} y2={230} />
      <Breaker cx={260} cy={230} label="Q1" code="CR-Q1" rules={rules} />
      <Flow x1={274} y1={230} x2={320} y2={230} />
      <rect x={320} y={80} width={6} height={320} rx={2} className="fill-bms-green" />
      <text x={323} y={74} textAnchor="middle" className="fill-bms-green font-condensed text-[11px] font-bold">MAIN BUS 415V</text>
      <Branch y={115} breaker="Q2" breakerCode="CR-Q2" box="UPS-1" sub="ONLINE · 30 kVA" outBreaker="Q4" outCode="CR-Q4" rules={rules} />
      <Branch y={170} breaker="Q3" breakerCode="CR-Q3" box="UPS-2" sub="ONLINE · 30 kVA" outBreaker="Q5" outCode="CR-Q5" rules={rules} />
      <LoadBranch y={240} breaker="Q10" code="CR-Q10" title="HVAC-1 (4 TR)" sub="RUN · LEAD" rules={rules} />
      <LoadBranch y={290} breaker="Q11" code="CR-Q11" title="HVAC-2 (4 TR)" sub="STANDBY" rules={rules} />
      <LoadBranch y={340} breaker="Q12" code="CR-Q12" title="CR LIGHTS / AUX" sub="" rules={rules} />
      <rect x={690} y={80} width={6} height={200} rx={2} className="fill-bms-green" />
      <text x={693} y={74} textAnchor="middle" className="fill-bms-green font-condensed text-[11px] font-bold">UPS OUT BUS 230V</text>
      <Pdu y={105} breaker="Q6" code="CR-Q6" title="NET RACK · PDU-A" loadCode="CR-NET-RACK-PDU-A" rules={rules} />
      <Pdu y={148} breaker="Q7" code="CR-Q7" title="NET RACK · PDU-B" loadCode="CR-NET-RACK-PDU-B" rules={rules} />
      <Pdu y={195} breaker="Q8" code="CR-Q8" title="VW SRV · PDU-A" loadCode="CR-VW-RACK-PDU-A" rules={rules} />
      <Pdu y={240} breaker="Q9" code="CR-Q9" title="VW SRV · PDU-B" loadCode="CR-VW-RACK-PDU-B" rules={rules} />
      {/* `F4.39`: these two voltages, and the "ONLINE" / "RUN · LEAD" /
          "STANDBY" words above, are **hardcoded mockup placeholders** — they are
          not read from any slice. ADR 0027's staleness gate therefore does not
          and cannot reach them: there is nothing to go stale. They are left as
          they are because wiring them to telemetry (or relabelling them as
          nameplate data) is a product decision, but note the consequence — on a
          live SLD they read exactly like measurements. */}
      <SldBox x={990} y={86} w={90} h={38} title="BATT-1" sub="384 V" />
      <SldBox x={990} y={130} w={90} h={38} title="BATT-2" sub="386 V" />
      <line x1={570} y1={115} x2={990} y2={105} stroke="#94a3b8" strokeWidth={1.4} strokeDasharray="4 4" />
      <line x1={570} y1={170} x2={990} y2={149} stroke="#94a3b8" strokeWidth={1.4} strokeDasharray="4 4" />
    </svg>
  );
}

function Flow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#039855" strokeWidth={3} markerEnd="url(#crArrow)" />;
}

function SldBox({ x, y, w, h, title, sub }: { x: number; y: number; w: number; h: number; title: string; sub: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} className="fill-white stroke-bms-green" strokeWidth={1.5} />
      <text x={x + w / 2} y={y + h / 2 - 2} textAnchor="middle" className="fill-bms-ink font-condensed text-[12px] font-bold">{title}</text>
      {sub ? <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" className="fill-bms-muted font-mono text-[9px]">{sub}</text> : null}
    </g>
  );
}

function Breaker({ cx, cy, label, code, rules }: { cx: number; cy: number; label: string; code: string; rules: RuleListItem[] }) {
  const s = useCr(code);
  const state = deriveBreakerRuleState(code, s, rules, Date.now());
  const circleClass =
    state.status === "offline"
      ? "fill-gray-200 stroke-gray-400"
      : state.status === "open"
        ? "fill-gray-100 stroke-gray-400"
        : state.status === "critical"
          ? "fill-red-50 stroke-red-600"
          : state.status === "warning"
            ? "fill-amber-50 stroke-amber-500"
            : "fill-white stroke-bms-green";
  const textClass =
    state.status === "offline"
      ? "fill-gray-500 font-mono text-[8px] font-bold"
      : state.status === "open"
        ? "fill-gray-500 font-mono text-[8px] font-bold"
        : state.status === "critical"
          ? "fill-red-700 font-mono text-[8px] font-bold"
          : state.status === "warning"
            ? "fill-amber-700 font-mono text-[8px] font-bold"
            : "fill-bms-green font-mono text-[8px] font-bold";
  return (
    <g>
      <circle cx={cx} cy={cy} r={12} className={circleClass} strokeWidth={2} />
      <text x={cx} y={cy + 4} textAnchor="middle" className={textClass}>{label}</text>
    </g>
  );
}

function Branch({ y, breaker, breakerCode, box, sub, outBreaker, outCode, rules }: { y: number; breaker: string; breakerCode: string; box: string; sub: string; outBreaker: string; outCode: string; rules: RuleListItem[] }) {
  return (
    <g>
      <Flow x1={326} y1={y} x2={380} y2={y} />
      <Breaker cx={400} cy={y} label={breaker} code={breakerCode} rules={rules} />
      <Flow x1={411} y1={y} x2={450} y2={y} />
      <SldBox x={450} y={y - 29} w={120} h={58} title={box} sub={sub} />
      <Flow x1={570} y1={y} x2={610} y2={y} />
      <Breaker cx={630} cy={y} label={outBreaker} code={outCode} rules={rules} />
      <Flow x1={641} y1={y} x2={690} y2={y} />
    </g>
  );
}

function LoadBranch({ y, breaker, code, title, sub, rules }: { y: number; breaker: string; code: string; title: string; sub: string; rules: RuleListItem[] }) {
  const s = useCr(code);
  const state = deriveBreakerRuleState(code, s, rules, Date.now());
  // A dead feed is not a closed one: `!== "open"` used to make `offline` count
  // as closed, so the diagram drew a green energised arrow into it.
  const closed = state.status !== "open" && state.status !== "offline";
  const stroke =
    state.status === "offline"
      ? "#94a3b8"
      : state.status === "warning"
        ? "#f59e0b"
        : state.status === "critical"
          ? "#dc2626"
          : closed
            ? "#039855"
            : "#94a3b8";
  return (
    <g>
      <line x1={326} y1={y} x2={380} y2={y} stroke={stroke} strokeWidth={3} />
      <Breaker cx={400} cy={y} label={breaker} code={code} rules={rules} />
      <line x1={411} y1={y} x2={450} y2={y} stroke={stroke} strokeWidth={3} markerEnd={closed ? "url(#crArrow)" : undefined} />
      <SldBox x={450} y={y - 18} w={120} h={36} title={title} sub={sub} />
    </g>
  );
}

function Pdu({ y, breaker, code, title, loadCode, rules }: { y: number; breaker: string; code: string; title: string; loadCode: string; rules: RuleListItem[] }) {
  const breakerSlice = useCr(code);
  const s = useCr(loadCode);
  const state = deriveBreakerRuleState(code, breakerSlice, rules, Date.now());
  const warn = state.status === "warning";
  const critical = state.status === "critical";
  const dark = state.status === "offline";
  const stroke = dark ? "#94a3b8" : critical ? "#dc2626" : warn ? "#f59e0b" : "#039855";
  return (
    <g>
      <line x1={696} y1={y} x2={740} y2={y} stroke={stroke} strokeWidth={3} markerEnd={dark ? undefined : "url(#crArrow)"} />
      <Breaker cx={760} cy={y} label={breaker} code={code} rules={rules} />
      <line x1={770} y1={y} x2={810} y2={y} stroke={stroke} strokeWidth={3} markerEnd={dark ? undefined : "url(#crArrow)"} />
      <rect x={810} y={y - 19} width={160} height={38} rx={6} className={dark ? "fill-gray-200 stroke-gray-400" : critical ? "fill-red-50 stroke-red-600" : warn ? "fill-amber-50 stroke-amber-500" : "fill-white stroke-bms-green"} />
      <text x={890} y={y + 1} textAnchor="middle" className={dark ? "fill-gray-600 font-condensed text-[12px] font-bold" : critical ? "fill-red-800 font-condensed text-[12px] font-bold" : warn ? "fill-amber-900 font-condensed text-[12px] font-bold" : "fill-bms-ink font-condensed text-[12px] font-bold"}>{title}</text>
      {/* Gated on the *load* asset's own freshness, not the breaker's: the two
          are different assets and either can die alone. */}
      <text x={890} y={y + 13} textAnchor="middle" className="fill-bms-muted font-mono text-[9px]">{n(freshValue(s.rackKw, isStale(s.lastSeenMs, Date.now())), 2)} kW</text>
    </g>
  );
}

function BreakerTable({ rules }: { rules: RuleListItem[] }) {
  return (
    <section className="rounded border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="font-condensed text-lg font-bold text-bms-ink">
          Breakers · Status & Energy
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-bms-muted">
            <tr>
              <th className="px-3 py-2">Breaker</th>
              <th className="px-3 py-2">Position</th>
              <th className="px-3 py-2">Rating</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">I (A)</th>
              <th className="px-3 py-2 text-right">kW</th>
              <th className="px-3 py-2 text-right">kWh</th>
              <th className="px-3 py-2">Trip Cause</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {CR_BREAKERS.map((row) => (
              <BreakerRow key={row.code} row={row} rules={rules} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BreakerRow({ row, rules }: { row: (typeof CR_BREAKERS)[number]; rules: RuleListItem[] }) {
  const s = useCr(row.code);
  const state = deriveBreakerRuleState(row.code, s, rules, Date.now());
  // `offline` is tested FIRST in every chain on this page, and that ordering is
  // the fix rather than a style choice: each of these ternaries ends in a green
  // "healthy" default, so a status the chain does not name falls through to
  // *closed and energised*. Before this arm existed a breaker whose telemetry
  // had died read "CLOSED" — the exact claim F4.38 exists to stop the page
  // making. The compiler could not catch it because these are ternaries, not
  // exhaustive switches.
  const statusLabel =
    state.status === "offline"
      ? "OFFLINE"
      : state.status === "open"
        ? "OPEN"
        : state.status === "critical"
          ? "CRITICAL"
          : state.status === "warning"
            ? "WARN"
            : "CLOSED";
  const tripCause = state.stale
    ? STALE_VALUE
    : (state.matchedRule?.name ?? (state.status === "open" ? row.tripCause : "-"));
  return (
    <tr>
      <td className="px-3 py-2 font-medium text-bms-ink">{row.label}</td>
      <td className="px-3 py-2 text-bms-muted">{row.position}</td>
      <td className="px-3 py-2">{row.rating}</td>
      <td className="px-3 py-2">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass(state.status)}`}>
          {statusLabel}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono">{n(freshValue(s.current, state.stale), 1)}</td>
      <td className="px-3 py-2 text-right font-mono">{n(freshValue(s.kw, state.stale), 2)}</td>
      <td className="px-3 py-2 text-right font-mono">{n(freshValue(s.kwhToday, state.stale), 1)}</td>
      <td className="px-3 py-2 text-bms-muted">{tripCause}</td>
    </tr>
  );
}

export function ControlRoomSldPage({ user }: ControlRoomSldPageProps) {
  return (
    <AppShell
      user={user}
      kpiRibbon={<span className="text-bms-ink">IBMS Control Room · Electrical SLD</span>}
    >
      <SchematicTelemetryProvider
        assetCodes={CR_TRACKED_ASSET_CODES}
        pointKeys={CR_POINT_KEYS}
      >
        <ControlRoomSldContent />
      </SchematicTelemetryProvider>
    </AppShell>
  );
}
