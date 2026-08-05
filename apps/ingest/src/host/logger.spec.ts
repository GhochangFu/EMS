import { createHostLogger } from "./logger.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The production JSON-line logger (ADR 0016 §Dependencies).
 *
 * These assertions used to sit in `health-server.spec.ts`, which was the wrong
 * home: this module is the **real** enforcement point for AGENTS.md §9.6.
 * `adapter-contract.spec.ts` proves no adapter *passes* a credential to a
 * logger, but it does so against an injected fake — what the production
 * serialiser does with the fields it is given was exercised by nothing.
 */
export function runHostLoggerTests(): void {
  // ---- one event is one JSON line -----------------------------------------

  {
    const lines: string[] = [];
    const logger = createHostLogger({ deployment: "pilot" }, (line) => lines.push(line));
    logger.info("started", { endpoints: 2 });
    assert(lines.length === 1, "one event is one line");
    assert(lines[0].endsWith("\n"), "JSON lines are newline-terminated");
    assert(lines[0].indexOf("\n") === lines[0].length - 1, "a line contains no embedded newline");

    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    assert(parsed.level === "info", "the level is recorded");
    assert(parsed.message === "started", "the message is recorded");
    assert(parsed.endpoints === 2, "structured fields are merged in");
    assert(parsed.deployment === "pilot", "base fields are merged in");
    assert(parsed.component === "ingest-host", "the component is stamped");
    assert(typeof parsed.time === "string", "the timestamp is present");
    assert(
      !Number.isNaN(Date.parse(String(parsed.time))),
      `the timestamp must be parseable, got "${String(parsed.time)}"`,
    );
  }

  for (const level of ["info", "warn", "error"] as const) {
    const lines: string[] = [];
    const logger = createHostLogger({}, (line) => lines.push(line));
    logger[level]("m");
    assert(
      (JSON.parse(lines[0]) as { level: string }).level === level,
      `${level}() must record level "${level}"`,
    );
  }

  // ---- child loggers -------------------------------------------------------

  {
    const lines: string[] = [];
    const logger = createHostLogger({}, (line) => lines.push(line));
    const child = logger.child({ endpointKey: "phe:8883", protocol: "mqtt" });
    child.warn("restarting", { attempt: 2 });
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    // The binding ADR 0016 §1 describes — "the host binds to { rtuCode,
    // protocol }" — so every adapter line is attributable to an endpoint.
    assert(parsed.endpointKey === "phe:8883", "child fields appear on every line");
    assert(parsed.protocol === "mqtt", "child fields appear on every line");
    assert(parsed.attempt === 2, "per-call fields are merged over child fields");
    assert(parsed.level === "warn", "the child preserves levels");

    logger.info("parent");
    const parentLine = JSON.parse(lines[1]) as Record<string, unknown>;
    assert(parentLine.endpointKey === undefined, "a child must not mutate its parent");
  }

  {
    // A grandchild inherits both generations, and per-call fields still win.
    const lines: string[] = [];
    const logger = createHostLogger({ a: 1 }, (line) => lines.push(line));
    logger.child({ b: 2 }).child({ c: 3 }).error("deep", { c: 4 });
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    assert(parsed.a === 1 && parsed.b === 2, "every generation's fields are inherited");
    assert(parsed.c === 4, "the per-call field wins over an inherited one of the same name");
  }

  {
    // `message` is written last, so a field called `message` cannot displace the
    // event name and leave a line that reads as a different event entirely.
    const lines: string[] = [];
    const logger = createHostLogger({}, (line) => lines.push(line));
    logger.error("real event", { message: "spoofed" });
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    assert(
      parsed.message === "real event",
      `the event name must win over a field named "message", got "${String(parsed.message)}"`,
    );
  }

  // ---- logging is never the thing that breaks ingest ----------------------

  {
    const lines: string[] = [];
    const logger = createHostLogger({}, (line) => lines.push(line));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    logger.error("bad fields", { circular });
    assert(lines.length === 1, "a non-serialisable field still produces a line");
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    assert(parsed.message === "bad fields", "the message survives");
    assert(parsed.level === "error", "the level survives");
    assert(typeof parsed.note === "string", "the omission is stated rather than silent");
  }

  {
    // A BigInt makes `JSON.stringify` throw a TypeError rather than the
    // RangeError a cycle produces — a different failure down the same path.
    const lines: string[] = [];
    const logger = createHostLogger({}, (line) => lines.push(line));
    logger.info("bigint", { size: BigInt(9_007_199_254_740_993n) });
    assert(lines.length === 1, "a BigInt field must not throw out of the logger");
    assert(
      (JSON.parse(lines[0]) as { message: string }).message === "bigint",
      "the fallback line is still valid JSON",
    );
  }

  // ---- §9.6: the caller decides what is logged, and it is all visible ------

  {
    // This module does **not** redact — by design. Redaction that silently
    // half-works is worse than none, because it invites callers to pass secrets
    // believing they are safe. The contract is enforced upstream instead: the
    // conformance suite fails any adapter that hands a credential to a logger,
    // and `bindings.ts` never puts one in a `SkippedBinding`.
    //
    // This assertion pins that decision so nobody adds partial redaction later
    // and calls the problem solved. If real redaction is ever wanted it belongs
    // here, applied to nested values too — which is exactly what this proves is
    // not happening today.
    const lines: string[] = [];
    const logger = createHostLogger({}, (line) => lines.push(line));
    logger.info("connecting", { nested: { auth: { password: "hunter2" } } });
    assert(
      lines[0].includes("hunter2"),
      "the logger does not redact; the gate is that callers never pass secrets " +
        "(asserted by the adapter conformance suite), not that this scrubs them",
    );
  }
}
