import {
  SUSTAINABILITY_ELECTRICAL_POINT_KEYS,
  SUSTAINABILITY_FACILITY_POINT_KEYS,
  SUSTAINABILITY_HVAC_POINT_KEYS,
  SUSTAINABILITY_MECHANICAL_POINT_KEYS,
  SUSTAINABILITY_WATER_POINT_KEYS,
} from "@bms/shared";

import { STOCK_ASSET_TEMPLATE_CATALOG } from "./stock-catalog";
import { assert } from "./stock-catalog.spec";

/**
 * `E4.2` PR 2 post-merge sweep (owner ruling 2026-09-22) — **a calendar-window
 * `sum` is `avg × hours`, and the label has to say so.**
 *
 * `combineSegments` (`apps/api/src/calc/calc-window-plan.ts`) returns a window
 * `sum` as `(Σ sum_value / Σ sample_count) * hoursCovered`, where
 * `hoursCovered` is `hoursOf(startMs, endMs)` — every hour that has elapsed in
 * the calendar period, not the hours a sample actually arrived in. The only
 * refusal is `Σ sample_count === 0`. So a flow meter that was offline for ten
 * days of a thirty-day month still reports a whole month of water, computed
 * from the twenty days it did report, and the derived point is written a minute
 * ago so the roll-up counts the asset as `fresh`. ADR 0070 consequence 9 states
 * this; ADR 0072 did not carry it forward onto the codes it shipped.
 *
 * **The claim is driven from the formula text, never from a list of the
 * twenty-four codes that exist today.** A hardcoded list is green the day a
 * seventh water class or a second flow code is authored with the same `sum`,
 * which is the exact moment the caveat is needed again.
 *
 * **The `delta` control is the half that matters.** `delta({kwh_total},
 * this_month)` is last-minus-first over the window — a real register
 * difference, immune to the mechanism — so the feeder's and the solar PV's
 * eight calendar-window codes must NOT carry the qualifier. Without that
 * assertion, appending the phrase to every row in the catalog would pass.
 */

/** The phrase every affected label carries. Spelled once here, and once per
 * row in the class module — the assertion below is what holds the two
 * together. */
export const WINDOW_SUM_QUALIFIER = "estimated over the whole period";

/** A `bms-calc-v3` calendar window. `today` is deliberately absent: it names
 * the `E4.1c` rows (`kl_today`, `water_cost_today`,
 * `water_saving_vs_baseline_pct`), which carry the same mechanism and were
 * ruled outside this sweep — reported to the owner rather than relabelled
 * here on the implementer's authority. */
const CALENDAR_PERIOD = /,\s*(this_month|this_year)\s*\)/;

/** The catalog's two other calendar-window `sum` rows —
 * `facility-fire-panel`'s `isolation_hours_month`
 * (`sum({fire_isolate_state}, this_month)`) and `mechanical-lift`'s
 * `out_of_service_hours_month` (`hours(this_month) - sum({lift_in_service},
 * this_month)`). Both are hours-in-state codes on packs `E4.2` did not touch,
 * and both carry the same limitation. Named — never silently filtered by
 * domain — so that the owner's ruling on the twenty-four is what this
 * exemption records, and so a third such row is a new line here rather than an
 * invisible pass. */
const RULED_OUT_OF_SCOPE: ReadonlySet<string> = new Set([
  "isolation_hours_month",
  "out_of_service_hours_month",
]);

/** Every sustainability point key, across the five domain arrays. */
const SUSTAINABILITY_KEYS: ReadonlySet<string> = new Set<string>([
  ...SUSTAINABILITY_ELECTRICAL_POINT_KEYS,
  ...SUSTAINABILITY_WATER_POINT_KEYS,
  ...SUSTAINABILITY_MECHANICAL_POINT_KEYS,
  ...SUSTAINABILITY_HVAC_POINT_KEYS,
  ...SUSTAINABILITY_FACILITY_POINT_KEYS,
]);

type Row = { readonly code: string; readonly pointKey: string; readonly label: string };

/** Every sustainability stock row whose formula reads a calendar window with
 * `fn`, as `[entry code, pointKey, label]`. */
function calendarWindowRows(fn: "sum" | "delta"): Row[] {
  const rows: Row[] = [];
  for (const entry of STOCK_ASSET_TEMPLATE_CATALOG) {
    for (const point of entry.points) {
      const formula = point.formula ?? "";
      if (!SUSTAINABILITY_KEYS.has(point.pointKey)) continue;
      if (RULED_OUT_OF_SCOPE.has(point.pointKey)) continue;
      if (!CALENDAR_PERIOD.test(formula)) continue;
      if (!new RegExp(`\\b${fn}\\(`).test(formula)) continue;
      rows.push({ code: entry.code, pointKey: point.pointKey, label: point.label ?? "" });
    }
  }
  return rows;
}

/**
 * The anti-vacuity floor, in its own claim because `assert` throws: a filter
 * that matched nothing would make both claims below pass while saying nothing.
 * Twenty-four `sum` rows (six water classes × four codes) and eight `delta`
 * rows (the feeder's six, solar PV's two) exist today; the bound is `>=` so
 * that a seventh class is a qualifier failure and not a count failure.
 */
export function runCalendarWindowRowsExistTests(): void {
  const sums = calendarWindowRows("sum");
  const deltas = calendarWindowRows("delta");
  assert(
    sums.length >= 24,
    `the sum-authored calendar-window sustainability rows must number at least 24 (six water ` +
      `classes × kl_this_month/kl_this_year/water_cost_this_month/water_cost_this_year), got ` +
      `${sums.length}: ${sums.map((r) => `${r.code}.${r.pointKey}`).join(", ")}`,
  );
  assert(
    deltas.length >= 8,
    `the delta-authored calendar-window sustainability rows must number at least 8 (the feeder's ` +
      `six, solar PV's two), got ${deltas.length}: ` +
      `${deltas.map((r) => `${r.code}.${r.pointKey}`).join(", ")}`,
  );
}

/** Every `sum`-authored calendar-window row states the limitation in its label. */
export function runEverySumRowCarriesTheQualifierTests(): void {
  const missing = calendarWindowRows("sum").filter((row) => !row.label.includes(WINDOW_SUM_QUALIFIER));
  assert(
    missing.length === 0,
    `a calendar-window sum is avg × every elapsed hour (ADR 0070 consequence 9), so its label ` +
      `must contain "${WINDOW_SUM_QUALIFIER}" — missing on ` +
      `${missing.map((r) => `${r.code}.${r.pointKey} ("${r.label}")`).join(", ")}`,
  );
}

/** No `delta`-authored row carries it — first minus last is a real register
 * difference and saying otherwise would understate a number that is exact. */
export function runNoDeltaRowCarriesTheQualifierTests(): void {
  const wrong = calendarWindowRows("delta").filter((row) => row.label.includes(WINDOW_SUM_QUALIFIER));
  assert(
    wrong.length === 0,
    `delta({…}, this_month) is last minus first and is immune to the sum mechanism, so its label ` +
      `must NOT claim to be an estimate — found on ` +
      `${wrong.map((r) => `${r.code}.${r.pointKey} ("${r.label}")`).join(", ")}`,
  );
}
