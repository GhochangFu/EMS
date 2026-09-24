import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

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

/**
 * The query string as the API's own Express parses it (`qs`, `arrayLimit: 20`),
 * not a hand-built array — the parser is what turned 21 repeats into an
 * object. Resolved through `@nestjs/platform-express`, the adapter `main.ts`
 * boots, so it is the same `express` build the running API uses.
 */
// Loaded once, at import: a cold `require("express")` inside the first `it()`
// took over a second alone and crossed the 5 s timeout in a combined run.
const apiQueryParser = (
  createRequire(require.resolve("@nestjs/platform-express"))("express") as () => {
    get(name: string): (q: string) => Record<string, unknown>;
  }
)().get("query parser fn");

function parseAsTheApiDoes(query: string): Record<string, unknown> {
  return apiQueryParser(query);
}

function repeated(values: string[]): string {
  return values.map((value) => `assetIds=${value}`).join("&");
}

/** 21 repeats — one past qs's arrayLimit — still parse, in order. */
export function assertTwentyOneRepeatsParseInOrder(): void {
  const sent = ids(21);
  const result = probe.safeParse(parseAsTheApiDoes(repeated(sent)));
  assert(result.success === true, `21 repeated assetIds must parse: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
  assert(
    result.success && JSON.stringify(result.data.assetIds) === JSON.stringify(sent),
    "21 repeated assetIds must arrive in the order sent",
  );
}

/** The cap, sent through the parser: 200 repeats parse. */
export function assertTheCapParsesThroughTheParser(): void {
  const result = probe.safeParse(parseAsTheApiDoes(repeated(ids(MAX_SCOPE_ASSET_IDS))));
  assert(result.success && result.data.assetIds?.length === MAX_SCOPE_ASSET_IDS, "200 repeated assetIds must parse");
}

/** One past the cap, sent through the parser, is refused. */
export function assertOnePastTheCapIsRefusedThroughTheParser(): void {
  const result = probe.safeParse(parseAsTheApiDoes(repeated(ids(MAX_SCOPE_ASSET_IDS + 1))));
  assert(result.success === false, "201 repeated assetIds must be refused");
}

/** A named key (`assetIds[a]=…`) is an object, not the overflow shape: refused. */
export function assertANamedKeyObjectIsRefused(): void {
  const result = probe.safeParse(parseAsTheApiDoes(`assetIds[a]=${randomUUID()}`));
  assert(result.success === false, "assetIds[a]=… must be refused");
}

/** A sparse index (`assetIds[30]=…`) is an object without key 0: refused. */
export function assertASparseIndexObjectIsRefused(): void {
  const result = probe.safeParse(parseAsTheApiDoes(`assetIds[30]=${randomUUID()}`));
  assert(result.success === false, "assetIds[30]=… must be refused");
}
