import { expect } from "vitest";
import type { ZodTypeAny } from "zod";

import { convertZodSchema } from "../../openapi/zod-openapi";
import { createLocationBodySchema, updateLocationBodySchema } from "./locations.schema";

/**
 * `F4.170` (compliance review B1) — the OpenAPI half of the location body cases. These two
 * assert on the generated document (`convertZodSchema` is `apps/api`), so they stayed here when
 * the schema moved to `packages/shared` (`F3.86` PR 1); the pure schema cases moved with it to
 * `location-writes.spec.ts`.
 */

/** The generated OpenAPI description of `properties.meta` in `schema`. */
function metaDescription(schema: ZodTypeAny, name: string): unknown {
  const { schema: json } = convertZodSchema(schema, name);
  return (json.properties as Record<string, { description?: unknown }> | undefined)?.meta?.description;
}

/**
 * D1 (`F4.170`, compliance review B1) — the generated document says `seedKey`
 * is seed-owned and ignored on a create. Read from the converted schema, not
 * the source, since a caller reads the document.
 */
export function createMetaDescribesTheSeedKey(): void {
  expect(metaDescription(createLocationBodySchema, "createLocationBody")).toMatch(/seedKey.*seed-owned.*ignored/s);
}

/**
 * D2 — the same on an update. `updateLocationBodySchema` is `.omit().partial()`,
 * and `partial()` wraps the field again, so D1 says nothing about it.
 */
export function updateMetaDescribesTheSeedKey(): void {
  expect(metaDescription(updateLocationBodySchema, "updateLocationBody")).toMatch(/seedKey.*seed-owned.*ignored/s);
}
