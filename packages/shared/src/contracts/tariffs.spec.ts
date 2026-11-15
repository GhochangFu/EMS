import {
  createLocationTariffBodySchema,
  billingMetersOf,
  createTariffVersionBodySchema,
  tariffSlabsSchema,
  updateLocationTariffBodySchema,
  updateTariffVersionBodySchema,
} from "./tariffs";

/** `F4.365` U1 — the tariff request contracts (ADR 0134 decisions 3, 8). */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ORG = "11111111-1111-4111-8111-111111111111";
const METER = "33333333-3333-4333-8333-333333333333";
const SLABS = [
  { slabNo: 1, fromUnits: 0, toUnits: 100, energyRate: 3.96, fixedRate: 130, wheelingRate: 1.6, notes: null },
  { slabNo: 2, fromUnits: 101, toUnits: null, energyRate: 10.8, fixedRate: 130, wheelingRate: 1.6, notes: null },
];
const REVISION = {
  kind: "revision",
  organizationId: ORG,
  key: "Maharashtra | MSEDCL | LT-I(B) Residential (single phase)",
  effectiveFrom: "2026-12-01",
  reason: "MERC order revision",
  slabs: SLABS,
};
const MAPPING = {
  tariffKey: REVISION.key,
  billingMeterAssetId: METER,
  sanctionedLoad: 3,
  sanctionedLoadUnit: "kw",
  effectiveFrom: "2026-11-01",
};

export function assertValidBodiesParse(): void {
  assert(createTariffVersionBodySchema.safeParse(REVISION).success, "revision");
  assert(createLocationTariffBodySchema.safeParse(MAPPING).success, "mapping");
  assert(tariffSlabsSchema.safeParse(SLABS).success, "slabs");
}

export function assertAGapInSlabBoundsIsRefused(): void {
  const gap = [SLABS[0], { ...SLABS[1], fromUnits: 150 }];
  const r = tariffSlabsSchema.safeParse(gap);
  assert(!r.success && r.error.issues.some((i) => i.path.join(".") === "1.fromUnits"), "gap must fail at 1.fromUnits");
}

export function assertAnOpenSlabThatIsNotLastIsRefused(): void {
  const open = [{ ...SLABS[0], toUnits: null }, SLABS[1]];
  const r = tariffSlabsSchema.safeParse(open);
  assert(!r.success && r.error.issues.some((i) => i.path.join(".") === "0.toUnits"), "open middle slab must fail");
}

export function assertAJavascriptUrlIsRefused(): void {
  const r = createTariffVersionBodySchema.safeParse({ ...REVISION, sourceUrl: "javascript:alert(1)" });
  assert(!r.success, "javascript: URL must fail");
}

export function assertUnknownKeysAreRefused(): void {
  assert(!createTariffVersionBodySchema.safeParse({ ...REVISION, extra: 1 }).success, "revision extra");
  assert(!createLocationTariffBodySchema.safeParse({ ...MAPPING, extra: 1 }).success, "mapping extra");
  assert(!updateLocationTariffBodySchema.safeParse({ tariffKey: "x" }).success, "mapping PATCH tariffKey");
  assert(!updateTariffVersionBodySchema.safeParse({ reason: "abc", key: "x" }).success, "version PATCH key");
}

export function assertAnEmptyPatchIsRefused(): void {
  assert(!updateLocationTariffBodySchema.safeParse({}).success, "empty mapping PATCH");
  assert(!updateTariffVersionBodySchema.safeParse({ reason: "abc" }).success, "version PATCH with only a reason");
}

export function assertAMidMonthDateIsRefused(): void {
  assert(!createLocationTariffBodySchema.safeParse({ ...MAPPING, effectiveFrom: "2026-11-15" }).success, "day 15 mapping");
  assert(!createTariffVersionBodySchema.safeParse({ ...REVISION, effectiveFrom: "2026-12-15" }).success, "day 15 version");
}

export function assertACustomKeyNeedsThePrefix(): void {
  const custom = {
    kind: "custom",
    organizationId: ORG,
    key: "My negotiated tariff",
    effectiveFrom: "2026-12-01",
    reason: "negotiated PPA",
    slabs: SLABS,
    areaId: "MH",
    state: "Maharashtra",
    discoms: "Private PPA",
    ownership: "Private",
    code: "PPA-1",
    name: "Negotiated",
    segment: "Industrial HT",
    supply: "HT",
    energyUnit: "kwh",
    fixedBasis: "none",
    tariffOrder: null,
    sourceUrl: null,
    notes: null,
  };
  assert(!createTariffVersionBodySchema.safeParse(custom).success, "custom key without prefix");
  assert(createTariffVersionBodySchema.safeParse({ ...custom, key: "custom:My negotiated tariff" }).success, "custom key with prefix");
}

export function assertEffectiveToMustFollowEffectiveFrom(): void {
  const r = createLocationTariffBodySchema.safeParse({ ...MAPPING, effectiveTo: "2026-11-01" });
  assert(!r.success && r.error.issues.some((i) => i.path.join(".") === "effectiveTo"), "effectiveTo == effectiveFrom");
}

const METER_2 = "44444444-4444-4444-8444-444444444444";

/** `F4.373` (ADR 0134 Amendment 3) — a mapping names one or more billing meters, in exactly one form. */
export function assertAMappingNamesItsMetersInExactlyOneForm(): void {
  const { billingMeterAssetId: _one, ...noMeter } = MAPPING;
  const list = createLocationTariffBodySchema.safeParse({ ...noMeter, billingMeterAssetIds: [METER, METER_2] });
  assert(list.success && billingMetersOf(list.data)?.join() === `${METER},${METER_2}`, "the list form, in order");
  const one = createLocationTariffBodySchema.safeParse(MAPPING);
  assert(one.success && billingMetersOf(one.data)?.join() === METER, "the one-meter shorthand is a one-item list");

  const neither = createLocationTariffBodySchema.safeParse(noMeter);
  assert(!neither.success && neither.error.issues.some((i) => i.message.includes("exactly one of billingMeterAssetIds")), "neither form");
  const both = createLocationTariffBodySchema.safeParse({ ...MAPPING, billingMeterAssetIds: [METER] });
  assert(!both.success && both.error.issues.some((i) => i.path.join(".") === "billingMeterAssetIds"), "both forms");
  assert(!updateLocationTariffBodySchema.safeParse({ billingMeterAssetId: METER, billingMeterAssetIds: [METER] }).success, "both forms on PATCH");
  const patch = updateLocationTariffBodySchema.safeParse({ billingMeterAssetIds: [METER_2, METER] });
  assert(patch.success && billingMetersOf(patch.data)?.join() === `${METER_2},${METER}`, "a PATCH replaces the set");
  const keep = updateLocationTariffBodySchema.safeParse({ sanctionedLoad: 4 });
  assert(keep.success && billingMetersOf(keep.data) === undefined, "a PATCH without meters keeps the set");
}

export function assertTheMeterListIsOneToEightDistinct(): void {
  const { billingMeterAssetId: _one, ...noMeter } = MAPPING;
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`);
  assert(!createLocationTariffBodySchema.safeParse({ ...noMeter, billingMeterAssetIds: [] }).success, "empty list");
  assert(createLocationTariffBodySchema.safeParse({ ...noMeter, billingMeterAssetIds: ids(8) }).success, "eight meters");
  assert(!createLocationTariffBodySchema.safeParse({ ...noMeter, billingMeterAssetIds: ids(9) }).success, "nine meters");
  const dup = createLocationTariffBodySchema.safeParse({ ...noMeter, billingMeterAssetIds: [METER, METER] });
  assert(!dup.success && dup.error.issues.some((i) => i.message === "a billing meter is named twice"), "a duplicate meter");
  assert(!createLocationTariffBodySchema.safeParse({ ...noMeter, billingMeterAssetIds: ["not-a-uuid"] }).success, "not a uuid");
}
