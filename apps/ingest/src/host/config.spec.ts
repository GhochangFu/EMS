import {
  DEFAULT_HEALTH_PORT,
  DEFAULT_RELOAD_MS,
  readHostConfig,
} from "./config.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectThrow(fn: () => unknown, message: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

const BASE = { DATABASE_URL: "postgres://localhost/bms" };

/** Host environment parsing (ADR 0016 §6). */
export function runHostConfigTests(): void {
  // ---- there is no NOTIFY switch any more (ADR 0016 §6 commit 4) ----------

  {
    // Commit 4 deleted `INGEST_NOTIFY`, and this is the assertion that keeps it
    // deleted. The host always notifies, so no environment can run ingest with
    // realtime silently off — rows landing while every dashboard is dead, with no
    // error and no alarm, was the live failure mode the flag had become.
    //
    // Asserting the *absence* of the key is what makes this fail if the flag is
    // reinstated. A behavioural assertion cannot: `readHostConfig` has no way to
    // observe whether anything notifies.
    const config: Record<string, unknown> = { ...readHostConfig({ ...BASE }) };
    assert(
      !("notifyEnabled" in config),
      "HostConfig must carry no notify switch — commit 4 removed the only way to " +
        "run ingest with realtime silently off, and a reinstated flag restores it",
    );
  }

  {
    // A stale `INGEST_NOTIFY` in an operator's `.env` is **ignored**, not
    // refused. The variable had two legal values and both are now meaningless;
    // refusing to start on its presence would take the pilot down over a
    // no-op. `off` is the one that matters — it must not be honoured.
    for (const stale of ["off", "on", "true", "garbage", ""]) {
      const config: Record<string, unknown> = {
        ...readHostConfig({ ...BASE, INGEST_NOTIFY: stale }),
      };
      assert(
        !("notifyEnabled" in config),
        `INGEST_NOTIFY="${stale}" must be inert — it may neither reintroduce the ` +
          `switch nor suppress notification`,
      );
    }
  }

  // ---- the health port default survives the entry point that caused it ----

  {
    // The ADR 0007 pilot bound 9102 as `INGEST_METRICS_PORT`, and §6 commit 3
    // needed both processes up at once, so the host could not share it. Commit 4
    // deleted that entry point and the variable with it. The default stays 9103
    // rather than being "tidied" to 9102, so two hosts side by side still need
    // only one variable set.
    const RETIRED_METRICS_PORT = 9102;
    const config = readHostConfig({ ...BASE });
    assert(
      config.healthPort !== RETIRED_METRICS_PORT,
      `the host must not default to the retired ${RETIRED_METRICS_PORT}. Got ${config.healthPort}.`,
    );
    assert(
      config.healthPort === DEFAULT_HEALTH_PORT,
      `the default health port should be ${DEFAULT_HEALTH_PORT}, got ${config.healthPort}`,
    );
  }

  {
    // `INGEST_METRICS_PORT` no longer exists anywhere. A copy left in an old
    // `.env` must not move the host's port.
    const config = readHostConfig({ ...BASE, INGEST_METRICS_PORT: "9102" });
    assert(
      config.healthPort === DEFAULT_HEALTH_PORT,
      "the retired INGEST_METRICS_PORT must not move the host's port",
    );
  }

  assert(
    readHostConfig({ ...BASE, INGEST_HOST_HEALTH_PORT: "9999" }).healthPort === 9999,
    "the health port is overridable",
  );

  // ---- numeric parsing is strict ------------------------------------------

  for (const bad of ["0", "-1", "abc", "80.5"]) {
    expectThrow(
      () => readHostConfig({ ...BASE, INGEST_HOST_HEALTH_PORT: bad }),
      `port "${bad}" must be rejected — a typo that silently falls back to the ` +
        `default is how two processes end up fighting over one port`,
    );
    expectThrow(
      () => readHostConfig({ ...BASE, INGEST_RELOAD_MS: bad }),
      `reload interval "${bad}" must be rejected`,
    );
  }

  assert(readHostConfig({ ...BASE }).reloadMs === DEFAULT_RELOAD_MS, "the reload default is 60 s");
  assert(DEFAULT_RELOAD_MS === 60_000, "the ADR 0007 pilot reloaded every 60 s; the host matches it");
  assert(
    readHostConfig({ ...BASE, INGEST_RELOAD_MS: "5000" }).reloadMs === 5_000,
    "the reload interval is overridable",
  );

  // ---- DATABASE_URL is required -------------------------------------------

  expectThrow(() => readHostConfig({}), "a missing DATABASE_URL must fail at startup");
  expectThrow(
    () => readHostConfig({ DATABASE_URL: "   " }),
    "a blank DATABASE_URL must fail too — it would otherwise reach pg as an empty string",
  );

  // ---- the MQTT TLS escape hatch is transcribed, not reinterpreted --------

  {
    // The ADR 0007 pilot tested `MQTT_TLS_REJECT_UNAUTHORIZED !== "false"`, so
    // *only* the exact string "false" turns verification off.
    assert(
      readHostConfig({ ...BASE }).mqttConnectionDefaults.rejectUnauthorized === true,
      "TLS verification defaults on",
    );
    assert(
      readHostConfig({ ...BASE, MQTT_TLS_REJECT_UNAUTHORIZED: "false" }).mqttConnectionDefaults
        .rejectUnauthorized === false,
      '"false" turns TLS verification off, matching the ADR 0007 pilot',
    );
    for (const value of ["FALSE", "0", "no", "", "true"]) {
      assert(
        readHostConfig({ ...BASE, MQTT_TLS_REJECT_UNAUTHORIZED: value }).mqttConnectionDefaults
          .rejectUnauthorized === true,
        `"${value}" must leave TLS verification ON — only the exact string "false" disables it`,
      );
    }
  }
}
