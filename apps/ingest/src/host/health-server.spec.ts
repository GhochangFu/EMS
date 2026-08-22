import { renderHealth, type HealthSnapshot } from "./health-server.js";
import type { DeviceHealth, SupervisorHealth } from "./supervisor.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const STARTED_AT = new Date("2026-08-05T12:00:00.000Z");
const NOW = new Date("2026-08-05T12:05:30.000Z");
/** 30 s before `NOW` — inside any sane staleness window. */
const FRESH = new Date("2026-08-05T12:05:00.000Z");

/** Five minutes, matching `DEFAULT_STALE_AFTER_MS`. */
const STALE_AFTER_MS = 300_000;

function device(rtuCode: string, overrides: Partial<DeviceHealth> = {}): DeviceHealth {
  return { rtuCode, deviceKey: rtuCode, lastSampleAt: FRESH, ...overrides };
}

function endpoint(overrides: Partial<SupervisorHealth> = {}): SupervisorHealth {
  return {
    protocol: "mqtt",
    endpointKey: "phe.thinkiot.co.in:8883",
    state: "connected",
    devices: [device("RTU-1"), device("RTU-2")],
    restarts: 0,
    consecutivePollFailures: 0,
    queueDepth: 0,
    droppedSamples: 0,
    writeFailures: 0,
    samplesWritten: 42,
    lastSampleAt: FRESH,
    ...overrides,
  };
}

function snapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    endpoints: [endpoint()],
    skipped: [],
    startedAt: STARTED_AT,
    staleAfterMs: STALE_AFTER_MS,
    ...overrides,
  };
}

/** The plain-text health body (ADR 0016 §Dependencies). */
export function runHealthRenderTests(): void {
  // ---- the summary line ----------------------------------------------------

  {
    const body = renderHealth(snapshot(), NOW);
    assert(body.startsWith("ingest-host ok "), `a healthy host reports ok:\n${body}`);
    assert(body.includes("endpoints=1"), "the endpoint count is reported");
    assert(body.includes("rtus=2"), "the RTU count sums each endpoint's devices");
    assert(body.includes("uptime=330s"), `uptime is derived from startedAt:\n${body}`);
    assert(body.endsWith("\n"), "the body ends with a newline, as the ADR 0007 pilot's did");
  }

  {
    // `notify=on` is now a literal, not a rendering of configuration — ADR 0016
    // §6 commit 4 deleted the switch, so the only honest value is `on`.
    //
    // Kept asserted rather than dropped with the field for two reasons: the token
    // is what `docs/ingest-host.md` tells operators to read, and printing
    // `notify=off` from a host that always notifies would be a lie no other test
    // would catch.
    const body = renderHealth(snapshot(), NOW);
    assert(body.includes("notify=on"), `the health body must report notify=on:\n${body}`);
    assert(
      !body.includes("notify=off"),
      "no snapshot may render notify=off — the host cannot run with realtime off",
    );
  }

  // ---- one bad endpoint degrades the summary without hiding the others ----

  {
    const body = renderHealth(
      snapshot({
        endpoints: [
          endpoint(),
          endpoint({
            protocol: "modbus_tcp",
            endpointKey: "10.0.0.5:502",
            state: "degraded",
            devices: [device("RTU-9")],
            consecutivePollFailures: 3,
            restarts: 2,
          }),
        ],
      }),
      NOW,
    );
    assert(body.startsWith("ingest-host degraded "), "any unhealthy endpoint degrades the summary");
    // "A failing adapter's blast radius is exactly one endpoint" — the health
    // body has to show that, or an operator cannot tell a single broken Modbus
    // gateway from a dead host.
    assert(
      body.includes("key=phe.thinkiot.co.in:8883 state=connected"),
      `the healthy endpoint must still report connected:\n${body}`,
    );
    assert(body.includes("key=10.0.0.5:502 state=degraded"), "the broken endpoint is named");
    assert(body.includes("pollFailures=3"), "the failure run is visible");
    assert(body.includes("restarts=2"), "restarts are visible");
    assert(body.includes("rtus=RTU-9"), "the RTUs sharing the failing connection are enumerated");
  }

  // ---- loss is reported, not hidden ---------------------------------------

  {
    const body = renderHealth(
      snapshot({
        endpoints: [endpoint({ queueDepth: 9_998, droppedSamples: 1_204, writeFailures: 7 })],
      }),
      NOW,
    );
    assert(body.includes("dropped=1204"), "dropped samples must be visible — silent loss is the bug");
    assert(body.includes("queue=9998"), "queue depth is visible");
    assert(body.includes("writeFailures=7"), "write failures are visible");
  }

  {
    const body = renderHealth(
      snapshot({
        skipped: [
          { rtuId: "u1", rtuCode: "RTU-7", reason: "no-adapter", detail: "snmp" },
          { rtuId: "u2", rtuCode: null, reason: "missing-rtu-code" },
        ],
      }),
      NOW,
    );
    assert(body.includes("skipped=2"), "the skip count is in the summary");
    assert(body.includes("rtu=RTU-7 reason=no-adapter detail=snmp"), "each skip is named");
    assert(
      body.includes("rtu=(no rtu_code) reason=missing-rtu-code"),
      "an RTU with no code still renders legibly rather than as `null`",
    );
  }

  // ---- an endpoint that has never produced a sample -----------------------

  {
    const body = renderHealth(
      snapshot({ endpoints: [endpoint({ lastSampleAt: undefined, samplesWritten: 0 })] }),
      NOW,
    );
    assert(
      body.includes("lastSample=never"),
      "an endpoint that has produced nothing must say so, not print `undefined`",
    );
  }

  // ---- an empty host is legible -------------------------------------------

  {
    const body = renderHealth(snapshot({ endpoints: [] }), NOW);
    assert(body.includes("endpoints=0") && body.includes("rtus=0"), "an empty plan renders cleanly");
    // No endpoints is not "degraded" — it is a correctly-read empty database.
    assert(body.startsWith("ingest-host ok "), "no endpoints is not itself a fault");
  }

  // ---- a clock skew must not produce a negative uptime --------------------

  {
    const body = renderHealth(snapshot(), new Date(STARTED_AT.getTime() - 60_000));
    assert(body.includes("uptime=0s"), "uptime is clamped at zero");
  }

}

/**
 * Per-device staleness (`F1.7`).
 *
 * **The defect this closes is invisible at one RTU and unavoidable at nine.**
 * `endpointKey` is `${host}:${port}` (`mqtt.ts`), so every PHE RTU shares one
 * connection, one supervisor and — before this — one `lastSampleAt` set
 * unkeyed on any sample from any device. Eight RTUs could stop publishing while
 * the ninth kept the endpoint's timestamp fresh, and the body still read `ok`.
 *
 * Measured on the live broker on 2026-08-22: nine of twelve PHE RTUs publish,
 * every 50–75 s. Three are silent. Nothing in the health body said so.
 */
export function runDeviceStalenessTests(): void {
  // ---- staleness is per device, not per endpoint --------------------------

  {
    // The failure the whole item exists for: one live device, one silent one,
    // on a connection that is genuinely connected.
    const body = renderHealth(
      snapshot({
        endpoints: [
          endpoint({
            devices: [
              device("861736076104923"),
              device("861736076133666", {
                lastSampleAt: new Date(NOW.getTime() - STALE_AFTER_MS - 1),
              }),
            ],
          }),
        ],
      }),
      NOW,
    );
    assert(
      body.includes("stale=1"),
      `a silent device must be counted in the summary:\n${body}`,
    );
    assert(
      body.includes("stale rtu=861736076133666"),
      `the silent device must be named, not merely counted:\n${body}`,
    );
    assert(
      !body.includes("stale rtu=861736076104923"),
      `the device that is still publishing must not be reported stale:\n${body}`,
    );
  }

  // ---- the connection stays `connected`; silence is not a connection fault -

  {
    const body = renderHealth(
      snapshot({
        endpoints: [
          endpoint({
            devices: [device("RTU-1", { lastSampleAt: new Date(NOW.getTime() - 900_000) })],
          }),
        ],
      }),
      NOW,
    );
    // A broker we are connected to, serving a device that stopped publishing,
    // is not a disconnected endpoint. Overloading `state` would make an
    // operator restart a healthy connection to fix a dead RTU.
    assert(
      body.includes("state=connected"),
      `a stale device must not rewrite the endpoint state:\n${body}`,
    );
    // But the host as a whole is not `ok` while a mapped RTU is silent —
    // reporting `ok` is what let three silent PHE RTUs go unnoticed.
    assert(
      body.startsWith("ingest-host degraded "),
      `a stale device degrades the summary:\n${body}`,
    );
  }

  // ---- exactly at the threshold is not yet stale --------------------------

  {
    const body = renderHealth(
      snapshot({
        endpoints: [
          endpoint({
            devices: [device("RTU-1", { lastSampleAt: new Date(NOW.getTime() - STALE_AFTER_MS) })],
          }),
        ],
      }),
      NOW,
    );
    // Strictly greater, so a device publishing exactly on the boundary does not
    // flap between stale and fresh on every scrape.
    assert(body.includes("stale=0"), `the boundary is not stale:\n${body}`);
    assert(body.startsWith("ingest-host ok "), `the boundary does not degrade:\n${body}`);
  }

  // ---- a device that has never published ----------------------------------

  {
    const body = renderHealth(
      snapshot({
        endpoints: [endpoint({ devices: [device("RTU-1", { lastSampleAt: undefined })] })],
      }),
      NOW,
    );
    // `ingest_enabled` on an RTU that has never once published is the mistake
    // this endpoint has to make visible — it is a mapping error, not a silence.
    assert(body.includes("stale=1"), `never having published counts as stale:\n${body}`);
    assert(
      body.includes("stale rtu=RTU-1 endpoint=phe.thinkiot.co.in:8883 lastSample=never"),
      `a device with no sample renders \`never\`, not \`undefined\`:\n${body}`,
    );
    // Asserted as an ending, because `includes` above passes with a trailing
    // `silentFor=` appended — and there is no duration to report when there
    // has never been a sample to measure from.
    assert(
      body.includes("lastSample=never\n"),
      `silentFor must be omitted when nothing has ever arrived:\n${body}`,
    );
  }

  // ---- but not before the host has been up long enough to hear it ---------

  {
    // The regression this guards: with silence measured from the epoch, a host
    // that has just started reports every enabled RTU stale until each one
    // publishes — nine false alarms, on every restart, for a whole 60 s cycle.
    // An alarm that fires on every deploy is one an operator stops reading.
    const justStarted = new Date(STARTED_AT.getTime() + STALE_AFTER_MS - 1_000);
    const body = renderHealth(
      snapshot({
        endpoints: [endpoint({ devices: [device("RTU-1", { lastSampleAt: undefined })] })],
      }),
      justStarted,
    );
    assert(
      body.includes("stale=0"),
      `an RTU cannot be stale before the window has elapsed since startup:\n${body}`,
    );
    assert(body.startsWith("ingest-host ok "), `a cold start is not degraded:\n${body}`);
  }

  // ---- a sample older than the host's own start still counts from startup --

  {
    // A restart does not make yesterday's sample fresh, but nor does it make a
    // device stale that simply has not had a chance to publish yet.
    const body = renderHealth(
      snapshot({
        endpoints: [
          endpoint({
            devices: [
              device("RTU-1", { lastSampleAt: new Date(STARTED_AT.getTime() - 86_400_000) }),
            ],
          }),
        ],
      }),
      new Date(STARTED_AT.getTime() + 1_000),
    );
    assert(
      body.includes("stale=0"),
      `one second after startup nothing is stale, whatever its last sample:\n${body}`,
    );
  }

  // ---- silence is reported as a duration an operator can act on -----------

  {
    // 12:00:15 — after `STARTED_AT`, so the duration is measured from the
    // sample itself, and 315 s before `NOW`, so it is past the 300 s window.
    const body = renderHealth(
      snapshot({
        endpoints: [
          endpoint({
            devices: [
              device("RTU-1", { lastSampleAt: new Date("2026-08-05T12:00:15.000Z") }),
            ],
          }),
        ],
      }),
      NOW,
    );
    assert(
      body.includes("silentFor=315s"),
      `how long a device has been silent is what says whether to go and look:\n${body}`,
    );
  }

  // ---- the duration never contradicts the verdict beside it ---------------

  {
    // A sample older than the host's own start: the stale decision floors on
    // `startedAt`, so the duration must too. Reporting `silentFor=86400s` next
    // to a host that has been up 330 s would say the RTU was watched and silent
    // all day, when in truth nothing was watching.
    const body = renderHealth(
      snapshot({
        endpoints: [
          endpoint({
            devices: [device("RTU-1", { lastSampleAt: new Date(STARTED_AT.getTime() - 86_400_000) })],
          }),
        ],
      }),
      NOW,
    );
    assert(
      body.includes("silentFor=330s"),
      `silence is measured from startup when the last sample predates it:\n${body}`,
    );
  }

  // ---- the count spans endpoints ------------------------------------------

  {
    const body = renderHealth(
      snapshot({
        endpoints: [
          endpoint({ devices: [device("RTU-1", { lastSampleAt: undefined })] }),
          endpoint({
            protocol: "modbus_tcp",
            endpointKey: "10.0.0.5:502",
            devices: [device("RTU-9", { lastSampleAt: undefined })],
          }),
        ],
      }),
      NOW,
    );
    assert(body.includes("stale=2"), `the summary counts stale devices host-wide:\n${body}`);
    assert(
      body.includes("stale rtu=RTU-9 endpoint=10.0.0.5:502"),
      `a stale device names the endpoint it sits on:\n${body}`,
    );
  }

  // ---- the RTU count still sums devices -----------------------------------

  {
    const body = renderHealth(snapshot(), NOW);
    assert(
      body.includes("rtus=2") && body.includes("rtus=RTU-1|RTU-2"),
      `the existing counts and enumeration survive the richer device shape:\n${body}`,
    );
  }

  // ---- nothing reaches the body that was not deliberately rendered --------

  {
    // `renderHealth`'s own doc comment claimed "the assertion that no credential
    // can appear in it" and no such assertion existed — found by the F1.7
    // security review. There is no reachable secret in `HealthSnapshot` today,
    // so this is a regression guard, not a leak fix: the next field added to
    // `SupervisorHealth` will not get that review, and this body is served
    // unauthenticated.
    const SENTINEL = "SENTINEL-MUST-NOT-APPEAR";
    const body = renderHealth(
      snapshot({
        endpoints: [
          {
            ...endpoint({ devices: [device("RTU-1", { deviceKey: SENTINEL })] }),
            // Every free-form string a supervisor could carry, poisoned.
            detail: SENTINEL,
          },
        ],
        skipped: [{ rtuId: SENTINEL, rtuCode: "RTU-7", reason: "no-adapter" }],
      }),
      NOW,
    );
    // `deviceKey` is routing, not operator-facing; `detail` and `rtuId` are
    // internal. None of the three is rendered, and each is a plausible place a
    // future connection string or credential fragment would arrive.
    assert(
      !body.includes(SENTINEL),
      `only deliberately rendered fields may reach the body:\n${body}`,
    );
  }
}
