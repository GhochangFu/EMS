import { expect } from "vitest";

import { locations, organizations } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { nullUnreadableParents } from "./energy-filter-options";
import { EnergyViewService } from "./energy-view.service";

/**
 * `F4.298` U4 (ADR 0108 decision 2.7) — `GET /reports/energy/filter-options`:
 * the caller's readable organizations and locations, for every role. A parent
 * outside the readable rows is sent as `null`, the `/auth/me` rule
 * (`withVisibleParents`). Vitest entry point: the sibling `.test.ts`.
 */

const ADMIN = { sub: "22222222-2222-4222-8222-222222222222", role: "admin" } as JwtPayload;
const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const ORG_B = "00000000-0000-4000-8000-0000000000bb";
const ROOT = "40000000-0000-4000-8000-000000000001";
const CHILD = "40000000-0000-4000-8000-000000000002";
const HIDDEN_PARENT = "40000000-0000-4000-8000-0000000000ff";

/** A parent the caller cannot read is `null`; a readable parent is named. */
export function anUnreadableParentIsNull(): void {
  const rows = nullUnreadableParents([
    { id: ROOT, name: "Root", parentId: HIDDEN_PARENT, organizationId: ORG_A },
    { id: CHILD, name: "Child", parentId: ROOT, organizationId: ORG_A },
  ]);
  expect(rows).toEqual([
    { id: ROOT, name: "Root", parentId: null, organizationId: ORG_A },
    { id: CHILD, name: "Child", parentId: ROOT, organizationId: ORG_A },
  ]);
  expect(JSON.stringify(rows)).not.toContain(HIDDEN_PARENT);
}

function fake(organizationRows: Array<{ id: string; code: string; name: string }>) {
  const where: unknown[] = [];
  /** Each read's table and its `orderBy` columns, in call order. */
  const orders: Array<{ table: unknown; columns: unknown[] }> = [];
  const fleetDb = {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => {
          where.push(condition);
          return {
            orderBy: async (...columns: unknown[]) => {
              orders.push({ table, columns });
              if (table === organizations) return organizationRows;
              if (table === locations) return [{ id: ROOT, name: "Root", parentId: null, organizationId: ORG_A }];
              throw new Error("unexpected select");
            },
          };
        },
      }),
    }),
  };
  const access = {
    readableOrganizationIds: async () => null,
    readableLocationIds: async () => null,
    readableAssetIdsInOrganization: async () => [],
  };
  const service = new EnergyViewService(
    { query: async () => ({ rows: [] }) } as never,
    fleetDb as never,
    { resolveForAssets: async () => new Map<string, number>() },
    access,
    { placeForCaller: async () => ({ organizationId: ORG_A, assetIds: [] }) },
  );
  return { service, where, orders };
}

/** A global admin gets every active organization the read answers, and their locations. */
export async function aGlobalAdminGetsEveryActiveOrganization(): Promise<void> {
  const organizationRows = [
    { id: ORG_A, code: "A", name: "Org A" },
    { id: ORG_B, code: "B", name: "Org B" },
  ];
  const f = fake(organizationRows);
  const options = await f.service.filterOptions(ADMIN);
  expect(options.organizations).toEqual(organizationRows);
  expect(options.locations.map((l) => l.id)).toEqual([ROOT]);
}

/**
 * Both reads carry an order, so the web's preselected first organization and
 * the location list are the same on every refetch (no `ORDER BY` is the
 * query plan's order). Organizations by name, then code; locations by name, then id.
 */
export async function bothReadsAreOrderedByName(): Promise<void> {
  const f = fake([{ id: ORG_A, code: "A", name: "Org A" }]);
  await f.service.filterOptions(ADMIN);
  expect(f.orders).toEqual([
    { table: organizations, columns: [organizations.name, organizations.code] },
    { table: locations, columns: [locations.name, locations.id] },
  ]);
}

/** A caller who reads no organization is answered with nothing, and no table is read. */
export async function aCallerWithNoOrganizationReadsNothing(): Promise<void> {
  const f = fake([]);
  const access = {
    readableOrganizationIds: async () => [],
    readableLocationIds: async () => [],
    readableAssetIdsInOrganization: async () => [],
  };
  const service = new EnergyViewService(
    { query: async () => ({ rows: [] }) } as never,
    { select: () => { throw new Error("no read expected"); } } as never,
    { resolveForAssets: async () => new Map<string, number>() },
    access,
    { placeForCaller: async () => ({ organizationId: ORG_A, assetIds: [] }) },
  );
  expect(await service.filterOptions(ADMIN)).toEqual({ organizations: [], locations: [] });
  expect(f.where).toEqual([]);
}
