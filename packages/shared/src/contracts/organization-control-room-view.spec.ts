import { expect } from "vitest";

import {
  organizationControlRoomViewDtoSchema,
  organizationLayoutResultDtoSchema,
  putOrganizationControlRoomViewBodySchema,
} from "./organization-control-room-view";

/**
 * `F4.317` task 4.2 (ADR 0112 decisions 3 and 4) — the organization Control Room view contracts:
 * the strip read (`GET /control-room/organizations/:organizationId/view`), the "Make
 * organization layout" body and answer (`PUT …/view`). Assertions live here;
 * `organization-control-room-view.test.ts` is the Vitest entry point (ADR 0014).
 */

const ORG = "22222222-2222-4222-8222-222222222222";
const DASHBOARD = "33333333-3333-4333-8333-333333333333";

const openAlarmsTile = {
  key: "open-alarms-tile",
  title: "Open alarms",
  gridX: 6,
  gridY: 0,
  gridW: 3,
  gridH: 2,
  config: { icon: "alert", compareToPrevious: true },
  sources: [
    {
      catalogKey: "alarms.active.count",
      sortOrder: 0,
      resolved: {
        shape: "metric",
        key: "alarms.active.count",
        value: 3,
        unit: null,
        prior: { asOf: "2026-11-05T10:00:00.000Z", value: 2 },
      },
    },
    { catalogKey: "alarms.critical.count", sortOrder: 1, resolved: null },
  ],
};

const stockView = {
  organizationId: ORG,
  kind: "stock",
  dashboardId: null,
  dashboardSlug: null,
  layoutName: "Organization standard",
  canManage: false,
  tiles: [openAlarmsTile],
  resolvedAt: "2026-11-06T10:00:00.000Z",
};

/** The stock answer (no row): no dashboard, a tile with two sources, one unresolved. */
export function theStockViewParses(): void {
  expect(organizationControlRoomViewDtoSchema.safeParse(stockView).success).toBe(true);
}

/** The dashboard answer carries the copy's id and slug. */
export function theDashboardViewParses(): void {
  const view = { ...stockView, kind: "dashboard", dashboardId: DASHBOARD, dashboardSlug: "organization-layout-1a2b3c4d" };
  expect(organizationControlRoomViewDtoSchema.safeParse(view).success).toBe(true);
}

/** Only the two kinds: the site view's `generated` and `builtin` are not organization kinds. */
export function anUnknownKindIsRefused(): void {
  expect(organizationControlRoomViewDtoSchema.safeParse({ ...stockView, kind: "generated" }).success).toBe(false);
}

/** A tile's source names a catalog key; an unknown key is refused. */
export function anUnknownCatalogKeyIsRefused(): void {
  const tile = { ...openAlarmsTile, sources: [{ catalogKey: "alarms.tone", sortOrder: 0, resolved: null }] };
  expect(organizationControlRoomViewDtoSchema.safeParse({ ...stockView, tiles: [tile] }).success).toBe(false);
}

/** The PUT body: `{}` (newest published template) or `{ templateId }`, and nothing else. */
export function thePutBodyIsStrict(): void {
  expect(putOrganizationControlRoomViewBodySchema.safeParse({}).success).toBe(true);
  expect(putOrganizationControlRoomViewBodySchema.safeParse({ templateId: DASHBOARD }).success).toBe(true);
  expect(putOrganizationControlRoomViewBodySchema.safeParse({ templateId: "nope" }).success).toBe(false);
  expect(putOrganizationControlRoomViewBodySchema.safeParse({ organizationId: ORG }).success).toBe(false);
}

/** The copy's answer: the organization, the dashboard made, and the template it came from. */
export function theLayoutResultParses(): void {
  const result = { organizationId: ORG, dashboardId: DASHBOARD, dashboardSlug: "organization-layout-1a2b3c4d", templateId: DASHBOARD };
  expect(organizationLayoutResultDtoSchema.safeParse(result).success).toBe(true);
  expect(organizationLayoutResultDtoSchema.safeParse({ ...result, dashboardId: null }).success).toBe(false);
}
