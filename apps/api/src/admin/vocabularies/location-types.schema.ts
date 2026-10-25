import { z } from "zod";

/**
 * `F4.162` (ADR 0077 Amendment 1, plan D4) — the `:code` path parameter of
 * `admin/vocabularies/location-types`. The create and update bodies live in
 * `@bms/shared` (`contracts/location-type-writes.ts`) since `F4.282` (ADR 0030,
 * ADR 0099 Amendment 8), where the copilot catalog reads them by identity.
 *
 * **Declared here with this package's own `z`, not imported from
 * `@bms/shared`.** `asset-roles/asset-roles.schema.ts`'s header records the measurement: a
 * `ZodError` thrown by a shared schema failed `err instanceof ZodError` under
 * Vitest (ESM `zod` here, CJS `dist` there) and escaped the controller's 400
 * mapping. The bound is `locationTypeCodeSchema`'s — `min(1).max(32)`, the
 * width of `bms.location_types.code varchar(32)` — and
 * `tests/f4.162-location-type-write-path.test.ts` holds the two together.
 */
export const locationTypeCodeParamSchema = z.string().min(1).max(32);
