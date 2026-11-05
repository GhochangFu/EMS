import { and, eq, inArray } from "drizzle-orm";

import { assets, assetTemplates } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { TEMPLATE_ADOPTION_MAX_ASSETS, type JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { withTenant } from "../database/tenant-context";

/**
 * `F4.312` PR 2 (ADR 0099 Amendment 12) — the reads and the gate behind the
 * resolver's `assetTemplateAdopt` target, kept out of
 * `copilot-target-resolver.ts` for the AGENTS.md §4.5 line cap (the
 * `copilot-calc-point-targets.ts` shape).
 *
 * The target mirrors `AssetTemplateAdoptionService.buildPlan`'s access chain
 * (migrate's, ADR 0109 Amendment 1 A10) and the planner's batch-level
 * refusals, so a card the route could only refuse is never shown. Every
 * failure is the one refusal (`null`, decision 10); the route names each
 * refused asset on Confirm, and its point-level refusals (A4, A8, …) stay a
 * Confirm-time 409.
 */

/** The access checks the adopt gate asks; specs pass a fake. */
export type AdoptAccess = Pick<AccessControlService, "requireMasterDataUser" | "canManageOrganization" | "writableLocationIds">;

/** A listed asset as the target reads it: only what the batch-level checks need. */
export type AdoptAssetRow = {
  readonly id: string;
  readonly organizationId: string;
  readonly domain: string;
  readonly templateId: string | null;
  readonly locationId: string | null;
};

/** The version the path names, as the target reads it. */
export type AdoptTemplateRow = {
  readonly organizationId: string;
  readonly name: string;
  readonly domain: string;
  readonly status: string;
};

/**
 * The body's `assetIds`, or `null` when it is not a non-empty array of at most
 * `TEMPLATE_ADOPTION_MAX_ASSETS` strings with none twice — refused before any
 * read, as the body schema refuses it at the route.
 */
export function adoptAssetIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > TEMPLATE_ADOPTION_MAX_ASSETS) return null;
  if (ids.some((id) => typeof id !== "string")) return null;
  const assetIds = ids as string[];
  return new Set(assetIds).size === assetIds.length ? assetIds : null;
}

/**
 * Whether the read rows admit the batch: every listed id was found (a row of
 * another organization is never read, so it is missing here), and each row is
 * of the version's organization and domain (A1), pinned to no template, and at
 * a site in the caller's write scope (`writable`, `null` for a global
 * administrator) — the route's `F4.64` count refusal.
 */
export function adoptBatchAdmits(
  template: Pick<AdoptTemplateRow, "organizationId" | "domain">,
  assetIds: readonly string[],
  rows: readonly AdoptAssetRow[],
  writable: readonly string[] | null,
): boolean {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return assetIds.every((id) => {
    const row = byId.get(id);
    if (row === undefined) return false;
    if (row.organizationId !== template.organizationId || row.domain !== template.domain) return false;
    if (row.templateId !== null) return false;
    return writable === null || (row.locationId !== null && writable.includes(row.locationId));
  });
}

/**
 * The version `templateId` names, looked for in each allowed organization in
 * turn under `withTenant` with an explicit organization filter, or `null` when
 * none holds it. Its status is returned, not judged: {@link resolveAdoptTarget}
 * refuses an unpublished one.
 */
export async function findAdoptTemplate(
  tenantDb: BmsDb,
  templateId: string,
  allowed: readonly string[],
): Promise<AdoptTemplateRow | null> {
  for (const organizationId of allowed) {
    const [row] = await withTenant(tenantDb, organizationId, (tx) =>
      tx
        .select({ name: assetTemplates.name, domain: assetTemplates.domain, status: assetTemplates.status })
        .from(assetTemplates)
        .where(and(eq(assetTemplates.id, templateId), eq(assetTemplates.organizationId, organizationId)))
        .limit(1),
    );
    if (row) return { organizationId, ...row };
  }
  return null;
}

/** The listed assets of the version's organization, under `withTenant` with an explicit organization filter. */
async function readAdoptAssets(tenantDb: BmsDb, organizationId: string, assetIds: readonly string[]): Promise<AdoptAssetRow[]> {
  return withTenant(tenantDb, organizationId, (tx) =>
    tx
      .select({
        id: assets.id,
        organizationId: assets.organizationId,
        domain: assets.domain,
        templateId: assets.templateId,
        locationId: assets.locationId,
      })
      .from(assets)
      .where(and(inArray(assets.id, [...assetIds]), eq(assets.organizationId, organizationId))),
  );
}

/**
 * The `assetTemplateAdopt` target: the version and its organization, or
 * `null`. The order is the route's: the body's ids (before any read, as the
 * body schema refuses them); the version in the allowed set; the gate —
 * `requireMasterDataUser`, then `canManageOrganization` on the version's
 * organization (an access check that throws is a refusal, the resolver's
 * `safely`); published (409 at the route); then the listed assets
 * ({@link adoptBatchAdmits}, with `writableLocationIds`).
 *
 * `checkAssets: false` is the resolver's `"record"` mode: an open wizard's
 * record is the version, and the assets are what a fill is about to set.
 */
export async function resolveAdoptTarget(
  tenantDb: BmsDb,
  access: AdoptAccess,
  user: JwtPayload,
  templateId: string,
  ids: unknown,
  allowed: readonly string[],
  checkAssets = true,
): Promise<{ organizationId: string; name: string } | null> {
  const assetIds = checkAssets ? adoptAssetIds(ids) : [];
  if (assetIds === null) return null;
  const template = await findAdoptTemplate(tenantDb, templateId, allowed);
  if (template === null) return null;
  if (!(await falseOnThrow(() => mayManageVersion(access, user, template.organizationId)))) return null;
  if (template.status !== "published") return null;
  if (!checkAssets) return { organizationId: template.organizationId, name: template.name };
  const rows = await readAdoptAssets(tenantDb, template.organizationId, assetIds);
  const writable = await falseOnThrow(() => access.writableLocationIds(user));
  if (writable === false || !adoptBatchAdmits(template, assetIds, rows, writable)) return null;
  return { organizationId: template.organizationId, name: template.name };
}

/** The route's first two checks: `requireMasterDataUser` (a throw), then `canManageOrganization`. */
async function mayManageVersion(access: AdoptAccess, user: JwtPayload, organizationId: string): Promise<boolean> {
  await access.requireMasterDataUser(user);
  return access.canManageOrganization(user, organizationId);
}

/** An access check's answer, or `false` when it throws (a 403 is the one refusal). */
async function falseOnThrow<T>(check: () => Promise<T>): Promise<T | false> {
  try {
    return await check();
  } catch {
    return false;
  }
}
