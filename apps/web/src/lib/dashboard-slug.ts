/**
 * `E4.2` PR 2 sweep — the client-side statement of the dashboard slug rule.
 *
 * **The rule is the server's.** `dashboardFieldsSchema.slug` (`POST
 * /dashboards`) and `instantiateSectionTemplateBodySchema.slug` (the stock
 * template instantiate arm) both read `.min(2).max(64).regex(/^[a-z0-9-]+$/)`
 * — one column, `bms.dashboards.slug`, addressed as a path segment. PR 2
 * tightened the second of those two after the security review found them
 * disagreeing.
 *
 * **Why a copy exists here at all.** Neither Zod schema is reachable from the
 * browser bundle: both live under `apps/api/src`, and `packages/shared` carries
 * no slug contract to `z.infer` from. Without this file the rule was stated
 * nowhere on the client, so an administrator typing `Sustainability Overview`
 * filled the whole instantiate form and got a 400 on submit. Declared ONCE here
 * rather than inline in each of the two forms, so the two authoring surfaces
 * cannot drift from each other — they can still drift from the server, which is
 * a residual to close by exporting the rule from `packages/shared`.
 */

/** The `<input pattern>` body — no anchors: HTML anchors the whole value. */
export const DASHBOARD_SLUG_PATTERN = "[a-z0-9-]+";

export const DASHBOARD_SLUG_MIN = 2;
export const DASHBOARD_SLUG_MAX = 64;

/** One line under the field, in the words the failure needs. */
export const DASHBOARD_SLUG_HINT = "Lowercase letters, digits and hyphens, 2–64 characters";

/**
 * Whether `value` is a slug the API will accept — the predicate the submit
 * gates read, so a form cannot be submittable into a 400.
 */
export function isDashboardSlug(value: string): boolean {
  return (
    value.length >= DASHBOARD_SLUG_MIN &&
    value.length <= DASHBOARD_SLUG_MAX &&
    new RegExp(`^${DASHBOARD_SLUG_PATTERN}$`).test(value)
  );
}
