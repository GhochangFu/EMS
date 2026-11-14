import { z } from "zod";

/**
 * `F4.365` (ADR 0134) — slab utility tariffs: the catalog, an organization's
 * versions, a location's mapping and the monthly energy bill.
 *
 * A tariff LINE is its `key` (the workbook's "Category Key"). A VERSION is one
 * `(key, effectiveFrom)` with its slabs, from the global catalog or from one
 * organization (decision 8). Every date is the first day of a month (plan D8)
 * so one bill never mixes two rate sets.
 */

export const tariffEnergyUnitSchema = z.enum(["kwh", "kvah"]);
export const tariffFixedBasisSchema = z.enum([
  "per_kw_month",
  "per_kva_month",
  "per_hp_month",
  "per_connection_month",
  "per_connection_bimonth",
  "none",
]);
export const tariffDataStatusSchema = z.enum(["official", "secondary", "indicative"]);
export const sanctionedLoadUnitSchema = z.enum(["kw", "kva", "hp"]);
export const tariffSourceSchema = z.enum(["catalog", "organization"]);
export const energyBillReasonSchema = z.enum([
  "no_mapping",
  "no_version_in_force",
  "meter_no_reading",
  "meter_decreasing",
  "kvah_unavailable",
  "load_unit_mismatch",
  // The version in force cannot be priced (`computeBill` refuses it, e.g. no slabs).
  "version_invalid",
]);

export type TariffDataStatus = z.infer<typeof tariffDataStatusSchema>;
export type TariffSource = z.infer<typeof tariffSourceSchema>;
export type EnergyBillReason = z.infer<typeof energyBillReasonSchema>;

export const TARIFF_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MONTH_START_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-01$/;
export const TARIFF_KEY_MAX = 200;
export const CUSTOM_TARIFF_KEY_PREFIX = "custom:";
export const TARIFF_MAX_SLABS = 12;

const monthStartSchema = z.string().regex(MONTH_START_DATE_PATTERN, "a date on the first day of a month, YYYY-MM-01");
const httpUrlSchema = z
  .string()
  .max(500)
  .regex(/^https?:\/\//, "an http(s) URL");
const tariffKeySchema = z.string().trim().min(1).max(TARIFF_KEY_MAX);
const rateSchema = z.number().finite().min(0);
const reasonSchema = z.string().trim().min(3).max(500);

export const tariffSlabSchema = z.object({
  slabNo: z.number().int().min(1),
  fromUnits: z.number().finite().min(0),
  toUnits: z.number().finite().min(0).nullable(),
  energyRate: rateSchema,
  fixedRate: rateSchema,
  wheelingRate: rateSchema,
  notes: z.string().max(500).nullable(),
});
export type TariffSlab = z.infer<typeof tariffSlabSchema>;

/**
 * Slab bounds are the workbook's: numbered 1..n, the first starts at 0, each
 * next `fromUnits` is the previous `toUnits + 1`, and only the last may be
 * open (`toUnits: null`).
 */
export const tariffSlabsSchema = z
  .array(tariffSlabSchema)
  .min(1)
  .max(TARIFF_MAX_SLABS)
  .superRefine((slabs, ctx) => {
    slabs.forEach((s, i) => {
      if (s.slabNo !== i + 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "slabNo"], message: `slab ${i + 1} must be numbered ${i + 1}` });
      }
      if (i === 0 && s.fromUnits !== 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "fromUnits"], message: "the first slab starts at 0" });
      }
      if (i > 0) {
        const prev = slabs[i - 1];
        if (prev.toUnits === null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i - 1, "toUnits"], message: "only the last slab may be open-ended" });
        } else if (s.fromUnits !== prev.toUnits + 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, "fromUnits"],
            message: `slab ${i + 1} must start at ${prev.toUnits + 1}`,
          });
        }
      }
      if (s.toUnits !== null && s.toUnits < s.fromUnits) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "toUnits"], message: "toUnits must not be below fromUnits" });
      }
    });
  })
  .describe("tariff slabs: 1..n, contiguous, only the last open-ended");

/** The fields a category (one version of a line) carries, shared by DTO, body and snapshot. */
const categoryFields = {
  areaId: z.string().max(16),
  state: z.string().max(100),
  discoms: z.string().max(300),
  ownership: z.string().max(100),
  code: z.string().max(100),
  name: z.string().max(200),
  segment: z.string().max(100),
  supply: z.string().max(100),
  energyUnit: tariffEnergyUnitSchema,
  fixedBasis: tariffFixedBasisSchema,
  dataStatus: tariffDataStatusSchema,
  tariffOrder: z.string().max(300).nullable(),
  sourceUrl: httpUrlSchema.nullable(),
  notes: z.string().max(1000).nullable(),
};

// ---- Responses -------------------------------------------------------------

/** One tariff line as listed: its latest version in force for the caller. */
export const tariffLineDtoSchema = z.object({
  key: z.string(),
  source: tariffSourceSchema,
  organizationId: z.string().uuid().nullable(),
  ...categoryFields,
  effectiveFrom: monthStartSchema,
  slabCount: z.number().int().min(1),
});
export type TariffLineDto = z.infer<typeof tariffLineDtoSchema>;
export const tariffLinesResponseSchema = z.object({ items: z.array(tariffLineDtoSchema) });
export type TariffLinesResponse = z.infer<typeof tariffLinesResponseSchema>;

export const tariffVersionDtoSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  source: tariffSourceSchema,
  organizationId: z.string().uuid().nullable(),
  ...categoryFields,
  effectiveFrom: monthStartSchema,
  slabs: z.array(tariffSlabSchema),
  reason: z.string().nullable(),
  /** True only for an organization version that is not yet in force. */
  editable: z.boolean(),
});
export type TariffVersionDto = z.infer<typeof tariffVersionDtoSchema>;
export const tariffLineVersionsResponseSchema = z.object({ key: z.string(), versions: z.array(tariffVersionDtoSchema) });
export type TariffLineVersionsResponse = z.infer<typeof tariffLineVersionsResponseSchema>;

export const locationTariffDtoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  locationId: z.string().uuid(),
  tariffKey: z.string(),
  tariffName: z.string().nullable(),
  dataStatus: tariffDataStatusSchema.nullable(),
  billingMeterAssetId: z.string().uuid(),
  billingMeterName: z.string().nullable(),
  sanctionedLoad: z.number().finite().min(0),
  sanctionedLoadUnit: sanctionedLoadUnitSchema,
  effectiveFrom: monthStartSchema,
  effectiveTo: monthStartSchema.nullable(),
});
export type LocationTariffDto = z.infer<typeof locationTariffDtoSchema>;
export const locationTariffsResponseSchema = z.object({ items: z.array(locationTariffDtoSchema) });
export type LocationTariffsResponse = z.infer<typeof locationTariffsResponseSchema>;

export const energyBillSlabLineSchema = z.object({
  slabNo: z.number().int(),
  fromUnits: z.number(),
  toUnits: z.number().nullable(),
  units: z.number(),
  energyRate: z.number(),
  energyCharge: z.number(),
  wheelingRate: z.number(),
  wheelingCharge: z.number(),
});

export const energyBillSchema = z.object({
  locationId: z.string().uuid(),
  month: z.string().regex(TARIFF_MONTH_PATTERN),
  timeZone: z.string(),
  from: z.string(),
  to: z.string(),
  /** False while the month is still running. */
  complete: z.boolean(),
  currency: z.string().nullable(),
  reason: energyBillReasonSchema.nullable(),
  dataStatus: tariffDataStatusSchema.nullable(),
  tariff: z
    .object({
      key: z.string(),
      versionId: z.string().uuid(),
      source: tariffSourceSchema,
      name: z.string(),
      state: z.string(),
      energyUnit: tariffEnergyUnitSchema,
      fixedBasis: tariffFixedBasisSchema,
      effectiveFrom: monthStartSchema,
      tariffOrder: z.string().nullable(),
      sourceUrl: z.string().nullable(),
    })
    .nullable(),
  mapping: z
    .object({
      id: z.string().uuid(),
      billingMeterAssetId: z.string().uuid(),
      sanctionedLoad: z.number(),
      sanctionedLoadUnit: sanctionedLoadUnitSchema,
    })
    .nullable(),
  bill: z
    .object({
      units: z.number(),
      unitType: tariffEnergyUnitSchema,
      estimated: z.boolean(),
      overflowUnits: z.number(),
      slabLines: z.array(energyBillSlabLineSchema),
      energyCharge: z.number(),
      highestSlabNo: z.number().int(),
      fixedRate: z.number(),
      fixedCharge: z.number(),
      wheelingCharge: z.number(),
      total: z.number(),
    })
    .nullable(),
});
export type EnergyBill = z.infer<typeof energyBillSchema>;

// ---- Request bodies and queries -------------------------------------------

type MappingWindow = { effectiveFrom?: string | undefined; effectiveTo?: string | null | undefined };
function refineMonthWindow(body: MappingWindow, ctx: z.RefinementCtx): void {
  if (body.effectiveFrom !== undefined && body.effectiveTo != null && body.effectiveTo <= body.effectiveFrom) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effectiveTo"], message: "effectiveTo must be later than effectiveFrom" });
  }
}

export const createLocationTariffBodySchema = z
  .object({
    tariffKey: tariffKeySchema,
    billingMeterAssetId: z.string().uuid(),
    sanctionedLoad: z.number().finite().min(0).max(10_000_000),
    sanctionedLoadUnit: sanctionedLoadUnitSchema,
    effectiveFrom: monthStartSchema,
    effectiveTo: monthStartSchema.nullish(),
  })
  .strict()
  .superRefine(refineMonthWindow)
  .describe("map a location to a tariff line");
export type CreateLocationTariffBody = z.infer<typeof createLocationTariffBodySchema>;

export const updateLocationTariffBodySchema = z
  .object({
    billingMeterAssetId: z.string().uuid().optional(),
    sanctionedLoad: z.number().finite().min(0).max(10_000_000).optional(),
    sanctionedLoadUnit: sanctionedLoadUnitSchema.optional(),
    effectiveFrom: monthStartSchema.optional(),
    effectiveTo: monthStartSchema.nullish(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (Object.values(body).every((v) => v === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: "name at least one field to change" });
    }
    refineMonthWindow(body, ctx);
  })
  .describe("change a location's tariff mapping (the line itself is immutable)");
export type UpdateLocationTariffBody = z.infer<typeof updateLocationTariffBodySchema>;

const revisionBodySchema = z
  .object({
    kind: z.literal("revision"),
    organizationId: z.string().uuid(),
    key: tariffKeySchema,
    effectiveFrom: monthStartSchema,
    reason: reasonSchema,
    slabs: tariffSlabsSchema,
    tariffOrder: z.string().max(300).nullish(),
    sourceUrl: httpUrlSchema.nullish(),
  })
  .strict();

const customBodySchema = z
  .object({
    kind: z.literal("custom"),
    organizationId: z.string().uuid(),
    key: tariffKeySchema
      .refine((k) => k.startsWith(CUSTOM_TARIFF_KEY_PREFIX), `a custom key starts with "${CUSTOM_TARIFF_KEY_PREFIX}"`)
      .describe(`a custom line's key: starts with "${CUSTOM_TARIFF_KEY_PREFIX}"`),
    effectiveFrom: monthStartSchema,
    reason: reasonSchema,
    slabs: tariffSlabsSchema,
    ...categoryFields,
    dataStatus: tariffDataStatusSchema.default("official"),
  })
  .strict();

export const createTariffVersionBodySchema = z
  .discriminatedUnion("kind", [revisionBodySchema, customBodySchema])
  .describe("an organization revision of a tariff line, or a new custom line");
export type CreateTariffVersionBody = z.infer<typeof createTariffVersionBodySchema>;

export const updateTariffVersionBodySchema = z
  .object({
    effectiveFrom: monthStartSchema.optional(),
    reason: reasonSchema,
    slabs: tariffSlabsSchema.optional(),
    tariffOrder: z.string().max(300).nullish(),
    sourceUrl: httpUrlSchema.nullish(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.effectiveFrom === undefined && body.slabs === undefined && body.tariffOrder === undefined && body.sourceUrl === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: "name at least one field to change" });
    }
  })
  .describe("edit an organization version that is not yet in force");
export type UpdateTariffVersionBody = z.infer<typeof updateTariffVersionBodySchema>;

export const tariffCategoriesQuerySchema = z
  .object({
    organizationId: z.string().uuid().optional(),
    state: z.string().max(100).optional(),
    segment: z.string().max(100).optional(),
    q: z.string().max(100).optional(),
  })
  .strict();
export const tariffLineVersionsQuerySchema = z
  .object({ key: tariffKeySchema, organizationId: z.string().uuid().optional() })
  .strict();
export const energyBillQuerySchema = z.object({ month: z.string().regex(TARIFF_MONTH_PATTERN, "YYYY-MM") }).strict();
export const deleteTariffVersionQuerySchema = z.object({ reason: reasonSchema }).strict();

// ---- The committed catalog snapshot (plan D1) ------------------------------

export const tariffCatalogCategorySchema = z.object({
  key: tariffKeySchema,
  ...categoryFields,
  effectiveFrom: monthStartSchema,
  slabs: tariffSlabsSchema,
});
export type TariffCatalogCategory = z.infer<typeof tariffCatalogCategorySchema>;

export const tariffCatalogSnapshotSchema = z.object({
  source: z.object({ workbook: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/), sheet: z.string() }),
  categories: z.array(tariffCatalogCategorySchema),
});
export type TariffCatalogSnapshot = z.infer<typeof tariffCatalogSnapshotSchema>;
