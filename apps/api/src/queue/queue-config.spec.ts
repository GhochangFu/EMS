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
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
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
 * `redis://:s3cret@cache/abc` is the one entry that carries a credential
 * (§9.6) — a bad db segment ("abc") makes it invalid, and it is the case
 * that actually tests "the value never appears in the message" rather than
 * only the scheme/host/db-shape checks.
 */
export const INVALID_URLS = [
  "http://x",
  "redis://",
  "redis://h/abc",
  "not a url",
  "redis://:s3cret@cache/abc",
] as const;

export function assertInvalidUrlThrowsQueueConfigErrorWithoutEchoingTheValue(
  raw: string,
): void {
  try {
    redisOptionsFromUrl(raw);
    throw new Error(`expected redisOptionsFromUrl(${JSON.stringify(raw)}) to throw`);
  } catch (err) {
    assert(err instanceof Error, `expected an Error for ${JSON.stringify(raw)}`);
    assert(
      (err as Error).name === "QueueConfigError",
      `expected err.name === "QueueConfigError" for ${JSON.stringify(raw)}, got "${(err as Error).name}"`,
    );
    assert(
      !(err as Error).message.includes(raw),
      `err.message must not contain the input value "${raw}" (it can carry a password) — got "${(err as Error).message}"`,
    );
  }
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
  try {
    readWorkerConfig({});
    throw new Error("expected readWorkerConfig({}) to throw");
  } catch (err) {
    assert(err instanceof Error, "expected an Error");
    assert(
      (err as Error).message.includes("REDIS_URL"),
      `expected the message to name REDIS_URL, got "${(err as Error).message}"`,
    );
    assert(
      !(err as Error).message.includes("WORKER_PORT"),
      `the missing-REDIS_URL refusal must not also name WORKER_PORT (the port guard must not fire first) — got "${(err as Error).message}"`,
    );
  }
}

export const INVALID_WORKER_PORTS = ["0", "70000", "1e3", "abc"] as const;

export function assertInvalidWorkerPortThrowsNamingWorkerPortNotRedisUrl(
  raw: string,
): void {
  try {
    readWorkerConfig({ REDIS_URL: "redis://r", WORKER_PORT: raw });
    throw new Error(`expected WORKER_PORT=${JSON.stringify(raw)} to throw`);
  } catch (err) {
    assert(err instanceof Error, `expected an Error for WORKER_PORT=${JSON.stringify(raw)}`);
    assert(
      (err as Error).message.includes("WORKER_PORT"),
      `expected the message to name WORKER_PORT for ${JSON.stringify(raw)}, got "${(err as Error).message}"`,
    );
    assert(
      !(err as Error).message.includes("REDIS_URL"),
      `the WORKER_PORT refusal must not also name REDIS_URL for ${JSON.stringify(raw)} — got "${(err as Error).message}"`,
    );
  }
}

/** Exercised so the exported class is referenced from a test (dead-import guard). */
export function assertQueueConfigErrorNameIsStable(): void {
  const err = new QueueConfigError("x");
  assert(err.name === "QueueConfigError", `expected name "QueueConfigError", got "${err.name}"`);
}
