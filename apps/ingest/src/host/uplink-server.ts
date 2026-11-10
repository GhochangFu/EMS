import http from "node:http";
import { createGunzip } from "node:zlib";

import {
  UPLINK_MAX_BODY_BYTES,
  UPLINK_MAX_DECODED_BYTES,
  uplinkBatchSchema,
  type UplinkResponse,
} from "@bms/shared/ingest";

import type { HostLogger } from "./logger.js";
import type { ReceiveBatch } from "./uplink-receiver.js";
import type { AuthOutcome } from "./uplink-gateways.js";

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
 * 3. one batch in flight per gateway (429, `Retry-After`);
 * 4. `Content-Encoding: gzip` (400), then the declared `Content-Length`
 *    against the 256 KiB compressed cap (413);
 * 5. a streaming gunzip that aborts past 256 KiB read or 1 MiB decoded (413),
 *    so a gzip bomb stops at the cap rather than at the heap;
 * 6. strict UTF-8 and `JSON.parse`, then `uplinkBatchSchema` (400);
 * 7. the write: `200 { accepted, rejected }` only after commit; a failed write
 *    is `503` with `Retry-After` and the edge keeps the batch (ruling P1 (b)).
 *
 * **Nothing is echoed.** Every refusal body is a fixed `{ "error": <code> }`;
 * no response and no log line carries the body, a parse message, the
 * `Authorization` header or the token (AGENTS.md §9.6). Refusals are logged
 * as one summary line at most once a minute, so an internet scanner cannot
 * turn the log into its megaphone.
 */

export const UPLINK_PATH = "/edge/v1/batches";
/** `Retry-After` on a failed write: the database is the thing down. */
export const WRITE_RETRY_AFTER_SECONDS = 30;
/** `Retry-After` on a second batch while one is in flight. */
export const BUSY_RETRY_AFTER_SECONDS = 5;
/** At most one refusal summary per this many ms. */
export const REFUSAL_LOG_INTERVAL_MS = 60_000;

export type UplinkServerDeps = {
  /** `authenticate` over the current gateway snapshot. */
  readonly authenticate: (header: string | undefined) => AuthOutcome;
  readonly receive: ReceiveBatch;
  readonly logger: HostLogger;
  /** Clock for the refusal-log throttle only. */
  readonly nowMs?: () => number;
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
  "bad-encoding": 400,
  "too-large": 413,
  "bad-gzip": 400,
  "bad-json": 400,
  "bad-schema": 400,
};

const HEADERS = { "content-type": "application/json", "cache-control": "no-store" } as const;

/** Writes one fixed JSON reply. `close` asks the client to drop the connection (unread body). */
function reply(
  response: http.ServerResponse,
  status: number,
  body: unknown,
  extra: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, { ...HEADERS, ...extra });
  response.end(JSON.stringify(body));
}

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
  const inFlight = new Set<string>();
  const refused = new Map<Refusal, number>();
  let lastRefusalLogMs: number | undefined;

  const noteRefusal = (reason: Refusal): void => {
    refused.set(reason, (refused.get(reason) ?? 0) + 1);
    const now = nowMs();
    if (lastRefusalLogMs !== undefined && now - lastRefusalLogMs < REFUSAL_LOG_INTERVAL_MS) {
      return;
    }
    lastRefusalLogMs = now;
    deps.logger.warn("uplink requests refused", Object.fromEntries(refused));
    refused.clear();
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

      let result: UplinkResponse;
      try {
        result = await deps.receive(gateway, parsed.data);
      } catch (error) {
        deps.logger.error("uplink batch write failed", {
          gatewayId: gateway.id,
          reason: error instanceof Error ? error.message : "unknown",
        });
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
      deps.logger.error("uplink request failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
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

  return new Promise<UplinkServer>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve({
        port: typeof address === "object" && address !== null ? address.port : port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeIdleConnections();
          }),
      });
    });
  });
}
