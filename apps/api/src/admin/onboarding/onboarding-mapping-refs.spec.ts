/**
 * `F3.23` / ADR 0092 decision 2 — `assetPointProblems`, the one question the
 * validator and the mapping tools ask of a draft mapping: does the asset exist
 * and is it plain, does the point key resolve, and is each `(asset, point key)`
 * and `(asset, source data key)` pair unique, compared exactly.
 *
 * Every claim has its own positive control, exported beside it and run in its
 * own `it()`, so an absence (`[]`) is never the only evidence.
 */
import type { OnboardingDraft, OnboardingDraftAssetPoint } from "@bms/shared";

import { quoteCell } from "../spreadsheet-guard";
import { COMMIT_UNIQUE_CONFLICTS } from "./onboarding-commit-conflict";
import { assetPointProblems, type AssetPointProblem } from "./onboarding-mapping-refs";
import { unresolvedPointKey } from "./onboarding-template-refs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertProblems(actual: readonly AssetPointProblem[], expected: readonly AssetPointProblem[], what: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

const NO_CATALOG: ReadonlyMap<string, boolean> = new Map();

const DUPLICATE_KEY = COMMIT_UNIQUE_CONFLICTS.get("asset_points_asset_id_point_key_unique")!.message;
const DUPLICATE_SOURCE = COMMIT_UNIQUE_CONFLICTS.get("asset_points_asset_source_key_idx")!.message;

/** Asset 0 and 2 are plain, asset 1 is templated; the draft declares `kw`, `kvar` and `pf`. */
function draft(declared: readonly string[] = ["kw", "kvar", "pf"]): Pick<OnboardingDraft, "assets" | "pointKeys"> {
  return {
    assets: [
      { code: "A-1", name: "Asset 1", siteName: "Site", rtuIndex: 0, domain: "electrical" },
      { code: "T-1", name: "Pump 1", siteName: "Site", rtuIndex: 0, domain: "water", template: { code: "PUMP" } },
      { code: "A-2", name: "Asset 2", siteName: "Site", rtuIndex: 0, domain: "electrical" },
    ],
    pointKeys: declared.map((code) => ({ code, name: code })),
  };
}

function row(assetIndex: number, pointKey: string, sourceDataKey: string): OnboardingDraftAssetPoint {
  return { assetIndex, pointKey, sourceDataKey };
}

/** M1 — an `assetIndex` past `draft.assets` is an `asset` problem on `assetIndex`. */
export function assertM1AnIndexPastTheAssetsIsAProblem(): void {
  assertProblems(
    assetPointProblems([], [row(5, "kw", "s01")], draft(), NO_CATALOG),
    [{ index: 0, field: "assetIndex", kind: "asset", message: "assetIndex out of range" }],
    "M1",
  );
}

/** M1 control — the same row on an asset that exists is clean. */
export function assertM1ControlAnIndexInRangePasses(): void {
  assertProblems(assetPointProblems([], [row(0, "kw", "s01")], draft(), NO_CATALOG), [], "M1 control");
}

/** M2 — a mapping onto a templated asset is refused with the F3.22 V4 sentence. */
export function assertM2ATemplatedAssetIsAProblem(): void {
  assertProblems(
    assetPointProblems([], [row(1, "kw", "s01")], draft(), NO_CATALOG),
    [
      {
        index: 0,
        field: "assetIndex",
        kind: "templated",
        message: `Asset ${quoteCell("T-1")} is built from a template; its points come from the template, so map no point to it`,
      },
    ],
    "M2",
  );
}

/** M2 control — the same row on a plain asset is clean. */
export function assertM2ControlAPlainAssetPasses(): void {
  assertProblems(assetPointProblems([], [row(2, "kw", "s01")], draft(), NO_CATALOG), [], "M2 control");
}

/** M3 — a key neither declared nor in the catalog is a `key` problem with the `unresolvedPointKey` sentence. */
export function assertM3AnUnresolvedKeyIsAProblem(): void {
  const message = unresolvedPointKey("kwh", new Set(["kw", "kvar", "pf"]), NO_CATALOG);
  assert(message !== null, "M3 fixture: kwh must be unresolved");
  assertProblems(
    assetPointProblems([], [row(0, "kwh", "s01")], draft(), NO_CATALOG),
    [{ index: 0, field: "pointKey", kind: "key", message: message! }],
    "M3",
  );
}

/** M3 control — the same row with the key declared is clean. */
export function assertM3ControlADeclaredKeyPasses(): void {
  assertProblems(
    assetPointProblems([], [row(0, "kwh", "s01")], draft(["kw", "kwh"]), NO_CATALOG),
    [],
    "M3 control",
  );
}

/** M4 — a key the catalog holds inactive is refused even when the draft declares it. */
export function assertM4AnInactiveCatalogKeyIsAProblemEvenWhenDeclared(): void {
  const catalog = new Map([["kvar", false]]);
  assertProblems(
    assetPointProblems([], [row(0, "kvar", "s01")], draft(), catalog),
    [{ index: 0, field: "pointKey", kind: "key", message: unresolvedPointKey("kvar", new Set(["kvar"]), catalog)! }],
    "M4",
  );
}

/** M4 control — a key the catalog holds active passes with no declaration. */
export function assertM4ControlAnActiveCatalogKeyPassesUndeclared(): void {
  assertProblems(
    assetPointProblems([], [row(0, "kvah", "s01")], draft([]), new Map([["kvah", true]])),
    [],
    "M4 control",
  );
}

/** M5 — an `(assetIndex, pointKey)` pair already in `existing` is a `duplicate_key` problem. */
export function assertM5ADuplicateKeyAgainstExistingIsAProblem(): void {
  assertProblems(
    assetPointProblems([row(0, "kw", "s01")], [row(0, "kw", "s02")], draft(), NO_CATALOG),
    [{ index: 0, field: "pointKey", kind: "duplicate_key", message: DUPLICATE_KEY }],
    "M5",
  );
}

/** M5 control — the same added row with nothing existing is clean. */
export function assertM5ControlTheSameRowAloneIsClean(): void {
  assertProblems(assetPointProblems([], [row(0, "kw", "s02")], draft(), NO_CATALOG), [], "M5 control");
}

/** M6 — a `sourceDataKey` repeated inside `added` is reported on the later row. */
export function assertM6ADuplicateSourceInsideAddedIsAProblem(): void {
  assertProblems(
    assetPointProblems([], [row(0, "kw", "s01"), row(0, "kvar", "s02"), row(0, "pf", "s01")], draft(), NO_CATALOG),
    [{ index: 2, field: "sourceDataKey", kind: "duplicate_source", message: DUPLICATE_SOURCE }],
    "M6",
  );
}

/** M6 control — three distinct source keys are clean. */
export function assertM6ControlDistinctSourcesPass(): void {
  assertProblems(
    assetPointProblems([], [row(0, "kw", "s01"), row(0, "kvar", "s02"), row(0, "pf", "s03")], draft(), NO_CATALOG),
    [],
    "M6 control",
  );
}

/** M7 — the same point key and source key on two different assets is clean (uniqueness is per asset). */
export function assertM7TheSamePairsOnTwoAssetsPass(): void {
  assertProblems(
    assetPointProblems([], [row(0, "kw", "s01"), row(2, "kw", "s01")], draft(), NO_CATALOG),
    [],
    "M7",
  );
}

/** M7 control — the same two rows on one asset are refused on both pairs. */
export function assertM7ControlTheSamePairsOnOneAssetAreProblems(): void {
  assertProblems(
    assetPointProblems([], [row(0, "kw", "s01"), row(0, "kw", "s01")], draft(), NO_CATALOG),
    [
      { index: 1, field: "pointKey", kind: "duplicate_key", message: DUPLICATE_KEY },
      { index: 1, field: "sourceDataKey", kind: "duplicate_source", message: DUPLICATE_SOURCE },
    ],
    "M7 control",
  );
}

/** M8 — `S01` and `s01` on one asset are two source keys: the compare is exact, as the unique index is. */
export function assertM8SourceKeysCompareExactly(): void {
  assertProblems(
    assetPointProblems([], [row(0, "kw", "S01"), row(0, "kvar", "s01")], draft(), NO_CATALOG),
    [],
    "M8",
  );
}

/** M8 control — the same rows with one spelling are refused. */
export function assertM8ControlOneSpellingIsAProblem(): void {
  assertProblems(
    assetPointProblems([], [row(0, "kw", "s01"), row(0, "kvar", "s01")], draft(), NO_CATALOG),
    [{ index: 1, field: "sourceDataKey", kind: "duplicate_source", message: DUPLICATE_SOURCE }],
    "M8 control",
  );
}

/** M9 — a row with a bad key and a duplicate source key reports both, in field order. */
export function assertM9TwoDefectsOnOneRowAreBothReportedInFieldOrder(): void {
  assertProblems(
    assetPointProblems([row(0, "kw", "s01")], [row(0, "kwh", "s01")], draft(), NO_CATALOG),
    [
      {
        index: 0,
        field: "pointKey",
        kind: "key",
        message: unresolvedPointKey("kwh", new Set(["kw", "kvar", "pf"]), NO_CATALOG)!,
      },
      { index: 0, field: "sourceDataKey", kind: "duplicate_source", message: DUPLICATE_SOURCE },
    ],
    "M9",
  );
}

/** M9 control — a row with no asset stops at `assetIndex`: no key or source problem rides on it. */
export function assertM9ControlARowWithNoAssetStopsAtTheIndex(): void {
  assertProblems(
    assetPointProblems([row(0, "kw", "s01")], [row(9, "kwh", "s01")], draft(), NO_CATALOG),
    [{ index: 0, field: "assetIndex", kind: "asset", message: "assetIndex out of range" }],
    "M9 control",
  );
}
