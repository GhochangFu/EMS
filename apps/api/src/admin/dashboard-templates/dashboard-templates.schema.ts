import {
  dashboardSectionCodeSchema,
  sectionTemplateContentSchema,
  templateLifecycleStatusSchema,
} from "@bms/shared";
import { z } from "zod";

/**
 * Write contracts for the section dashboard template admin surface — `F3.36`,
 * [ADR 0049](../../../../../docs/adr/0049-section-dashboard-templates.md).
 *
 * **Request schemas live in `apps/api`, never in `packages/shared`** — AGENTS.md
 * §3 and ADR 0030 decision 3. Only response contracts live in the shared
 * package, and `operations.ts` carries a note recording that a compliance review
 * caught the first draft of ADR 0034 getting this backwards.
 *
 * They are exported from a `*.schema.ts` for a second reason that is easy to
 * miss: ADR 0029's OpenAPI registry can only see schemas exported from such a
 * file. `F4.20` moved `templateStatusQuerySchema` out of a controller for
 * exactly that — declared inside the controller, that route's only parameter
 * went undocumented for a reason no reader could have guessed.
 *
 * ---
 *
 * **EVERY BODY IS `.strict()`, AND THAT IS A FINDING RATHER THAN A STYLE.**
 * `F3.37`'s pre-merge review found a permissive, unregistered `PATCH` body that
 * let `roleCode` be stripped from the payload and silently **cleared** the value
 * at 200 — a write that looked like a success and lost data. The same door is
 * open here for `content`, which is the whole authored canvas. `.strict()`
 * rejects the unknown key instead of ignoring it, and an explicitly optional
 * field is the only way to omit one.
 */

/** The status filter on the list route. Re-exports the one declaration (ADR
 * 0049 decision 2) — never a second `z.enum`. */
export const dashboardTemplateStatusQuerySchema = templateLifecycleStatusSchema;

export const listDashboardTemplatesQuerySchema = z
  .object({
    organizationId: z.string().uuid().optional(),
    status: dashboardTemplateStatusQuerySchema.optional(),
    section: dashboardSectionCodeSchema.optional(),
  })
  .strict();

/**
 * Create a draft template.
 *
 * `code` and `name` carry `.min(1)` **here** and not on the response contract:
 * the column is `varchar` and accepts the empty string, so the read contract
 * must not claim otherwise, but a write may and should refuse one.
 *
 * `section` is validated against the live `bms.dashboard_sections` rows by the
 * service, not by this schema. It is an open vocabulary (ADR 0049 Amendment 2
 * decision 5), so the set lives in the table and the service turns an unknown
 * code into a 400 naming the live options — the shape
 * `VocabulariesService.assertAssetRole` already uses for roles.
 */
export const createDashboardTemplateBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(255),
    section: dashboardSectionCodeSchema,
    description: z.string().max(2000).nullish(),
    content: sectionTemplateContentSchema.optional(),
  })
  .strict();

/**
 * Patch a draft template.
 *
 * Every field optional, so a caller may send one. **`.strict()` is what stops an
 * omitted-but-misspelled key reading as "clear this field"**, which is `F3.37`'s
 * finding. `organizationId` and `code` are absent on purpose: moving a template
 * between organizations is not an edit, and `code` is half of the version
 * identity `(organization_id, code, version)`.
 */
export const updateDashboardTemplateBodySchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    section: dashboardSectionCodeSchema.optional(),
    description: z.string().max(2000).nullish(),
    content: sectionTemplateContentSchema.optional(),
  })
  .strict();

/**
 * Instantiate a published template against one asset group.
 *
 * `assetGroupId` and not a location: ADR 0049 decision 4 resolves a widget's
 * role against **the target asset group's members**, so a group is what the
 * resolution needs. The created dashboard is asset-group scoped for the same
 * reason.
 */
export const instantiateSectionTemplateBodySchema = z
  .object({
    assetGroupId: z.string().uuid(),
    slug: z.string().min(1).max(64),
    name: z.string().min(1).max(255),
    description: z.string().max(2000).nullish(),
  })
  .strict();

/** Import one stock catalog entry into the caller's organization. */
export const importStockTemplateBodySchema = z
  .object({
    organizationId: z.string().uuid(),
  })
  .strict();

export type ListDashboardTemplatesQuery = z.infer<typeof listDashboardTemplatesQuerySchema>;
export type CreateDashboardTemplateBody = z.infer<typeof createDashboardTemplateBodySchema>;
export type UpdateDashboardTemplateBody = z.infer<typeof updateDashboardTemplateBodySchema>;
export type InstantiateSectionTemplateBody = z.infer<
  typeof instantiateSectionTemplateBodySchema
>;
export type ImportStockTemplateBody = z.infer<typeof importStockTemplateBodySchema>;
