import pino from "pino";

import { pinoHttpOptions } from "./logger.options";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const BEARER = "Bearer eyJhbGciOiJIUzI1NiJ9.THIS-IS-THE-SECRET-PART";
const COOKIE = "bms_session=abcdef0123456789";
const SET_COOKIE = "bms_session=deadbeef; HttpOnly";
const API_KEY = "ak_live_NEVER-LOG-THIS-KEY";
const PROXY_AUTH = "Basic cHJveHktU0VDUkVULXZhbHVl";

/** Every secret fixture above, by the assertion message that names it. */
const SECRETS: ReadonlyArray<readonly [string, string]> = [
  ["THIS-IS-THE-SECRET-PART", "the bearer token"],
  ["abcdef0123456789", "the session cookie"],
  ["NEVER-LOG-THIS-KEY", "an x-api-key header"],
  ["cHJveHktU0VDUkVULXZhbHVl", "a proxy-authorization header"],
  ["deadbeef", "a Set-Cookie response header"],
];

/** The request headers a live request carries, secrets and innocents alike. */
const REQ_HEADERS = {
  authorization: BEARER,
  cookie: COOKIE,
  "x-api-key": API_KEY,
  "proxy-authorization": PROXY_AUTH,
  "user-agent": "curl/8.5.0",
  referer: "http://localhost:5173/assets",
};

const REQ = { method: "GET", url: "/api/assets", headers: REQ_HEADERS };
const RES = {
  statusCode: 200,
  headers: { "set-cookie": SET_COOKIE, "content-type": "application/json" },
};

/**
 * Logs one request-shaped object through a pino instance carrying the **real**
 * `redact` configuration from `logger.options.ts`, and returns the line it
 * wrote. `transport` is deliberately not passed: a transport would ship the
 * line to a worker thread and there would be nothing to read back here.
 *
 * `bindReqToChild` selects **how `req` reaches the line**, and the two ways are
 * not interchangeable. `pino-http` does not pass `req` as a call-time property:
 * it binds it once per request with `log.child({ [reqKey]: req })`, and pino
 * pre-serialises child bindings into a cached chindings string. Redaction of a
 * cached binding is a different code path from redaction of a call-time object,
 * so a config that censors one could in principle leave the other intact. Both
 * are asserted; the child case is the one production actually takes.
 */
function logRequestLine(bindReqToChild = false): string {
  const lines: string[] = [];
  const root = pino(
    { redact: pinoHttpOptions.redact },
    {
      write(chunk: string) {
        lines.push(chunk);
      },
    } as NodeJS.WritableStream,
  );

  if (bindReqToChild) {
    root.child({ req: REQ }).info({ res: RES }, "request completed");
  } else {
    root.info({ req: REQ, res: RES }, "request completed");
  }

  assert(lines.length === 1, "expected exactly one log line");
  return lines[0]!;
}

/**
 * `F4.49` — the request logger wrote a live `Authorization: Bearer` token on
 * every authenticated request, and Promtail ships those lines to Loki, where
 * Grafana can search them.
 *
 * **What this proves:** that the `redact` configuration the API ships actually
 * censors the credential-bearing headers, and that it does *not* censor the
 * headers the request log exists to make readable. It runs the real
 * `pinoHttpOptions.redact` through a real pino instance, so a config that
 * looks right but does not censor — a malformed path, a typo in a bracketed
 * key — fails here.
 *
 * **What this cannot prove** (AGENTS.md §4.6, `F4.20`): that `AppModule` still
 * hands this object to `LoggerModule.forRoot`. A Nest module cannot be
 * instantiated under Vitest here — esbuild emits no `design:paramtypes`, so
 * every injected dependency resolves to `undefined`. That seam is held by the
 * static check in `tests/logger-redaction.test.ts`. End-to-end delivery was
 * verified by hand against the running stack; the `F4.49` row in
 * `docs/BACKLOG.md` records which paths were seen censored on the wire and
 * which could not be exercised there. Neither this file nor that static check
 * is the gate for "no credential leaves the container".
 */
export function runLoggerRedactionTests(): void {
  // `false` is a call-time `req`; `true` is the child binding `pino-http`
  // actually uses. Both must censor — see `logRequestLine`.
  for (const viaChild of [false, true]) {
    const how = viaChild ? "bound via logger.child({ req })" : "logged inline";
    const line = logRequestLine(viaChild);

    // The whole point: no part of a live credential survives into the line.
    for (const [secret, what] of SECRETS) {
      assert(
        !line.includes(secret),
        `${what} must not appear in the request log (${how}) — this line leaves the container`,
      );
    }
    assert(
      line.includes("[Redacted]"),
      `redacted headers must be visibly censored rather than silently dropped (${how}), ` +
        "so a reader can tell redaction from absence",
    );

    // The other direction: redaction that ate the whole header bag would cost
    // the operability the request log exists for.
    for (const [survivor, what] of [
      ["curl/8.5.0", "user-agent"],
      ["/api/assets", "the request URL"],
      ["application/json", "non-credential response headers"],
    ] as const) {
      assert(
        line.includes(survivor),
        `${what} must survive redaction (${how}) — over-redaction is its own defect`,
      );
    }
  }

  // Guard the configuration itself, so a future edit that drops a path fails
  // here rather than silently narrowing what is censored. `x-api-key` and
  // `proxy-authorization` redact nothing today — no route reads them — so this
  // is the only thing standing between them and a silent deletion.
  const redact = pinoHttpOptions.redact;
  assert(
    redact !== undefined && !Array.isArray(redact),
    "redact must be the object form, so the censor string is explicit",
  );
  const paths = (redact as { paths: string[] }).paths;
  for (const required of [
    "req.headers.authorization",
    "req.headers.cookie",
    'req.headers["x-api-key"]',
    'req.headers["proxy-authorization"]',
    'res.headers["set-cookie"]',
  ]) {
    assert(
      paths.includes(required),
      `redact.paths must still cover ${required}`,
    );
  }
}
