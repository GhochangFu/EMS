import {
  assert,
  harness,
  PAYLOAD,
  render,
  renderedOutcome,
  schedule,
} from "./report-render.service.spec";
import { NO_HISTORY_URL_SENTENCE } from "./report-render.service";

/**
 * `F4.303` U13 (ADR 0108 Amendment 6 item 8, `trend_points`; plan C20) — the render's branch on
 * the stored template, over `report-render.service.spec.ts`'s harness (its `TrendPointsReportService`
 * fake answers a plan of 3 kept and 1 dropped point at `1m`). Assertions live here;
 * `report-render-trend-points.test.ts` is the Vitest entry point (§4.6). A sibling file, not the
 * phase-A spec, for AGENTS.md §4.5. Each claim makes ONE render or finish call on a fresh harness,
 * so every count is per call.
 */

const ASSET_A = "66666666-6666-4666-8666-666666666666";
const TREND_PARAMS = { points: [{ assetId: ASSET_A, pointKey: "kw" }], compare: true };

function trendSchedule(overrides: Parameters<typeof schedule>[0] = {}) {
  return schedule({ templateId: "trend_points", params: TREND_PARAMS, timezone: "Asia/Kolkata", ...overrides });
}

async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to reject, and it resolved");
}

/** The plan receives the schedule's zone, name, period, stored params and the resolved asset ids. */
export async function assertThePlanReceivesTheSchedule(): Promise<void> {
  const h = harness({ schedule: trendSchedule() });
  await render(h);
  const plans = h.trendPoints.calls.filter((c) => c.method === "plan");
  const input = plans[0]?.arg as Record<string, unknown> | undefined;
  const got = JSON.stringify({
    timezone: input?.timezone,
    periodStart: input?.periodStart,
    periodEnd: input?.periodEnd,
    params: input?.params,
    assetIds: input?.assetIds,
  });
  const expected = JSON.stringify({
    timezone: "Asia/Kolkata",
    periodStart: PAYLOAD.periodStart,
    periodEnd: PAYLOAD.periodEnd,
    params: TREND_PARAMS,
    assetIds: [ASSET_A, "67676767-6767-4676-8676-676767676767"],
  });
  assert(plans.length === 1 && got === expected, `expected one plan with ${expected}, got ${plans.length} and ${got}`);
}

/** A `trend_points` render never calls the energy renderers. */
export async function assertTheEnergyRenderersAreNeverCalled(): Promise<void> {
  const h = harness({ schedule: trendSchedule() });
  await render(h);
  assert(h.reports.calls.length === 0, `expected no ReportsService call, got ${JSON.stringify(h.reports.calls.map((c) => c.method))}`);
}

/** The reads run once for both formats, then one PDF and one XLSX over the same rows. */
export async function assertOneReadServesBothFormats(): Promise<void> {
  const h = harness({ schedule: trendSchedule() });
  await render(h);
  const methods = h.trendPoints.calls.map((c) => c.method);
  const rows = h.trendPoints.calls.filter((c) => c.method === "pdf" || c.method === "xlsx").map((c) => c.arg);
  assert(
    JSON.stringify(methods) === JSON.stringify(["plan", "read", "pdf", "xlsx"]) && rows[0] === rows[1],
    `expected plan, read, pdf, xlsx over one rows object, got ${JSON.stringify(methods)}`,
  );
}

/** With both formats already stored, the plan runs (the mail's counts) and the reads do not. */
export async function assertARetryWithBothFilesReadsNoTelemetry(): Promise<void> {
  const h = harness({ schedule: trendSchedule(), existingFormats: ["pdf", "xlsx"] });
  await render(h);
  const methods = h.trendPoints.calls.map((c) => c.method);
  assert(JSON.stringify(methods) === JSON.stringify(["plan"]), `expected the plan only, got ${JSON.stringify(methods)}`);
}

/** The filenames are `trend-points-<start>-to-<end>.<format>`. */
export async function assertTheFilenamesNameTheTemplate(): Promise<void> {
  const h = harness({ schedule: trendSchedule() });
  await render(h);
  const names = h.inserted.map((row) => row.filename);
  const expected = [`trend-points-${PAYLOAD.periodStart}-to-${PAYLOAD.periodEnd}.pdf`, `trend-points-${PAYLOAD.periodStart}-to-${PAYLOAD.periodEnd}.xlsx`];
  assert(JSON.stringify(names) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(names)}`);
}

/** The `report_files` rows carry `template_id = trend_points`. */
export async function assertTheRowsCarryTheTemplate(): Promise<void> {
  const h = harness({ schedule: trendSchedule() });
  await render(h);
  const templates = h.inserted.map((row) => row.templateId);
  assert(JSON.stringify(templates) === JSON.stringify(["trend_points", "trend_points"]), `expected trend_points twice, got ${JSON.stringify(templates)}`);
}

/** The outcome carries the plan's counts and level for the mail, and no energy previous period. */
export async function assertTheOutcomeCarriesTheSummary(): Promise<void> {
  const h = harness({ schedule: trendSchedule() });
  const outcome = await render(h);
  const carried = outcome.kind === "rendered" ? { s: outcome.trendSummary, q: outcome.previousPeriod } : null;
  assert(
    JSON.stringify(carried) === JSON.stringify({ s: { points: 3, leftOut: 1, level: "1m" }, q: null }),
    `expected the summary and no previous period, got ${JSON.stringify(carried)}`,
  );
}

/** Positive control for the branch: an energy schedule never reaches the trend service. */
export async function assertAnEnergyScheduleNeverPlansPoints(): Promise<void> {
  const h = harness();
  await render(h);
  assert(h.trendPoints.calls.length === 0 && h.reports.calls.length === 2, `expected two energy renders and no trend call, got ${JSON.stringify(h.trendPoints.calls)}`);
}

/** A `trend_points` row whose stored params are the energy arm throws before any put or row. */
export async function assertATrendRowWithoutPointsThrowsBeforeAnyPut(): Promise<void> {
  const h = harness({ schedule: trendSchedule({ params: { compare: true } }) });
  const err = await rejection(() => render(h));
  assert(
    err instanceof Error && h.putKeys.length === 0 && h.inserted.length === 0 && h.trendPoints.calls.length === 0,
    `expected an Error and no put, row or trend call; got puts=${h.putKeys.length} rows=${h.inserted.length} calls=${h.trendPoints.calls.length}`,
  );
}

/** The `trend_points` mail body: the points line, the level line, the history line — and no energy preview. */
export async function assertTheTrendMailBody(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome({ templateId: "trend_points", params: TREND_PARAMS, trendSummary: { points: 3, leftOut: 1, level: "1m" } }));
  const body = h.email.messages[0]?.body ?? "";
  const expected = ["Points: 3, left out: 1", "Level: 1m", NO_HISTORY_URL_SENTENCE].join("\n");
  const previews = h.reports.calls.filter((c) => c.method === "energyPreview").length;
  assert(body === expected && previews === 0, `expected ${JSON.stringify(expected)} and no preview, got ${JSON.stringify(body)} and ${previews}`);
}
