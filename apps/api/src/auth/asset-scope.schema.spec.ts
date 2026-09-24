import { randomUUID } from "node:crypto";

import { z } from "zod";

import { MAX_SCOPE_ASSET_IDS, assetIdsQueryField } from "./asset-scope.schema";

/**
 * `F3.28` (ADR 0074, plan decision 1) — `assetIdsQueryField`'s normalisation
 * of a repeated query parameter and its bound. Wrapped in a bare object so it
 * parses the way `@Query()` hands the raw value to a schema field, not as a
 * standalone schema.
 *
 * One claim per exported function; `asset-scope.schema.test.ts` is the vitest
 * entry point (ADR 0014).
 */

const probe = z.object({ assetIds: assetIdsQueryField }).strict();

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function ids(n: number): string[] {
  return Array.from({ length: n }, () => randomUUID());
}

/** A single occurrence — the bare string Nest hands back for one `?assetIds=`. */
export function assertSingleValueBecomesOneElementArray(): void {
  const [id] = ids(1);
  const result = probe.safeParse({ assetIds: id });
  assert(
    result.success === true,
    `a single assetIds value must parse: ${JSON.stringify(result.success ? undefined : result.error.issues)}`,
  );
  assert(
    result.success && JSON.stringify(result.data.assetIds) === JSON.stringify([id]),
    "a single assetIds value must normalise to a one-element array",
  );
}

/** An absent parameter stays absent — no field means no scope narrowing. */
export function assertAbsentAssetIdsStaysUndefined(): void {
  const result = probe.safeParse({});
  assert(result.success === true, "an object with no assetIds field must parse");
  assert(
    result.success && result.data.assetIds === undefined,
    "an absent assetIds must stay undefined, not become an empty array",
  );
}

/** Exactly the cap parses; one past it is refused. */
export function assertTheCapIsEnforced(): void {
  const atCap = probe.safeParse({ assetIds: ids(MAX_SCOPE_ASSET_IDS) });
  assert(
    atCap.success === true,
    `exactly ${MAX_SCOPE_ASSET_IDS} ids must parse: ${JSON.stringify(atCap.success ? undefined : atCap.error.issues)}`,
  );

  const overCap = probe.safeParse({ assetIds: ids(MAX_SCOPE_ASSET_IDS + 1) });
  assert(overCap.success === false, `${MAX_SCOPE_ASSET_IDS + 1} ids must be refused`);
}

/** A non-uuid string is refused, whether alone or beside real uuids. */
export function assertANonUuidIsRefused(): void {
  const result = probe.safeParse({ assetIds: ["not-a-uuid"] });
  assert(result.success === false, "a non-uuid assetIds value must be refused");
}
