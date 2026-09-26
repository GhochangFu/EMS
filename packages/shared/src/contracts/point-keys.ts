/**
 * The fleet-wide point-key catalog's admin DTO. Moved out of `admin.ts` by
 * `F3.68` to keep that file under the AGENTS.md §4.5 line cap; the public name
 * is unchanged, so `@bms/shared` consumers see no difference.
 */
import { z } from "zod";

/**
 * `F3.39` / ADR 0051 decisions 2 and 3 — the point-key catalog is fleet-wide,
 * so this DTO carries no organization. `organizationId`, `organizationCode` and
 * `organizationName` were removed with the column migration `0057` drops; a
 * schema that kept them would describe a field no row has.
 */
export const adminPointKeyDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  unit: z.string().nullable(),
  description: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  headlineRank: z.number().int().nullable(),
});
