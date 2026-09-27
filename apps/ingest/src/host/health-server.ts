import http from "node:http";

import type { SkippedBinding } from "./bindings.js";
import type { SupervisorHealth } from "./supervisor.js";

/**
 * The health endpoint (ADR 0016 §Dependencies).
 *
 * "No metrics library. The existing plain-text health endpoint is extended with
 * per-RTU state." `prom-client` is deferred to `F3.16` (ADR 0016 Amendment 4
 * decision 11). So this stays the same shape as `index.js`'s one-line
 * response, with the per-endpoint detail `F3.16` will eventually read through
 * the API rather than by scraping this.
 *
 * Who may ask is decided before any of that (`F4.61`, ADR 0016 Amendment 8).
 * The body names every enabled RTU and when each last spoke, unauthenticated,
 * so the handler answers `GET /` and `GET /health` for a loopback `Host` only
 * — the `Host` rule is what stops a rebound page in an operator's browser —
 * and the compose network keeps every container but `postgres` from reaching
 * it at all.
 */

export type HealthSnapshot = {
  readonly endpoints: readonly SupervisorHealth[];
  readonly skipped: readonly SkippedBinding[];
  readonly startedAt: Date;
  /** Silence longer than this marks one RTU stale (`F1.7`, `INGEST_STALE_AFTER_MS`). */
  readonly staleAfterMs: number;
};

/** One RTU that has stopped publishing, with the endpoint it sits on. */
type StaleDevice = {
  readonly rtuCode: string;
  readonly endpointKey: string;
  readonly lastSampleAt?: Date;
};

/** One bound point that has gone quiet on an otherwise-live RTU (`F4.58`). */
type DarkPoint = {
  readonly rtuCode: string;
  readonly endpointKey: string;
  readonly sourceKey: string;
  readonly lastSampleAt?: Date;
};

/** At most this many `dark rtu=` lines render; the rest are summarised by
 * `dark omitted=<k>`. The header's `dark=` stays the true total either way —
 * an operator counting from the header must never be undercounting. */
export const MAX_DARK_LINES = 50;

/** Characters an identifier may print as-is: every real IMEI, `rtu_code`,
 * `source_data_key` (`s12_r01`, `E71B/OB/RAW`, `computed:KWH`) and broker
 * `host:port` in the seeds and `docs/ingest-host.md` fits inside it. */
const UNSAFE_IDENTIFIER_CHAR = /[^A-Za-z0-9._:/-]/gu;
const utf8 = new TextEncoder();

/**
 * One DB- or config-sourced identifier as a single, unambiguous body token.
 *
 * The F4.58 security review (finding L1): `source_data_key` and `rtu_code` are
 * validated only for length, so a stored `x\ningest-host ok …` would forge a
 * header, `stale` or `dark` record in this line-oriented body. Every character
 * outside the safe set — `%` itself included — is percent-encoded as its UTF-8
 * bytes, so the value stays on one line and in one field, and ordinary
 * identifiers render byte-identical (AGENTS.md §4.3: "Never trust input", and
 * "input" is not only HTTP — a stored row read back is input too). `TextEncoder`, not
 * `encodeURIComponent`: that leaves `!'()*~` bare and throws on a lone
 * surrogate, which would turn a bad key into a 500.
 */
export function token(value: string): string {
  return value.replace(UNSAFE_IDENTIFIER_CHAR, (char) =>
    Array.from(utf8.encode(char), (byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join(""),
  );
}

/**
 * Milliseconds a point or device has been silent, floored at `startedAt` —
 * the one clock `stale` and `dark` both read, so their two verdicts and their
 * two `silentFor=` durations can never disagree with each other.
 */
function silentSinceMs(lastSampleAt: Date | undefined, startedAt: Date, now: Date): number {
  const since = Math.max(lastSampleAt?.getTime() ?? 0, startedAt.getTime());
  return now.getTime() - since;
}

/** The `silentFor=<n>s` an operator reads, or `undefined` when there is
 * nothing to measure from — same floor as `silentSinceMs`. */
function silentForSeconds(
  lastSampleAt: Date | undefined,
  startedAt: Date,
  now: Date,
): number | undefined {
  if (lastSampleAt === undefined) {
    return undefined;
  }
  return Math.max(0, Math.round(silentSinceMs(lastSampleAt, startedAt, now) / 1000));
}

/**
 * Which bound RTUs have gone quiet (`F1.7`).
 *
 * **Strictly greater than the threshold**, so a device publishing exactly on
 * the boundary does not flap between stale and fresh on consecutive scrapes.
 *
 * **Silence is measured from `startedAt` when an RTU has never published**, not
 * from the beginning of time. Treating "no sample yet" as infinitely stale
 * would make the host boot `degraded` with every enabled RTU listed, for a
 * whole publish cycle, every restart — an alarm that cries wolf on every deploy
 * is one an operator learns to ignore, which costs more than it catches. After
 * the window has elapsed and the RTU still has not spoken, it is genuinely
 * stale: `ingest_enabled` on a device that produces nothing is a mapping error,
 * and that is the one most worth seeing.
 */
function staleDevices(snapshot: HealthSnapshot, now: Date): readonly StaleDevice[] {
  const stale: StaleDevice[] = [];
  for (const endpoint of snapshot.endpoints) {
    for (const device of endpoint.devices) {
      // The last moment we could plausibly have heard from this RTU: its own
      // sample, or the host coming up, whichever is later.
      const silentForMs = silentSinceMs(device.lastSampleAt, snapshot.startedAt, now);
      if (silentForMs > snapshot.staleAfterMs) {
        stale.push({
          rtuCode: device.rtuCode,
          endpointKey: endpoint.endpointKey,
          ...(device.lastSampleAt === undefined ? {} : { lastSampleAt: device.lastSampleAt }),
        });
      }
    }
  }
  return stale;
}

/**
 * Which bound points have gone quiet on an RTU that is not itself stale
 * (`F4.58`).
 *
 * **A point on a stale RTU is neither listed nor counted here.** The `stale
 * rtu=` line already says the whole device stopped talking; repeating every
 * one of its bound keys as `dark` too would say the same fact twice under two
 * names, and would drown the case this line exists for — a station that is
 * genuinely still talking, just not about everything it is mapped to.
 *
 * Same clock as `stale`: `max(lastSampleAt, startedAt)`, strictly greater
 * than the threshold, so a point publishing exactly on the boundary does not
 * flap, and a point that has never once published is not falsely dark before
 * the host has been up long enough to have heard it.
 */
function darkPoints(
  snapshot: HealthSnapshot,
  now: Date,
  stale: readonly StaleDevice[],
): readonly DarkPoint[] {
  const staleDeviceIds = new Set(stale.map((s) => `${s.endpointKey}\u0000${s.rtuCode}`));
  const dark: DarkPoint[] = [];
  for (const endpoint of snapshot.endpoints) {
    for (const device of endpoint.devices) {
      if (staleDeviceIds.has(`${endpoint.endpointKey}\u0000${device.rtuCode}`)) {
        continue;
      }
      for (const point of device.points) {
        const silentForMs = silentSinceMs(point.lastSampleAt, snapshot.startedAt, now);
        if (silentForMs > snapshot.staleAfterMs) {
          dark.push({
            rtuCode: device.rtuCode,
            endpointKey: endpoint.endpointKey,
            sourceKey: point.sourceKey,
            ...(point.lastSampleAt === undefined ? {} : { lastSampleAt: point.lastSampleAt }),
          });
        }
      }
    }
  }
  return dark;
}

/**
 * Renders the plain-text body. Pure, so the output is assertable — including
 * the assertion that no credential can appear in it.
 */
export function renderHealth(snapshot: HealthSnapshot, now: Date): string {
  const uptimeSeconds = Math.max(0, Math.round((now.getTime() - snapshot.startedAt.getTime()) / 1000));
  const devices = snapshot.endpoints.reduce((n, e) => n + e.devices.length, 0);
  const unhealthy = snapshot.endpoints.filter((e) => e.state !== "connected");
  const stale = staleDevices(snapshot, now);
  const dark = darkPoints(snapshot, now, stale);
  const buffered = snapshot.endpoints.reduce((n, e) => n + e.buffered, 0);
  // `buffered` cannot see the worst case: a batch that fails to write *and*
  // fails to spill leaves the gauge at 0 with the samples destroyed. `losing`
  // is that state, and `buffering` is the ordinary one — both degrade, and
  // both clear on their own, which a lifetime counter would not.
  const everyWritePathOk = snapshot.endpoints.every((e) => e.writePath === "ok");

  const lines: string[] = [];
  lines.push(
    // A silent RTU degrades the host even while every connection is healthy,
    // and so does a non-empty disk buffer even while every connection and
    // every RTU is fine — the database, not the broker, is the thing down.
    // Reporting `ok` with a mapped RTU publishing nothing is exactly what let
    // three silent PHE stations go unnoticed — see `stale rtu=` below.
    `ingest-host ${
      unhealthy.length === 0 && stale.length === 0 && buffered === 0 && everyWritePathOk
        ? "ok"
        : "degraded"
    } ` +
      `endpoints=${snapshot.endpoints.length} rtus=${devices} stale=${stale.length} dark=${dark.length} ` +
      // `notify=on` is a literal since ADR 0016 §6 commit 4 deleted the switch.
      // Kept for continuity — an operator or check matching on the token still
      // finds it — but it reports *intent*, not delivery, and would print `on`
      // with every notification failing.
      //
      // The delivery signal is `written=` and `writeFailures=` on the endpoint
      // lines: commit 4 left no branch between writing and notifying, so
      // `writeResolved` does both or throws, and the supervisor only counts
      // `samplesWritten` when the whole call succeeded. `docs/ingest-host.md`
      // says so; do not reintroduce a `notify` field that varies, because a
      // varying one would mean the switch is back.
      //
      // `buffered=` is the second delivery signal, added by F1.10: a batch
      // that fails to write is not lost, it is spilled to disk, so
      // `writeFailures` alone can no longer answer "is telemetry being kept".
      // `buffered>0` is what degrades the host (see above) — the gauge, not
      // the lifetime `bufferDropped` counter. `writePath=` on the endpoint
      // line is the second gauge, for the case the first cannot see: nothing
      // on disk because nothing could be put there.
      `skipped=${snapshot.skipped.length} notify=on ` +
      `uptime=${uptimeSeconds}s`,
  );

  for (const endpoint of snapshot.endpoints) {
    lines.push(
      `endpoint protocol=${endpoint.protocol} key=${token(endpoint.endpointKey)} ` +
        `state=${endpoint.state} writePath=${endpoint.writePath} ` +
        // Each member is encoded before the join, so a `|` in one code cannot
        // read as two members.
        `rtus=${endpoint.devices.map((d) => token(d.rtuCode)).join("|")} ` +
        `restarts=${endpoint.restarts} pollFailures=${endpoint.consecutivePollFailures} ` +
        `queue=${endpoint.queueDepth} dropped=${endpoint.droppedSamples} ` +
        `written=${endpoint.samplesWritten} writeFailures=${endpoint.writeFailures} ` +
        `buffered=${endpoint.buffered} bufferDropped=${endpoint.bufferDropped} replayed=${endpoint.replayed} ` +
        `lastSample=${endpoint.lastSampleAt?.toISOString() ?? "never"}`,
    );
  }

  // One line per silent RTU, after the endpoints that are still connected.
  // The endpoint line says the broker is fine; these say which stations behind
  // it have stopped talking, which is a different question and a different fix.
  for (const device of stale) {
    // The same clock the stale decision used — `max(lastSampleAt, startedAt)`.
    // Deriving this one from `lastSampleAt` alone would let the two disagree,
    // and a duration that contradicts the verdict beside it is worse than none.
    const staleSilentSeconds = silentForSeconds(device.lastSampleAt, snapshot.startedAt, now);
    lines.push(
      `stale rtu=${token(device.rtuCode)} endpoint=${token(device.endpointKey)} ` +
        `lastSample=${device.lastSampleAt?.toISOString() ?? "never"}` +
        (staleSilentSeconds === undefined ? "" : ` silentFor=${staleSilentSeconds}s`),
    );
  }

  // One line per dark point, capped at `MAX_DARK_LINES` — an RTU with all 21
  // bound keys dark must not push a genuinely broken host's health body past
  // any reasonable size. The header's `dark=` above already carries the true
  // total, so the cap costs nothing but detail past the first 50.
  for (const point of dark.slice(0, MAX_DARK_LINES)) {
    const silentSeconds = silentForSeconds(point.lastSampleAt, snapshot.startedAt, now);
    lines.push(
      `dark rtu=${token(point.rtuCode)} endpoint=${token(point.endpointKey)} key=${token(point.sourceKey)} ` +
        `lastSample=${point.lastSampleAt?.toISOString() ?? "never"}` +
        (silentSeconds === undefined ? "" : ` silentFor=${silentSeconds}s`),
    );
  }
  if (dark.length > MAX_DARK_LINES) {
    lines.push(`dark omitted=${dark.length - MAX_DARK_LINES}`);
  }

  // Skipped RTUs are reported, not hidden. A gateway that silently never
  // appears is the failure mode ADR 0016 §3 asks to be logged once per RTU —
  // this is where an operator sees it without reading the log.
  //
  // `reason` is a code literal and the `(no rtu_code)` fallback is ours, so
  // neither is encoded. `detail` is: `unsupported-protocol` carries the raw
  // `config_protocol` that just failed validation, and other reasons carry
  // stored JSON key names or the endpoint key.
  for (const skip of snapshot.skipped) {
    lines.push(
      `skipped rtu=${skip.rtuCode === null ? "(no rtu_code)" : token(skip.rtuCode)} reason=${skip.reason}` +
        (skip.detail === undefined ? "" : ` detail=${token(skip.detail)}`),
    );
  }

  return `${lines.join("\n")}\n`;
}

/** A request the health endpoint will not answer, and the fixed reply it gets. */
export type HealthRefusal = {
  readonly status: 421 | 405 | 404;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
};

/** `localhost`, `127.0.0.1` or `[::1]`, each with an optional `:port`. Anchored
 * at both ends, so `127.0.0.1.evil.example` and `evil.127.0.0.1` are foreign.
 * No `g` flag: a global regex carries `lastIndex` from one `.test()` to the next. */
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

/** Exact matches on `request.url`: `/?x=1` and `/health/` are other paths. */
const HEALTH_PATHS: ReadonlySet<string> = new Set(["/", "/health"]);

const ALLOWED_METHOD = "GET";

/**
 * Whether to refuse one request, before anything is rendered (`F4.61`).
 *
 * **Host first**, so the DNS-rebinding defence fires whatever else is wrong
 * with the request; then method, then path. A missing `Host` is refused — an
 * HTTP/1.0 client can omit it, and its absence proves nothing about who asked.
 *
 * Every refusal body is one fixed line. It never echoes the value it refused
 * and never starts with `ingest-host`, so a liveness check matching that
 * prefix cannot pass on a refusal, and the roster never leaves on one.
 */
export function refuseHealthRequest(request: {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly host: string | undefined;
}): HealthRefusal | undefined {
  if (request.host === undefined || !LOOPBACK_HOST.test(request.host)) {
    return { status: 421, body: "refused: host\n", headers: {} };
  }
  if (request.method !== ALLOWED_METHOD) {
    return { status: 405, body: "refused: method\n", headers: { allow: ALLOWED_METHOD } };
  }
  if (request.url === undefined || !HEALTH_PATHS.has(request.url)) {
    return { status: 404, body: "refused: path\n", headers: {} };
  }
  return undefined;
}

export type HealthServer = {
  /** The port the OS bound — not the argument, which is 0 in the tests. */
  readonly port: number;
  close(): Promise<void>;
};

/**
 * Serves `renderHealth` on `port`, behind `refuseHealthRequest`.
 *
 * Binding failures reject rather than throwing asynchronously, so `main.ts` can
 * report "the health port is already taken" — the realistic mistake during the
 * §6 parallel run, where the legacy process is holding 9102.
 */
export function startHealthServer(
  port: number,
  snapshot: () => HealthSnapshot,
): Promise<HealthServer> {
  const server = http.createServer((request, response) => {
    // `host` is passed raw: a missing header must reach the gate as missing.
    const refusal = refuseHealthRequest({
      method: request.method,
      url: request.url,
      host: request.headers.host,
    });
    if (refusal !== undefined) {
      response.writeHead(refusal.status, { "content-type": "text/plain", ...refusal.headers });
      response.end(refusal.body);
      return;
    }
    let body: string;
    try {
      body = renderHealth(snapshot(), new Date());
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(`ingest-host error rendering health: ${error instanceof Error ? error.message : "unknown"}\n`);
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(body);
  });

  return new Promise<HealthServer>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve({
        port: typeof address === "object" && address !== null ? address.port : port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}
