import { expect } from "vitest";

import { mimicSymbolLibrariesQuerySchema } from "./mimic-symbol-libraries.schema";

/**
 * `F3.32f` slice 3 U2 - the `GET ?organizationId=` query parser. The write-body cases moved to
 * `packages/shared/src/contracts/mimic-symbol-library-writes.spec.ts` with their schemas
 * (`F3.87` PR 1); this one stays because the query is parsed with the api's own `zod`.
 */
export function queryRefusesANonUuidOrganization(): void {
  const result = mimicSymbolLibrariesQuerySchema.safeParse({ organizationId: "ESKOM" });
  expect(result.success).toBe(false);
  if (result.success) return;
  expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(["organizationId"]);
}
