/**
 * E7.2 uplink probe — posts one gzip batch to the cloud receiver
 * (`POST /edge/v1/batches`, ADR 0123 decision 4) and prints the status and the
 * receiver's counts. For step 6 on a stack, beside `fleet-probe.mjs`.
 *
 *   UPLINK_PROBE_TOKEN=bmsgw_… node apps/ingest/scripts/uplink-probe.mjs \
 *     --device RTU-CODE [--source s1] [--value 1] [--count 1] [--age 4h] \
 *     [--url http://127.0.0.1:9110/edge/v1/batches] [--protocol mqtt]
 *
 * `--age` backdates every sample's `rx` (e.g. `90s`, `30m`, `4h`) — a batch
 * older than 2 h sets the gateway's dirty window; one older than 5 min is
 * written and not notified. With `--count N` the samples are 1 s apart,
 * ending at now minus the age, or at `--at <ISO time>` when given. Two runs
 * with the same `--at` send the same `rx` values, so they must leave the same
 * row count: `rx` is the key (decision 8).
 *
 * `--url` must be `https:` unless its host is loopback (`localhost`,
 * `127.x.x.x`, `[::1]`): the token rides in a header, so plain HTTP to any
 * other host would send it in the clear.
 *
 * AGENTS.md §9.6: the token is read from the environment only — never from
 * argv, where `ps` would show it — and is never printed, not even its length.
 * The response body is counts only and is printed as received.
 */
import { gzipSync } from "node:zlib";

const TOKEN_PATTERN = /^bmsgw_[A-Za-z0-9_-]{43}$/;
const MAX_SAMPLES = 500;

function fail(message) {
  process.stderr.write(`uplink-probe: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`expected --name value pairs, got "${key ?? ""}"`);
    }
    out[key.slice(2)] = value;
  }
  return out;
}

/** `90s`, `30m`, `4h`, `2d` or plain milliseconds. */
function parseAge(raw) {
  const m = /^(\d+)(ms|s|m|h|d)?$/.exec(raw);
  if (m === null) fail(`--age must look like 90s, 30m, 4h or 2d, got "${raw}"`);
  const unit = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] ?? "ms"];
  return Number(m[1]) * unit;
}

const args = parseArgs(process.argv.slice(2));
const token = process.env.UPLINK_PROBE_TOKEN ?? "";
if (!TOKEN_PATTERN.test(token)) {
  fail("UPLINK_PROBE_TOKEN is unset or is not a bmsgw_ token (value not shown)");
}
if (args.device === undefined) fail("--device <rtu_code> is required");

const port = process.env.INGEST_UPLINK_PORT ?? "9110";
const url = args.url ?? `http://127.0.0.1:${port}/edge/v1/batches`;
// The token goes in a header, so a plain-HTTP URL sends it in the clear. Only
// a loopback host — the receiver inside the same container or host — may use
// http:; anything else must be https: (security review L5).
let target;
try {
  target = new URL(url);
} catch {
  fail("--url is not a URL");
}
const loopback = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i.test(target.hostname);
if (target.protocol !== "https:" && !(target.protocol === "http:" && loopback)) {
  fail(`--url must be https: unless the host is loopback, got ${target.protocol}//${target.hostname}`);
}
if (target.username !== "" || target.password !== "") {
  fail("--url must not carry credentials");
}
const count = Number(args.count ?? "1");
if (!Number.isInteger(count) || count < 1 || count > MAX_SAMPLES) fail(`--count must be 1..${MAX_SAMPLES}`);
const value = Number(args.value ?? "1");
if (!Number.isFinite(value)) fail("--value must be a finite number");
const end = args.at === undefined ? Date.now() - parseAge(args.age ?? "0") : Date.parse(args.at);
if (!Number.isFinite(end)) fail("--at must be an ISO 8601 time");

const samples = [];
for (let i = count - 1; i >= 0; i -= 1) {
  samples.push({
    protocol: args.protocol ?? "mqtt",
    sourceKey: args.source ?? "s1",
    value,
    deviceKey: args.device,
    rx: new Date(end - i * 1_000).toISOString(),
  });
}
const batch = {
  v: 1,
  sentAt: new Date().toISOString(),
  backlog: Date.now() - end > 10_000,
  buffered: 0,
  clock: "synced",
  samples,
};

const started = Date.now();
const response = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "content-encoding": "gzip",
    authorization: `Bearer ${token}`,
  },
  body: gzipSync(Buffer.from(JSON.stringify(batch))),
  redirect: "error",
  signal: AbortSignal.timeout(20_000),
});
const text = await response.text();
process.stdout.write(
  `${JSON.stringify({
    status: response.status,
    retryAfter: response.headers.get("retry-after"),
    elapsedMs: Date.now() - started,
    samples: samples.length,
    firstRx: samples[0].rx,
    lastRx: samples[samples.length - 1].rx,
    body: text,
  })}\n`,
);
process.exit(response.ok ? 0 : 2);
