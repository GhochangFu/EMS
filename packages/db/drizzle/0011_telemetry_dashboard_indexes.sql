CREATE INDEX IF NOT EXISTS "point_values_point_asset_time_idx"
  ON "telemetry"."point_values" ("point_key", "asset_id", "time" DESC);
