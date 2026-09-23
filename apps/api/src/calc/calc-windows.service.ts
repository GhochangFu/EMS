import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";

import type { BmsDb } from "@bms/db";
import { windowKey, type CalcCalendarWindow, type CalcWindowRead } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_POOL } from "../database/database.tokens";
import { aggregateRelation, type AggregateLevel } from "../telemetry/point-aggregates";
import {
  budgetDefect,
  combineSegments,
  deltaOf,
  hoursOf,
  planWindowSegments,
  rollingStartMs,
  WINDOW_LEVELS,
  type Sample,
  type Segment,
  type SegmentRow,
  type Watermarks,
  type WindowValue,
} from "./calc-window-plan";

/** One window read the sweep asks for: the owning asset (whose location's
 * zone a calendar window uses), the asset actually read (the owner for a bare
 * `{key}`, the resolved code for a qualified one), the node, and the window's
 * end — the definition's bucketed tick floored to the minute. */
export type WindowReadRequest = {
  readonly ownerAssetId: string;
  readonly readAssetId: string;
  readonly node: CalcWindowRead;
  readonly endMs: number;
};

/** `windows_unresolved` here is the budget refusal (`MAX_WINDOW_BUCKETS` / `MAX_LIVE_MINUTES`):
 * the read was not attempted, and `detail` names the watermarks so the host
 * can warn once per sweep. The other three are data: `window_sparse` is a
 * `sum` whose covered time is below `MIN_WINDOW_COVERAGE` of its elapsed
 * window (ADR 0070 Amendment 3, `E4.4`). */
export type WindowReadReason = "window_empty" | "window_sparse" | "timezone_unset" | "windows_unresolved";

export type WindowReadResult = { ok: true; value: number } | { ok: false; reason: WindowReadReason; detail?: string };

/** The key `resolveReads` answers under — the owner, the canonical read and
 * the window's end, so two definitions on one asset with different intervals
 * never share an answer. The host builds `evaluate`'s fifth map from the same
 * function. */
export function windowRequestKey(ownerAssetId: string, node: CalcWindowRead, endMs: number): string {
  return `${ownerAssetId}:${windowKey(node)}@${endMs}`;
}

const VIEW_NAMES: Readonly<Record<AggregateLevel, string>> = {
  "1m": "point_values_1m",
  "5m": "point_values_5m",
  "1h": "point_values_1h",
  "1d": "point_values_1d",
};

/** The coverage unit per level (ADR 0070 Amendment 3 decision 3) — a
 * literal chosen here from a closed map, never from the formula, like
 * `PERIOD_UNIT`: a `1d` bucket with samples covers its day; every finer level
 * is counted in clock hours (the one-hour floor). `time_bucket` on a
 * `timestamptz` at these widths is epoch-aligned in UTC — the alignment of the
 * `0027` views and of `LEVEL_MS` flooring in the planner — so the session
 * `TimeZone` cannot leak in. `coveredHoursOf` reads the same widths. */
const COVERAGE_UNIT_SQL: Readonly<Record<AggregateLevel, string>> = {
  "1d": "INTERVAL '1 day'",
  "1h": "INTERVAL '1 hour'",
  "5m": "INTERVAL '1 hour'",
  "1m": "INTERVAL '1 hour'",
};

/** `date_trunc` unit per calendar window — mapped in TS, never interpolated
 * from the formula: the period is a closed vocabulary and the SQL sees only
 * one of these four words. `this_week` starts on Monday, which is what
 * `date_trunc('week', …)` gives. */
const PERIOD_UNIT: Readonly<Record<CalcCalendarWindow, "day" | "week" | "month" | "year">> = {
  today: "day",
  this_week: "week",
  this_month: "month",
  this_year: "year",
};

type Planned = {
  readonly index: number;
  readonly request: WindowReadRequest;
  readonly startMs: number;
  readonly segments: Segment[];
};

/**
 * Resolves what a `bms-calc-v3` formula's window reads are worth **at a
 * tick** (ADR 0070 decisions 5 and 6; `E4.1b` U8) — the fifth map
 * `evaluate()` takes. Pure arithmetic lives in `./calc-window-plan`; this
 * class reads the four watermarks, the calendar bounds, one statement per
 * level the plans name, and the two `delta` probes, batched once per sweep.
 *
 * **Two connections, for two reasons.** The aggregate views and
 * `telemetry.point_values` are not policied, so the reads go through
 * `TENANT_POOL` like `CalcInputsService`'s. The calendar-bounds statement
 * joins `bms.assets` and `bms.locations`, both under FORCE RLS, and the
 * scheduled sweep is a cross-organization system read with no tenant actor
 * (ADR 0043 Amendments 2 and 3 — `CalcParametersService` records the same
 * reason), so that one statement runs on `FLEET_DRIZZLE`. It reads the
 * OWNING asset's location's zone even for a qualified reference (ADR 0070
 * decision 6): the formula belongs to the owner, and so does its calendar.
 *
 * **A calendar window on a location with no zone is `timezone_unset`** — and
 * so is one whose stored zone the server no longer recognises (the security
 * review of PR 1, L2): `AT TIME ZONE` on an unknown name raises, and a raised
 * batch would refuse every definition in the sweep as `windows_unresolved`
 * for one bad row. The statement therefore joins `pg_timezone_names` once
 * and yields `NULL` for an unknown name, which the host counts under the
 * same reason an unset one gets. No default zone anywhere: an absent owner
 * (an asset that does not exist) is `timezone_unset` too, fail closed.
 *
 * **Why compose levels and why `1d` never serves a partial day** — the
 * planner's docblock; this class only runs the plan it is handed. **Why the
 * `delta` probes are two `LIMIT 1` laterals and never a range scan** — ADR
 * 0070 decision 5: first and last inside `[start, end)` on
 * `point_values_point_asset_time_idx`, so `delta({kwh}, this_year)` costs
 * what `delta({kwh}, 24h)` does. `tests/adr-0070-calc-v3-invariants.test.ts`
 * part (e) scans this file for exactly two `FROM telemetry.point_values`
 * each followed by a `LIMIT 1`, and every other `FROM telemetry.` here names
 * one of the four views.
 *
 * **Statement budget: at most seven per sweep** — watermarks, calendar
 * bounds (only when a calendar read exists), one per level with at least one
 * segment (≤ 4), and the delta probes (only when a `delta` exists). Empty
 * requests → no statement. **Row budget per read** (`budgetDefect`) — a plan
 * that would fold more than `MAX_WINDOW_BUCKETS` (a stalled coarse policy
 * pushing a year onto `5m`) or aggregate more than `MAX_LIVE_MINUTES` of raw
 * rows beyond the `1m` watermark (a blocked refresh) is refused before any
 * level statement runs, as `windows_unresolved` with the watermarks in
 * `detail`.
 *
 * **Covered time rides in the level statement** (ADR 0070 Amendment 3
 * decision 3, `E4.4`). A window `sum` refuses `window_sparse` below
 * `MIN_WINDOW_COVERAGE`, so each level statement returns three more
 * aggregates per segment — the distinct coverage units (days on `1d`, clock
 * hours below) holding a non-empty bucket, and whether the segment's first
 * and last units are among them — inside the same lateral, over the same
 * single scan. No statement is added, so the budget of seven holds;
 * `combineSegments` folds the facts into hours with `coveredHoursOf` across
 * all of a read's segments at once — a clock hour two adjacent segments share
 * is merged, covered when any of its parts holds a sample (owner ruling
 * 2026-09-23, from the `E4.4` code review) — and guards `sum` alone.
 */
@Injectable()
export class CalcWindowsService {
  constructor(
    @Inject(TENANT_POOL) private readonly pool: Pool,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
  ) {}

  /**
   * The value of every distinct read in `requests` at its own window end,
   * keyed by `windowRequestKey`; a read that cannot be answered carries its
   * reason instead. Every distinct key is answered — an owner with no
   * location is `timezone_unset` — so an absent key means the batch itself
   * did not run.
   */
  async resolveReads(requests: readonly WindowReadRequest[]): Promise<Map<string, WindowReadResult>> {
    const out = new Map<string, WindowReadResult>();
    const distinct = new Map<string, WindowReadRequest>();
    for (const request of requests) {
      distinct.set(windowRequestKey(request.ownerAssetId, request.node, request.endMs), request);
    }
    if (distinct.size === 0) {
      return out;
    }
    const wanted = [...distinct.entries()];

    const watermarks = await this.readWatermarks();
    const calendarStarts = await this.readCalendarStarts(wanted.map(([, request]) => request));

    // Plan every read; a calendar read with no zone is decided here and never
    // reaches a statement.
    const planned: Planned[] = [];
    wanted.forEach(([key, request], index) => {
      const { window } = request.node;
      let startMs: number;
      if (window.kind === "rolling") {
        startMs = rollingStartMs(request.endMs, window.minutes);
      } else {
        const start = calendarStarts.get(calendarKey(request.ownerAssetId, window.period, request.endMs));
        if (start === undefined || start === null) {
          out.set(key, { ok: false, reason: "timezone_unset" });
          return;
        }
        startMs = start;
      }
      // `delta` reads raw probes and `hours` reads nothing: neither plans a
      // segment, so neither adds a row to a level statement.
      const readsAggregates = request.node.kind === "window" && request.node.fn !== "delta";
      const segments = readsAggregates ? planWindowSegments({ startMs, endMs: request.endMs, watermarks }) : [];
      const defect = readsAggregates ? budgetDefect(segments, watermarks) : null;
      if (defect !== null) {
        out.set(key, { ok: false, reason: "windows_unresolved", detail: defect });
        return;
      }
      planned.push({ index, request, startMs, segments });
    });

    // `hours(window)` needs no row at all.
    const rows = new Map<number, SegmentRow[]>();
    for (const level of WINDOW_LEVELS) {
      await this.readLevel(level, planned, rows);
    }
    const deltas = await this.readDeltas(planned);

    for (const item of planned) {
      const key = wanted[item.index][0];
      const { node, endMs } = item.request;
      if (node.kind === "hours") {
        out.set(key, { ok: true, value: hoursOf(item.startMs, endMs) });
        continue;
      }
      let value: WindowValue;
      if (node.fn === "delta") {
        const probe = deltas.get(item.index) ?? { first: null, last: null };
        value = deltaOf(probe.first, probe.last);
      } else {
        value = combineSegments(node.fn, rows.get(item.index) ?? [], hoursOf(item.startMs, endMs));
      }
      out.set(key, value);
    }
    return out;
  }

  /** The four watermarks, read live — a manual refresh moves them, so
   * `0027`'s offsets are never assumed (plan ruling Q11). The internal
   * function is pinned by the integration suite's W9; the fallback if a
   * Timescale upgrade removes it is `now() - end_offset - schedule_interval`
   * from `timescaledb_information.jobs`, a cost-only degradation. */
  private async readWatermarks(): Promise<Watermarks> {
    const { rows } = await this.pool.query<{ view_name: string; watermark: Date }>(
      `SELECT c.view_name,
              _timescaledb_functions.to_timestamp(_timescaledb_functions.cagg_watermark(h.id)) AS watermark
         FROM timescaledb_information.continuous_aggregates c
         JOIN _timescaledb_catalog.hypertable h ON h.table_name = c.materialization_hypertable_name
        WHERE c.view_name = ANY($1::text[])`,
      [Object.values(VIEW_NAMES)],
    );
    const byView = new Map(rows.map((row) => [row.view_name, new Date(row.watermark).getTime()]));
    const marks: Partial<Record<AggregateLevel, number>> = {};
    for (const level of WINDOW_LEVELS) {
      const mark = byView.get(VIEW_NAMES[level]);
      if (mark === undefined || !Number.isFinite(mark)) {
        throw new Error(`calc windows: no watermark for ${VIEW_NAMES[level]}`);
      }
      marks[level] = mark;
    }
    return marks as Watermarks;
  }

  /** The start instant of each distinct `(owner, period, end)` in the owner's
   * location's zone, or `null` for no zone / an unknown zone; an owner that
   * does not exist is absent (the caller treats both as `timezone_unset`). */
  private async readCalendarStarts(requests: readonly WindowReadRequest[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    const distinct = new Map<string, { ownerAssetId: string; period: CalcCalendarWindow; endMs: number }>();
    for (const request of requests) {
      const { window } = request.node;
      if (window.kind === "calendar") {
        distinct.set(calendarKey(request.ownerAssetId, window.period, request.endMs), {
          ownerAssetId: request.ownerAssetId,
          period: window.period,
          endMs: request.endMs,
        });
      }
    }
    if (distinct.size === 0) {
      return out;
    }
    const wanted = [...distinct.values()];
    const result = await this.fleetDb.execute<{ asset_id: string; period: string; end_at: Date; start_at: Date | null }>(
      sql`WITH zones AS (SELECT name FROM pg_timezone_names)
          SELECT p.asset_id, p.period, p.end_at,
                 CASE WHEN z.name IS NULL THEN NULL
                      ELSE (date_trunc(p.period_unit, p.end_at AT TIME ZONE l.timezone) AT TIME ZONE l.timezone)
                 END AS start_at
            FROM unnest(
                   ${sql.param(wanted.map((w) => w.ownerAssetId))}::uuid[],
                   ${sql.param(wanted.map((w) => w.period))}::text[],
                   ${sql.param(wanted.map((w) => PERIOD_UNIT[w.period]))}::text[],
                   ${sql.param(wanted.map((w) => new Date(w.endMs).toISOString()))}::timestamptz[]
                 ) AS p(asset_id, period, period_unit, end_at)
            JOIN bms.assets a ON a.id = p.asset_id
            JOIN bms.locations l ON l.id = a.location_id
            LEFT JOIN zones z ON z.name = l.timezone`,
    );
    for (const row of result.rows) {
      const endMs = new Date(row.end_at).getTime();
      out.set(
        calendarKey(row.asset_id, row.period as CalcCalendarWindow, endMs),
        row.start_at === null ? null : new Date(row.start_at).getTime(),
      );
    }
    return out;
  }

  /** One statement for every segment at `level`, folded per segment. */
  private async readLevel(level: AggregateLevel, planned: readonly Planned[], rows: Map<number, SegmentRow[]>): Promise<void> {
    const targets: { index: number; segment: Segment; request: WindowReadRequest }[] = [];
    for (const item of planned) {
      for (const segment of item.segments) {
        if (segment.level === level) {
          targets.push({ index: item.index, segment, request: item.request });
        }
      }
    }
    if (targets.length === 0) {
      return;
    }
    const relation = aggregateRelation(level);
    if (relation === undefined) {
      throw new Error(`calc windows: no relation for level ${level}`);
    }
    const pointKeyOf = (request: WindowReadRequest): string =>
      request.node.kind === "window" ? request.node.ref.pointKey : "";
    // `Object.hasOwn`, not a bare index — the `aggregateRelation` guard: this
    // string is interpolated into SQL too.
    if (!Object.hasOwn(COVERAGE_UNIT_SQL, level)) {
      throw new Error(`calc windows: no coverage unit for level ${level}`);
    }
    const unit = COVERAGE_UNIT_SQL[level];
    // The last three columns are the segment's coverage facts (ADR 0070
    // Amendment 3 decision 3). count(DISTINCT unit), never count(*): two
    // buckets in one hour are one covered hour. Never sum(DISTINCT length)
    // either, which dedupes by value, not by hour. The sample_count > 0
    // filter is the test combineSegments applies; the views have no
    // gapfill, so a bucket row exists only where samples do and no case
    // can redden that filter.
    // Nor can a case redden the 1d unit alone. `'1 day'` → `'1 hour'` on the
    // 1d level is an equivalent mutant, but not because the flags are
    // unaffected: `v.bucket`, `from_t` and `to_t` are already day-aligned, so
    // covered_units and head_covered are unchanged, but tail_covered goes
    // from "the last day had a sample" to always false — `time_bucket('1
    // hour', to_t - 1ms)` lands on 23:00 of the last day, which a
    // midnight-aligned `v.bucket` never equals. `coveredHoursOf`'s interior
    // term makes up the difference: on an aligned 1d segment the tail chunk
    // is a full day, the same width as any interior day, so a day the
    // forced-false tail flag no longer credits is instead credited by
    // `interior = coveredUnits - head - tail` counting one more day — the
    // same 24 h lands in `wholeMs` either way. The same reasoning makes
    // forcing `head_covered` or `tail_covered` false equivalent on ANY
    // aligned 1d or 1h segment (a head or tail chunk equal to a whole unit).
    // Only S5a and S5b, which read a partial (unaligned) hour, actually gate
    // the flags. The 1h unit IS gated: the sparse suite's S6 reads three covered hours
    // from 1h alone, and '1 day' there collapses them into one or two days.
    const { rows: result } = await this.pool.query<{
      idx: number;
      sum_value: number | null;
      sample_count: string | number | null;
      min_value: number | null;
      max_value: number | null;
      covered_units: string | number | null;
      head_covered: boolean | null;
      tail_covered: boolean | null;
    }>(
      `SELECT p.idx, x.sum_value, x.sample_count, x.min_value, x.max_value,
              x.covered_units, x.head_covered, x.tail_covered
         FROM unnest($1::int[], $2::uuid[], $3::varchar[], $4::timestamptz[], $5::timestamptz[])
              AS p(idx, asset_id, point_key, from_t, to_t)
         CROSS JOIN LATERAL (
           SELECT sum(v.sum_value) AS sum_value,
                  sum(v.sample_count) AS sample_count,
                  min(v.min_value) AS min_value,
                  max(v.max_value) AS max_value,
                  count(DISTINCT time_bucket(${unit}, v.bucket)) FILTER (WHERE v.sample_count > 0) AS covered_units,
                  coalesce(bool_or(time_bucket(${unit}, v.bucket) = time_bucket(${unit}, p.from_t)) FILTER (WHERE v.sample_count > 0), false) AS head_covered,
                  coalesce(bool_or(time_bucket(${unit}, v.bucket) = time_bucket(${unit}, p.to_t - INTERVAL '1 millisecond')) FILTER (WHERE v.sample_count > 0), false) AS tail_covered
             FROM ${relation} v
            WHERE v.asset_id = p.asset_id
              AND v.point_key = p.point_key
              AND v.bucket >= p.from_t
              AND v.bucket < p.to_t
         ) x`,
      [
        targets.map((_, i) => i),
        targets.map((t) => t.request.readAssetId),
        targets.map((t) => pointKeyOf(t.request)),
        targets.map((t) => new Date(t.segment.fromMs).toISOString()),
        targets.map((t) => new Date(t.segment.toMs).toISOString()),
      ],
    );
    for (const row of result) {
      const target = targets[row.idx];
      const list = rows.get(target.index) ?? [];
      // `sample_count` is `numeric` in the view and `covered_units` a
      // `bigint` count; both arrive as strings. The facts stay raw here:
      // `combineSegments` folds them across the read's segments at once, so a
      // clock hour two segments share is merged (owner ruling 2026-09-23)
      list.push({
        segment: target.segment,
        coverage: {
          coveredUnits: Number(row.covered_units ?? 0),
          headCovered: row.head_covered === true,
          tailCovered: row.tail_covered === true,
        },
        sumValue: row.sum_value,
        sampleCount: row.sample_count === null ? 0 : Number(row.sample_count),
        minValue: row.min_value,
        maxValue: row.max_value,
      });
      rows.set(target.index, list);
    }
  }

  /** The two probes per `delta` read — first and last sample inside the
   * window, each an index lookup with `LIMIT 1`. */
  private async readDeltas(planned: readonly Planned[]): Promise<Map<number, { first: Sample | null; last: Sample | null }>> {
    const out = new Map<number, { first: Sample | null; last: Sample | null }>();
    const targets = planned.filter((item) => item.request.node.kind === "window" && item.request.node.fn === "delta");
    if (targets.length === 0) {
      return out;
    }
    const pointKeyOf = (item: Planned): string => (item.request.node.kind === "window" ? item.request.node.ref.pointKey : "");
    const { rows } = await this.pool.query<{
      idx: number;
      first_time: Date | null;
      first_value: number | null;
      last_time: Date | null;
      last_value: number | null;
    }>(
      `SELECT p.idx, f.time AS first_time, f.value AS first_value, l.time AS last_time, l.value AS last_value
         FROM unnest($1::int[], $2::uuid[], $3::varchar[], $4::timestamptz[], $5::timestamptz[])
              AS p(idx, asset_id, point_key, from_t, to_t)
         LEFT JOIN LATERAL (
           SELECT v.time, v.value
             FROM telemetry.point_values v
            WHERE v.asset_id = p.asset_id AND v.point_key = p.point_key
              AND v.time >= p.from_t AND v.time < p.to_t
            ORDER BY v.time ASC
            LIMIT 1
         ) f ON true
         LEFT JOIN LATERAL (
           SELECT v.time, v.value
             FROM telemetry.point_values v
            WHERE v.asset_id = p.asset_id AND v.point_key = p.point_key
              AND v.time >= p.from_t AND v.time < p.to_t
            ORDER BY v.time DESC
            LIMIT 1
         ) l ON true`,
      [
        targets.map((_, i) => i),
        targets.map((t) => t.request.readAssetId),
        targets.map(pointKeyOf),
        targets.map((t) => new Date(t.startMs).toISOString()),
        targets.map((t) => new Date(t.request.endMs).toISOString()),
      ],
    );
    for (const row of rows) {
      const target = targets[row.idx];
      out.set(target.index, {
        first: row.first_time === null || row.first_value === null ? null : { timeMs: new Date(row.first_time).getTime(), value: row.first_value },
        last: row.last_time === null || row.last_value === null ? null : { timeMs: new Date(row.last_time).getTime(), value: row.last_value },
      });
    }
    return out;
  }
}

function calendarKey(ownerAssetId: string, period: CalcCalendarWindow, endMs: number): string {
  return `${ownerAssetId}:${period}@${endMs}`;
}
