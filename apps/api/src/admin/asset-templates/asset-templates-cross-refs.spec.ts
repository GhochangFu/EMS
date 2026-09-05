import {
  MAX_ECHOED_POINT_KEY_LENGTH,
  MAX_ECHOED_POINT_KEYS,
  boundedMissingPointKeys,
  crossRefPointKeys,
} from "./asset-templates-cross-refs";
import { templatePointBodySchema } from "./asset-templates.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function keys(points: Parameters<typeof crossRefPointKeys>[0]): string[] {
  return crossRefPointKeys(points)
    .map((point) => point.pointKey)
    .sort();
}

/**
 * `F2.9` / ADR 0055 — the point keys a `bms-calc-v2` formula names *inside* its
 * own text, which no foreign key can see.
 */
export function runCrossRefPointKeyTests(): void {
  assert(
    keys([
      { pointKey: "A", kind: "measured" },
      { pointKey: "D", kind: "derived", formula: "{A}", formulaDialect: "bms-calc-v1" },
    ]).length === 0,
    "a bms-calc-v1 formula has no cross references — its every `{ref}` is a local key " +
      "`template_points_point_key_fkey` already holds",
  );

  assert(
    keys([
      {
        pointKey: "total_kw",
        kind: "derived",
        formula: "sum({kw} @site) / sum({kw} @group('IT_LOAD'))",
        formulaDialect: "bms-calc-v2",
      },
    ]).join(",") === "kw",
    "an aggregate's point key must be reported once, however many scopes name it",
  );

  assert(
    keys([
      {
        pointKey: "loss",
        kind: "derived",
        formula: "{TX_01.kwh} - {TX_02.kwh}",
        formulaDialect: "bms-calc-v2",
      },
    ]).join(",") === "kwh",
    "a qualified reference names a point key too — the asset code resolves at evaluation " +
      "time, but the key must exist in the catalog now",
  );

  assert(
    keys([
      {
        pointKey: "mixed",
        kind: "derived",
        formula: "sum({kw} @site) + {local}",
        formulaDialect: "bms-calc-v2",
      },
    ]).join(",") === "kw",
    "a local reference is NOT a cross reference — it is already declared in the array and " +
      "checked by the sibling rule, and reporting it here would double-count",
  );

  // Totality. `publish` re-validates *stored* rows, which zod never saw: a row
  // written before this guard, or by the seed, can hold anything. A throw here
  // would turn a publish into a 500.
  assert(
    keys([
      { pointKey: "broken", kind: "derived", formula: "sum({kw}", formulaDialect: "bms-calc-v2" },
      { pointKey: "empty", kind: "derived", formula: null, formulaDialect: "bms-calc-v2" },
      { pointKey: "no-dialect", kind: "derived", formula: "sum({kw} @site)", formulaDialect: null },
      { pointKey: "measured", kind: "measured", formula: "sum({kw} @site)", formulaDialect: "bms-calc-v2" },
      { pointKey: "loose" },
    ]).length === 0,
    "an unparseable, dialect-less, formula-less or measured row must yield no keys rather " +
      "than throwing — this runs over stored rows on the publish path",
  );

  assert(
    keys([
      { pointKey: "a", kind: "derived", formula: "sum({kw} @site)", formulaDialect: "bms-calc-v2" },
      { pointKey: "b", kind: "derived", formula: "avg({kw} @domain('hvac'))", formulaDialect: "bms-calc-v2" },
      { pointKey: "c", kind: "derived", formula: "sum({kwh} @site)", formulaDialect: "bms-calc-v2" },
    ]).join(",") === "kw,kwh",
    "keys must be de-duplicated across points — the catalog read is one `IN` list",
  );
}

/**
 * **What the catalog refusal is allowed to echo** (security review of PR 1,
 * LOW).
 *
 * `assertPointKeysActive` names every offending code, and that is deliberate:
 * a caller told only "invalid point key" has to bisect a 40-point template by
 * hand. Before `F2.9` the codes it could name came only from the DTO, bounded
 * at 128 by `pointKeyCode`. A cross-reference key is lifted out of the
 * **formula string**, where the only bound is `MAX_FORMULA_LENGTH` (1000) and
 * there is no charset rule at all — so the message became a channel for
 * formula-derived text, which is the whole of what the calc-DSL's no-echo
 * discipline exists to prevent (`formatCalcError`'s docblock records the
 * `parseStoredContent` incident, and AGENTS.md §4.3 asks for field paths).
 */
export function runBoundedMissingPointKeyTests(): void {
  const long = "x".repeat(900);
  const bounded = boundedMissingPointKeys([long]);
  const rendered = bounded.join(", ");

  assert(
    !rendered.includes(long),
    `a 900-character key lifted out of a formula must not be echoed whole. Got ${rendered.length} characters`,
  );
  assert(
    rendered.length <= MAX_ECHOED_POINT_KEY_LENGTH + 16,
    `and the truncated form must stay near the bound, got ${rendered.length} characters`,
  );
  assert(
    rendered.startsWith("xxx"),
    `the author still has to recognise which key it is, so the head is kept. Got: ${rendered.slice(0, 8)}`,
  );

  // Truncation is a no-op on every key the DTO path can produce, which is why
  // the existing "name the offending codes" behaviour is unchanged.
  const atBound = "y".repeat(MAX_ECHOED_POINT_KEY_LENGTH);
  assert(
    boundedMissingPointKeys([atBound]).join(", ") === atBound,
    "a key at the DTO bound must be named in full — truncating it would degrade the message " +
      "for the common case to guard the rare one",
  );

  // Anti-drift: the bound is the DTO's own, and this is what says so rather
  // than a comment. `pointKeyCode` is not exported, so it is checked through
  // the schema that uses it.
  const point = { pointKey: atBound, kind: "measured" as const };
  assert(
    templatePointBodySchema.safeParse(point).success,
    `MAX_ECHOED_POINT_KEY_LENGTH (${MAX_ECHOED_POINT_KEY_LENGTH}) must be a length the DTO ` +
      "accepts, or truncation would fire on ordinary point keys",
  );
  assert(
    !templatePointBodySchema.safeParse({ ...point, pointKey: `${atBound}y` }).success,
    `and it must be the DTO's exact bound — one character more must be refused there, or the ` +
      "two have drifted apart",
  );

  // The count is bounded too: a formula may name many keys, and 40 truncated
  // codes is still a long message built out of formula text.
  const many = Array.from({ length: MAX_ECHOED_POINT_KEYS + 5 }, (_, i) => `k${i}`);
  const capped = boundedMissingPointKeys(many);
  assert(
    capped.length === MAX_ECHOED_POINT_KEYS + 1,
    `at most ${MAX_ECHOED_POINT_KEYS} codes are listed, plus one entry saying how many were ` +
      `not. Got ${capped.length}`,
  );
  assert(
    capped[capped.length - 1] === "and 5 more",
    `and the caller must be told how many were withheld, or the list is a lie. Got: ${capped[capped.length - 1]}`,
  );
  assert(
    boundedMissingPointKeys(["a", "b"]).join(", ") === "a, b",
    "a short list is passed through unchanged — no cap entry when nothing was withheld",
  );
}
