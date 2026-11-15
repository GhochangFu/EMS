/**
 * ML data readiness (`E1.1` step 0, ADR 0135 decision 8).
 *
 * Answers one question before any model work starts: for each asset class, do
 * we hold enough **real** history to train or run a model, or only simulator
 * output? Pure rules live here so they carry a spec; the database read is in
 * `ml-data-readiness-cli.ts`.
 *
 * "Real" means an asset whose `meta.telemetrySource` is `mqtt` (the simulator
 * skips those), or a point measured through an RTU whose `ingest_enabled` is
 * true — the paths that carry field data (ADR 0007, ADR 0016). Everything else
 * that has rows was written by `apps/sim`, and a model trained on it learns the
 * simulator's formulas, not the plant.
 */

/** One row the CLI's SQL returns: an asset class × data source summary. */
export interface ReadinessRow {
  domain: string;
  /** `asset_templates.asset_type`, or `(no template)` for hand-built assets. */
  assetType: string;
  /** `real` = measured through an ingest-enabled RTU; `simulated` otherwise. */
  source: "real" | "simulated";
  assets: number;
  points: number;
  /** Distinct calendar days holding at least one `_1h` bucket. */
  daysWithData: number;
  /** Hours with data ÷ hours between first and last bucket, per point, averaged. 0..1. */
  meanHourlyCoverage: number;
  firstBucket: string | null;
  lastBucket: string | null;
  /** Distinct point keys present, used to detect battery / pump signals. */
  pointKeys: string[];
  /** Work orders on these assets carrying a closed date — RUL needs failure history. */
  closedWorkOrders: number;
}

export type UseCase = "forecasting" | "anomaly" | "battery_health" | "rul";
export type Verdict = "ready" | "partial" | "not_ready";

export interface UseCaseReadiness {
  useCase: UseCase;
  verdict: Verdict;
  reason: string;
}

/**
 * Thresholds, stated once. They are starting points to be revisited after the
 * first model run, not tuned values:
 * - forecasting: a zero-shot model needs a context window; 14 days covers two
 *   weekly cycles, 56 days gives eight.
 * - anomaly: a per-asset baseline needs a "normal" period; 28 days, with
 *   coverage high enough that gaps are not themselves the anomaly.
 * - battery health: the signals BatteryML-style features are built from.
 * - RUL: needs failures to learn from; 10 closed work orders is a floor for a
 *   first look, not for a production model.
 */
export const THRESHOLDS = {
  forecastingMinDays: 14,
  forecastingGoodDays: 56,
  anomalyMinDays: 28,
  minCoverage: 0.8,
  rulMinClosedWorkOrders: 10,
} as const;

/** Point-key families a battery-health model needs. One key from each family. */
export const BATTERY_SIGNAL_FAMILIES: ReadonlyArray<{ name: string; keys: readonly string[] }> = [
  { name: "voltage", keys: ["battery_v", "batt_volt", "cell_voltage_min_v", "cell_voltage_max_v"] },
  { name: "temperature", keys: ["battery_temp_c"] },
  { name: "current or charge", keys: ["battery_current_a", "battery_charge_pct"] },
];

export function missingBatteryFamilies(pointKeys: readonly string[]): string[] {
  const have = new Set(pointKeys);
  return BATTERY_SIGNAL_FAMILIES.filter((f) => !f.keys.some((k) => have.has(k))).map((f) => f.name);
}

function hasAnyBatterySignal(pointKeys: readonly string[]): boolean {
  return missingBatteryFamilies(pointKeys).length < BATTERY_SIGNAL_FAMILIES.length;
}

/**
 * Verdicts for one row. A simulated row is never `ready`: it can exercise the
 * pipeline end to end, which is worth saying, but it cannot validate a model.
 */
export function assessRow(row: ReadinessRow): UseCaseReadiness[] {
  const out: UseCaseReadiness[] = [];
  const cov = row.meanHourlyCoverage;
  const covPct = `${Math.round(cov * 100)}% hourly coverage`;

  if (row.source === "simulated") {
    const why = "simulator data only: fine for testing the pipeline, not for judging a model";
    out.push({ useCase: "forecasting", verdict: "not_ready", reason: why });
    out.push({ useCase: "anomaly", verdict: "not_ready", reason: why });
    if (hasAnyBatterySignal(row.pointKeys)) {
      out.push({ useCase: "battery_health", verdict: "not_ready", reason: why });
    }
    out.push({ useCase: "rul", verdict: "not_ready", reason: why });
    return out;
  }

  const days = row.daysWithData;
  const T = THRESHOLDS;

  // Forecasting
  if (days >= T.forecastingGoodDays && cov >= T.minCoverage) {
    out.push({ useCase: "forecasting", verdict: "ready", reason: `${days} days, ${covPct}` });
  } else if (days >= T.forecastingMinDays) {
    out.push({
      useCase: "forecasting",
      verdict: "partial",
      reason: `${days} days, ${covPct}: zero-shot works, accuracy improves past ${T.forecastingGoodDays} days`,
    });
  } else {
    out.push({
      useCase: "forecasting",
      verdict: "not_ready",
      reason: `${days} days; need at least ${T.forecastingMinDays}`,
    });
  }

  // Anomaly
  if (days >= T.anomalyMinDays && cov >= T.minCoverage) {
    out.push({ useCase: "anomaly", verdict: "ready", reason: `${days} days, ${covPct}` });
  } else if (days >= T.anomalyMinDays) {
    out.push({
      useCase: "anomaly",
      verdict: "partial",
      reason: `${days} days but only ${covPct}; gaps would read as anomalies`,
    });
  } else {
    out.push({
      useCase: "anomaly",
      verdict: "not_ready",
      reason: `${days} days; need ${T.anomalyMinDays} of normal operation`,
    });
  }

  // Battery — only reported where the class carries any battery signal.
  if (hasAnyBatterySignal(row.pointKeys)) {
    const missing = missingBatteryFamilies(row.pointKeys);
    if (missing.length === 0 && days >= T.anomalyMinDays) {
      out.push({ useCase: "battery_health", verdict: "ready", reason: `all signal families present, ${days} days` });
    } else if (missing.length === 0) {
      out.push({
        useCase: "battery_health",
        verdict: "partial",
        reason: `signals present, only ${days} days`,
      });
    } else {
      out.push({ useCase: "battery_health", verdict: "not_ready", reason: `missing: ${missing.join(", ")}` });
    }
  }

  // RUL
  if (row.closedWorkOrders >= T.rulMinClosedWorkOrders) {
    out.push({ useCase: "rul", verdict: "partial", reason: `${row.closedWorkOrders} closed work orders: enough for a first look` });
  } else {
    out.push({
      useCase: "rul",
      verdict: "not_ready",
      reason: `${row.closedWorkOrders} closed work orders; need ${T.rulMinClosedWorkOrders}+ with failure history`,
    });
  }

  return out;
}

const MARK: Record<Verdict, string> = { ready: "READY", partial: "PARTIAL", not_ready: "NOT READY" };

/** Plain-text report: one block per asset class and source. */
export function renderReport(rows: readonly ReadinessRow[], generatedAt: string): string {
  const lines: string[] = [];
  lines.push(`ML data readiness — generated ${generatedAt}`);
  lines.push(`Source: telemetry.point_values_1h · real = fed by MQTT ingest (the simulator never writes it)`);
  lines.push("");
  if (rows.length === 0) {
    lines.push("No telemetry in telemetry.point_values_1h. Nothing to assess.");
    return lines.join("\n") + "\n";
  }
  const sorted = [...rows].sort(
    (a, b) =>
      (a.source === b.source ? 0 : a.source === "real" ? -1 : 1) ||
      a.domain.localeCompare(b.domain) ||
      a.assetType.localeCompare(b.assetType),
  );
  for (const row of sorted) {
    lines.push(`[${row.source.toUpperCase()}] ${row.domain} / ${row.assetType}`);
    lines.push(
      `  ${row.assets} assets · ${row.points} points · ${row.daysWithData} days · ` +
        `${Math.round(row.meanHourlyCoverage * 100)}% coverage · ${row.firstBucket ?? "—"} → ${row.lastBucket ?? "—"}`,
    );
    for (const r of assessRow(row)) {
      lines.push(`  ${MARK[r.verdict].padEnd(9)} ${r.useCase.padEnd(15)} ${r.reason}`);
    }
    lines.push("");
  }
  const real = rows.filter((r) => r.source === "real");
  lines.push(
    `Summary: ${real.length} asset class(es) with real data, ` +
      `${rows.length - real.length} with simulator data only.`,
  );
  return lines.join("\n") + "\n";
}
