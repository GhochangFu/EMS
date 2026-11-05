import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { assets, assetTemplates } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { canInstantiate, type JwtPayload, TEMPLATE_ADOPTION_MAX_ASSETS, type TemplateLifecycleStatus } from "@bms/shared";
import type { CatalogEntry } from "@bms/shared/copilot";

import {
  alreadyPinnedMessage,
  domainMismatchMessage,
  organizationMismatchMessage,
} from "../admin/asset-templates/asset-templates-adopt-messages";
import type { AccessControlService } from "../auth/access-control.service";
import { withTenant } from "../database/tenant-context";
import { lifecycleStatusOf } from "./copilot-target-kinds";
import { CopilotTargetRefusal } from "./copilot-telemetry-targets";

/**
 * `F4.312` PR 2 (ADR 0099 Amendment 12) — the reads and the gate behind the
 * resolver's `assetTemplateAdopt` target, kept out of
 * `copilot-target-resolver.ts` for the AGENTS.md §4.5 line cap (the
 * `copilot-calc-point-targets.ts` shape).
 *
 * The target mirrors `AssetTemplateAdoptionService.buildPlan`'s access chain
 * (migrate's, ADR 0109 Amendment 1 A10) and the planner's batch-level
 * refusals, so a card the route could only refuse is never shown.
 *
 * `F4.315` PR A (ADR 0099 Amendment 14 decisions 2–3): a refusal names its
 * cause when the caller may see the records — a published version in scope
 * and listed assets all in the caller's scope, where one is already pinned,
 * of another domain, or of another allowed organization than the version —
 * as a {@link CopilotTargetRefusal} carrying the route's own sentence
 * (`asset-templates-adopt-messages.ts`). A version or asset id that does not
 * exist, or that is outside the caller's organizations or write scope, keeps
 * the one refusal (`null`), so the copilot never shows that a record it may
 * not see exists; a non-UUID id gets {@link adoptMalformedIdMessage} before
 * any read. The status is the lifecycle mirror's (`F4.246`). The route's
 * point-level refusals (A4, A8, …) stay a Confirm-time 409.
 */

/** The access checks the adopt gate asks; specs pass a fake. */
export type AdoptAccess = Pick<AccessControlService, "requireMasterDataUser" | "canManageOrganization" | "writableLocationIds">;

/** A listed asset as the target reads it: only what the batch-level checks and their sentences need. */
export type AdoptAssetRow = {
  readonly id: string;
  readonly code: string;
  readonly organizationId: string;
  readonly domain: string;
  readonly templateId: string | null;
  readonly locationId: string | null;
};

/** The version the path names, as the target reads it. */
export type AdoptTemplateRow = {
  readonly organizationId: string;
  readonly name: string;
  readonly code: string;
  readonly version: number;
  readonly domain: string;
  readonly status: string;
};

/** Amendment 14 decision 3: the sentence for an id that is not a record id (not a UUID). */
export function adoptMalformedIdMessage(id: string): string {
  return `"${id.slice(0, 80)}" is not a record id. Find the version with list_asset_templates, or the asset with list_assets.`;
}

const recordId = z.string().uuid();

/** Throws {@link adoptMalformedIdMessage} for an id that is not a UUID. */
function requireRecordId(id: string): void {
  if (!recordId.safeParse(id).success) throw new CopilotTargetRefusal(adoptMalformedIdMessage(id));
}

/**
 * `F4.315` PR A review (decision 3) — the propose tool's *argument guard* for an
 * adopt entry takes its path id as a bounded string rather than the catalog's
 * `uuidParam`, so a non-UUID id reaches {@link adoptMalformedIdRefusal} and the
 * model reads decision 3's sentence instead of "Invalid arguments: id: Invalid
 * uuid". The catalog entry, the definition the model is shown (`format: uuid`)
 * and the route are unchanged (decision 4); any other entry gets `{}`.
 */
export function adoptGuardParams(entry: CatalogEntry): Record<string, z.ZodTypeAny> {
  return entry.target.kind === "assetTemplateAdopt" ? { [entry.target.param]: z.string().min(1).max(256) } : {};
}

/**
 * `F4.315` PR A review (decision 3): for an adopt entry, the malformed sentence for
 * the first path id or `assetIds` item that is a string but not a UUID — checked
 * before the body parse, whose `.uuid()` would answer "Invalid body" first — or
 * `null` (any other entry, or no such id).
 */
export function adoptMalformedIdRefusal(entry: CatalogEntry, params: Record<string, string>, body: unknown): string | null {
  if (entry.target.kind !== "assetTemplateAdopt") return null;
  const ids = (body as Record<string, unknown> | null)?.[entry.target.field];
  const listed = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  const malformed = [params[entry.target.param], ...listed].find((id) => id !== undefined && !recordId.safeParse(id).success);
  return malformed === undefined ? null : adoptMalformedIdMessage(malformed);
}

/**
 * The body's `assetIds`, or `null` when it is not a non-empty array of at most
 * `TEMPLATE_ADOPTION_MAX_ASSETS` strings with none twice — refused before any
 * read, as the body schema refuses it at the route. A string that is not a
 * UUID throws {@link adoptMalformedIdMessage} (Amendment 14 decision 3).
 */
export function adoptAssetIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > TEMPLATE_ADOPTION_MAX_ASSETS) return null;
  if (ids.some((id) => typeof id !== "string")) return null;
  const assetIds = ids as string[];
  if (new Set(assetIds).size !== assetIds.length) return null;
  assetIds.forEach(requireRecordId);
  return assetIds;
}

/**
 * Why a batch is refused: `general` is the one refusal (an id no read
 * returned, or an asset outside the caller's write scope — decision 3); the
 * other three name the asset (decision 2).
 */
export type AdoptBatchRefusal =
  | { readonly kind: "general" }
  | { readonly kind: "already_pinned" | "organization_mismatch" | "domain_mismatch"; readonly asset: AdoptAssetRow };

/**
 * Why the read rows refuse the batch, or `null` when they admit it. First, over
 * every listed id, the one refusal: an id no read returned, or a row at a site
 * outside the caller's write scope (`writable`, `null` for a global
 * administrator — the route's `F4.64` count refusal). Only when every asset is
 * in scope, the first asset's cause in the route's order: pinned to a template
 * (A7), of another organization than the version, of another domain (A1).
 */
export function adoptBatchRefusal(
  template: Pick<AdoptTemplateRow, "organizationId" | "domain">,
  assetIds: readonly string[],
  rows: readonly AdoptAssetRow[],
  writable: readonly string[] | null,
): AdoptBatchRefusal | null {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const listed = assetIds.map((id) => byId.get(id));
  const inScope = (row: AdoptAssetRow | undefined): row is AdoptAssetRow =>
    row !== undefined && (writable === null || (row.locationId !== null && writable.includes(row.locationId)));
  if (!listed.every(inScope)) return { kind: "general" };
  for (const asset of listed as AdoptAssetRow[]) {
    if (asset.templateId !== null) return { kind: "already_pinned", asset };
    if (asset.organizationId !== template.organizationId) return { kind: "organization_mismatch", asset };
    if (asset.domain !== template.domain) return { kind: "domain_mismatch", asset };
  }
  return null;
}

/** A named refusal's sentence: the route's own (`asset-templates-adopt-messages.ts`), naming the asset and the version. */
export function adoptRefusalSentence(
  refusal: Exclude<AdoptBatchRefusal, { kind: "general" }>,
  template: Pick<AdoptTemplateRow, "code" | "version" | "domain">,
): string {
  if (refusal.kind === "already_pinned") return alreadyPinnedMessage(refusal.asset, template);
  if (refusal.kind === "organization_mismatch") return organizationMismatchMessage(refusal.asset, template);
  return domainMismatchMessage(refusal.asset, template);
}

/**
 * The version `templateId` names, looked for in each allowed organization in
 * turn under `withTenant` with an explicit organization filter, or `null` when
 * none holds it. Its status is returned, not judged: the propose tool's
 * lifecycle mirror refuses an unpublished one.
 */
export async function findAdoptTemplate(
  tenantDb: BmsDb,
  templateId: string,
  allowed: readonly string[],
): Promise<AdoptTemplateRow | null> {
  for (const organizationId of allowed) {
    const [row] = await withTenant(tenantDb, organizationId, (tx) =>
      tx
        .select({
          name: assetTemplates.name,
          code: assetTemplates.code,
          version: assetTemplates.version,
          domain: assetTemplates.domain,
          status: assetTemplates.status,
        })
        .from(assetTemplates)
        .where(and(eq(assetTemplates.id, templateId), eq(assetTemplates.organizationId, organizationId)))
        .limit(1),
    );
    if (row) return { organizationId, ...row };
  }
  return null;
}

const adoptAssetColumns = {
  id: assets.id,
  code: assets.code,
  organizationId: assets.organizationId,
  domain: assets.domain,
  templateId: assets.templateId,
  locationId: assets.locationId,
};

/** The listed assets of the version's organization, under `withTenant` with an explicit organization filter. */
async function readAdoptAssets(tenantDb: BmsDb, organizationId: string, assetIds: readonly string[]): Promise<AdoptAssetRow[]> {
  return withTenant(tenantDb, organizationId, (tx) =>
    tx
      .select(adoptAssetColumns)
      .from(assets)
      .where(and(inArray(assets.id, [...assetIds]), eq(assets.organizationId, organizationId))),
  );
}

/**
 * Amendment 14 decision 2: the listed assets the version's organization does
 * not hold, looked for in each other allowed organization in turn (the
 * {@link findAdoptTemplate} loop) with one read per organization over the ids
 * still missing, until none is. Returns the rows found; an id no organization
 * holds is absent from them.
 */
export async function findAssetsElsewhere(
  tenantDb: BmsDb,
  assetIds: readonly string[],
  allowed: readonly string[],
  except: string,
): Promise<AdoptAssetRow[]> {
  const found: AdoptAssetRow[] = [];
  let missing = [...assetIds];
  for (const organizationId of allowed) {
    if (missing.length === 0) break;
    if (organizationId === except) continue;
    const rows = await readAdoptAssets(tenantDb, organizationId, missing);
    found.push(...rows);
    missing = missing.filter((id) => !rows.some((row) => row.id === id));
  }
  return found;
}

/** What the target resolves to: the version, its organization and its lifecycle status (when in the vocabulary). */
export type AdoptTarget = { organizationId: string; name: string; status?: TemplateLifecycleStatus };

/**
 * The `assetTemplateAdopt` target, `null` (the one refusal), or a thrown
 * {@link CopilotTargetRefusal} naming the cause. The order is the route's: the
 * version id and the body's ids (before any read; a non-UUID one is the
 * malformed sentence);
 * `requireMasterDataUser` (a throw is the refusal); the version in the allowed
 * set; `canManageOrganization` on the version's organization; then, on a
 * **published** version only, the listed assets ({@link adoptBatchRefusal},
 * with `writableLocationIds`; an id the version's organization does not hold
 * is looked for in the other allowed organizations, {@link findAssetsElsewhere}).
 *
 * The status is returned, not judged (`F4.246`): an in-scope draft or archived
 * version resolves with its status, and the propose tool's lifecycle mirror
 * (`copilot-template-lifecycle.ts`, `assetTemplate.adopt`) refuses it with the
 * route's own sentence. Its assets are not checked, as the route answers that
 * 409 before it reads them.
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
): Promise<AdoptTarget | null> {
  if (checkAssets) requireRecordId(templateId);
  const assetIds = checkAssets ? adoptAssetIds(ids) : [];
  if (assetIds === null) return null;
  if ((await falseOnThrow(() => access.requireMasterDataUser(user))) === false) return null;
  const template = await findAdoptTemplate(tenantDb, templateId, allowed);
  if (template === null) return null;
  if (!(await falseOnThrow(() => access.canManageOrganization(user, template.organizationId)))) return null;
  const lifecycle = lifecycleStatusOf(template.status);
  const resolved: AdoptTarget = { organizationId: template.organizationId, name: template.name, ...lifecycle };
  if (!checkAssets || lifecycle.status === undefined || !canInstantiate(lifecycle.status)) return resolved;
  const rows = await readAdoptAssets(tenantDb, template.organizationId, assetIds);
  const writable = await falseOnThrow(() => access.writableLocationIds(user));
  if (writable === false) return null;
  const missing = assetIds.filter((listed) => !rows.some((row) => row.id === listed));
  if (missing.length > 0) rows.push(...(await findAssetsElsewhere(tenantDb, missing, allowed, template.organizationId)));
  const refusal = adoptBatchRefusal(template, assetIds, rows, writable);
  if (refusal === null) return resolved;
  if (refusal.kind === "general") return null;
  // `F4.315` PR A review (decision 10): the version's organization, and the asset's when it is another.
  const named = [...new Set([template.organizationId, refusal.asset.organizationId])];
  throw new CopilotTargetRefusal(adoptRefusalSentence(refusal, template), named);
}

/** An access check's answer, or `false` when it throws (a 403 is the one refusal). */
async function falseOnThrow<T>(check: () => Promise<T>): Promise<T | false> {
  try {
    return await check();
  } catch {
    return false;
  }
}
