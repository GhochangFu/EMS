import {
  createLocationTariffBodySchema,
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
