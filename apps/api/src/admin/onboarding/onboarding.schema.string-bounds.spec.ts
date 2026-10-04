import {
  assetPoints,
  assets,
  assetTemplates,
  locations,
  pointKeys,
  rtus,
  templatePoints,
} from "@bms/db";
import { assetDomainCodeSchema, ONBOARDING_DRAFT_STRING_MAX } from "@bms/shared";
import { z } from "zod";

import { createAssetTemplateBodySchema } from "../asset-templates/asset-templates.schema";
import { createPointKeyBodySchema } from "../point-keys/point-keys.schema";

import {
  draftAssetPointSchema,
  draftAssetSchema,
  draftAssetTemplateRefSchema,
  draftAuthoredTemplateSchema,
  draftLocationSchema,
  draftPointKeySchema,
  draftRtuSchema,
  draftStockTemplateSchema,
  draftTemplatePointSchema,
  onboardingDraftSchema,
  patchDraftBodySchema,
} from "./onboarding.schema";
import { assert, assetAt, assetPointAt, pointKeyAt, rtuAt } from "./onboarding.schema.spec";

/**
 * Moved out of `onboarding.schema.spec.ts` unchanged by `F3.22` (ADR 0091), when
 * the template tables would have taken that file past the 980-line budget the
 * plan sets under the 1,000-line cap of AGENTS.md section 4.5. The fixtures and
 * `assert` are imported from it rather than copied.
 */
/* -------------------------------------------------------------------------- *
 * `F4.104` — the per-field string bounds, on the copy the write path parses.   *
 * -------------------------------------------------------------------------- */

/** The nine draft sub-schemas, under the prefix `ONBOARDING_DRAFT_STRING_MAX` keys them by. */
const DRAFT_SUB_SCHEMAS: readonly (readonly [string, Record<string, z.ZodTypeAny>])[] = [
  ["location", draftLocationSchema.shape],
  ["rtus", draftRtuSchema.shape],
  ["pointKeys", draftPointKeySchema.shape],
  ["assets", draftAssetSchema.shape],
  ["assetPoints", draftAssetPointSchema.shape],
  // F3.22 (ADR 0091 decision 2).
  ["templates", draftAuthoredTemplateSchema.shape],
  ["stockTemplates", draftStockTemplateSchema.shape],
  ["templatePoints", draftTemplatePointSchema.shape],
  ["assetTemplateRef", draftAssetTemplateRefSchema.shape],
];

/**
 * 6 + 6 + 5 + 4 + 4 + 5 + 1 + 4 + 1 — the last four are `F3.22`'s authored template
 * (code, name, assetType, domain, description), stock entry (stockCode),
 * template point (pointKey, label, unit, sourceDataKeyPattern) and template
 * reference (code); record keys and values are not shape fields and are not
 * counted (`location` gained `type` — `F4.157`, D1: `locationTypeCodeSchema`
 * is a `ZodString` under the `.optional()` this copy wraps it in, same as every
 * other optional string field the walk already counts). The non-vacuity
 * anchor: every key-set comparison below is satisfied by two empty sets, so a
 * walk that silently stops finding fields would make this whole function green
 * having read nothing. Repair the walk, not the number.
 */
const DRAFT_STRING_FIELD_COUNT = 36;

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
  // `locationTypeCodeSchema` (`F4.157`, D1) — `.min(1)`, kept, same as `assets.domain`.
  "location.type": 1,
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
  // F3.22 — the minimums of the sibling route (`createAssetTemplateBodySchema`,
  // `templatePointBodySchema`): code, name, asset type and point key are `.min(1)`.
  "templates.code": 1,
  "templates.name": 1,
  "templates.assetType": 1,
  "templates.domain": 1,
  "templates.description": null,
  "stockTemplates.stockCode": 1,
  "templatePoints.pointKey": 1,
  "templatePoints.label": null,
  "templatePoints.unit": null,
  "templatePoints.sourceDataKeyPattern": null,
  "assetTemplateRef.code": 1,
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
  "location.type": locations.type,
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
  "templates.code": assetTemplates.code,
  "templates.name": assetTemplates.name,
  "templates.assetType": assetTemplates.assetType,
  "templates.domain": assetTemplates.domain,
  "templates.description": assetTemplates.description,
  "stockTemplates.stockCode": assetTemplates.stockCode,
  "templatePoints.pointKey": templatePoints.pointKey,
  "templatePoints.label": templatePoints.label,
  "templatePoints.unit": templatePoints.unit,
  "templatePoints.sourceDataKeyPattern": templatePoints.sourceDataKeyPattern,
  // The reference resolves through the template's own code.
  "assetTemplateRef.code": assetTemplates.code,
};

/**
 * The fields whose column is `text` and supplies no width. Each one's number is
 * derived from the sibling route writing the same column, pinned below.
 */
const TEXT_COLUMN_KEYS: ReadonlySet<string> = new Set([
  "pointKeys.description",
  "templates.description",
]);

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

/** Every string field of all nine sub-schemas, keyed as `<prefix>.<field>`. */
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
 * `F4.104` — the API copy of the draft schema bounds the length of all 36 of
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
    `the nine draft sub-schemas must hold ${DRAFT_STRING_FIELD_COUNT} string fields, the walk ` +
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

  // The numbers are column widths, and here is the column. The `TEXT_COLUMN_KEYS`
  // fields have a `text` column that supplies nothing, so their premise is
  // executable too rather than only written down.
  for (const [key, column] of Object.entries(DRAFT_COLUMNS)) {
    const width = columnWidth(column);
    if (TEXT_COLUMN_KEYS.has(key)) {
      assert(
        column.columnType === "PgText" && width === undefined,
        `the derivation of \`${key}\` assumes its column is a \`text\` column with no ` +
          `width; it reports ${column.columnType} / ${String(width)}`,
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
  // other four string fields are byte-for-byte this schema's, which is what
  // makes it a derivation and not a number someone picked. (Its `headlineRank`,
  // F3.68, has no onboarding counterpart by design.)
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

  // F3.22 — `templates.description` likewise: `bms.asset_templates.description` is
  // `text`, and the number is the template route's own bound on the same column.
  const templateDescription = asZodString(createAssetTemplateBodySchema.shape.description);
  assert(
    templateDescription !== null &&
      templateDescription.maxLength === bounds["templates.description"],
    "`templates.description` is derived from `createAssetTemplateBodySchema.description`, the " +
      `route writing the same \`text\` column — that schema reports ` +
      `${String(templateDescription?.maxLength)}, the record says ` +
      `${String(bounds["templates.description"])}`,
  );

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

  // F3.22 — `templates.domain` is the same vocabulary schema, on the same terms.
  assert(
    fields.get("templates.domain")?.maxLength === assetDomainCodeSchema.maxLength &&
      bounds["templates.domain"] === assetDomainCodeSchema.maxLength,
    "`templates.domain` must stay `assetDomainCodeSchema` in this copy, and the record must " +
      `agree with it — schema ${String(fields.get("templates.domain")?.maxLength)}, record ` +
      `${String(bounds["templates.domain"])}, vocabulary ${String(assetDomainCodeSchema.maxLength)}`,
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
