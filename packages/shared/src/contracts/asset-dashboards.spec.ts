import {
  defaultDashboardsBackfillAssetDtoSchema,
  defaultDashboardsBackfillOutcomeSchema,
  defaultDashboardsBackfillResultDtoSchema,
  instantiatedDashboardDtoSchema,
} from "./asset-dashboards";

/**
 * `F3.2` / ADR 0067 decisions 3 and 5 — the per-asset default-dashboard
 * instantiation report and the backfill response.
 *
 * Assertions live here; `asset-dashboards.test.ts` is the Vitest entry point
 * (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectAccepts(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown,
  message: string,
): void {
  assert(schema.safeParse(value).success === true, `${message} — expected success, got a refusal`);
}

function expectRejects(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown,
  message: string,
): void {
  assert(schema.safeParse(value).success === false, `${message} — expected a refusal, got success`);
}

const validResolution = {
  widgetKey: "overview#0",
  assetRoleCodes: [],
  matchedMembers: 1,
  boundPoints: 1,
  outcome: "bound",
};

const validInstantiatedDashboard = {
  slug: "tx-01-overview",
  view: "overview",
  widgetCount: 3,
  boundPoints: 2,
  omittedFeatured: 0,
  resolutions: [validResolution],
};

const validBackfillAsset = {
  assetId: "11111111-1111-4111-8111-111111111111",
  code: "TX-01",
  outcome: "created",
  dashboards: [validInstantiatedDashboard],
};

const validBackfillResult = {
  templateId: "22222222-2222-4222-8222-222222222222",
  templateCode: "electrical-transformer",
  templateVersion: 2,
  assets: [validBackfillAsset],
  createdCount: 1,
  skippedCount: 0,
  conflictCount: 0,
};

/** `instantiatedDashboardDtoSchema` accepts the full report shape and rejects one
 * missing `omittedFeatured` — the field decision 5 amended in over decision 3's
 * bare `truncated` field (plan §12 Q3). */
export function runInstantiatedDashboardDtoTests(): void {
  expectAccepts(
    instantiatedDashboardDtoSchema,
    validInstantiatedDashboard,
    "a full instantiated-dashboard report",
  );

  const { omittedFeatured: _omitted, ...withoutOmittedFeatured } = validInstantiatedDashboard;
  expectRejects(
    instantiatedDashboardDtoSchema,
    withoutOmittedFeatured,
    "a report missing omittedFeatured",
  );

  expectRejects(
    instantiatedDashboardDtoSchema,
    { ...validInstantiatedDashboard, resolutions: [{ ...validResolution, outcome: "drifted" }] },
    "a resolution with an unknown outcome",
  );
}

/** `defaultDashboardsBackfillOutcomeSchema` is closed to exactly the three
 * values decision 4 and Q8 name. */
export function runDefaultDashboardsBackfillOutcomeTests(): void {
  expectAccepts(defaultDashboardsBackfillOutcomeSchema, "created", "the created outcome");
  expectAccepts(
    defaultDashboardsBackfillOutcomeSchema,
    "skipped_existing",
    "the skipped_existing outcome",
  );
  // Q8 (ruled 2026-09-17) — a slug collision is per asset and never a stop, so
  // the asset it happened to needs an outcome of its own. Folding it into
  // `skipped_existing` would make a report say an asset already had its
  // dashboards when a hand-made row is holding its slug.
  expectAccepts(
    defaultDashboardsBackfillOutcomeSchema,
    "skipped_slug_conflict",
    "the skipped_slug_conflict outcome",
  );
  expectRejects(defaultDashboardsBackfillOutcomeSchema, "skipped", "an unknown outcome");
}

/** `defaultDashboardsBackfillResultDtoSchema` and its nested asset DTO reject a
 * payload missing a required field. */
export function runDefaultDashboardsBackfillResultDtoTests(): void {
  expectAccepts(
    defaultDashboardsBackfillResultDtoSchema,
    validBackfillResult,
    "a full backfill result",
  );

  const { createdCount: _created, ...withoutCreatedCount } = validBackfillResult;
  expectRejects(
    defaultDashboardsBackfillResultDtoSchema,
    withoutCreatedCount,
    "a result missing createdCount",
  );

  // Q8 — `conflictCount` is the third count, and it is REQUIRED rather than
  // optional: a reader who cannot tell "no collision" from "this server does
  // not report collisions" cannot trust the other two counts either.
  const { conflictCount: _conflict, ...withoutConflictCount } = validBackfillResult;
  expectRejects(
    defaultDashboardsBackfillResultDtoSchema,
    withoutConflictCount,
    "a result missing conflictCount",
  );

  expectAccepts(
    defaultDashboardsBackfillAssetDtoSchema,
    validBackfillAsset,
    "a backfill asset entry with a created outcome",
  );
  const { outcome: _outcome, ...assetWithoutOutcome } = validBackfillAsset;
  expectRejects(
    defaultDashboardsBackfillAssetDtoSchema,
    assetWithoutOutcome,
    "a backfill asset entry missing outcome",
  );
}
