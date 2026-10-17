import {
  ASSET_IMAGE_CONTENT_TYPES,
  MAX_ASSET_IMAGE_BYTES,
  MAX_ASSET_IMAGE_CAPTION_CHARS,
  MAX_ASSET_IMAGE_FILENAME_CHARS,
  MAX_ASSET_IMAGES_PER_ASSET,
  NO_CONTROL_CHARACTERS,
  assetImageDtoSchema,
} from "./asset-images";
import { z } from "zod";
import { livenessResponseSchema, queueHealthSchema } from "./health";

type QueueHealth = z.infer<typeof queueHealthSchema>;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const UNCONFIGURED_QUEUE: QueueHealth = {
  configured: false,
  connected: false,
  queues: [],
  lastHeartbeatAt: null,
  heartbeatStale: false,
  lastRuleSweep: null,
};

const VALID_IMAGE = {
  id: "11111111-1111-4111-8111-111111111111",
  assetId: "22222222-2222-4222-8222-222222222222",
  contentType: "image/png",
  byteSize: 1024,
  sha256: "a".repeat(64),
  originalFilename: "panel.png",
  caption: null,
  createdBy: null,
  createdAt: "2026-09-15T00:00:00.000Z",
};

/**
 * `F3.3` — the asset-image constants and the `storage` section on
 * `GET /health` (ADR 0066 decisions 3, 4, 7; Q-A).
 *
 * Assertions live here; `asset-images.test.ts` is the vitest entry point
 * (ADR 0014).
 */
export function assertContentTypesAreExactlyTheThree(): void {
  assert(
    JSON.stringify(ASSET_IMAGE_CONTENT_TYPES) ===
      JSON.stringify(["image/jpeg", "image/png", "image/webp"]),
    `ASSET_IMAGE_CONTENT_TYPES must be exactly the three types in order, got ${JSON.stringify(ASSET_IMAGE_CONTENT_TYPES)}`,
  );
}

export function assertMaxBytesIsTenMiB(): void {
  assert(
    MAX_ASSET_IMAGE_BYTES === 10485760,
    `MAX_ASSET_IMAGE_BYTES must be 10 MiB (10485760), got ${MAX_ASSET_IMAGE_BYTES}`,
  );
}

export function assertDtoRefusesObjectKey(): void {
  // Positive control first: the valid row, with no objectKey, must parse —
  // an absence check needs an adjacent positive (memory: an assertion can
  // miss the broken surface).
  const positive = assetImageDtoSchema.safeParse(VALID_IMAGE);
  assert(
    positive.success === true,
    `the valid asset-image row must parse, got ${JSON.stringify(positive.success === false ? positive.error.issues : null)}`,
  );

  const withKey = assetImageDtoSchema.safeParse({ ...VALID_IMAGE, objectKey: "org/x/assets/y/z" });
  assert(
    withKey.success === false,
    "assetImageDtoSchema must refuse a payload carrying objectKey (ADR 0066 decision 4) — the server-generated key never reaches a response DTO",
  );
}

/**
 * The two string bounds (review finding D, 2026-09-15): `originalFilename`
 * and `caption` are `text` in SQL (`0072` is frozen), so the DTO's `.max()`
 * and `F3.4`'s write path are the only gates. Each bound is exercised at the
 * bound (parses) and one over (refused), and each exported number is
 * asserted so the constants cannot drift from the schema.
 */
export const STRING_BOUNDS = [
  { field: "originalFilename", max: MAX_ASSET_IMAGE_FILENAME_CHARS, expected: 255 },
  { field: "caption", max: MAX_ASSET_IMAGE_CAPTION_CHARS, expected: 1000 },
] as const;

export function assertStringBoundConstantIs(bound: (typeof STRING_BOUNDS)[number]): void {
  assert(
    bound.max === bound.expected,
    `${bound.field}'s bound must be ${bound.expected}, got ${bound.max}`,
  );
}

export function assertStringAtTheBoundParses(bound: (typeof STRING_BOUNDS)[number]): void {
  const result = assetImageDtoSchema.safeParse({ ...VALID_IMAGE, [bound.field]: "x".repeat(bound.max) });
  assert(
    result.success === true,
    `${bound.field} of exactly ${bound.max} chars must parse, got ${JSON.stringify(result.success === false ? result.error.issues : null)}`,
  );
}

export function assertStringOneOverTheBoundIsRefused(bound: (typeof STRING_BOUNDS)[number]): void {
  const result = assetImageDtoSchema.safeParse({ ...VALID_IMAGE, [bound.field]: "x".repeat(bound.max + 1) });
  assert(
    result.success === false,
    `${bound.field} of ${bound.max + 1} chars must be refused — the SQL column is text, so this is the gate`,
  );
}

/**
 * `F3.4` post-merge sweep (security Low) — neither free-text field may carry
 * a C0/C1 control character.
 *
 * The two refusals are the finding; the two acceptances are their positive
 * controls, and they are not decoration: a regex that refused everything
 * outside ASCII would pass both refusals while breaking every accented and
 * CJK filename the C1 decode exists to preserve.
 */
export const CONTROL_CHARACTER_ROWS = [
  { label: "originalFilename with CR LF", patch: { originalFilename: "a\r\nb.png" }, accepted: false },
  { label: "caption with BEL", patch: { caption: "alarm" }, accepted: false },
  { label: "originalFilename café.png", patch: { originalFilename: "café.png" }, accepted: true },
  // The emoji is written as an escape, not a literal glyph (§4.5's no-emoji rule).
  { label: "caption with an emoji", patch: { caption: "Pump room \u{1F6B0}" }, accepted: true },
  // F4.265: the C0 and C1 edges, one row each, so a rewrite of the pattern
  // that drops either range reddens its own row.
  { label: "caption with U+0000 (C0 start)", patch: { caption: "a\u0000b" }, accepted: false },
  { label: "caption with U+001F (C0 end)", patch: { caption: "a\u001Fb" }, accepted: false },
  { label: "caption with U+007F (DEL, second range start)", patch: { caption: "a\u007Fb" }, accepted: false },
  { label: "caption with U+009F (C1 end)", patch: { caption: "a\u009Fb" }, accepted: false },
  { label: "caption with U+0085 (NEL, C1)", patch: { caption: "a\u0085b" }, accepted: false },
  { label: "caption with a line feed", patch: { caption: "line\nbreak" }, accepted: false },
  { label: "caption with a tab", patch: { caption: "tab\there" }, accepted: false },
  { label: "caption with a plain space", patch: { caption: "a b" }, accepted: true },
  { label: "caption in CJK", patch: { caption: "中文" }, accepted: true },
  { label: "caption with U+00A0 (no-break space)", patch: { caption: "a b" }, accepted: true },
  // U+2028 is category Zl (line separator), not Cc: accepted today, and this
  // row pins that the explicit ranges did not widen the refusal.
  { label: "caption with U+2028 (line separator, not Cc)", patch: { caption: "a b" }, accepted: true },
] as const;

export function assertControlCharacterRow(row: (typeof CONTROL_CHARACTER_ROWS)[number]): void {
  const result = assetImageDtoSchema.safeParse({ ...VALID_IMAGE, ...row.patch });
  assert(
    result.success === row.accepted,
    `${row.label} must ${row.accepted ? "parse" : "be refused"}, got ${JSON.stringify(
      result.success === false ? result.error.issues : result.data,
    )}`,
  );
}

/**
 * `F4.265` — the pattern reaches every LLM provider as a tool schema's
 * `pattern`: `zod-to-json-schema` emits `regex.source` and drops the flags.
 * OpenAI refuses a Unicode property escape (`\p{Cc}`) with
 * `invalid_function_parameters`, so the source must carry none, and its
 * **no-flag** meaning is the one that matters. A compile check alone cannot
 * catch `\p{Cc}`: V8 compiles it without `u` as an Annex-B identity escape.
 * The text check is the load-bearing one; the refusals and the acceptance
 * below prove the no-flag compile still means "no Cc".
 */
export function assertNoControlCharactersPatternIsPortable(): void {
  const source = NO_CONTROL_CHARACTERS.source;
  assert(
    !source.includes("\\p{") && !source.includes("\\P{"),
    `NO_CONTROL_CHARACTERS must not use a Unicode property escape, got ${source}`,
  );
  const plain = new RegExp(source);
  const unicode = new RegExp(source, "u");
  assert(!plain.test("\u0000"), `the no-flag compile of ${source} must refuse U+0000`);
  assert(!plain.test("\u009F"), `the no-flag compile of ${source} must refuse U+009F`);
  assert(plain.test("café"), `the no-flag compile of ${source} must accept "café"`);
  assert(!unicode.test("\u009F"), `the u-flag compile of ${source} must refuse U+009F`);
  assert(unicode.test("café"), `the u-flag compile of ${source} must accept "café"`);
}

/**
 * `F3.4` — the per-asset cap (R-3, owner Q-3): 20, answered 409 on overflow.
 */
export function assertPerAssetCapIsTwenty(): void {
  assert(
    MAX_ASSET_IMAGES_PER_ASSET === 20,
    `MAX_ASSET_IMAGES_PER_ASSET must be 20, got ${MAX_ASSET_IMAGES_PER_ASSET}`,
  );
}

export function assertStorageSectionIsOptionalOnLiveness(): void {
  const withoutStorage = livenessResponseSchema.safeParse({ status: "ok", queue: UNCONFIGURED_QUEUE });
  assert(
    withoutStorage.success === true,
    `livenessResponseSchema must accept a body with no storage key (the worker's shape, Q-A), got ${JSON.stringify(withoutStorage.success === false ? withoutStorage.error.issues : null)}`,
  );

  const withBadStorage = livenessResponseSchema.safeParse({
    status: "ok",
    queue: UNCONFIGURED_QUEUE,
    storage: { configured: "yes", reachable: false, bucket: null },
  });
  assert(
    withBadStorage.success === false,
    "livenessResponseSchema must refuse a malformed storage section",
  );
}
