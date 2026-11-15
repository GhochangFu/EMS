"""EVERY SQL statement apps/ml runs, as plain module-level literals (ADR 0135 decision 3).

The scorer connects as `bms_fleet`, which can do far more than the scorer
needs. Until the owed `bms_ml` role exists, this file is the contract:
`SELECT` on the inputs and `INSERT` into `ml.*`, nothing else.
`tests/test_sql_guard.py` parses every constant here and fails on anything
else, and on any `execute` in `gateway.py` whose statement is not one of them.

The time is always a bind parameter. No statement calls `now()`, so the clock
is injectable and the integration fixture can live in the future.

The real-data predicate in ELIGIBILITY_SQL is step 0's, character for
character after whitespace (`tests/e1.1-ml-readiness-single-source.test.ts`).
"""

PREFLIGHT_MARKER_SQL = """
SELECT obj_description(n.oid, 'pg_namespace') AS marker FROM pg_namespace n WHERE n.nspname = 'ml'
"""

PREFLIGHT_ROLE_SQL = """
SELECT current_user AS role_name, r.rolsuper AS is_superuser,
       has_table_privilege(current_user, 'ml.model_runs', 'INSERT') AS can_insert_runs,
       has_table_privilege(current_user, 'ml.forecasts', 'INSERT')  AS can_insert_forecasts,
       has_table_privilege(current_user, 'ml.forecasts', 'UPDATE')  AS can_update_forecasts
FROM pg_roles r WHERE r.rolname = current_user
"""

ELIGIBILITY_SQL = """
WITH real_points AS (
  SELECT a.organization_id, ap.asset_id, a.code AS asset_code, ap.point_key
  FROM bms.asset_points ap
  JOIN bms.assets a ON a.id = ap.asset_id
  JOIN bms.asset_templates t ON t.id = a.template_id
  LEFT JOIN bms.rtus r ON r.id = ap.rtu_id
  JOIN unnest(%(domains)s::text[], %(asset_types)s::text[], %(point_keys)s::text[])
         AS tg(domain, asset_type, point_key)
    ON tg.domain = a.domain AND tg.asset_type = t.asset_type AND tg.point_key = ap.point_key
  WHERE ap.active
    AND (a.meta->>'telemetrySource' = 'mqtt' OR (ap.source_kind = 'measured' AND r.ingest_enabled))
)
SELECT rp.organization_id, rp.asset_id, rp.asset_code, rp.point_key,
       min(h.bucket) AS first_bucket, max(h.bucket) AS last_bucket,
       count(h.bucket) AS hours_with_data,
       count(DISTINCT date_trunc('day', h.bucket, 'UTC')) AS days_with_data
FROM real_points rp
LEFT JOIN telemetry.point_values_1h h
  ON h.asset_id = rp.asset_id AND h.point_key = rp.point_key
 AND h.bucket >= %(lookback_from)s AND h.bucket < %(as_of_hour)s
GROUP BY rp.organization_id, rp.asset_id, rp.asset_code, rp.point_key
ORDER BY rp.organization_id, rp.asset_code, rp.point_key
"""

HISTORY_SQL = """
SELECT h.asset_id, h.point_key, h.bucket, h.sum_value, h.sample_count
FROM telemetry.point_values_1h h
JOIN unnest(%(asset_ids)s::uuid[], %(point_keys)s::text[]) AS p(asset_id, point_key)
  ON p.asset_id = h.asset_id AND p.point_key = h.point_key
WHERE h.bucket >= %(from_hour)s AND h.bucket < %(as_of_hour)s
ORDER BY h.asset_id, h.point_key, h.bucket
"""

ALREADY_SCORED_SQL = """
SELECT 1 FROM ml.model_runs
WHERE organization_id = %(organization_id)s AND model_name = %(model_name)s
  AND model_version = %(model_version)s AND config_hash = %(config_hash)s
  AND status = 'succeeded' AND started_at >= %(as_of_hour)s
LIMIT 1
"""

INSERT_MODEL_RUN_SQL = """
INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash,
                           started_at, finished_at, rows_written, status, error_text)
VALUES (%(id)s, %(organization_id)s, %(model_name)s, %(model_version)s, %(config_hash)s,
        %(started_at)s, %(finished_at)s, %(rows_written)s, %(status)s, %(error_text)s)
"""

# organization_id comes from bms.assets, never from Python (plan R5).
INSERT_FORECASTS_SQL = """
INSERT INTO ml.forecasts (organization_id, asset_id, point_key, horizon_bucket, issued_at,
                          p10, p50, p90, model_run_id)
SELECT a.organization_id, v.asset_id, v.point_key, v.horizon_bucket, %(issued_at)s,
       v.p10, v.p50, v.p90, %(model_run_id)s
FROM unnest(%(asset_ids)s::uuid[], %(point_keys)s::text[], %(horizon_buckets)s::timestamptz[],
            %(p10)s::float8[], %(p50)s::float8[], %(p90)s::float8[])
       AS v(asset_id, point_key, horizon_bucket, p10, p50, p90)
JOIN bms.assets a ON a.id = v.asset_id
"""
