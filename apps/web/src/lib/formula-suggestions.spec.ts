/**
 * Suggested formulas (`F4.314` PR 2, ADR 0038 Amendment 6 decision A3).
 *
 * One claim per helper; each names the mutation of `formula-suggestions.ts`
 * that reddens it. The fixtures are full DTOs parsed through the shared
 * schemas, so a field the contract gains reaches here as a parse failure
 * rather than as a silently partial fixture.
 */
import { CALC_DIALECT, CALC_DIALECT_V2 } from "@bms/shared";
import {
  adminAssetTemplateDtoSchema,
  adminAssetTemplateSummaryDtoSchema,
  stockAssetTemplateDtoSchema,
} from "@bms/shared/contracts";
import type {
  AdminAssetTemplateDto,
  AdminAssetTemplateSummaryDto,
  CalcDialect,
  CalcTrigger,
  StockAssetTemplateDto,
} from "@bms/shared";

import {
  suggestedFormulas,
  suggestionDraft,
  suggestionRow,
  suggestionTemplateIds,
  type FormulaSuggestion,
  type SuggestionSources,
} from "./formula-suggestions";
import { pointRowsFrom } from "./template-points-grid";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type PointSpec = {
  pointKey: string;
  formula?: string | null;
  formulaDialect?: CalcDialect | null;
  kind?: "measured" | "derived";
  calcTrigger?: CalcTrigger | null;
  calcIntervalSeconds?: number | null;
  maxInputAgeSeconds?: number | null;
};

function stockPoint(spec: PointSpec) {
  return {
    pointKey: spec.pointKey,
    label: null,
    unit: null,
    sourceDataKeyPattern: null,
    formula: spec.formula ?? null,
    formulaDialect: spec.formulaDialect ?? null,
    kind: spec.kind ?? "derived",
    calcTrigger: spec.calcTrigger ?? "scheduled",
    calcIntervalSeconds: spec.calcIntervalSeconds === undefined ? 60 : spec.calcIntervalSeconds,
    maxInputAgeSeconds: spec.maxInputAgeSeconds === undefined ? 300 : spec.maxInputAgeSeconds,
    minCoverageRatio: null,
    required: false,
    sortOrder: 0,
  };
}

/** A stock entry named `name` holding `points`. */
export function stockEntry(name: string, points: PointSpec[]): StockAssetTemplateDto {
  return stockAssetTemplateDtoSchema.parse({
    code: name.toUpperCase().replace(/\W+/g, "_"),
    name,
    assetType: "feeder",
    domain: "electrical",
    description: null,
    stockVersion: 1,
    content: {},
    points: points.map(stockPoint),
  });
}

type TemplateSpec = {
  id: string;
  code?: string;
  version?: number;
  status?: "draft" | "published" | "archived";
  organizationCode?: string;
  domain?: string;
};

function templateBase(spec: TemplateSpec) {
  return {
    id: spec.id,
    organizationId: "org-1",
    organizationCode: spec.organizationCode ?? "ESKOM",
    organizationName: "Eskom",
    code: spec.code ?? "PUMP-M",
    version: spec.version ?? 2,
    name: "Pump",
    assetType: "pump",
    domain: spec.domain ?? "electrical",
    description: null,
    status: spec.status ?? "published",
    content: {},
    publishedAt: null,
    archivedAt: null,
    workOrderPrefix: null,
    stockCode: null,
    stockVersion: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

/** A full version (with points) — what `GET /admin/asset-templates/:id` returns. */
export function templateVersion(spec: TemplateSpec, points: PointSpec[]): AdminAssetTemplateDto {
  return adminAssetTemplateDtoSchema.parse({
    ...templateBase(spec),
    points: points.map((point, index) => ({
      ...stockPoint(point),
      id: `${spec.id}-p${index}`,
      templateId: spec.id,
      meta: null,
      createdAt: new Date(0).toISOString(),
      scaleMultiplier: null,
      scaleOffset: null,
      engMin: null,
      engMax: null,
      qualityPolicy: null,
    })),
  });
}

/** A list row — what `GET /admin/asset-templates?status=published` returns. */
export function templateRow(spec: TemplateSpec): AdminAssetTemplateSummaryDto {
  return adminAssetTemplateSummaryDtoSchema.parse({ ...templateBase(spec), pointCount: 1 });
}

const KW_STOCK = "{voltage_l1_v} * {current_l1_a} / 1000";

function sources(overrides: Partial<SuggestionSources>): SuggestionSources {
  return { stock: [], templates: [], assetKeys: null, ...overrides };
}

function only(list: FormulaSuggestion[]): FormulaSuggestion {
  assert(list.length === 1, `expected one suggestion, got ${JSON.stringify(list)}`);
  return list[0] as FormulaSuggestion;
}

const SCOPE = { organizationCode: "ESKOM", domain: "electrical" };

/**
 * A stock `kw` formula reading `{voltage_l1_v}` on an asset without that key
 * names it as missing. Mutation: drop the set difference (`missingInputs: []`).
 */
export function runMissingInputIsNamedTests(): void {
  const found = only(
    suggestedFormulas("kw", sources({ stock: [stockEntry("Electrical feeder", [{ pointKey: "kw", formula: KW_STOCK }])], assetKeys: ["current_l1_a"] })),
  );
  assert(
    JSON.stringify(found.missingInputs) === JSON.stringify(["voltage_l1_v"]),
    `missing inputs: ${JSON.stringify(found.missingInputs)}`,
  );
}

/** A derived point of another key is not offered. Mutation: drop the `pointKey` check. */
export function runAnotherKeyIsNotListedTests(): void {
  const found = suggestedFormulas(
    "kw",
    sources({ templates: [templateVersion({ id: "t1" }, [{ pointKey: "kwh_total", formula: "{kw} * 2" }])] }),
  );
  assert(found.length === 0, `another key listed: ${JSON.stringify(found)}`);
}

/** A measured point of the key is not offered. Mutation: drop the `kind` check. */
export function runMeasuredIsNotListedTests(): void {
  const found = suggestedFormulas(
    "kw",
    sources({ stock: [stockEntry("Meter", [{ pointKey: "kw", kind: "measured", formula: "{a}" }])] }),
  );
  assert(found.length === 0, `a measured point listed: ${JSON.stringify(found)}`);
}

/**
 * The same formula and dialect from two sources is one suggestion, labelled
 * by the first (stock). Mutation: drop the `seen` check.
 */
export function runDuplicatesCollapseTests(): void {
  const found = only(
    suggestedFormulas(
      "kw",
      sources({
        stock: [stockEntry("Electrical feeder", [{ pointKey: "kw", formula: KW_STOCK }])],
        templates: [templateVersion({ id: "t1" }, [{ pointKey: "kw", formula: KW_STOCK }])],
      }),
    ),
  );
  assert(found.from === "Stock · Electrical feeder", `kept: ${found.from}`);
}

/**
 * The same text under two dialects is two suggestions — the dialect is part
 * of what is taken. Mutation: key the de-duplication on the formula alone.
 */
export function runDialectDistinguishesTests(): void {
  const found = suggestedFormulas(
    "kw",
    sources({
      stock: [
        stockEntry("A", [{ pointKey: "kw", formula: "{a} * 2", formulaDialect: CALC_DIALECT }]),
        stockEntry("B", [{ pointKey: "kw", formula: "{a} * 2", formulaDialect: CALC_DIALECT_V2 }]),
      ],
    }),
  );
  assert(found.length === 2, `expected two, got ${JSON.stringify(found)}`);
}

/** The Calculations tab's own version is not offered. Mutation: drop the `excludeTemplateId` check. */
export function runExcludedTemplateIsDroppedTests(): void {
  const found = suggestedFormulas(
    "kw",
    sources({ templates: [templateVersion({ id: "own" }, [{ pointKey: "kw", formula: "{a}" }])], excludeTemplateId: "own" }),
  );
  assert(found.length === 0, `own version listed: ${JSON.stringify(found)}`);
}

/**
 * The override's own version — the one declaring its template point — is not
 * offered. Mutation: drop the `excludeTemplatePointId` check.
 */
export function runExcludedTemplatePointDropsItsVersionTests(): void {
  const found = suggestedFormulas(
    "kw",
    sources({ templates: [templateVersion({ id: "own" }, [{ pointKey: "kw", formula: "{a}" }])], excludeTemplatePointId: "own-p0" }),
  );
  assert(found.length === 0, `own version listed: ${JSON.stringify(found)}`);
}

/** A draft version's formula is never offered. Mutation: drop the `status` check in `suggestedFormulas`. */
export function runUnpublishedVersionIsNotListedTests(): void {
  const found = suggestedFormulas(
    "kw",
    sources({ templates: [templateVersion({ id: "d1", status: "draft" }, [{ pointKey: "kw", formula: "{a}" }])] }),
  );
  assert(found.length === 0, `a draft listed: ${JSON.stringify(found)}`);
}

/** With no single asset (`null`), nothing is marked missing. Mutation: read `null` as no keys. */
export function runNullKeysMarkNothingTests(): void {
  const found = only(
    suggestedFormulas("kw", sources({ stock: [stockEntry("Electrical feeder", [{ pointKey: "kw", formula: KW_STOCK }])] })),
  );
  assert(found.missingInputs.length === 0, `marked: ${JSON.stringify(found.missingInputs)}`);
}

/** What the asset can run comes first. Mutation: drop the missing-inputs comparator. */
export function runRunnableFirstTests(): void {
  const found = suggestedFormulas(
    "kw",
    sources({
      stock: [
        stockEntry("A feeder", [{ pointKey: "kw", formula: "{voltage_l1_v} * 2" }]),
        stockEntry("B feeder", [{ pointKey: "kw", formula: "{current_l1_a} * 2" }]),
      ],
      assetKeys: ["current_l1_a"],
    }),
  );
  assert(found[0]?.from === "Stock · B feeder", `first: ${found[0]?.from}`);
}

/** A point with no dialect reads as `v1`, the wire's meaning of `null`. Mutation: carry `null` through. */
export function runNullDialectIsV1Tests(): void {
  const found = only(
    suggestedFormulas("kw", sources({ stock: [stockEntry("A", [{ pointKey: "kw", formula: "{a}", formulaDialect: null }])] })),
  );
  assert(found.formulaDialect === CALC_DIALECT, `dialect: ${String(found.formulaDialect)}`);
}

/** A draft list row is not read. Mutation: drop the `status` filter in `suggestionTemplateIds`. */
export function runIdsSkipUnpublishedTests(): void {
  const ids = suggestionTemplateIds([templateRow({ id: "d1", status: "draft" })], SCOPE);
  assert(ids.length === 0, `read: ${JSON.stringify(ids)}`);
}

/** Another organization's row is not read. Mutation: drop the organization filter. */
export function runIdsSkipAnotherOrganizationTests(): void {
  const ids = suggestionTemplateIds([templateRow({ id: "o2", organizationCode: "CITY" })], SCOPE);
  assert(ids.length === 0, `read: ${JSON.stringify(ids)}`);
}

/** Another domain's row is not read. Mutation: drop the domain filter. */
export function runIdsSkipAnotherDomainTests(): void {
  const ids = suggestionTemplateIds([templateRow({ id: "w1", domain: "water" })], SCOPE);
  assert(ids.length === 0, `read: ${JSON.stringify(ids)}`);
}

/** The excluded version is not read. Mutation: drop the `excludeTemplateId` filter. */
export function runIdsSkipTheExcludedTests(): void {
  const ids = suggestionTemplateIds([templateRow({ id: "own" })], { ...SCOPE, excludeTemplateId: "own" });
  assert(ids.length === 0, `read: ${JSON.stringify(ids)}`);
}

/** No organization (`null`) reads nothing. Mutation: drop the organization filter. */
export function runIdsNeedAnOrganizationTests(): void {
  const ids = suggestionTemplateIds([templateRow({ id: "t1" })], { organizationCode: null, domain: "electrical" });
  assert(ids.length === 0, `read: ${JSON.stringify(ids)}`);
}

/** The organization's published version of the domain is read. Mutation: return `[]`. */
export function runIdsReadTheMatchingVersionTests(): void {
  const ids = suggestionTemplateIds([templateRow({ id: "t1" })], SCOPE);
  assert(JSON.stringify(ids) === JSON.stringify(["t1"]), `read: ${JSON.stringify(ids)}`);
}

const TAKEN: FormulaSuggestion = {
  formula: "{a} + {b}",
  formulaDialect: CALC_DIALECT,
  from: "Stock · A",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 120,
  maxInputAgeSeconds: 900,
  missingInputs: [],
};

const V2_STREAMING: FormulaSuggestion = { ...TAKEN, formula: "sum({kw} @site)", formulaDialect: CALC_DIALECT_V2, calcTrigger: "streaming", calcIntervalSeconds: null };

/** Taking a suggestion fills the draft's formula. Mutation: drop `formula` from `suggestionDraft`. */
export function runDraftCarriesFormulaTests(): void {
  assert(suggestionDraft(TAKEN, false).formula === TAKEN.formula, "formula not carried");
}

/** …its dialect. Mutation: drop `formulaDialect` from `suggestionDraft`. */
export function runDraftCarriesDialectTests(): void {
  assert(suggestionDraft(TAKEN, false).formulaDialect === CALC_DIALECT, "dialect not carried");
}

/** …its trigger. Mutation: drop `calcTrigger` from `suggestionDraft`. */
export function runDraftCarriesTriggerTests(): void {
  assert(suggestionDraft(TAKEN, false).calcTrigger === "scheduled", "trigger not carried");
}

/** …its interval. Mutation: drop `calcIntervalSeconds` from `suggestionDraft`. */
export function runDraftCarriesIntervalTests(): void {
  assert(suggestionDraft(TAKEN, false).calcIntervalSeconds === "120", "interval not carried");
}

/** …its input age. Mutation: drop `maxInputAgeSeconds` from `suggestionDraft`. */
export function runDraftCarriesInputAgeTests(): void {
  assert(suggestionDraft(TAKEN, false).maxInputAgeSeconds === "900", "input age not carried");
}

/** A cross-asset suggestion lands scheduled on the draft. Mutation: `takenTrigger` returns the source trigger. */
export function runDraftCrossAssetIsScheduledTests(): void {
  assert(suggestionDraft(V2_STREAMING, false).calcTrigger === "scheduled", "a v2 formula landed streaming");
}

/** A standalone draft takes a trigger-less source as `"scheduled"`. Mutation: drop the standalone fallback. */
export function runStandaloneDraftDefaultsToScheduledTests(): void {
  const draft = suggestionDraft({ ...TAKEN, calcTrigger: null }, true);
  assert(draft.calcTrigger === "scheduled", `trigger: ${JSON.stringify(draft.calcTrigger)}`);
}

/** An override draft takes a trigger-less source as `""` (inherit). Mutation: apply the fallback unconditionally. */
export function runOverrideDraftKeepsInheritTests(): void {
  const draft = suggestionDraft({ ...TAKEN, calcTrigger: null }, false);
  assert(draft.calcTrigger === "", `trigger: ${JSON.stringify(draft.calcTrigger)}`);
}

/** `F4.315` B3: a standalone draft takes an age-less scheduled source as 2 × its interval. Mutation: no default. */
export function runStandaloneDraftDefaultsTheAgeTests(): void {
  const draft = suggestionDraft({ ...TAKEN, maxInputAgeSeconds: null }, true);
  assert(draft.maxInputAgeSeconds === "240", `age: ${JSON.stringify(draft.maxInputAgeSeconds)}`);
}

/** `F4.315` B3: a source's own age is kept on a standalone draft. Mutation: always the default. */
export function runStandaloneDraftKeepsTheSourcesAgeTests(): void {
  const draft = suggestionDraft({ ...TAKEN, maxInputAgeSeconds: 90 }, true);
  assert(draft.maxInputAgeSeconds === "90", `age: ${JSON.stringify(draft.maxInputAgeSeconds)}`);
}

/** `F4.315` B3: an override draft keeps an age-less source as `""` (inherit). Mutation: default unconditionally. */
export function runOverrideDraftKeepsTheAgeEmptyTests(): void {
  const draft = suggestionDraft({ ...TAKEN, maxInputAgeSeconds: null }, false);
  assert(draft.maxInputAgeSeconds === "", `age: ${JSON.stringify(draft.maxInputAgeSeconds)}`);
}

function derivedRow(dialect: CalcDialect, trigger: CalcTrigger, ratio: number | null) {
  const [row] = pointRowsFrom(
    templateVersion({ id: "own", status: "draft" }, [
      { pointKey: "kw", formula: "{x}", formulaDialect: dialect, calcTrigger: trigger, calcIntervalSeconds: trigger === "streaming" ? null : 60 },
    ]),
  );
  if (row === undefined) throw new Error("no row");
  return { ...row, minCoverageRatio: ratio };
}

/** Taking a suggestion fills the row's formula. Mutation: drop `formula` from `suggestionRow`. */
export function runRowCarriesFormulaTests(): void {
  assert(suggestionRow(derivedRow(CALC_DIALECT, "scheduled", null), TAKEN).formula === TAKEN.formula, "formula not carried");
}

/** …its dialect, through `setFormulaDialect`. Mutation: drop the `setFormulaDialect` call. */
export function runRowCarriesDialectTests(): void {
  const row = suggestionRow(derivedRow(CALC_DIALECT_V2, "scheduled", 0.5), TAKEN);
  assert(row.formulaDialect === CALC_DIALECT, `dialect: ${String(row.formulaDialect)}`);
}

/** …its trigger. Mutation: drop the `setCalcTrigger` call (keep the row's trigger). */
export function runRowCarriesTriggerTests(): void {
  const row = suggestionRow(derivedRow(CALC_DIALECT, "streaming", null), TAKEN);
  assert(row.calcTrigger === "scheduled", `trigger: ${String(row.calcTrigger)}`);
}

/** …its interval. Mutation: drop `calcIntervalSeconds` from `suggestionRow`. */
export function runRowCarriesIntervalTests(): void {
  assert(suggestionRow(derivedRow(CALC_DIALECT, "scheduled", null), TAKEN).calcIntervalSeconds === 120, "interval not carried");
}

/** …its input age. Mutation: drop `maxInputAgeSeconds` from `suggestionRow`. */
export function runRowCarriesInputAgeTests(): void {
  assert(suggestionRow(derivedRow(CALC_DIALECT, "scheduled", null), TAKEN).maxInputAgeSeconds === 900, "input age not carried");
}

/**
 * A cross-asset suggestion on a row already on that dialect still lands
 * scheduled — `setFormulaDialect` alone would leave it (no dialect change).
 * Mutation: `takenTrigger` returns the source trigger.
 */
export function runRowCrossAssetIsScheduledTests(): void {
  const row = suggestionRow(derivedRow(CALC_DIALECT_V2, "scheduled", null), V2_STREAMING);
  assert(row.calcTrigger === "scheduled", `trigger: ${String(row.calcTrigger)}`);
}

/** A `v1` suggestion on a `v2` row clears the ratio, `setFormulaDialect`'s rule. Mutation: drop that call. */
export function runRowToV1ClearsTheRatioTests(): void {
  const row = suggestionRow(derivedRow(CALC_DIALECT_V2, "scheduled", 0.5), TAKEN);
  assert(row.minCoverageRatio === null, `ratio: ${String(row.minCoverageRatio)}`);
}
