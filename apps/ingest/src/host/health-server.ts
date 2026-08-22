import http from "node:http";

import type { SkippedBinding } from "./bindings.js";
import type { SupervisorHealth } from "./supervisor.js";

/**
 * The health endpoint (ADR 0016 §Dependencies).
 *
 * "No metrics library. The existing plain-text health endpoint is extended with
 * per-RTU state. `prom-client` is deferred to F1.10 / F3.16." So this stays the
 * same shape as `index.js`'s one-line response, with the per-endpoint detail
 * `F3.16` will eventually read through the API rather than by scraping this.
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
      const since = Math.max(
        device.lastSampleAt?.getTime() ?? 0,
        snapshot.startedAt.getTime(),
      );
      const silentForMs = now.getTime() - since;
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
 * Renders the plain-text body. Pure, so the output is assertable — including
 * the assertion that no credential can appear in it.
 */
export function renderHealth(snapshot: HealthSnapshot, now: Date): string {
  const uptimeSeconds = Math.max(0, Math.round((now.getTime() - snapshot.startedAt.getTime()) / 1000));
  const devices = snapshot.endpoints.reduce((n, e) => n + e.devices.length, 0);
  const unhealthy = snapshot.endpoints.filter((e) => e.state !== "connected");
  const stale = staleDevices(snapshot, now);

  const lines: string[] = [];
  lines.push(
    // A silent RTU degrades the host even while every connection is healthy.
    // Reporting `ok` with a mapped RTU publishing nothing is exactly what let
    // three silent PHE stations go unnoticed — see `stale rtu=` below.
    `ingest-host ${unhealthy.length === 0 && stale.length === 0 ? "ok" : "degraded"} ` +
      `endpoints=${snapshot.endpoints.length} rtus=${devices} stale=${stale.length} ` +
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
      `skipped=${snapshot.skipped.length} notify=on ` +
      `uptime=${uptimeSeconds}s`,
  );

  for (const endpoint of snapshot.endpoints) {
    lines.push(
      `endpoint protocol=${endpoint.protocol} key=${endpoint.endpointKey} ` +
        `state=${endpoint.state} rtus=${endpoint.devices.map((d) => d.rtuCode).join("|")} ` +
        `restarts=${endpoint.restarts} pollFailures=${endpoint.consecutivePollFailures} ` +
        `queue=${endpoint.queueDepth} dropped=${endpoint.droppedSamples} ` +
        `written=${endpoint.samplesWritten} writeFailures=${endpoint.writeFailures} ` +
        `lastSample=${endpoint.lastSampleAt?.toISOString() ?? "never"}`,
    );
  }

  // One line per silent RTU, after the endpoints that are still connected.
  // The endpoint line says the broker is fine; these say which stations behind
  // it have stopped talking, which is a different question and a different fix.
  for (const device of stale) {
    const silentForSeconds =
      device.lastSampleAt === undefined
        ? undefined
        : Math.max(0, Math.round((now.getTime() - device.lastSampleAt.getTime()) / 1000));
    lines.push(
      `stale rtu=${device.rtuCode} endpoint=${device.endpointKey} ` +
        `lastSample=${device.lastSampleAt?.toISOString() ?? "never"}` +
        (silentForSeconds === undefined ? "" : ` silentFor=${silentForSeconds}s`),
    );
  }

  // Skipped RTUs are reported, not hidden. A gateway that silently never
  // appears is the failure mode ADR 0016 §3 asks to be logged once per RTU —
  // this is where an operator sees it without reading the log.
  for (const skip of snapshot.skipped) {
    lines.push(
      `skipped rtu=${skip.rtuCode ?? "(no rtu_code)"} reason=${skip.reason}` +
        (skip.detail === undefined ? "" : ` detail=${skip.detail}`),
    );
  }

  return `${lines.join("\n")}\n`;
}

export type HealthServer = {
  readonly port: number;
  close(): Promise<void>;
};

/**
 * Serves `renderHealth` on `port`.
 *
 * Binding failures reject rather than throwing asynchronously, so `main.ts` can
 * report "the health port is already taken" — the realistic mistake during the
 * §6 parallel run, where the legacy process is holding 9102.
 */
export function startHealthServer(
  port: number,
  snapshot: () => HealthSnapshot,
): Promise<HealthServer> {
  const server = http.createServer((_request, response) => {
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
      resolve({
        port,
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
