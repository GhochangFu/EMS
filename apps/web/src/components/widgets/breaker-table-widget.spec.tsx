import { render, screen, within } from "@testing-library/react";
import { expect } from "vitest";

import type {
  BreakerRow,
  GeneratedSiteAssetDto,
  GeneratedSitePointDto,
  MimicNodeAlarmDto,
  PointKeyStateMapDto,
  SiteWidgetsResponse,
} from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { BreakerTableWidget } from "./breaker-table-widget";

/**
 * `F3.74` Task 4.3 (ADR 0088 decision 10, plan D8) — the breaker table widget, presentation only.
 * The state is derived in the web (`deriveBreakerState`) over the row's points and the socket
 * overlay; `readings` is a stub keyed on `assetId|pointKey`, and its value differs from the DTO's
 * `latest` wherever a claim must tell the two apart. `site-widget-live.spec.tsx` holds the same
 * through the real `useSiteLiveReadings`.
 *
 * A fixture that would let a named mutation survive is avoided on purpose: the CLOSED row carries a
 * non-null `tripCause`, and the stale row has an overlay current, so skipping the gate shows.
 */

const NOW = Date.parse("2026-10-02T10:00:00.000Z");

/** The seeded map (plan D1): `breaker_main` 0 OPEN, 1 CLOSED; `breaker_trip` 1 TRIPPED. */
const STATE_MAPS: readonly PointKeyStateMapDto[] = [
  {
    pointKey: "breaker_main",
    states: [
      { value: 0, label: "OPEN", tone: "open" },
      { value: 1, label: "CLOSED", tone: "closed" },
    ],
  },
  { pointKey: "breaker_trip", states: [{ value: 1, label: "TRIPPED", tone: "tripped" }] },
];

function assetId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function point(pointKey: string, value: number): GeneratedSitePointDto {
  return { pointKey, name: pointKey, unit: null, headlineRank: null, latest: { value, time: "t" } };
}

type Fixture = {
  readonly n: number;
  readonly code: string;
  /** The DTO's seeded state points, as `[pointKey, value]`. */
  readonly state: readonly (readonly [string, number])[];
  readonly roleLabel?: string;
  readonly rating?: string | null;
  readonly tripCause?: string | null;
  readonly topAlarm?: MimicNodeAlarmDto | null;
};

function asset(f: Fixture): GeneratedSiteAssetDto {
  return {
    id: assetId(f.n),
    code: f.code,
    name: f.code,
    domain: "electrical",
    latestTelemetryAt: null,
    freshness: "live",
    points: [point("current_a", 40), point("kw", 9), point("kwh_today", 70), ...f.state.map(([k, v]) => point(k, v))],
  };
}

function row(f: Fixture): BreakerRow {
  return {
    asset: asset(f),
    roleCode: "main-breaker",
    roleLabel: f.roleLabel ?? "Main Breakers",
    rating: f.rating === undefined ? "630 A" : f.rating,
    tripCause: f.tripCause === undefined ? null : f.tripCause,
    activeAlarms: f.topAlarm ? 1 : 0,
    topAlarm: f.topAlarm ?? null,
  };
}

function alarm(tone: "critical" | "warning", label: string): MimicNodeAlarmDto {
  return { severity: tone, tone, label, message: "m", raisedAt: "2026-10-02T09:59:00.000Z" };
}

function response(breakers: BreakerRow[]): SiteWidgetsResponse {
  return {
    dashboardId: "11111111-1111-4111-8111-111111111111",
    tabKey: "sld",
    resolvedAt: "2026-10-02T10:00:00.000Z",
    scope: { assetCount: breakers.length },
    alarms: { active: [], summary: [] },
    roles: [],
    tabs: [],
    breakers,
    stateMaps: [...STATE_MAPS],
  };
}

/** The overlay: `values` by `assetId|pointKey`; an asset in `stale` was last seen a minute ago. */
function readingsOf(values: Readonly<Record<string, number>>, stale: ReadonlySet<string> = new Set()): SiteLiveReadings {
  return {
    nowMs: NOW,
    pointLatest: (id, p) => {
      const value = values[`${id}|${p.pointKey}`];
      return value === undefined ? null : { value, time: "t", atMs: NOW - 1_000 };
    },
    assetLastSeenMs: (a) => (stale.has(a.id) ? NOW - 60_000 : NOW - 1_000),
  };
}

const COMMON = { title: "Breakers", status: "ready" as const, severities: [] };

function draw(breakers: BreakerRow[], values: Readonly<Record<string, number>>, stale?: ReadonlySet<string>): void {
  render(<BreakerTableWidget {...COMMON} data={response(breakers)} readings={readingsOf(values, stale)} />);
}

/** The cell of a column ("Status", "Trip Cause", "I (A)", …) of the row that names `code`. */
function cell(code: string, column: string): string {
  const table = screen.getByRole("table");
  const index = within(table)
    .getAllByRole("columnheader")
    .findIndex((h) => h.textContent === column);
  expect(index, `no column ${column}`).toBeGreaterThanOrEqual(0);
  const tr = screen.getByText(code).closest("tr");
  expect(tr, `no row ${code}`).not.toBeNull();
  return within(tr as HTMLElement).getAllByRole("cell")[index]?.textContent ?? "";
}

const CLOSED = (n: number, code: string, rest: Partial<Fixture> = {}): Fixture => ({ n, code, state: [["breaker_main", 1]], ...rest });
const OPEN = (n: number, code: string, rest: Partial<Fixture> = {}): Fixture => ({ n, code, state: [["breaker_main", 0]], ...rest });
const TRIPPED = (n: number, code: string, rest: Partial<Fixture> = {}): Fixture => ({
  n,
  code,
  state: [["breaker_main", 1], ["breaker_trip", 1]],
  ...rest,
});

/** The overlay answering the DTO's own state values — the quiet case. */
function overlayOf(...fixtures: Fixture[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fixtures) {
    for (const [k, v] of f.state) out[`${assetId(f.n)}|${k}`] = v;
    out[`${assetId(f.n)}|current_a`] = 40;
    out[`${assetId(f.n)}|kw`] = 9;
    out[`${assetId(f.n)}|kwh_today`] = 70;
  }
  return out;
}

// ------------------------------------------------------------------------------------------ T1

/** T1a — `breaker_main` 1 reads CLOSED. */
export function breakerMainOneReadsClosed(): void {
  const f = CLOSED(1, "CR-Q1");
  draw([row(f)], overlayOf(f));
  expect(cell("CR-Q1", "Status")).toBe("CLOSED");
}

/** T1b — `breaker_trip` 1 reads TRIPPED over a CLOSED `breaker_main`. */
export function breakerTripOneReadsTripped(): void {
  const f = TRIPPED(1, "CR-Q9");
  draw([row(f)], overlayOf(f));
  expect(cell("CR-Q9", "Status")).toBe("TRIPPED");
}

/** T1c — a TRIPPED breaker shows its `tripCause`. */
export function aTrippedBreakerShowsItsTripCause(): void {
  const f = TRIPPED(1, "CR-Q9", { tripCause: "Overcurrent" });
  draw([row(f)], overlayOf(f));
  expect(cell("CR-Q9", "Trip Cause")).toBe("Overcurrent");
}

/** T1d — a CLOSED breaker with a `tripCause` set does not show it (beside T1c's positive). */
export function aClosedBreakerDoesNotShowItsTripCause(): void {
  const closed = CLOSED(1, "CR-Q1", { tripCause: "Overcurrent" });
  const tripped = TRIPPED(2, "CR-Q9", { tripCause: "Overcurrent" });
  draw([row(closed), row(tripped)], { ...overlayOf(closed), ...overlayOf(tripped) });
  expect(cell("CR-Q9", "Trip Cause")).toBe("Overcurrent");
  expect(cell("CR-Q1", "Trip Cause")).toBe("-");
}

// ------------------------------------------------------------------------------------------ T2

/** T2a — an OPEN breaker shows its `tripCause`. */
export function anOpenBreakerShowsItsTripCause(): void {
  const f = OPEN(1, "CR-Q11", { tripCause: "Manual isolation" });
  draw([row(f)], overlayOf(f));
  expect(cell("CR-Q11", "Status")).toBe("OPEN");
  expect(cell("CR-Q11", "Trip Cause")).toBe("Manual isolation");
}

/** T2b — an OPEN breaker with no `tripCause` shows "-". */
export function anOpenBreakerWithNoTripCauseShowsADash(): void {
  const f = OPEN(1, "CR-Q11", { tripCause: null });
  draw([row(f)], overlayOf(f));
  expect(cell("CR-Q11", "Status")).toBe("OPEN");
  expect(cell("CR-Q11", "Trip Cause")).toBe("-");
}

// ------------------------------------------------------------------------------------------ T3

/** T3a — a stale breaker is OFFLINE, never CLOSED. */
export function aStaleBreakerIsOffline(): void {
  const f = CLOSED(1, "CR-Q1", { tripCause: "Overcurrent" });
  draw([row(f)], overlayOf(f), new Set([assetId(1)]));
  expect(cell("CR-Q1", "Status")).toBe("OFFLINE");
}

/** T3b — a stale breaker's readings are `—` though the overlay holds numbers (`freshValue`). */
export function aStaleBreakersReadingsAreDashes(): void {
  const fresh = CLOSED(1, "CR-Q1");
  const stale = CLOSED(2, "CR-Q2");
  draw([row(fresh), row(stale)], { ...overlayOf(fresh), ...overlayOf(stale) }, new Set([assetId(2)]));
  expect(cell("CR-Q1", "I (A)")).toBe("40.0");
  expect(cell("CR-Q2", "I (A)")).toBe("—");
  expect(cell("CR-Q2", "kW")).toBe("—");
  expect(cell("CR-Q2", "kWh")).toBe("—");
}

/** T3c — a stale breaker's Trip Cause is `—`, not its stored cause. */
export function aStaleBreakersTripCauseIsADash(): void {
  const f = TRIPPED(1, "CR-Q9", { tripCause: "Overcurrent" });
  draw([row(f)], overlayOf(f), new Set([assetId(1)]));
  expect(cell("CR-Q9", "Trip Cause")).toBe("—");
}

// ------------------------------------------------------------------------------------------ T4

/** T4a — an alarmed CLOSED breaker reads by the alarm's tone: critical. */
export function anAlarmedClosedBreakerReadsCritical(): void {
  const f = CLOSED(1, "CR-Q1", { topAlarm: alarm("critical", "Critical") });
  draw([row(f)], overlayOf(f));
  expect(cell("CR-Q1", "Status")).toBe("CRITICAL");
}

/** T4b — an alarmed CLOSED breaker reads by the alarm's tone: warning. */
export function anAlarmedClosedBreakerReadsWarning(): void {
  const f = CLOSED(1, "CR-Q1", { topAlarm: alarm("warning", "Warning") });
  draw([row(f)], overlayOf(f));
  expect(cell("CR-Q1", "Status")).toBe("WARN");
}

/** T4c — the alarm's label is the Trip Cause of an alarmed CLOSED breaker. */
export function anAlarmedClosedBreakerShowsTheAlarmLabel(): void {
  const f = CLOSED(1, "CR-Q1", { topAlarm: alarm("critical", "Critical") });
  draw([row(f)], overlayOf(f));
  expect(cell("CR-Q1", "Trip Cause")).toBe("Critical");
}

/** T4d — OPEN outranks an alarm's tone (ADR 0088 decision 5). */
export function anOpenBreakerWithAnAlarmStaysOpen(): void {
  const f = OPEN(1, "CR-Q11", { topAlarm: alarm("critical", "Critical") });
  draw([row(f)], overlayOf(f));
  expect(cell("CR-Q11", "Status")).toBe("OPEN");
}

// ------------------------------------------------------------------------------------------ T5

/** T5 — a socket reading replaces the seeded current: 52.3 shows, the DTO's 40 does not. */
export function aSocketReadingUpdatesTheCurrent(): void {
  const f = CLOSED(1, "CR-Q1");
  draw([row(f)], { ...overlayOf(f), [`${assetId(1)}|current_a`]: 52.3 });
  expect(cell("CR-Q1", "I (A)")).toBe("52.3");
}

/** T5b — a socket reading flips the state: the DTO says CLOSED, the overlay says OPEN. */
export function aSocketReadingFlipsTheState(): void {
  const f = CLOSED(1, "CR-Q1");
  draw([row(f)], { ...overlayOf(f), [`${assetId(1)}|breaker_main`]: 0 });
  expect(cell("CR-Q1", "Status")).toBe("OPEN");
}

// ------------------------------------------------------------------------------------------ T6

/** T6 — Position is the role's label, and Rating is the asset's. */
export function positionIsTheRoleLabelAndRatingTheAssets(): void {
  const f = CLOSED(1, "CR-Q6", { roleLabel: "Load Feeder Breakers", rating: "160 A" });
  draw([row(f)], overlayOf(f));
  expect(cell("CR-Q6", "Position")).toBe("Load Feeder Breakers");
  expect(cell("CR-Q6", "Rating")).toBe("160 A");
}

/** T6b — a row with no rating prints "-" (none), not the word "null" and not the stale "—". */
export function aNullRatingPrintsADash(): void {
  const f = CLOSED(1, "CR-Q6", { rating: null });
  draw([row(f)], overlayOf(f));
  expect(cell("CR-Q6", "Rating")).toBe("-");
}

// -------------------------------------------------------------------------------- unknown, order

/** A breaker whose only state point is an unmapped value is "—", never CLOSED (the F4.38 trap). */
export function anUnknownStateIsADashNeverClosed(): void {
  const unknown: Fixture = { n: 1, code: "CR-Q3", state: [["breaker_trip", 0]] };
  const closed = CLOSED(2, "CR-Q1");
  draw([row(closed), row(unknown)], { ...overlayOf(closed), ...overlayOf(unknown) });
  expect(cell("CR-Q1", "Status")).toBe("CLOSED");
  expect(cell("CR-Q3", "Status")).toBe("—");
}

/** An unknown breaker with a warning-tone alarm is still "—" (an alarm tone never names a position). */
export function anUnknownStateWithAWarningStaysADash(): void {
  const unknown: Fixture = { n: 1, code: "CR-Q3", state: [["breaker_trip", 0]], topAlarm: alarm("warning", "Warning") };
  draw([row(unknown)], overlayOf(unknown));
  expect(cell("CR-Q3", "Status")).toBe("—");
}

/** The rows keep the response's order (the read sorted them by role, then code). */
export function rowsKeepTheResponseOrder(): void {
  const a = CLOSED(1, "CR-Q2");
  const b = CLOSED(2, "CR-Q1");
  draw([row(a), row(b)], { ...overlayOf(a), ...overlayOf(b) });
  const codes = within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((tr) => within(tr).getAllByRole("cell")[0]?.textContent);
  expect(codes).toEqual(["CR-Q2", "CR-Q1"]);
}

/** No breakers in scope: the empty line draws, and no table does. */
export function noBreakersDrawsTheEmptyLine(): void {
  render(<BreakerTableWidget {...COMMON} data={response([])} readings={readingsOf({})} />);
  expect(screen.getByText("No breakers in scope")).toBeInTheDocument();
  expect(screen.queryByRole("table")).toBeNull();
}

/** A static draw (the builder: no data, no readings) shows the empty line, never a stale number. */
export function aStaticDrawShowsTheEmptyLine(): void {
  render(<BreakerTableWidget {...COMMON} data={undefined} readings={null} />);
  expect(screen.getByText("No breakers in scope")).toBeInTheDocument();
}

/** A ready table with rows has no empty line (the positive beside the two above). */
export function aTableWithRowsHasNoEmptyLine(): void {
  const f = CLOSED(1, "CR-Q1");
  draw([row(f)], overlayOf(f));
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.queryByText("No breakers in scope")).toBeNull();
}
