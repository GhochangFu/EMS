import {
  readQueueConfig,
  readWorkerConfig,
  redisOptionsFromUrl,
  QueueConfigError,
} from "./queue-config";

/**
 * F4.24 (ADR 0063 decisions 4, 9) — the two configuration readers.
 *
 * Assertions live here; `queue-config.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). One `it()` per row of plan §5's table; the two
 * table-driven rows are exported as per-input functions so the wrapper can
 * run them through `it.each` — a loop inside one `it()` would let the first
 * failing input hide the rest.
 *
 * **The "expected to throw" sentinel lives outside the `try`** (the
 * 2026-09-11 review, Blocker B). The first version threw it *inside* the
 * `try`, where the same `catch` caught it — and because its text named the
 * variable under test, the four `INVALID_WORKER_PORTS` rows stayed green
 * with `readWorkerPort` reduced to `return Number(raw.trim())`: 18/18
 * passing against a guard that refused nothing. `captureThrow` is the
 * `captureRejection` shape from `queue-registry.spec.ts`, synchronous.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Captures a throw. A call that returns fails here, with this message, never inside a `catch`. */
function captureThrow(run: () => unknown): unknown {
  let threw = false;
  let caught: unknown;
  try {
    run();
  } catch (err) {
    threw = true;
    caught = err;
  }
  assert(threw, "expected the call to throw, and it returned");
  return caught;
}

function errorName(err: unknown): string | undefined {
  return typeof err === "object" && err !== null
    ? (err as { name?: unknown }).name?.toString()
    : undefined;
}

function errorMessage(err: unknown): string {
  return typeof err === "object" && err !== null
    ? String((err as { message?: unknown }).message)
    : String(err);
}

export function assertUnsetRedisUrlIsUnconfigured(): void {
  assert(
    readQueueConfig({}).redis === null,
    "an absent REDIS_URL must read as unconfigured (redis: null)",
  );
}

export function assertBlankRedisUrlIsUnconfigured(): void {
  assert(
    readQueueConfig({ REDIS_URL: " " }).redis === null,
    "a whitespace-only REDIS_URL must read as unconfigured, matching the Socket.IO adapter's rule",
  );
}

export function assertMinimalUrlParsesToHostAndPortOnly(): void {
  const parsed = redisOptionsFromUrl("redis://redis:6379");
  const expected = { host: "redis", port: 6379 };
  assert(
    JSON.stringify(parsed) === JSON.stringify(expected),
    `expected exactly ${JSON.stringify(expected)}, got ${JSON.stringify(parsed)} — a spurious db/tls key must not appear`,
  );
}

export function assertCredentialsAndDbAreParsed(): void {
  const parsed = redisOptionsFromUrl("redis://:s3cret@cache:6380/2");
  const expected = { host: "cache", port: 6380, password: "s3cret", db: 2 };
  assert(
    JSON.stringify(parsed) === JSON.stringify(expected),
    `expected exactly ${JSON.stringify(expected)}, got ${JSON.stringify(parsed)}`,
  );
}

export function assertRedissSchemeMapsToTlsAndDefaultPort(): void {
  const parsed = redisOptionsFromUrl("rediss://cache");
  assert(parsed.port === 6379, `expected default port 6379, got ${parsed.port}`);
  assert(
    parsed.tls !== undefined && JSON.stringify(parsed.tls) === "{}",
    `expected tls: {} for the rediss:// scheme, got ${JSON.stringify(parsed.tls)}`,
  );
}

/**
 * One row per guard in `redisOptionsFromUrl`, each with the message that
 * guard — and only that guard — throws (the review, C). `redis://` parses
 * under WHATWG rules with an empty host; a lone `%` in the password survives
 * `new URL` and fails `decodeURIComponent`. The two credential rows are the
 * ones that test "the value never appears in the message" for real.
 */
export const INVALID_URL_ROWS = [
  { raw: "http://x", message: "REDIS_URL must use the redis or rediss scheme" },
  { raw: "redis://", message: "REDIS_URL must name a host" },
  { raw: "redis://h/abc", message: "REDIS_URL path must be a numeric database index" },
  { raw: "not a url", message: "REDIS_URL is not a valid URL" },
  { raw: "redis://:s3cret@cache/abc", message: "REDIS_URL path must be a numeric database index" },
  { raw: "redis://:pa%ss@cache", message: "REDIS_URL credentials carry a malformed percent-escape" },
] as const;

export function assertInvalidUrlThrowsItsOwnMessageWithoutEchoingTheValue(row: {
  raw: string;
  message: string;
}): void {
  const err = captureThrow(() => redisOptionsFromUrl(row.raw));
  assert(
    errorName(err) === "QueueConfigError",
    `expected err.name === "QueueConfigError" for ${JSON.stringify(row.raw)}, got "${errorName(err)}"`,
  );
  assert(
    errorMessage(err) === row.message,
    `expected the guard's own message ${JSON.stringify(row.message)} for ${JSON.stringify(row.raw)}, got ${JSON.stringify(errorMessage(err))}`,
  );
  assert(
    !errorMessage(err).includes(row.raw),
    `err.message must not contain the input value "${row.raw}" (it can carry a password) — got "${errorMessage(err)}"`,
  );
}

/** §9.6, sharpened: the whole-value check above passes for any substring; the password on its own must be absent too. */
export function assertCredentialRefusalDoesNotEchoThePassword(): void {
  const err = captureThrow(() => redisOptionsFromUrl("redis://:s3cret@cache/abc"));
  assert(
    !errorMessage(err).includes("s3cret"),
    `err.message must not contain the password on its own — got "${errorMessage(err)}"`,
  );
}

export function assertWorkerConfigDefaultsPortTo4100(): void {
  const config = readWorkerConfig({ REDIS_URL: "redis://r" });
  assert(config.port === 4100, `expected default WORKER_PORT 4100, got ${config.port}`);
}

export function assertWorkerConfigHonoursExplicitPort(): void {
  const config = readWorkerConfig({ REDIS_URL: "redis://r", WORKER_PORT: "4200" });
  assert(config.port === 4200, `expected WORKER_PORT 4200, got ${config.port}`);
}

export function assertWorkerConfigRefusesMissingRedisUrlNamingOnlyRedisUrl(): void {
  const err = captureThrow(() => readWorkerConfig({}));
  assert(
    errorName(err) === "QueueConfigError",
    `expected err.name === "QueueConfigError", got "${errorName(err)}"`,
  );
  assert(
    errorMessage(err).includes("REDIS_URL"),
    `expected the message to name REDIS_URL, got "${errorMessage(err)}"`,
  );
  assert(
    !errorMessage(err).includes("WORKER_PORT"),
    `the missing-REDIS_URL refusal must not also name WORKER_PORT (the port guard must not fire first) — got "${errorMessage(err)}"`,
  );
}

export const INVALID_WORKER_PORTS = ["0", "70000", "1e3", "abc"] as const;

export function assertInvalidWorkerPortThrowsNamingWorkerPortNotRedisUrl(raw: string): void {
  const err = captureThrow(() => readWorkerConfig({ REDIS_URL: "redis://r", WORKER_PORT: raw }));
  assert(
    errorName(err) === "QueueConfigError",
    `expected err.name === "QueueConfigError" for WORKER_PORT=${JSON.stringify(raw)}, got "${errorName(err)}"`,
  );
  assert(
    errorMessage(err).includes("WORKER_PORT"),
    `expected the message to name WORKER_PORT for ${JSON.stringify(raw)}, got "${errorMessage(err)}"`,
  );
  assert(
    !errorMessage(err).includes("REDIS_URL"),
    `the WORKER_PORT refusal must not also name REDIS_URL for ${JSON.stringify(raw)} — got "${errorMessage(err)}"`,
  );
}

/** Exercised so the exported class is referenced from a test (dead-import guard). */
export function assertQueueConfigErrorNameIsStable(): void {
  const err = new QueueConfigError("x");
  assert(err.name === "QueueConfigError", `expected name "QueueConfigError", got "${err.name}"`);
}

/**
 * `RULE_SWEEP_INTERVAL_MS` (ADR 0064 decision 6, plan §8). One `it()` per
 * row; `err.name` is matched, never `instanceof` (the file's own rule
 * above).
 */
export function assertRuleSweepIntervalDefaultsTo60000(): void {
  const config = readWorkerConfig({ REDIS_URL: "redis://r" });
  assert(
    config.ruleSweepIntervalMs === 60000,
    `expected default ruleSweepIntervalMs 60000, got ${config.ruleSweepIntervalMs}`,
  );
}

export function assertBlankRuleSweepIntervalIsUnset(): void {
  const config = readWorkerConfig({
    REDIS_URL: "redis://r",
    RULE_SWEEP_INTERVAL_MS: " ",
  });
  assert(
    config.ruleSweepIntervalMs === 60000,
    `expected a whitespace-only RULE_SWEEP_INTERVAL_MS to read as unset (60000), got ${config.ruleSweepIntervalMs}`,
  );
}

export function assertRuleSweepIntervalHonoursFloor(): void {
  const config = readWorkerConfig({
    REDIS_URL: "redis://r",
    RULE_SWEEP_INTERVAL_MS: "10000",
  });
  assert(
    config.ruleSweepIntervalMs === 10000,
    `expected the floor 10000 to be accepted, got ${config.ruleSweepIntervalMs}`,
  );
}

export function assertRuleSweepIntervalHonoursCeiling(): void {
  const config = readWorkerConfig({
    REDIS_URL: "redis://r",
    RULE_SWEEP_INTERVAL_MS: "3600000",
  });
  assert(
    config.ruleSweepIntervalMs === 3600000,
    `expected the ceiling 3600000 to be accepted, got ${config.ruleSweepIntervalMs}`,
  );
}

export const INVALID_RULE_SWEEP_INTERVALS = [
  "9999",
  "3600001",
  "60000.5",
  "1e3",
  "-1",
  "abc",
] as const;

export function assertInvalidRuleSweepIntervalThrowsNamingOnlyRuleSweep(raw: string): void {
  const err = captureThrow(() =>
    readWorkerConfig({ REDIS_URL: "redis://r", RULE_SWEEP_INTERVAL_MS: raw }),
  );
  assert(
    errorName(err) === "QueueConfigError",
    `expected err.name === "QueueConfigError" for RULE_SWEEP_INTERVAL_MS=${JSON.stringify(raw)}, got "${errorName(err)}"`,
  );
  assert(
    errorMessage(err).includes("RULE_SWEEP_INTERVAL_MS"),
    `expected the message to name RULE_SWEEP_INTERVAL_MS for ${JSON.stringify(raw)}, got "${errorMessage(err)}"`,
  );
  assert(
    !errorMessage(err).includes("WORKER_PORT"),
    `the RULE_SWEEP_INTERVAL_MS refusal must not also name WORKER_PORT for ${JSON.stringify(raw)} — got "${errorMessage(err)}"`,
  );
  assert(
    !errorMessage(err).includes("REDIS_URL"),
    `the RULE_SWEEP_INTERVAL_MS refusal must not also name REDIS_URL for ${JSON.stringify(raw)} — got "${errorMessage(err)}"`,
  );
}

export function assertMissingRedisUrlRefusalFiresBeforeRuleSweepGuard(): void {
  const err = captureThrow(() => readWorkerConfig({ RULE_SWEEP_INTERVAL_MS: "5" }));
  assert(
    errorName(err) === "QueueConfigError",
    `expected err.name === "QueueConfigError", got "${errorName(err)}"`,
  );
  assert(
    errorMessage(err).includes("REDIS_URL"),
    `expected the message to name REDIS_URL (guard order), got "${errorMessage(err)}"`,
  );
  assert(
    !errorMessage(err).includes("RULE_SWEEP"),
    `the missing-REDIS_URL refusal must not also name RULE_SWEEP — got "${errorMessage(err)}"`,
  );
}

export function assertInvalidWorkerPortRefusalFiresBeforeRuleSweepGuard(): void {
  const err = captureThrow(() =>
    readWorkerConfig({
      REDIS_URL: "redis://r",
      WORKER_PORT: "0",
      RULE_SWEEP_INTERVAL_MS: "60000",
    }),
  );
  assert(
    errorName(err) === "QueueConfigError",
    `expected err.name === "QueueConfigError", got "${errorName(err)}"`,
  );
  assert(
    errorMessage(err).includes("WORKER_PORT"),
    `expected the message to name WORKER_PORT (guard order), got "${errorMessage(err)}"`,
  );
  assert(
    !errorMessage(err).includes("RULE_SWEEP"),
    `the invalid-WORKER_PORT refusal must not also name RULE_SWEEP — got "${errorMessage(err)}"`,
  );
}
