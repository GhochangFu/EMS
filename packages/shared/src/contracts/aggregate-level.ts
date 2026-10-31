import { z } from "zod";

/**
 * `F4.298` U1 (ADR 0108 decision 2.11) — the four ADR 0023 rollup levels,
 * finest first. **The one declaration of the level in the repository**
 * (AGENTS §4.8): `apps/api/src/telemetry/point-aggregates.ts` re-exports the
 * `AggregateLevel` type from `@bms/shared` rather than restating the union, and
 * a later row that needs the level on a response imports this schema.
 *
 * Its `LADDER` constant stays a literal there on purpose:
 * `tests/adr-0025-level-selector.test.ts` matches that line by regex.
 */
export const aggregateLevelSchema = z.enum(["1m", "5m", "1h", "1d"]);
