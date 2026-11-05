import { randomUUID } from "node:crypto";

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { dashboardMimicNodesResponseSchema, type JwtPayload } from "@bms/shared";

import type { MimicLayoutPreviewService } from "./mimic-layout-preview.service";

/**
 * `F4.308` / ADR 0081 Amendment 2 decisions 2 and 3 (plan T3, C2) — `MimicLayoutPreviewService`
 * against a real database, real roles and real row security. Assertions live here;
 * `mimic-layout-preview.integration.test.ts` is the Vitest entry point (ADR 0014) and owns the
 * pools, the fixtures (one layout and one group in each of ESKOM and PHEWB, three planted users)
 * and the cleanup.
 *
 * The order under test: a layout outside the caller's organizations → 404; a group missing or in
 * another organization → 404; a role that is not a layout writer → 403, only after both 404s.
 */

export interface PreviewFixture {
  readonly organizationId: string;
  readonly layoutId: string;
  readonly groupId: string;
}

export type PreviewCtx = {
  service: MimicLayoutPreviewService;
  /** Superuser pool: reads `bms.audit_log` behind the service's back. */
  ownerPool: pg.Pool;
  eskom: PreviewFixture;
  phewb: PreviewFixture;
  globalAdmin: JwtPayload;
  /** `phe-admin@bms.local`: PHEWB's organization admin. */
  phewbOrgAdmin: JwtPayload;
  /** `wc-admin@bms.local`: ESKOM's location admin. */
  eskomLocationAdmin: JwtPayload;
  /** Planted, each with a `user_organization_access` row for ESKOM. */
  eskomOperator: JwtPayload;
  eskomViewer: JwtPayload;
  /** Planted, with a `user_organization_access` row for PHEWB only: ESKOM's layout does not exist for it. */
  phewbOperator: JwtPayload;
};

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the preview to be refused, and it was served");
}

const notFound = (err: unknown): [boolean, string] => [err instanceof NotFoundException, (err as Error).message];

/** P1 — the global `admin` previews ESKOM's layout against ESKOM's group: 200, and the body parses the shared schema. */
export async function assertAdminPreviews(ctx: PreviewCtx): Promise<void> {
  const dto = dashboardMimicNodesResponseSchema.parse(
    await ctx.service.preview(ctx.globalAdmin, ctx.eskom.layoutId, ctx.eskom.groupId),
  );
  expect([dto.dashboardId, dto.widgets.map((widget) => widget.widgetId)]).toEqual([ctx.eskom.layoutId, [ctx.eskom.layoutId]]);
}

/** P2 — an `organization_admin` previews in its own organization: 200. */
export async function assertOrganizationAdminPreviewsInItsOrganization(ctx: PreviewCtx): Promise<void> {
  const dto = dashboardMimicNodesResponseSchema.parse(
    await ctx.service.preview(ctx.phewbOrgAdmin, ctx.phewb.layoutId, ctx.phewb.groupId),
  );
  expect(dto.dashboardId).toBe(ctx.phewb.layoutId);
}

/** P3 — a layout outside the caller's organizations is the 404 "Mimic layout not found". */
export async function assertLayoutOutsideTheCallersOrganizationsIs404(ctx: PreviewCtx): Promise<void> {
  const err = await refusal(ctx.service.preview(ctx.phewbOrgAdmin, ctx.eskom.layoutId, ctx.eskom.groupId));
  expect(notFound(err)).toEqual([true, "Mimic layout not found"]);
}

/** P4 — the global admin, ESKOM's layout, PHEWB's group: 404 "Asset group not found" (the layout and group must share an organization). */
export async function assertGroupOfAnotherOrganizationIs404(ctx: PreviewCtx): Promise<void> {
  const err = await refusal(ctx.service.preview(ctx.globalAdmin, ctx.eskom.layoutId, ctx.phewb.groupId));
  expect(notFound(err)).toEqual([true, "Asset group not found"]);
}

/** P5 — an unknown group id is the same 404. */
export async function assertUnknownGroupIs404(ctx: PreviewCtx): Promise<void> {
  const err = await refusal(ctx.service.preview(ctx.globalAdmin, ctx.eskom.layoutId, randomUUID()));
  expect(notFound(err)).toEqual([true, "Asset group not found"]);
}

/** P6 — `operator`, `viewer` and `location_admin`, each able to read ESKOM's layout and group, are the 403. */
export async function assertNonWritersAre403(ctx: PreviewCtx): Promise<void> {
  const outcomes: [string, boolean][] = [];
  for (const [name, jwt] of [
    ["operator", ctx.eskomOperator],
    ["viewer", ctx.eskomViewer],
    ["location_admin", ctx.eskomLocationAdmin],
  ] as const) {
    const err = await refusal(ctx.service.preview(jwt, ctx.eskom.layoutId, ctx.eskom.groupId));
    outcomes.push([name, err instanceof ForbiddenException]);
  }
  expect(outcomes).toEqual([
    ["operator", true],
    ["viewer", true],
    ["location_admin", true],
  ]);
}

/** P7 — an operator who cannot see the layout gets the 404, not the 403: the 403 would confirm the id. */
export async function assertOperatorWhoCannotSeeTheLayoutIs404(ctx: PreviewCtx): Promise<void> {
  const err = await refusal(ctx.service.preview(ctx.phewbOperator, ctx.eskom.layoutId, ctx.eskom.groupId));
  expect(notFound(err)).toEqual([true, "Mimic layout not found"]);
}

/** P8 — a served and a refused preview write no `bms.audit_log` row for the layout or the group. */
export async function assertPreviewWritesNoAuditRow(ctx: PreviewCtx): Promise<void> {
  const ids = [ctx.eskom.layoutId, ctx.eskom.groupId];
  const count = async (): Promise<number> =>
    (
      await ctx.ownerPool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])",
        [ids],
      )
    ).rows[0]?.n ?? -1;
  const before = await count();
  await ctx.service.preview(ctx.globalAdmin, ctx.eskom.layoutId, ctx.eskom.groupId);
  await refusal(ctx.service.preview(ctx.eskomOperator, ctx.eskom.layoutId, ctx.eskom.groupId));
  expect([before, await count()]).toEqual([0, 0]);
}
