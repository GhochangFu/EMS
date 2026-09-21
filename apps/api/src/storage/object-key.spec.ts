import { buildObjectKey, buildReportObjectKey, ObjectKeyError } from "./object-key";

/**
 * F3.3 (ADR 0066 decision 4) — the one object key builder.
 *
 * Assertions live here; `object-key.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). `captureThrow`'s sentinel lives outside the `try`;
 * errors are matched on `err.name`, never `instanceof`.
 *
 * The refusal rows each corrupt **one** part of an otherwise valid input
 * and carry the valid build as their positive control, so a builder that
 * threw on everything would fail the same function that a builder that
 * threw on nothing does.
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

const VALID = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  assetId: "22222222-2222-4222-8222-222222222222",
  imageId: "33333333-3333-4333-8333-333333333333",
} as const;

export function assertBuildsTheExactKeyForThreeUuids(): void {
  const key = buildObjectKey(VALID);
  const expected =
    "org/11111111-1111-4111-8111-111111111111/assets/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333";
  assert(key === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(key)}`);
}

export type InvalidPartRow = {
  readonly part: keyof typeof VALID;
  readonly value: string;
};

/** A traversal, a bare word, an empty string and a near-uuid: none may reach the key. */
export const INVALID_PART_ROWS: readonly InvalidPartRow[] = [
  { part: "organizationId", value: "../" },
  { part: "assetId", value: "key" },
  { part: "imageId", value: "../../etc/passwd" },
  { part: "imageId", value: "" },
  { part: "assetId", value: "33333333-3333-4333-8333-33333333333" },
];

export function assertNonUuidPartIsRefusedWithoutEchoingIt(row: InvalidPartRow): void {
  // Positive control: the same input with every part valid builds a key.
  assert(
    typeof buildObjectKey(VALID) === "string",
    "positive control: the valid input must build a key before the corrupted one is tried",
  );
  const err = captureThrow(() => buildObjectKey({ ...VALID, [row.part]: row.value }));
  assert(
    errorName(err) === "ObjectKeyError",
    `expected err.name === "ObjectKeyError" for ${row.part}=${JSON.stringify(row.value)}, got "${errorName(err)}"`,
  );
  assert(
    errorMessage(err).includes(row.part),
    `expected the refusal to name the part "${row.part}", got "${errorMessage(err)}"`,
  );
  if (row.value.length > 0) {
    assert(
      !errorMessage(err).includes(row.value),
      `the refusal must not echo the rejected value ${JSON.stringify(row.value)} — got "${errorMessage(err)}"`,
    );
  }
}

const VALID_REPORT = {
  organizationId: "44444444-4444-4444-8444-444444444444",
  fileId: "55555555-5555-4555-8555-555555555555",
} as const;

export function assertBuildsTheReportKeyForTwoUuids(): void {
  const key = buildReportObjectKey(VALID_REPORT);
  const expected =
    "org/44444444-4444-4444-8444-444444444444/reports/55555555-5555-4555-8555-555555555555";
  assert(key === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(key)}`);
}

export type InvalidReportPartRow = {
  readonly part: keyof typeof VALID_REPORT;
  readonly value: string;
};

/** A traversal, a bare word, an empty string and a near-uuid: none may reach the key. */
export const INVALID_REPORT_PART_ROWS: readonly InvalidReportPartRow[] = [
  { part: "organizationId", value: "../" },
  { part: "fileId", value: "key" },
  { part: "fileId", value: "../../etc/passwd" },
  { part: "fileId", value: "" },
  { part: "organizationId", value: "44444444-4444-4444-8444-44444444444" },
];

export function assertNonUuidReportPartIsRefusedWithoutEchoingIt(row: InvalidReportPartRow): void {
  // Positive control: the same input with every part valid builds a key.
  assert(
    typeof buildReportObjectKey(VALID_REPORT) === "string",
    "positive control: the valid input must build a key before the corrupted one is tried",
  );
  const err = captureThrow(() => buildReportObjectKey({ ...VALID_REPORT, [row.part]: row.value }));
  assert(
    errorName(err) === "ObjectKeyError",
    `expected err.name === "ObjectKeyError" for ${row.part}=${JSON.stringify(row.value)}, got "${errorName(err)}"`,
  );
  assert(
    errorMessage(err).includes(row.part),
    `expected the refusal to name the part "${row.part}", got "${errorMessage(err)}"`,
  );
  if (row.value.length > 0) {
    assert(
      !errorMessage(err).includes(row.value),
      `the refusal must not echo the rejected value ${JSON.stringify(row.value)} — got "${errorMessage(err)}"`,
    );
  }
}

/** Exercised so the exported class is referenced from a test (dead-import guard). */
export function assertObjectKeyErrorNameIsStable(): void {
  const err = new ObjectKeyError("x");
  assert(err.name === "ObjectKeyError", `expected name "ObjectKeyError", got "${err.name}"`);
}
