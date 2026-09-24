import { RadialGaugeWidget } from "../widgets/radial-gauge-widget";
import type { RadialGaugeConfig } from "../../lib/widget-catalog";
import { freshValue, isStale, type SchematicTelemetrySlice } from "../../lib/schematic-telemetry";
import { avgOf } from "../../lib/control-room-tiles";

/*
 * Band semantics. `buildRadialGaugeOption` reads a threshold as "at or above
 * this value, this tone begins", and paints the band below the first
 * threshold `ok`. A "higher is worse" gauge (UPS load) therefore lists its
 * thresholds as-is. A "lower is worse" gauge (battery health, power factor)
 * opens with a threshold at `min` carrying the worst tone, so the band from
 * `min` starts in that tone, and closes with an `ok` threshold at the healthy
 * boundary. The spec checks the painted band at a reading inside each band.
 */

/** OQ3: 0–100 %, warning at 80, critical at 95 — both UPS units share this config. */
const UPS_LOAD_CONFIG: RadialGaugeConfig = {
  min: 0,
  max: 100,
  unit: "%",
  decimals: 0,
  thresholds: [
    { value: 80, tone: "warning" },
    { value: 95, tone: "critical" },
  ],
};

/** OQ3: 0–100 %, critical below 70, warning below 85, ok from 85. */
const BATTERY_HEALTH_CONFIG: RadialGaugeConfig = {
  min: 0,
  max: 100,
  unit: "%",
  decimals: 0,
  thresholds: [
    { value: 0, tone: "critical" },
    { value: 70, tone: "warning" },
    { value: 85, tone: "ok" },
  ],
};

/** OQ3: 0–1, two decimals, warning below 0.9, ok from 0.9. */
const POWER_FACTOR_CONFIG: RadialGaugeConfig = {
  min: 0,
  max: 1,
  decimals: 2,
  thresholds: [
    { value: 0, tone: "warning" },
    { value: 0.9, tone: "ok" },
  ],
};

type GaugeProps = {
  title: string;
  primary: number | null;
  stale: boolean;
  config: RadialGaugeConfig;
};

/** One gauge, in a `group` named by its title so a reader can scope a query to it. */
function Gauge({ title, primary, stale, config }: GaugeProps) {
  return (
    <div role="group" aria-label={title}>
      <RadialGaugeWidget title={title} status="ready" primary={primary} stale={stale} config={config} />
    </div>
  );
}

type KeyParametersProps = {
  ups1: SchematicTelemetrySlice;
  ups2: SchematicTelemetrySlice;
  batt1: SchematicTelemetrySlice;
  batt2: SchematicTelemetrySlice;
  main: SchematicTelemetrySlice;
  nowMs: number;
};

/**
 * `/cr-overview` Key Parameters strip (`F3.28` task 3.6, OQ3): four
 * `RadialGaugeWidget`s — UPS-1 load %, UPS-2 load %, battery health % and the
 * main incomer's power factor. The page already subscribes to all five
 * slices this needs; this component opens no subscription of its own.
 *
 * Every `primary` is `freshValue(rawValue, isStale(...))` (ADR 0027) — never
 * the raw slice value — so a dead asset's frozen last reading renders as
 * "no data" (the needle at `config.min`) rather than a stale number presented
 * as current.
 *
 * **Battery health average.** `CR-BATT-1` and `CR-BATT-2` are averaged using
 * only the units that are currently fresh; a stale unit is dropped from the
 * average rather than contributing its frozen `health_pct`, and the gauge
 * reads `null` only when *both* units are stale (`avgOf` already returns
 * `null` on an empty input, so this file states no extra rule for that case).
 */
export function KeyParameters({ ups1, ups2, batt1, batt2, main, nowMs }: KeyParametersProps) {
  const ups1Stale = isStale(ups1.lastSeenMs, nowMs);
  const ups2Stale = isStale(ups2.lastSeenMs, nowMs);
  const batt1Stale = isStale(batt1.lastSeenMs, nowMs);
  const batt2Stale = isStale(batt2.lastSeenMs, nowMs);
  const mainStale = isStale(main.lastSeenMs, nowMs);

  const batteryHealth = avgOf([
    freshValue(batt1.healthPct, batt1Stale),
    freshValue(batt2.healthPct, batt2Stale),
  ]);

  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="font-condensed text-lg font-bold text-bms-ink">Key Parameters</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Gauge
          title="UPS-1 Load"
          primary={freshValue(ups1.loadPct, ups1Stale)}
          stale={ups1Stale}
          config={UPS_LOAD_CONFIG}
        />
        <Gauge
          title="UPS-2 Load"
          primary={freshValue(ups2.loadPct, ups2Stale)}
          stale={ups2Stale}
          config={UPS_LOAD_CONFIG}
        />
        <Gauge
          title="Battery Health"
          primary={batteryHealth}
          stale={batt1Stale && batt2Stale}
          config={BATTERY_HEALTH_CONFIG}
        />
        <Gauge
          title="Main Power Factor"
          primary={freshValue(main.pf, mainStale)}
          stale={mainStale}
          config={POWER_FACTOR_CONFIG}
        />
      </div>
    </section>
  );
}
