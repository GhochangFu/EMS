import { describe, it } from "vitest";

import {
  assertBlankRedisUrlIsUnconfigured,
  assertCredentialsAndDbAreParsed,
  assertInvalidUrlThrowsQueueConfigErrorWithoutEchoingTheValue,
  assertInvalidWorkerPortThrowsNamingWorkerPortNotRedisUrl,
  assertMinimalUrlParsesToHostAndPortOnly,
  assertQueueConfigErrorNameIsStable,
  assertRedissSchemeMapsToTlsAndDefaultPort,
  assertUnsetRedisUrlIsUnconfigured,
  assertWorkerConfigDefaultsPortTo4100,
  assertWorkerConfigHonoursExplicitPort,
  assertWorkerConfigRefusesMissingRedisUrlNamingOnlyRedisUrl,
  INVALID_URLS,
  INVALID_WORKER_PORTS,
} from "./queue-config.spec";

/**
 * F4.24 (ADR 0063 decisions 4, 9) — Vitest entry point for the queue and
 * worker configuration readers. Assertions live in the sibling `.spec`
 * (§4.6/ADR 0014); this file only runs them.
 */
describe("F4.24 — queue and worker configuration readers", () => {
  it("reads an unset REDIS_URL as unconfigured", () => {
    assertUnsetRedisUrlIsUnconfigured();
  });

  it("reads a whitespace-only REDIS_URL as unconfigured", () => {
    assertBlankRedisUrlIsUnconfigured();
  });

  it("parses a minimal redis:// URL to host and port only", () => {
    assertMinimalUrlParsesToHostAndPortOnly();
  });

  it("parses credentials and the path-segment db from a redis:// URL", () => {
    assertCredentialsAndDbAreParsed();
  });

  it("maps the rediss:// scheme to tls and the default port", () => {
    assertRedissSchemeMapsToTlsAndDefaultPort();
  });

  it.each(INVALID_URLS)(
    "throws QueueConfigError without echoing the value for %s",
    (raw) => {
      assertInvalidUrlThrowsQueueConfigErrorWithoutEchoingTheValue(raw);
    },
  );

  it("defaults the worker port to 4100", () => {
    assertWorkerConfigDefaultsPortTo4100();
  });

  it("honours an explicit WORKER_PORT", () => {
    assertWorkerConfigHonoursExplicitPort();
  });

  it("refuses a missing REDIS_URL naming only REDIS_URL", () => {
    assertWorkerConfigRefusesMissingRedisUrlNamingOnlyRedisUrl();
  });

  it.each(INVALID_WORKER_PORTS)(
    "refuses WORKER_PORT=%s naming WORKER_PORT, not REDIS_URL",
    (raw) => {
      assertInvalidWorkerPortThrowsNamingWorkerPortNotRedisUrl(raw);
    },
  );

  it("gives QueueConfigError a stable name", () => {
    assertQueueConfigErrorNameIsStable();
  });
});
