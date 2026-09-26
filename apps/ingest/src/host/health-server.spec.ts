import { MAX_DARK_LINES, renderHealth, type HealthSnapshot } from "./health-server.js";
import type { DeviceHealth, PointHealth, SupervisorHealth } from "./supervisor.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Exact-token match: `dark=1` must not match inside `dark=10`–`dark=19`. */
function hasToken(body: string, token: string): boolean {
  return new RegExp(`(?:^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(body);
}

const STARTED_AT = new Date("2026-08-05T12:00:00.000Z");
const NOW = new Date("2026-08-05T12:05:30.000Z");
/** 30 s before `NOW` — inside any sane staleness window. */
const FRESH = new Date("2026-08-05T12:05:00.000Z");

/** Five minutes, matching `DEFAULT_STALE_AFTER_MS`. */
const STALE_AFTER_MS = 300_000;

function device(rtuCode: string, overrides: Partial<DeviceHealth> = {}): DeviceHealth {
  return { rtuCode, deviceKey: rtuCode, lastSampleAt: FRESH, points: [], ...overrides };
}

/** A bound point, in binding order — mirrors `device()`'s shape. */
function point(sourceKey: string, lastSampleAt?: Date): PointHealth {
  return { sourceKey, ...(lastSampleAt === undefined ? {} : { lastSampleAt }) };
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
    buffered: 0,
    writePath: "ok",
    bufferDropped: 0,
    replayed: 0,
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

  // ---- the disk buffer's three counters -----------------------------------

  {
    const body = renderHealth(
      snapshot({ endpoints: [endpoint({ buffered: 12, bufferDropped: 3, replayed: 40 })] }),
      NOW,
    );
    assert(
      body.includes("buffered=12 bufferDropped=3 replayed=40"),
      `the disk buffer's three counters must be visible:\n${body}`,
    );
  }

  {
    // The connection is fine and every device is fresh — only the database is
    // down. The buffer gauge alone must degrade the host.
    const body = renderHealth(
      snapshot({ endpoints: [endpoint({ buffered: 1 })] }),
      NOW,
    );
    assert(
      body.startsWith("ingest-host degraded "),
      `a non-empty disk buffer degrades the host even with a fresh, connected endpoint:\n${body}`,
    );
    assert(
      body.includes("state=connected"),
      `the endpoint's connection state is unaffected by buffering:\n${body}`,
    );
  }

  {
    // The verdict reads the gauges (`buffered`, `writePath`), not the lifetime
    // counters (`bufferDropped`, `replayed`) — the same rule §4.6 applies
    // elsewhere. `writePath` is set explicitly here: a host that lost its last
    // batch is not `ok`, and this case must be about the counters alone.
    const body = renderHealth(
      snapshot({
        endpoints: [endpoint({ buffered: 0, bufferDropped: 500, replayed: 9_000, writePath: "ok" })],
      }),
      NOW,
    );
    assert(
      body.startsWith("ingest-host ok "),
      `a drained buffer is ok regardless of lifetime bufferDropped/replayed totals:\n${body}`,
    );
  }

  // ---- writePath: the state `buffered` alone cannot see ---------------------

  {
    // The batch failed to write **and** failed to spill. Nothing is on disk,
    // the connection is fine, every RTU is fresh — and the samples are gone.
    // Before `writePath` this rendered `ingest-host ok`.
    const body = renderHealth(
      snapshot({ endpoints: [endpoint({ buffered: 0, writePath: "losing", bufferDropped: 3 })] }),
      NOW,
    );
    assert(
      body.includes("state=connected writePath=losing"),
      `writePath is rendered on the endpoint line, next to the state:\n${body}`,
    );
    assert(
      body.startsWith("ingest-host degraded "),
      `losing the write path degrades the host even with buffered=0 and a connected endpoint:\n${body}`,
    );
    assert(body.includes("buffered=0"), `and the gauge that cannot see it still reads 0:\n${body}`);
  }

  {
    const body = renderHealth(
      snapshot({ endpoints: [endpoint({ buffered: 7, writePath: "buffering" })] }),
      NOW,
    );
    assert(
      body.includes("writePath=buffering"),
      `an open breaker is rendered as buffering:\n${body}`,
    );
    assert(body.startsWith("ingest-host degraded "), "and it degrades the host");
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

/**
 * Per-point liveness on the health body (`F4.58`).
 *
 * `stale` answers "did this RTU stop talking"; `dark` answers the question a
 * silent-but-connected RTU cannot: "of what it still sends, what has it
 * stopped sending". Same clock, same window, same boot grace as `stale` — Q3
 * ruled `dark>0` does not itself degrade the verdict.
 */
export function runDarkPointTests(): void {
  // ---- one dark point of two is named, the live one is not -----------------

  {
    const pressLastSample = new Date(NOW.getTime() - 301_000);
    const body = renderHealth(
      snapshot({
        endpoints: [
          endpoint({
            devices: [
              device("RTU-1", { points: [point("flow", FRESH), point("press", pressLastSample)] }),
            ],
          }),
        ],
      }),
      NOW,
    );
    assert(hasToken(body, "dark=1"), `the header must count the one dark point:\n${body}`);
    assert(
      body.includes(
        `dark rtu=RTU-1 endpoint=phe.thinkiot.co.in:8883 key=press ` +
          `lastSample=${pressLastSample.toISOString()} silentFor=301s`,
      ),
      `the dark point must be named with its own duration:\n${body}`,
    );
    assert(!body.includes("key=flow"), `the point still publishing must not be listed dark:\n${body}`);
  }

  // ---- a point that has never published renders `never` --------------------

  {
    const body = renderHealth(
      snapshot({ endpoints: [endpoint({ devices: [device("RTU-1", { points: [point("flow")] })] })] }),
      NOW,
    );
    assert(hasToken(body, "dark=1"), `a never-seen point still counts as dark:\n${body}`);
    assert(
      body.includes("dark rtu=RTU-1 endpoint=phe.thinkiot.co.in:8883 key=flow lastSample=never\n"),
      `a point with no sample renders \`never\`, with no duration to append:\n${body}`,
    );
  }

  // ---- exactly on the boundary is not dark ----------------------------------

  {
    const boundary = new Date(NOW.getTime() - STALE_AFTER_MS);
    const body = renderHealth(
      snapshot({
        endpoints: [
          endpoint({
            devices: [device("RTU-1", { points: [point("flow", FRESH), point("press", boundary)] })],
          }),
        ],
      }),
      NOW,
    );
    assert(hasToken(body, "dark=0"), `publishing exactly at the boundary is not yet dark:\n${body}`);
    assert(!body.includes("dark rtu="), `no dark line renders at the boundary:\n${body}`);
  }

  // ---- boot grace: a never-seen point is not dark before the window elapses -

  {
    const justStarted = new Date(STARTED_AT.getTime() + STALE_AFTER_MS - 1_000);
    const body = renderHealth(
      snapshot({ endpoints: [endpoint({ devices: [device("RTU-1", { points: [point("flow")] })] })] }),
      justStarted,
    );
    assert(
      hasToken(body, "dark=0"),
      `a point cannot be dark before the host has been up long enough to hear it:\n${body}`,
    );
    assert(body.startsWith("ingest-host ok "), `a cold start is not degraded by its points:\n${body}`);
  }

  // ---- a point on a stale device is not also reported dark ------------------

  {
    const body = renderHealth(
      snapshot({
        endpoints: [
          endpoint({
            devices: [
              device("RTU-1", { lastSampleAt: undefined, points: [point("flow"), point("press")] }),
            ],
          }),
        ],
      }),
      NOW,
    );
    assert(hasToken(body, "stale=1"), `the silent RTU is still reported stale:\n${body}`);
    assert(hasToken(body, "dark=0"), `its points are not double-counted as dark:\n${body}`);
    assert(!body.includes("dark rtu="), `no dark line renders for a stale RTU's points:\n${body}`);
  }

  // ---- dark>0 does not itself degrade the verdict (Q3) -----------------------

  {
    const body = renderHealth(
      snapshot({
        endpoints: [
          endpoint({ devices: [device("RTU-1", { points: [point("press", new Date(NOW.getTime() - 301_000))] })] }),
        ],
      }),
      NOW,
    );
    assert(hasToken(body, "dark=1"), `this case must actually have a dark point:\n${body}`);
    assert(body.startsWith("ingest-host ok "), `dark>0 alone keeps the verdict ok:\n${body}`);
  }

  // ---- the cap: at most MAX_DARK_LINES lines, the rest summarised -----------

  {
    const total = MAX_DARK_LINES + 1;
    const points: PointHealth[] = [];
    for (let i = 0; i < total; i += 1) {
      points.push(point(`p${i}`, new Date(NOW.getTime() - 301_000)));
    }
    const body = renderHealth(
      snapshot({ endpoints: [endpoint({ devices: [device("RTU-1", { points })] })] }),
      NOW,
    );
    const darkLineCount = body.split("\n").filter((line) => line.startsWith("dark rtu=")).length;
    assert(darkLineCount === MAX_DARK_LINES, `at most ${MAX_DARK_LINES} dark lines render, got ${darkLineCount}:\n${body}`);
    assert(hasToken(body, "dark omitted=1"), `the rest are summarised by one trailer:\n${body}`);
    assert(hasToken(body, `dark=${total}`), `the header keeps the true total, uncapped:\n${body}`);
  }

  // ---- exactly MAX_DARK_LINES dark points: no trailer, all render -----------

  {
    const points: PointHealth[] = [];
    for (let i = 0; i < MAX_DARK_LINES; i += 1) {
      points.push(point(`p${i}`, new Date(NOW.getTime() - 301_000)));
    }
    const body = renderHealth(
      snapshot({ endpoints: [endpoint({ devices: [device("RTU-1", { points })] })] }),
      NOW,
    );
    assert(
      hasToken(body, `dark=${MAX_DARK_LINES}`),
      `the header must count exactly ${MAX_DARK_LINES}:\n${body}`,
    );
    const darkLineCount = body.split("\n").filter((line) => line.startsWith("dark rtu=")).length;
    assert(
      darkLineCount === MAX_DARK_LINES,
      `exactly ${MAX_DARK_LINES} dark points must all render, got ${darkLineCount}:\n${body}`,
    );
    assert(
      !body.includes("dark omitted"),
      `the boundary case must not add a trailer — that is only for strictly more than the cap:\n${body}`,
    );
  }

  // ---- the count spans endpoints ---------------------------------------------

  {
    const body = renderHealth(
      snapshot({
        endpoints: [
          endpoint({
            devices: [device("RTU-1", { points: [point("flow", new Date(NOW.getTime() - 301_000))] })],
          }),
          endpoint({
            protocol: "modbus_tcp",
            endpointKey: "10.0.0.5:502",
            devices: [device("RTU-9", { points: [point("temp", new Date(NOW.getTime() - 301_000))] })],
          }),
        ],
      }),
      NOW,
    );
    assert(hasToken(body, "dark=2"), `the header sums dark points host-wide:\n${body}`);
    assert(
      body.includes("dark rtu=RTU-1 endpoint=phe.thinkiot.co.in:8883 key=flow") &&
        body.includes("dark rtu=RTU-9 endpoint=10.0.0.5:502 key=temp"),
      `each dark point names the endpoint it sits on:\n${body}`,
    );
  }
}

// ---- identifiers are percent-encoded outside a safe set (L1) ---------------
//
// The F4.58 security review (finding L1): `source_data_key` and `rtu_code` are
// validated only for length, so an admin or an imported onboarding sheet could
// store `x\ningest-host ok …` and forge a header, `stale` or `dark` line in a
// line-oriented body. Each block below is one claim, with its own `it()`.

/** The body split into records — the trailing newline is not a record. */
function records(body: string): readonly string[] {
  return body.slice(0, -1).split("\n");
}

/** One dark point on a live RTU, with the given key — never published. */
function darkSnapshot(sourceKey: string): HealthSnapshot {
  return snapshot({
    endpoints: [endpoint({ devices: [device("RTU-9", { points: [point(sourceKey)] })] })],
  });
}

/** (a) A dark key with `\r`, `\n`, a space, `=` and `%` stays one record. */
export function runDarkKeyEscapeTests(): void {
  const forged = "a b=c%\r\ndark rtu=FORGED";
  const body = renderHealth(darkSnapshot(forged), NOW);
  const darkLines = records(body).filter((l) => l.startsWith("dark rtu="));
  assert(darkLines.length === 1, `exactly one dark record renders:\n${body}`);
  assert(
    darkLines[0] ===
      "dark rtu=RTU-9 endpoint=phe.thinkiot.co.in:8883 key=a%20b%3Dc%25%0D%0Adark%20rtu%3DFORGED lastSample=never",
    `the key is percent-encoded in place:\n${body}`,
  );
  assert(
    records(body).length === records(renderHealth(darkSnapshot("plain"), NOW)).length,
    `the forged key adds no record over a plain one:\n${body}`,
  );
  assert(!body.includes("\ndark rtu=FORGED"), `the forged text never starts a record:\n${body}`);
}

/** The RTU code on a `dark` record — a live RTU, so it is not `stale` — is encoded too. */
export function runDarkRtuEscapeTests(): void {
  const body = renderHealth(
    snapshot({ endpoints: [endpoint({ devices: [device("D\nstale rtu=X", { points: [point("p")] })] })] }),
    NOW,
  );
  assert(
    records(body).includes("dark rtu=D%0Astale%20rtu%3DX endpoint=phe.thinkiot.co.in:8883 key=p lastSample=never"),
    `the dark record's RTU code is percent-encoded in place:\n${body}`,
  );
  assert(!body.includes("\nstale rtu=X"), `the forged text never starts a record:\n${body}`);
}

/** (b) A stale RTU code with a newline stays one record, and forges no header. */
export function runStaleRtuEscapeTests(): void {
  const staleSnapshot = (rtuCode: string): HealthSnapshot =>
    snapshot({ endpoints: [endpoint({ devices: [device(rtuCode, { lastSampleAt: undefined })] })] });
  const body = renderHealth(staleSnapshot("R\ningest-host ok endpoints=9"), NOW);
  const staleLines = records(body).filter((l) => l.startsWith("stale rtu="));
  assert(staleLines.length === 1, `exactly one stale record renders:\n${body}`);
  assert(
    staleLines[0] === "stale rtu=R%0Aingest-host%20ok%20endpoints%3D9 endpoint=phe.thinkiot.co.in:8883 lastSample=never",
    `the RTU code is percent-encoded in place:\n${body}`,
  );
  assert(
    records(body).length === records(renderHealth(staleSnapshot("R"), NOW)).length,
    `the forged code adds no record over a plain one:\n${body}`,
  );
  const headers = records(body).filter((l) => l.startsWith("ingest-host "));
  assert(
    headers.length === 1 && body.startsWith("ingest-host degraded "),
    `the one header is the real, degraded one:\n${body}`,
  );
}

/** (c) Ordinary identifiers — IMEIs, pilot keys, broker hosts — render byte-identical. */
export function runPlainIdentifierTests(): void {
  const body = renderHealth(
    snapshot({
      endpoints: [
        endpoint({
          devices: [
            device("861736076128245", {
              points: [point("s12_r01"), point("E71B/OB/RAW"), point("computed:KWH"), point("TX01_KW-2")],
            }),
          ],
        }),
      ],
    }),
    NOW,
  );
  for (const key of ["s12_r01", "E71B/OB/RAW", "computed:KWH", "TX01_KW-2"]) {
    assert(
      records(body).includes(
        `dark rtu=861736076128245 endpoint=phe.thinkiot.co.in:8883 key=${key} lastSample=never`,
      ),
      `${key} renders unescaped:\n${body}`,
    );
  }
  assert(hasToken(body, "rtus=861736076128245"), `the IMEI renders unescaped in rtus=:\n${body}`);
}

/** A `|` inside one RTU code cannot forge a second `rtus=` member. */
export function runRtusMemberEscapeTests(): void {
  const body = renderHealth(snapshot({ endpoints: [endpoint({ devices: [device("A|B"), device("C")] })] }), NOW);
  assert(hasToken(body, "rtus=A%7CB|C"), `each member is encoded before the join:\n${body}`);
  assert(!body.includes("rtus=A|B|C"), `the code does not read as two members:\n${body}`);
}

/** The endpoint key — DB `host:port` — is encoded on every line that prints it. */
export function runEndpointKeyEscapeTests(): void {
  const body = renderHealth(
    snapshot({
      endpoints: [
        endpoint({
          endpointKey: "h\nost:1",
          devices: [device("RTU-1", { lastSampleAt: undefined }), device("RTU-2", { points: [point("p")] })],
        }),
      ],
    }),
    NOW,
  );
  assert(hasToken(body, "key=h%0Aost:1"), `the endpoint line encodes its key:\n${body}`);
  assert(body.includes("stale rtu=RTU-1 endpoint=h%0Aost:1 "), `the stale line encodes the key:\n${body}`);
  assert(body.includes("dark rtu=RTU-2 endpoint=h%0Aost:1 "), `the dark line encodes the key:\n${body}`);
}

/** A skipped RTU's code is encoded; the `(no rtu_code)` literal is not. */
export function runSkippedRtuEscapeTests(): void {
  const body = renderHealth(
    snapshot({
      skipped: [
        { rtuId: "u1", rtuCode: "S\nstale rtu=X", reason: "no-mqtt-owned-points" },
        { rtuId: "u2", rtuCode: null, reason: "missing-rtu-code" },
      ],
    }),
    NOW,
  );
  assert(
    records(body).includes("skipped rtu=S%0Astale%20rtu%3DX reason=no-mqtt-owned-points"),
    `the skipped code is percent-encoded in place:\n${body}`,
  );
  assert(
    records(body).includes("skipped rtu=(no rtu_code) reason=missing-rtu-code"),
    `the fallback literal renders as written:\n${body}`,
  );
}

/** A skip's `detail` — the raw `config_protocol` on `unsupported-protocol` — is encoded. */
export function runSkippedDetailEscapeTests(): void {
  const body = renderHealth(
    snapshot({
      skipped: [{ rtuId: "u1", rtuCode: "RTU-7", reason: "unsupported-protocol", detail: "x\ningest-host ok" }],
    }),
    NOW,
  );
  assert(
    records(body).includes("skipped rtu=RTU-7 reason=unsupported-protocol detail=x%0Aingest-host%20ok"),
    `the detail is percent-encoded in place:\n${body}`,
  );
  assert(
    records(body).filter((l) => l.startsWith("ingest-host ")).length === 1,
    `the detail forges no header:\n${body}`,
  );
}
