import {
  listMaintenanceQuerySchema,
  maintenanceCategorySchema,
  maintenanceGenerationModeSchema,
  maintenancePrioritySchema,
} from "./maintenance.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The maintenance vocabularies (ADR 0006 lineage, exported for ADR 0019 §4).
 *
 * These enums had no test until the filter schema stopped restating the
 * priority values and started deriving them from `maintenancePrioritySchema`.
 * A behaviour-preserving refactor with no coverage is only behaviour-preserving
 * by assertion, and these four vocabularies are now imported by the asset
 * template content contract — a value silently added or dropped here changes
 * what a template is allowed to author.
 */
export function runMaintenanceSchemaTests(): void {
  // ---- priority: one vocabulary, two shapes --------------------------------

  assert(
    maintenancePrioritySchema.options.join(",") === "low,medium,high,critical",
    `priority vocabulary changed: ${maintenancePrioritySchema.options.join(",")}`,
  );

  // The filter adds an "all" sentinel in front and nothing else. Asserted as an
  // exact set rather than a spot check: the failure this guards against is a
  // value quietly appearing or disappearing, which any single-value probe
  // passes straight through.
  const filterOptions = listMaintenanceQuerySchema.shape.priority.
    _def.innerType.options as readonly string[];
  assert(
    filterOptions.join(",") === "all,low,medium,high,critical",
    `filter priority vocabulary changed: ${filterOptions.join(",")}`,
  );
  assert(
    filterOptions.slice(1).join(",") === maintenancePrioritySchema.options.join(","),
    "the filter's real values must stay identical to the exported enum, in the same order",
  );

  assert(
    listMaintenanceQuerySchema.parse({}).priority === "all",
    'the priority filter must default to "all"',
  );
  for (const value of ["all", ...maintenancePrioritySchema.options]) {
    assert(
      listMaintenanceQuerySchema.safeParse({ priority: value }).success,
      `the filter must accept "${value}"`,
    );
  }
  assert(
    !listMaintenanceQuerySchema.safeParse({ priority: "urgent" }).success,
    '"urgent" is not a priority — the sentinel must not have widened the enum',
  );

  // ---- the other two vocabularies the content contract imports -------------

  assert(
    maintenanceCategorySchema.options.length === 14,
    `expected 14 maintenance categories, got ${maintenanceCategorySchema.options.length}`,
  );
  assert(
    maintenanceCategorySchema.options.includes("preventive") &&
      maintenanceCategorySchema.options.includes("safety_critical"),
    "the category vocabulary lost a documented value",
  );
  assert(
    maintenanceGenerationModeSchema.options.join(",") ===
      "manual,calendar,runtime,condition,predictive",
    `generation modes changed: ${maintenanceGenerationModeSchema.options.join(",")}`,
  );

  // ---- the rest of the filter contract -------------------------------------

  const defaults = listMaintenanceQuerySchema.parse({});
  assert(defaults.dueState === "all", 'dueState must default to "all"');
  assert(defaults.horizonDays === 30, "horizonDays must default to 30");
  assert(
    listMaintenanceQuerySchema.parse({ horizonDays: "45" }).horizonDays === 45,
    "horizonDays must coerce from a query string",
  );
  assert(
    !listMaintenanceQuerySchema.safeParse({ horizonDays: 121 }).success,
    "horizonDays caps at 120",
  );
  assert(
    !listMaintenanceQuerySchema.safeParse({ assetId: "not-a-uuid" }).success,
    "assetId must be a uuid",
  );
}
