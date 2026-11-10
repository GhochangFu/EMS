import { ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import { adminOrganizationDtoSchema, currentUserResponseSchema } from "@bms/shared";
import type { ColourProfile, JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import type { OrganizationsAdminService } from "./organizations.service";

/**
 * `F4.310` / ADR 0110 decisions 4, 6 and 7 (plan OQ4) — the colour-profile write and the
 * `/auth/me` read, against the real database.
 *
 * Assertions live here; `organizations.colour-profile.integration.test.ts` owns the pools, the
 * fixture organization and the `afterAll` cleanup (ADR 0014). One exported function per claim.
 *
 * **Read-backs run as `bms_fleet`** (the `organizations.currency` habit). The one seeded
 * organization a claim writes to (the organization admin's own, C4) is put back to its value
 * before the claim returns, in a `finally`, so a shared database keeps its colours.
 */
export type ColourProfileCtx = {
  svc: OrganizationsAdminService;
  access: AccessControlService;
  fleetPool: pg.Pool;
  globalAdmin: JwtPayload;
  organizationAdmin: JwtPayload;
  locationAdmin: JwtPayload;
  /** A fixture organization no seeded organization admin holds a grant on. */
  fixtureId: string;
  /** The organization admin's own organization (a direct grant and the home organization). */
  ownOrgId: string;
};

async function readProfile(ctx: ColourProfileCtx, id: string): Promise<string | null | undefined> {
  const { rows } = await ctx.fleetPool.query<{ colour_profile: string | null }>(
    "SELECT colour_profile FROM bms.organizations WHERE id = $1",
    [id],
  );
  return rows[0]?.colour_profile;
}

/**
 * C0 — a new organization starts empty: since `F4.341` (migration 0134) the column has no default,
 * so it inherits the portal default (ADR 0118 decision 9). Organizations that existed before keep
 * their stored value.
 */
export async function aNewOrganizationStartsOnNexus(ctx: ColourProfileCtx): Promise<void> {
  expect(await readProfile(ctx, ctx.fixtureId)).toBeNull();
}

/** C1 — the global admin sets any organization: the DTO, the row and one audit row agree. */
export async function theGlobalAdminSetsAnyOrganization(ctx: ColourProfileCtx): Promise<void> {
  const dto = await ctx.svc.setColourProfile(ctx.globalAdmin, ctx.fixtureId, "ocean");
  expect(adminOrganizationDtoSchema.parse(dto).colourProfile).toBe("ocean");
  expect(await readProfile(ctx, ctx.fixtureId)).toBe("ocean");
  const { rows } = await ctx.fleetPool.query<{ organization_id: string | null; payload: unknown }>(
    `SELECT organization_id, payload FROM bms.audit_log
      WHERE action = 'master.organization.colour_profile.update' AND entity_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [ctx.fixtureId],
  );
  expect(rows[0]?.organization_id, "the audit row carries the organization").toBe(ctx.fixtureId);
  expect(rows[0]?.payload).toMatchObject({ from: null, to: "ocean" });
}

/** C2 — an organization admin with no grant on the organization is a 403; the row is unchanged. */
export async function anOrganizationAdminWithoutAGrantIs403(ctx: ColourProfileCtx): Promise<void> {
  const before = await readProfile(ctx, ctx.fixtureId);
  await expect(ctx.svc.setColourProfile(ctx.organizationAdmin, ctx.fixtureId, "lagoon")).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  expect(await readProfile(ctx, ctx.fixtureId)).toBe(before);
}

/** C3 — a location admin is a 403 (the role alone refuses it; no grant is read). */
export async function aLocationAdminIs403(ctx: ColourProfileCtx): Promise<void> {
  await expect(ctx.svc.setColourProfile(ctx.locationAdmin, ctx.fixtureId, "lagoon")).rejects.toBeInstanceOf(
    ForbiddenException,
  );
}

/**
 * C4 — the organization admin sets its own organization, and `/auth/me` then names that profile
 * for it (unless the user chose their own); the global admin's `/auth/me` follows the portal row
 * (no home organization), whatever a sibling suite has set it to.
 */
export async function theOrganizationAdminSetsItsOwnAndMeFollows(ctx: ColourProfileCtx): Promise<void> {
  const original = (await readProfile(ctx, ctx.ownOrgId)) as ColourProfile;
  const target: ColourProfile = original === "graphite" ? "indigo" : "graphite";
  try {
    const dto = await ctx.svc.setColourProfile(ctx.organizationAdmin, ctx.ownOrgId, target);
    expect(dto.colourProfile).toBe(target);
    const me = currentUserResponseSchema.parse(await ctx.access.currentUser(ctx.organizationAdmin));
    if (me.appearance.colourProfile.from !== "user") {
      expect(me.colourProfile).toBe(target);
      expect(me.appearance.colourProfile).toEqual({ value: target, from: "organization" });
    }
    const admin = currentUserResponseSchema.parse(await ctx.access.currentUser(ctx.globalAdmin));
    expect(admin.colourProfile).toBe(admin.appearance.colourProfile.value);
    expect(admin.appearance.colourProfile.from).not.toBe("organization");
  } finally {
    await ctx.fleetPool.query("UPDATE bms.organizations SET colour_profile = $2 WHERE id = $1", [
      ctx.ownOrgId,
      original,
    ]);
  }
}

/** C5 — the CHECK refuses a name outside the list (Postgres, not only the API). */
export async function theCheckRefusesAnUnknownName(ctx: ColourProfileCtx): Promise<void> {
  await expect(
    ctx.fleetPool.query("UPDATE bms.organizations SET colour_profile = 'teal' WHERE id = $1", [ctx.fixtureId]),
  ).rejects.toThrow(/organizations_colour_profile_check/);
}

/** C6 — the list DTO carries `colourProfile` for every row. */
export async function theListCarriesTheProfile(ctx: ColourProfileCtx): Promise<void> {
  const { items } = await ctx.svc.list(ctx.globalAdmin, undefined);
  const fixture = items.find((o) => o.id === ctx.fixtureId);
  expect(fixture?.colourProfile).toBe("ocean");
  for (const item of items) expect(adminOrganizationDtoSchema.safeParse(item).success, item.code).toBe(true);
}
