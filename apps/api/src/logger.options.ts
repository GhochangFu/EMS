import type { Options } from "pino-http";

/**
 * The API's only logger configuration (`F4.49`).
 *
 * Extracted out of `app.module.ts` so `redact` below can be asserted against
 * the object the module actually passes to `LoggerModule.forRoot`, rather than
 * by matching the text of a source file. A source-text check would pass on a
 * commented-out block; this one cannot.
 *
 * **`redact` is the reason this file exists.** `pino-http` installs
 * `pino-std-serializers`, whose `req` serializer copies the header bag verbatim
 * (`_req.headers = req.headers`), and `nestjs-pino` binds its middleware to
 * every route rather than a subset — so without this, a live
 * `Authorization: Bearer` token was written on every authenticated request.
 * Those lines do not stay in the container: Promtail scrapes all containers via
 * `docker_sd_configs` into Loki, which retains them in the `bms-loki-data`
 * volume, reachable through Grafana. That pipeline is what made this a P0
 * rather than a cosmetic log-hygiene fix. AGENTS.md §9 rule 6.
 *
 * Redact only the credential-bearing headers. `user-agent`, `referer` and the
 * rest stay readable — over-redaction costs the operability the request log
 * exists for, and the suite checks both directions.
 *
 * `authorization` and `cookie` are the observed defect. `x-api-key` and
 * `proxy-authorization` are defence in depth: no route reads either today
 * (`jwt-auth.guard.ts` reads `authorization` only), so they redact nothing at
 * present — they are here so that the day one is introduced, it is already
 * censored rather than one review away from a second F4.49.
 *
 * **Query strings are a deliberate boundary.** `req.url` and `req.query` are
 * left readable: no `@Query` parameter in this API carries a credential, and
 * the WebSocket token travels in the engine.io handshake body rather than the
 * URL. If a credential ever moves into a query parameter, this is the line
 * that has to change with it.
 */
export const pinoHttpOptions: Options = {
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: { colorize: true, singleLine: true },
        }
      : undefined,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-api-key"]',
      'req.headers["proxy-authorization"]',
      'res.headers["set-cookie"]',
    ],
    censor: "[Redacted]",
  },
};
