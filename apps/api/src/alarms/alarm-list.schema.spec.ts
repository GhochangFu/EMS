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

/** `alarmSummaryQuerySchema` accepts `assetIds` alone. */
export function assertSummaryQueryAcceptsAssetIdsAlone(): void {
  const result = alarmSummaryQuerySchema.safeParse({ assetIds: [randomUUID()] });
  assert(
    result.success === true,
    `assetIds alone must parse: ${JSON.stringify(result.success ? undefined : result.error.issues)}`,
  );
}

/** `alarmSummaryQuerySchema` accepts an empty query — `assetIds` is optional. */
export function assertSummaryQueryAcceptsAnEmptyQuery(): void {
  const result = alarmSummaryQuerySchema.safeParse({});
  assert(result.success === true, "an empty summary query must parse — assetIds is optional");
}

/** `alarmSummaryQuerySchema` refuses an unknown key — `state` is not one of its keys. */
export function assertSummaryQueryRefusesAnUnknownKey(): void {
  const result = alarmSummaryQuerySchema.safeParse({ state: "active" });
  assert(result.success === false, "an unknown key on the summary query must be refused");
}

/** Plan decision 4: `limit=0` parses and reaches the service, which clamps it to 1 as before. */
export function assertZeroLimitParsesForTheServiceClamp(): void {
  const result = alarmListQuerySchema.safeParse({ limit: "0" });
  assert(result.success && result.data.limit === 0, "limit=0 must parse to 0 — the service clamps it");
}

/** Plan decision 4: a negative `limit` parses; the service clamps it to 1 as before. */
export function assertNegativeLimitParsesForTheServiceClamp(): void {
  const result = alarmListQuerySchema.safeParse({ limit: "-5" });
  assert(result.success && result.data.limit === -5, "limit=-5 must parse to -5 — the service clamps it");
}

/** Plan decision 4: an empty `limit=` is absent, so the controller's default of 20 applies, as before. */
export function assertEmptyLimitIsAbsent(): void {
  const result = alarmListQuerySchema.safeParse({ limit: "" });
  assert(result.success && result.data.limit === undefined, "limit= must parse as absent");
}

/** Plan decision 4: `limit=Infinity` parses, as `Number("Infinity")` did; the service clamps it to 100. */
export function assertInfiniteLimitParsesForTheServiceClamp(): void {
  const result = alarmListQuerySchema.safeParse({ limit: "Infinity" });
  assert(
    result.success && result.data.limit === Number.POSITIVE_INFINITY,
    `limit=Infinity must parse to Infinity: ${JSON.stringify(result.success ? result.data.limit : result.error.issues)}`,
  );
}

/** Plan decision 4: `limit=0.5` parses; the service clamps it to 1 as before. */
export function assertSubOneFractionalLimitParses(): void {
  const result = alarmListQuerySchema.safeParse({ limit: "0.5" });
  assert(
    result.success && result.data.limit === 0.5,
    `limit=0.5 must parse to 0.5: ${JSON.stringify(result.success ? result.data.limit : result.error.issues)}`,
  );
}

/** Plan decision 4: `limit=150.5` parses; the service clamps it to 100 as before. */
export function assertOverCapFractionalLimitParses(): void {
  const result = alarmListQuerySchema.safeParse({ limit: "150.5" });
  assert(
    result.success && result.data.limit === 150.5,
    `limit=150.5 must parse to 150.5: ${JSON.stringify(result.success ? result.data.limit : result.error.issues)}`,
  );
}

/** Plan decision 4: a non-numeric `limit` is still a 400, as before. */
export function assertNonNumericLimitIsRefused(): void {
  const result = alarmListQuerySchema.safeParse({ limit: "abc" });
  assert(result.success === false, "limit=abc must be refused");
}

/*
 * `F3.66` (step-5 fix) — `organizationId` on both reads, so the organization
 * rail no longer sends every readable asset id against the 200-id cap.
 */

/** `organizationId` on the list must be a uuid — anything else is a 400. */
export function assertListOrganizationIdMustBeAUuid(): void {
  const result = alarmListQuerySchema.safeParse({ organizationId: "not-a-uuid" });
  assert(result.success === false, "organizationId=not-a-uuid must be refused on the list");
}

/** `organizationId` alone parses on the list, and reaches the dto. */
export function assertListOrganizationIdAloneParses(): void {
  const id = randomUUID();
  const result = alarmListQuerySchema.safeParse({ organizationId: id });
  assert(
    result.success && result.data.organizationId === id,
    `organizationId alone must parse: ${JSON.stringify(result.success ? result.data : result.error.issues)}`,
  );
}

/** `organizationId` and `assetIds` together parse on the list — both apply. */
export function assertListOrganizationIdBesideAssetIdsParses(): void {
  const result = alarmListQuerySchema.safeParse({
    organizationId: randomUUID(),
    assetIds: [randomUUID()],
  });
  assert(
    result.success === true,
    `organizationId beside assetIds must parse: ${JSON.stringify(result.success ? undefined : result.error.issues)}`,
  );
}

/** An absent `organizationId` stays absent on the list — today's read. */
export function assertListAbsentOrganizationIdIsUndefined(): void {
  const result = alarmListQuerySchema.safeParse({});
  assert(
    result.success && result.data.organizationId === undefined,
    "an absent organizationId must parse as undefined",
  );
}

/** `organizationId` on the summary must be a uuid — anything else is a 400. */
export function assertSummaryOrganizationIdMustBeAUuid(): void {
  const result = alarmSummaryQuerySchema.safeParse({ organizationId: "not-a-uuid" });
  assert(result.success === false, "organizationId=not-a-uuid must be refused on the summary");
}

/** `organizationId` alone parses on the summary, and reaches the dto. */
export function assertSummaryOrganizationIdAloneParses(): void {
  const id = randomUUID();
  const result = alarmSummaryQuerySchema.safeParse({ organizationId: id });
  assert(
    result.success && result.data.organizationId === id,
    `organizationId alone must parse on the summary: ${JSON.stringify(result.success ? result.data : result.error.issues)}`,
  );
}
