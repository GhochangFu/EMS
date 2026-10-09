import type { TemplateMigrationRefusalDto } from "@bms/shared";

import {
  refuseMetadataOverridesThatDoNotSurvive,
  type MigratingMetadataRow,
} from "./asset-templates-migrate-metadata";
import type { StoredTemplatePoint } from "./template-version-delta";

/**
 * `F2.30` — the pure half of the migrate-time merged-pair check for the five
 * instrument-metadata fields. A fake `refuse` collects what the gate emits; the
 * service, the database and the pin are the integration pair's to prove.
 *
 * Assertions live here; `asset-templates-migrate-metadata.test.ts` is the
 * vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NO_METADATA = {
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
};

function targetPoint(pointKey: string, overrides: Partial<StoredTemplatePoint> = {}): StoredTemplatePoint {
  return {
    pointKey,
    kind: "measured",
    sourceDataKeyPattern: `SITE/{asset_code}/${pointKey}`,
    required: true,
    unit: null,
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    minCoverageRatio: null,
    ...NO_METADATA,
    ...overrides,
  };
}

function row(overrides: Partial<MigratingMetadataRow> = {}): MigratingMetadataRow {
  return { sourceKind: "manual", ...NO_METADATA, ...overrides };
}

function run(
  assets: { assetCode: string; rows: Record<string, MigratingMetadataRow> }[],
  targetPoints: StoredTemplatePoint[],
): TemplateMigrationRefusalDto[] {
  const refusals: TemplateMigrationRefusalDto[] = [];
  refuseMetadataOverridesThatDoNotSurvive({
    assets: assets.map((a) => ({ assetCode: a.assetCode, rows: new Map(Object.entries(a.rows)) })),
    targetPoints,
    targetVersion: 2,
    refuse: (refusal) => refusals.push(refusal),
  });
  return refusals;
}

const CAPPED = [targetPoint("KW", { engMax: 100 })];

/**
 * The case the row exists for: an override `eng_min 150` that was legal while
 * the pinned version had no `eng_max`, against a target that sets `eng_max 100`.
 * Mutation: the refusal dropped → none; the asset code left out of the message.
 */
export function assertAnOverrideTheTargetDefaultInvertsRefuses(): void {
  const refusals = run([{ assetCode: "PUMP-01", rows: { KW: row({ engMin: 150 }) } }], CAPPED);
  assert(refusals.length === 1, `expected exactly one refusal, got ${refusals.length}`);
  const [refusal] = refusals;
  assert(
    refusal?.reason === "metadata_override_invalid_on_target",
    `the reason must be metadata_override_invalid_on_target, got ${String(refusal?.reason)}`,
  );
  assert(refusal?.pointKey === "KW", `the refusal must name the point, got ${String(refusal?.pointKey)}`);
  assert(refusal?.assetCount === 1, `one asset per refusal, got ${String(refusal?.assetCount)}`);
  const message = refusal?.message ?? "";
  assert(message.includes('"PUMP-01"'), `the message must name the asset code, got "${message}"`);
  assert(
    message.includes("150") && message.includes("100"),
    `the message must name both bounds, got "${message}"`,
  );
  assert(
    message.includes("(inherited from the template)"),
    `the message must mark the bound the override's author never typed, got "${message}"`,
  );
  assert(message.includes("version 2"), `the message must name the target version, got "${message}"`);
  // The migrate wording is its own: the asset side's "state both together, or
  // clear the one this request sets" speaks to a request a migrate has not got.
  // Mutation: the shared validator's text interpolated → red here.
  assert(
    !message.includes("this request") && !message.includes("state both together"),
    `the migrate refusal must not reuse the asset-side request wording, got "${message}"`,
  );
  assert(
    message.includes("bulk editor") && message.includes("then migrate"),
    `the message must name the repair path (bulk editor, then migrate), got "${message}"`,
  );
}

/** A legal merged pair refuses nothing. Mutation: "refuse every row with metadata". */
export function assertAnOverrideStillLegalOnTheTargetPasses(): void {
  const refusals = run([{ assetCode: "PUMP-01", rows: { KW: row({ engMin: 50 }) } }], CAPPED);
  assert(refusals.length === 0, `eng_min 50 under eng_max 100 is legal, got ${JSON.stringify(refusals)}`);
}

/**
 * A row that overrides none of the five merges to the target's own pair, which
 * `template_points_eng_range_check` already guarantees. A cost guard: removing
 * the skip changes no outcome here, and this case says so rather than pretend
 * it gates a mutation.
 */
export function assertARowWithNoOverrideRefusesNothing(): void {
  const refusals = run([{ assetCode: "PUMP-01", rows: { KW: row() } }], CAPPED);
  assert(refusals.length === 0, `a row with no override must refuse nothing, got ${refusals.length}`);
}

/**
 * A `computed` row is calc configuration and carries no instrument metadata;
 * the asset side refuses the five on one. Mutation: the skip removed → a
 * refusal for a row that is not an instrument override.
 */
export function assertAComputedRowIsNotReadAsAMetadataOverride(): void {
  const refusals = run(
    [{ assetCode: "PUMP-01", rows: { KW: row({ sourceKind: "computed", engMin: 150 }) } }],
    CAPPED,
  );
  assert(refusals.length === 0, `a computed row must not be checked, got ${refusals.length}`);
}

/**
 * Only a key the target declares **measured** has class defaults to merge with.
 * Mutation: the skip removed → the row merges with an all-null default, or a
 * derived point's, and the case either crashes or refuses wrongly.
 */
export function assertAKeyNotMeasuredOnTheTargetIsSkipped(): void {
  const derivedTarget = [
    targetPoint("KW", { engMax: 100 }),
    targetPoint("AGG", { kind: "derived", engMax: 100 }),
  ];
  const refusals = run(
    [
      {
        assetCode: "PUMP-01",
        rows: { AGG: row({ engMin: 150 }), GONE: row({ engMin: 150, engMax: 10 }) },
      },
    ],
    derivedTarget,
  );
  assert(
    refusals.length === 0,
    `a key the target does not declare measured must be skipped, got ${JSON.stringify(refusals)}`,
  );
}

/**
 * Two assets, the bad one second: exactly one refusal, naming it. Mutation: the
 * loop stops after the first asset → no refusal; the wrong code named.
 */
export function assertEachAssetIsCheckedOnItsOwn(): void {
  const refusals = run(
    [
      { assetCode: "PUMP-GOOD", rows: { KW: row({ engMin: 50 }) } },
      { assetCode: "PUMP-BAD", rows: { KW: row({ engMin: 150 }) } },
    ],
    CAPPED,
  );
  assert(refusals.length === 1, `expected one refusal across two assets, got ${refusals.length}`);
  assert(
    refusals[0]?.message.includes('"PUMP-BAD"') === true &&
      refusals[0]?.message.includes("PUMP-GOOD") === false,
    `the refusal must name the bad asset alone, got "${refusals[0]?.message}"`,
  );
}
