import pg from "pg";

import { type ReadinessRow, renderReport } from "./ml-data-readiness";

/**
 * `pnpm --filter @bms/db ml:readiness` — read-only. Reports, per asset class,
 * how much real (field) and simulated history `telemetry.point_values_1h`
 * holds, and whether that is enough for forecasting, anomaly detection,
 * battery health and RUL (ADR 0135 decision 8).
 *
 * Connects as `DATABASE_URL_FLEET` (`bms_fleet`, BYPASSRLS) because the report
 * spans every organization; falls back to `DATABASE_URL`, which under RLS sees
 * only what that role is bound to. Pass `--json` for machine-readable output.
 *
 * It writes nothing: the only statement is one SELECT inside a READ ONLY
 * transaction.
 */
export const READINESS_SQL = `
WITH point_source AS (
  -- apps/sim skips assets whose meta.telemetrySource is 'mqtt', so those rows
  -- can only have come from ingest; a measured point on an ingest-enabled RTU
  -- is real too.
  SELECT ap.asset_id, ap.point_key,
         CASE WHEN a.meta->>'telemetrySource' = 'mqtt'
                OR (ap.source_kind = 'measured' AND r.ingest_enabled)
              THEN 'real' ELSE 'simulated' END AS source
  FROM bms.asset_points ap
  JOIN bms.assets a ON a.id = ap.asset_id
  LEFT JOIN bms.rtus r ON r.id = ap.rtu_id
  WHERE ap.active
),
per_point AS (
  SELECT h.asset_id, h.point_key,
         coalesce(ps.source, 'simulated') AS source,
         min(h.bucket) AS first_bucket,
         max(h.bucket) AS last_bucket,
         count(*) AS hours_with_data,
         count(DISTINCT date_trunc('day', h.bucket)) AS days_with_data
  FROM telemetry.point_values_1h h
  LEFT JOIN point_source ps ON ps.asset_id = h.asset_id AND ps.point_key = h.point_key
  GROUP BY 1, 2, 3
),
classed AS (
  SELECT p.*, a.domain,
         coalesce(t.asset_type, '(no template)') AS asset_type,
         p.hours_with_data::float
           / greatest(1, extract(epoch FROM (p.last_bucket - p.first_bucket)) / 3600 + 1) AS coverage
  FROM per_point p
  JOIN bms.assets a ON a.id = p.asset_id
  LEFT JOIN bms.asset_templates t ON t.id = a.template_id
),
wo AS (
  SELECT asset_id, count(*) AS closed
  FROM bms.work_orders
  WHERE closed_at IS NOT NULL
  GROUP BY 1
)
SELECT c.domain, c.asset_type, c.source,
       count(DISTINCT c.asset_id)::int AS assets,
       count(*)::int AS points,
       max(c.days_with_data)::int AS days_with_data,
       avg(least(c.coverage, 1))::float AS mean_coverage,
       to_char(min(c.first_bucket) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS first_bucket,
       to_char(max(c.last_bucket) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS last_bucket,
       array_agg(DISTINCT c.point_key ORDER BY c.point_key) AS point_keys,
       coalesce((SELECT sum(w.closed) FROM wo w
                 WHERE w.asset_id IN (SELECT DISTINCT c2.asset_id FROM classed c2
                                      WHERE c2.domain = c.domain AND c2.asset_type = c.asset_type
                                        AND c2.source = c.source)), 0)::int AS closed_work_orders
FROM classed c
GROUP BY c.domain, c.asset_type, c.source
ORDER BY c.source, c.domain, c.asset_type
`;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_FLEET ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_FLEET or DATABASE_URL is required");
  if (!process.env.DATABASE_URL_FLEET) {
    process.stderr.write(
      "warning: DATABASE_URL_FLEET not set; using DATABASE_URL, which row-level security may limit to one organization\n",
    );
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const res = await client.query(READINESS_SQL);
    await client.query("COMMIT");
    const rows: ReadinessRow[] = res.rows.map((r) => ({
      domain: r.domain,
      assetType: r.asset_type,
      source: r.source,
      assets: r.assets,
      points: r.points,
      daysWithData: r.days_with_data,
      meanHourlyCoverage: r.mean_coverage ?? 0,
      firstBucket: r.first_bucket,
      lastBucket: r.last_bucket,
      pointKeys: r.point_keys ?? [],
      closedWorkOrders: r.closed_work_orders,
    }));
    if (process.argv.includes("--json")) {
      process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    } else {
      process.stdout.write(renderReport(rows, new Date().toISOString()));
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
