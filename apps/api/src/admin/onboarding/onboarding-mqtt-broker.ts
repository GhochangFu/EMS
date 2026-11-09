/**
 * `F4.339` (ADR 0117 decision 7) — the MQTT broker an RTU config connects to,
 * and the same-broker rule. Its own leaf module: the credential copy and the
 * `_secrets` store (`onboarding-redaction.ts`) both read it.
 */

/** The broker an MQTT config connects to. `host` and `port` may be absent (the ingest host's env fallback). */
export type MqttBroker = { host: string | null; port: number | null; tls: boolean };

/** Reads the broker of an RTU config; `tls` absent reads as `true` (ADR 0114 decision 2). */
export function brokerOf(config: unknown): MqttBroker {
  const record = typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {};
  return {
    host: typeof record.host === "string" && record.host.trim() !== "" ? record.host.trim().toLowerCase() : null,
    port: typeof record.port === "number" ? record.port : null,
    tls: record.tls !== false,
  };
}

/** Same host (case-insensitive), port and TLS: a credential is the broker's, so a copy needs all three. */
export function sameBroker(a: MqttBroker, b: MqttBroker): boolean {
  return a.host === b.host && a.port === b.port && a.tls === b.tls;
}

/** True when `value` has the {@link MqttBroker} shape exactly (a stored binding read back from JSON). */
export function isMqttBroker(value: unknown): value is MqttBroker {
  if (typeof value !== "object" || value === null) return false;
  const { host, port, tls } = value as Record<string, unknown>;
  return (
    (host === null || typeof host === "string") &&
    (port === null || (typeof port === "number" && Number.isFinite(port))) &&
    typeof tls === "boolean" &&
    Object.keys(value).length === 3
  );
}
