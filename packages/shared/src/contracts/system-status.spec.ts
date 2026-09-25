import { systemStatusResponseSchema } from "./system-status";

/**
 * `F3.30` / ADR 0075 decisions 3, 4 — the system status contract.
 *
 * Assertions live here; `system-status.test.ts` is the vitest entry point
 * (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectAccepts(value: unknown, message: string): void {
  assert(
    systemStatusResponseSchema.safeParse(value).success === true,
    `${message} — expected success, got a refusal`,
  );
}

function expectRejects(value: unknown, message: string): void {
  assert(
    systemStatusResponseSchema.safeParse(value).success === false,
    `${message} — expected a refusal, got success`,
  );
}

const validBody = {
  status: "operational",
  components: [
    { key: "queue", state: "ok" },
    { key: "storage", state: "not_configured" },
    { key: "field_data", state: "degraded" },
  ],
  dataQuality: {
    percent: 98.6,
    freshAssets: 148,
    streamingAssets: 150,
    windowSeconds: 25,
  },
  checkedAt: "2026-09-25T00:00:00.000Z",
};

/** A full, well-formed body parses. */
export function runFullBodyParsesTest(): void {
  expectAccepts(validBody, "a full valid body");
}

/** `dataQuality.percent: null` is absence, not a measured zero, and parses. */
export function runNullPercentParsesTest(): void {
  expectAccepts(
    { ...validBody, dataQuality: { ...validBody.dataQuality, percent: null } },
    "percent: null",
  );
}

/** `percent` as a string is rejected — it is a number on the wire. */
export function runStringPercentRejectedTest(): void {
  expectRejects(
    { ...validBody, dataQuality: { ...validBody.dataQuality, percent: "98.6" } },
    'percent: "98.6"',
  );
}

/** An unknown component `state` is rejected. */
export function runUnknownStateRejectedTest(): void {
  expectRejects(
    {
      ...validBody,
      components: [{ key: "queue", state: "unplugged" }],
    },
    "an unknown state",
  );
}

/** An unknown component `key` is rejected. */
export function runUnknownKeyRejectedTest(): void {
  expectRejects(
    {
      ...validBody,
      components: [{ key: "database", state: "ok" }],
    },
    "an unknown key",
  );
}

/**
 * An extra top-level key is tolerated — `systemStatusResponseSchema` is not
 * `.strict()` at the top level, so an additive field does not need a
 * lock-step release.
 */
export function runExtraTopLevelKeyToleratedTest(): void {
  expectAccepts({ ...validBody, futureField: "anything" }, "an extra top-level key");
}
