import type { OnboardingDraft, OnboardingDraftAssetPoint } from "@bms/shared";

import { quoteCell } from "../spreadsheet-guard";
import { COMMIT_UNIQUE_CONFLICTS } from "./onboarding-commit-conflict";
import { unresolvedPointKey } from "./onboarding-template-refs";

export type AssetPointProblemKind = "asset" | "templated" | "key" | "duplicate_key" | "duplicate_source";

export type AssetPointProblem = {
  /** Into `added`. */
  readonly index: number;
  readonly field: "assetIndex" | "pointKey" | "sourceDataKey";
  readonly kind: AssetPointProblemKind;
  readonly message: string;
};

/**
 * The commit's refusal for a constraint, read from the one table that owns the
 * sentence. Resolved at module load, and it throws there when the name is
 * gone, so a renamed constraint fails every import instead of yielding an
 * `undefined` message.
 */
function uniqueConflictMessage(constraint: string): string {
  const conflict = COMMIT_UNIQUE_CONFLICTS.get(constraint);
  if (conflict === undefined) {
    throw new Error(`COMMIT_UNIQUE_CONFLICTS has no entry for ${constraint}`);
  }
  return conflict.message;
}

const DUPLICATE_POINT_KEY = uniqueConflictMessage("asset_points_asset_id_point_key_unique");
const DUPLICATE_SOURCE_DATA_KEY = uniqueConflictMessage("asset_points_asset_source_key_idx");

/** `F3.22` V4: a templated asset's points are its template's; a mapping onto it would write a second, unplanned row. */
function templatedAssetMessage(assetCode: string): string {
  return (
    `Asset ${quoteCell(assetCode)} is built from a template; ` +
    "its points come from the template, so map no point to it"
  );
}

/** One `(assetIndex, value)` pair as a set key. Exact: the unique indexes are on the raw columns (ADR 0092 context 3). */
function pairKey(assetIndex: number, value: string): string {
  return JSON.stringify([assetIndex, value]);
}

/**
 * `F3.23` / ADR 0092 decision 2 — whether the rows in `added` will commit:
 * each row's asset exists and is plain, its point key resolves
 * (`unresolvedPointKey` against the draft's declared keys and `catalog`, the
 * fleet `point_keys` code → active), and its `(assetIndex, pointKey)` and
 * `(assetIndex, sourceDataKey)` pairs appear nowhere in `existing` or in the
 * rows of `added` before it. Strings compare exactly.
 *
 * At most one problem per field, in field order. A row whose asset fails
 * reports only that: there is no asset to hold its key or source. The
 * validator (`existing` empty, `added` every row) and the mapping tools
 * (`existing` the draft's rows, `added` the call's) ask this one question, so
 * a tool cannot write what validation refuses, and validation cannot pass what
 * the commit's `23503` or `23505` refuses.
 */
export function assetPointProblems(
  existing: readonly OnboardingDraftAssetPoint[],
  added: readonly OnboardingDraftAssetPoint[],
  draft: Pick<OnboardingDraft, "assets" | "pointKeys">,
  catalog: ReadonlyMap<string, boolean>,
): AssetPointProblem[] {
  const assets = draft.assets ?? [];
  const declared = new Set((draft.pointKeys ?? []).map((key) => key.code));
  const keyPairs = new Set(existing.map((row) => pairKey(row.assetIndex, row.pointKey)));
  const sourcePairs = new Set(existing.map((row) => pairKey(row.assetIndex, row.sourceDataKey)));
  const problems: AssetPointProblem[] = [];

  added.forEach((row, index) => {
    const asset = Number.isInteger(row.assetIndex) && row.assetIndex >= 0 ? assets[row.assetIndex] : undefined;
    if (asset === undefined) {
      problems.push({ index, field: "assetIndex", kind: "asset", message: "assetIndex out of range" });
      return;
    }
    if (asset.template) {
      problems.push({ index, field: "assetIndex", kind: "templated", message: templatedAssetMessage(asset.code) });
      return;
    }

    const keyPair = pairKey(row.assetIndex, row.pointKey);
    const unresolved = unresolvedPointKey(row.pointKey, declared, catalog);
    if (unresolved !== null) {
      problems.push({ index, field: "pointKey", kind: "key", message: unresolved });
    } else if (keyPairs.has(keyPair)) {
      problems.push({ index, field: "pointKey", kind: "duplicate_key", message: DUPLICATE_POINT_KEY });
    }

    const sourcePair = pairKey(row.assetIndex, row.sourceDataKey);
    if (sourcePairs.has(sourcePair)) {
      problems.push({ index, field: "sourceDataKey", kind: "duplicate_source", message: DUPLICATE_SOURCE_DATA_KEY });
    }

    keyPairs.add(keyPair);
    sourcePairs.add(sourcePair);
  });
  return problems;
}
