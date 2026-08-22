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
   * Health endpoint port.
   *
   * **The default is 9103 and not 9102 for a historical reason worth keeping.**
   * The ADR 0007 pilot entry point bound 9102 as `INGEST_METRICS_PORT`, and §6
   * commit 3 required both processes running at once — a shared variable would
   * have made the host fail to bind, or raced the legacy process for the port.
   * Commit 4 deleted that entry point and the variable with it, so the collision
   * is gone; the default stays 9103 so a side-by-side run of two hosts (a future
   * `F1.10`/`E7.2` concern) still needs only one variable set.
   *
   * The compose service sets this to 9102, which is the port it publishes.
   */
  readonly healthPort: number;
  /**
   * How often the point-lookup tables are refreshed. The ADR 0007 pilot used
   * 60 s and this preserves it.
   */
  readonly reloadMs: number;
  /**
   * How long one RTU may publish nothing before health calls it stale (`F1.7`).
   *
   * **Five minutes because the fleet was measured, not guessed.** The nine live
   * PHE RTUs publish every 50–75 s (probe, 2026-08-22), so five minutes is
   * four-to-six missed cycles — long enough that a single dropped message never
   * raises it, short enough that a station down overnight is not discovered the
   * next morning. A protocol that polls far slower than MQTT pushes will want
   * its own value, which is why this is configuration rather than a constant.
   */
  readonly staleAfterMs: number;
  /**
   * MQTT-only connection defaults taken from the environment.
   *
   * `MQTT_TLS_REJECT_UNAUTHORIZED` is honoured because the ADR 0007 pilot
   * honoured it and the PHE broker is why that escape hatch exists; dropping it
   * would mean a TLS failure against a pilot configured with it. Merged *under*
   * the stored JSONB, so a database value always wins.
   */
  readonly mqttConnectionDefaults: Readonly<Record<string, unknown>>;
};

/**
 * Annotated `number` rather than left as literal types.
 *
 * Without the annotation TypeScript infers `9103` and narrows any comparison
 * against it, so the spec's "must not default to the retired 9102 port"
 * assertion becomes a provable tautology that checks nothing at run time.
 * `tsc` caught exactly that — `TS2367: types '9103' and '9102' have no overlap`.
 */
export const DEFAULT_HEALTH_PORT: number = 9103;
export const DEFAULT_RELOAD_MS: number = 60_000;
export const DEFAULT_STALE_AFTER_MS: number = 300_000;

/**
 * The largest delay `setInterval` honours.
 *
 * Node clamps anything above a 32-bit signed integer to **1 ms** and prints a
 * `TimeoutOverflowWarning` — measured: a delay of `100000000000` fired twice in
 * 25 ms. For `INGEST_RELOAD_MS` that turns the four-table binding query into a
 * ~1 ms loop against the pilot Postgres the API also reads, so a typo meant to
 * slow the reload down speeds it up without bound.
 */
const MAX_TIMER_MS = 2 ** 31 - 1;

function positiveInt(
  raw: string | undefined,
  fallback: number,
  name: string,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  // Plain decimal digits only. `Number()` alone accepts `1e21` and `0x493e0`,
  // both of which are integers, so `INGEST_STALE_AFTER_MS=1e21` would start
  // cleanly and disable the staleness alarm for ever with no error and no log
  // line. A parser that fails open is worse the more the value matters, and
  // this one now gates a monitoring control rather than only a port.
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    // Loud, not silent: a typo'd port that quietly falls back to the default is
    // how two processes end up fighting over 9102.
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  // The digits check closed `1e21` and left the plain-decimal door open, which
  // is the same failure in different clothes: `INGEST_STALE_AFTER_MS` at 1e20
  // passes every test above, is not a safe integer, and switches the staleness
  // alarm off for ever in silence. Each caller states its own ceiling, because
  // "positive integer" is not the constraint — a port has 65535, a timer has
  // 2^31-1, and neither is a fact about integers.
  if (!Number.isSafeInteger(value) || value > max) {
    throw new Error(`${name} must be between 1 and ${max}, got "${raw}"`);
  }
  return value;
}

/** Pure over its input, so the parsing rules are testable without mutating `process.env`. */
export function readHostConfig(env: NodeJS.ProcessEnv): HostConfig {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL is required");
  }

  // `INGEST_NOTIFY` was deleted at ADR 0016 §6 commit 4 and is deliberately
  // **ignored** rather than refused. A stale `INGEST_NOTIFY=off` left in an
  // operator's `.env` now does nothing, which is the safe direction: realtime
  // stays on. Refusing to start on its presence would take the pilot down over a
  // variable that no longer has any effect.
  //
  // There is no `notifyEnabled` here on purpose. The host always notifies, so
  // there is no configuration that can run ingest with realtime silently off —
  // the failure mode commit 4 exists to remove.
  //
  // Two things carry that guarantee, and neither is in this file: the positive
  // `pg_notify` assertion in `normaliser.spec.ts`, which fails if any
  // suppression path returns, and the `tests/repo-invariants.test.ts` check that
  // nothing reads the variable. `config.spec.ts` only asserts the key is absent
  // from what this function returns — it cannot reach a write path, and saying
  // otherwise would credit it with a guarantee it does not carry.
  return {
    databaseUrl,
    healthPort: positiveInt(
      env.INGEST_HOST_HEALTH_PORT,
      DEFAULT_HEALTH_PORT,
      "INGEST_HOST_HEALTH_PORT",
      65535,
    ),
    reloadMs: positiveInt(
      env.INGEST_RELOAD_MS,
      DEFAULT_RELOAD_MS,
      "INGEST_RELOAD_MS",
      MAX_TIMER_MS,
    ),
    staleAfterMs: positiveInt(
      env.INGEST_STALE_AFTER_MS,
      DEFAULT_STALE_AFTER_MS,
      "INGEST_STALE_AFTER_MS",
      MAX_TIMER_MS,
    ),
    mqttConnectionDefaults: {
      // The ADR 0007 pilot tested `!== "false"`, so anything other than the exact
      // string "false" leaves verification on. Transcribed rather than
      // reinterpreted.
      rejectUnauthorized: env.MQTT_TLS_REJECT_UNAUTHORIZED !== "false",
    },
  };
}
