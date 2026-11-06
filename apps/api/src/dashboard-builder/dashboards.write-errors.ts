import { BadRequestException, ConflictException } from "@nestjs/common";

import { SCOPE_REFUSAL_MESSAGE, TAB_LOCATION_MOVE_MESSAGE } from "@bms/shared";

/**
 * `F4.317` task 4.3 — `DashboardsService`'s write-error translation, moved out of
 * `dashboards.service.ts` byte-for-byte (methods to functions, `this.` dropped) to keep that
 * file under the AGENTS.md §4.5 cap before the organization-layout grant lands in it.
 */

/** The three nullable scope columns of the write — `DashboardsService`'s `DashboardScope`. */
type WriteErrorScope = {
  readonly locationId: string | null;
  readonly assetGroupId: string | null;
  readonly assetId: string | null;
};

/**
 * Turns the partial unique index violation into an answer.
 *
 * `dashboards_organization_slug_key` (migration `0050`) is what stops two dashboards sharing a
 * slug within one organization, and it fires on an ordinary authoring mistake — reusing a
 * slug, or two authors saving the same one at once. Surfacing the raw constraint name would
 * read as a bug rather than as "pick a different slug".
 *
 * `asset-templates.service.ts:805-813`'s `translateDraftConflict` is the precedent this copies
 * verbatim in shape: read the constraint off the error, translate the one name this method
 * owns, and return every other error unchanged — including a `23505` on a different
 * constraint, which must reach the caller exactly as the driver raised it.
 */
/**
 * The one error translation every write on this service goes through: the slug 409 first,
 * then the scope refusals below, then the driver's error unchanged.
 *
 * **One function, not two chained `.catch`es.** A second handler only ever sees what the
 * first re-threw, so the order of two catches decides which translation is reachable — and
 * the losing one is silently dead.
 *
 * Two states reach a caller as a 500 without this (review, security Low):
 *
 * - `42501` — `tenant_isolation`'s `WITH CHECK` on `bms.dashboards`, which migration `0073`
 *   re-created to check the `asset_id` and `asset_template_id` parents as well. A scope id
 *   from another organization is refused there, never by the foreign key (`0050`'s header:
 *   `WITH CHECK` runs before the FK's `AFTER` trigger).
 * - `23514` on `dashboards_scope_check` / `dashboards_asset_stamp_check` — the two CHECKs the
 *   service's own guards are supposed to reach first. A 400 here is the backstop for a state
 *   a guard missed, not a replacement for the guard.
 *
 * The field named is the scope axis this write actually set, taken from the merged scope the
 * caller already computed — the error itself carries no column. `putWidgets` passes the
 * STORED scope because it writes no scope column of its own, and naming a field from a widget
 * body would misattribute the refusal.
 *
 * **What protects `putWidgets` is not this translation.** A foreign `pointId` in a widget body
 * is refused by `assertBoundPointsInOrganization`, which runs inside the same transaction
 * **before any insert** and raises a 400 counting how many bindings were outside the
 * organization without echoing an id back (§9.6). By the time a `42501` could fire here, that
 * guard has already returned; this method is the backstop for a state the guard does not
 * cover, not the control.
 */
export function translateWriteError(err: unknown, slug: string, scope: WriteErrorScope): unknown {
  const translatedSlug = translateSlugConflict(err, slug);
  if (translatedSlug !== err) {
    return translatedSlug;
  }
  const code = (err as { code?: string } | null)?.code;
  const constraint = (err as { constraint?: string } | null)?.constraint;
  // FIRST, and independent of the scope axes: this CHECK is about `asset_template_id`, a
  // column no request body carries and `scope` does not either. Naming a scope axis here
  // would attribute the refusal to a field that is not the offending one — the item-1
  // mutation run produced exactly that sentence before this branch was split out.
  if (code === "23514" && constraint === "dashboards_asset_stamp_check") {
    return new BadRequestException(
      "This dashboard still carries an asset-template stamp, which describes nothing once it " +
        "names no asset. The stamp is cleared together with the asset scope.",
    );
  }
  // `F3.73` (ruling Q1) — a scope change of a dashboard whose tabs bind groups at its site
  // fails this composite FK. Independent of the scope axes and placed before `field === null`
  // for the same reason as the branch above: a move to organization-wide leaves every axis
  // null, and returning the raw error there would answer a 500.
  if (code === "23503" && constraint === "dashboard_tabs_dashboard_id_location_id_fkey") {
    return new BadRequestException(TAB_LOCATION_MOVE_MESSAGE);
  }
  const field =
    scope.assetId !== null
      ? "assetId"
      : scope.assetGroupId !== null
        ? "assetGroupId"
        : scope.locationId !== null
          ? "locationId"
          : null;
  if (field === null) {
    return err;
  }
  if (code === "42501") {
    return new BadRequestException(
      `The ${field} you supplied does not belong to this dashboard's organization — the ` +
        "write was refused by this table's row-level security policy.",
    );
  }
  if (code === "23514" && constraint === "dashboards_scope_check") {
    return new BadRequestException(
      `The ${field} you supplied leaves this dashboard in a scope the database refuses: ` +
        SCOPE_REFUSAL_MESSAGE,
    );
  }
  return err;
}

export function translateSlugConflict(err: unknown, slug: string): unknown {
  const constraint = (err as { constraint?: string } | null)?.constraint;
  if (constraint === "dashboards_organization_slug_key") {
    return new ConflictException(
      `A dashboard with slug "${slug}" already exists in this organization. Choose a different slug.`,
    );
  }
  return err;
}
