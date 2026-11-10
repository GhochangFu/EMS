import { randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { gzipSync } from "node:zlib";

import {
  UPLINK_MAX_BODY_BYTES,
  UPLINK_MAX_DECODED_BYTES,
  type UplinkBatch,
  type UplinkResponse,
} from "@bms/shared/ingest";

import { createHostLogger } from "./logger.js";
import { assert } from "./normaliser.spec.js";
import { authenticate, type GatewayRecord } from "./uplink-gateways.js";
import { gateway, TOKEN_A, TOKEN_B } from "./uplink-gateways.spec.js";
import { hashToken } from "./uplink-gateways.js";
import { startUplinkServer, UPLINK_PATH } from "./uplink-server.js";

/**
 * `E7.2` / ADR 0123 decision 4, plan T3.5 — the uplink listener on a real
 * `node:http` server bound to port 0.
 *
 * Assertions live here; `uplink-server.test.ts` is the vitest entry point
 * (ADR 0014). Each exported function starts its own server, collects every
 * log line it writes, and closes it — and every one ends by asserting that
 * no log line holds a token, so the §9.6 rule is checked on every path the
 * suite drives, not on one.
 */

const GW_A = gateway();
const GW_B = gateway({ id: "33333333-3333-4333-8333-333333333333", code: "GW-B", tokenHash: hashToken(TOKEN_B) });
const OK: UplinkResponse = { accepted: 1, rejected: { foreignDevice: 0, futureRx: 0, tooOld: 0, unresolved: 0 } };

/** A marker that must never come back in a response or a log line. */
const MARKER = "ECHO-MARKER-7f3a";

function goodBatch(): UplinkBatch {
  return {
    v: 1,
    sentAt: "2026-11-10T09:00:00.000Z",
    backlog: false,
    buffered: 0,
    clock: "synced",
    samples: [
      { protocol: "mqtt", sourceKey: "kw", value: 1, deviceKey: "RTU-1", rx: "2026-11-10T08:59:59.000Z" },
    ],
  };
}

const gz = (value: unknown): Buffer => gzipSync(Buffer.from(typeof value === "string" ? value : JSON.stringify(value)));

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };

type Request = {
  method?: string;
  path?: string;
  token?: string | null;
  headers?: Record<string, string>;
  body?: Buffer;
  /** Send without Content-Length (chunked). */
  chunked?: boolean;
};

/** One request; resolves on the response even if the server closes while the body is still going. */
function send(port: number, req: Request): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const body = req.body ?? gz(goodBatch());
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "content-encoding": "gzip",
      ...(req.chunked === true ? {} : { "content-length": String(body.length) }),
      ...(req.token === null ? {} : { authorization: `Bearer ${req.token ?? TOKEN_A}` }),
      ...req.headers,
    };
    let answered = false;
    const request = http.request(
      { host: "127.0.0.1", port, method: req.method ?? "POST", path: req.path ?? UPLINK_PATH, headers },
      (response) => {
        answered = true;
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(c));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    request.on("error", (error) => {
      if (!answered) reject(error);
    });
    if (req.chunked === true) {
      for (let i = 0; i < body.length; i += 16_384) {
        request.write(body.subarray(i, i + 16_384));
      }
      request.end();
    } else {
      request.end(body);
    }
  });
}

/** The status code of one hand-written request — for what `http.request` will not send. */
function rawStatus(port: number, text: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(text));
    let received = "";
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString();
    });
    socket.on("end", () => resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(received)?.[1] ?? 0)));
    socket.on("error", reject);
  });
}

type Harness = {
  port: number;
  lines: string[];
  receives: GatewayRecord[];
  authCalls: number;
  close(): Promise<void>;
};

async function withServer(
  receive: (gw: GatewayRecord, batch: UplinkBatch) => Promise<UplinkResponse>,
  body: (h: Harness) => Promise<void>,
  gateways: readonly GatewayRecord[] = [GW_A, GW_B],
): Promise<void> {
  const lines: string[] = [];
  const receives: GatewayRecord[] = [];
  const h = { lines, receives, authCalls: 0 } as Omit<Harness, "port" | "close"> & { authCalls: number };
  const server = await startUplinkServer(0, {
    authenticate: (header) => {
      h.authCalls += 1;
      return authenticate({ gateways }, header);
    },
    receive: async (gw, batch) => {
      receives.push(gw);
      return receive(gw, batch);
    },
    logger: createHostLogger({}, (line) => lines.push(line)),
    // Every refusal logs: the throttle is its own case.
    nowMs: (() => {
      let t = 0;
      return () => (t += 120_000);
    })(),
  });
  try {
    await body({ ...h, port: server.port, close: () => server.close() } as Harness);
  } finally {
    await server.close();
  }
  for (const line of lines) {
    assert(!line.includes(TOKEN_A) && !line.includes(TOKEN_B), `a log line holds a token: ${line}`);
    assert(!line.includes(MARKER), `a log line echoes body content: ${line}`);
  }
}

const accept = async (): Promise<UplinkResponse> => OK;

function expectError(reply: Reply, status: number, code: string, label: string): void {
  assert(reply.status === status, `${label}: status must be ${status}, got ${reply.status}`);
  assert(reply.body === JSON.stringify({ error: code }), `${label}: body must be the fixed {error:${code}}, got ${reply.body}`);
  assert(!reply.body.includes(MARKER) && !reply.body.includes(TOKEN_A), `${label}: the body echoes input`);
}

/** A good batch is 200 with the receiver's body, `no-store`. */
export async function aGoodBatchIs200(): Promise<void> {
  await withServer(accept, async (h) => {
    const reply = await send(h.port, {});
    assert(reply.status === 200, `status ${reply.status}`);
    assert(reply.body === JSON.stringify(OK), `body ${reply.body}`);
    assert(reply.headers["cache-control"] === "no-store", "cache-control must be no-store");
    assert(h.receives.length === 1 && h.receives[0].id === GW_A.id, "the batch is received for the token's gateway");
  });
}

/** Any other path is 404; the path is exact. */
export async function otherPathsAre404(): Promise<void> {
  await withServer(accept, async (h) => {
    for (const path of ["/", "/edge/v1/batches/", `${UPLINK_PATH}?x=1`, "/edge/v2/batches", "/health"]) {
      expectError(await send(h.port, { path }), 404, "not-found", path);
    }
    assert(h.authCalls === 0, "a wrong path is refused before auth");
  });
}

/** GET and other methods are 405 with `Allow: POST`. */
export async function otherMethodsAre405(): Promise<void> {
  await withServer(accept, async (h) => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const reply = await send(h.port, { method, body: Buffer.alloc(0) });
      expectError(reply, 405, "method", method);
      assert(reply.headers.allow === "POST", `${method}: Allow must be POST`);
    }
  });
}

/** A bad token is 401 **before** the body is read: an over-size body still gets 401, not 413. */
export async function aBadTokenIs401BeforeTheBody(): Promise<void> {
  await withServer(accept, async (h) => {
    const oversize = randomBytes(UPLINK_MAX_BODY_BYTES + 50_000);
    const bad = await send(h.port, { token: `bmsgw_${"z".repeat(43)}`, body: oversize });
    expectError(bad, 401, "unauthorized", "bad token, oversize body");
    assert(bad.headers["www-authenticate"] === "Bearer", "401 carries WWW-Authenticate: Bearer");
    const none = await send(h.port, { token: null, body: oversize, chunked: true });
    expectError(none, 401, "unauthorized", "no token, chunked oversize body");
    const twice = await rawStatus(
      h.port,
      `POST ${UPLINK_PATH} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${TOKEN_A}\r\n` +
        `Authorization: Bearer ${TOKEN_A}\r\nContent-Encoding: gzip\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
    );
    assert(twice === 401, `a repeated Authorization header must be refused 401, got ${twice}`);
    assert(h.receives.length === 0, "nothing was received");
  });
}

/** A revoked gateway's token is 403 `gateway-revoked`; a switched-off organization is 403 `ingest-disabled`. */
export async function revokedAndDisabledAre403(): Promise<void> {
  await withServer(
    accept,
    async (h) => {
      expectError(await send(h.port, { token: TOKEN_A }), 403, "gateway-revoked", "revoked");
      expectError(await send(h.port, { token: TOKEN_B }), 403, "ingest-disabled", "organization off");
      assert(h.receives.length === 0, "nothing was received");
    },
    [gateway({ status: "revoked" }), { ...GW_B, organizationIngestEnabled: false }],
  );
}

/** A declared `Content-Length` over the cap is 413 without reading the body. */
export async function aDeclaredOversizeBodyIs413(): Promise<void> {
  await withServer(accept, async (h) => {
    const reply = await send(h.port, { body: randomBytes(UPLINK_MAX_BODY_BYTES + 1) });
    expectError(reply, 413, "too-large", "declared over cap");
    const chunked = await send(h.port, { body: randomBytes(UPLINK_MAX_BODY_BYTES + 20_000), chunked: true });
    expectError(chunked, 413, "too-large", "streamed over cap");
    assert(h.receives.length === 0, "nothing was received");
  });
}

/** A gzip that decodes past 1 MiB is 413, and the listener still serves the next request. */
export async function aGzipBombIs413AndTheProcessLives(): Promise<void> {
  await withServer(accept, async (h) => {
    const bomb = gzipSync(Buffer.alloc(UPLINK_MAX_DECODED_BYTES * 8, 0x20));
    assert(bomb.length < UPLINK_MAX_BODY_BYTES, "the bomb fits under the compressed cap");
    expectError(await send(h.port, { body: bomb }), 413, "too-large", "gzip bomb");
    const after = await send(h.port, {});
    assert(after.status === 200, `the next good batch must still be 200, got ${after.status}`);
  });
}

/** Not gzip, bad gzip, bad JSON and a bad schema are 400 with a fixed body and no echo. */
export async function badBodiesAre400WithNoEcho(): Promise<void> {
  await withServer(accept, async (h) => {
    const raw = Buffer.from(JSON.stringify({ ...goodBatch(), note: MARKER }));
    expectError(await send(h.port, { body: raw, headers: { "content-encoding": "identity" } }), 400, "bad-encoding", "identity");
    expectError(await send(h.port, { body: raw }), 400, "bad-gzip", "not gzip");
    expectError(await send(h.port, { body: Buffer.alloc(0) }), 400, "bad-gzip", "empty body");
    expectError(await send(h.port, { body: gz(`{"v":1,"x":"${MARKER}"`) }), 400, "bad-json", "truncated JSON");
    expectError(await send(h.port, { body: gzipSync(Buffer.from([0x7b, 0xff, 0xfe, 0x7d])) }), 400, "bad-json", "bad UTF-8");
    expectError(await send(h.port, { body: gz({ ...goodBatch(), v: 2, note: MARKER }) }), 400, "bad-schema", "v: 2");
    expectError(
      await send(h.port, { body: gz({ ...goodBatch(), samples: [{ sourceKey: MARKER }] }) }),
      400,
      "bad-schema",
      "bad sample",
    );
    assert(h.receives.length === 0, "nothing was received");
  });
}

/** A failed write is 503 with `Retry-After`; the log names the gateway, not the batch. */
export async function aFailedWriteIs503WithRetryAfter(): Promise<void> {
  await withServer(
    async () => {
      throw new Error("connection terminated");
    },
    async (h) => {
      const reply = await send(h.port, { body: gz({ ...goodBatch(), samples: [{ ...goodBatch().samples[0], sourceKey: MARKER }] }) });
      expectError(reply, 503, "write-failed", "write failure");
      assert(Number(reply.headers["retry-after"]) > 0, "503 must carry Retry-After");
      assert(h.lines.some((l) => l.includes("uplink batch write failed") && l.includes(GW_A.id)), "the failure is logged");
    },
  );
}

/** A second batch for the same gateway while one is in flight is 429; another gateway is not held up. */
export async function aSecondBatchInFlightIs429(): Promise<void> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await withServer(
    async (gw) => {
      if (gw.id === GW_A.id) await gate;
      return OK;
    },
    async (h) => {
      const first = send(h.port, { token: TOKEN_A });
      while (h.receives.length === 0) {
        await new Promise((r) => setTimeout(r, 5));
      }
      const second = await send(h.port, { token: TOKEN_A });
      expectError(second, 429, "busy", "second in flight");
      assert(Number(second.headers["retry-after"]) > 0, "429 must carry Retry-After");
      const other = await send(h.port, { token: TOKEN_B });
      assert(other.status === 200, `another gateway must not be held up, got ${other.status}`);
      release();
      assert((await first).status === 200, "the first batch completes");
      const third = await send(h.port, { token: TOKEN_A });
      assert(third.status === 200, `after the first completes the gateway may post again, got ${third.status}`);
    },
  );
}

/** Refusals are summarised at most once a minute, with counts and no input. */
export async function refusalsAreThrottled(): Promise<void> {
  const lines: string[] = [];
  let now = 0;
  const server = await startUplinkServer(0, {
    authenticate: (header) => authenticate({ gateways: [GW_A] }, header),
    receive: accept,
    logger: createHostLogger({}, (line) => lines.push(line)),
    nowMs: () => now,
  });
  try {
    for (let i = 0; i < 5; i += 1) {
      await send(server.port, { token: `bmsgw_${"q".repeat(43)}` });
    }
    assert(lines.length === 1, `five refusals inside a minute must log once, got ${lines.length}`);
    now = 60_000;
    await send(server.port, { path: "/nope" });
    assert(lines.length === 2, "the next refusal after a minute logs the summary");
    const summary = JSON.parse(lines[1]) as Record<string, unknown>;
    assert(summary.unauthorized === 4 && summary["not-found"] === 1, `summary counts ${lines[1]}`);
  } finally {
    await server.close();
  }
}

/** A port already taken rejects rather than throwing asynchronously. */
export async function aTakenPortRejects(): Promise<void> {
  const first = await startUplinkServer(0, {
    authenticate: () => ({ ok: false, status: 401, reason: "unauthorized" }),
    receive: accept,
    logger: createHostLogger({}, () => undefined),
  });
  try {
    let rejected = false;
    try {
      const second = await startUplinkServer(first.port, {
        authenticate: () => ({ ok: false, status: 401, reason: "unauthorized" }),
        receive: accept,
        logger: createHostLogger({}, () => undefined),
      });
      await second.close();
    } catch {
      rejected = true;
    }
    assert(rejected, "binding a taken port must reject");
  } finally {
    await first.close();
  }
}
