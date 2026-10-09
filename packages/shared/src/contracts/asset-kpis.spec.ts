import { assetKpisResponseSchema, assetKpiValueSchema } from "./asset-kpis";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ITEM = {
  code: "kw_now",
  name: "Incomer kW",
  unit: "kW",
  higherIsBetter: false,
  value: 12.5,
  state: "ok",
  inputAsOf: "2026-10-09T05:00:00.000Z",
  excluded: 0,
  memberCount: 0,
} as const;

export function assertFullItemParses(): void {
  const parsed = assetKpisResponseSchema.safeParse({
    assetId: "22222222-2222-4222-8222-222222222222",
    windowMinutes: 15,
    items: [ITEM],
  });
  assert(parsed.success, `a full response must parse: ${JSON.stringify(parsed.error?.issues)}`);
}

/** ADR 0097 decision 6, held at the contract: a member id never rides on an item. */
export function assertExtraKeyIsRefused(): void {
  const parsed = assetKpiValueSchema.safeParse({ ...ITEM, memberIds: [] });
  assert(!parsed.success, "an item carrying memberIds must be refused");
  assert(
    parsed.error?.issues.some((issue) => issue.code === "unrecognized_keys") === true,
    `the refusal must be unrecognized_keys: ${JSON.stringify(parsed.error?.issues)}`,
  );
}

/** Decision 6's owner ruling: the stored KPI's authoring fields stay off the read route. */
export function assertExpressionIsRefused(): void {
  const parsed = assetKpiValueSchema.safeParse({ ...ITEM, expression: "{kw}" });
  assert(!parsed.success, "an item carrying expression must be refused");
}

/** `coverage_below_floor` is unreachable under a null ratio (decision 3), so it is not a state. */
export function assertCoverageBelowFloorIsNotAState(): void {
  const parsed = assetKpiValueSchema.safeParse({ ...ITEM, value: null, state: "coverage_below_floor" });
  assert(!parsed.success, "coverage_below_floor must not be a KPI state");
}

/** The owner's 2026-10-09 ruling: a v3 KPI can reach the window budget refusal. */
export function assertWindowsUnresolvedIsAState(): void {
  const parsed = assetKpiValueSchema.safeParse({ ...ITEM, value: null, state: "windows_unresolved" });
  assert(parsed.success, `windows_unresolved must be a KPI state: ${JSON.stringify(parsed.error?.issues)}`);
}

export function assertInputAsOfNullAndOffsetParse(): void {
  assert(assetKpiValueSchema.safeParse({ ...ITEM, inputAsOf: null }).success, "inputAsOf: null must parse");
  assert(
    assetKpiValueSchema.safeParse({ ...ITEM, inputAsOf: "2026-10-09T10:30:00+05:30" }).success,
    "an offset ISO string must parse",
  );
}

export function assertBareDateIsRefused(): void {
  assert(!assetKpiValueSchema.safeParse({ ...ITEM, inputAsOf: "2026-10-09" }).success, "a bare date must be refused");
}

/** The value/state pairing is the host's rule, not the schema's. */
export function assertNullValueWithOkParsesAtSchemaLevel(): void {
  assert(assetKpiValueSchema.safeParse({ ...ITEM, value: null }).success, "value: null with state ok parses here");
}

export function assertOptionalFieldsMayBeAbsent(): void {
  const { unit: _unit, higherIsBetter: _hib, ...bare } = ITEM;
  assert(assetKpiValueSchema.safeParse(bare).success, "unit and higherIsBetter are optional");
}

/** `excluded: null` is "no member was classified" (code review, 2026-10-09) — it parses. */
export function assertExcludedNullParses(): void {
  const parsed = assetKpiValueSchema.safeParse({ ...ITEM, value: null, state: "stale_input", excluded: null });
  assert(parsed.success, `excluded: null must parse: ${JSON.stringify(parsed.error?.issues)}`);
}

/** Nullable, not optional: the host always states the count or its absence. */
export function assertExcludedAbsentIsRefused(): void {
  const { excluded: _excluded, ...bare } = ITEM;
  assert(!assetKpiValueSchema.safeParse(bare).success, "an item with no excluded key must be refused");
}
