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

type ControlRoomBatteryPageProps = {
  user: AuthUser;
};

type BatteryStatus = "normal" | "warning" | "critical" | "offline";

type RuleState = {
  status: BatteryStatus;
  matchedRule: RuleListItem | null;
  /** True when the asset has stopped reporting (ADR 0027). */
  stale: boolean;
};

type CellReading = {
  index: number;
  voltage: number;
  temperature: number;
};

const STRINGS = [
  { code: "CR-BATT-1", upsCode: "CR-UPS-1", title: "String 1 · BAT-1 (UPS-1)", seed: 7 },
  { code: "CR-BATT-2", upsCode: "CR-UPS-2", title: "String 2 · BAT-2 (UPS-2)", seed: 13 },
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
    case "battery_v":
      return slice.batteryV;
    case "battery_temp_c":
      return slice.batteryTempC;
    case "backup_min":
      return slice.backupMin;
    case "health_pct":
      return slice.healthPct;
    case "current_a":
      return slice.current;
    case "load_pct":
      return slice.loadPct;
    default:
      return null;
  }
}

function severityStatus(severity: string | null): BatteryStatus {
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

  if (matchedRule) {
    return { status: severityStatus(matchedRule.severity), matchedRule, stale: false };
  }
  return { status: "normal", matchedRule: null, stale: false };
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

function statusLabel(status: BatteryStatus): string {
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

function statusPillClass(status: BatteryStatus): string {
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

function statusTone(status: BatteryStatus): "default" | "warning" | "critical" {
  if (status === "critical") {
    return "critical";
  }
  if (status === "warning" || status === "offline") {
    return "warning";
  }
  return "default";
}

function generateCells(
  stringVoltage: number | null,
  stringTemp: number | null,
  seed: number,
): CellReading[] {
  const baseVoltage = (stringVoltage ?? 384) / 32;
  const baseTemp = stringTemp ?? 26;
  let state = seed;
  return Array.from({ length: 32 }, (_, index) => {
    state = (state * 9301 + 49297) % 233280;
    const ratio = state / 233280;
    const voltage = baseVoltage + (ratio - 0.5) * 0.34;
    const temperature = baseTemp + (ratio - 0.5) * 3.5;
    return {
      index: index + 1,
      voltage,
      temperature,
    };
  });
}

function cellClass(status: BatteryStatus): string {
  if (status === "critical") {
    return "border-red-300 bg-red-100 text-red-800";
  }
  if (status === "warning") {
    return "border-amber-300 bg-amber-100 text-amber-900";
  }
  if (status === "offline") {
    return "border-gray-300 bg-gray-100 text-gray-600";
  }
  return "border-bms-green/20 bg-bms-green/10 text-bms-green";
}

function ControlRoomBatteryContent() {
  const rulesQuery = useQuery({
    queryKey: ["rules", "cr-battery"],
    queryFn: fetchRules,
    refetchInterval: 15_000,
  });
  const rules = rulesQuery.data?.items ?? [];
  const batt1 = useCr("CR-BATT-1");
  const batt2 = useCr("CR-BATT-2");
  const ups1 = useCr("CR-UPS-1");
  const ups2 = useCr("CR-UPS-2");
  const nowMs = Date.now();
  const strings = [
    {
      ...STRINGS[0],
      slice: batt1,
      ups: ups1,
      // The string and its UPS are **different assets and either can die
      // alone**, so the UPS's backup-minutes reading needs the UPS's own clock.
      // Gating it on the string's `state.stale` — as the first F4.39 pass did —
      // means a dead `CR-UPS-1` keeps rendering its last autonomy figure for as
      // long as `CR-BATT-1` reports. Autonomy is the number an operator uses to
      // decide whether there is time to react, so a frozen one is the worst
      // value on the page to get wrong. Raised by the F4.39 security review.
      upsStale: isStale(ups1.lastSeenMs, nowMs),
      cells: generateCells(batt1.batteryV, batt1.batteryTempC, STRINGS[0].seed),
      state: deriveRuleState(STRINGS[0].code, batt1, rules, nowMs),
    },
    {
      ...STRINGS[1],
      slice: batt2,
      ups: ups2,
      upsStale: isStale(ups2.lastSeenMs, nowMs),
      cells: generateCells(batt2.batteryV, batt2.batteryTempC, STRINGS[1].seed),
      state: deriveRuleState(STRINGS[1].code, batt2, rules, nowMs),
    },
  ];
  const overall = mergeStatus(strings.map((string) => string.state));
  // Aggregates count only the strings still reporting (ADR 0027 decision 4).
  const liveStrings = strings.filter((string) => !string.state.stale);
  const staleStrings = strings.length - liveStrings.length;
  const liveCritical = strings.filter((s) => s.state.status === "critical").length;
  const healths = liveStrings
    .map((string) => string.slice.healthPct)
    .filter((v): v is number => v != null && !Number.isNaN(v));
  const avgHealth =
    healths.length === 0 ? null : healths.reduce((a, b) => a + b, 0) / healths.length;
  const ruleAlertCount = strings.filter((string) => string.state.matchedRule).length;

  return (
    <div className="mx-auto max-w-[1320px] space-y-4 pb-8">
      <PageHeader
        eyebrow="R.crBat"
        title="Battery Bank · 2 strings, 32 cells each"
        subtitle={
          liveCritical > 0
            ? `${liveCritical} ACTIVE CRITICAL · string voltage · cell grid · health · rule-driven status`
            : "String voltage · cell grid · charge / discharge · health · rule-driven status"
        }
        actions={
          <>
            <DisabledCommandButton>Equalize Charge · disabled</DisabledCommandButton>
            <DisabledCommandButton>Capacity Test · disabled</DisabledCommandButton>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiTile label="String 1 V" status="ready" value={n(freshValue(strings[0].slice.batteryV, strings[0].state.stale), 1)} unit="V" hint="32 cells · 12V VRLA" tone={statusTone(strings[0].state.status)} />
        <KpiTile label="String 2 V" status="ready" value={n(freshValue(strings[1].slice.batteryV, strings[1].state.stale), 1)} unit="V" hint="32 cells · 12V VRLA" tone={statusTone(strings[1].state.status)} />
        <KpiTile label="Charge Current" status="ready" value={n(freshValue(strings[0].slice.current, strings[0].state.stale), 1)} unit="A" hint="float charge" />
        <KpiTile label="Health Index" status="ready" value={n(avgHealth, 0)} unit="%" hint={staleStrings > 0 ? `${staleStrings} string(s) stale` : undefined} tone={statusTone(overall.status)} />
        <KpiTile label="Rule Alerts" status="ready" value={String(ruleAlertCount)} hint="editable in Rule Engine" tone={statusTone(overall.status)} />
      </div>

      {strings.map((string) => (
        <BatteryStringCard key={string.code} string={string} />
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailCard title="Per-Bank Temperature">
          {strings.flatMap((string, index) => [
            <Row
              key={`${string.code}-a`}
              label={`Bank ${index + 1}A (cells 1-16, ${string.code})`}
              value={`${n(bankTemp(string.cells.slice(0, 16)), 1)} C`}
            />,
            <Row
              key={`${string.code}-b`}
              label={`Bank ${index + 1}B (cells 17-32, ${string.code})`}
              value={`${n(bankTemp(string.cells.slice(16)), 1)} C`}
            />,
          ])}
        </DetailCard>
        <DetailCard title="Battery Alerts">
          {batteryAlerts(strings).map((alert) => (
            <div key={alert.label} className="flex items-start gap-2 text-sm">
              <span className={`mt-1 h-2 w-2 rounded-full ${alert.status === "normal" ? "bg-bms-green" : alert.status === "critical" ? "bg-red-600" : "bg-amber-500"}`} />
              <span className="flex-1 text-bms-ink">{alert.label}</span>
              <span className="text-xs text-bms-muted">{alert.when}</span>
            </div>
          ))}
        </DetailCard>
      </div>
    </div>
  );
}

function BatteryStringCard({
  string,
}: {
  string: {
    code: "CR-BATT-1" | "CR-BATT-2";
    upsCode: "CR-UPS-1" | "CR-UPS-2";
    title: string;
    seed: number;
    slice: SchematicTelemetrySlice;
    ups: SchematicTelemetrySlice;
    upsStale: boolean;
    cells: CellReading[];
    state: RuleState;
  };
}) {
  return (
    <section className="rounded border border-gray-200 bg-white">
      <div className="flex flex-col gap-2 border-b border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-condensed text-lg font-bold text-bms-ink">{string.title}</h2>
          {/* Two defects on one line, both found in `F4.39`.
              1. `batteryV` and `backupMin` were rendered **ungated** — `n(...)`
                 with no `freshValue`, so this line held its last numbers while
                 the tiles above it blanked. `F4.38`'s invariant is scoped to the
                 derivation function, which is what made it correct and also what
                 let a raw render site slip past it.
              2. "avg cell" and "avg temp" averaged the 32 synthesized cells, so
                 they restated `batteryV`/`batteryTempC` as if two more
                 instruments had confirmed them. They are replaced by the real
                 string temperature (ADR 0028 decision 4).
              3. And a third, found by the review: `backupMin` comes from the
                 **UPS**, so it takes `upsStale`, not the string's flag. */}
          <p className="text-xs text-bms-muted">
            {n(freshValue(string.slice.batteryV, string.state.stale), 1)} V ·{" "}
            {n(freshValue(string.slice.batteryTempC, string.state.stale), 1)} C · backup{" "}
            {n(freshValue(string.ups.backupMin, string.upsStale), 0)} min
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {string.state.matchedRule ? (
            <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
              {string.state.matchedRule.name}
            </span>
          ) : null}
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusPillClass(string.state.status)}`}>
            {statusLabel(string.state.status)}
          </span>
        </div>
      </div>
      {/* `F4.39`: the grid stays, marked once at its head rather than 32 times.
          No RTU profile carries per-cell points, so there is nothing to wire —
          these 32 voltages are synthesized from the string's own `batteryV`
          plus a per-string seed. They pass the ADR 0027 staleness gate
          correctly, which is exactly what made them convincing: they blank when
          the string dies and move when it reports. Wiring them needs an
          ingestion change, not a UI one (ADR 0028 consequences). */}
      <div className="flex items-center justify-between border-t border-gray-100 px-4 pt-3 text-xs text-bms-muted">
        <span>Per-cell detail</span>
        <StaticValue kind="simulated">synthesized from the string reading</StaticValue>
      </div>
      <div className="grid grid-cols-4 gap-2 px-4 pb-4 pt-2 sm:grid-cols-8 lg:grid-cols-16">
        {string.cells.map((cell) => (
          <div
            key={cell.index}
            className={`rounded border p-1 text-center ${cellClass(string.state.status)}`}
            /* Every cell is synthesised from the string's own batteryV /
               batteryTempC, so once the string is stale the whole grid — and
               its tooltip — is derived from a frozen reading. It is the most
               convincing fake live data on the page: 32 individual voltages.
               ADR 0027 decision 3. */
            title={
              string.state.stale
                ? `Cell #${cell.index} · ${STALE_VALUE}`
                : `Cell #${cell.index} · ${cell.voltage.toFixed(2)} V · ${cell.temperature.toFixed(1)} C`
            }
          >
            <div className="font-mono text-[10px]">#{cell.index}</div>
            <div className="font-mono text-[10px] font-semibold">
              {string.state.stale ? STALE_VALUE : `${cell.voltage.toFixed(2)}V`}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function bankTemp(cells: CellReading[]): number {
  return cells.reduce((sum, cell) => sum + cell.temperature, 0) / cells.length;
}

function batteryAlerts(
  strings: Array<{
    code: "CR-BATT-1" | "CR-BATT-2";
    state: RuleState;
  }>,
): Array<{ label: string; status: BatteryStatus; when: string }> {
  const alerts = strings
    .filter((string) => string.state.matchedRule)
    .map((string) => ({
      label: `${string.code}: ${string.state.matchedRule?.name ?? "Rule matched"}`,
      status: string.state.status,
      when: "live rule",
    }));
  return alerts.length > 0
    ? alerts
    : [
        {
          label: "No battery Rule Engine threshold is currently matched",
          status: "normal",
          when: "live",
        },
        {
          label: "Adjust temperature and backup thresholds from the Rule Engine page",
          status: "normal",
          when: "editable",
        },
      ];
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="font-condensed text-lg font-bold text-bms-ink">{title}</h2>
      </div>
      <div className="space-y-2 p-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-bms-muted">{label}</span>
      <span className="font-mono font-semibold text-bms-ink">{value}</span>
    </div>
  );
}

export function ControlRoomBatteryPage({ user }: ControlRoomBatteryPageProps) {
  return (
    <AppShell
      user={user}
      kpiRibbon={<span className="text-bms-ink">IBMS Control Room · Battery Bank</span>}
    >
      <SchematicTelemetryProvider
        assetCodes={CR_TRACKED_ASSET_CODES}
        pointKeys={CR_POINT_KEYS}
      >
        <ControlRoomBatteryContent />
      </SchematicTelemetryProvider>
    </AppShell>
  );
}
