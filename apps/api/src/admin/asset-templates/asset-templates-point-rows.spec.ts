import type { TemplatePointBody } from "./asset-templates.schema";
import {
  toTemplatePointDto,
  toTemplatePointInsert,
  type TemplatePointRow,
} from "./asset-templates-point-rows";

/**
 * `F2.7` design decision 11 — `mapPoint` and `replacePoints`' `values()` mapper
 * moved out of `asset-templates.service.ts` (998/1000 lines) into a pure
 * sibling. These cases pin the **old** behaviour byte for byte, whole object,
 * so the move is provably a move; the five metadata fields ride beside it.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Key-order-independent structural equality for plain data. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

function sameObject(actual: unknown, expected: unknown, message: string): void {
  assert(
    canonical(actual) === canonical(expected),
    `${message}\n  expected ${canonical(expected)}\n  got      ${canonical(actual)}`,
  );
}

const CREATED_AT = new Date("2026-09-06T10:00:00.000Z");

const ROW: TemplatePointRow = {
  id: "33333333-3333-4333-8333-333333333333",
  templateId: "44444444-4444-4444-8444-444444444444",
  organizationId: "55555555-5555-4555-8555-555555555555",
  pointKey: "kw",
  label: "Active power",
  unit: "kW",
  kind: "measured",
  sourceDataKeyPattern: "{asset_code}_KW",
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
  minCoverageRatio: null,
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
  required: true,
  sortOrder: 4,
  meta: { tier: "core" },
  createdAt: CREATED_AT,
};

/** The old `mapPoint`, whole object, plus the five. */
export function runTemplatePointDtoTests(): void {
  sameObject(
    toTemplatePointDto(ROW),
    {
      id: ROW.id,
      templateId: ROW.templateId,
      pointKey: "kw",
      label: "Active power",
      unit: "kW",
      kind: "measured",
      sourceDataKeyPattern: "{asset_code}_KW",
      formula: null,
      formulaDialect: null,
      calcTrigger: null,
      calcIntervalSeconds: null,
      maxInputAgeSeconds: null,
      minCoverageRatio: null,
      required: true,
      sortOrder: 4,
      meta: { tier: "core" },
      createdAt: "2026-09-06T10:00:00.000Z",
      // ADR 0056 decision 1: `null` = inherit / today's behaviour.
      scaleMultiplier: null,
      scaleOffset: null,
      engMin: null,
      engMax: null,
      qualityPolicy: null,
    },
    "a measured row maps field for field as `mapPoint` did, plus the five as null",
  );

  const withMetadata = toTemplatePointDto({
    ...ROW,
    scaleMultiplier: 0.1,
    engMax: 100,
    qualityPolicy: "accept_bad",
  });
  sameObject(
    {
      scaleMultiplier: withMetadata.scaleMultiplier,
      scaleOffset: withMetadata.scaleOffset,
      engMin: withMetadata.engMin,
      engMax: withMetadata.engMax,
      qualityPolicy: withMetadata.qualityPolicy,
    },
    { scaleMultiplier: 0.1, scaleOffset: null, engMin: null, engMax: 100, qualityPolicy: "accept_bad" },
    "a row with scaleMultiplier: 0.1, engMax: 100, qualityPolicy: accept_bad maps to a DTO carrying exactly those",
  );

  const derived = toTemplatePointDto({
    ...ROW,
    kind: "derived",
    sourceDataKeyPattern: null,
    formula: "{kw} * 2",
    formulaDialect: "bms-calc-v2",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 60,
    maxInputAgeSeconds: 300,
    minCoverageRatio: 0.8,
    meta: {},
  });
  assert(derived.kind === "derived" && derived.formula === "{kw} * 2", "a derived row keeps its formula");
  assert(
    derived.formulaDialect === "bms-calc-v2" && derived.calcTrigger === "scheduled",
    "the dialect and trigger are read straight off the row",
  );
  assert(derived.calcIntervalSeconds === 60 && derived.maxInputAgeSeconds === 300, "the calc fields are read");
  assert(derived.minCoverageRatio === 0.8, "ADR 0055 decision 11 — the ratio is read, never coalesced");
  assert(canonical(derived.meta) === canonical({}), "the jsonb `{}` default passes through as `{}`");
  assert(!("organizationId" in derived), "the DTO carries no organizationId — it never did");
}

/** The old `values()` mapper of `replacePoints`, whole object, for a body. */
export function runTemplatePointInsertFromBodyTests(): void {
  // A body Zod has parsed always carries `kind`, `sortOrder` and `required`
  // (schema defaults), so this is the smallest real body.
  const bare: TemplatePointBody = { pointKey: "kw", kind: "measured", sortOrder: 3, required: true };
  const BARE_INSERT = {
    templateId: "t-1",
    organizationId: "o-1",
    pointKey: "kw",
    label: null,
    unit: null,
    kind: "measured",
    sourceDataKeyPattern: null,
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    minCoverageRatio: null,
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
    required: true,
    sortOrder: 3,
    meta: {},
  };
  sameObject(
    toTemplatePointInsert(bare, "t-1", "o-1", 0),
    BARE_INSERT,
    "a minimal body fills every optional field with its column default; `meta ?? {}`",
  );

  // The `??` fallbacks for the three defaulted fields are `replacePoints`' old
  // belt and braces — unreachable through a parsed body, kept so the move is a
  // move. Reached here by the cast the type otherwise forbids.
  sameObject(
    toTemplatePointInsert({ pointKey: "kw" } as TemplatePointBody, "t-1", "o-1", 3),
    BARE_INSERT,
    "with the three defaults absent: measured, required, `sortOrder ?? index`",
  );

  const full: TemplatePointBody = {
    pointKey: "eff",
    label: "Efficiency",
    unit: "%",
    kind: "derived",
    sourceDataKeyPattern: null,
    formula: "{out} / {in}",
    formulaDialect: "bms-calc-v1",
    calcTrigger: "streaming",
    calcIntervalSeconds: null,
    maxInputAgeSeconds: 900,
    minCoverageRatio: null,
    required: false,
    sortOrder: 9,
    meta: { tier: "extended" },
  };
  sameObject(
    toTemplatePointInsert(full, "t-2", "o-2", 0),
    {
      templateId: "t-2",
      organizationId: "o-2",
      pointKey: "eff",
      label: "Efficiency",
      unit: "%",
      kind: "derived",
      sourceDataKeyPattern: null,
      formula: "{out} / {in}",
      formulaDialect: "bms-calc-v1",
      calcTrigger: "streaming",
      calcIntervalSeconds: null,
      maxInputAgeSeconds: 900,
      minCoverageRatio: null,
      scaleMultiplier: null,
      scaleOffset: null,
      engMin: null,
      engMax: null,
      qualityPolicy: null,
      required: false,
      sortOrder: 9,
      meta: { tier: "extended" },
    },
    "a full body is carried field for field; an explicit sortOrder beats the index",
  );

  // ADR 0056 decision 1 / Correction 1 — a body carrying the five inserts
  // them. Unit C2 gave `templatePointBodySchema` the five, so this is now a
  // parsed body's own shape rather than a cast reaching the same code path.
  sameObject(
    toTemplatePointInsert(
      { ...full, scaleMultiplier: 0.1, engMax: 100, qualityPolicy: "accept_bad" },
      "t-2",
      "o-2",
      0,
    ),
    {
      templateId: "t-2",
      organizationId: "o-2",
      pointKey: "eff",
      label: "Efficiency",
      unit: "%",
      kind: "derived",
      sourceDataKeyPattern: null,
      formula: "{out} / {in}",
      formulaDialect: "bms-calc-v1",
      calcTrigger: "streaming",
      calcIntervalSeconds: null,
      maxInputAgeSeconds: 900,
      minCoverageRatio: null,
      scaleMultiplier: 0.1,
      scaleOffset: null,
      engMin: null,
      engMax: 100,
      qualityPolicy: "accept_bad",
      required: false,
      sortOrder: 9,
      meta: { tier: "extended" },
    },
    "a body with the five inserts them",
  );

  assert(
    toTemplatePointInsert({ pointKey: "a", kind: "measured", sortOrder: 0, required: true }, "t", "o", 7)
      .sortOrder === 0,
    "`sortOrder: 0` is a value, not an absence — `??`, never `||`",
  );
  assert(
    toTemplatePointInsert({ pointKey: "a", kind: "measured", sortOrder: 0, required: false }, "t", "o", 0)
      .required === false,
    "`required: false` is a value, not an absence",
  );
}

/**
 * `createDraftFrom` copies the parent's rows through the same mapper. The copy
 * is re-stamped onto the new template and org and keeps every stored field —
 * `minCoverageRatio` included, the `F2.9` version-bump hazard.
 */
export function runTemplatePointInsertFromRowTests(): void {
  const parent: TemplatePointRow = {
    ...ROW,
    kind: "derived",
    sourceDataKeyPattern: null,
    formula: "avg({kw} @group('IT_LOAD'))",
    formulaDialect: "bms-calc-v2",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 60,
    maxInputAgeSeconds: null,
    minCoverageRatio: 0.75,
    required: false,
    sortOrder: 2,
    meta: {},
  };
  sameObject(
    toTemplatePointInsert(parent, "t-next", "o-1", 11),
    {
      templateId: "t-next",
      organizationId: "o-1",
      pointKey: "kw",
      label: "Active power",
      unit: "kW",
      kind: "derived",
      sourceDataKeyPattern: null,
      formula: "avg({kw} @group('IT_LOAD'))",
      formulaDialect: "bms-calc-v2",
      calcTrigger: "scheduled",
      calcIntervalSeconds: 60,
      maxInputAgeSeconds: null,
      minCoverageRatio: 0.75,
      scaleMultiplier: null,
      scaleOffset: null,
      engMin: null,
      engMax: null,
      qualityPolicy: null,
      required: false,
      sortOrder: 2,
      meta: {},
    },
    "a parent row is re-stamped onto the new version; no `id`, `createdAt` or parent `templateId` leaks",
  );
}
