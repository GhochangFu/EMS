import type {
  TemplateMigrationPreviewResponse,
  TemplateVersionDeltaDto,
  TemplateVersionSummaryDto,
} from "@bms/shared";

import {
  deltaLines,
  isMigrationTarget,
  migrateActionState,
  partitionSelection,
  refusalMessages,
  sourceVersionsInPreview,
  versionSummaryLabel,
} from "./template-version-migration";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const EMPTY_DELTA: TemplateVersionDeltaDto = {
  fromVersion: 1,
  toVersion: 2,
  measuredAdded: [],
  measuredRemoved: [],
  measuredReKeyed: [],
  derivedAdded: [],
  derivedRemoved: [],
  derivedChanged: [],
  refusals: [],
};

const NO_CALC = {
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
} as const;

function asset(id: string, fromVersion = 1) {
  return {
    assetId: id,
    assetCode: `CODE-${id}`,
    assetName: `Asset ${id}`,
    fromVersionId: `v${fromVersion}`,
    fromVersion,
  };
}

function preview(
  overrides: Partial<TemplateMigrationPreviewResponse> = {},
): TemplateMigrationPreviewResponse {
  return {
    templateCode: "PUMP",
    toVersionId: "v2",
    toVersion: 2,
    assets: [asset("a")],
    deltas: [EMPTY_DELTA],
    refusals: [],
    canApply: true,
    ...overrides,
  };
}

/** Nothing selected, nothing previewed, refused, and nothing to do are four answers. */
export function runMigrateActionStateTests(): void {
  const none = migrateActionState([], preview());
  assert(!none.enabled && none.reason === "no-selection", "an empty selection must disable Migrate");

  const unpreviewed = migrateActionState(["a"], null);
  assert(
    !unpreviewed.enabled && unpreviewed.reason === "no-preview",
    "decision 2 is 'no blind apply' — Migrate must be disabled until a preview exists",
  );

  const ok = migrateActionState(["a"], preview());
  assert(ok.enabled, "a clean preview over a real selection must enable Migrate");

  const nothing = migrateActionState(["a"], preview({ assets: [] }));
  assert(
    !nothing.enabled && nothing.reason === "nothing-to-do",
    "a selection whose assets are all already on the target version is not a migration",
  );
  assert(
    !nothing.enabled && nothing.message.includes("already on this version"),
    "and it must say so rather than reading as a refusal",
  );
}

/**
 * **The rule this module exists for.** `canApply` is the server's verdict.
 *
 * `migrate` re-runs the preview and refuses if it is not clean, so a client
 * deriving its own answer from `refusals` would be a second implementation of a
 * decision it does not own — and a refusal reason added to the API and not here
 * would leave the button enabled.
 */
export function runCanApplyIsTheServersVerdictTests(): void {
  const refused = migrateActionState(
    ["a"],
    preview({
      canApply: false,
      refusals: [
        {
          reason: "measured_removed",
          pointKey: "VOLTS",
          assetCount: 3,
          message: 'measured point "VOLTS" exists in version 1 but not in version 2.',
        },
      ],
    }),
  );
  assert(!refused.enabled && refused.reason === "refused", "canApply false must disable Migrate");

  // The adversarial case: refusals present but the server says it can apply.
  // The client must believe the server, not the array.
  const trusted = migrateActionState(
    ["a"],
    preview({
      canApply: true,
      refusals: [
        {
          reason: "measured_removed",
          pointKey: "VOLTS",
          assetCount: 1,
          message: "a refusal the server nonetheless cleared",
        },
      ],
    }),
  );
  assert(
    trusted.enabled,
    "the client must not recompute the verdict from `refusals` — the server owns it, and " +
      "two implementations would disagree exactly when it mattered",
  );

  // And the mirror: canApply false with an EMPTY refusals array must still
  // disable. A client keyed on `refusals.length` would enable it.
  const empty = migrateActionState(["a"], preview({ canApply: false, refusals: [] }));
  assert(
    !empty.enabled,
    "canApply false with no refusals listed must still disable — a client keyed on " +
      "refusals.length would enable a migration the server has already declined",
  );
}

/** Refusal sentences are passed through verbatim, never re-worded per reason. */
export function runRefusalsAreVerbatimTests(): void {
  const sentence =
    'measured point "VOLTS" changes source_data_key_pattern from "OLD/{asset_code}/KW" to ' +
    '"NEW/{asset_code}/KW". 3 asset(s) carry it.';
  const messages = refusalMessages(
    preview({
      canApply: false,
      refusals: [{ reason: "measured_rekeyed", pointKey: "VOLTS", assetCount: 3, message: sentence }],
    }),
  );

  assert(messages.length === 1, "one refusal in, one out");
  assert(
    messages[0]?.message === sentence,
    "the API's sentence must reach the screen unchanged — it names the point, the patterns " +
      "and the asset count, and a client-side lookup per reason would replace all of it " +
      "with a generic line",
  );
  assert(refusalMessages(null).length === 0, "no preview yet is no refusals, not a crash");
}

/** A selection may span several source versions, and the page must be able to say so. */
export function runMixedSourceVersionTests(): void {
  const mixed = preview({
    assets: [asset("a", 1), asset("b", 3), asset("c", 1)],
    deltas: [EMPTY_DELTA, { ...EMPTY_DELTA, fromVersion: 3 }],
  });

  const versions = sourceVersionsInPreview(mixed);
  assert(
    versions.length === 2 && versions[0] === 1 && versions[1] === 3,
    `distinct source versions, ascending — got ${versions.join(", ")}`,
  );
  assert(sourceVersionsInPreview(null).length === 0, "no preview is no versions");
}

/**
 * Assets already on the target are reported, not silently dropped.
 *
 * The server excludes them from `preview.assets`, so "3 selected, 1 migrated"
 * would otherwise read as a bug rather than as the answer.
 */
export function runPartitionSelectionTests(): void {
  const p = preview({ assets: [asset("a"), asset("c")] });
  const split = partitionSelection(["a", "b", "c"], p);

  assert(
    split.willMigrate.join(",") === "a,c",
    `only the assets the server kept may be reported as migrating, got ${split.willMigrate.join(",")}`,
  );
  assert(
    split.alreadyOnTarget.join(",") === "b",
    `the rest must be reported as already on target, got ${split.alreadyOnTarget.join(",")}`,
  );

  const none = partitionSelection(["a"], null);
  assert(none.willMigrate.length === 0 && none.alreadyOnTarget.length === 0, "no preview, no split");
}

/** The delta flattens to lines, refusing changes first. */
export function runDeltaLineTests(): void {
  const lines = deltaLines({
    ...EMPTY_DELTA,
    measuredAdded: [
      { pointKey: "CURRENT", sourceDataKeyPattern: "SITE/{asset_code}/A", required: false, unit: null },
    ],
    measuredRemoved: [
      { pointKey: "VOLTS", fromSourceDataKeyPattern: "OLD", toSourceDataKeyPattern: null },
    ],
    derivedChanged: [
      {
        pointKey: "KWH",
        changedFields: ["formula", "calcIntervalSeconds"],
        from: NO_CALC,
        to: NO_CALC,
      },
    ],
  });

  assert(lines.length === 3, `expected 3 lines, got ${lines.length}`);
  assert(
    lines[0]?.kind === "measured-removed",
    "a refusing change must come first — a reader scanning a long delta has to see what " +
      `blocks them before what does not. Got ${String(lines[0]?.kind)}`,
  );
  assert(
    lines.find((l) => l.pointKey === "CURRENT")?.detail.includes("(optional)") === true,
    "an optional addition must be marked — Q-A skips it rather than refusing, and the " +
      "operator should know which points may not arrive",
  );
  assert(
    lines.find((l) => l.pointKey === "KWH")?.detail === "formula, calcIntervalSeconds changed",
    "a derived change must name the fields, not merely say 'changed' — decision 5 does not " +
      "recompute history, so which fields moved is what makes the series readable afterwards",
  );

  assert(deltaLines(EMPTY_DELTA).length === 0, "an empty delta produces no lines");
}

/** Only a published version is a migration target (decision 1). */
export function runMigrationTargetTests(): void {
  const version = (status: TemplateVersionSummaryDto["status"]): TemplateVersionSummaryDto => ({
    id: "v",
    version: 2,
    status,
    publishedAt: null,
    assetCount: 0,
    pointCount: 3,
  });

  assert(isMigrationTarget(version("published")), "a published version is a target");
  assert(!isMigrationTarget(version("draft")), "a draft is not — publishing is what freezes it");
  assert(!isMigrationTarget(version("archived")), "nor is an archived version");
}

/** The version row says whether it is still in service. */
export function runVersionLabelTests(): void {
  const base: TemplateVersionSummaryDto = {
    id: "v",
    version: 4,
    status: "published",
    publishedAt: "2026-08-22T00:00:00.000Z",
    assetCount: 0,
    pointCount: 3,
  };

  assert(
    versionSummaryLabel(base) === "v4 · published · no assets",
    `got ${versionSummaryLabel(base)}`,
  );
  assert(
    versionSummaryLabel({ ...base, assetCount: 1 }) === "v4 · published · 1 asset",
    "singular, not '1 assets'",
  );
  assert(
    versionSummaryLabel({ ...base, assetCount: 12 }) === "v4 · published · 12 assets",
    "plural above one",
  );
}
