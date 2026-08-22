import type {
  TemplateMigrationPreviewResponse,
  TemplateMigrationRefusalDto,
  TemplateVersionDeltaDto,
  TemplateVersionSummaryDto,
} from "@bms/shared";

/**
 * The rules behind the Versions / migration view (`F2.6`, ADR 0039 decision 8).
 *
 * ## Why this is in `lib/` and not beside the page that renders it
 *
 * `apps/web`'s Vitest project runs `environment: "node"` over
 * `src/**\/*.test.ts`, and the coverage gate's `include` reaches
 * `apps/web/src/lib/**` and nothing above it — so a `.tsx` is untestable *and*
 * uncovered in this repository. Every rule that could be wrong lives here; the
 * page holds none.
 *
 * ## The rule that matters
 *
 * **`canApply` comes from the server and is never recomputed.** `migrate`
 * re-runs the preview and refuses if it is not clean, so the server's answer is
 * the only one that decides anything. A client deriving its own verdict from
 * `refusals` would be a second implementation of a decision it does not own,
 * and the two would disagree exactly when it mattered — a refusal reason added
 * to the API and not to this file would leave the button enabled.
 */

/** What the migrate action may do right now, and why not when it may not. */
export type MigrateActionState =
  | { enabled: true }
  | { enabled: false; reason: "no-selection" | "no-preview" | "refused" | "nothing-to-do"; message: string };

/**
 * Whether Migrate is clickable.
 *
 * Four distinct "no", not one: an operator who has selected nothing, has not
 * previewed, has been refused, or has selected only assets already on this
 * version needs four different next actions, and a single greyed-out button
 * tells them none of it.
 */
export function migrateActionState(
  selectedAssetIds: readonly string[],
  preview: TemplateMigrationPreviewResponse | null,
): MigrateActionState {
  if (selectedAssetIds.length === 0) {
    return {
      enabled: false,
      reason: "no-selection",
      message: "Select the assets to migrate.",
    };
  }
  if (preview === null) {
    return {
      enabled: false,
      reason: "no-preview",
      message: "Preview the migration before applying it.",
    };
  }
  if (!preview.canApply) {
    return {
      enabled: false,
      reason: "refused",
      message:
        preview.refusals.length === 1
          ? "This migration is refused. See the reason below."
          : `This migration is refused for ${preview.refusals.length} reasons. See below.`,
    };
  }
  if (preview.assets.length === 0) {
    return {
      enabled: false,
      reason: "nothing-to-do",
      message: "Every selected asset is already on this version.",
    };
  }
  return { enabled: true };
}

/**
 * The refusal sentences, verbatim from the API.
 *
 * Deliberately a pass-through rather than a mapping from `reason` to a local
 * string. The server's message names the point key, the asset code, the
 * unresolved tokens or the two domain codes — the specifics that make a refusal
 * actionable — and a client-side lookup table would replace all of it with a
 * generic sentence per category. The `reason` is carried alongside only so the
 * page can group or icon them.
 */
export function refusalMessages(
  preview: TemplateMigrationPreviewResponse | null,
): readonly TemplateMigrationRefusalDto[] {
  return preview?.refusals ?? [];
}

/**
 * The source versions a selection actually spans.
 *
 * A selection is a set of asset ids and nothing stops them sitting on different
 * versions of one code, which is why the preview returns an array of deltas.
 * The page has to say so — "migrating 12 assets" reads very differently from
 * "migrating 12 assets from three different versions".
 */
export function sourceVersionsInPreview(
  preview: TemplateMigrationPreviewResponse | null,
): number[] {
  if (preview === null) {
    return [];
  }
  return [...new Set(preview.assets.map((asset) => asset.fromVersion))].sort((a, b) => a - b);
}

/**
 * The assets that will actually move, split from the ones already on target.
 *
 * The preview's `assets` array already excludes assets on the target version —
 * the server drops them — so anything the caller selected and does not see back
 * is already there. Reporting that rather than silently shrinking the count is
 * the difference between "1 of 3 migrated" reading as a bug or as an answer.
 */
export function partitionSelection(
  selectedAssetIds: readonly string[],
  preview: TemplateMigrationPreviewResponse | null,
): { willMigrate: string[]; alreadyOnTarget: string[] } {
  if (preview === null) {
    return { willMigrate: [], alreadyOnTarget: [] };
  }
  const moving = new Set(preview.assets.map((asset) => asset.assetId));
  return {
    willMigrate: selectedAssetIds.filter((id) => moving.has(id)),
    alreadyOnTarget: selectedAssetIds.filter((id) => !moving.has(id)),
  };
}

/** One line of the delta summary, ready to render. */
export type DeltaLine = {
  kind: "measured-added" | "measured-removed" | "measured-rekeyed" | "derived-added" | "derived-removed" | "derived-changed";
  pointKey: string;
  detail: string;
};

/**
 * Flattens a delta into ordered lines.
 *
 * Refusing changes come first, because a reader scanning a long delta must see
 * what blocks them before what does not. Within that, the order is the delta's
 * own — which is `sortOrder` then `pointKey`, from the API's query.
 */
export function deltaLines(delta: TemplateVersionDeltaDto): DeltaLine[] {
  const lines: DeltaLine[] = [];

  for (const entry of delta.measuredRemoved) {
    lines.push({
      kind: "measured-removed",
      pointKey: entry.pointKey,
      detail: "removed — refuses this migration",
    });
  }
  for (const entry of delta.measuredReKeyed) {
    lines.push({
      kind: "measured-rekeyed",
      pointKey: entry.pointKey,
      detail: `source key ${entry.fromSourceDataKeyPattern ?? "none"} → ${
        entry.toSourceDataKeyPattern ?? "none"
      } — refuses this migration`,
    });
  }
  for (const entry of delta.measuredAdded) {
    lines.push({
      kind: "measured-added",
      pointKey: entry.pointKey,
      detail: `added${entry.required ? "" : " (optional)"} — a telemetry point will be created`,
    });
  }
  for (const entry of delta.derivedAdded) {
    lines.push({
      kind: "derived-added",
      pointKey: entry.pointKey,
      detail: "added — computed, no telemetry point is created",
    });
  }
  for (const entry of delta.derivedRemoved) {
    lines.push({
      kind: "derived-removed",
      pointKey: entry.pointKey,
      detail: "removed — stops computing after the migration",
    });
  }
  for (const entry of delta.derivedChanged) {
    lines.push({
      kind: "derived-changed",
      pointKey: entry.pointKey,
      // Naming the fields, not just "changed". ADR 0039 decision 5 does not
      // recompute history, so a formula change means one series computed two
      // different ways either side of the migration — the reader has to see
      // which fields moved to judge that.
      detail: `${entry.changedFields.join(", ")} changed`,
    });
  }

  return lines;
}

/** Whether a version can be a migration target at all — decision 1. */
export function isMigrationTarget(version: TemplateVersionSummaryDto): boolean {
  return version.status === "published";
}

/**
 * How a version row reads in the list.
 *
 * `assetCount` is the point of the view: a version with no assets is history,
 * and one with assets is in service. Saying so removes a count the reader would
 * otherwise have to interpret.
 */
export function versionSummaryLabel(version: TemplateVersionSummaryDto): string {
  const inService =
    version.assetCount === 0
      ? "no assets"
      : version.assetCount === 1
        ? "1 asset"
        : `${version.assetCount} assets`;
  return `v${version.version} · ${version.status} · ${inService}`;
}
