import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";

/**
 * `F3.85` PR 7 / ADR 0099 decision 10 — which organizations one read tool
 * call may read, and which organization a resource named by id belongs to.
 *
 * Every read tool goes through these two helpers, so the isolation lives in
 * one place:
 *
 * - **A list tool** loops over `targetOrganizations(...)` and nothing else.
 *   An empty array means **zero service calls**: every service the tools use
 *   reads the whole fleet when it is called with no organization and no asset
 *   filter, so a call with `organizationId: undefined` is never made.
 * - **A resource named by id** is placed in an organization with the
 *   caller's own read scope (`readableAssetIdsInOrganization`, which
 *   intersects `readableAssetIds` for anyone but the global admin) **before**
 *   any service reads it. For the global admin `canReadAsset` is true for
 *   every asset, so this membership check is the only thing that keeps an
 *   asset of an own-key organization away from the platform provider.
 */

export const COPILOT_TOOL_ORGANIZATION_OUT_OF_SCOPE =
  "That organization is outside the organizations this conversation may read.";

/**
 * The refusal for an organization outside the allowed set. It names the ids the
 * model may use (they are this turn's own scope), so a model that invented an
 * id does not retry it until the call cap (live probe, 2026-10-11).
 */
export function organizationOutOfScope(allowed: readonly string[]): string {
  return allowed.length === 0
    ? `${COPILOT_TOOL_ORGANIZATION_OUT_OF_SCOPE} It may read no organization.`
    : `${COPILOT_TOOL_ORGANIZATION_OUT_OF_SCOPE} Omit organizationId, or use one of: ${allowed.join(", ")}.`;
}

export const COPILOT_TOOL_RECORD_OUT_OF_SCOPE =
  "That record was not found in the organizations this conversation may read.";

/**
 * One list result names at most this many items across every organization it
 * read. Lower than `TOOL_LIST_MAX_ITEMS`: a contract row is wide, and
 * `toolResultContent` cuts the JSON at 8,000 characters, so a longer list
 * would reach the model cut mid-row. `truncated` tells the model there is more.
 */
export const COPILOT_TOOL_LIST_MAX_ITEMS = 25;

export type TargetOrganizations = { readonly ok: true; readonly ids: readonly string[] } | { readonly ok: false; readonly error: string };

/**
 * The organizations a list tool reads: the requested one when it is in the
 * allowed set, every member of the allowed set when none is requested (one
 * member: that member), and a refusal for one outside the set.
 */
export function targetOrganizations(requested: string | undefined, allowed: readonly string[]): TargetOrganizations {
  if (requested !== undefined) {
    return allowed.includes(requested) ? { ok: true, ids: [requested] } : { ok: false, error: organizationOutOfScope(allowed) };
  }
  return { ok: true, ids: [...allowed] };
}

/**
 * The organization of an asset, looked up with the caller's read scope and
 * only among `candidates` (members of the allowed set). `null` when the caller
 * cannot read it or it belongs to an organization outside `candidates`.
 */
export async function organizationOfAsset(
  access: Pick<AccessControlService, "readableAssetIdsInOrganization">,
  user: JwtPayload,
  candidates: readonly string[],
  assetId: string,
): Promise<string | null> {
  for (const organizationId of candidates) {
    const readable = await access.readableAssetIdsInOrganization(user, organizationId);
    if (readable.includes(assetId)) return organizationId;
  }
  return null;
}
