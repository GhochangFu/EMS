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

/**
 * `F4.334` / ADR 0116 decision 4 (plan R9) — the `/admin/rtus` `payloadFormat`
 * field: the code an MQTT row's config names, or `null` (no row, not MQTT, or
 * none named, which is the built-in envelope).
 */
export function connectionPayloadFormatOf(protocol: string | null, config: unknown): string | null {
  if (protocol !== "mqtt") {
    return null;
  }
  const code =
    typeof config === "object" && config !== null ? (config as { payloadFormat?: unknown }).payloadFormat : undefined;
  return typeof code === "string" ? code : null;
}
