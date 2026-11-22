/**
 * Modbus TCP demo device for the local stack (`F1.2`, ADR 0141 decision 20,
 * plan PR 8 / C13). Serves every stock device profile
 * (`packages/shared/src/device-profiles/modbus/*.json`) as one unit id each,
 * with slowly varying, plausible values, so an RTU bound to a stock profile
 * shows Modbus end to end with no hardware.
 *
 * **Socket plumbing only.** Framing, the server half and the value encoding
 * are the shared codec's — `createMbapFrameAssembler`, `serveModbusFrame`
 * (function codes 01–04; every other code, the write codes included, gets
 * exception 01) and `encodeRegisterValue` — the same code the adapter's
 * in-process test server runs in CI. `apps/sim` is not a Vitest project (plan
 * M14), so this file holds no logic CI would need to see: the value curve
 * below is cosmetic.
 *
 * **Unit ids.** Unit `n` serves the `n`-th entry of `STOCK_MODBUS_PROFILES`,
 * in the order of `device-profiles/modbus/index.ts` (append-only), and the
 * start-up log prints the table. `docs/local-setup.md` lists today's.
 *
 * **No database, one listener.** Compose runs this under the `modbus` profile
 * on the `modbus-sim` network only, with no port published and no
 * `DATABASE_URL` (ADR 0016 Amendment 10 (b));
 * `tests/f4.61-ingest-network-isolation.test.ts` holds that, and that this
 * file binds exactly one listener.
 *
 * Environment: `MODBUS_SIM_HOST` (default `127.0.0.1`; compose sets
 * `0.0.0.0`), `MODBUS_SIM_PORT` (default 1502; compose sets 502),
 * `MODBUS_SIM_STEP_MS` (how often values move, default 1000, at least 100).
 * A port or step that is not a finite number refuses the start.
 *
 * **Connection limits.** At most `MAX_CONNECTIONS` sockets (the ingest host
 * holds one per endpoint; the rest is room for a hand-run Modbus tool). A
 * socket idle for `IDLE_TIMEOUT_MS` is closed: one minute past the longest
 * poll interval (ADR 0141 decision 10's 3,600,000 ms bound), so a poller at
 * any legal interval is never dropped between polls. A client that does not
 * read its replies stalls its own socket (the read side pauses until the
 * write side drains) rather than growing this process's memory.
 */
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { MODBUS_TYPE_WORDS, createMbapFrameAssembler, encodeRegisterValue, serveModbusFrame } =
  require("@bms/shared/ingest");

// **Temporary.** `STOCK_MODBUS_PROFILES` is built into `@bms/shared`'s `dist/`
// but `./ingest` does not re-export it yet; plan PR 5 adds that re-export to
// `packages/shared/src/ingest.ts`. Until it lands, the module is loaded by
// file path beside the resolved `./ingest` entry (a file path, unlike a bare
// specifier, is not bound by the `exports` map). Replace this with the named
// import from `@bms/shared/ingest` once PR 5 is on the branch.
const { STOCK_MODBUS_PROFILES } = require(
  join(dirname(require.resolve("@bms/shared/ingest")), "device-profiles", "modbus", "index.js"),
);

const host = process.env.MODBUS_SIM_HOST || "127.0.0.1";
const port = Number(process.env.MODBUS_SIM_PORT || "1502");
const stepRaw = Number(process.env.MODBUS_SIM_STEP_MS || "1000");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`MODBUS_SIM_PORT must be 1-65535, got ${process.env.MODBUS_SIM_PORT}`);
}
if (!Number.isFinite(stepRaw)) {
  throw new Error(`MODBUS_SIM_STEP_MS must be a number of milliseconds, got ${process.env.MODBUS_SIM_STEP_MS}`);
}
const stepMs = Math.max(100, stepRaw);

const MAX_CONNECTIONS = 8;
const IDLE_TIMEOUT_MS = 3_660_000;
/**
 * The curves run on wall-clock time from a fixed epoch, not from process
 * start, so a restart neither jumps the waves back nor lowers a counter.
 */
const EPOCH_MS = Date.UTC(2026, 0, 1);

/** Unit id → { profile, image }. */
const units = new Map(
  STOCK_MODBUS_PROFILES.map((profile, index) => [
    index + 1,
    { profile, image: { coil: new Map(), discrete: new Map(), holding: new Map(), input: new Map() } },
  ]),
);

/**
 * A plausible engineering value for a register, by its `sourceKey` and unit,
 * moving on a slow sine. Counters (`*_total`) grow at 25 per hour from the
 * epoch, so they only grow, across restarts too.
 */
function curve(register, seconds, phase) {
  const key = register.sourceKey;
  const wave = (mean, amplitude, periodS) => mean + amplitude * Math.sin((2 * Math.PI * seconds) / periodS + phase);
  if (/_total$/.test(key)) return 12_000 + seconds * (25 / 3600) + Math.sin(phase) * 500;
  if (/^voltage_v[ryb]n$/.test(key)) return wave(231, 3, 420);
  if (/^voltage_/.test(key)) return wave(400, 5, 420);
  if (key === "current_in") return wave(2, 1, 300);
  if (/^current_/.test(key)) return wave(40, 8, 300);
  if (key === "frequency_hz") return wave(50, 0.05, 90);
  if (key === "pf") return wave(0.93, 0.03, 600);
  if (key === "kw") return wave(25, 5, 300);
  if (key === "kva") return wave(27, 5, 300);
  if (key === "kvar") return wave(8, 2, 300);
  if (register.type === "bool") return Math.sin((2 * Math.PI * seconds) / 600 + phase) > 0 ? 1 : 0;
  return wave(100, 10, 300);
}

function refresh(seconds) {
  for (const { profile, image } of units.values()) {
    profile.registers.forEach((register, index) => {
      const value = curve(register, seconds, index * 0.7);
      if (register.table === "coil" || register.table === "discrete") {
        image[register.table].set(register.address, value !== 0);
        return;
      }
      let words;
      try {
        words = encodeRegisterValue(value, register);
      } catch {
        // A value the register's type cannot hold: serve zero words, built
        // here so this path cannot throw.
        words = new Array(MODBUS_TYPE_WORDS[register.type]).fill(0);
      }
      words.forEach((word, i) => image[register.table].set(register.address + i, word));
    });
  }
}

const now = () => (Date.now() - EPOCH_MS) / 1000;
refresh(now());
setInterval(() => refresh(now()), stepMs).unref();

const server = createServer((socket) => {
  socket.on("error", () => undefined);
  socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy());
  socket.on("drain", () => socket.resume());
  const assembler = createMbapFrameAssembler();
  socket.on("data", (chunk) => {
    let frames;
    try {
      frames = assembler.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    } catch {
      socket.destroy();
      return;
    }
    for (const frame of frames) {
      // An unknown unit id gets an empty image, so exception 02 — what a
      // gateway answers for a unit that is not there.
      const unit = units.get(frame[6]);
      const reply = serveModbusFrame(frame, unit === undefined ? {} : unit.image);
      // Backpressure: stop reading until the client takes what was written.
      if (reply !== null && !socket.write(reply)) socket.pause();
    }
  });
});
server.maxConnections = MAX_CONNECTIONS;

server.listen(port, host, () => {
  process.stdout.write(`[modbus-sim] listening on ${host}:${port}\n`);
  for (const [unitId, { profile }] of units) {
    process.stdout.write(
      `[modbus-sim] unit ${unitId}: ${profile.code} v${profile.version} (${profile.vendor} ${profile.model}, ${profile.registers.length} registers)\n`,
    );
  }
});

// A poller holds its socket open, so `server.close()` alone would wait for
// it; nothing here needs flushing, so stop at once.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => process.exit(0));
}
