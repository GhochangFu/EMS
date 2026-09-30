import {
  dashboardSectionCodeSchema,
  dashboardTemplateTargetSchema,
  sectionTemplateContentSchema,
  templateLifecycleStatusSchema,
  templateTargetContentMessage,
} from "@bms/shared";
import type { DashboardTemplateTarget } from "@bms/shared";
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

/**
 * `F3.32c` / ADR 0081 decision 5 — a template holds a preset mimic only. A
 * layout is one organization's row with a delete rule (`DELETE` answers 409
 * while a widget refers to it); a template's layout reference has no such rule
 * yet, and instantiating it into another organization would name a layout that
 * organization cannot hold. ADR 0081 *Consequences* leaves that to a later stage.
 */
export const TEMPLATE_MIMIC_LAYOUT_MESSAGE =
  "a dashboard template holds a preset mimic only; layouts in templates are a later stage";

/**
 * The template's content, with the layout-arm refusal. The shared
 * `sectionTemplateContentSchema` takes both mimic arms because its widget spec
 * is the dashboard's too, so the refusal is added HERE, on the field both
 * `POST` and `PATCH` carry. The body objects stay plain `.strict()` objects.
 */
const templateContentWriteSchema = sectionTemplateContentSchema
  .superRefine((content, ctx) => {
    // `F3.73` — the tabs are walked too: a site template holds every widget in a tab, so a
    // loop over `content.widgets` alone would let a layout arm through on every site template.
    const refuseLayout = (
      widget: (typeof content.widgets)[number],
      path: (string | number)[],
    ): void => {
      if (widget.widgetType === "mimic" && widget.config.source === "layout") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: TEMPLATE_MIMIC_LAYOUT_MESSAGE });
      }
    };
    content.widgets.forEach((widget, index) => refuseLayout(widget, ["widgets", index, "config"]));
    content.tabs.forEach((tab, tabIndex) =>
      tab.widgets.forEach((widget, index) =>
        refuseLayout(widget, ["tabs", tabIndex, "widgets", index, "config"]),
      ),
    );
  })
  .describe(
    "A template's canvas. A mimic widget, top-level or in a tab, must take the preset arm " +
      '({ source: "preset" }); a layout arm answers 400 (ADR 0081 decision 5) — ' +
      "a layout is one organization's row, and a template carries no layout " +
      "reference in this stage.",
  );

/**
 * `F3.73` — the `PATCH` body's content: every rule of `templateContentWriteSchema`, but
 * `tabs` has **no default**, so the parsed body still says whether the caller sent it. The
 * service refuses an omitted `tabs` on a site template (`SITE_TEMPLATE_PATCH_TABS_MESSAGE`);
 * `POST` keeps the default, because a create has no stored tabs to lose.
 */
const templateContentShape = sectionTemplateContentSchema.innerType();
const templateContentPatchSchema = templateContentShape
  .extend({ tabs: templateContentShape.shape.tabs.removeDefault().optional() })
  .superRefine((content, ctx) => {
    // The key and layout rules, from the one declaration rather than restated.
    const checked = templateContentWriteSchema.safeParse(content);
    if (!checked.success) checked.error.issues.forEach((issue) => ctx.addIssue(issue));
  })
  .describe(
    "A template's canvas, as a PATCH carries it. The rules of the create body's content, and " +
      "one more: on a site template content.tabs is required, because an omitted key cannot " +
      "be told from a cleared one.",
  );

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
    /** `F3.73` ruling Q3a. Set once, here: the `PATCH` body carries no `target`, because a
     * template's target decides which content shape its versions hold. */
    target: dashboardTemplateTargetSchema.default("asset_group"),
    description: z.string().max(2000).nullish(),
    content: templateContentWriteSchema.optional(),
  })
  .strict()
  // `F3.73` plan D4 — the target rule, on the one body that carries both halves of it. A
  // `PATCH` carries content only, so the service checks it against the stored row's target.
  .superRefine((body, ctx) => {
    if (body.content === undefined) return;
    const message = templateTargetContentMessage(body.target, body.content);
    if (message !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content", body.target === "site" ? "widgets" : "tabs"],
        message,
      });
    }
  })
  .describe(
    "Create a draft template. One rule the document cannot express: a site-target template " +
      "holds its widgets in content.tabs and its top-level content.widgets must be empty; an " +
      "asset-group template holds no tabs.",
  );

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
    content: templateContentPatchSchema.optional(),
  })
  .strict();

/**
 * Instantiate a published template against one asset group.
 *
 * `assetGroupId` and not a location: ADR 0049 decision 4 resolves a widget's
 * role against **the target asset group's members**, so a group is what the
 * resolution needs. The created dashboard is asset-group scoped for the same
 * reason.
 *
 * **`.nullable()`, and only `E4.2`'s one case may use it** — ADR 0072 decision
 * 1, an amendment to ADR 0049 decision 4. `asset_groups.location_id` is `NOT
 * NULL`, so every instance was one location's group and the organization-wide
 * enterprise roll-up that ADR names had nowhere to land. A `null` group
 * instantiates organization-wide (both scope columns `NULL`) **only** when the
 * pinned version's every widget has zero `bindings`; a template that binds a
 * role still gets a 400, because a role resolves against the target group's
 * members and with no group it would resolve nothing.
 *
 * The check is the SERVICE's and not this schema's on purpose: whether a
 * template has bindings is a fact about the stored `content` of the pinned
 * version, which a request schema cannot see. `section` is validated the same
 * way and for the same reason.
 */
const instantiateGroupTemplateBodySchema = z
  .object({
    assetGroupId: z.string().uuid().nullable(),
    /**
     * **The same rule `dashboardFieldsSchema.slug` applies, because this is the
     * same column.** Found by the `E4.2` PR 2 security review: the two write
     * doors into `bms.dashboards.slug` disagreed — `POST /dashboards` took
     * `.min(2).max(64).regex(/^[a-z0-9-]+$/)` and this one took any string of
     * one to sixty-four characters. A slug is addressed as a PATH SEGMENT
     * (`GET /dashboards/:slug`) and rendered into links, so a `/`, a `?` or a
     * `#` in one is not a cosmetic difference; and a second door with a wider
     * rule is how a value the first door refuses gets into the table anyway.
     */
    slug: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9-]+$/),
    name: z.string().min(1).max(255),
    description: z.string().max(2000).nullish(),
  })
  .strict();

/**
 * Instantiate a published SITE template onto one location — `F3.73` ruling Q3a, plan D6.
 *
 * No slug and no name: the copy action names its dashboard `site-layout-<location slug>`, so
 * one site holds one copy. `tabGroups` is the per-tab group choice (`tabKey → assetGroupId`)
 * an administrator makes when a site holds two untaken groups of one domain; the keys take
 * `dashboard_tabs.tab_key`'s shape.
 */
const instantiateSiteTemplateBodySchema = z
  .object({
    locationId: z.string().uuid(),
    tabGroups: z.record(z.string().regex(/^[a-z0-9-]{1,64}$/), z.string().uuid()).optional(),
  })
  .strict();

/**
 * The instantiate body — one arm per template target (`F3.73` ruling Q3a).
 *
 * **A plain `z.union`, and each arm stays `.strict()`.** Neither arm carries a literal a
 * `discriminatedUnion` could key on, and a body naming both a group and a location must be
 * refused rather than read as either: each strict arm refuses the other arm's key. Zod 3
 * answers with the first arm that failed on a check rather than on a missing key, so a
 * malformed group body still answers at `assetGroupId` or `slug`, not as an opaque
 * `invalid_union` — the `E4.2` cases in the sibling spec hold that.
 *
 * **Which arm a template takes is the stored row's `target`, which no request schema can
 * see** — `templateTargetBodyMessage` below, which the service applies.
 */
export const instantiateSectionTemplateBodySchema = z.union([
  instantiateGroupTemplateBodySchema,
  instantiateSiteTemplateBodySchema,
]);

/**
 * `F3.73` — a `PATCH` of a site template's content must carry `content.tabs`. The shared
 * content schema defaults `tabs` to `[]` for content stored before `F3.73`, so an omitted key
 * would otherwise read as "clear every tab" (`F3.37`'s finding, one level down) and a
 * `{ widgets }`-only client would wipe a site draft at 200.
 */
export const SITE_TEMPLATE_PATCH_TABS_MESSAGE =
  "a site template's content holds its widgets in tabs; a PATCH of its content must carry " +
  "content.tabs — send the stored tabs back to keep them, or [] to clear them";

/** `F3.73` plan D6 — a body arm that does not fit the template's target. */
export const TEMPLATE_TARGET_BODY_MESSAGE =
  "This template's target does not take this body: a site template takes " +
  "{ locationId, tabGroups? }, an asset-group template takes { assetGroupId, slug, name }";

/** `null` when the body arm fits the template's target, else `TEMPLATE_TARGET_BODY_MESSAGE`. */
export function templateTargetBodyMessage(
  target: DashboardTemplateTarget,
  body: InstantiateSectionTemplateBody,
): string | null {
  const siteBody = "locationId" in body;
  return siteBody === (target === "site") ? null : TEMPLATE_TARGET_BODY_MESSAGE;
}

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
/** The group arm — a null `assetGroupId` is `E4.2`'s organization-wide case. */
export type InstantiateGroupTemplateBody = z.infer<typeof instantiateGroupTemplateBodySchema>;
/** The site arm (`F3.73` plan D6). */
export type InstantiateSiteTemplateBody = z.infer<typeof instantiateSiteTemplateBodySchema>;
export type ImportStockTemplateBody = z.infer<typeof importStockTemplateBodySchema>;
