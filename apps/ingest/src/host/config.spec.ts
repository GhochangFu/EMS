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
  // ---- NOTIFY is off unless explicitly turned on --------------------------

  {
    // **The single most consequential default in this file.** During the §6
    // parallel-run window the legacy index.js is still notifying, and
    // telemetry-notify.service.ts fans every payload to Socket.IO — so a second
    // notifying process delivers every PHE reading to live dashboards twice.
    const config = readHostConfig({ ...BASE });
    assert(
      config.notifyEnabled === false,
      "NOTIFY must default to OFF — an unset flag must not double-deliver readings",
    );
  }

  assert(readHostConfig({ ...BASE, INGEST_NOTIFY: "on" }).notifyEnabled, '"on" enables NOTIFY');
  assert(!readHostConfig({ ...BASE, INGEST_NOTIFY: "off" }).notifyEnabled, '"off" disables NOTIFY');
  assert(readHostConfig({ ...BASE, INGEST_NOTIFY: " ON " }).notifyEnabled, "the flag is trimmed and case-insensitive");
  assert(!readHostConfig({ ...BASE, INGEST_NOTIFY: "" }).notifyEnabled, "an empty flag is off");

  // A typo must not silently pick a side. `INGEST_NOTIFY=true` reading as
  // "off" would look like a broken realtime feed; reading as "on" would double
  // the dashboards. Refusing to start is the only answer that cannot mislead.
  for (const bad of ["true", "1", "yes", "enabled"]) {
    expectThrow(
      () => readHostConfig({ ...BASE, INGEST_NOTIFY: bad }),
      `INGEST_NOTIFY="${bad}" must be rejected, not guessed at`,
    );
  }

  // ---- the health port is not the legacy metrics port ---------------------

  {
    /** `index.js:27` — `INGEST_METRICS_PORT ?? "9102"`. */
    const LEGACY_METRICS_PORT = 9102;
    const config = readHostConfig({ ...BASE });
    assert(
      config.healthPort !== LEGACY_METRICS_PORT,
      `the host must not default to index.js's ${LEGACY_METRICS_PORT} — §6 commit 3 runs ` +
        `both processes at once, so they cannot share a port. Got ${config.healthPort}.`,
    );
    assert(
      config.healthPort === DEFAULT_HEALTH_PORT,
      `the default health port should be ${DEFAULT_HEALTH_PORT}, got ${config.healthPort}`,
    );
  }

  {
    // Setting the legacy variable must have no effect here.
    const config = readHostConfig({ ...BASE, INGEST_METRICS_PORT: "9102" });
    assert(
      config.healthPort === DEFAULT_HEALTH_PORT,
      "INGEST_METRICS_PORT belongs to index.js and must not move the host's port",
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
  assert(DEFAULT_RELOAD_MS === 60_000, "index.js reloads every 60 s; the host matches it");
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
    // index.js:204 is `process.env.MQTT_TLS_REJECT_UNAUTHORIZED !== "false"`,
    // so *only* the exact string "false" turns verification off.
    assert(
      readHostConfig({ ...BASE }).mqttConnectionDefaults.rejectUnauthorized === true,
      "TLS verification defaults on",
    );
    assert(
      readHostConfig({ ...BASE, MQTT_TLS_REJECT_UNAUTHORIZED: "false" }).mqttConnectionDefaults
        .rejectUnauthorized === false,
      '"false" turns TLS verification off, matching index.js',
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
