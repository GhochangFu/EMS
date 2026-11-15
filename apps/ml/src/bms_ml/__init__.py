"""TRINETRA BMS batch scorer (ADR 0135).

A long-running process that wakes hourly, reads `telemetry.point_values_1h`
for real points only, forecasts the points that pass the readiness gate, and
inserts the results into the `ml` schema. It runs no DDL and exposes only
`GET /health` on loopback.
"""
