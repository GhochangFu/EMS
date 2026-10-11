import {
  CALC_DIALECT_V2,
  createAssetTemplateBodySchema as sharedCreateAssetTemplateBodySchema,
  updateAssetTemplateBodySchema as sharedUpdateAssetTemplateBodySchema,
} from "@bms/shared";

import { createAssetTemplateBodySchema, updateAssetTemplateBodySchema } from "./asset-templates.schema";

/**
 * `F3.85` PR 11a (ADR 0099 decision 6, plan §11.3 Unit 1) — the structural
 * asset-template bodies moved to `packages/shared/src/contracts/asset-template-writes.ts`
 * so the copilot catalog can name them by identity (shared must not import
 * api). `asset-templates.schema.ts` wraps each with the one api-only rule, the
 * template cycle check, and these assertions pin that wrap.
 *
 * A file of its own only because `asset-templates.schema.spec.ts` sits at the
 * §4.5 line ceiling.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Issue = { path: (string | number)[]; message: string };

function describeIssues(issues: readonly Issue[]): string {
  return issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" | ");
}

/** A complete, valid `bms-calc-v2` point, before the field under test is set. */
function v2Point(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    pointKey: "E",
    kind: "derived",
    formula: "sum({kw} @site)",
    formulaDialect: CALC_DIALECT_V2,
    calcTrigger: "scheduled",
    calcIntervalSeconds: 60,
    ...overrides,
  };
}

const CYCLE_POINTS = [v2Point({ pointKey: "D", formula: "{E}" }), v2Point({ pointKey: "E", formula: "{D}" })];

/** The cycle issues' paths, sorted, by the one phrase every cycle message carries. */
function cyclePaths(result: { success: boolean; error?: { issues: Issue[] } }): { paths: string; all: string } {
  const issues = result.error?.issues ?? [];
  return {
    paths: issues
      .filter((issue) => issue.message.includes("dependency cycle"))
      .map((issue) => issue.path.join("."))
      .sort()
      .join(","),
    all: describeIssues(issues),
  };
}

/** The identity proof the shared catalog spec cannot run: the wrap is the shared object itself. */
export function assertUpdateBodyWrapsTheSharedSchema(): void {
  assert(
    // `!== undefined` first: a plain ZodObject has no `_def.schema`, and a missing
    // shared export is also `undefined`, so a bare `===` would pass with neither in place.
    sharedUpdateAssetTemplateBodySchema !== undefined &&
    updateAssetTemplateBodySchema._def.schema === sharedUpdateAssetTemplateBodySchema,
    "updateAssetTemplateBodySchema must be the @bms/shared update schema plus the cycle refine, " +
      "not a copy that can drift from what the copilot catalog names",
  );
}

/** The create body takes the same wrap, so the move does not lose cycles on create. */
export function assertCreateBodyWrapsTheSharedSchema(): void {
  assert(
    sharedCreateAssetTemplateBodySchema !== undefined &&
    createAssetTemplateBodySchema._def.schema === sharedCreateAssetTemplateBodySchema,
    "createAssetTemplateBodySchema must be the @bms/shared create schema plus the cycle refine",
  );
}

/**
 * The cycle check moved from the points array to the body root. Its issues
 * must keep the path they had from the body — `points.<i>.formula`.
 */
export function assertUpdateRefusesACycleAtThePointsPath(): void {
  const result = updateAssetTemplateBodySchema.safeParse({ points: CYCLE_POINTS });
  const { paths, all } = cyclePaths(result);
  assert(
    paths === "points.0.formula,points.1.formula",
    `a PATCH whose points form a cycle must be refused at points.<i>.formula, got: ${all || "(parsed)"}`,
  );
}

/** The same on create — before the move, create reached the cycle check through the points array. */
export function assertCreateRefusesACycleAtThePointsPath(): void {
  const result = createAssetTemplateBodySchema.safeParse({
    organizationId: "11111111-1111-4111-8111-111111111111",
    code: "RO-SKID",
    name: "RO Skid",
    assetType: "ro_skid",
    domain: "water",
    points: CYCLE_POINTS,
  });
  const { paths, all } = cyclePaths(result);
  assert(
    paths === "points.0.formula,points.1.formula",
    `a create whose points form a cycle must be refused at points.<i>.formula, got: ${all || "(parsed)"}`,
  );
}

/** Adjacent positive: the shared schema alone carries no cycle check — the api wrap is what refuses. */
export function assertTheSharedUpdateSchemaAloneAdmitsTheCycle(): void {
  const result = sharedUpdateAssetTemplateBodySchema.safeParse({ points: CYCLE_POINTS });
  assert(
    result.success,
    "the shared update schema must carry the structure only — templateCycles is api-only, " +
      `so the cycle must parse there. Got: ${result.success ? "" : describeIssues(result.error.issues)}`,
  );
}

/** Adjacent positive: a PATCH that carries no points parses through the wrap. */
export function assertUpdateWithoutPointsParses(): void {
  const result = updateAssetTemplateBodySchema.safeParse({ name: "RO Skid v2" });
  assert(
    result.success,
    `a PATCH with no points must parse, got: ${result.success ? "" : describeIssues(result.error.issues)}`,
  );
}

/**
 * The depth guard must stay the first statement inside the shared content
 * refine and return early. Reached through the **full** api body — shared
 * schema plus the outer cycle refine — deep content must answer the depth
 * refusal, never throw a `RangeError` out of `safeParse` (the F4.115 class:
 * a 400 turned into a 500).
 */
export function assertUpdateRefusesDeepContentWithTheDepthMessage(): void {
  let deep: unknown = "leaf";
  for (let i = 0; i < 20_000; i += 1) {
    deep = [deep];
  }
  let threw: string | null = null;
  let message = "";
  try {
    const result = updateAssetTemplateBodySchema.safeParse({ content: { kpis: deep } });
    message = result.success ? "(parsed)" : result.error.issues.map((issue) => issue.message).join(" | ");
  } catch (err) {
    threw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
  assert(threw === null, `deep content must not throw out of safeParse, threw ${String(threw)}`);
  assert(
    /Template content nests deeper than 12 levels/.test(message),
    `deep content must be refused with the depth message, got: ${message}`,
  );
}
