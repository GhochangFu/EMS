import {
  DEFAULT_HEALTH_PORT,
  DEFAULT_RELOAD_MS,
  DEFAULT_STALE_AFTER_MS,
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
    // refused: refusing to start over a variable that can no longer do anything
    // would take the pilot down for nothing.
    //
    // The assertion is that these values **no longer throw**, which is the half
    // that actually changed — `"true"`, `"1"`, `"yes"` and `"enabled"` each
    // refused startup before commit 4, on the reasoning that a typo must not
    // silently pick a side. There is no side left to pick. Asserting key-absence
    // in a loop would not have worked: `readHostConfig` never reads the
    // variable, so the loop value cannot influence the outcome and every
    // iteration would assert the same thing as the block above.
    for (const stale of ["off", "on", "true", "1", "yes", "enabled", "garbage", ""]) {
      let threw = false;
      try {
        readHostConfig({ ...BASE, INGEST_NOTIFY: stale });
      } catch {
        threw = true;
      }
      assert(
        !threw,
        `INGEST_NOTIFY="${stale}" must be inert, not refused — a value left in an ` +
          `operator's .env can no longer change anything, and failing startup over ` +
          `it trades a real outage for a no-op`,
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

  // `1e21` and `0x493e0` are the ones `Number.isInteger` waves through. They
  // matter most for `INGEST_STALE_AFTER_MS`: a silently-accepted 1e21 ms window
  // means no RTU is ever stale and the alarm is off with nothing said.
  for (const bad of ["0", "-1", "abc", "80.5", "1e21", "0x493e0", "3e5", " 12 34"]) {
    expectThrow(
      () => readHostConfig({ ...BASE, INGEST_HOST_HEALTH_PORT: bad }),
      `port "${bad}" must be rejected — a typo that silently falls back to the ` +
        `default is how two processes end up fighting over one port`,
    );
    expectThrow(
      () => readHostConfig({ ...BASE, INGEST_RELOAD_MS: bad }),
      `reload interval "${bad}" must be rejected`,
    );
    expectThrow(
      () => readHostConfig({ ...BASE, INGEST_STALE_AFTER_MS: bad }),
      `staleness window "${bad}" must be rejected — a window that silently ` +
        `falls back to the default is a fleet reported healthy on the wrong rule`,
    );
  }

  // ---- and a magnitude the digit check waves through ----------------------

  // The `/^\d+$/` guard above closed `1e21` and left the plain-decimal door
  // open, which is the same failure in different clothes. Measured before
  // fixing: `100000000000000000000` passes the regex, passes `Number.isInteger`
  // and is > 0 — so the staleness alarm switched off for ever with no error and
  // no log line, which is exactly what the digit check was added to prevent.
  for (const huge of ["100000000000000000000", "99999999999999999999999"]) {
    expectThrow(
      () => readHostConfig({ ...BASE, INGEST_STALE_AFTER_MS: huge }),
      `staleness window "${huge}" is not a safe integer and must be rejected — ` +
        `an accepted one means no RTU is ever stale`,
    );
  }

  // `setInterval` clamps anything over 2^31-1 to **1 ms** and carries on with a
  // `TimeoutOverflowWarning`. Measured: a delay of 100000000000 fired twice in
  // 25 ms. So a typo meant to slow the reload down instead turns the four-table
  // binding query into a ~1 ms loop against the Postgres the API also reads.
  expectThrow(
    () => readHostConfig({ ...BASE, INGEST_RELOAD_MS: "100000000000" }),
    "a reload interval above 2^31-1 must be rejected — Node clamps it to 1 ms " +
      "and the binding query becomes a hot loop",
  );
  assert(
    readHostConfig({ ...BASE, INGEST_RELOAD_MS: String(2 ** 31 - 1) }).reloadMs === 2 ** 31 - 1,
    "the largest delay setInterval honours is still accepted — the bound is a ceiling, not a fence",
  );

  // A port is not a timer. 65535 is the constraint, and 65536 must not pass
  // merely because it is a small safe integer.
  expectThrow(
    () => readHostConfig({ ...BASE, INGEST_HOST_HEALTH_PORT: "65536" }),
    "a port above 65535 must be rejected",
  );
  assert(
    readHostConfig({ ...BASE, INGEST_HOST_HEALTH_PORT: "65535" }).healthPort === 65535,
    "the highest valid port is accepted",
  );

  assert(readHostConfig({ ...BASE }).reloadMs === DEFAULT_RELOAD_MS, "the reload default is 60 s");
  assert(DEFAULT_RELOAD_MS === 60_000, "the ADR 0007 pilot reloaded every 60 s; the host matches it");
  assert(
    readHostConfig({ ...BASE, INGEST_RELOAD_MS: "5000" }).reloadMs === 5_000,
    "the reload interval is overridable",
  );

  // ---- the staleness window (`F1.7`) ---------------------------------------

  assert(
    readHostConfig({ ...BASE }).staleAfterMs === DEFAULT_STALE_AFTER_MS,
    "the staleness default applies when the variable is unset",
  );
  // Measured, not chosen: the nine live PHE RTUs publish every ~60 s (probe,
  // 2026-08-22, 600 s window, 9–10 messages each — `docs/f1.7-fleet-probe.md`).
  //
  // **Stated as its own constant, not as a multiple of `DEFAULT_RELOAD_MS`.**
  // The reload interval is how often point mappings are refreshed; it happens
  // to be 60_000 too, and pinning to it made this assertion mean nothing it
  // said: widening the reload for an unrelated reason would go red citing
  // publish cycles, and a fleet that slowed to five-minute publishing would
  // stay green while the window became one missed cycle instead of five.
  const MEASURED_PUBLISH_INTERVAL_MS = 60_000;
  assert(
    DEFAULT_STALE_AFTER_MS >= 5 * MEASURED_PUBLISH_INTERVAL_MS,
    "the staleness window must clear five publish cycles, or one lost message reads as a dead RTU",
  );
  assert(
    readHostConfig({ ...BASE, INGEST_STALE_AFTER_MS: "900000" }).staleAfterMs === 900_000,
    "a slower protocol can widen the window",
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
