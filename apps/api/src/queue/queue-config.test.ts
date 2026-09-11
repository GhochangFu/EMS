import { describe, it } from "vitest";

import {
  assertBlankRedisUrlIsUnconfigured,
  assertBlankRuleSweepIntervalIsUnset,
  assertCredentialRefusalDoesNotEchoThePassword,
  assertCredentialsAndDbAreParsed,
  assertInvalidRuleSweepIntervalThrowsNamingOnlyRuleSweep,
  assertInvalidUrlThrowsItsOwnMessageWithoutEchoingTheValue,
  assertInvalidWorkerPortRefusalFiresBeforeRuleSweepGuard,
  assertInvalidWorkerPortThrowsNamingWorkerPortNotRedisUrl,
  assertMinimalUrlParsesToHostAndPortOnly,
  assertMissingRedisUrlRefusalFiresBeforeRuleSweepGuard,
  assertQueueConfigErrorNameIsStable,
  assertRedissSchemeMapsToTlsAndDefaultPort,
  assertRuleSweepIntervalDefaultsTo60000,
  assertRuleSweepIntervalHonoursCeiling,
  assertRuleSweepIntervalHonoursFloor,
  assertUnsetRedisUrlIsUnconfigured,
  assertWorkerConfigDefaultsPortTo4100,
  assertWorkerConfigHonoursExplicitPort,
  assertWorkerConfigRefusesMissingRedisUrlNamingOnlyRedisUrl,
  INVALID_RULE_SWEEP_INTERVALS,
  INVALID_URL_ROWS,
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

  it.each(INVALID_URL_ROWS)(
    "refuses $raw with its own guard's message, without echoing the value",
    (row) => {
      assertInvalidUrlThrowsItsOwnMessageWithoutEchoingTheValue(row);
    },
  );

  it("does not echo the password on its own when a credential-bearing URL is refused", () => {
    assertCredentialRefusalDoesNotEchoThePassword();
  });

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

  it("defaults ruleSweepIntervalMs to 60000", () => {
    assertRuleSweepIntervalDefaultsTo60000();
  });

  it("reads a whitespace-only RULE_SWEEP_INTERVAL_MS as unset", () => {
    assertBlankRuleSweepIntervalIsUnset();
  });

  it("accepts the RULE_SWEEP_INTERVAL_MS floor of 10000", () => {
    assertRuleSweepIntervalHonoursFloor();
  });

  it("accepts the RULE_SWEEP_INTERVAL_MS ceiling of 3600000", () => {
    assertRuleSweepIntervalHonoursCeiling();
  });

  it.each(INVALID_RULE_SWEEP_INTERVALS)(
    "refuses RULE_SWEEP_INTERVAL_MS=%s naming only RULE_SWEEP_INTERVAL_MS",
    (raw) => {
      assertInvalidRuleSweepIntervalThrowsNamingOnlyRuleSweep(raw);
    },
  );

  it("refuses a missing REDIS_URL before checking RULE_SWEEP_INTERVAL_MS", () => {
    assertMissingRedisUrlRefusalFiresBeforeRuleSweepGuard();
  });

  it("refuses an invalid WORKER_PORT before checking RULE_SWEEP_INTERVAL_MS", () => {
    assertInvalidWorkerPortRefusalFiresBeforeRuleSweepGuard();
  });
});
