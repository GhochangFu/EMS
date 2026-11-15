import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import { adminOrganizationDtoSchema, setOrganizationEnergySettingsBodySchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { createOrganizationBodySchema, updateOrganizationBodySchema } from "./organizations.schema";
import type { OrganizationsAdminService } from "./organizations.service";

/**
 * `F4.364` (ADR 0133 decision 6) and `F4.375` (Amendment 2 ruling 3, plan-gate ruling Q6, plan
 * U8, D11) — `energy_features` and `card_primary_metric` on their one write path,
 * `PUT /admin/organizations/:id/energy-settings`, against the real database: the global admin sets
 * any organization; an `organization_admin` sets one they hold a direct grant on and no other; a
 * `location_admin` is refused; the audit row is `master.organization.energy_settings.update` with
 * the organization's id and a `from` / `to` payload; an unchanged write writes nothing; `PATCH`
 * leaves both columns alone.
 *
 * Read-backs run as `bms_fleet`. The one seeded organization a case writes (I4, the organization
 * admin's own) is put back, with that case's audit rows removed, in a `finally`. Assertions live
 * here; the sibling `.test.ts` owns the pools, the service and the `afterAll` delete.
 */
export type EnergyCtx = {
  svc: OrganizationsAdminService;
  fleetPool: pg.Pool;
  adminJwt: JwtPayload;
  organizationAdminJwt: JwtPayload;
  locationAdminJwt: JwtPayload;
  /** The seeded organization the organization admin holds a direct grant on. */
  grantedOrganizationId: string;
  register: (id: string) => void;
  family: string;
};

const ACTION = "master.organization.energy_settings.update";

type Row = { energy_features: string; card_primary_metric: string };

async function create(ctx: EnergyCtx, suffix: string): Promise<string> {
  return (await createDto(ctx, suffix)).id;
}

async function createDto(ctx: EnergyCtx, suffix: string): Promise<Awaited<ReturnType<OrganizationsAdminService["create"]>>> {
  const created = await ctx.svc.create(
    ctx.adminJwt,
    createOrganizationBodySchema.parse({ code: `${ctx.family}-${suffix}`, name: `F4.375 ${suffix}`, currency: "INR" }),
  );
  ctx.register(created.id);
  return created;
}

async function readRow(ctx: EnergyCtx, id: string): Promise<Row> {
  const { rows } = await ctx.fleetPool.query<Row>(
    "SELECT energy_features, card_primary_metric FROM bms.organizations WHERE id = $1",
    [id],
  );
  const row = rows[0];
  expect(row, `organization ${id} must exist`).toBeDefined();
  return row as Row;
}

/** This action's audit rows for one organization, oldest first — counted by entity and action, never a lifetime total. */
async function auditRows(
  ctx: EnergyCtx,
  id: string,
): Promise<{ organization_id: string | null; payload: Record<string, unknown> }[]> {
  const { rows } = await ctx.fleetPool.query<{ organization_id: string | null; payload: Record<string, unknown> }>(
    `SELECT organization_id, payload FROM bms.audit_log
      WHERE entity_type = 'organization' AND entity_id = $1 AND action = $2
      ORDER BY created_at, id`,
    [id, ACTION],
  );
  return rows;
}

function body(energyFeatures: string, cardPrimaryMetric: string) {
  return setOrganizationEnergySettingsBodySchema.parse({ energyFeatures, cardPrimaryMetric });
}

/** I1 — a created organization reads `auto` / `auto` on the DTO and the row. */
export async function aCreatedOrganizationReadsAuto(ctx: EnergyCtx): Promise<void> {
  const created = await createDto(ctx, "I1");
  expect(adminOrganizationDtoSchema.parse(created)).toMatchObject({ energyFeatures: "auto", cardPrimaryMetric: "auto" });
  expect(await readRow(ctx, created.id)).toEqual({ energy_features: "auto", card_primary_metric: "auto" });
}

/** I2 — the global admin sets any organization; the DTO and the row agree. */
export async function theGlobalAdminSetsAnyOrganization(ctx: EnergyCtx): Promise<void> {
  const id = await create(ctx, "I2");
  const dto = await ctx.svc.setEnergySettings(ctx.adminJwt, id, body("off", "critical_alarms"));
  expect(dto).toMatchObject({ id, energyFeatures: "off", cardPrimaryMetric: "critical_alarms" });
  expect(await readRow(ctx, id)).toEqual({ energy_features: "off", card_primary_metric: "critical_alarms" });
}

/** I3 — the audit row: this action, the organization's id, and `from` / `to` with both keys. */
export async function theAuditRowCarriesTheOrganizationAndFromTo(ctx: EnergyCtx): Promise<void> {
  const id = await create(ctx, "I3");
  await ctx.svc.setEnergySettings(ctx.adminJwt, id, body("on", "kw"));
  const rows = await auditRows(ctx, id);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.organization_id).toBe(id);
  expect(rows[0]?.payload).toEqual({
    from: { energyFeatures: "auto", cardPrimaryMetric: "auto" },
    to: { energyFeatures: "on", cardPrimaryMetric: "kw" },
  });
}

/** I4 — ruling 3: an `organization_admin` with a direct grant sets their own organization. Restored in `finally`. */
export async function anOrganizationAdminSetsTheirOwnOrganization(ctx: EnergyCtx): Promise<void> {
  const id = ctx.grantedOrganizationId;
  const before = await readRow(ctx, id);
  const { rows: mark } = await ctx.fleetPool.query<{ at: string }>("SELECT now()::text AS at");
  const target = before.energy_features === "off" ? "on" : "off";
  try {
    const dto = await ctx.svc.setEnergySettings(ctx.organizationAdminJwt, id, body(target, before.card_primary_metric));
    expect(dto).toMatchObject({ energyFeatures: target, cardPrimaryMetric: before.card_primary_metric });
    expect(await readRow(ctx, id)).toEqual({ energy_features: target, card_primary_metric: before.card_primary_metric });
  } finally {
    await ctx.fleetPool.query(
      "UPDATE bms.organizations SET energy_features = $2, card_primary_metric = $3 WHERE id = $1",
      [id, before.energy_features, before.card_primary_metric],
    );
    await ctx.fleetPool.query(
      `DELETE FROM bms.audit_log WHERE entity_type = 'organization' AND entity_id = $1 AND action = $2 AND created_at >= $3::timestamptz`,
      [id, ACTION, mark[0]?.at],
    );
  }
}

/** I5 — an `organization_admin` with no grant on the organization: 403, row unchanged, no audit row. */
export async function anOrganizationAdminWithoutAGrantIsRefused(ctx: EnergyCtx): Promise<void> {
  const id = await create(ctx, "I5");
  await expect(ctx.svc.setEnergySettings(ctx.organizationAdminJwt, id, body("off", "health"))).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  expect(await readRow(ctx, id)).toEqual({ energy_features: "auto", card_primary_metric: "auto" });
  expect(await auditRows(ctx, id)).toHaveLength(0);
}

/** I6 — a `location_admin` is refused (403); the row is unchanged. */
export async function aLocationAdminIsRefused(ctx: EnergyCtx): Promise<void> {
  const id = await create(ctx, "I6");
  await expect(ctx.svc.setEnergySettings(ctx.locationAdminJwt, id, body("on", "kw"))).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  expect(await readRow(ctx, id)).toEqual({ energy_features: "auto", card_primary_metric: "auto" });
}

/**
 * I7 — an unchanged write returns the row and writes nothing: no audit row for this organization.
 * A write that changes only the card figure is not "unchanged": it is written and audited.
 */
export async function anUnchangedWriteWritesNothing(ctx: EnergyCtx): Promise<void> {
  const id = await create(ctx, "I7");
  await ctx.svc.setEnergySettings(ctx.adminJwt, id, body("off", "health"));
  expect(await auditRows(ctx, id)).toHaveLength(1);
  const again = await ctx.svc.setEnergySettings(ctx.adminJwt, id, body("off", "health"));
  expect(again).toMatchObject({ energyFeatures: "off", cardPrimaryMetric: "health" });
  expect(await auditRows(ctx, id)).toHaveLength(1);
  const cardOnly = await ctx.svc.setEnergySettings(ctx.adminJwt, id, body("off", "kw"));
  expect(cardOnly).toMatchObject({ energyFeatures: "off", cardPrimaryMetric: "kw" });
  expect(await readRow(ctx, id)).toEqual({ energy_features: "off", card_primary_metric: "kw" });
  expect(await auditRows(ctx, id)).toHaveLength(2);
}

/** I8 — Q6: a `PATCH` of `name` leaves both columns as they are. */
export async function aPatchLeavesBothColumns(ctx: EnergyCtx): Promise<void> {
  const id = await create(ctx, "I8");
  await ctx.svc.setEnergySettings(ctx.adminJwt, id, body("on", "none"));
  const renamed = await ctx.svc.update(ctx.adminJwt, id, updateOrganizationBodySchema.parse({ name: "F4.375 I8 renamed" }));
  expect(renamed).toMatchObject({ name: "F4.375 I8 renamed", energyFeatures: "on", cardPrimaryMetric: "none" });
  expect(await readRow(ctx, id)).toEqual({ energy_features: "on", card_primary_metric: "none" });
}

/** I9 — an unknown id: the global admin gets 404; an organization admin gets 403 (no existence oracle). */
export async function anUnknownIdIsNotAnOracle(ctx: EnergyCtx): Promise<void> {
  const unknown = "00000000-0000-4000-8000-0000000f4375";
  await expect(ctx.svc.setEnergySettings(ctx.adminJwt, unknown, body("on", "kw"))).rejects.toBeInstanceOf(
    NotFoundException,
  );
  await expect(ctx.svc.setEnergySettings(ctx.organizationAdminJwt, unknown, body("on", "kw"))).rejects.toBeInstanceOf(
    ForbiddenException,
  );
}
