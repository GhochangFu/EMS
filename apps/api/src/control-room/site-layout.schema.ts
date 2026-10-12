/**
 * `F3.86` PR 1 — the site-layout body and its refusal sentences moved to `packages/shared/src/contracts/site-layout-writes.ts`. This file re-exports them (the `F3.85` PR 11a
 * pattern), so every controller, service and spec keeps its import unchanged.
 */
export {
  siteLayoutBodySchema,
  type SiteLayoutBody,
  SITE_HAS_VIEW_MESSAGE,
  NO_SITE_TEMPLATE_MESSAGE,
  SITE_LAYOUT_SLUG_TAKEN_MESSAGE,
  SITE_LAYOUT_AMBIGUOUS_MESSAGE,
  SITE_HAS_NO_ASSETS_MESSAGE,
  SITE_TEMPLATE_NOT_FOUND_MESSAGE,
  SITE_LAYOUT_CHOICE_MESSAGES,
} from "@bms/shared";
