import { ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import { adminOrganizationDtoSchema, adminOrganizationSummaryDtoSchema, adminRtuDtoSchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type { RtusAdminService } from "../rtus/rtus.service";
import type { OrganizationsAdminService } from "./organizations.service";

/**
 * `F4.330` / ADR 0115 decisions 1, 3 and 4 (plan R2, R3) — the organization ingest switch,
 * against the real database: the column default, the global-admin-only write, its platform audit
 * row (`organization_id IS NULL`), the no-op write, and the two DTOs that carry the value.
 *
 * Assertions live here; `organizations.ingest.integration.test.ts` owns the pools, the fixture
 * organization, location and RTU, and the `afterAll` cleanup (ADR 0014). One exported function
 * per claim. The claims run in order (I1 switches off, I3 back on), on the fixture only — no
 * seeded organization is written.
 *
 * **Read-backs run as `bms_fleet`** (the `organizations.colour-profile` habit).
 */
export type IngestSwitchCtx = {
  svc: OrganizationsAdminService;
  rtuSvc: RtusAdminService;
  fleetPool: pg.Pool;
  globalAdmin: JwtPayload;
  organizationAdmin: JwtPayload;
  locationAdmin: JwtPayload;
  /** A fixture organization, with one location and one RTU (`ingest_enabled = true`). */
  fixtureId: string;
  locationId: string;
  rtuId: string;
};

async function readSwitch(ctx: IngestSwitchCtx): Promise<boolean | undefined> {
  const { rows } = await ctx.fleetPool.query<{ ingest_enabled: boolean }>(
    "SELECT ingest_enabled FROM bms.organizations WHERE id = $1",
    [ctx.fixtureId],
  );
  return rows[0]?.ingest_enabled;
}

type AuditRow = { action: string; organization_id: string | null };

async function readIngestAudit(ctx: IngestSwitchCtx): Promise<AuditRow[]> {
  const { rows } = await ctx.fleetPool.query<AuditRow>(
    `SELECT action, organization_id FROM bms.audit_log
      WHERE entity_type = 'organization' AND entity_id = $1 AND action LIKE 'master.organization.ingest.%'
      ORDER BY created_at, id`,
    [ctx.fixtureId],
  );
  return rows;
}

async function readRtuOwnBox(ctx: IngestSwitchCtx): Promise<boolean | undefined> {
  const { rows } = await ctx.fleetPool.query<{ ingest_enabled: boolean }>(
    "SELECT ingest_enabled FROM bms.rtus WHERE id = $1",
    [ctx.rtuId],
  );
  return rows[0]?.ingest_enabled;
}

/** I0 — a new organization reads `ingest_enabled = true` (the column default) and has no ingest audit row. */
export async function aNewOrganizationIngests(ctx: IngestSwitchCtx): Promise<void> {
  expect(await readSwitch(ctx)).toBe(true);
  expect(await readIngestAudit(ctx)).toEqual([]);
}

/** I1 — the global admin switches it off: the DTO, the row and exactly one platform audit row agree. */
export async function theGlobalAdminSwitchesItOff(ctx: IngestSwitchCtx): Promise<void> {
  const dto = await ctx.svc.setIngestEnabled(ctx.globalAdmin, ctx.fixtureId, false);
  expect(adminOrganizationDtoSchema.parse(dto).ingestEnabled).toBe(false);
  expect(dto.id).toBe(ctx.fixtureId);
  expect(await readSwitch(ctx)).toBe(false);
  expect(await readIngestAudit(ctx)).toEqual([
    { action: "master.organization.ingest.disable", organization_id: null },
  ]);
}

/** I2 — the same value again returns the row and writes nothing: still `false`, no new audit row (R2). */
export async function theSameValueAgainWritesNothing(ctx: IngestSwitchCtx): Promise<void> {
  const before = await readIngestAudit(ctx);
  const dto = await ctx.svc.setIngestEnabled(ctx.globalAdmin, ctx.fixtureId, false);
  expect(dto.ingestEnabled).toBe(false);
  expect(await readSwitch(ctx)).toBe(false);
  expect(await readIngestAudit(ctx)).toEqual(before);
}

/** I3 — switching back on writes one `…ingest.enable` row, also with `organization_id IS NULL`. */
export async function theGlobalAdminSwitchesItBackOn(ctx: IngestSwitchCtx): Promise<void> {
  const dto = await ctx.svc.setIngestEnabled(ctx.globalAdmin, ctx.fixtureId, true);
  expect(dto.ingestEnabled).toBe(true);
  expect(await readSwitch(ctx)).toBe(true);
  expect(await readIngestAudit(ctx)).toEqual([
    { action: "master.organization.ingest.disable", organization_id: null },
    { action: "master.organization.ingest.enable", organization_id: null },
  ]);
}

/**
 * I4 — an `organization_admin` and a `location_admin` are each a 403 (`assertAdminRole`, before
 * any read), the row is unchanged and no audit row is written. Each is tried in both directions.
 */
export async function everyoneButTheGlobalAdminIs403(ctx: IngestSwitchCtx): Promise<void> {
  const before = await readSwitch(ctx);
  const auditBefore = await readIngestAudit(ctx);
  for (const jwt of [ctx.organizationAdmin, ctx.locationAdmin]) {
    for (const value of [false, true]) {
      await expect(ctx.svc.setIngestEnabled(jwt, ctx.fixtureId, value), `${jwt.role} → ${value}`).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  }
  expect(await readSwitch(ctx)).toBe(before);
  expect(await readIngestAudit(ctx)).toEqual(auditBefore);
}

/** I5 — `list` and `getById` carry `ingestEnabled`, and every listed row parses. */
export async function theListAndTheSummaryCarryTheSwitch(ctx: IngestSwitchCtx): Promise<void> {
  const expected = await readSwitch(ctx);
  const { items } = await ctx.svc.list(ctx.globalAdmin, undefined);
  expect(items.find((o) => o.id === ctx.fixtureId)?.ingestEnabled).toBe(expected);
  for (const item of items) expect(adminOrganizationDtoSchema.safeParse(item).success, item.code).toBe(true);
  const summary = adminOrganizationSummaryDtoSchema.parse(await ctx.svc.getById(ctx.globalAdmin, ctx.fixtureId));
  expect(summary.ingestEnabled).toBe(expected);
}

/** The fixture RTU as both producers return it: the list, and `fetchRow` (through `reactivate`). */
async function readRtuDtos(ctx: IngestSwitchCtx) {
  const { items } = await ctx.rtuSvc.list(ctx.globalAdmin, ctx.locationId);
  const listed = adminRtuDtoSchema.parse(items.find((r) => r.id === ctx.rtuId));
  // `reactivate` on an active RTU is a no-op `active = true` whose return value is `fetchRow`.
  const fetched = adminRtuDtoSchema.parse(await ctx.rtuSvc.reactivate(ctx.globalAdmin, ctx.rtuId));
  return { listed, fetched };
}

/**
 * I6 — the RTU DTO's `organizationIngestEnabled` follows the organization (`false` while off,
 * `true` once back on) from both producers, and the RTU's own `ingestEnabled` is untouched by
 * either write (R3, ADR 0115 decision 4).
 */
export async function theRtuDtoFollowsTheOrganization(ctx: IngestSwitchCtx): Promise<void> {
  expect(await readRtuOwnBox(ctx)).toBe(true);

  await ctx.svc.setIngestEnabled(ctx.globalAdmin, ctx.fixtureId, false);
  const off = await readRtuDtos(ctx);
  for (const dto of [off.listed, off.fetched]) {
    expect(dto.organizationIngestEnabled).toBe(false);
    expect(dto.ingestEnabled).toBe(true);
  }
  expect(await readRtuOwnBox(ctx)).toBe(true);

  await ctx.svc.setIngestEnabled(ctx.globalAdmin, ctx.fixtureId, true);
  const on = await readRtuDtos(ctx);
  for (const dto of [on.listed, on.fetched]) {
    expect(dto.organizationIngestEnabled).toBe(true);
    expect(dto.ingestEnabled).toBe(true);
  }
  expect(await readRtuOwnBox(ctx)).toBe(true);
}
