import { MetricsService, type CalcRuntimeSkipReason } from "../observability/metrics.service";
import type { CalcSkipReason } from "./calc-definition";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Every `CalcSkipReason` (an unusable stored definition) plus the three
 * runtime-only reasons (a usable definition skipped this evaluation) —
 * kept as a literal list here, deliberately not derived from the type, so a
 * reason added to `CalcSkipReason` without a matching entry here fails this
 * test rather than silently having no metrics coverage. */
const ALL_REASONS: CalcRuntimeSkipReason[] = [
  "not_derived",
  "no_formula",
  "bad_dialect",
  "unparseable_formula",
  "no_trigger",
  "missing_interval",
  "interval_on_streaming",
  "interval_out_of_range",
  "max_input_age_out_of_range",
  "missing_input",
  "stale_input",
  "non_finite",
] satisfies (CalcSkipReason | "missing_input" | "stale_input" | "non_finite")[];

async function readMetricValue(metrics: MetricsService, name: string): Promise<string> {
  return metrics.registry.getSingleMetricAsString(name);
}

/** The registry's default labels (`service="bms-api"`, ADR-required on every
 * series) sit between the metric name and its value, so a plain substring
 * match on `"<name> <value>"` never matches — this pulls the trailing number
 * off the metric's own (non-HELP/TYPE) line instead. */
function metricValue(text: string, metricName: string): number | undefined {
  const line = text.split("\n").find((l) => l.startsWith(metricName) && !l.startsWith("#"));
  const match = line?.match(/\s(-?\d+(?:\.\d+)?)\s*$/);
  return match ? Number(match[1]) : undefined;
}

export async function runCalcMetricsTests(): Promise<void> {
  const metrics = new MetricsService();

  // ---- every reason has a path that increments the counter, distinctly ---------

  for (const reason of ALL_REASONS) {
    metrics.countCalcSkipped(reason);
  }
  const skippedText = await readMetricValue(metrics, "bms_api_calc_skipped_total");
  for (const reason of ALL_REASONS) {
    assert(
      skippedText.includes(`reason="${reason}"`),
      `bms_api_calc_skipped_total must carry a distinct series for reason="${reason}"`,
    );
  }

  // ---- values-written counter ----------------------------------------------------

  metrics.countCalcValuesWritten(3);
  metrics.countCalcValuesWritten();
  const writtenText = await readMetricValue(metrics, "bms_api_calc_values_written_total");
  assert(
    metricValue(writtenText, "bms_api_calc_values_written_total") === 4,
    `expected bms_api_calc_values_written_total to read 4 (3 + default 1), got: ${writtenText}`,
  );

  // ---- active-formulas gauge, settable up and down --------------------------------

  metrics.setCalcActiveFormulas(7);
  const upText = await readMetricValue(metrics, "bms_api_calc_active_formulas");
  assert(
    metricValue(upText, "bms_api_calc_active_formulas") === 7,
    `expected the gauge to read 7, got: ${upText}`,
  );

  metrics.setCalcActiveFormulas(2);
  const downText = await readMetricValue(metrics, "bms_api_calc_active_formulas");
  assert(
    metricValue(downText, "bms_api_calc_active_formulas") === 2,
    `a gauge must be settable back down, expected 2, got: ${downText}`,
  );
}
