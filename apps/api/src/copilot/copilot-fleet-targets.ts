import { and, count, eq } from "drizzle-orm";

import { assetRoles, type BmsDb, locations, locationTypes, pointKeys } from "@bms/db";
import type { JwtPayload } from "@bms/shared";
import type { CatalogEntry } from "@bms/shared/copilot";

import type { AccessControlService } from "../auth/access-control.service";
import { withTenant } from "../database/tenant-context";
import { CopilotTargetRefusal, mayWriteTelemetry, telemetryRowRefusal } from "./copilot-telemetry-targets";

/**
 * The targets with no organization of their own: they live in the conversation's bound organization (ruling Q1).
 * Not `Extract`: `pointKey` shares its catalog member with the row kinds, so its `kind` is a union that
 * `Extract` would drop; this keeps every member whose `kind` admits one of these four, as `resolve` narrows it.
 */
export type FleetTarget = TargetAdmitting<CatalogEntry["target"], "fleet" | "pointKey" | "vocabulary" | "telemetry">;
type TargetAdmitting<T, K> = T extends { readonly kind: infer Kind } ? (K extends Kind ? T : never) : never;

/** What a fleet target resolved to (a subset of the resolver's `Found`). */
export type FleetFound = { organizationId: string; name: string; usageCount?: number };

/** What the fleet branch borrows from the resolver: its database, its access checks, and two of its own helpers. */
export type FleetTargetContext = {
  readonly tenantDb: BmsDb;
  readonly access: AccessControlService;
  readonly organizationName: (organizationId: string) => Promise<string | null>;
  readonly safely: (check: () => Promise<boolean>) => Promise<boolean>;
};

/**
 * The `fleet`, `pointKey`, `vocabulary` and `telemetry` branch of `CopilotTargetResolver.resolve`,
 * moved out unchanged. `null` is the resolver's one refusal; a telemetry row refusal throws
 * `CopilotTargetRefusal`, its sentence for the model.
 */
export async function resolveFleetTarget(
  context: FleetTargetContext,
  target: FleetTarget,
  params: Readonly<Record<string, string>>,
  body: Readonly<Record<string, unknown>>,
  allowedOrganizationIds: readonly string[],
  user: JwtPayload,
  boundOrganizationId: string | null,
  mode: "propose" | "record",
): Promise<FleetFound | null> {
  let found: FleetFound | null;
  // Ruling Q1: a row with no organization lives in the conversation's bound organization.
  if (boundOrganizationId === null || !allowedOrganizationIds.includes(boundOrganizationId)) return null;
  const organizationName = await context.organizationName(boundOrganizationId);
  if (organizationName === null) return null;
  if (target.kind === "fleet" || target.kind === "telemetry") {
    found = { organizationId: boundOrganizationId, name: organizationName };
  } else if (target.kind === "vocabulary") {
    // `F4.282` (Amendment 8 D2): an unknown code is refused before the gate is asked.
    const code = params[target.param];
    if (code === undefined) return null;
    found = await vocabularyRow(context.tenantDb, target.of, code, allowedOrganizationIds, boundOrganizationId);
  } else {
    const id = params[target.param];
    if (id === undefined) return null;
    const code = await pointKeyCode(context.tenantDb, id);
    found = code === null ? null : { organizationId: boundOrganizationId, name: code };
  }
  // `F4.283` (Amendment 8 D2): the telemetry routes' gate is `requireMasterDataUser`; then (owner ruling
  // 2026-10-25, Q2) every row's asset, as an asset target's, refused with its row numbers before the card.
  const gate = target.kind === "telemetry" ? () => mayWriteTelemetry(context.access, user) : () => mayManageFleet(context.access, user);
  if (found !== null && !(await context.safely(gate))) found = null;
  const rowsIn = found !== null && target.kind === "telemetry" && mode === "propose" ? boundOrganizationId : null;
  const refusal = rowsIn === null ? null : await telemetryRowRefusal(context.tenantDb, context.access, user, body, allowedOrganizationIds, rowsIn);
  if (refusal !== null) throw new CopilotTargetRefusal(refusal);
  return found;
}

/**
 * The point-key routes' check (`point-keys.service.ts` `requireGlobalAdmin`): a master-data user who is a global admin.
 * `F4.282`: also the vocabulary routes' `requireGlobalAdmin` (location types, unit roles).
 */
export async function mayManageFleet(
  access: Pick<AccessControlService, "requireMasterDataUser" | "isGlobalAdmin">,
  user: JwtPayload,
): Promise<boolean> {
  await access.requireMasterDataUser(user);
  return access.isGlobalAdmin(user);
}

/** A point key's code (`bms.point_keys` is fleet-wide and carries no row-level security, migration 0057). */
async function pointKeyCode(tenantDb: BmsDb, id: string): Promise<string | null> {
  const [row] = await tenantDb.select({ code: pointKeys.code }).from(pointKeys).where(eq(pointKeys.id, id)).limit(1);
  return row?.code ?? null;
}

/**
 * `F4.282` (ADR 0099 Amendment 8 D2) — a vocabulary row's label, by code. Both tables are
 * fleet-wide with no row-level security (the `pointKeyCode` precedent; `VocabulariesService`
 * reads them on the tenant pool). A location type also carries how many locations use it,
 * inactive ones included, summed over the turn's allowed organizations under `withTenant` —
 * never outside the turn's scope. A vocabulary target needs a bound conversation, so that is
 * the bound organization's count alone, not the page's fleet-wide OQ4 count: the card names
 * the organization it counted (`locationType.deactivate`'s summary).
 */
async function vocabularyRow(
  tenantDb: BmsDb,
  of: "locationType" | "assetRole",
  code: string,
  allowedOrganizationIds: readonly string[],
  organizationId: string,
): Promise<FleetFound | null> {
  if (of === "assetRole") {
    const [role] = await tenantDb.select({ label: assetRoles.label }).from(assetRoles).where(eq(assetRoles.code, code)).limit(1);
    return role ? { organizationId, name: role.label } : null;
  }
  const [type] = await tenantDb
    .select({ label: locationTypes.label })
    .from(locationTypes)
    .where(eq(locationTypes.code, code))
    .limit(1);
  if (!type) return null;
  let usageCount = 0;
  for (const allowed of allowedOrganizationIds) {
    const [row] = await withTenant(tenantDb, allowed, (tx) =>
      tx
        .select({ n: count(locations.id) })
        .from(locations)
        .where(and(eq(locations.type, code), eq(locations.organizationId, allowed))),
    );
    usageCount += Number(row?.n ?? 0);
  }
  return { organizationId, name: type.label, usageCount };
}
