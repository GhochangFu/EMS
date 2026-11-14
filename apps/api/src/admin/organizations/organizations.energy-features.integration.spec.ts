import { ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import { adminOrganizationDtoSchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { createOrganizationBodySchema, updateOrganizationBodySchema } from "./organizations.schema";
import type { OrganizationsAdminService } from "./organizations.service";

/**
 * `F4.364` (ADR 0133 decision 6, plan U9 and ruling Q2) — `energy_features` and
 * `card_primary_metric` on the organization admin write path, against the real database: the
 * global admin's `PATCH` sets and keeps them, the audit row is `master.organization.update` with
 * `organization_id` NULL and both keys in its payload, and an `organization_admin` is refused.
 *
 * Read-backs run as `bms_fleet`. Assertions live here; the sibling `.test.ts` owns the pools, the
 * service and the `afterAll` delete (the `organizations.currency.integration` shape).
 */
export type EnergyCtx = {
  svc: OrganizationsAdminService;
  fleetPool: pg.Pool;
  adminJwt: JwtPayload;
  organizationAdminJwt: JwtPayload;
  /** The seeded organization the organization admin holds a direct grant on (PHEWB). */
  grantedOrganizationId: string;
  register: (id: string) => void;
  family: string;
};

async function create(ctx: EnergyCtx, suffix: string): Promise<string> {
  const created = await ctx.svc.create(
    ctx.adminJwt,
    createOrganizationBodySchema.parse({ code: `${ctx.family}-${suffix}`, name: `F4.364 ${suffix}`, currency: "INR" }),
  );
  ctx.register(created.id);
  return created.id;
}

async function readRow(ctx: EnergyCtx, id: string): Promise<{ energy_features: string; card_primary_metric: string }> {
  const { rows } = await ctx.fleetPool.query<{ energy_features: string; card_primary_metric: string }>(
    "SELECT energy_features, card_primary_metric FROM bms.organizations WHERE id = $1",
    [id],
  );
  const row = rows[0];
  expect(row, `organization ${id} must exist`).toBeDefined();
  return row as { energy_features: string; card_primary_metric: string };
}

/** I1 — a created organization reads `auto` / `auto` on the DTO and the row. */
export async function aCreatedOrganizationReadsAuto(ctx: EnergyCtx): Promise<void> {
  const id = await create(ctx, "I1");
  const listed = await ctx.svc.update(ctx.adminJwt, id, updateOrganizationBodySchema.parse({}));
  expect(adminOrganizationDtoSchema.parse(listed)).toMatchObject({ energyFeatures: "auto", cardPrimaryMetric: "auto" });
  expect(await readRow(ctx, id)).toEqual({ energy_features: "auto", card_primary_metric: "auto" });
}

/** I2 — the admin's `PATCH` sets both; the DTO returns them; a later `PATCH` without them keeps them. */
export async function anAdminPatchSetsAndKeepsBoth(ctx: EnergyCtx): Promise<void> {
  const id = await create(ctx, "I2");
  const set = await ctx.svc.update(
    ctx.adminJwt,
    id,
    updateOrganizationBodySchema.parse({ energyFeatures: "off", cardPrimaryMetric: "critical_alarms" }),
  );
  expect(set).toMatchObject({ energyFeatures: "off", cardPrimaryMetric: "critical_alarms" });
  expect(await readRow(ctx, id)).toEqual({ energy_features: "off", card_primary_metric: "critical_alarms" });

  const kept = await ctx.svc.update(ctx.adminJwt, id, updateOrganizationBodySchema.parse({ name: "F4.364 I2 renamed" }));
  expect(kept).toMatchObject({ name: "F4.364 I2 renamed", energyFeatures: "off", cardPrimaryMetric: "critical_alarms" });
  expect(await readRow(ctx, id)).toEqual({ energy_features: "off", card_primary_metric: "critical_alarms" });
}

/** I3 — the audit row: `master.organization.update`, `organization_id` NULL, payload with both keys. */
export async function theAuditRowCarriesBothKeys(ctx: EnergyCtx): Promise<void> {
  const id = await create(ctx, "I3");
  await ctx.svc.update(ctx.adminJwt, id, updateOrganizationBodySchema.parse({ energyFeatures: "on", cardPrimaryMetric: "kw" }));
  const { rows } = await ctx.fleetPool.query<{ action: string; organization_id: string | null; payload: Record<string, unknown> }>(
    `SELECT action, organization_id, payload FROM bms.audit_log
      WHERE entity_type = 'organization' AND entity_id = $1 AND action = 'master.organization.update'`,
    [id],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.organization_id).toBeNull();
  expect(rows[0]?.payload).toMatchObject({ energyFeatures: "on", cardPrimaryMetric: "kw" });
}

/** I4 — Q2: an `organization_admin` with a direct grant is refused (403) and the row is unchanged. */
export async function anOrganizationAdminIsRefused(ctx: EnergyCtx): Promise<void> {
  const before = await readRow(ctx, ctx.grantedOrganizationId);
  await expect(
    ctx.svc.update(
      ctx.organizationAdminJwt,
      ctx.grantedOrganizationId,
      updateOrganizationBodySchema.parse({ energyFeatures: before.energy_features === "off" ? "on" : "off" }),
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(await readRow(ctx, ctx.grantedOrganizationId)).toEqual(before);
}
