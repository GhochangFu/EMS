import { createHostLogger } from "./logger.js";
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

/** The plain-text health body (ADR 0016 §Dependencies) and the host logger. */
export function runHealthAndLoggerTests(): void {
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

  // ---- the logger emits one JSON line per event ---------------------------

  {
    const lines: string[] = [];
    const logger = createHostLogger({ component_test: true }, (line) => lines.push(line));
    logger.info("started", { endpoints: 2 });
    assert(lines.length === 1, "one event is one line");
    assert(lines[0].endsWith("\n"), "JSON lines are newline-terminated");
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    assert(parsed.level === "info", "the level is recorded");
    assert(parsed.message === "started", "the message is recorded");
    assert(parsed.endpoints === 2, "structured fields are merged in");
    assert(parsed.component === "ingest-host", "the component is stamped");
    assert(typeof parsed.time === "string", "the timestamp is present");
  }

  {
    const lines: string[] = [];
    const logger = createHostLogger({}, (line) => lines.push(line));
    const child = logger.child({ endpointKey: "phe:8883", protocol: "mqtt" });
    child.warn("restarting", { attempt: 2 });
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    // This is the binding ADR 0016 §1 describes: "the host binds to
    // { rtuCode, protocol }", so every adapter line is attributable.
    assert(parsed.endpointKey === "phe:8883", "child fields appear on every line");
    assert(parsed.protocol === "mqtt", "child fields appear on every line");
    assert(parsed.attempt === 2, "per-call fields are merged over child fields");
    assert(parsed.level === "warn", "the child preserves levels");

    logger.info("parent");
    const parentLine = JSON.parse(lines[1]) as Record<string, unknown>;
    assert(parentLine.endpointKey === undefined, "a child must not mutate its parent");
  }

  {
    // A circular field must never be the thing that takes down ingest.
    const lines: string[] = [];
    const logger = createHostLogger({}, (line) => lines.push(line));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    logger.error("bad fields", { circular });
    assert(lines.length === 1, "a non-serialisable field still produces a line");
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    assert(parsed.message === "bad fields", "the message survives");
    assert(typeof parsed.note === "string", "the omission is stated rather than silent");
  }
}
