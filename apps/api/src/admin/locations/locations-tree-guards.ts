import { BadRequestException, ConflictException, type HttpException } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import { locations } from "@bms/db";
import { LOCATION_TREE_MAX_DEPTH } from "@bms/shared";
import type { LocationWriteRefusalReason } from "@bms/shared";

import {
  expandLocationSubtrees,
  locationDepthAndHeight,
} from "../../auth/location-tree";
import type { BmsTx } from "../../database/tenant-context";

/**
 * `F2.10` / ADR 0098 decision 5, Drafter choices 2–3 and Amendment 1 (A1, A3,
 * A5, C) — the checks the locations admin service runs before a tree write,
 * and the mapping of the same refusals when migration `0103`'s
 * `bms.locations_tree_guard` trigger raises them first.
 *
 * The service's pre-checks give the caller a sentence; the trigger is the
 * control that holds against a race and against a writer that skips the
 * service. Both answer with one body, `{ message, reason }`.
 */

const SENTENCES: Record<LocationWriteRefusalReason, string> = {
  location_parent_not_found: "Parent location not found",
  location_parent_cycle: "A location cannot be placed under itself or one of its descendants",
  location_depth_exceeded: `A location tree may be at most ${LOCATION_TREE_MAX_DEPTH} levels deep`,
  location_parent_inactive: "The parent location is inactive",
  location_has_active_children: "Cannot deactivate a location with active child locations",
  location_inactive: "The location is inactive",
};

const BAD_REQUEST_REASONS: ReadonlySet<LocationWriteRefusalReason> = new Set([
  "location_parent_not_found",
  "location_parent_cycle",
  "location_depth_exceeded",
]);

/** The reasons the trigger raises; `location_parent_not_found` and `location_inactive` are the service's alone. */
const TRIGGER_REASONS: ReadonlySet<string> = new Set<LocationWriteRefusalReason>([
  "location_parent_cycle",
  "location_depth_exceeded",
  "location_parent_inactive",
  "location_has_active_children",
]);

const CHECK_VIOLATION = "23514";
const TREE_GUARD_CONSTRAINT = "locations_tree_guard";

/** The refusal for `reason`: 400 for a shape the tree cannot take, 409 for a state it is in. */
export function refusal(reason: LocationWriteRefusalReason): BadRequestException | ConflictException {
  const body = { message: SENTENCES[reason], reason };
  return BAD_REQUEST_REASONS.has(reason) ? new BadRequestException(body) : new ConflictException(body);
}

/**
 * The trigger's refusal (SQLSTATE `23514`, `CONSTRAINT = 'locations_tree_guard'`,
 * the reason code as the message) as the exception the pre-check would have
 * thrown, or `undefined` when `err` is anything else — the caller rethrows it.
 * Reads `code`, `constraint` and `message` from one object: the driver error,
 * or a wrapper's `cause` when the wrapper carries no `code`.
 */
export function treeGuardRefusal(err: unknown): HttpException | undefined {
  const direct = err as { code?: unknown; cause?: unknown } | null | undefined;
  if (direct === null || typeof direct !== "object") {
    return undefined;
  }
  const source = (typeof direct.code === "string" ? direct : direct.cause) as
    | { code?: unknown; constraint?: unknown; message?: unknown }
    | null
    | undefined;
  if (source === null || typeof source !== "object") {
    return undefined;
  }
  if (source.code !== CHECK_VIOLATION || source.constraint !== TREE_GUARD_CONSTRAINT) {
    return undefined;
  }
  if (typeof source.message !== "string" || !TRIGGER_REASONS.has(source.message)) {
    return undefined;
  }
  return refusal(source.message as LocationWriteRefusalReason);
}

/**
 * Whether placing a subtree of `height` under a parent at `parentDepth` passes
 * `LOCATION_TREE_MAX_DEPTH`. Fails closed: an unknown or non-finite depth or
 * height is "exceeded", never a comparison that `NaN` turns false.
 */
export function depthExceeded(parentDepth: number | null | undefined, height: number): boolean {
  if (typeof parentDepth !== "number" || !Number.isFinite(parentDepth) || !Number.isFinite(height)) {
    return true;
  }
  return parentDepth + height > LOCATION_TREE_MAX_DEPTH;
}

/** The advisory-lock key migration `0103`'s trigger hashes for an organization. */
export function locationTreeLockKey(organizationId: string): string {
  return `locations_tree:${organizationId}`;
}

/**
 * Takes the organization's tree lock for the rest of `tx` — the lock the
 * trigger takes, so the pre-checks below read a tree no concurrent tree
 * write in the same organization can change before this transaction ends.
 */
export async function takeLocationTreeLock(tx: BmsTx, organizationId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(pg_catalog.hashtextextended(${locationTreeLockKey(organizationId)}, 0))`,
  );
}

/**
 * Decision 5 and Drafter choice 2 for placing `nodeId` (or a new node, when
 * `null`) under `parentId`, in the order A3 rules: the parent, read `FOR SHARE`
 * (A5) in the caller's organization — absent or foreign is one answer,
 * `location_parent_not_found`, so the check is no existence oracle; then the
 * cycle; then the depth; then an active node under an inactive parent.
 */
export async function assertParentPlacement(
  tx: BmsTx,
  input: { organizationId: string; nodeId: string | null; parentId: string; nodeActive: boolean },
): Promise<void> {
  const [parent] = await tx
    .select({ id: locations.id, active: locations.active })
    .from(locations)
    .where(and(eq(locations.id, input.parentId), eq(locations.organizationId, input.organizationId)))
    .for("share");
  if (!parent) {
    throw refusal("location_parent_not_found");
  }

  if (input.nodeId !== null) {
    if (input.nodeId === input.parentId) {
      throw refusal("location_parent_cycle");
    }
    const subtree = await expandLocationSubtrees(tx, { organizationIds: [input.organizationId], ids: [input.nodeId] });
    if (subtree.includes(input.parentId)) {
      throw refusal("location_parent_cycle");
    }
  }

  const organizationIds = [input.organizationId];
  const parentShape = await locationDepthAndHeight(tx, { organizationIds, id: input.parentId });
  const height =
    input.nodeId === null
      ? 1
      : (await locationDepthAndHeight(tx, { organizationIds, id: input.nodeId }))?.height ?? Number.NaN;
  if (depthExceeded(parentShape?.depth, height)) {
    throw refusal("location_depth_exceeded");
  }

  if (input.nodeActive && !parent.active) {
    throw refusal("location_parent_inactive");
  }
}

/** Decision 5 (d): a node with an active child may not be deactivated. */
export async function assertNoActiveChildren(tx: BmsTx, nodeId: string, organizationId: string): Promise<void> {
  const [child] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.parentId, nodeId),
        eq(locations.organizationId, organizationId),
        eq(locations.active, true),
      ),
    )
    .limit(1);
  if (child) {
    throw refusal("location_has_active_children");
  }
}
