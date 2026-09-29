import { createRequire } from "node:module";

import {
  DEFAULT_LATEST_WINDOW_MINUTES,
  MAX_LATEST_ASSET_IDS,
  MAX_LATEST_POINT_KEYS,
  MAX_LATEST_WINDOW_MINUTES,
  pointsLatestQuerySchema,
} from "./telemetry.schema";

/**
 * `F4.176` (ADR 0074 Amendment 2 decision 2) — `pointsLatestQuerySchema`'s
 * bounds: 1–50 asset ids, 1–64 point keys, `windowMinutes` 1–60 defaulting to
 * 15, and nothing else.
 *
 * One claim per exported function; `points-latest.schema.test.ts` is the
 * vitest entry point (ADR 0014). Every case parses through the API's own
 * Express query parser, as `point-values-at.schema.spec.ts` does — the SMOC
 * view sends 43 ids, past `qs`'s `arrayLimit: 20`, so a hand-built array would
 * miss the overflow shape the fold exists for.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// Loaded once, at import — a cold `require("express")` inside the first `it()`
// took over a second alone (`asset-scope.schema.spec.ts`).
const apiQueryParser = (
  createRequire(require.resolve("@nestjs/platform-express"))("express") as () => {
    get(name: string): (q: string) => Record<string, unknown>;
  }
)().get("query parser fn");

function ids(n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  );
}

function keys(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `key_${i}`);
}

function query(assetIds: string[], pointKeys: string[], extra = ""): Record<string, unknown> {
  const parts = [
    ...assetIds.map((id) => `assetIds=${id}`),
    ...pointKeys.map((k) => `pointKeys=${k}`),
  ];
  return apiQueryParser(parts.join("&") + extra);
}

function parse(assetIds: string[], pointKeys: string[], extra = "") {
  return pointsLatestQuerySchema.safeParse(query(assetIds, pointKeys, extra));
}

function issues(result: ReturnType<typeof parse>): string {
  return JSON.stringify(result.success ? undefined : result.error.issues);
}

/** One id and one key parse, and each becomes a one-element array. */
export function assertOneIdAndOneKeyParse(): void {
  const result = parse(ids(1), keys(1));
  assert(result.success === true, `1 id and 1 key must parse: ${issues(result)}`);
  assert(
    result.success &&
      JSON.stringify(result.data.assetIds) === JSON.stringify(ids(1)) &&
      JSON.stringify(result.data.pointKeys) === JSON.stringify(keys(1)),
    "1 id and 1 key must normalise to one-element arrays",
  );
}

/** 21 ids — one past `qs`'s `arrayLimit` — parse, in the order sent. */
export function assertTwentyOneIdsParseInOrder(): void {
  const sent = ids(21);
  const result = parse(sent, keys(1));
  assert(result.success === true, `21 ids must parse: ${issues(result)}`);
  assert(
    result.success && JSON.stringify(result.data.assetIds) === JSON.stringify(sent),
    "21 ids must arrive in the order sent",
  );
}

/** Exactly the id cap (50) parses. */
export function assertFiftyIdsParse(): void {
  const result = parse(ids(MAX_LATEST_ASSET_IDS), keys(1));
  assert(result.success === true, `${MAX_LATEST_ASSET_IDS} ids must parse: ${issues(result)}`);
}

/** One past the id cap (51) is refused. */
export function assertFiftyOneIdsAreRefused(): void {
  const result = parse(ids(MAX_LATEST_ASSET_IDS + 1), keys(1));
  assert(result.success === false, `${MAX_LATEST_ASSET_IDS + 1} ids must be refused`);
}

/** No id at all is refused. */
export function assertNoIdIsRefused(): void {
  const result = parse([], keys(1));
  assert(result.success === false, "a query with no assetIds must be refused");
}

/**
 * A non-UUID id is refused here, as a 400: unchecked it would reach the
 * `::uuid[]` cast and become a 500.
 */
export function assertANonUuidIdIsRefused(): void {
  const result = parse([...ids(1), "not-a-uuid"], keys(1));
  assert(result.success === false, "a non-UUID asset id must be refused");
}

/** Exactly the key cap (64) parses. */
export function assertSixtyFourKeysParse(): void {
  const result = parse(ids(1), keys(MAX_LATEST_POINT_KEYS));
  assert(result.success === true, `${MAX_LATEST_POINT_KEYS} keys must parse: ${issues(result)}`);
}

/** One past the key cap (65) is refused. */
export function assertSixtyFiveKeysAreRefused(): void {
  const result = parse(ids(1), keys(MAX_LATEST_POINT_KEYS + 1));
  assert(result.success === false, `${MAX_LATEST_POINT_KEYS + 1} keys must be refused`);
}

/** No key at all is refused. */
export function assertNoKeyIsRefused(): void {
  const result = parse(ids(1), []);
  assert(result.success === false, "a query with no pointKeys must be refused");
}

/** A key longer than the column (`varchar(128)`) is refused. */
export function assertAKeyLongerThanTheColumnIsRefused(): void {
  const result = parse(ids(1), ["k".repeat(129)]);
  assert(result.success === false, "a 129-character point key must be refused");
  const atLimit = parse(ids(1), ["k".repeat(128)]);
  assert(atLimit.success === true, `a 128-character point key must parse: ${issues(atLimit)}`);
}

/** An absent `windowMinutes` defaults to 15 — the provider's `/recent` window. */
export function assertAnAbsentWindowDefaultsToFifteen(): void {
  const result = parse(ids(1), keys(1));
  assert(
    result.success === true && result.data.windowMinutes === DEFAULT_LATEST_WINDOW_MINUTES,
    `an absent windowMinutes must default to ${DEFAULT_LATEST_WINDOW_MINUTES}: ${JSON.stringify(result)}`,
  );
  assert(DEFAULT_LATEST_WINDOW_MINUTES === 15, "the default window must be 15 minutes");
}

/** Both window bounds parse and arrive as numbers. */
export function assertTheWindowBoundsParse(): void {
  for (const w of [1, MAX_LATEST_WINDOW_MINUTES]) {
    const result = parse(ids(1), keys(1), `&windowMinutes=${w}`);
    assert(
      result.success === true && result.data.windowMinutes === w,
      `windowMinutes=${w} must parse to ${w}: ${issues(result)}`,
    );
  }
  assert(MAX_LATEST_WINDOW_MINUTES === 60, "the window cap must be 60 minutes");
}

/** 0, 61 and a fraction are refused. */
export function assertAnOutOfRangeWindowIsRefused(): void {
  for (const w of ["0", String(MAX_LATEST_WINDOW_MINUTES + 1), "12.5", "abc"]) {
    const result = parse(ids(1), keys(1), `&windowMinutes=${w}`);
    assert(result.success === false, `windowMinutes=${w} must be refused`);
  }
}

/** An unknown query key is refused — the schema is `.strict()`. */
export function assertAnUnknownKeyIsRefused(): void {
  const result = parse(ids(1), keys(1), "&bogus=1");
  assert(result.success === false, "an unknown query key must be refused");
}

/**
 * A NUL byte (or any control character) in a key is a 400 here. Postgres
 * refuses 0x00 in `text`, so unchecked it would be a 500. A key with ordinary
 * punctuation still parses.
 */
export function assertAControlCharacterInAKeyIsRefused(): void {
  for (const bad of ["%00", "kw%00", "k%0Aw", "%7F"]) {
    const result = pointsLatestQuerySchema.safeParse(
      apiQueryParser(`assetIds=${ids(1)[0]}&pointKeys=${bad}`),
    );
    assert(result.success === false, `pointKeys=${bad} must be refused`);
  }
  const ok = parse(ids(1), ["supply_air_temp_c", "pdu-a.status"]);
  assert(ok.success === true, `ordinary keys must parse: ${issues(ok)}`);
}
