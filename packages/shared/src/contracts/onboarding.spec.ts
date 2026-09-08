import { z } from "zod";

import {
  MAX_ONBOARDING_ASSET_POINTS,
  MAX_ONBOARDING_ASSETS,
  MAX_ONBOARDING_POINT_KEYS,
  MAX_ONBOARDING_RTUS,
  ONBOARDING_DRAFT_STRING_MAX,
  onboardingDraftAssetPointSchema,
  onboardingDraftAssetSchema,
  onboardingDraftLocationSchema,
  onboardingDraftPointKeySchema,
  onboardingDraftRtuSchema,
  onboardingDraftSchema,
  onboardingSessionDtoSchema,
} from "./onboarding";
import { assetDomainCodeSchema } from "./operations";

/**
 * `F4.103` — the four draft arrays carry a count cap.
 *
 * Assertions live here; `onboarding.test.ts` is the vitest entry point
 * (ADR 0014). Everything below is a plain object and needs no connection.
 *
 * **Every fixture length is written as `MAX_…` or `MAX_… + 1`, never as the
 * literal the constant holds today.** A restated `500` still passes once the
 * constant moves, and from that moment the test vouches for nothing — the
 * `F4.102` lesson, applied before it can be repeated here.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const rtuAt = (i: number) => ({
  code: `RTU-${i}`,
  displayName: `RTU ${i}`,
  protocol: "mqtt" as const,
  config: {},
});

const pointKeyAt = (i: number) => ({ code: `pk_${i}`, name: `Point ${i}` });

const assetAt = (i: number) => ({
  rtuIndex: 0,
  code: `ASSET-${i}`,
  name: `Asset ${i}`,
  siteName: "Site",
  domain: "electrical",
});

const assetPointAt = (i: number) => ({
  assetIndex: 0,
  pointKey: `pk_${i}`,
  sourceDataKey: `src_${i}`,
});

/** `n` items from `build`, so a fixture length is always an expression of the cap. */
function times<T>(n: number, build: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => build(i));
}

/**
 * The at-cap parse is not decoration — it is what proves `cap + 1` failed for
 * the length and not because the fixture item was quietly invalid. The two
 * assertions only mean anything as a pair.
 */
function assertArrayCap(
  field: "rtus" | "pointKeys" | "assets" | "assetPoints",
  cap: number,
  build: (i: number) => unknown,
): void {
  assert(
    typeof cap === "number" && Number.isInteger(cap) && cap > 0,
    `${field}'s cap must be a positive integer, got ${String(cap)} — a stale @bms/shared dist ` +
      "makes it `undefined`, and `z.array(x).max(undefined)` refuses nothing at all",
  );

  const atCap = onboardingDraftSchema.safeParse({ [field]: times(cap, build) });
  assert(
    atCap.success,
    `a draft holding exactly the cap of ${field} must parse, got: ` +
      (atCap.success ? "" : JSON.stringify(atCap.error.issues[0])),
  );

  const overCap = onboardingDraftSchema.safeParse({ [field]: times(cap + 1, build) });
  assert(!overCap.success, `a draft holding cap + 1 ${field} must be refused`);
  assert(
    !overCap.success &&
      overCap.error.issues.some((issue) => issue.code === "too_big" && issue.path[0] === field),
    `the refusal must be a \`too_big\` on \`${field}\` itself, not an item-shape error: ` +
      (overCap.success ? "" : JSON.stringify(overCap.error.issues)),
  );
}

/**
 * `F4.103` — the count cap on the four draft arrays, in the shared contract.
 *
 * This is the copy ADR 0030 makes every response type `z.infer` of, so it is
 * also the copy `apps/web` parses a session and a validate preview through.
 * The API keeps its own copy in `apps/api/src/admin/onboarding/onboarding.schema.ts`;
 * `tests/f4.103-draft-count-caps.test.ts` is what stops the two drifting.
 */
export function assertDraftArrayCapsAreEnforced(): void {
  assertArrayCap("rtus", MAX_ONBOARDING_RTUS, rtuAt);
  assertArrayCap("pointKeys", MAX_ONBOARDING_POINT_KEYS, pointKeyAt);
  assertArrayCap("assets", MAX_ONBOARDING_ASSETS, assetAt);
  assertArrayCap("assetPoints", MAX_ONBOARDING_ASSET_POINTS, assetPointAt);

  // A draft at every cap at once still parses. Without this the four checks
  // above are all satisfiable by a schema that refuses everything.
  const atEveryCap = onboardingDraftSchema.safeParse({
    rtus: times(MAX_ONBOARDING_RTUS, rtuAt),
    pointKeys: times(MAX_ONBOARDING_POINT_KEYS, pointKeyAt),
    assets: times(MAX_ONBOARDING_ASSETS, assetAt),
    assetPoints: times(MAX_ONBOARDING_ASSET_POINTS, assetPointAt),
  });
  assert(
    atEveryCap.success,
    "a draft at all four caps simultaneously must parse — the caps are a ceiling, not a target",
  );

  // The declaration order is load-bearing, so it is gated rather than claimed
  // in a comment: zod reports an object's issues in key-declaration order, so a
  // draft breaching two caps fails first on `rtus`. This is the schema-level
  // half of the ordering only; which section of a *workbook* is refused first
  // is a separate question, decided on the upload path, which does not parse
  // this schema at all.
  const overTwoCaps = onboardingDraftSchema.safeParse({
    rtus: times(MAX_ONBOARDING_RTUS + 1, rtuAt),
    assetPoints: times(MAX_ONBOARDING_ASSET_POINTS + 1, assetPointAt),
  });
  assert(
    !overTwoCaps.success && overTwoCaps.error.issues[0]?.path[0] === "rtus",
    "a draft over both the RTU and the asset-point cap must report `rtus` first: " +
      (overTwoCaps.success ? "it parsed" : JSON.stringify(overTwoCaps.error.issues)),
  );
}

/**
 * The cap reaches the **response** contract, not only the bare draft schema.
 *
 * `onboardingDraftSchema` is embedded in `onboardingSessionDtoSchema.draft` and
 * in `onboardingValidateResponseDtoSchema.preview`, and `apps/web` parses both
 * at runtime (ADR 0030 decision 5). Gating that reach here rather than implying
 * it is the difference between knowing where the bound applies and hoping.
 */
export function assertSessionDtoCarriesTheCaps(): void {
  const session = (draft: unknown) => ({
    id: "s1",
    organizationId: "o1",
    organizationCode: "ORG",
    organizationName: "Org",
    status: "draft",
    currentPhase: "rtu",
    draft,
    messages: [],
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    committedAt: null,
    result: null,
  });

  assert(
    onboardingSessionDtoSchema.safeParse(session({ rtus: times(MAX_ONBOARDING_RTUS, rtuAt) }))
      .success,
    "a session DTO whose draft is exactly at the RTU cap must parse",
  );

  const overCap = onboardingSessionDtoSchema.safeParse(
    session({ rtus: times(MAX_ONBOARDING_RTUS + 1, rtuAt) }),
  );
  assert(
    !overCap.success &&
      overCap.error.issues.some(
        (issue) =>
          issue.code === "too_big" && issue.path[0] === "draft" && issue.path[1] === "rtus",
      ),
    "an over-cap draft must be refused inside the session DTO too, at `draft.rtus`: " +
      (overCap.success ? "it parsed" : JSON.stringify(overCap.error.issues)),
  );
}

/* -------------------------------------------------------------------------- *
 * `F4.104` — the per-field string bounds.                                      *
 * -------------------------------------------------------------------------- */

/**
 * The five draft sub-schemas, under the prefix `ONBOARDING_DRAFT_STRING_MAX`
 * keys them by.
 *
 * Walking these rather than hand-listing 24 field names is what makes the
 * record's *coverage* checkable: a string field added to any sub-schema and not
 * to the record is a key the walk finds and the record lacks, and a key in the
 * record binding nothing is the same failure read the other way. A hand-written
 * list would agree with itself forever.
 */
const DRAFT_SUB_SCHEMAS: readonly (readonly [string, Record<string, z.ZodTypeAny>])[] = [
  ["location", onboardingDraftLocationSchema.shape],
  ["rtus", onboardingDraftRtuSchema.shape],
  ["pointKeys", onboardingDraftPointKeySchema.shape],
  ["assets", onboardingDraftAssetSchema.shape],
  ["assetPoints", onboardingDraftAssetPointSchema.shape],
];

/**
 * The number of string fields those five schemas hold between them —
 * 5 + 6 + 5 + 4 + 4.
 *
 * **Written as a literal on purpose: it is the non-vacuity anchor** (AGENTS.md
 * §4.4). Both key-set comparisons below are satisfied by two empty sets, so a
 * zod upgrade that reshaped `_def` would silently turn `stringFieldsOf` into a
 * function returning nothing and every assertion here would pass having read
 * no schema at all. Repair the walk when this number is what fails; do not
 * adjust the number to match a broken walk.
 */
const DRAFT_STRING_FIELD_COUNT = 24;

/** Only the wrappers zod puts *outside* the string: `.optional()`, `.default()`, `.nullable()`. */
function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (let depth = 0; depth < 8; depth += 1) {
    const def: { typeName?: string; innerType?: z.ZodTypeAny } = current._def;
    if (
      def.innerType === undefined ||
      (def.typeName !== "ZodOptional" &&
        def.typeName !== "ZodDefault" &&
        def.typeName !== "ZodNullable")
    ) {
      return current;
    }
    current = def.innerType;
  }
  return current;
}

/**
 * `_def.typeName` and not `instanceof z.ZodString`. `assets.domain` is
 * `assetDomainCodeSchema`, and in the API copy of this walk that schema arrives
 * from `@bms/shared`'s built `dist` — a second physical `zod` module there
 * would make `instanceof` false and drop the field from the walk silently. A
 * string tag compares the same across module instances.
 */
function asZodString(schema: z.ZodTypeAny): z.ZodString | null {
  const unwrapped = unwrapSchema(schema);
  const def: { typeName?: string } = unwrapped._def;
  return def.typeName === "ZodString" ? (unwrapped as z.ZodString) : null;
}

/** Every string field of one sub-schema, keyed as `<prefix>.<field>`. */
function stringFieldsOf(
  prefix: string,
  shape: Record<string, z.ZodTypeAny>,
): Map<string, z.ZodString> {
  const found = new Map<string, z.ZodString>();
  for (const [field, schema] of Object.entries(shape)) {
    const asString = asZodString(schema);
    if (asString !== null) {
      found.set(`${prefix}.${field}`, asString);
    }
  }
  return found;
}

/** Every string field of all five sub-schemas. */
function allDraftStringFields(): Map<string, z.ZodString> {
  const found = new Map<string, z.ZodString>();
  for (const [prefix, shape] of DRAFT_SUB_SCHEMAS) {
    for (const [key, schema] of stringFieldsOf(prefix, shape)) {
      found.set(key, schema);
    }
  }
  return found;
}

/**
 * The record's values, before anything is compared against them.
 *
 * **This guard runs first, and the order is the whole point.** Measured on zod
 * 3.25.76: `z.string().max(undefined)` refuses nothing and reports
 * `maxLength === undefined`. So a key missing from the record, or misspelled at
 * a call site, produces an unbounded field whose `maxLength` is `undefined` —
 * and an equality check against the same `undefined` passes. Every assertion in
 * this file that reads a bound would then be green over a schema bounding
 * nothing. A stale `@bms/shared` dist is the other way in to the same state.
 */
function assertEveryBoundIsUsable(bounds: Readonly<Record<string, number>>): void {
  for (const [key, value] of Object.entries(bounds)) {
    assert(
      typeof value === "number" && Number.isInteger(value) && value > 0,
      `ONBOARDING_DRAFT_STRING_MAX["${key}"] must be a positive integer, got ${String(value)} — ` +
        "`z.string().max(undefined)` refuses nothing at all, so an unusable bound here makes " +
        "every length assertion below vacuous rather than red",
    );
  }
}

/**
 * `F4.104` — the draft's string bounds are declared once, and they cover every
 * string field of the draft.
 *
 * The numbers themselves are the width of the column each field commits to, and
 * that pin is executable in `apps/api/src/admin/onboarding/onboarding.schema.spec.ts`
 * rather than here: this package depends on `zod` and nothing else, so it cannot
 * import `@bms/db` to read a column. What is gated here is the shape of the
 * record and its coverage of the schema.
 */
export function assertDraftStringBoundsAreDeclaredOnce(): void {
  const bounds: Readonly<Record<string, number>> = ONBOARDING_DRAFT_STRING_MAX;
  assertEveryBoundIsUsable(bounds);

  const fields = allDraftStringFields();
  assert(
    fields.size === DRAFT_STRING_FIELD_COUNT,
    `the five draft sub-schemas must hold ${DRAFT_STRING_FIELD_COUNT} string fields, the walk ` +
      `found ${fields.size} (${[...fields.keys()].join(", ") || "none"}). If the schemas really ` +
      "changed, move this number with them; if they did not, repair `stringFieldsOf` rather " +
      "than the assertion — an empty walk satisfies both comparisons below.",
  );

  // Compared both ways. A subset check in one direction alone is passed by a
  // record that names half the fields, and in the other by one that names them
  // all plus three that bind nothing.
  const missing = [...fields.keys()].filter((key) => !(key in bounds));
  assert(
    missing.length === 0,
    `every draft string field must carry a declared bound; missing: ${missing.join(", ")}`,
  );
  const unbound = Object.keys(bounds).filter((key) => !fields.has(key));
  assert(
    unbound.length === 0,
    "every key of ONBOARDING_DRAFT_STRING_MAX must name a real draft string field; these bind " +
      `nothing: ${unbound.join(", ")}`,
  );

  // Q3 — `assets.domain` is the one field whose bound is not this record's to
  // own. It arrives through `assetDomainCodeSchema`, shared with four other
  // vocabularies in `operations.ts`, so the number is pinned to that schema
  // instead of extracted out of it. If the vocabulary bound moves, this fails
  // here rather than at a 400 nobody expected.
  assert(
    bounds["assets.domain"] === assetDomainCodeSchema.maxLength,
    "ONBOARDING_DRAFT_STRING_MAX[\"assets.domain\"] must equal `assetDomainCodeSchema.maxLength` " +
      `— the record says ${String(bounds["assets.domain"])}, the vocabulary schema says ` +
      `${String(assetDomainCodeSchema.maxLength)}`,
  );
}

/**
 * `F4.104` — the bounds are length-only on this copy, and they are attached.
 *
 * **This is the *response* contract**, embedded in `onboardingSessionDtoSchema`
 * and `onboardingValidateResponseDtoSchema` and parsed at runtime by
 * `apps/web/src/api/admin/onboarding.ts` (ADR 0030 decision 5). A `.min()`,
 * a `.trim()` or a regex here would refuse a legitimately partial draft **on
 * read** — ADR 0011's whole shape, stated in this file's head docblock. So the
 * `minLength` half below is not decoration: it is the constraint that says what
 * this copy may never acquire.
 */
export function assertDraftStringBoundsAreEnforced(): void {
  const bounds: Readonly<Record<string, number>> = ONBOARDING_DRAFT_STRING_MAX;
  assertEveryBoundIsUsable(bounds);

  const fields = allDraftStringFields();
  assert(
    fields.size === DRAFT_STRING_FIELD_COUNT,
    `the walk must find all ${DRAFT_STRING_FIELD_COUNT} string fields before comparing bounds, ` +
      `found ${fields.size}`,
  );

  for (const [key, schema] of fields) {
    assert(
      schema.maxLength === bounds[key],
      `${key} must be bounded at ONBOARDING_DRAFT_STRING_MAX["${key}"] (${String(bounds[key])}), ` +
        `the schema reports ${String(schema.maxLength)}`,
    );

    // Length only. `assets.domain` is the single exception and it is not an
    // exception this file grants — `assetDomainCodeSchema` is `.min(1).max(64)`
    // and is shared with four other vocabularies.
    const expectedMin = key === "assets.domain" ? assetDomainCodeSchema.minLength : null;
    assert(
      schema.minLength === expectedMin,
      `${key} must carry no minimum on the response contract (expected ` +
        `${String(expectedMin)}, got ${String(schema.minLength)}) — a draft is legitimately ` +
        "partial until it commits, and this copy is what the client parses a stored draft " +
        "through. Bound the length here; refuse incompleteness in the validator, not on read.",
    );
  }

  // The metadata above says the check exists. These say it fires, and on the
  // field the caller named — a bound attached to the wrong field reads
  // identically from `maxLength`.
  const location = {
    code: "LOC",
    slug: "loc",
    name: "Loc",
    type: "smoc_campus" as const,
    latitude: 0,
    longitude: 0,
  };
  const representatives: readonly (readonly [string, string, (value: string) => unknown])[] = [
    ["location", "name", (value) => ({ location: { ...location, name: value } })],
    ["rtus", "code", (value) => ({ rtus: [{ ...rtuAt(0), code: value }] })],
    [
      "pointKeys",
      "description",
      (value) => ({ pointKeys: [{ ...pointKeyAt(0), description: value }] }),
    ],
    ["assets", "siteName", (value) => ({ assets: [{ ...assetAt(0), siteName: value }] })],
    [
      "assetPoints",
      "pointKey",
      (value) => ({ assetPoints: [{ ...assetPointAt(0), pointKey: value }] }),
    ],
  ];

  for (const [section, field, build] of representatives) {
    const max = bounds[`${section}.${field}`] as number;

    const atBound = onboardingDraftSchema.safeParse(build("x".repeat(max)));
    assert(
      atBound.success,
      `a draft whose ${section}.${field} is exactly ${max} characters must parse, got: ` +
        (atBound.success ? "" : JSON.stringify(atBound.error.issues[0])),
    );

    const overBound = onboardingDraftSchema.safeParse(build("x".repeat(max + 1)));
    assert(
      !overBound.success &&
        overBound.error.issues.some(
          (issue) =>
            issue.code === "too_big" &&
            issue.path[0] === section &&
            issue.path[issue.path.length - 1] === field,
        ),
      `one character over must be refused with a \`too_big\` naming ${section}…${field}: ` +
        (overBound.success ? "it parsed" : JSON.stringify(overBound.error.issues)),
    );
  }
}

/**
 * The bound reaches the **response** contract, not only the bare draft schema —
 * the same reach `assertSessionDtoCarriesTheCaps` gates for the count caps, and
 * for the same reason: `apps/web` parses a session through this schema at
 * runtime, so this is where an over-long stored string would surface.
 */
export function assertSessionDtoCarriesTheStringBounds(): void {
  const bounds: Readonly<Record<string, number>> = ONBOARDING_DRAFT_STRING_MAX;
  assertEveryBoundIsUsable(bounds);

  const max = bounds["rtus.displayName"] as number;
  const session = (displayName: string) => ({
    id: "s1",
    organizationId: "o1",
    organizationCode: "ORG",
    organizationName: "Org",
    status: "draft",
    currentPhase: "rtu",
    draft: { rtus: [{ ...rtuAt(0), displayName }] },
    messages: [],
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    committedAt: null,
    result: null,
  });

  assert(
    onboardingSessionDtoSchema.safeParse(session("x".repeat(max))).success,
    `a session DTO whose rtus[0].displayName is exactly ${max} characters must parse`,
  );

  const overBound = onboardingSessionDtoSchema.safeParse(session("x".repeat(max + 1)));
  assert(
    !overBound.success &&
      overBound.error.issues.some(
        (issue) =>
          issue.code === "too_big" && issue.path[0] === "draft" && issue.path[1] === "rtus",
      ),
    "an over-long string must be refused inside the session DTO too, under `draft.rtus`: " +
      (overBound.success ? "it parsed" : JSON.stringify(overBound.error.issues)),
  );
}
