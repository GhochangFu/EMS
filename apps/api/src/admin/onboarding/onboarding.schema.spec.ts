import { assetPoints, assets, locations, pointKeys, rtus } from "@bms/db";
import {
  assetDomainCodeSchema,
  MAX_ONBOARDING_ASSET_POINTS,
  MAX_ONBOARDING_ASSETS,
  MAX_ONBOARDING_POINT_KEYS,
  MAX_ONBOARDING_RTUS,
  ONBOARDING_DRAFT_STRING_MAX,
} from "@bms/shared";
import { z } from "zod";

import { createPointKeyBodySchema } from "../point-keys/point-keys.schema";
import { exceedsDepth } from "../stack-safe-json";

import {
  DRAFT_TOO_DEEP_MESSAGE,
  draftAssetPointSchema,
  draftAssetSchema,
  draftLocationSchema,
  draftPointKeySchema,
  draftRtuSchema,
  MAX_ONBOARDING_DRAFT_DEPTH,
  onboardingDraftSchema,
  patchDraftBodySchema,
} from "./onboarding.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Lightweight schema checks for onboarding DTOs. */
export function runOnboardingSchemaTests(): void {
  const loc = draftLocationSchema.parse({
    code: "DEMO_LOC",
    slug: "demo-loc",
    name: "Demo Location",
    type: "smoc_campus",
    latitude: -25.7,
    longitude: 28.2,
  });
  assert(loc.code === "DEMO_LOC", "location code parsed");

  const draft = onboardingDraftSchema.parse({
    location: loc,
    rtus: [
      {
        code: "RTU-1",
        displayName: "RTU 1",
        protocol: "mqtt",
        config: { topic: "phe/test" },
        credentialsSet: true,
      },
    ],
  });
  assert(draft.rtus?.length === 1, "draft rtus parsed");

  const bad = onboardingDraftSchema.safeParse({ location: { code: "bad slug!" } });
  assert(!bad.success, "invalid location rejected");
}

/**
 * `E7.1f` — the draft subtree must stay permissive, and here is why in tests.
 *
 * Both cases below were **live regressions** in the first cut of `E7.1f`, which
 * made this subtree `.strict()`. Neither was visible to `pnpm test`: `_secrets`
 * is only written when `CREDENTIAL_ENCRYPTION_KEY` holds a 32-byte key, and CI
 * does not set it. They are pinned here so the next person to reach for
 * `.strict()` on these schemas gets a red test instead of a deadlocked wizard.
 */
export function runDraftStaysPermissiveTests(): void {
  // 1. The STORED draft carries `_secrets` (onboarding-redaction.ts:290) and is
  //    re-parsed by OnboardingValidateService. Strict rejected it, `validate`
  //    returned before the cross-field checks, and `readyToCommit` could never
  //    become true again — while an MQTT ingest RTU is separately refused
  //    unless `credentialsSet` is true. Setting the credential was what broke
  //    the parse, so the ADR 0022 pilot flow deadlocked.
  const stored = onboardingDraftSchema.safeParse({
    location: {
      code: "DEMO_LOC",
      slug: "demo-loc",
      name: "Demo Location",
      type: "smoc_campus",
      latitude: -25.7,
      longitude: 28.2,
    },
    _secrets: { "RTU-1": { ciphertext: "…", iv: "…", tag: "…" } },
  });
  assert(
    stored.success,
    "a STORED draft carrying `_secrets` must parse. If this fails, onboarding can never " +
      "commit once any RTU credential is set (ADR 0022).",
  );
  assert(
    stored.success && !("_secrets" in stored.data),
    "`_secrets` must be stripped from the parsed result, never carried into it — the " +
      "encrypted store is not part of the draft contract",
  );

  // 2. The model's `draftPatch` (onboarding-chat.service.ts:238) is parsed with
  //    `.data ?? {}`. Under strict, one invented key discarded the operator's
  //    whole turn while the assistant still answered "I've updated the draft".
  const modelPatch = onboardingDraftSchema.safeParse({
    location: {
      code: "DEMO_LOC",
      slug: "demo-loc",
      name: "Demo Location",
      type: "smoc_campus",
      latitude: -25.7,
      longitude: 28.2,
      country: "India",
    },
  });
  assert(
    modelPatch.success,
    "a model-invented key nested inside the draft must be STRIPPED, not rejected. " +
      "Rejecting it discards the whole turn silently, which is worse than the 200 E7.1f " +
      "set out to fix.",
  );
  assert(
    modelPatch.success && !("country" in (modelPatch.data.location ?? {})),
    "the invented key must not survive into the merged draft — that is the M2 protection",
  );

  // 3. What IS still closed: the wrapper declares only `draft`, so nothing can
  //    ride alongside it. This is the half of the guarantee E7.1f keeps here.
  assert(
    !patchDraftBodySchema.safeParse({ draft: {}, _secrets: {} }).success,
    "the PATCH wrapper must refuse a sibling of `draft` — it declares only that one key",
  );
}

/** `n` items from `build`, so a fixture length is always an expression of the cap. */
function times<T>(n: number, build: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => build(i));
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

/**
 * `F4.103` — the API copy of the draft schema carries the same four count caps.
 *
 * **This is a second copy of the bound, deliberately.** ADR 0030 makes
 * `packages/shared/src/contracts/onboarding.ts` the schema every *response*
 * type is `z.infer`red from, and this file is the one the *write* path parses:
 * `patchDraftBodySchema` at `onboarding.controller.ts`, and the stored draft
 * re-parsed by `OnboardingValidateService.validate`. Bounding one and not the
 * other typechecks and passes both package suites, so
 * `tests/f4.103-draft-count-caps.test.ts` compares the two files' declarations
 * directly. What is asserted here is that this copy enforces its half.
 *
 * Every fixture length is `MAX_…` or `MAX_… + 1`, never the literal the
 * constant holds today — `F4.102`'s lesson. And every over-cap refusal is
 * paired with an at-cap parse, which is what proves the refusal came from the
 * length rather than from a quietly invalid fixture item.
 */
export function runDraftCountCapTests(): void {
  // `apps/api` reads these through `@bms/shared`'s built `dist`. A stale build
  // makes them `undefined`, `z.array(x).max(undefined)` then refuses nothing,
  // and every assertion below fails for a reason that explains nothing. This
  // one says it out loud instead.
  for (const [name, cap] of [
    ["MAX_ONBOARDING_RTUS", MAX_ONBOARDING_RTUS],
    ["MAX_ONBOARDING_POINT_KEYS", MAX_ONBOARDING_POINT_KEYS],
    ["MAX_ONBOARDING_ASSETS", MAX_ONBOARDING_ASSETS],
    ["MAX_ONBOARDING_ASSET_POINTS", MAX_ONBOARDING_ASSET_POINTS],
  ] as const) {
    assert(
      typeof cap === "number" && Number.isInteger(cap) && cap > 0,
      `${name} must be a positive integer, got ${String(cap)} — rebuild @bms/shared`,
    );
  }

  const cases: readonly (readonly [string, number, (i: number) => unknown])[] = [
    ["rtus", MAX_ONBOARDING_RTUS, rtuAt],
    ["pointKeys", MAX_ONBOARDING_POINT_KEYS, pointKeyAt],
    ["assets", MAX_ONBOARDING_ASSETS, assetAt],
    ["assetPoints", MAX_ONBOARDING_ASSET_POINTS, assetPointAt],
  ];

  for (const [field, cap, build] of cases) {
    const atCap = onboardingDraftSchema.safeParse({ [field]: times(cap, build) });
    assert(
      atCap.success,
      `a draft holding exactly the cap of ${field} must parse, got: ` +
        (atCap.success ? "" : JSON.stringify(atCap.error.issues[0])),
    );

    const overCap = onboardingDraftSchema.safeParse({ [field]: times(cap + 1, build) });
    assert(
      !overCap.success &&
        overCap.error.issues.some((issue) => issue.code === "too_big" && issue.path[0] === field),
      `a draft holding cap + 1 ${field} must be refused with a \`too_big\` on \`${field}\`: ` +
        (overCap.success ? "it parsed" : JSON.stringify(overCap.error.issues)),
    );
  }

  // The live write path. `onboarding.controller.ts` calls
  // `patchDraftBodySchema.parse(body)` and turns the `ZodError` into a 400, so
  // this is the assertion that says `PATCH :id/draft` cannot store an over-cap
  // array at all.
  assert(
    !patchDraftBodySchema.safeParse({
      draft: { rtus: times(MAX_ONBOARDING_RTUS + 1, rtuAt) },
    }).success,
    "PATCH :id/draft must refuse a body whose draft holds more than the RTU cap",
  );
  assert(
    patchDraftBodySchema.safeParse({ draft: { rtus: times(MAX_ONBOARDING_RTUS, rtuAt) } }).success,
    "PATCH :id/draft must still accept a body exactly at the RTU cap",
  );

  // A draft at every cap at once still parses. The regression direction: without
  // it, a future tightening satisfies all four cases above by refusing
  // everything, and nothing here goes red.
  assert(
    onboardingDraftSchema.safeParse({
      rtus: times(MAX_ONBOARDING_RTUS, rtuAt),
      pointKeys: times(MAX_ONBOARDING_POINT_KEYS, pointKeyAt),
      assets: times(MAX_ONBOARDING_ASSETS, assetAt),
      assetPoints: times(MAX_ONBOARDING_ASSET_POINTS, assetPointAt),
    }).success,
    "a draft at all four caps simultaneously must parse — the caps are a ceiling, not a target",
  );
}

/* -------------------------------------------------------------------------- *
 * `F4.104` — the per-field string bounds, on the copy the write path parses.   *
 * -------------------------------------------------------------------------- */

/** The five draft sub-schemas, under the prefix `ONBOARDING_DRAFT_STRING_MAX` keys them by. */
const DRAFT_SUB_SCHEMAS: readonly (readonly [string, Record<string, z.ZodTypeAny>])[] = [
  ["location", draftLocationSchema.shape],
  ["rtus", draftRtuSchema.shape],
  ["pointKeys", draftPointKeySchema.shape],
  ["assets", draftAssetSchema.shape],
  ["assetPoints", draftAssetPointSchema.shape],
];

/**
 * 5 + 6 + 5 + 4 + 4. The non-vacuity anchor: every key-set comparison below is
 * satisfied by two empty sets, so a walk that silently stops finding fields
 * would make this whole function green having read nothing. Repair the walk,
 * not the number.
 */
const DRAFT_STRING_FIELD_COUNT = 24;

/**
 * The minimum each string field of **this** copy carries, and it is written out
 * rather than derived because it is the constraint, not an observation.
 *
 * `F4.104` is a length change and nothing else: no field may gain a `.min()`
 * and none may lose one. A bound applied by rewriting a chain is exactly the
 * edit that drops a `.min(2)` by accident, and `maxLength` cannot see it.
 * `null` is what zod reports for a string with no minimum.
 *
 * These are not the same as the shared response copy, which carries no minimum
 * at all (ADR 0011 — a draft is legitimately partial until it commits, and that
 * copy is what a stored draft is read back through).
 */
const EXPECTED_MIN_LENGTH: Readonly<Record<string, number | null>> = {
  "location.code": 2,
  "location.slug": 2,
  "location.name": 2,
  "location.province": null,
  "location.capital": null,
  "rtus.code": 2,
  "rtus.displayName": 2,
  "rtus.domain": null,
  "rtus.rtuCode": null,
  "rtus.stationCode": null,
  "rtus.stationName": null,
  "pointKeys.code": 1,
  "pointKeys.name": 1,
  "pointKeys.domain": null,
  "pointKeys.unit": null,
  "pointKeys.description": null,
  "assets.code": 2,
  "assets.name": 2,
  "assets.siteName": 2,
  // `assetDomainCodeSchema`, not an inlined bound — see `runDraftStringBoundTests`.
  "assets.domain": 1,
  "assetPoints.pointKey": 1,
  "assetPoints.sourceDataKey": 1,
  "assetPoints.sensorCode": null,
  "assetPoints.unit": null,
};

/**
 * The column each draft string field commits to.
 *
 * **This is the pin the numbers rest on, and it cannot live in
 * `packages/shared`** — that package depends on `zod` and nothing else, so the
 * record's own spec can check its shape but not where its values came from.
 * `apps/api` has `@bms/db` on its dependency graph, and the package's entry
 * exports `createDb` as a factory that opens no connection at import time, so
 * reading a column width here needs no database and no `DATABASE_URL`.
 *
 * Hand-listed, because the prefix-to-table mapping is not derivable from a key.
 * A missing or invented entry is caught by the both-ways key comparison in
 * `runDraftStringBoundTests`, not by anyone re-reading this list.
 */
const DRAFT_COLUMNS: Readonly<Record<string, { readonly columnType: string }>> = {
  "location.code": locations.code,
  "location.slug": locations.slug,
  "location.name": locations.name,
  "location.province": locations.province,
  "location.capital": locations.capital,
  "rtus.code": rtus.code,
  "rtus.displayName": rtus.displayName,
  "rtus.domain": rtus.domain,
  "rtus.rtuCode": rtus.rtuCode,
  "rtus.stationCode": rtus.stationCode,
  "rtus.stationName": rtus.stationName,
  "pointKeys.code": pointKeys.code,
  "pointKeys.name": pointKeys.name,
  "pointKeys.domain": pointKeys.domain,
  "pointKeys.unit": pointKeys.unit,
  "pointKeys.description": pointKeys.description,
  "assets.code": assets.code,
  "assets.name": assets.name,
  "assets.siteName": assets.siteName,
  "assets.domain": assets.domain,
  "assetPoints.pointKey": assetPoints.pointKey,
  "assetPoints.sourceDataKey": assetPoints.sourceDataKey,
  "assetPoints.sensorCode": assetPoints.sensorCode,
  "assetPoints.unit": assetPoints.unit,
};

/** `undefined` for a column that declares no width — `text`, and only `text` here. */
function columnWidth(column: { readonly columnType: string }): number | undefined {
  return "length" in column && typeof column.length === "number" ? column.length : undefined;
}

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
 * `_def.typeName`, not `instanceof z.ZodString`. `assets.domain` is
 * `assetDomainCodeSchema`, built by `@bms/shared`'s own `zod`; if that ever
 * resolves to a second physical module, `instanceof` goes false and the field
 * drops out of the walk without a word. A string tag compares the same either
 * way.
 */
function asZodString(schema: z.ZodTypeAny): z.ZodString | null {
  const unwrapped = unwrapSchema(schema);
  const def: { typeName?: string } = unwrapped._def;
  return def.typeName === "ZodString" ? (unwrapped as z.ZodString) : null;
}

/** Every string field of all five sub-schemas, keyed as `<prefix>.<field>`. */
function allDraftStringFields(): Map<string, z.ZodString> {
  const found = new Map<string, z.ZodString>();
  for (const [prefix, shape] of DRAFT_SUB_SCHEMAS) {
    for (const [field, schema] of Object.entries(shape)) {
      const asString = asZodString(schema);
      if (asString !== null) {
        found.set(`${prefix}.${field}`, asString);
      }
    }
  }
  return found;
}

/** Both directions, so neither a short record nor a record of inventions passes. */
function assertSameKeys(
  actual: readonly string[],
  expected: readonly string[],
  what: string,
): void {
  const missing = expected.filter((key) => !actual.includes(key));
  const extra = actual.filter((key) => !expected.includes(key));
  assert(
    missing.length === 0 && extra.length === 0,
    `${what} — missing: ${missing.join(", ") || "none"}; unexpected: ${extra.join(", ") || "none"}`,
  );
}

/**
 * `F4.104` — the API copy of the draft schema bounds the length of all 24 of
 * its string fields, at the width of the column each one commits to.
 *
 * **This is the copy the write path parses**: `patchDraftBodySchema` at
 * `onboarding.controller.ts`, and the stored draft re-parsed by
 * `OnboardingValidateService.validate`. The bounds themselves are declared once
 * in `packages/shared/src/contracts/onboarding.ts` and imported; what is gated
 * here is that this copy reads them, that the numbers really are the column
 * widths, and that applying them changed nothing else about these schemas.
 *
 * The order below is deliberate. Every value is checked usable before anything
 * is compared against it — measured on zod 3.25.76, `z.string().max(undefined)`
 * refuses nothing and reports `maxLength === undefined`, so a misspelled key or
 * a stale `@bms/shared` dist would otherwise compare `undefined` with
 * `undefined` over an unbounded field and pass.
 */
export function runDraftStringBoundTests(): void {
  const bounds: Readonly<Record<string, number>> = ONBOARDING_DRAFT_STRING_MAX;
  for (const [key, value] of Object.entries(bounds)) {
    assert(
      typeof value === "number" && Number.isInteger(value) && value > 0,
      `ONBOARDING_DRAFT_STRING_MAX["${key}"] must be a positive integer, got ${String(value)} — ` +
        "rebuild @bms/shared; `z.string().max(undefined)` refuses nothing at all",
    );
  }

  const fields = allDraftStringFields();
  assert(
    fields.size === DRAFT_STRING_FIELD_COUNT,
    `the five draft sub-schemas must hold ${DRAFT_STRING_FIELD_COUNT} string fields, the walk ` +
      `found ${fields.size} (${[...fields.keys()].join(", ") || "none"}) — repair the walk ` +
      "rather than the number; an empty walk satisfies every comparison below",
  );

  const keys = [...fields.keys()];
  assertSameKeys(
    Object.keys(bounds),
    keys,
    "ONBOARDING_DRAFT_STRING_MAX must name every string field of this copy, and only those",
  );
  assertSameKeys(
    Object.keys(DRAFT_COLUMNS),
    keys,
    "DRAFT_COLUMNS must name every draft string field, and only those",
  );
  assertSameKeys(
    Object.keys(EXPECTED_MIN_LENGTH),
    keys,
    "EXPECTED_MIN_LENGTH must name every draft string field, and only those",
  );

  for (const [key, schema] of fields) {
    assert(
      schema.maxLength === bounds[key],
      `${key} must read its bound from ONBOARDING_DRAFT_STRING_MAX (${String(bounds[key])}), ` +
        `the schema reports ${String(schema.maxLength)} — a restated literal is the drift ` +
        "`tests/f4.103-draft-count-caps.test.ts` and §4.8 exist to refuse",
    );
    assert(
      schema.minLength === EXPECTED_MIN_LENGTH[key],
      `${key} must keep exactly the minimum it had before F4.104 (expected ` +
        `${String(EXPECTED_MIN_LENGTH[key])}, got ${String(schema.minLength)}) — this row ` +
        "changes lengths and nothing else",
    );
  }

  // The numbers are column widths, and here is the column. `pointKeys.description`
  // is the one field whose column is `text` and supplies nothing, so its premise
  // is executable too rather than only written down.
  for (const [key, column] of Object.entries(DRAFT_COLUMNS)) {
    const width = columnWidth(column);
    if (key === "pointKeys.description") {
      assert(
        column.columnType === "PgText" && width === undefined,
        "the derivation of `pointKeys.description` assumes `bms.point_keys.description` is a " +
          `\`text\` column with no width; it reports ${column.columnType} / ${String(width)}`,
      );
      continue;
    }
    assert(
      width === bounds[key],
      `ONBOARDING_DRAFT_STRING_MAX["${key}"] must be the width of the column the draft commits ` +
        `to — the record says ${String(bounds[key])}, ${column.columnType} says ${String(width)}`,
    );
  }

  // Where 2000 comes from: the sibling route that writes the same column. Its
  // other four fields are byte-for-byte this schema's, which is what makes it a
  // derivation and not a number someone picked.
  const siblingDescription = asZodString(createPointKeyBodySchema.shape.description);
  assert(
    siblingDescription !== null && siblingDescription.maxLength === bounds["pointKeys.description"],
    "`pointKeys.description` is derived from `createPointKeyBodySchema.description`, the route " +
      `writing the same \`text\` column — that schema reports ` +
      `${String(siblingDescription?.maxLength)}, the record says ` +
      `${String(bounds["pointKeys.description"])}`,
  );
  for (const [field, key] of [
    ["code", "pointKeys.code"],
    ["name", "pointKeys.name"],
    ["domain", "pointKeys.domain"],
    ["unit", "pointKeys.unit"],
  ] as const) {
    const sibling = asZodString(createPointKeyBodySchema.shape[field]);
    assert(
      sibling !== null && sibling.maxLength === bounds[key],
      `the derivation above holds only while \`createPointKeyBodySchema.${field}\` matches ` +
        `\`draftPointKeySchema.${field}\` — it reports ${String(sibling?.maxLength)}, the ` +
        `record says ${String(bounds[key])}`,
    );
  }

  // `assets.domain` keeps its vocabulary schema rather than an inlined `.max()`.
  // Pinned to the vocabulary, so the record cannot drift away from the five
  // schemas in `operations.ts` that share it.
  assert(
    fields.get("assets.domain")?.maxLength === assetDomainCodeSchema.maxLength &&
      bounds["assets.domain"] === assetDomainCodeSchema.maxLength,
    "`assets.domain` must stay `assetDomainCodeSchema` in this copy, and the record must agree " +
      `with it — schema ${String(fields.get("assets.domain")?.maxLength)}, record ` +
      `${String(bounds["assets.domain"])}, vocabulary ${String(assetDomainCodeSchema.maxLength)}`,
  );

  // ADR 0022 Amendment 5 — `.trim()` runs before the length check, in
  // declaration order, so `code` is bounded on the trimmed value. `maxLength`
  // is identical whichever order the two checks are in, so only a parse can say
  // which one this is.
  const padded = `  ${"C".repeat(bounds["rtus.code"])}  `;
  const trimmed = draftRtuSchema.safeParse({
    code: padded,
    displayName: "RTU 1",
    protocol: "mqtt",
    config: {},
  });
  assert(
    trimmed.success && trimmed.data.code === "C".repeat(bounds["rtus.code"]),
    "`rtus.code` must still trim before it measures — a code padded to exactly the bound must " +
      "parse and come back trimmed: " +
      (trimmed.success ? JSON.stringify(trimmed.data.code) : JSON.stringify(trimmed.error.issues)),
  );

  // The bound fires, on the field the caller named. `maxLength` says a check
  // exists; only a parse says it is attached to the right field.
  const location = {
    code: "DEMO_LOC",
    slug: "demo-loc",
    name: "Demo Location",
    type: "smoc_campus" as const,
    latitude: -25.7,
    longitude: 28.2,
  };
  const representatives: readonly (readonly [string, string, (value: string) => unknown])[] = [
    ["location", "name", (value) => ({ location: { ...location, name: value } })],
    ["rtus", "stationName", (value) => ({ rtus: [{ ...rtuAt(0), stationName: value }] })],
    [
      "pointKeys",
      "description",
      (value) => ({ pointKeys: [{ ...pointKeyAt(0), description: value }] }),
    ],
    ["assets", "siteName", (value) => ({ assets: [{ ...assetAt(0), siteName: value }] })],
    [
      "assetPoints",
      "sourceDataKey",
      (value) => ({ assetPoints: [{ ...assetPointAt(0), sourceDataKey: value }] }),
    ],
  ];

  for (const [section, field, build] of representatives) {
    const max = bounds[`${section}.${field}`];
    const atBound = onboardingDraftSchema.safeParse(build("x".repeat(max)));
    assert(
      atBound.success,
      `a draft whose ${section}.${field} is exactly ${max} characters must parse: ` +
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

  // The live write path, and the one caller-visible behaviour change this
  // commit makes: `pointKeys[].description` was the single draft string field
  // that no producer bounded, because its column is `text`. `PATCH :id/draft`
  // answered 200 for any length; it now answers 400 past 2000.
  const descriptionMax = bounds["pointKeys.description"];
  const patchWith = (length: number) => ({
    draft: { pointKeys: [{ ...pointKeyAt(0), description: "x".repeat(length) }] },
  });
  assert(
    patchDraftBodySchema.safeParse(patchWith(descriptionMax)).success,
    `PATCH :id/draft must still accept a description of exactly ${descriptionMax} characters`,
  );
  assert(
    !patchDraftBodySchema.safeParse(patchWith(descriptionMax + 1)).success,
    "PATCH :id/draft must refuse a description one character over the bound — before F4.104 " +
      "this body was accepted at any length, and that is the behaviour change",
  );
}

/* -------------------------------------------------------------------------- */
/* F4.115 — the draft's nesting depth                                         */
/* -------------------------------------------------------------------------- */

/**
 * A `config` whose deepest value sits at `depth`, **counting the draft object
 * itself as level 1**.
 *
 * The arithmetic is fixed by the draft skeleton and is the derivation
 * `MAX_ONBOARDING_DRAFT_DEPTH` records: `draft` (1) → `rtus` (2) → `rtus[i]`
 * (3) → `config` (4) → `config`'s own values (5 and below). So a flat `config`
 * — every shipped producer writes one — reaches exactly 5, and each extra wrap
 * adds one level.
 *
 * The nesting is planted under `rtus[].config` and not under an invented
 * top-level key on purpose. `onboardingDraftSchema` is a plain `z.object` with
 * no `.passthrough()`, so zod **strips** an unknown key before any
 * `.superRefine` on the object can see it: a chain under `{ junk: … }` would
 * satisfy the self-check below and then parse successfully, and the off-by-one
 * that appeared to cause would be in the fixture rather than in the schema.
 *
 * Built with a loop; a recursive builder would throw before the schema does.
 */
function configNestedToDepth(depth: number): Record<string, unknown> {
  let node: Record<string, unknown> = { leaf: "x" };
  for (let extra = 0; extra < depth - 5; extra += 1) {
    node = { next: node };
  }
  return node;
}

/** A whole draft whose deepest value sits at `depth`. */
function draftNestedToDepth(depth: number): Record<string, unknown> {
  return {
    rtus: [
      {
        code: "RTU-1",
        displayName: "RTU one",
        protocol: "mqtt",
        config: configNestedToDepth(depth),
      },
    ],
  };
}

/**
 * The fixture builder is itself checked, in both directions, before anything
 * else reads it.
 *
 * Without this an off-by-one in `configNestedToDepth` would make the two parse
 * assertions below vacuous rather than failing: a fixture built one level short
 * of the bound parses, and "the schema accepts a draft at the bound" would pass
 * having tested a draft that is not at the bound.
 */
export function assertDraftDepthFixturesSitExactlyAtTheBound(): void {
  const flat = { rtus: [{ code: "R1", config: { host: "h", port: 1883 } }] };
  assert(
    exceedsDepth(flat, 5) === false && exceedsDepth(flat, 4) === true,
    "the flat config every shipped producer writes reaches exactly five levels",
  );

  const atBound = draftNestedToDepth(MAX_ONBOARDING_DRAFT_DEPTH);
  assert(
    exceedsDepth(atBound, MAX_ONBOARDING_DRAFT_DEPTH) === false,
    "the at-bound fixture must not exceed the bound",
  );
  assert(
    exceedsDepth(atBound, MAX_ONBOARDING_DRAFT_DEPTH - 1) === true,
    "the at-bound fixture must sit exactly AT the bound, not below it",
  );

  const oneDeeper = draftNestedToDepth(MAX_ONBOARDING_DRAFT_DEPTH + 1);
  assert(
    exceedsDepth(oneDeeper, MAX_ONBOARDING_DRAFT_DEPTH) === true,
    "the over-bound fixture must exceed the bound by exactly one level",
  );
  assert(
    exceedsDepth(oneDeeper, MAX_ONBOARDING_DRAFT_DEPTH + 1) === false,
    "the over-bound fixture must not exceed the bound by more than one level",
  );
}

/** A draft sitting exactly at the bound is accepted, not refused. */
export function assertPatchDraftBodyAcceptsADraftAtTheBound(): void {
  const parsed = patchDraftBodySchema.safeParse({
    draft: draftNestedToDepth(MAX_ONBOARDING_DRAFT_DEPTH),
  });
  assert(
    parsed.success,
    "a draft nested exactly to the bound must still be accepted by PATCH :id/draft",
  );
}

/**
 * One level deeper is a 400 naming the limit.
 *
 * `fieldErrors.draft`, **not** `formErrors`, and the difference was measured
 * rather than assumed: the issue is raised path-less on the draft node, and the
 * wrapper prefixes `draft` onto it, so `ZodError.flatten` — which sorts on
 * `path.length > 0` — files it under the field. `apiErrorMessage` renders
 * exactly this shape already; `api-error-message.spec.ts` carries the same body
 * for `F4.103`'s count cap.
 *
 * Every assertion here is about **the parse**. The two that are about the
 * exported sentence moved to `assertTheDepthRefusalSentenceStatesTheLimit`,
 * with an `it()` of their own: they could not run at all once either assertion
 * above them threw, so deleting the `superRefine` reddened this function at its
 * first line and never reached the §4.3 claim.
 */
export function assertPatchDraftBodyRefusesADraftOneDeeper(): void {
  const parsed = patchDraftBodySchema.safeParse({
    draft: draftNestedToDepth(MAX_ONBOARDING_DRAFT_DEPTH + 1),
  });
  assert(!parsed.success, "a draft one level past the bound must be refused");

  const flattened = parsed.success ? null : parsed.error.flatten();
  const draftErrors = flattened?.fieldErrors.draft ?? [];
  assert(
    draftErrors.includes(DRAFT_TOO_DEEP_MESSAGE),
    `the refusal must name the depth limit under fieldErrors.draft, got: ${JSON.stringify(flattened)}`,
  );
}

/**
 * Two claims about the exported sentence itself, and about nothing else.
 *
 * They parse no draft and so cannot be blocked by a parse assertion failing
 * first — which is what they were, appended to
 * `assertPatchDraftBodyRefusesADraftOneDeeper` above. That is `F4.105`'s
 * lesson, now AGENTS.md §4.6: a mutation must redden **the** assertion that
 * owns the claim, and grouping decides whether it is ever reached.
 *
 * - The sentence states the limit, so the caller knows what to flatten to.
 * - It echoes **nothing from the input** (§4.3). The field names in it are
 *   literals from `onboarding.schema.ts` and the only interpolation is the
 *   constant, so the two fixture-only key names below can never appear in it.
 */
export function assertTheDepthRefusalSentenceStatesTheLimit(): void {
  assert(
    DRAFT_TOO_DEEP_MESSAGE.includes(String(MAX_ONBOARDING_DRAFT_DEPTH)),
    "the sentence must state the limit, so the caller knows what to flatten to",
  );
  assert(
    !DRAFT_TOO_DEEP_MESSAGE.includes("leaf") && !DRAFT_TOO_DEEP_MESSAGE.includes("next"),
    "§4.3: the refusal must not echo a key name read from the draft",
  );
}

/**
 * **The assertion that pins the placement**, and the only one that moves if the
 * check is attached to `patchDraftBodySchema` instead.
 *
 * The model's `draftPatch` parses `onboardingDraftSchema` directly
 * (`onboarding-chat.service.ts`) and never touches the wrapper, so on the
 * wrapper alone a deep patch from the model is still merged and stored — and
 * ruling 2a fails for the one producer that emits JSON nobody typed.
 *
 * The residual is the one already ruled acceptable **for that producer and no
 * wider**: an over-deep model patch fails `safeParse`, becomes `{}` through
 * `.data ?? {}`, and the turn is silently dropped. Producer 1 answers a 400 at
 * the controller. Do not generalise it to the other two.
 */
export function assertOnboardingDraftSchemaCoversTheModelProducer(): void {
  assert(
    onboardingDraftSchema.safeParse(draftNestedToDepth(MAX_ONBOARDING_DRAFT_DEPTH)).success,
    "the draft schema itself must accept a draft at the bound",
  );
  assert(
    onboardingDraftSchema.safeParse(draftNestedToDepth(MAX_ONBOARDING_DRAFT_DEPTH + 1)).success ===
      false,
    "the draft schema itself must refuse an over-deep draft, or the model's producer is unguarded",
  );
}

/**
 * The other direction: the guard must not fire where it should not.
 *
 * A draft in the shape the shipped producers actually write — `parseRtus` and
 * `defaultConfig` both emit a flat `config`, and nothing in the repository
 * writes a nested `meta` at all — parses at 100 RTUs with `_secrets` present.
 * `_secrets` is included because a stored draft carries it as soon as any
 * credential is set, and `OnboardingValidateService` re-parses the stored value
 * through this same schema.
 */
export function assertTheShippedProducerShapesStillParse(): void {
  const draft = {
    location: {
      code: "BERHAMPUR",
      slug: "berhampur",
      name: "Berhampur",
      type: "smoc_campus",
      latitude: 19.3,
      longitude: 84.8,
    },
    rtus: Array.from({ length: 100 }, (_unused, index) => ({
      code: `RTU-${index}`,
      displayName: `RTU ${index}`,
      protocol: "mqtt",
      config: { host: "broker.example", port: 8883, tls: true, topic: `site/${index}/data` },
    })),
    _secrets: { "RTU-0": { c: "Y2lwaGVy", iv: "aXY=" } },
  };

  const parsed = onboardingDraftSchema.safeParse(draft);
  assert(
    parsed.success,
    `a draft in the shape the shipped producers write must parse, got: ${
      parsed.success ? "" : JSON.stringify(parsed.error.flatten())
    }`,
  );
  assert(
    patchDraftBodySchema.safeParse({ draft }).success,
    "and the same draft must pass the PATCH :id/draft wrapper",
  );
}
