import { renderHealth, type HealthSnapshot } from "./health-server.js";
import type { SupervisorHealth } from "./supervisor.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const STARTED_AT = new Date("2026-08-05T12:00:00.000Z");
const NOW = new Date("2026-08-05T12:05:30.000Z");

function endpoint(overrides: Partial<SupervisorHealth> = {}): SupervisorHealth {
  return {
    protocol: "mqtt",
    endpointKey: "phe.thinkiot.co.in:8883",
    state: "connected",
    devices: ["RTU-1", "RTU-2"],
    restarts: 0,
    consecutivePollFailures: 0,
    queueDepth: 0,
    droppedSamples: 0,
    writeFailures: 0,
    samplesWritten: 42,
    lastSampleAt: new Date("2026-08-05T12:05:00.000Z"),
    ...overrides,
  };
}

function snapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    endpoints: [endpoint()],
    skipped: [],
    notifyEnabled: false,
    startedAt: STARTED_AT,
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
    // The parallel-run window is entered by a human reading this line.
    assert(body.includes("notify=off"), "the NOTIFY state must be visible, not assumed");
    assert(body.endsWith("\n"), "the body ends with a newline, like index.js's");
  }

  {
    assert(
      renderHealth(snapshot({ notifyEnabled: true }), NOW).includes("notify=on"),
      "notify=on is reported when realtime is live",
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
            devices: ["RTU-9"],
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
