/**
 * Host configuration, read from the environment (ADR 0016 §6).
 *
 * Kept in its own tested module rather than inline in `main.ts` for one
 * reason: `main.ts` is the piece with no test around it, so every branch that
 * lives there is a branch nothing checks. Parsing is branches.
 *
 * **`process.env` is read here and nowhere else in the host** — adapters may
 * never read it at all (§4), and the MQTT compatibility path reaches them as
 * ordinary `config` and `credentials` values.
 */

export type HostConfig = {
  readonly databaseUrl: string;
  /**
   * Whether the host emits `pg_notify('bms_telemetry', …)`.
   *
   * **Off unless `INGEST_NOTIFY` is exactly `on`.** During the §6 parallel-run
   * window the legacy `index.js` is still notifying and
   * `telemetry-notify.service.ts` fans every payload to Socket.IO, so two
   * notifying processes deliver every PHE reading to live dashboards twice.
   * Writes are idempotent under `ON CONFLICT DO UPDATE`; notifications are not.
   *
   * Defaulting *on* would mean a stray `pnpm start:host` doubles every reading
   * on the operator's screen, which is why the default is the safe direction
   * and the flag has to be set deliberately to turn realtime on.
   *
   * ADR 0016 §6 deletes this flag in commit 4 — it must not survive as a
   * permanent way to run ingest with realtime silently off.
   */
  readonly notifyEnabled: boolean;
  /**
   * Health endpoint port.
   *
   * **Deliberately not `INGEST_METRICS_PORT`.** `index.js:27` binds that one
   * (default 9102), and §6 commit 3 requires both processes running at once —
   * sharing the variable would make the new host fail to bind, or worse, race
   * the legacy one for the port.
   */
  readonly healthPort: number;
  /** How often the point-lookup tables are refreshed. `index.js` uses 60 s. */
  readonly reloadMs: number;
  /**
   * MQTT-only connection defaults taken from the environment.
   *
   * `index.js` honours `MQTT_TLS_REJECT_UNAUTHORIZED`; dropping it would mean a
   * TLS failure the moment the host runs against a pilot configured with it.
   * Merged *under* the stored JSONB, so a database value always wins.
   */
  readonly mqttConnectionDefaults: Readonly<Record<string, unknown>>;
};

/**
 * Annotated `number` rather than left as literal types.
 *
 * Without the annotation TypeScript infers `9103` and narrows any comparison
 * against it, so the spec's "must not collide with the legacy 9102 port"
 * assertion becomes a provable tautology that checks nothing at run time.
 * `tsc` caught exactly that — `TS2367: types '9103' and '9102' have no overlap`.
 */
export const DEFAULT_HEALTH_PORT: number = 9103;
export const DEFAULT_RELOAD_MS: number = 60_000;

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    // Loud, not silent: a typo'd port that quietly falls back to the default is
    // how two processes end up fighting over 9102.
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

/** Pure over its input, so the parsing rules are testable without mutating `process.env`. */
export function readHostConfig(env: NodeJS.ProcessEnv): HostConfig {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL is required");
  }

  const notifyRaw = env.INGEST_NOTIFY?.trim().toLowerCase();
  if (notifyRaw !== undefined && notifyRaw !== "" && notifyRaw !== "on" && notifyRaw !== "off") {
    throw new Error(`INGEST_NOTIFY must be "on" or "off", got "${env.INGEST_NOTIFY ?? ""}"`);
  }

  return {
    databaseUrl,
    notifyEnabled: notifyRaw === "on",
    healthPort: positiveInt(env.INGEST_HOST_HEALTH_PORT, DEFAULT_HEALTH_PORT, "INGEST_HOST_HEALTH_PORT"),
    reloadMs: positiveInt(env.INGEST_RELOAD_MS, DEFAULT_RELOAD_MS, "INGEST_RELOAD_MS"),
    mqttConnectionDefaults: {
      // `index.js:204` — `!== "false"`, so anything other than the exact string
      // "false" leaves verification on. Transcribed rather than reinterpreted.
      rejectUnauthorized: env.MQTT_TLS_REJECT_UNAUTHORIZED !== "false",
    },
  };
}
