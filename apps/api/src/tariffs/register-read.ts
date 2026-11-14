import type { RegisterDelta } from "@bms/shared";
import type { Pool } from "pg";

/**
 * `F4.365` (ADR 0134 decision 4, plan D9) — the first and last raw register
 * sample of a point inside `[from, to)`, for any number of requests in one
 * statement. The shape of `CalcWindowsService.readDeltas`: two `LIMIT 1`
 * laterals over `telemetry.point_values`, so the read is two index probes per
 * request whatever the month's sample count.
 */
export interface Sample {
  timeMs: number;
  value: number;
}

export interface RegisterRequest {
  assetId: string;
  pointKey: "kwh_total" | "kvah_total";
  from: Date;
  to: Date;
}

export async function readRegisterProbes(
  pool: Pick<Pool, "query">,
  requests: readonly RegisterRequest[],
): Promise<{ first: Sample | null; last: Sample | null }[]> {
  if (requests.length === 0) return [];
  const { rows } = await pool.query<{
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
      requests.map((_, i) => i),
      requests.map((r) => r.assetId),
      requests.map((r) => r.pointKey),
      requests.map((r) => r.from.toISOString()),
      requests.map((r) => r.to.toISOString()),
    ],
  );
  const out: { first: Sample | null; last: Sample | null }[] = requests.map(() => ({ first: null, last: null }));
  for (const row of rows) {
    out[row.idx] = {
      first: row.first_time === null || row.first_value === null ? null : { timeMs: new Date(row.first_time).getTime(), value: Number(row.first_value) },
      last: row.last_time === null || row.last_value === null ? null : { timeMs: new Date(row.last_time).getTime(), value: Number(row.last_value) },
    };
  }
  return out;
}

/** Last minus first; fewer than two distinct samples is `empty`, a fall is `decreasing`. */
export function deltaOfProbe(probe: { first: Sample | null; last: Sample | null }): RegisterDelta {
  const { first, last } = probe;
  if (first === null || last === null || first.timeMs === last.timeMs) return { ok: false, reason: "empty" };
  const value = last.value - first.value;
  if (!Number.isFinite(value) || value < 0) return { ok: false, reason: "decreasing" };
  return { ok: true, value };
}
