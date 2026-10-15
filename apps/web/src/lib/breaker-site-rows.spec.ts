import { expect } from "vitest";

import type {
  BreakerRow,
  GeneratedSitePointDto,
  MimicNodeAlarmDto,
  PointKeyStateMapDto,
  SiteWidgetsResponse,
} from "@bms/shared";

import type { SiteLiveReadings } from "../hooks/use-site-live-readings";
import { breakerSiteRows } from "./breaker-site-rows";

/**
 * `F3.80` / ADR 0101 d10, d11 — the breaker table rows of the two flow tones: `flowing` takes the
 * `closed` path (an alarm's tone, else `normal`) and `shut` the `open` path (status `open`, the
 * stored trip cause). `BreakerVisualStatus` gains no key.
 *
 * Assertions live here; `breaker-site-rows.test.ts` is the vitest entry point (ADR 0014). The shut
 * row carries an alarm whose label differs from its stored cause, so a `shut` that fell through to
 * the alarm-label path shows.
 */

const NOW = Date.parse("2026-10-15T10:00:00.000Z");

/** The seeded `valve_open` map (`point-key-states-seed.ts`). */
const STATE_MAPS: readonly PointKeyStateMapDto[] = [
  {
    pointKey: "valve_open",
    states: [
      { value: 0, label: "SHUT", tone: "shut" },
      { value: 1, label: "OPEN", tone: "flowing" },
    ],
  },
];

function point(pointKey: string, value: number): GeneratedSitePointDto {
  return { pointKey, name: pointKey, unit: null, headlineRank: null, latest: { value, time: "t" } };
}

const WARNING: MimicNodeAlarmDto = {
  severity: "warning",
  tone: "warning",
  label: "Valve position alarm",
  message: "m",
  raisedAt: "2026-10-15T09:59:00.000Z",
};

function valveRow(n: number, code: string, topAlarm: MimicNodeAlarmDto | null, tripCause: string | null): BreakerRow {
  return {
    asset: {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      code,
      name: code,
      domain: "water",
      latestTelemetryAt: null,
      freshness: "live",
      points: [point("valve_open", 1)],
    },
    roleCode: "isolation-valve",
    roleLabel: "Isolation Valves",
    rating: null,
    tripCause,
    activeAlarms: topAlarm === null ? 0 : 1,
    topAlarm,
  };
}

function response(breakers: BreakerRow[]): SiteWidgetsResponse {
  return {
    dashboardId: "11111111-1111-4111-8111-111111111111",
    tabKey: null,
    resolvedAt: "2026-10-15T10:00:00.000Z",
    scope: { assetCount: breakers.length },
    alarms: { active: [], summary: [] },
    roles: [],
    tabs: [],
    breakers,
    stateMaps: [...STATE_MAPS],
  };
}

/** Every asset fresh; `valve_open` reads `value` for every asset. */
function readingsOf(value: number): SiteLiveReadings {
  return {
    nowMs: NOW,
    pointLatest: () => ({ value, time: "t", atMs: NOW - 1_000 }),
    assetLastSeenMs: () => NOW - 1_000,
  };
}

/** `valve_open` 1 with no alarm: the row is `normal`, as a CLOSED breaker's is. */
export function aFlowingRowIsNormal(): void {
  const [row] = breakerSiteRows(response([valveRow(1, "ND-FL-CV", null, null)]), readingsOf(1));
  expect(row?.status).toBe("normal");
}

/** `valve_open` 0: the row is `open` and its Trip Cause cell is the stored cause, not the alarm. */
export function aShutRowIsOpenWithTheTripCause(): void {
  const [row] = breakerSiteRows(
    response([valveRow(2, "ND-FL-ISO-V1", WARNING, "Isolated for maintenance")]),
    readingsOf(0),
  );
  expect(row?.status).toBe("open");
  expect(row?.tripCause).toBe("Isolated for maintenance");
}
