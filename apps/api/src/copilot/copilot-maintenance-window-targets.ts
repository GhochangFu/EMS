import { ForbiddenException } from "@nestjs/common";
import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { assets, automationRules, locations, maintenanceWindows, maintenanceWindowTargets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { type JwtPayload, type MaintenanceWindowState, type MaintenanceWindowTarget, maintenanceWindowTargetSchema } from "@bms/shared";
import type { CatalogEntry, CatalogSummaryInput } from "@bms/shared/copilot";

import type { AccessControlService } from "../auth/access-control.service";
import { expandLocationSubtrees } from "../auth/location-tree";
import { withTenant } from "../database/tenant-context";
import { compareWindowTargets } from "../maintenance-windows/maintenance-window-target-order";
import {
  everyTargetInScope,
  type MaintenanceWindowReadScope,
  readScopeFor,
  type ResolvedTarget as WindowScopeTarget,
  targetInScope,
  windowStateSql,
} from "../maintenance-windows/maintenance-window-scope";

/**
 * `F4.359` PR 6 (ADR 0099 Amendment 19 decisions 2, 3, 7) — the resolver's
 * `maintenanceWindow` target, kept out of `copilot-target-resolver.ts` for the
 * AGENTS.md §4.5 line cap (the `copilot-rule-targets.ts` precedent).
 *
 * **One authority.** The gate is the window routes' own, in their order: the
 * `configuration` role class (`assertOperationsWriteRole`, a throw is a
 * refusal), then the caller's window scope (`readScopeFor`) and the routes'
 * scope check — `targetInScope` for each target of a create, `everyTargetInScope`
 * for the window an extend, end or cancel names (D15). The location rule is
 * that file's: only an unrestricted, location- or organization-sourced scope
 * may name a location target (`subtreeLocationIds`), so an asset-group admin
 * names none. Nothing here restates it.
 *
 * Rows are read only inside the turn's allowed organizations, each under
 * `withTenant` with an explicit organization filter. A create's targets must
 * all be rows of the **first** allowed organization that holds any of them (the
 * route refuses targets of two organizations); a target that is in none, out
 * of scope, or of another organization is one refusal (`null`). The route
 * checks all of it again at Confirm, with its period rule and its 409s.
 */

/** A target row as the routes' scope check takes it, with the name the card shows. */
export type LabelledWindowTarget = WindowScopeTarget & { readonly label: string };

/** A stored window, its state on the database clock (ADR 0131 D2), and every one of its targets. */
export type StoredWindow = {
  readonly id: string;
  readonly organizationId: string;
  readonly reason: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly state: MaintenanceWindowState;
  readonly targets: readonly LabelledWindowTarget[];
};

/** The three reads behind the target; specs pass a fake, the resolver {@link tenantWindowReads}. */
export interface MaintenanceWindowReads {
  /** The rows of this one organization the body's targets name (a rule with its asset). */
  targetsIn(organizationId: string, input: readonly MaintenanceWindowTarget[]): Promise<LabelledWindowTarget[]>;
  /** The assets at or under these locations of the organization (decision 3, Q5). */
  coveredAssetCount(organizationId: string, locationIds: readonly string[]): Promise<number>;
  /** The window of this organization with this id, or `null`. */
  windowIn(organizationId: string, id: string): Promise<StoredWindow | null>;
}

/** What the card shows of the window (`CatalogSummaryInput.maintenanceWindow`), and its state for the propose check. */
export type MaintenanceWindowCard = NonNullable<CatalogSummaryInput["maintenanceWindow"]> & {
  /** `null` for a create, which names no window yet. */
  readonly state: MaintenanceWindowState | null;
};

export type MaintenanceWindowFound = { organizationId: string; name: string; maintenanceWindow: MaintenanceWindowCard };

type WindowAccess = Pick<AccessControlService, "assertOperationsWriteRole" | "isGlobalAdmin" | "currentUser" | "readableOrganizationIds">;
type WindowTarget = Extract<CatalogEntry["target"], { kind: "maintenanceWindow" }>;

/** Decision 1: a window is named by its reason, cut at 80 characters (code points). */
export const WINDOW_NAME_MAX = 80;

function windowName(reason: string): string {
  const points = [...reason];
  return points.length > WINDOW_NAME_MAX ? `${points.slice(0, WINDOW_NAME_MAX).join("")}...` : reason;
}

const targetsSchema = z.array(maintenanceWindowTargetSchema).min(1);
const idOf = (target: MaintenanceWindowTarget): string =>
  (target.kind === "asset" ? target.assetId : target.kind === "location" ? target.locationId : target.ruleId).toLowerCase();
const keyOf = (kind: string, id: string): string => `${kind}:${id}`;
const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * The routes' gate, in their order: the role class first (ADR 0017), then the scope. The routes'
 * refusal (a `ForbiddenException`) is a refusal; anything else, a database failure in the scope
 * read, is thrown, never a silent "target refused" (review of PR 6).
 */
async function windowScope(access: WindowAccess, user: JwtPayload): Promise<MaintenanceWindowReadScope | null> {
  try {
    await access.assertOperationsWriteRole(user, "configuration");
    return await readScopeFor(access, user);
  } catch (error) {
    if (error instanceof ForbiddenException) return null;
    throw error;
  }
}

/** The location targets' labels and the assets they cover (Q5). */
async function cover(reads: MaintenanceWindowReads, organizationId: string, targets: readonly LabelledWindowTarget[]) {
  const nodes = targets.filter((target) => target.kind === "location");
  const coveredAssetCount = nodes.length === 0 ? 0 : await reads.coveredAssetCount(organizationId, nodes.map((node) => node.id));
  return { locationLabels: nodes.map((node) => node.label), coveredAssetCount };
}

async function resolveCreate(
  reads: MaintenanceWindowReads,
  scope: MaintenanceWindowReadScope,
  raw: unknown,
  body: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): Promise<MaintenanceWindowFound | null> {
  const parsed = targetsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const wanted = [...new Set(parsed.data.map((target) => keyOf(target.kind, idOf(target))))];
  for (const organizationId of allowed) {
    const rows = await reads.targetsIn(organizationId, parsed.data);
    if (rows.length === 0) continue;
    // Some here and some elsewhere (two organizations), or one that is nowhere: the route refuses both.
    if (rows.length !== wanted.length || !rows.every((row) => targetInScope(row, scope))) return null;
    const byKey = new Map(rows.map((row) => [keyOf(row.kind, row.id.toLowerCase()), row]));
    const ordered = wanted.flatMap((key) => {
      const row = byKey.get(key);
      return row === undefined ? [] : [row];
    });
    if (ordered.length !== wanted.length) return null;
    const targetLabels = ordered.map((row) => row.label);
    return {
      organizationId,
      name: windowName(targetLabels.join(", ")),
      maintenanceWindow: {
        reason: stringOrNull(body.reason) ?? "",
        startsAt: stringOrNull(body.startsAt),
        endsAt: stringOrNull(body.endsAt),
        targetLabels,
        ...(await cover(reads, organizationId, ordered)),
        state: null,
      },
    };
  }
  return null;
}

async function resolveRow(
  reads: MaintenanceWindowReads,
  scope: MaintenanceWindowReadScope,
  id: string | undefined,
  allowed: readonly string[],
): Promise<MaintenanceWindowFound | null> {
  if (id === undefined) return null;
  for (const organizationId of allowed) {
    const window = await reads.windowIn(organizationId, id);
    if (window === null) continue;
    // D15: every target in scope; a window with none is refused (`everyTargetInScope` of nothing is false).
    if (!everyTargetInScope(window.targets, scope)) return null;
    // `F4.362` review: the page list's order, so the card and the page Review name the targets alike.
    const targets = [...window.targets].sort(compareWindowTargets);
    return {
      organizationId,
      name: windowName(window.reason),
      maintenanceWindow: {
        reason: window.reason,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        targetLabels: targets.map((target) => target.label),
        ...(await cover(reads, organizationId, targets)),
        state: window.state,
      },
    };
  }
  return null;
}

/** The `maintenanceWindow` target: the routes' gate, then the create's targets or the named window (see the file header). */
export async function resolveMaintenanceWindowTarget(
  reads: MaintenanceWindowReads,
  access: WindowAccess,
  user: JwtPayload,
  target: WindowTarget,
  params: Readonly<Record<string, string>>,
  body: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): Promise<MaintenanceWindowFound | null> {
  const scope = await windowScope(access, user);
  if (scope === null) return null;
  return "field" in target ? resolveCreate(reads, scope, body[target.field], body, allowed) : resolveRow(reads, scope, params[target.param], allowed);
}

/** The reads on the tenant pool: one `withTenant` transaction per organization, each filtered on it as well. */
export function tenantWindowReads(db: BmsDb): MaintenanceWindowReads {
  return {
    targetsIn: (organizationId, input) =>
      withTenant(db, organizationId, async (tx) => {
        const ids = (kind: MaintenanceWindowTarget["kind"]): string[] => [
          ...new Set(input.filter((target) => target.kind === kind).map(idOf)),
        ];
        const [assetIds, locationIds, ruleIds] = [ids("asset"), ids("location"), ids("rule")];
        const assetRows =
          assetIds.length === 0
            ? []
            : await tx
                .select({ id: assets.id, label: assets.name })
                .from(assets)
                .where(and(inArray(assets.id, assetIds), eq(assets.organizationId, organizationId)));
        const locationRows =
          locationIds.length === 0
            ? []
            : await tx
                .select({ id: locations.id, label: locations.name })
                .from(locations)
                .where(and(inArray(locations.id, locationIds), eq(locations.organizationId, organizationId)));
        const ruleRows =
          ruleIds.length === 0
            ? []
            : await tx
                .select({ id: automationRules.id, label: automationRules.name, assetId: automationRules.assetId })
                .from(automationRules)
                .where(and(inArray(automationRules.id, ruleIds), eq(automationRules.organizationId, organizationId)));
        return [
          ...assetRows.map((row) => ({ kind: "asset" as const, organizationId, ...row })),
          ...locationRows.map((row) => ({ kind: "location" as const, organizationId, ...row })),
          ...ruleRows.map((row) => ({ kind: "rule" as const, organizationId, ...row })),
        ];
      }),
    coveredAssetCount: (organizationId, locationIds) =>
      withTenant(db, organizationId, async (tx) => {
        const subtree = await expandLocationSubtrees(tx, { organizationIds: [organizationId], ids: [...locationIds] });
        if (subtree.length === 0) return 0;
        const [row] = await tx
          .select({ n: count() })
          .from(assets)
          .where(and(eq(assets.organizationId, organizationId), inArray(assets.locationId, subtree)));
        return Number(row?.n ?? 0);
      }),
    windowIn: (organizationId, id) =>
      withTenant(db, organizationId, async (tx) => {
        const [window] = await tx
          .select({
            id: maintenanceWindows.id,
            reason: maintenanceWindows.reason,
            startsAt: maintenanceWindows.startsAt,
            endsAt: maintenanceWindows.endsAt,
            state: windowStateSql,
          })
          .from(maintenanceWindows)
          .where(and(eq(maintenanceWindows.id, id), eq(maintenanceWindows.organizationId, organizationId)))
          .limit(1);
        if (!window) return null;
        const rows = await tx
          .select({
            assetId: maintenanceWindowTargets.assetId,
            locationId: maintenanceWindowTargets.locationId,
            ruleId: maintenanceWindowTargets.ruleId,
            ruleAssetId: automationRules.assetId,
            assetLabel: assets.name,
            locationLabel: locations.name,
            ruleLabel: automationRules.name,
          })
          .from(maintenanceWindowTargets)
          .leftJoin(assets, eq(assets.id, maintenanceWindowTargets.assetId))
          .leftJoin(locations, eq(locations.id, maintenanceWindowTargets.locationId))
          .leftJoin(automationRules, eq(automationRules.id, maintenanceWindowTargets.ruleId))
          .where(and(eq(maintenanceWindowTargets.windowId, id), eq(maintenanceWindowTargets.organizationId, organizationId)));
        const targets: LabelledWindowTarget[] = rows.map((row) =>
          row.assetId !== null
            ? { kind: "asset", id: row.assetId, organizationId, label: row.assetLabel ?? "" }
            : row.locationId !== null
              ? { kind: "location", id: row.locationId, organizationId, label: row.locationLabel ?? "" }
              : { kind: "rule", id: row.ruleId as string, organizationId, assetId: row.ruleAssetId, label: row.ruleLabel ?? "" },
        );
        return {
          id: window.id,
          organizationId,
          reason: window.reason,
          startsAt: window.startsAt.toISOString(),
          endsAt: window.endsAt.toISOString(),
          state: window.state,
          targets,
        };
      }),
  };
}
