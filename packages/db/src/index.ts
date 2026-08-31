export { createDb, type BmsDb, type BmsSchema } from "./client";
export * from "./schema/index";
export { refreshAggregatesFrom } from "./refresh-aggregates";
/**
 * `F4.75` — exported so `apps/api` can parse the seeded literal with
 * `templateContentSchema`, the same schema `publish()` runs. `packages/db`
 * cannot import that schema (it lives in `apps/api`), so without this export the
 * seed's health block has no validating gate at all: a malformed one writes
 * cleanly, reads back as no band, and leaves the donut exactly as empty as it
 * was. Only the literals are exported — the SQL and the seed function stay
 * internal to the package.
 */
export { HEALTH_BANDS, HEALTH_BASELINE_CONTENT } from "./asset-template-health-seed";
