/**
 * `F4.326` / ADR 0114 R4 — the `/admin/rtus` `tls` field, from the RTU's
 * `rtu_connection_configs` row (LEFT JOIN, so both arguments may be `null`).
 *
 * `null` when there is no row or the row is not MQTT; otherwise `false` only for
 * the literal `config.tls === false` — the one value ingest connects plain — and
 * `true` for anything else, matching `mqttConfigSchema`'s default.
 */
export function connectionTlsOf(protocol: string | null, config: unknown): boolean | null {
  if (protocol !== "mqtt") {
    return null;
  }
  const tls = typeof config === "object" && config !== null ? (config as { tls?: unknown }).tls : undefined;
  return tls !== false;
}
