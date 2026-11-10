import http from "node:http";
import { createGunzip } from "node:zlib";

import {
  UPLINK_MAX_BODY_BYTES,
  UPLINK_MAX_DECODED_BYTES,
  uplinkBatchSchema,
  type UplinkResponse,
} from "@bms/shared/ingest";

import { errorKind, type HostLogger } from "./logger.js";
import type { AuthOutcome } from "./uplink-gateways.js";
import type { SampleRateLimiter } from "./uplink-rate.js";
import type { ReceiveBatch } from "./uplink-receiver.js";

/**
 * The uplink listener (`E7.2`, ADR 0123 decision 4, plan T3.5) — the ingest
 * host's first listener meant to be reached from the internet (through the
 * public nginx origin, PR 4). Off unless `INGEST_UPLINK_PORT` is set.
 *
 * `POST /edge/v1/batches` and nothing else. The order of the checks is the
 * security property, cheapest and least trusting first:
 *
 * 1. path (404), then method (405);
 * 2. **authentication, before one byte of the body is read** (401 / 403) —
 *    from the in-memory snapshot, so an unauthenticated request costs a hash
 *    and never a query;
 * 3. one batch in flight per gateway, and at most `maxInFlight` (4) across
 *    all gateways so the uplink can never take the whole `pg` pool from the
 *    supervisors (429, `Retry-After`);
 * 4. `Content-Encoding: gzip` (400), then the declared `Content-Length`
 *    against the 256 KiB compressed cap (413);
 * 5. a streaming gunzip that aborts past 256 KiB read or 1 MiB decoded (413),
 *    so a gzip bomb stops at the cap rather than at the heap;
 * 6. strict UTF-8 and `JSON.parse`, then `uplinkBatchSchema` (400), then the
 *    gateway's sample-rate bucket (429, `Retry-After`; `uplink-rate.ts`);
 * 7. the write: `200 { accepted, rejected }` only after commit; a failed write
 *    is `503` with `Retry-After` and the edge keeps the batch (ruling P1 (b)).
 *
 * **Nothing is echoed.** Every refusal body is a fixed `{ "error": <code> }`;
 * no response and no log line carries the body, a parse message, the
 * `Authorization` header or the token (AGENTS.md §9.6). Refusals are logged
 * as one summary line at most once a minute, so an internet scanner cannot
 * turn the log into its megaphone; the counts still pending are flushed by an
 * `unref`'d timer and once on close, so a burst followed by silence is never
 * lost.
 *
 * **Shutdown cannot hang on a client.** `close()` stops accepting, closes idle
 * keep-alive sockets, marks every later reply `Connection: close`, and after
 * `closeGraceMs` (2 s) destroys whatever is still open — a socket that never
 * sent a byte, or one trickling headers, would otherwise hold `server.close()`
 * open until its own timeout. `server.maxConnections` (256) bounds the sockets
 * one host holds at all.
 */

export const UPLINK_PATH = "/edge/v1/batches";
/** `Retry-After` on a failed write: the database is the thing down. */
export const WRITE_RETRY_AFTER_SECONDS = 30;
/** `Retry-After` on a second batch while one is in flight. */
export const BUSY_RETRY_AFTER_SECONDS = 5;
/** At most one refusal summary per this many ms. */
export const REFUSAL_LOG_INTERVAL_MS = 60_000;
/** Batches being handled at once across every gateway; below `pg.Pool`'s default `max` of 10. */
export const DEFAULT_MAX_IN_FLIGHT = 4;
/** How long `close()` lets open requests finish before it destroys their sockets. */
export const CLOSE_GRACE_MS = 2_000;
/** `server.maxConnections` unless the caller says otherwise (`INGEST_UPLINK_MAX_CONNECTIONS`). */
export const DEFAULT_MAX_CONNECTIONS = 256;

export type UplinkServerDeps = {
  /** `authenticate` over the current gateway snapshot. */
  readonly authenticate: (header: string | undefined) => AuthOutcome;
  readonly receive: ReceiveBatch;
  readonly logger: HostLogger;
  /** Clock for the refusal-log throttle only. */
  readonly nowMs?: () => number;
  /** Per-gateway sample bucket; absent means no rate limit (tests only — `main.ts` always passes one). */
  readonly rateLimit?: SampleRateLimiter;
  readonly maxInFlight?: number;
  readonly maxConnections?: number;
  readonly closeGraceMs?: number;
  readonly refusalLogIntervalMs?: number;
};

export type UplinkServer = {
  /** The port the OS bound — not the argument, which is 0 in the tests. */
  readonly port: number;
  close(): Promise<void>;
};

type BodyOutcome =
  | { readonly kind: "ok"; readonly bytes: Buffer }
  | { readonly kind: "too-large" }
  | { readonly kind: "bad-gzip" }
  | { readonly kind: "aborted" };

/**
 * Reads and gunzips the body, counting both sides and stopping at either cap.
 * The decoded side is counted chunk by chunk as the inflater emits it, so the
 * inflater is destroyed within one chunk of the cap.
 */
function readGzipBody(request: http.IncomingMessage): Promise<BodyOutcome> {
  return new Promise((resolve) => {
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];
    let compressed = 0;
    let decoded = 0;
    let settled = false;
    const finish = (outcome: BodyOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      gunzip.destroy();
      resolve(outcome);
    };

    request.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      compressed += chunk.length;
      if (compressed > UPLINK_MAX_BODY_BYTES) {
        finish({ kind: "too-large" });
        return;
      }
      gunzip.write(chunk);
    });
    request.on("end", () => {
      if (!settled) {
        gunzip.end();
      }
    });
    request.on("aborted", () => finish({ kind: "aborted" }));
    request.on("error", () => finish({ kind: "aborted" }));

    gunzip.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      decoded += chunk.length;
      if (decoded > UPLINK_MAX_DECODED_BYTES) {
        finish({ kind: "too-large" });
        return;
      }
      chunks.push(chunk);
    });
    gunzip.on("end", () => finish({ kind: "ok", bytes: Buffer.concat(chunks) }));
    gunzip.on("error", () => finish({ kind: "bad-gzip" }));
  });
}

type Refusal =
  | "not-found"
  | "method"
  | "unauthorized"
  | "gateway-revoked"
  | "ingest-disabled"
  | "busy"
  | "overloaded"
  | "rate-limited"
  | "bad-encoding"
  | "too-large"
  | "bad-gzip"
  | "bad-json"
  | "bad-schema";

const STATUS: Readonly<Record<Refusal, number>> = {
  "not-found": 404,
  method: 405,
  unauthorized: 401,
  "gateway-revoked": 403,
  "ingest-disabled": 403,
  busy: 429,
  overloaded: 429,
  "rate-limited": 429,
  "bad-encoding": 400,
  "too-large": 413,
  "bad-gzip": 400,
  "bad-json": 400,
  "bad-schema": 400,
};

const HEADERS = { "content-type": "application/json", "cache-control": "no-store" } as const;


const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/** Parses strict UTF-8 JSON; `undefined` for anything else. Never surfaces the input. */
function parseJson(bytes: Buffer): { readonly value: unknown } | undefined {
  try {
    return { value: JSON.parse(strictUtf8.decode(bytes)) as unknown };
  } catch {
    return undefined;
  }
}

/** Serves `POST /edge/v1/batches` on `port`. Binding failures reject. */
export function startUplinkServer(port: number, deps: UplinkServerDeps): Promise<UplinkServer> {
  const nowMs = deps.nowMs ?? Date.now;
  const maxInFlight = deps.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
  const closeGraceMs = deps.closeGraceMs ?? CLOSE_GRACE_MS;
  const refusalLogIntervalMs = deps.refusalLogIntervalMs ?? REFUSAL_LOG_INTERVAL_MS;
  const inFlight = new Set<string>();
  const refused = new Map<Refusal, number>();
  let lastRefusalLogMs: number | undefined;
  let closing = false;

  const flushRefusals = (): void => {
    if (refused.size === 0) {
      return;
    }
    lastRefusalLogMs = nowMs();
    deps.logger.warn("uplink requests refused", Object.fromEntries(refused));
    refused.clear();
  };

  const noteRefusal = (reason: Refusal): void => {
    refused.set(reason, (refused.get(reason) ?? 0) + 1);
    const now = nowMs();
    if (lastRefusalLogMs !== undefined && now - lastRefusalLogMs < refusalLogIntervalMs) {
      return;
    }
    flushRefusals();
  };
  // A burst then silence: the counts pending since the last line still reach the log.
  const refusalFlushTimer = setInterval(flushRefusals, refusalLogIntervalMs);
  refusalFlushTimer.unref();

  /** One fixed JSON reply; once closing, every reply also drops its connection. */
  const reply = (
    response: http.ServerResponse,
    status: number,
    body: unknown,
    extra: Readonly<Record<string, string>> = {},
  ): void => {
    response.writeHead(status, { ...HEADERS, ...extra, ...(closing ? { connection: "close" } : {}) });
    response.end(JSON.stringify(body));
  };

  const refuse = (
    response: http.ServerResponse,
    reason: Refusal,
    extra: Readonly<Record<string, string>> = {},
  ): void => {
    noteRefusal(reason);
    reply(response, STATUS[reason], { error: reason }, extra);
  };

  async function handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.url !== UPLINK_PATH) {
      refuse(response, "not-found", { connection: "close" });
      return;
    }
    if (request.method !== "POST") {
      refuse(response, "method", { allow: "POST", connection: "close" });
      return;
    }

    // Exactly one Authorization header, or none: a repeated header is refused
    // rather than resolved to its first value.
    const authorizations = request.headersDistinct.authorization;
    const auth = deps.authenticate(authorizations?.length === 1 ? authorizations[0] : undefined);
    if (!auth.ok) {
      refuse(
        response,
        auth.reason,
        auth.status === 401 ? { "www-authenticate": "Bearer", connection: "close" } : { connection: "close" },
      );
      return;
    }
    const gateway = auth.gateway;

    if (inFlight.has(gateway.id)) {
      refuse(response, "busy", { "retry-after": String(BUSY_RETRY_AFTER_SECONDS), connection: "close" });
      return;
    }
    if (inFlight.size >= maxInFlight) {
      refuse(response, "overloaded", { "retry-after": String(BUSY_RETRY_AFTER_SECONDS), connection: "close" });
      return;
    }
    inFlight.add(gateway.id);
    try {
      if (request.headers["content-encoding"] !== "gzip") {
        refuse(response, "bad-encoding", { connection: "close" });
        return;
      }
      const declared = request.headers["content-length"];
      if (declared !== undefined && Number(declared) > UPLINK_MAX_BODY_BYTES) {
        refuse(response, "too-large", { connection: "close" });
        return;
      }

      const body = await readGzipBody(request);
      if (body.kind === "aborted") {
        return;
      }
      if (body.kind !== "ok") {
        refuse(response, body.kind, { connection: "close" });
        return;
      }
      const json = parseJson(body.bytes);
      if (json === undefined) {
        refuse(response, "bad-json");
        return;
      }
      const parsed = uplinkBatchSchema.safeParse(json.value);
      if (!parsed.success) {
        refuse(response, "bad-schema");
        return;
      }
      const waitS = deps.rateLimit?.take(gateway.id, parsed.data.samples.length) ?? 0;
      if (waitS > 0) {
        refuse(response, "rate-limited", { "retry-after": String(waitS) });
        return;
      }

      let result: UplinkResponse;
      try {
        result = await deps.receive(gateway, parsed.data, auth.digest);
      } catch (error) {
        deps.logger.error("uplink batch write failed", { gatewayId: gateway.id, ...errorKind(error) });
        reply(response, 503, { error: "write-failed" }, { "retry-after": String(WRITE_RETRY_AFTER_SECONDS) });
        return;
      }
      reply(response, 200, result);
    } finally {
      inFlight.delete(gateway.id);
    }
  }

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      deps.logger.error("uplink request failed", errorKind(error));
      if (!response.headersSent) {
        reply(response, 500, { error: "internal" }, { connection: "close" });
      } else {
        response.destroy();
      }
    });
  });
  // A slow client holds a socket, not the host: bound the headers and the body.
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.maxConnections = deps.maxConnections ?? DEFAULT_MAX_CONNECTIONS;

  return new Promise<UplinkServer>((resolve, reject) => {
    const failToBind = (error: Error): void => {
      clearInterval(refusalFlushTimer);
      reject(error);
    };
    server.once("error", failToBind);
    server.listen(port, () => {
      server.removeListener("error", failToBind);
      // After the bind, a listener error is logged, never thrown into the process.
      server.on("error", (error: Error) => {
        deps.logger.error("uplink listener error", errorKind(error));
      });
      const address = server.address();
      let closed: Promise<void> | undefined;
      resolve({
        port: typeof address === "object" && address !== null ? address.port : port,
        close: () => {
          closed ??= new Promise<void>((done) => {
            closing = true;
            clearInterval(refusalFlushTimer);
            flushRefusals();
            const force = setTimeout(() => server.closeAllConnections(), closeGraceMs);
            force.unref();
            server.close(() => {
              clearTimeout(force);
              done();
            });
            server.closeIdleConnections();
          });
          return closed;
        },
      });
    });
  });
}
