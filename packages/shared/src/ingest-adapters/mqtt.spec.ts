import { expect } from "vitest";
import type { ZodTypeAny } from "zod";

import {
  MQTT_REJECT_UNAUTHORIZED_DRAFT_MESSAGE,
  mqttConfigSchema,
  mqttDeviceSchema,
  mqttDraftConfigSchema,
} from "./mqtt";

/**
 * `F3.24a` / ADR 0093 decision 4 — the MQTT config and device schemas, now in
 * `@bms/shared/ingest`, and the onboarding draft schema derived beside them.
 *
 * Assertions live here; `mqtt.test.ts` is the vitest entry point (ADR 0014). One
 * claim per exported function, so a mutation reddens the `it` that owns it.
 */

/** The issue paths of a failed parse, joined with `.`; `[]` when the parse succeeds. */
function issuePaths(schema: ZodTypeAny, input: unknown): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

/** S1 — a wildcard is a subscription to many devices, never one device's topic. Moved from `apps/ingest/src/adapters/mqtt.spec.ts`. */
export function assertTheDeviceSchemaRefusesAWildcardTopic(): void {
  for (const topic of ["#", "+", "a/b/#", "a/+/c"]) {
    expect(mqttDeviceSchema.safeParse({ topic }).success, topic).toBe(false);
  }
}

/** S2 — the adjacent positive: the pilot's real topic shape parses. */
export function assertTheDeviceSchemaAcceptsAnOrdinaryTopic(): void {
  expect(mqttDeviceSchema.safeParse({ topic: "Airsprint-1051/Data/1051" }).success).toBe(true);
}

/** S3 — TLS peer verification is on unless the host says otherwise. */
export function assertTheConfigSchemaDefaultsTlsVerificationOn(): void {
  expect(mqttConfigSchema.parse({ host: "h", port: 8883 }).rejectUnauthorized).toBe(true);
}

/** S4 — the port is a positive integer, not a string and not zero. */
export function assertTheConfigSchemaRefusesAStringOrZeroPort(): void {
  expect(mqttConfigSchema.safeParse({ host: "h", port: "8883" }).success).toBe(false);
  expect(mqttConfigSchema.safeParse({ host: "h", port: 0 }).success).toBe(false);
  expect(mqttConfigSchema.safeParse({ host: "h", port: 8883 }).success).toBe(true);
}

/** S5 — `host` and `port` may come from the ingest host's env fallback. */
export function assertTheDraftSchemaAcceptsAnAbsentHostAndPort(): void {
  expect(mqttDraftConfigSchema.safeParse({ topic: "a/b" }).success).toBe(true);
  expect(mqttDraftConfigSchema.safeParse({}).success).toBe(true);
}

/** S6 — every field that is present is checked, and the failure names its path. */
export function assertTheDraftSchemaChecksEveryPresentField(): void {
  expect(issuePaths(mqttDraftConfigSchema, { port: "8883" })).toEqual(["port"]);
  expect(issuePaths(mqttDraftConfigSchema, { port: 0 })).toEqual(["port"]);
  expect(issuePaths(mqttDraftConfigSchema, { host: "" })).toEqual(["host"]);
  expect(issuePaths(mqttDraftConfigSchema, { device: { topic: "a/#" } })).toEqual(["device.topic"]);
  expect(issuePaths(mqttDraftConfigSchema, { topic: "a/#" })).toEqual(["topic"]);
  expect(issuePaths(mqttDraftConfigSchema, { mqttTopic: "a/+" })).toEqual(["mqttTopic"]);
}

/** S7 — the guided MQTT add's empty topic and its draft-only `tls` key pass, and `tls` is kept. */
export function assertTheDraftSchemaKeepsAnEmptyTopicAndDraftOnlyKeys(): void {
  const result = mqttDraftConfigSchema.safeParse({ topic: "", tls: true, host: "h", port: 8883 });
  expect(result.success).toBe(true);
  expect(result.success && result.data.tls).toBe(true);
}

/** S8 (plan Q1) — a present `rejectUnauthorized` key, whatever its value, is refused at its path. */
export function assertTheDraftSchemaRefusesRejectUnauthorized(): void {
  for (const rejectUnauthorized of [true, false]) {
    const result = mqttDraftConfigSchema.safeParse({ rejectUnauthorized });
    expect(result.success, String(rejectUnauthorized)).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([
      ["rejectUnauthorized", MQTT_REJECT_UNAUTHORIZED_DRAFT_MESSAGE],
    ]);
  }
}

/**
 * S9 — no issue message echoes the offending value (§9.6): the validator and the
 * tools forward these messages to the model and the user.
 *
 * `{ port: 0 }` and `{ host: "" }` are not listed: `0` and `""` are substrings of
 * any fixed text ("greater than 0"), so the check cannot tell an echo from the
 * schema's own words for them.
 */
export function assertNoDraftIssueMessageEchoesAValue(): void {
  const cases: [unknown, string][] = [
    [{ port: "8883" }, "8883"],
    [{ device: { topic: "a/#" } }, "a/#"],
    [{ topic: "a/#" }, "a/#"],
    [{ mqttTopic: "a/+" }, "a/+"],
    [{ rejectUnauthorized: true }, "true"],
    [{ rejectUnauthorized: false }, "false"],
  ];
  for (const [input, value] of cases) {
    const result = mqttDraftConfigSchema.safeParse(input);
    expect(result.success, value).toBe(false);
    for (const issue of result.success ? [] : result.error.issues) {
      expect(issue.message, value).not.toContain(value);
    }
  }
}
