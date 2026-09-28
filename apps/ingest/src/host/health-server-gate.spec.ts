import http from "node:http";
import net from "node:net";

import {
  refuseHealthRequest,
  startHealthServer,
  type HealthRefusal,
  type HealthServer,
  type HealthSnapshot,
} from "./health-server.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Who may read the health endpoint (`F4.61`, ADR 0016 Amendment 8).
 *
 * Split out of `health-server.spec.ts`, which tests `renderHealth` only and
 * never opens a socket: the pure claims call `refuseHealthRequest` directly,
 * the socket claims drive `startHealthServer` on an ephemeral port, so a gate
 * that is correct but no longer called from the handler still reddens here.
 */

/** The one RTU code a refusal must never leak — the roster is the secret. */
const SENTINEL = "SENTINEL-RTU";

const LOOPBACK = "127.0.0.1:9102";

function fixture(): HealthSnapshot {
  return {
    endpoints: [
      {
        protocol: "mqtt",
        endpointKey: "phe.thinkiot.co.in:8883",
        state: "connected",
        devices: [{ rtuCode: SENTINEL, deviceKey: SENTINEL, lastSampleAt: new Date(), points: [] }],
        restarts: 0,
        consecutivePollFailures: 0,
        queueDepth: 0,
        droppedSamples: 0,
        writeFailures: 0,
        buffered: 0,
        writePath: "ok",
        bufferDropped: 0,
        replayed: 0,
        samplesWritten: 1,
        lastSampleAt: new Date(),
      },
    ],
    skipped: [],
    startedAt: new Date(),
    staleAfterMs: 300_000,
  };
}

function gate(host: string | undefined, method = "GET", url: string | undefined = "/"): HealthRefusal | undefined {
  return refuseHealthRequest({ method, url, host });
}

function statusOf(refusal: HealthRefusal | undefined): number | undefined {
  return refusal?.status;
}

type ProbeResult = {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
};

/**
 * One request over a real socket. `node:http`, not `fetch`: `fetch` drops a
 * caller-set `Host`, and the `Host` is the claim under test. `agent: false`
 * so no pooled keep-alive socket outlives the request and stalls `close()`.
 */
function probe(
  port: number,
  options: { readonly method: string; readonly path: string; readonly host?: string },
): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method,
        path: options.path,
        agent: false,
        headers: options.host === undefined ? {} : { host: options.host },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end();
  });
}

/**
 * Raw bytes over `node:net`, for the requests `http.request` will not send: one
 * with no `Host` at all, and one with two. HTTP/1.0, because Node answers an HTTP/1.1 request
 * without `Host` with a 400 before the handler ever runs.
 */
function rawProbe(port: number, text: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(text);
    });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("close", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    socket.on("error", reject);
  });
}

async function withServer(run: (server: HealthServer) => Promise<void>): Promise<void> {
  const server = await startHealthServer(0, fixture);
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

// ---- pure claims: refuseHealthRequest -------------------------------------

/** Every loopback spelling an operator's `curl` or a later healthcheck sends. */
export function runLoopbackHostAcceptedTests(): void {
  for (const host of [
    "127.0.0.1:9102",
    "127.0.0.1",
    "localhost",
    "localhost:9102",
    "LOCALHOST:9102",
    "[::1]:9102",
    "[::1]",
  ]) {
    assert(gate(host) === undefined, `GET / with Host ${host} is served`);
  }
}

/** A sibling container's service name, and a rebinding page's own name. */
export function runForeignHostRefusedTests(): void {
  for (const host of ["ingest:9102", "evil.example", "localhost.evil.example"]) {
    assert(statusOf(gate(host)) === 421, `Host ${host} is refused 421`);
  }
}

/** The regex is anchored at its end: a loopback prefix is not loopback. */
export function runHostSuffixRefusedTests(): void {
  assert(statusOf(gate("127.0.0.1.evil.example")) === 421, "Host 127.0.0.1.evil.example is refused 421");
}

/** The regex is anchored at its start: a loopback suffix is not loopback. */
export function runHostPrefixRefusedTests(): void {
  assert(statusOf(gate("evil.127.0.0.1")) === 421, "Host evil.127.0.0.1 is refused 421");
}

/** No `Host` proves nothing about who asked, so it is refused too. */
export function runMissingHostRefusedTests(): void {
  assert(statusOf(gate(undefined)) === 421, "a missing Host is refused 421");
  assert(statusOf(gate("")) === 421, "an empty Host is refused 421");
}

/** Every method but `GET` is refused, and the refusal names the one it takes. */
export function runMethodRefusedTests(): void {
  for (const method of ["POST", "PUT", "DELETE", "HEAD", "OPTIONS"]) {
    assert(statusOf(gate(LOOPBACK, method)) === 405, `${method} / is refused 405`);
  }
  for (const method of ["POST", "PUT", "DELETE", "HEAD", "OPTIONS"]) {
    assert(gate(LOOPBACK, method)?.headers["allow"] === "GET", `a 405 on ${method} carries Allow: GET`);
  }
}

/** Exact paths: a query string or a trailing slash is a different path. */
export function runPathRefusedTests(): void {
  for (const url of ["/x", "/health/", "/?x=1", "//", undefined]) {
    // Called directly: `gate()`'s default would turn `undefined` into `/`.
    const refusal = refuseHealthRequest({ method: "GET", url, host: LOOPBACK });
    assert(statusOf(refusal) === 404, `GET ${String(url)} is refused 404`);
  }
  assert(gate(LOOPBACK, "GET", "/health") === undefined, "GET /health is served");
}

/** Host first, so the rebinding defence fires whatever else is wrong. */
export function runRefusalOrderTests(): void {
  assert(statusOf(gate("evil.example", "POST", "/x")) === 421, "bad host, bad method, bad path is 421");
  assert(statusOf(gate(LOOPBACK, "POST", "/x")) === 405, "good host, bad method, bad path is 405");
}

/** One fixed line that a liveness check matching `ingest-host` cannot pass on. */
export function runRefusalBodyTests(): void {
  const refusals: ReadonlyArray<readonly [string, HealthRefusal | undefined]> = [
    ["host", gate("evil.example")],
    ["method", gate(LOOPBACK, "POST")],
    ["path", gate(LOOPBACK, "GET", "/evil.example")],
  ];
  for (const [name, refusal] of refusals) {
    assert(refusal !== undefined, `the ${name} case is refused`);
    const body = refusal?.body ?? "";
    assert(body.endsWith("\n"), `the ${name} refusal body ends with a newline`);
    assert(body.indexOf("\n") === body.length - 1, `the ${name} refusal body is one line: ${JSON.stringify(body)}`);
    assert(!body.startsWith("ingest-host"), `the ${name} refusal body does not start ingest-host`);
    assert(!body.includes("evil.example"), `the ${name} refusal body does not echo what it refused`);
  }
}

// ---- socket claims: startHealthServer --------------------------------------

/** `startHealthServer(0, …)` reports the port the OS bound, not the 0 it was given. */
export async function runBoundPortTests(): Promise<void> {
  await withServer(async (server) => {
    assert(server.port > 0, `the bound port is reported, got ${server.port}`);
    const response = await probe(server.port, { method: "GET", path: "/", host: LOOPBACK });
    assert(response.status === 200, `GET / on the reported port answers 200, got ${response.status}`);
  });
}

/** The operator's in-container `wget 127.0.0.1:9102` and ADR 0075's `/health` still work. */
export async function runServedRequestTests(): Promise<void> {
  await withServer(async (server) => {
    const root = await probe(server.port, { method: "GET", path: "/", host: LOOPBACK });
    assert(root.status === 200, `GET / answers 200, got ${root.status}`);
    assert(root.headers["content-type"] === "text/plain", "GET / is text/plain");
    assert(root.body.startsWith("ingest-host ok "), `GET / serves the health body:\n${root.body}`);
    const health = await probe(server.port, { method: "GET", path: "/health", host: "localhost:9102" });
    assert(health.status === 200, `GET /health answers 200, got ${health.status}`);
  });
}

/** The sibling-container read the finding named: `GET http://ingest:9102/`. */
export async function runForeignHostOverSocketTests(): Promise<void> {
  await withServer(async (server) => {
    const response = await probe(server.port, { method: "GET", path: "/", host: "ingest:9102" });
    assert(response.status === 421, `Host ingest:9102 is refused 421, got ${response.status}`);
    assert(response.body === "refused: host\n", `the body is exactly the refusal: ${JSON.stringify(response.body)}`);
    assert(!response.body.includes(SENTINEL), "a refusal never carries the roster");
  });
}

/** The method refusal as the handler writes it: the status and the `Allow` header. */
export async function runMethodOverSocketTests(): Promise<void> {
  await withServer(async (server) => {
    const response = await probe(server.port, { method: "POST", path: "/", host: LOOPBACK });
    assert(response.status === 405, `POST / is refused 405, got ${response.status}`);
    assert(response.headers["allow"] === "GET", `a 405 carries Allow: GET, got ${String(response.headers["allow"])}`);
  });
}

/** The path refusal as the handler writes it: the status and the exact body. */
export async function runPathOverSocketTests(): Promise<void> {
  await withServer(async (server) => {
    const response = await probe(server.port, { method: "GET", path: "/nope", host: LOOPBACK });
    assert(response.status === 404, `GET /nope is refused 404, got ${response.status}`);
    assert(response.body === "refused: path\n", `the body is exactly the refusal: ${JSON.stringify(response.body)}`);
  });
}

/** An HTTP/1.0 request with no `Host` reaches the handler, and is refused. */
export async function runNoHostHeaderTests(): Promise<void> {
  await withServer(async (server) => {
    const reply = await rawProbe(server.port, "GET / HTTP/1.0\r\n\r\n");
    assert(reply.startsWith("HTTP/1.1 421"), `no Host is refused 421: ${JSON.stringify(reply.split("\r\n")[0])}`);
    assert(!reply.includes(SENTINEL), "a refusal never carries the roster");
  });
}

/**
 * Two `Host` headers are refused in either order. `request.headers.host` keeps
 * the first, so without the handler's count a loopback first value would carry
 * a foreign second one through (ADR 0016 Amendment 8, RFC 9112).
 */
export async function runRepeatedHostHeaderTests(): Promise<void> {
  await withServer(async (server) => {
    for (const [first, second] of [
      [LOOPBACK, "evil.example"],
      ["evil.example", LOOPBACK],
    ] as const) {
      const reply = await rawProbe(
        server.port,
        `GET / HTTP/1.1\r\nHost: ${first}\r\nHost: ${second}\r\nConnection: close\r\n\r\n`,
      );
      assert(
        reply.startsWith("HTTP/1.1 421"),
        `Host ${first} then ${second} is refused 421: ${JSON.stringify(reply.split("\r\n")[0])}`,
      );
      assert(!reply.includes(SENTINEL), "a refusal never carries the roster");
    }
  });
}
