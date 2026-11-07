import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload, UserRole } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import type { MasterDataAuditService } from "../master-data-audit.service";
import { OrganizationsAdminService } from "./organizations.service";

/**
 * `F4.330` (ADR 0115 decision 3, plan R2) — `setIngestEnabled`'s control flow on fakes: the gate
 * runs before any read, a no-op writes nothing, and a change writes one platform audit row on
 * `fleetDb`. What Postgres holds is `organizations.ingest.integration.spec.ts`'s (I0–I6); this
 * file is the half that runs without a database. The sibling `.test.ts` carries the `it()`s.
 */

const ID = "11111111-1111-4111-8111-111111111111";
const ROW = {
  id: ID,
  code: "F4330",
  name: "F4.330 unit",
  active: true,
  meta: null,
  currency: "INR",
  timezone: "UTC",
  colourProfile: "nexus",
  ingestEnabled: true,
  createdAt: new Date(0),
};

type Harness = {
  svc: OrganizationsAdminService;
  events: string[];
  audits: Array<{ entry: Record<string, unknown>; executor: unknown }>;
  fleetDb: BmsDb;
};

function harness(role: UserRole, stored: typeof ROW | undefined): Harness {
  const events: string[] = [];
  const audits: Harness["audits"] = [];
  let row = stored;
  const tenantDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            events.push("select");
            return row ? [row] : [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: { ingestEnabled: boolean }) => ({
        where: () => ({
          returning: async () => {
            events.push(`update ${String(values.ingestEnabled)}`);
            row = { ...(row as typeof ROW), ...values };
            return [row];
          },
        }),
      }),
    }),
  } as unknown as BmsDb;
  const fleetDb = { fleet: true } as unknown as BmsDb;
  const access = {
    requireMasterDataUser: async () => {
      events.push("requireMasterDataUser");
      return { role };
    },
    assertAdminRole: (r: UserRole) => {
      events.push("assertAdminRole");
      AccessControlService.prototype.assertAdminRole.call(null, r);
    },
  } as unknown as AccessControlService;
  const audit = {
    write: async (entry: Record<string, unknown>, executor: unknown) => {
      events.push(`audit ${String(entry.action)}`);
      audits.push({ entry, executor });
    },
  } as unknown as MasterDataAuditService;
  return { svc: new OrganizationsAdminService(fleetDb, tenantDb, access, audit), events, audits, fleetDb };
}

const jwt = (role: UserRole): JwtPayload => ({ sub: "u", email: "u@bms.local", role }) as JwtPayload;

/** U1 — every role but `admin` is a 403 before any read or write. */
export async function everyoneButTheGlobalAdminIsRefusedBeforeARead(): Promise<void> {
  for (const role of ["organization_admin", "location_admin", "viewer"] as UserRole[]) {
    const h = harness(role, ROW);
    await expect(h.svc.setIngestEnabled(jwt(role), ID, false), role).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.events, role).toEqual(["requireMasterDataUser", "assertAdminRole"]);
  }
}

/** U2 — an unknown id is a 404 and writes nothing. */
export async function anUnknownIdIs404(): Promise<void> {
  const h = harness("admin", undefined);
  await expect(h.svc.setIngestEnabled(jwt("admin"), ID, false)).rejects.toBeInstanceOf(NotFoundException);
  expect(h.events).toEqual(["requireMasterDataUser", "assertAdminRole", "select"]);
}

/** U3 — the stored value again returns the mapped row, with no update and no audit row (R2). */
export async function theStoredValueWritesNothing(): Promise<void> {
  const h = harness("admin", ROW);
  const dto = await h.svc.setIngestEnabled(jwt("admin"), ID, true);
  expect(dto.ingestEnabled).toBe(true);
  expect(dto.id).toBe(ID);
  expect(h.events).toEqual(["requireMasterDataUser", "assertAdminRole", "select"]);
}

/** U4 — off then on: one update and one platform audit row each, on `fleetDb`, with no payload. */
export async function aChangeWritesOnePlatformAuditRow(): Promise<void> {
  const h = harness("admin", ROW);
  const off = await h.svc.setIngestEnabled(jwt("admin"), ID, false);
  expect(off.ingestEnabled).toBe(false);
  const on = await h.svc.setIngestEnabled(jwt("admin"), ID, true);
  expect(on.ingestEnabled).toBe(true);
  expect(h.events.filter((e) => e.startsWith("update") || e.startsWith("audit"))).toEqual([
    "update false",
    "audit master.organization.ingest.disable",
    "update true",
    "audit master.organization.ingest.enable",
  ]);
  for (const { entry, executor } of h.audits) {
    expect(entry).toMatchObject({ entityType: "organization", entityId: ID, organizationId: null });
    expect(entry.payload).toBeUndefined();
    expect(executor).toBe(h.fleetDb);
  }
}
