import { randomUUID } from "node:crypto";

import { MAX_ASSET_POINT_BULK_IDS } from "@bms/shared";

import { assetPointBulkUpdateBodySchema } from "./asset-points.schema";

/**
 * `F2.7` Unit I / ADR 0056 decision 8 — the bulk-update body, which is the only
 * request in this folder whose fields live one level down.
 *
 * Everything here is a plain object and needs no connection: the *shape* of the
 * request is what this file pins, and the rules that span rows — a merged band
 * the template inverts, a `computed` row in the selection, a selection crossing
 * two organizations — are the service's and are pinned by
 * `asset-points.bulk-update.integration.spec.ts`.
 *
 * Two properties are worth naming because a plausible refactor breaks each
 * silently:
 *
 * - **The refinement sits on `patch`, not on the body.** A caller who sends a
 *   zero multiplier must be told which field is wrong, and Zod prepends the
 *   parent key only when the refinement is attached to the nested schema. On
 *   the body it would report `scaleMultiplier`, naming a field the body does
 *   not have.
 * - **The id cap is `MAX_ASSET_POINT_BULK_IDS`, asserted through the schema.**
 *   Comparing the constant to itself would pass with the schema saying `.max(5)`;
 *   sending exactly the cap and then one more is what ties the two together.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The issue paths of a refusal, dotted, or `[]` when the value parses. */
function issuePaths(value: unknown): string[] {
  const result = assetPointBulkUpdateBodySchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

function expectAccepted(value: unknown, what: string): void {
  const result = assetPointBulkUpdateBodySchema.safeParse(value);
  assert(
    result.success,
    `${what} — expected the body to parse, got ${JSON.stringify(issuePaths(value))}`,
  );
}

function expectRefusedAt(value: unknown, path: string, what: string): void {
  const paths = issuePaths(value);
  assert(paths.length > 0, `${what} — expected a refusal, the body parsed`);
  assert(
    paths.includes(path),
    `${what} — expected an issue at "${path}", got ${JSON.stringify(paths)}`,
  );
}

/**
 * The keys a `.strict()` object refused, with the object's own path.
 *
 * Zod raises one `unrecognized_keys` issue **on the object**, not one per key,
 * so the path of an unknown `scale_multiplier` inside `patch` is `patch` and
 * the key itself rides in `issue.keys`. Asserting on the path alone would pass
 * for a refusal that came from somewhere else entirely.
 */
function unrecognizedKeys(value: unknown): { path: string; keys: string[] }[] {
  const result = assetPointBulkUpdateBodySchema.safeParse(value);
  if (result.success) {
    return [];
  }
  return result.error.issues
    .filter((issue) => issue.code === "unrecognized_keys")
    .map((issue) => ({
      path: issue.path.join("."),
      keys: [...(issue as { keys: string[] }).keys],
    }));
}

function expectUnknownKeyRefused(value: unknown, path: string, key: string, what: string): void {
  const found = unrecognizedKeys(value);
  assert(
    found.some((issue) => issue.path === path && issue.keys.includes(key)),
    `${what} — expected "${key}" refused on "${path}", got ${JSON.stringify(found)}`,
  );
}

/** `n` distinct uuids — distinct, so the cap is about length and not about a set. */
function ids(n: number): string[] {
  return Array.from({ length: n }, () => randomUUID());
}

const ONE_ID = ids(1);

/** A patch must state something; the id list must name at least one row. */
export function assertAnEmptyPatchAndAnEmptyIdListAreRefused(): void {
  expectRefusedAt(
    { ids: ONE_ID, patch: {} },
    "patch",
    "a patch that states no field is a request that would report success and change nothing",
  );
  expectRefusedAt({ ids: [], patch: { active: false } }, "ids", "a selection of no rows");
  expectRefusedAt(
    { ids: ["not-a-uuid"], patch: { active: false } },
    "ids.0",
    "an id that is not a uuid",
  );
}

/** The cap is the shared constant, and it is enforced by the schema. */
export function assertTheIdListIsCappedAtTheSharedMaximum(): void {
  assert(
    MAX_ASSET_POINT_BULK_IDS === 500,
    `ADR 0056 decision 8 sets the cap at 500, got ${MAX_ASSET_POINT_BULK_IDS}`,
  );
  expectAccepted(
    { ids: ids(MAX_ASSET_POINT_BULK_IDS), patch: { active: false } },
    "exactly the cap",
  );
  expectRefusedAt(
    { ids: ids(MAX_ASSET_POINT_BULK_IDS + 1), patch: { active: false } },
    "ids",
    "one id past the cap",
  );
}

/** The within-row rules apply to the patch, and report the field under `patch`. */
export function assertTheWithinRowRulesReportUnderPatch(): void {
  expectRefusedAt(
    { ids: ONE_ID, patch: { scaleMultiplier: 0 } },
    "patch.scaleMultiplier",
    "a zero multiplier would store 0 for every reading",
  );
  expectRefusedAt(
    { ids: ONE_ID, patch: { engMin: 100, engMax: 100 } },
    "patch.engMin",
    "an empty band",
  );
  expectRefusedAt(
    { ids: ONE_ID, patch: { qualityPolicy: "clamp" } },
    "patch.qualityPolicy",
    "a policy outside the vocabulary",
  );
  expectRefusedAt(
    { ids: ONE_ID, patch: { scaleMultiplier: Number.POSITIVE_INFINITY } },
    "patch.scaleMultiplier",
    "a non-finite multiplier",
  );
}

/** Both objects are `.strict()`: an unknown key is a caller error, never dropped. */
export function assertAnUnknownKeyIsRefusedOnBothObjects(): void {
  expectUnknownKeyRefused(
    { ids: ONE_ID, patch: { active: false, scale_multiplier: 2 } },
    "patch",
    "scale_multiplier",
    "a snake_case spelling of a real field would otherwise be silently dropped at 200",
  );
  expectUnknownKeyRefused(
    { ids: ONE_ID, patch: { active: false }, locationId: randomUUID() },
    "",
    "locationId",
    "a field the body does not have",
  );
  expectUnknownKeyRefused(
    { ids: ONE_ID, patch: { active: false, pointKey: "kw" } },
    "patch",
    "pointKey",
    "the bulk editor does not re-key rows; a caller who thinks it does must be told",
  );
}

/**
 * What the patch accepts: a value sets it, `null` clears the override back to
 * the template default, and an absent field leaves the stored value alone.
 */
export function assertTheThreeSpellingsOfEachPatchFieldParse(): void {
  expectAccepted({ ids: ONE_ID, patch: { active: false } }, "the state flip alone");
  expectAccepted({ ids: ONE_ID, patch: { unit: "kW" } }, "a unit");
  expectAccepted({ ids: ONE_ID, patch: { unit: null } }, "a cleared unit");
  expectAccepted(
    {
      ids: ONE_ID,
      patch: {
        scaleMultiplier: 0.1,
        scaleOffset: -40,
        engMin: 0,
        engMax: 100,
        qualityPolicy: "accept_bad",
      },
    },
    "all five set",
  );
  // A patch of five nulls states five fields: it clears every override on every
  // selected row, which is a legitimate edit and not an empty request.
  expectAccepted(
    {
      ids: ONE_ID,
      patch: {
        scaleMultiplier: null,
        scaleOffset: null,
        engMin: null,
        engMax: null,
        qualityPolicy: null,
      },
    },
    "all five cleared",
  );
  // One bound alone is a half-band. The other half may be inherited, and only
  // the service can see it — this is the split ADR 0056 decision 2 draws.
  expectAccepted({ ids: ONE_ID, patch: { engMin: 150 } }, "one bound alone");
}
