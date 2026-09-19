import {
  createCalcParameterBodySchema,
  listCalcParametersQuerySchema,
  updateCalcParameterBodySchema,
} from "./calc-parameters.schema";

/**
 * `E4.1a` U8 — the write-side contract of `/admin/calc-parameters`
 * (ADR 0070 decision 2; plan design decisions 5 and 12).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ORG = "11111111-1111-4111-8111-111111111111";
const LOC = "22222222-2222-4222-8222-222222222222";
const ASSET = "33333333-3333-4333-8333-333333333333";

const VALID = {
  organizationId: ORG,
  key: "energy_tariff_per_kwh",
  value: 8.5,
  effectiveFrom: "2026-01-01T00:00:00Z",
};

/** The issue paths a failed parse reports, joined for the message. */
function issuePaths(result: { success: boolean; error?: { issues: { path: (string | number)[] }[] } }): string[] {
  return result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.path.join("."));
}

export function assertAValidOrganizationScopedCreateParses(): void {
  const parsed = createCalcParameterBodySchema.parse(VALID);
  assert(parsed.locationId === undefined && parsed.assetId === undefined, "no scope column is set");
  assert(parsed.effectiveTo === undefined, "effectiveTo is optional and open-ended when absent");
  const withNulls = createCalcParameterBodySchema.parse({ ...VALID, locationId: null, assetId: null, effectiveTo: null });
  assert(withNulls.locationId === null && withNulls.effectiveTo === null, "explicit nulls are accepted");
}

export function assertBothScopesAreRefusedAtAssetId(): void {
  const result = createCalcParameterBodySchema.safeParse({ ...VALID, locationId: LOC, assetId: ASSET });
  assert(!result.success, "a row scoped to a location AND an asset must be refused");
  const paths = issuePaths(result);
  assert(paths.includes("assetId"), `the issue must sit at assetId, got ${JSON.stringify(paths)}`);
  // Positive control: either scope alone is admitted.
  assert(createCalcParameterBodySchema.safeParse({ ...VALID, locationId: LOC }).success, "location scope alone parses");
  assert(createCalcParameterBodySchema.safeParse({ ...VALID, assetId: ASSET }).success, "asset scope alone parses");
}

export function assertEffectiveToMustFollowEffectiveFrom(): void {
  const equal = createCalcParameterBodySchema.safeParse({ ...VALID, effectiveTo: VALID.effectiveFrom });
  assert(!equal.success, "effectiveTo equal to effectiveFrom is an empty window and must be refused");
  assert(issuePaths(equal).includes("effectiveTo"), "the issue must sit at effectiveTo");
  const before = createCalcParameterBodySchema.safeParse({ ...VALID, effectiveTo: "2025-12-31T23:59:59Z" });
  assert(!before.success && issuePaths(before).includes("effectiveTo"), "an earlier effectiveTo is refused at effectiveTo");
  const after = createCalcParameterBodySchema.safeParse({ ...VALID, effectiveTo: "2026-02-01T00:00:00Z" });
  assert(after.success, "a later effectiveTo parses");
  // The same refinement on the update body, where both dates are optional.
  const update = updateCalcParameterBodySchema.safeParse({
    effectiveFrom: "2026-03-01T00:00:00Z",
    effectiveTo: "2026-02-01T00:00:00Z",
  });
  assert(!update.success && issuePaths(update).includes("effectiveTo"), "the update body refuses an inverted window at effectiveTo");
  assert(updateCalcParameterBodySchema.safeParse({ effectiveTo: "2026-02-01T00:00:00Z" }).success, "an update naming only effectiveTo parses");
}

export function assertAKeyWithAHyphenIsRefused(): void {
  const result = createCalcParameterBodySchema.safeParse({ ...VALID, key: "energy-tariff" });
  assert(!result.success, "`$a-b` must lex as `$a - b`, so a key with a hyphen can never be referenced");
  assert(issuePaths(result).includes("key"), "the issue must sit at key");
  assert(!createCalcParameterBodySchema.safeParse({ ...VALID, key: "Energy" }).success, "an upper-case key is refused");
  assert(!createCalcParameterBodySchema.safeParse({ ...VALID, key: "1abc" }).success, "a leading digit is refused");
  assert(!createCalcParameterBodySchema.safeParse({ ...VALID, key: `a${"b".repeat(64)}` }).success, "65 characters is refused");
  assert(createCalcParameterBodySchema.safeParse({ ...VALID, key: `a${"b".repeat(63)}` }).success, "64 characters parses");
}

export function assertAnExtraFieldIsRefused(): void {
  const create = createCalcParameterBodySchema.safeParse({ ...VALID, note: "x" });
  assert(!create.success, "the create body is .strict()");
  // Design decision 12: key, organizationId and the scope are immutable on
  // PATCH — the body has no such field, and `.strict()` refuses one.
  for (const field of ["key", "organizationId", "locationId", "assetId"]) {
    const update = updateCalcParameterBodySchema.safeParse({ value: 1, [field]: LOC });
    assert(!update.success, `the update body must refuse ${field}`);
  }
  assert(updateCalcParameterBodySchema.safeParse({ value: 1 }).success, "a value-only update parses");
}

export function assertANonFiniteValueIsRefused(): void {
  for (const value of [Infinity, -Infinity, Number.NaN]) {
    const result = createCalcParameterBodySchema.safeParse({ ...VALID, value });
    assert(!result.success, `value ${String(value)} must be refused`);
  }
  assert(!createCalcParameterBodySchema.safeParse({ ...VALID, value: "8.5" }).success, "a string value is refused");
  assert(createCalcParameterBodySchema.safeParse({ ...VALID, value: -3 }).success, "a negative finite value parses");
  assert(!updateCalcParameterBodySchema.safeParse({ value: Infinity }).success, "the update body refuses Infinity too");
}

export function assertTheListQueryRequiresAnOrganization(): void {
  assert(!listCalcParametersQuerySchema.safeParse({}).success, "organizationId is required");
  assert(!listCalcParametersQuerySchema.safeParse({ organizationId: "not-a-uuid" }).success, "organizationId must be a uuid");
  const parsed = listCalcParametersQuerySchema.parse({ organizationId: ORG, key: "rated_kw" });
  assert(parsed.key === "rated_kw", "key is an optional filter");
  assert(!listCalcParametersQuerySchema.safeParse({ organizationId: ORG, key: "Rated-KW" }).success, "the key filter holds the charset");
}
