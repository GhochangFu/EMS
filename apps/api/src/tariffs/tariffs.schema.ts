import { energyBillQuerySchema } from "@bms/shared";

/**
 * `F4.365` U5 — the bill route's query. The shared `energyBillQuerySchema`
 * requires `month`; the route defaults it to the current month in the
 * location's zone (plan U5), so the served query is that schema with `month`
 * optional. `.partial()` keeps `.strict()`: an unknown key is still a 400.
 * Lives outside the controller (`tests/adr-0029-openapi-contract.test.ts`).
 */
export const locationEnergyBillQuerySchema = energyBillQuerySchema.partial();
