import { MetricsService, type CalcRuntimeSkipReason } from "../observability/metrics.service";

/** Every `CalcSkipReason` (an unusable stored definition) plus the eight
 * runtime-only reasons (a usable definition skipped this evaluation), as a
 * `Record<CalcRuntimeSkipReason, true>` rather than a plain literal array —
 * a plain array typed as `CalcRuntimeSkipReason[]` compiles fine even when a
 * reason is missing from it (the type only bounds the elements, it does not
 * require all of them), so a 10th reason added to the union would pass this
 * test with zero coverage. A `Record` keyed on the full union does not
 * compile unless every member has an entry, so an added reason forces a
 * build failure here until it is added below. */
const ALL_REASONS_RECORD: Record<CalcRuntimeSkipReason, true> = {
  not_derived: true,
  no_formula: true,
  bad_dialect: true,
  unparseable_formula: true,
  no_trigger: true,
  missing_interval: true,
  interval_on_streaming: true,
  interval_out_of_range: true,
  max_input_age_out_of_range: true,
  streaming_on_v2: true,
  self_reference: true,
  v1_references_derived: true,
  coverage_ratio_out_of_range: true,
  missing_input: true,
  stale_input: true,
  non_finite: true,
  dependency_cycle: true,
  membership_unresolved: true,
  unknown_asset_reference: true,
  no_members: true,
  coverage_below_floor: true,
};
const ALL_REASONS = Object.keys(ALL_REASONS_RECORD) as CalcRuntimeSkipReason[];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

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

  // ---- ADR 0055 decision 11: excluded members accumulate; the member max is a gauge --

  metrics.countCalcAggregateExcluded(2);
  metrics.countCalcAggregateExcluded(1);
  const excludedText = await readMetricValue(metrics, "bms_api_calc_aggregate_members_excluded_total");
  assert(
    metricValue(excludedText, "bms_api_calc_aggregate_members_excluded_total") === 3,
    `expected bms_api_calc_aggregate_members_excluded_total to read 3 (2 + 1), got: ${excludedText}`,
  );

  metrics.setCalcAggregateMembersMax(12);
  metrics.setCalcAggregateMembersMax(4);
  const membersMaxText = await readMetricValue(metrics, "bms_api_calc_aggregate_members_max");
  assert(
    metricValue(membersMaxText, "bms_api_calc_aggregate_members_max") === 4,
    `bms_api_calc_aggregate_members_max is a gauge — the last sweep's value, not a maximum over time; expected 4, got: ${membersMaxText}`,
  );
}
