import { randomUUID } from "node:crypto";

import { MAX_SCOPE_ASSET_IDS } from "../auth/asset-scope.schema";
import { alarmListQuerySchema, alarmSummaryQuerySchema } from "./alarm-list.schema";

/**
 * `F3.28` (ADR 0074, plan decisions 1, 4 and task 1.3) — `alarmListQuerySchema`
 * and `alarmSummaryQuerySchema`.
 *
 * One claim per exported function; `alarm-list.schema.test.ts` is the vitest
 * entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Absent `state` defaults to `"all"` — today's behaviour, unchanged. */
export function assertAbsentStateDefaultsToAll(): void {
  const result = alarmListQuerySchema.safeParse({});
  assert(
    result.success === true,
    `an empty query must parse: ${JSON.stringify(result.success ? undefined : result.error.issues)}`,
  );
  assert(result.success && result.data.state === "all", "an absent state must default to 'all'");
}

/** `state=open` is not a value this schema offers — only `all`/`active`. */
export function assertUnknownStateValueIsRefused(): void {
  const result = alarmListQuerySchema.safeParse({ state: "open" });
  assert(result.success === false, "state=open must be refused — it is not a live value");
}

/** `state=active` parses. */
export function assertActiveStateParses(): void {
  const result = alarmListQuerySchema.safeParse({ state: "active" });
  assert(
    result.success === true,
    `state=active must parse: ${JSON.stringify(result.success ? undefined : result.error.issues)}`,
  );
}

/** An unknown query key is refused — the object is `.strict()`. */
export function assertAnUnknownKeyIsRefused(): void {
  const result = alarmListQuerySchema.safeParse({ severity: "critical" });
  assert(result.success === false, "an unknown query key must be refused on a .strict() object");
}

/** `assetIds` flows through the shared field, cap included. */
export function assertAssetIdsIsCappedAtTheSharedMaximum(): void {
  const atCap = alarmListQuerySchema.safeParse({
    assetIds: Array.from({ length: MAX_SCOPE_ASSET_IDS }, () => randomUUID()),
  });
  assert(
    atCap.success === true,
    `exactly ${MAX_SCOPE_ASSET_IDS} assetIds must parse: ${JSON.stringify(atCap.success ? undefined : atCap.error.issues)}`,
  );

  const overCap = alarmListQuerySchema.safeParse({
    assetIds: Array.from({ length: MAX_SCOPE_ASSET_IDS + 1 }, () => randomUUID()),
  });
  assert(overCap.success === false, `${MAX_SCOPE_ASSET_IDS + 1} assetIds must be refused`);
}

/** `alarmSummaryQuerySchema` accepts `assetIds` alone and refuses an unknown key. */
export function assertSummaryQueryAcceptsAssetIdsAndRefusesUnknownKeys(): void {
  const withAssetIds = alarmSummaryQuerySchema.safeParse({ assetIds: [randomUUID()] });
  assert(
    withAssetIds.success === true,
    `assetIds alone must parse: ${JSON.stringify(withAssetIds.success ? undefined : withAssetIds.error.issues)}`,
  );

  const empty = alarmSummaryQuerySchema.safeParse({});
  assert(empty.success === true, "an empty summary query must parse — assetIds is optional");

  const unknown = alarmSummaryQuerySchema.safeParse({ state: "active" });
  assert(unknown.success === false, "an unknown key on the summary query must be refused");
}
