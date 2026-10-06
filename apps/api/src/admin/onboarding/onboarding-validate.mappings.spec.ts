/**
 * `F3.23` / ADR 0092 decision 2 (closes `F4.119`) — the validator asks
 * `assetPointProblems` of `draft.assetPoints`, so a draft whose mapping names
 * a key that will not resolve, or repeats a pair the unique indexes refuse, is
 * not `readyToCommit`: it is a 400 at validation, never a `23503` (500) or
 * `23505` (409) at commit.
 *
 * Kept apart from `onboarding-validate.service.spec.ts` for the §4.5 file cap.
 */
import type { OnboardingDraft, OnboardingFieldError } from "@bms/shared";

import { quoteCell } from "../spreadsheet-guard";
import { COMMIT_UNIQUE_CONFLICTS } from "./onboarding-commit-conflict";
import { EMPTY_TEMPLATE_CONTEXT, unresolvedPointKey, type ValidateTemplateContext } from "./onboarding-template-refs";
import { OnboardingValidateService, type ValidateResult } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const CODES: readonly string[] = ["smoc_campus", "rsmoc", "csmoc", "pump_station"];

const DUPLICATE_KEY = COMMIT_UNIQUE_CONFLICTS.get("asset_points_asset_id_point_key_unique")!.message;
const DUPLICATE_SOURCE = COMMIT_UNIQUE_CONFLICTS.get("asset_points_asset_source_key_idx")!.message;

/** A draft ready to commit: one plain asset, `kw` declared, one mapping `s01 → kw`. */
function readyDraft(): OnboardingDraft {
  return {
    location: {
      name: "Lotapata",
      slug: "lotapata",
      code: "LOTAPATA",
      type: "pump_station",
      latitude: 22.3,
      longitude: 87.3,
    },
    rtus: [
      {
        code: "RTU-1",
        displayName: "RTU 1",
        protocol: "modbus_tcp",
        config: { host: "10.0.0.1", port: 502 },
        credentialsSet: false,
        ingestEnabled: false,
      },
    ],
    pointKeys: [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }],
    assets: [
      { code: "LOTAPATA-ASSET-1", name: "Asset 1", siteName: "Lotapata", rtuIndex: 0, domain: "electrical" },
    ],
    assetPoints: [{ assetIndex: 0, pointKey: "kw", sourceDataKey: "s01" }],
  } as OnboardingDraft;
}

function validate(draft: OnboardingDraft, templates: ValidateTemplateContext = EMPTY_TEMPLATE_CONTEXT): ValidateResult {
  return new OnboardingValidateService().validate(draft, CODES, templates);
}

function mappingErrors(result: ValidateResult): OnboardingFieldError[] {
  return result.errors.filter((error) => error.path.startsWith("assetPoints."));
}

function assertErrorsAre(actual: readonly OnboardingFieldError[], expected: readonly OnboardingFieldError[], what: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

/** A draft whose one mapping names `kvar`, which the draft does not declare and the catalog does not hold. */
function undeclaredKeyDraft(): OnboardingDraft {
  const draft = readyDraft();
  draft.assetPoints = [{ assetIndex: 0, pointKey: "kvar", sourceDataKey: "s01" }];
  return draft;
}

/** V1 — an undeclared mapping key is an error at `assetPoints.0.pointKey` with the `unresolvedPointKey` sentence. */
export function assertV1AnUndeclaredMappingKeyIsAnError(): void {
  const message = unresolvedPointKey("kvar", new Set(["kw"]), EMPTY_TEMPLATE_CONTEXT.pointKeys);
  assert(message !== null, "V1 fixture: kvar must be unresolved");
  assertErrorsAre(validate(undeclaredKeyDraft()).errors, [{ path: "assetPoints.0.pointKey", message: message! }], "V1");
}

/** V1 — the same draft is not ready to commit (`F4.119`: it would fail at commit as a `23503`). */
export function assertV1AnUndeclaredMappingKeyIsNotReady(): void {
  const result = validate(undeclaredKeyDraft());
  assert(result.readyToCommit === false, "a draft mapping an undeclared key must not be ready to commit");
}

/** V1 control — declare the key and the same draft is ready to commit. */
export function assertV1ControlDeclaringTheKeyMakesItReady(): void {
  const draft = undeclaredKeyDraft();
  draft.pointKeys = [...(draft.pointKeys ?? []), { code: "kvar", name: "Reactive Power" }];
  const result = validate(draft);
  assert(
    result.readyToCommit === true,
    `declaring the key must make the draft ready, got errors ${JSON.stringify(result.errors)} at ${result.suggestedPhase}`,
  );
}

/** V2 — one point key twice on one asset is an error on the second row's `pointKey`. */
export function assertV2ADuplicatePointKeyIsAnError(): void {
  const draft = readyDraft();
  draft.assetPoints!.push({ assetIndex: 0, pointKey: "kw", sourceDataKey: "s02" });
  assertErrorsAre(validate(draft).errors, [{ path: "assetPoints.1.pointKey", message: DUPLICATE_KEY }], "V2");
}

/** V3 — one source data key twice on one asset is an error on the second row's `sourceDataKey`. */
export function assertV3ADuplicateSourceDataKeyIsAnError(): void {
  const draft = readyDraft();
  draft.pointKeys!.push({ code: "kvar", name: "Reactive Power" });
  draft.assetPoints!.push({ assetIndex: 0, pointKey: "kvar", sourceDataKey: "s01" });
  assertErrorsAre(validate(draft).errors, [{ path: "assetPoints.1.sourceDataKey", message: DUPLICATE_SOURCE }], "V3");
}

/** V4 — a mapping onto a templated asset keeps its path `assetPoints.{i}.assetIndex` and the F3.22 sentence. */
export function assertV4ATemplatedAssetKeepsItsPathAndSentence(): void {
  const draft = readyDraft();
  draft.assets!.push({
    code: "PUMP-1",
    name: "Pump 1",
    siteName: "Lotapata",
    rtuIndex: 0,
    domain: "water",
    template: { code: "PUMP" },
  });
  draft.assetPoints!.push({ assetIndex: 1, pointKey: "kw", sourceDataKey: "s02" });
  assertErrorsAre(
    mappingErrors(validate(draft)),
    [
      {
        path: "assetPoints.1.assetIndex",
        message: `Asset ${quoteCell("PUMP-1")} is built from a template; its points come from the template, so map no point to it`,
      },
    ],
    "V4",
  );
}

/** V5 — a row with no asset reports only `assetIndex out of range`, though its key and source are bad too. */
export function assertV5AnOutOfRangeRowReportsOnlyTheIndex(): void {
  const draft = readyDraft();
  draft.assetPoints!.push({ assetIndex: 9, pointKey: "kvar", sourceDataKey: "s01" });
  assertErrorsAre(
    mappingErrors(validate(draft)),
    [{ path: "assetPoints.1.assetIndex", message: "assetIndex out of range" }],
    "V5",
  );
}

/** V5 control — the same row on the asset reports its key and its source. */
export function assertV5ControlTheSameRowInRangeReportsTheKeyAndSource(): void {
  const draft = readyDraft();
  draft.assetPoints!.push({ assetIndex: 0, pointKey: "kvar", sourceDataKey: "s01" });
  assertErrorsAre(
    mappingErrors(validate(draft)),
    [
      {
        path: "assetPoints.1.pointKey",
        message: unresolvedPointKey("kvar", new Set(["kw"]), EMPTY_TEMPLATE_CONTEXT.pointKeys)!,
      },
      { path: "assetPoints.1.sourceDataKey", message: DUPLICATE_SOURCE },
    ],
    "V5 control",
  );
}

/** The `useExistingPointKeys` draft: no declared key, the mapping names `kw`. */
function existingKeysDraft(): OnboardingDraft {
  const draft = readyDraft();
  delete draft.pointKeys;
  draft.onboardingMeta = { useExistingPointKeys: true };
  return draft;
}

/** V6 — a key the catalog holds active passes with no declaration. */
export function assertV6AnActiveCatalogKeyPassesUndeclared(): void {
  const result = validate(existingKeysDraft(), { ...EMPTY_TEMPLATE_CONTEXT, pointKeys: new Map([["kw", true]]) });
  assert(
    result.readyToCommit === true,
    `an active catalog key must pass undeclared, got errors ${JSON.stringify(result.errors)} at ${result.suggestedPhase}`,
  );
}

/** V6 control — the same draft against a catalog without `kw` is an error at `assetPoints.0.pointKey`. */
export function assertV6ControlTheSameKeyOutsideTheCatalogIsAnError(): void {
  const result = validate(existingKeysDraft());
  assert(
    result.errors.some((error) => error.path === "assetPoints.0.pointKey"),
    `the same key outside the catalog must be an error, got ${JSON.stringify(result.errors)}`,
  );
}
