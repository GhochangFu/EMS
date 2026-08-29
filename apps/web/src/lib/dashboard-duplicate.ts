import type { DashboardDto } from "@bms/shared";

import {
  buildPutWidgetsPayload,
  dashboardRowsFromDto,
  type DashboardWidgetRow,
  type PutDashboardWidgetsPayload,
} from "./dashboard-builder-form";

/**
 * The pure half of the duplicate action (ADR 0047 Amendment 2 ruling 3; `F3.1d` Unit 9's
 * composition calls this). Reuses `dashboard-builder-form.ts`'s own DTO→row and row→write-body
 * mappers rather than restating the config/identity translation a second time — the same
 * discipline Unit 4's own file docblock states for `widget-config-form.ts`.
 */

/** `dashboardFieldsSchema.slug` (`apps/api/src/dashboard-builder/dashboards.schema.ts`) caps a
 * slug at 64 characters. `base` is already a stored, valid slug and so is at most that long, but
 * appending `-copy` or `-copy-<n>` can push the total over it — truncating `base` to leave room
 * for the suffix keeps every candidate this function proposes inside the bound the API accepts,
 * rather than trading one 400 (a name too long) for a sentence the duplicate dialog cannot
 * render. */
const MAX_SLUG_LENGTH = 64;

/** How many numbered candidates `freeSlug` will try before giving up — `<slug>-copy`,
 * `<slug>-copy-2`, … `<slug>-copy-50`. Bounded so a dashboard sitting in a fleet organization
 * with forty-nine copies already made fails loudly rather than looping. */
const MAX_FREE_SLUG_ATTEMPTS = 50;

function suffixFor(attempt: number): string {
  return attempt === 1 ? "-copy" : `-copy-${attempt}`;
}

function candidateSlug(base: string, attempt: number): string {
  const suffix = suffixFor(attempt);
  const room = MAX_SLUG_LENGTH - suffix.length;
  const truncatedBase = room > 0 ? base.slice(0, room) : base.slice(0, MAX_SLUG_LENGTH);
  return `${truncatedBase}${suffix}`;
}

/**
 * The first `<base>-copy`, `<base>-copy-2`, … not already in `takenSlugs`.
 *
 * §Task 0.2 is what makes `takenSlugs` collision-complete when it is built from the caller's own
 * organization-scoped dashboard list: `DashboardsService.list` filters on `organizationId` only
 * and `AccessControlService.readableOrganizationIds` never narrows below it, so every reader
 * already sees every slug in the organization.
 */
export function freeSlug(base: string, takenSlugs: ReadonlySet<string> | readonly string[]): string {
  const taken = takenSlugs instanceof Set ? takenSlugs : new Set(takenSlugs);
  for (let attempt = 1; attempt <= MAX_FREE_SLUG_ATTEMPTS; attempt++) {
    const candidate = candidateSlug(base, attempt);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`freeSlug: no free slug for "${base}" after ${MAX_FREE_SLUG_ATTEMPTS} attempts`);
}

/** Where the copy lands. `organizationId` is always the source's own — Unit 9's composition
 * never offers it as a choice, which is what keeps `assertBoundPointsInOrganization` satisfiable
 * — but this pure function accepts it as a plain argument rather than reading `source` itself,
 * so a caller mistake there is the caller's, not a silent default here. */
export type DuplicateDashboardTarget = {
  organizationId: string;
  scope: { locationId: string | null; assetGroupId: string | null };
  slug: string;
  name: string;
};

/** Mirrors `CreateDashboardBody` (`apps/api/src/dashboard-builder/dashboards.schema.ts`) field
 * for field, the same local-mirror shape `dashboard-builder-form.ts`'s own `WidgetWritePayload`
 * uses for `PutDashboardWidgetsBody`. */
export type DuplicateDashboardCreateBody = {
  organizationId: string;
  slug: string;
  name: string;
  description: string | null;
  locationId: string | null;
  assetGroupId: string | null;
};

export type DuplicateDashboardPayload = {
  create: DuplicateDashboardCreateBody;
  widgets: PutDashboardWidgetsPayload;
};

/** Every `dashboard_widgets.id`/`dashboard_widget_points.id` on `row` belongs to the SOURCE
 * dashboard. `PUT /:id/widgets` on the new, empty dashboard must not carry them — the write
 * schema treats a present `id` as "this is an existing widget of THIS dashboard to update", and
 * an id copied from another dashboard is not that. */
function dropWidgetId(row: DashboardWidgetRow): DashboardWidgetRow {
  const { id: _sourceId, ...rest } = row;
  return rest;
}

/**
 * Builds the two request bodies Unit 9's dialog sends in sequence: `POST /dashboards`, then
 * `PUT /:id/widgets` against whatever id the first call returns. Not atomic — the composition
 * that calls this, not this function, is what decides how a failed second call is surfaced
 * (plan §8 Unit 9 / §15 Q5).
 */
export function duplicatePayload(
  source: DashboardDto,
  target: DuplicateDashboardTarget,
): DuplicateDashboardPayload {
  const widgets = buildPutWidgetsPayload(dashboardRowsFromDto(source).map(dropWidgetId));
  return {
    create: {
      organizationId: target.organizationId,
      slug: target.slug,
      name: target.name,
      description: source.description,
      locationId: target.scope.locationId,
      assetGroupId: target.scope.assetGroupId,
    },
    widgets,
  };
}
