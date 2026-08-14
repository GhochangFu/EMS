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
};

/**
 * Renders the plain-text body. Pure, so the output is assertable — including
 * the assertion that no credential can appear in it.
 */
export function renderHealth(snapshot: HealthSnapshot, now: Date): string {
  const uptimeSeconds = Math.max(0, Math.round((now.getTime() - snapshot.startedAt.getTime()) / 1000));
  const devices = snapshot.endpoints.reduce((n, e) => n + e.devices.length, 0);
  const unhealthy = snapshot.endpoints.filter((e) => e.state !== "connected");

  const lines: string[] = [];
  lines.push(
    `ingest-host ${unhealthy.length === 0 ? "ok" : "degraded"} ` +
      `endpoints=${snapshot.endpoints.length} rtus=${devices} ` +
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
        `state=${endpoint.state} rtus=${endpoint.devices.join("|")} ` +
        `restarts=${endpoint.restarts} pollFailures=${endpoint.consecutivePollFailures} ` +
        `queue=${endpoint.queueDepth} dropped=${endpoint.droppedSamples} ` +
        `written=${endpoint.samplesWritten} writeFailures=${endpoint.writeFailures} ` +
        `lastSample=${endpoint.lastSampleAt?.toISOString() ?? "never"}`,
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
