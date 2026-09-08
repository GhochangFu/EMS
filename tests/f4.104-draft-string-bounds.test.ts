import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Resolved from this file's own location, never from `process.cwd()`. A spec
// that reads repo files through `cwd` passes under a filtered run and dies
// under the root `pnpm test`, where the working directory is not the repo root.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const API_REL = "apps/api/src/admin/onboarding/onboarding.schema.ts";
const SHARED_REL = "packages/shared/src/contracts/onboarding.ts";
const EXCEL_REL = "apps/api/src/admin/onboarding/onboarding-excel.service.ts";
const CHAT_REL = "apps/api/src/admin/onboarding/onboarding-chat.service.ts";

const RECORD = "ONBOARDING_DRAFT_STRING_MAX";
/** `assets.domain` is bounded by a vocabulary schema, not by a `.max()`. */
const DOMAIN_SCHEMA = "assetDomainCodeSchema";

/** The five sub-schemas of a draft, under the name each copy gives them. */
const SECTIONS = [
  { section: "location", shared: "onboardingDraftLocationSchema", api: "draftLocationSchema" },
  { section: "rtus", shared: "onboardingDraftRtuSchema", api: "draftRtuSchema" },
  { section: "pointKeys", shared: "onboardingDraftPointKeySchema", api: "draftPointKeySchema" },
  { section: "assets", shared: "onboardingDraftAssetSchema", api: "draftAssetSchema" },
  {
    section: "assetPoints",
    shared: "onboardingDraftAssetPointSchema",
    api: "draftAssetPointSchema",
  },
] as const;

/**
 * Every string field of a draft, and the bound each copy must name for it.
 *
 * The map key is `<section>.<field>`, which is deliberately **the same string
 * as the record key** the field's `.max()` must read. So this table checks two
 * things at once: that the field is bounded at all, and that it is bounded by
 * *its own* key — `assets.name: .max(ONBOARDING_DRAFT_STRING_MAX["assets.code"])`
 * is a 64-character asset name, it typechecks, and only this comparison sees it.
 *
 * `assets.domain` is the one field whose bound arrives through an imported
 * schema instead (`operations.ts`, shared with four other vocabularies and
 * pinned by source text in `tests/f3.40-asset-role-write-path.test.ts`), so it
 * is expected to read `assetDomainCodeSchema` in both copies and **not** an
 * inlined `.max()`. Its number still lives in the record, where
 * `contracts/onboarding.spec.ts` pins the two to each other.
 */
const EXPECTED_BOUNDS: Readonly<Record<string, string>> = {
  "location.code": "location.code",
  "location.slug": "location.slug",
  "location.name": "location.name",
  "location.province": "location.province",
  "location.capital": "location.capital",
  "rtus.code": "rtus.code",
  "rtus.displayName": "rtus.displayName",
  "rtus.domain": "rtus.domain",
  "rtus.rtuCode": "rtus.rtuCode",
  "rtus.stationCode": "rtus.stationCode",
  "rtus.stationName": "rtus.stationName",
  "pointKeys.code": "pointKeys.code",
  "pointKeys.name": "pointKeys.name",
  "pointKeys.domain": "pointKeys.domain",
  "pointKeys.unit": "pointKeys.unit",
  "pointKeys.description": "pointKeys.description",
  "assets.code": "assets.code",
  "assets.name": "assets.name",
  "assets.siteName": "assets.siteName",
  "assets.domain": DOMAIN_SCHEMA,
  "assetPoints.pointKey": "assetPoints.pointKey",
  "assetPoints.sourceDataKey": "assetPoints.sourceDataKey",
  "assetPoints.sensorCode": "assetPoints.sensorCode",
  "assetPoints.unit": "assetPoints.unit",
};

const EXPECTED_KEYS = Object.keys(EXPECTED_BOUNDS);

/**
 * `field: z.string()` and the call chain hung off it, over source text whose
 * whitespace has been collapsed to single spaces.
 *
 * Whitespace is allowed around every dot because both copies are wrapped by
 * hand where a line grows past the print width, and the two are wrapped
 * *differently*: the shared copy is `code: z.string().max(...)` on one line,
 * while `apps/api`'s `draftLocationSchema.code` is already the five-line
 * `z` / `.string()` / `.min(2)` / `.max(...)` / `.regex(...)` form. A pattern
 * that assumed either shape would read the other as unbounded, which is the
 * misleading failure `tests/f4.103-draft-count-caps.test.ts` documents having
 * hit. One case below reformats the shared copy into the wrapped form and
 * re-scans it, so the tolerance is measured rather than asserted.
 *
 * One level of nested parentheses is allowed inside each chain call, so a
 * future `.refine((v) => v.length > 0)` before `.max()` does not truncate the
 * chain and make the field read as unbounded.
 */
const STRING_FIELD =
  /\b(\w+)\s*:\s*z\s*\.\s*string\(\s*\)((?:\s*\.\s*\w+\((?:[^()]|\([^()]*\))*\))*)/g;

const RECORD_MAX = new RegExp(`\\.\\s*max\\(\\s*${RECORD}\\s*\\[\\s*"([^"]+)"\\s*\\]\\s*\\)`);

const VOCABULARY_FIELD = new RegExp(`\\b(\\w+)\\s*:\\s*${DOMAIN_SCHEMA}\\b`, "g");

/**
 * The body of one `export const <name> = z.object({ … })`, taken as the text
 * from its declaration to the next `export const`. Sections are sliced apart
 * before any field is read because four of the five declare a `code` field and
 * three declare a `domain`: a flat scan of the file would collapse them onto
 * each other and compare `assets.code` against `location.code`.
 */
function sectionBody(collapsed: string, name: string, label: string): string {
  const start = collapsed.search(new RegExp(`export const ${name}\\b`));
  if (start < 0) {
    throw new Error(
      `${label} declares no \`${name}\` — the five draft sub-schemas are what this file ` +
        "compares, so a rename must be reflected here. Repair this parser rather than the " +
        "assertion.",
    );
  }
  const rest = collapsed.slice(start + `export const ${name}`.length);
  const end = rest.indexOf("export const ");
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * `<section>.<field>` → the record key its `.max()` reads, `assetDomainCodeSchema`
 * where the bound comes from the vocabulary schema, or `null` where a
 * `z.string()` field carries neither.
 *
 * Unbounded fields are recorded as `null` rather than skipped, so a string
 * field added to one copy and not the other is a diff in the comparison below
 * instead of an entry nobody looks at.
 */
function boundsIn(source: string, pick: (s: (typeof SECTIONS)[number]) => string, label: string) {
  const collapsed = source.replace(/\s+/g, " ");
  const found = new Map<string, string | null>();

  const record = (key: string, bound: string | null): void => {
    if (found.has(key)) {
      // F4.103's equivalent map is written with `set` and is last-wins, which
      // it documents as a hole: an earlier unbounded declaration of the same
      // field is invisible behind a later bounded one. Closing it here costs
      // two lines.
      throw new Error(
        `${label} declares \`${key}\` twice. The last declaration wins at runtime, so a ` +
          "scan that overwrote the first would report the bounded one and miss the " +
          "unbounded one. Repair this parser rather than the assertion.",
      );
    }
    found.set(key, bound);
  };

  for (const section of SECTIONS) {
    const body = sectionBody(collapsed, pick(section), label);
    for (const match of body.matchAll(STRING_FIELD)) {
      const max = RECORD_MAX.exec(match[2] ?? "");
      record(`${section.section}.${match[1] as string}`, max === null ? null : (max[1] as string));
    }
    for (const match of body.matchAll(VOCABULARY_FIELD)) {
      record(`${section.section}.${match[1] as string}`, DOMAIN_SCHEMA);
    }
  }

  return found;
}

/**
 * Non-vacuity. A scan that matched nothing would compare `{}` against `{}` and
 * the gate would pass having read no source at all — the shape of a guard that
 * goes green while checking nothing (AGENTS.md §4.4). If the declarations are
 * reshaped, fix the parser; do not delete the assertion.
 */
function assertEveryFieldFound(found: Map<string, string | null>, label: string): void {
  const missing = EXPECTED_KEYS.filter((key) => !found.has(key));
  if (missing.length > 0) {
    throw new Error(
      `${label}: read ${found.size} of the ${EXPECTED_KEYS.length} draft string fields — ` +
        `no declaration matched for ${missing.join(", ")}. These are one bound declared twice, ` +
        "so a field this scan cannot see is a field it cannot compare. Repair this parser " +
        "rather than the assertion.",
    );
  }
}

function declaredBounds(rel: string, which: "api" | "shared"): Map<string, string | null> {
  const found = boundsIn(read(rel), (section) => section[which], rel);
  assertEveryFieldFound(found, rel);
  return found;
}

/** Compared whole, so a field in one copy and not the other is a diff. */
const asObject = (found: Map<string, string | null>): Record<string, string | null> =>
  Object.fromEntries([...found.entries()].sort(([a], [b]) => a.localeCompare(b)));

/**
 * `F4.104` — the draft string bounds, in both copies of the draft schema and at
 * the parse site that never reaches either.
 *
 * There are two `onboardingDraftSchema` declarations and both are live.
 * `apps/api/src/admin/onboarding/onboarding.schema.ts` is the write path;
 * `packages/shared/src/contracts/onboarding.ts` is the response contract ADR
 * 0030 makes every DTO `z.infer` of, parsed at runtime in the browser by
 * `apps/web/src/api/admin/onboarding.ts`. Bounding one and not the other is a
 * green build with an incoherent contract.
 *
 * A **sibling** of `tests/f4.103-draft-count-caps.test.ts` and not an extension
 * of it. That file matches `field: z.array(...).max(NAME)` at the top level of
 * one object; these bounds are per-field, inside five nested object literals,
 * some chained, one supplied by an imported schema. Merging the two would make
 * the non-vacuity count ambiguous — "found 21 of 24" would not say which three.
 *
 * ## The honest limits of these scans
 *
 * They are regexes over text, not a parse, so all of this passes unseen:
 *
 * - **a bound applied somewhere else** — a `.superRefine` on the object, or a
 *   schema constant declared elsewhere and referenced here. `assets.domain` is
 *   exactly that case and is written out above rather than read;
 * - **a record key that holds the wrong number.** Nothing here compares two
 *   values across two packages by reading text. `contracts/onboarding.spec.ts`
 *   and `onboarding.schema.spec.ts` parse real fixtures at the bound and at
 *   bound + 1, and the second pins every number to the `@bms/db` column it was
 *   derived from;
 * - **a third copy of the draft schema**, in a file this list does not name;
 * - **text inside a comment, on the two schema scans.** Collapsing whitespace
 *   makes a docblock indistinguishable from code, so a comment quoting one of
 *   these declarations would satisfy the scan on its own. Neither file's
 *   docblocks do today. The **third** gate no longer has this limit: the post-
 *   merge review measured it as a live false green — deleting
 *   `if (topic.length > MAX_RTU_TOPIC_CHARS)` while leaving a comment quoting
 *   the expression left the case green with `topic` unbounded — so its scans run
 *   over {@link executableBodyOf}, which strips every comment and anchors the
 *   search inside the section's own parse method;
 * - **the third gate reads call sites, not values.** It sees that a column is
 *   guarded, never that the guard was handed the value that reaches the draft —
 *   a `refuseIfTooLong` given the pre-`.trim()` cell, or the cell instead of the
 *   resolved fallback, satisfies it. `onboarding-excel-cell-bounds.spec.ts`
 *   parses real workbooks and is what gates that;
 * - **a column the template writes but the three header arrays do not declare.**
 *   The union is checked against those arrays, so an undeclared column is
 *   outside the question this file asks.
 *
 * What they do catch is the drift each exists for: one copy bounded and the
 * other not, a field bounded by another field's key, a second declaration of a
 * bound, and a workbook column that no guard reads.
 */
describe("F4.104 — both copies of the draft schema bound the same strings, and every parsed cell is guarded", () => {
  it("bounds every draft string field by its own record key, in the API copy", () => {
    const found = declaredBounds(API_REL, "api");
    for (const key of EXPECTED_KEYS) {
      expect(found.get(key), `${API_REL}: \`${key}\` must be bounded by its own record key`).toBe(
        EXPECTED_BOUNDS[key],
      );
    }
    expect(asObject(found), `${API_REL} declares a string field this table does not know`).toEqual(
      EXPECTED_BOUNDS,
    );
  });

  it("bounds every draft string field by its own record key, in the shared contract copy", () => {
    const found = declaredBounds(SHARED_REL, "shared");
    for (const key of EXPECTED_KEYS) {
      expect(
        found.get(key),
        `${SHARED_REL}: \`${key}\` must be bounded by its own record key`,
      ).toBe(EXPECTED_BOUNDS[key]);
    }
    expect(
      asObject(found),
      `${SHARED_REL} declares a string field this table does not know`,
    ).toEqual(EXPECTED_BOUNDS);
  });

  it("names the same bound for the same field in both copies", () => {
    // Compared as whole objects rather than field by field, so a field present
    // in one file and absent from the other is a diff and not a silently
    // skipped iteration.
    expect(
      asObject(declaredBounds(API_REL, "api")),
      "the two draft schemas must bound the same fields by the same keys",
    ).toEqual(asObject(declaredBounds(SHARED_REL, "shared")));
  });

  it("still reads every bound when the shared copy is wrapped into the chain form", () => {
    const original = read(SHARED_REL);
    // The repository's own wrap, applied by hand where a line grows past the
    // print width — the shape `apps/api`'s copy already ships for `code`,
    // `slug` and `sourceDataKey`.
    const wrapped = original
      .replace(/: z\.string\(\)/g, ":\n      z\n        .string()")
      .replace(/\)\.max\(/g, ")\n        .max(")
      .replace(/\)\.optional\(\)/g, ")\n        .optional()");

    // The transform has to fire. If it silently matched nothing, this case
    // would re-scan the file in its shipped shape and be green having checked
    // nothing at all.
    expect(wrapped, "the reformat must change the source").not.toBe(original);
    expect(
      /\bz\s*\n\s*\.string\(/.test(wrapped),
      "the reformat must produce the split `z` / `.string(` form this case is about",
    ).toBe(true);

    const found = boundsIn(wrapped, (section) => section.shared, "the wrapped shared copy");
    assertEveryFieldFound(found, "the shared copy, reformatted into the wrapped chain form");
    expect(asObject(found), "wrapping must not change a single bound").toEqual(EXPECTED_BOUNDS);
  });

  it("declares the record once, in the shared contract, and imports it everywhere else", () => {
    const declaration = new RegExp(`export const ${RECORD}\\s*=`);

    expect(
      declaration.test(read(SHARED_REL)),
      `${SHARED_REL} must export ${RECORD} — it is the single declaration of these bounds`,
    ).toBe(true);

    for (const rel of [API_REL, EXCEL_REL, CHAT_REL]) {
      const source = read(rel);
      expect(
        declaration.test(source),
        `${rel} must IMPORT ${RECORD} from @bms/shared, never re-declare it — a second ` +
          "declaration is the drift this file exists to prevent",
      ).toBe(false);
      expect(
        new RegExp(`${RECORD}[^;]*?from "@bms/shared"`, "s").test(source),
        `${rel} must import ${RECORD} from the @bms/shared root entry, not the ` +
          '`/contracts` subpath — apps/api compiles with moduleResolution "node" and ignores ' +
          "the exports map (ADR 0030 Amendment 2)",
      ).toBe(true);
    }
  });

  it("declares exactly the keys the two copies read, and no key nobody reads", () => {
    const literal = new RegExp(`export const ${RECORD}\\s*=\\s*\\{([^}]*)\\}\\s*as const;`).exec(
      read(SHARED_REL),
    );
    if (literal === null) {
      throw new Error(
        `${SHARED_REL}: could not read the ${RECORD} object literal. Repair this parser rather ` +
          "than the assertion — an unread literal would compare an empty key set and pass.",
      );
    }
    const keys = [...(literal[1] as string).matchAll(/"([^"]+)"\s*:\s*\d+/g)].map((m) => m[1]);
    if (keys.length === 0) {
      throw new Error(
        `${SHARED_REL}: the ${RECORD} literal parsed to zero keys. Repair this parser rather ` +
          "than the assertion.",
      );
    }

    // `assets.domain` is in the record but read by neither copy: the field is
    // `assetDomainCodeSchema` in both, and the key exists so the coverage walk
    // above is complete and `contracts/onboarding.spec.ts` can pin the number
    // to that schema's own `maxLength`.
    expect(
      [...keys].sort(),
      "every declared key is read by both copies, and every field reads a declared key",
    ).toEqual([...EXPECTED_KEYS].sort());
  });
});

const HEADER_ARRAYS: Readonly<Record<string, string>> = {
  LOCATION: "LOCATION_HEADERS",
  RTUS: "RTU_HEADERS",
  ASSETS: "ASSET_HEADERS",
};

/** Non-vacuity for the header scan: the three arrays as the template writes them. */
const HEADER_COUNTS: Readonly<Record<string, number>> = { LOCATION: 7, RTUS: 9, ASSETS: 5 };

/**
 * The one guard call that covers two columns, and must keep covering both.
 *
 * `parseRtus` passes the composite literal `"username or password"` rather than
 * either header, because owner ruling 5 forbids a refusal that says which of
 * the two was long: that would tell a reader of the 400 whether a password was
 * set on that row. A gate that matched `RTU_HEADERS` members against the
 * guarded column literals therefore reads both as unbounded — so the composite
 * is expanded here, and the case below also refuses the "fix" of splitting the
 * message into two calls.
 */
const COMPOSITE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  "username or password": ["username", "password"],
};

/** The method each section's `bounded elsewhere` checks must live inside. */
const BOUNDED_ELSEWHERE_METHOD: Readonly<Record<string, string>> = {
  LOCATION: "parseLocation",
  RTUS: "parseRtus",
  ASSETS: "parseAssets",
};

/**
 * Source with every comment removed, so a scan for an expression cannot be
 * satisfied by a sentence quoting it.
 *
 * `//` is only treated as a comment at the start of a line or after whitespace,
 * which keeps a `https://` inside a string literal intact. The error direction
 * of a mistake here is safe: stripping *too much* makes a check read as missing
 * and reddens the gate, it never makes a missing check read as present.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/**
 * The executable body of one `private <name>(` method, comments removed.
 *
 * The whole-file substring search this replaces was a **false green**, and the
 * post-merge review measured it: delete `if (topic.length > MAX_RTU_TOPIC_CHARS)`
 * from `parseRtus` while leaving any comment that quotes the expression, and the
 * case stayed green with the `topic` cell unbounded on the upload path. The
 * topic's own explanatory comment sits inside `parseRtus`, so anchoring to the
 * method alone would not have been enough either — both are needed.
 */
function executableBodyOf(source: string, name: string): string {
  const stripped = withoutComments(source);
  const start = stripped.search(new RegExp(`\\bprivate ${name}\\s*\\(`));
  if (start < 0) {
    throw new Error(
      `${EXCEL_REL}: could not find \`private ${name}(\`. An unfound method would search an ` +
        "empty string and report every check as deleted — but a rename must be reflected here. " +
        "Repair this parser rather than the assertion.",
    );
  }
  const rest = stripped.slice(start + `private ${name}`.length);
  const end = rest.search(/\n {2}(?:private|public|protected)\s/);
  const body = end < 0 ? rest : rest.slice(0, end);
  if (body.trim().length === 0) {
    throw new Error(
      `${EXCEL_REL}: \`private ${name}(\` parsed to an empty body, so every check inside it ` +
        "would read as deleted. Repair this parser rather than the assertion.",
    );
  }
  return body;
}

/**
 * Columns bounded by a check other than `cellLengthProblem`, with the source
 * text that must still be there. They are **not** exempt — both are bounded,
 * by `F4.102`'s own checks on the same two cells — so folding them into the
 * exempt set below would leave this gate green if either check were deleted.
 *
 * The text is searched inside {@link executableBodyOf} the section's own parse
 * method, with comments stripped, so neither a comment quoting the expression
 * nor the same expression in an unrelated method can hold this green.
 */
const BOUNDED_ELSEWHERE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  LOCATION: {},
  RTUS: {
    topic: "topic.length > MAX_RTU_TOPIC_CHARS",
    protocol: "onboardingProtocolSchema.safeParse(",
  },
  ASSETS: {},
};

/** Columns no guard reads, each with the reason no cell text survives them. */
const EXEMPT_COLUMNS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  LOCATION: {
    type: "compared against two literals and otherwise replaced",
    latitude: "Number.parseFloat, guarded by Number.isFinite",
    longitude: "Number.parseFloat, guarded by Number.isFinite",
  },
  RTUS: {
    port: "Number.parseInt, guarded by Number.isFinite",
    tls: "compared against four literals",
  },
  ASSETS: {
    rtu_code: "a lookup key into rtuCodeToIndex; the RTU section bounds the stored copy",
  },
};

function headerColumns(source: string, section: string): string[] {
  const name = HEADER_ARRAYS[section] as string;
  const literal = new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source);
  if (literal === null) {
    throw new Error(
      `${EXCEL_REL}: could not read \`${name}\`. The union check below compares against it, so ` +
        "an unread array would compare two empty sets and pass. Repair this parser rather than " +
        "the assertion.",
    );
  }
  return [...(literal[1] as string).matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

/**
 * `<SECTION>` → the column literals its `refuseIfTooLong` calls name.
 *
 * Comments are stripped first, for the reason {@link executableBodyOf} records:
 * a docblock quoting a call it does not make would otherwise read as a guard.
 */
function guardedColumns(source: string): Map<string, string[]> {
  const collapsed = withoutComments(source).replace(/\s+/g, " ");
  const guarded = new Map<string, string[]>(Object.keys(HEADER_ARRAYS).map((s) => [s, []]));

  for (const match of collapsed.matchAll(
    /\brefuseIfTooLong\(\s*"(LOCATION|RTUS|ASSETS)"\s*,\s*[^,]+,\s*"([^"]+)"/g,
  )) {
    (guarded.get(match[1] as string) as string[]).push(match[2] as string);
  }

  const total = [...guarded.values()].reduce((sum, columns) => sum + columns.length, 0);
  if (total === 0) {
    throw new Error(
      `${EXCEL_REL}: found no \`refuseIfTooLong\` call sites. Every column would then read as ` +
        "unguarded, or — worse, if the header scan broke too — the union would compare two " +
        "empty sets. Repair this parser rather than the assertion.",
    );
  }
  return guarded;
}

/**
 * `F4.104` — every workbook column the upload parses is guarded or is written
 * down as exempt.
 *
 * This is the gate `F4.102` cost three passes for want of: that row bounded the
 * echo surface one site at a time, and the fifth site was found only after
 * twelve reverts had each looked green. A revert check cannot prove
 * enumeration; comparing the guarded set against the source's own header arrays
 * can, because a column added to a header array with no guard fails here before
 * anybody writes a workbook.
 */
describe("F4.104 — every parsed workbook column is bounded or written down as exempt", () => {
  it("guards or exempts every column of all three header arrays, and nothing else", () => {
    const source = read(EXCEL_REL);
    const guarded = guardedColumns(source);

    for (const section of Object.keys(HEADER_ARRAYS)) {
      const headers = headerColumns(source, section);
      const bounded = (guarded.get(section) as string[]).flatMap(
        (column) => COMPOSITE_COLUMNS[column] ?? [column],
      );
      const elsewhere = Object.keys(BOUNDED_ELSEWHERE[section] ?? {});
      const exempt = Object.keys(EXEMPT_COLUMNS[section] ?? {});
      const covered = [...bounded, ...elsewhere, ...exempt];

      expect(
        [...covered].sort(),
        `${EXCEL_REL}: every column of \`${HEADER_ARRAYS[section]}\` must be bounded at the ` +
          "parse site, bounded by a named check elsewhere, or listed as exempt with a reason — " +
          "and each exactly once",
      ).toEqual([...headers].sort());
    }
  });

  /**
   * Non-vacuity for the header scan, in a case of its own rather than as the
   * first assertion of the union above.
   *
   * Measured: inserting an unguarded `"asset_notes"` into `ASSET_HEADERS` made
   * a combined case fail on `expected 6 to be 5` — a message that says the
   * parser is broken — while the union check, which names the column and says
   * what to do about it, never ran. Split, the same mutation reddens both and
   * the useful sentence is in the output.
   */
  it("still reads all three header arrays", () => {
    const source = read(EXCEL_REL);
    for (const section of Object.keys(HEADER_ARRAYS)) {
      expect(
        headerColumns(source, section).length,
        `${EXCEL_REL}: \`${HEADER_ARRAYS[section]}\` no longer reads as ` +
          `${HEADER_COUNTS[section]} columns. If the array really did change, update this ` +
          "count with the guard or the exemption the new column needs; if it did not, repair " +
          "the parser — an empty read would make the union check above vacuous",
      ).toBe(HEADER_COUNTS[section]);
    }
  });

  it("keeps the checks the two `bounded elsewhere` columns depend on, as code and not as prose", () => {
    const source = read(EXCEL_REL);
    for (const [section, columns] of Object.entries(BOUNDED_ELSEWHERE)) {
      const body = executableBodyOf(source, BOUNDED_ELSEWHERE_METHOD[section] as string);
      for (const [column, mechanism] of Object.entries(columns)) {
        expect(
          body.includes(mechanism),
          `${EXCEL_REL}: \`${column}\` of ${section} is listed as bounded by \`${mechanism}\` ` +
            "rather than by a cell-length guard. If that check is gone the column is unbounded, " +
            "and the union check above would still pass — this case is what stops that. The " +
            "search runs over the method's body with every comment removed, so a comment " +
            "quoting the deleted expression does not hold this green",
        ).toBe(true);
      }
    }
  });

  it("bounds `username` and `password` with one composite guard, never two", () => {
    const guarded = guardedColumns(read(EXCEL_REL));
    const rtus = guarded.get("RTUS") as string[];

    expect(
      rtus,
      "the credential guard must name both cells at once — owner ruling 5: naming the longer " +
        "of the two would tell a reader of the 400 whether a password was set on that row",
    ).toContain("username or password");

    for (const column of ["username", "password"]) {
      expect(
        rtus,
        `\`${column}\` must NOT be guarded on its own. Splitting the composite message is how a ` +
          "naive reading of the union check above gets 'fixed', and it undoes owner ruling 5",
      ).not.toContain(column);
    }
  });
});
