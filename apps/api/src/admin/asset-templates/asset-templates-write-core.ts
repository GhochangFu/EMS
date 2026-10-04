import { BadRequestException } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import { assetTemplates } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { resolveActorId } from "../../auth/identity-resolver";
import { CalcParametersService } from "../../calc/calc-parameters.service";
import type { BmsTx } from "../../database/tenant-context";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertCanAuthor,
  assertContentRefsResolve,
  assertParameterKeysKnown,
  assertPointKeysActive,
  assertTemplateAlarmVocabularies,
  assertTransition,
  fetchTemplateRow,
  loadTemplatePoints,
  parseStoredContentForPublish,
  replacePoints,
  type TemplateRow,
} from "./asset-templates-write-guards";
import type { CreateAssetTemplateBody } from "./asset-templates.schema";
import type { StockImportStamp } from "./stock-catalog/types";

/**
 * `F3.22` PR 1 (ADR 0091 decision 1) — the transaction-aware cores of template
 * create and publish.
 *
 * Each takes the caller's `tx` (opened by `withTenant` for the template's
 * organization) and reads **every guard** through it: the template row, its
 * points, and the point-key catalog. A row written earlier in the same
 * uncommitted transaction — a point key, a draft, its points — is therefore
 * visible to the guard. That is what lets one onboarding commit create,
 * publish and instantiate a template (PR 2); a guard on `fleetDb` would refuse
 * a key or a draft the same commit had just written.
 *
 * `AssetTemplatesAdminService.create`/`publish` are thin wrappers over these;
 * guard order, error texts and audit rows are unchanged.
 *
 * Reads that stay off `tx`, on purpose: `accessControl.*` (the auth pool),
 * `vocabularies.*` (fleet vocabularies no commit writes), `calcParameters`
 * (fleet vocabulary), and `resolveActorId(deps.fleetDb, jwt)` — an identity
 * read, not a guard (`bms.users` is `FORCE`d; see the service's
 * `resolveCreatedBy`).
 */
export interface TemplateWriteCoreDeps {
  /** ONE use: `resolveActorId(deps.fleetDb, jwt)` — an identity read, not a guard. */
  readonly fleetDb: BmsDb;
  readonly accessControl: AccessControlService;
  readonly audit: MasterDataAuditService;
  readonly vocabularies: VocabulariesService;
  readonly calcParameters: CalcParametersService;
}

/**
 * A new draft version of `body.code`, at `max(version) + 1`, written on `tx`.
 * Returns the inserted row. See `AssetTemplatesAdminService.create` for the
 * versioning and `stamp` rules.
 */
export async function createTemplateCore(
  deps: TemplateWriteCoreDeps,
  tx: BmsTx,
  jwt: JwtPayload,
  body: CreateAssetTemplateBody,
  stamp?: StockImportStamp,
): Promise<TemplateRow> {
  await assertCanAuthor(deps.accessControl, jwt, body.organizationId);
  await assertPointKeysActive(tx, body.points);
  await assertParameterKeysKnown(deps.calcParameters, body.points, body.content?.kpis);
  // ADR 0031 Amendment 1. Checked here rather than at instantiation because
  // that is where the value is *chosen*: a template stores this domain and
  // stamps it onto every asset built from it, so a bad code caught later
  // surfaces on someone else's batch, long after the form that set it.
  await deps.vocabularies.assertAssetDomain(body.domain);
  await assertTemplateAlarmVocabularies(deps.vocabularies, body.content);
  if (body.content) {
    assertContentRefsResolve(body.content, body.points);
  }
  const createdBy = await resolveActorId(deps.fleetDb, jwt);

  const [{ maxVersion }] = await tx
    .select({ maxVersion: sql<number | null>`MAX(${assetTemplates.version})` })
    .from(assetTemplates)
    .where(
      and(
        eq(assetTemplates.organizationId, body.organizationId),
        eq(assetTemplates.code, body.code),
      ),
    );

  const [row] = await tx
    .insert(assetTemplates)
    .values({
      organizationId: body.organizationId,
      code: body.code,
      version: (maxVersion ?? 0) + 1,
      name: body.name,
      assetType: body.assetType,
      domain: body.domain,
      description: body.description ?? null,
      status: "draft",
      content: body.content ?? {},
      // Both or neither — `asset_templates_stock_stamp_check` holds it.
      stockCode: stamp?.stockCode ?? null,
      stockVersion: stamp?.stockVersion ?? null,
      createdBy,
    })
    .returning();

  await replacePoints(tx, row.id, body.organizationId, body.points);

  // E7.1c (item D): in this transaction so the stamped organizationId matches
  // the GUC the strict WITH CHECK demands. Safe inside the wrapper's `.catch`:
  // translateDraftConflict only rewrites a `23505` on
  // `asset_templates_org_code_draft_unique` and returns any other error
  // (including one from this insert) unchanged.
  //
  // ONE row either way: an import is audited as an import, not as a create
  // followed by an import.
  await deps.audit.write(
    {
      actor: jwt,
      action: stamp ? "master.asset_template.import" : "master.asset_template.create",
      entityType: "asset_template",
      entityId: row.id,
      organizationId: body.organizationId,
      reason: stamp ? `stock ${stamp.stockCode} v${stamp.stockVersion}` : undefined,
      payload: { code: body.code, version: row.version, points: body.points.length },
    },
    tx,
  );
  return row;
}

/**
 * Publishes the draft `id`, on `tx`, and returns the updated row. See
 * `AssetTemplatesAdminService.publish` for why point keys and content are
 * re-proved here. Guard order: 404, 403, 409, then the 400s.
 */
export async function publishTemplateCore(
  deps: TemplateWriteCoreDeps,
  tx: BmsTx,
  jwt: JwtPayload,
  id: string,
): Promise<TemplateRow> {
  const template = await fetchTemplateRow(tx, id);
  await assertCanAuthor(deps.accessControl, jwt, template.organizationId);
  assertTransition(template, "published");

  const points = await loadTemplatePoints(tx, id);
  if (points.length === 0) {
    throw new BadRequestException(
      "A template with no points would instantiate assets with no telemetry mapping",
    );
  }
  await assertPointKeysActive(tx, points);
  const storedContent = parseStoredContentForPublish(template);
  await assertParameterKeysKnown(deps.calcParameters, points, storedContent.kpis);
  assertContentRefsResolve(storedContent, points);

  // ADR 0032. Publish used to get this for free: the stored-content parse ran
  // the schema, and while `severity` and `category` were `z.enum`s the schema
  // was the vocabulary check. Both are codes now, so the schema passes a stored
  // value that no vocabulary row backs, and without this line a pre-ADR row
  // could be published carrying an alarm the rule engine cannot run.
  //
  // `create` and `update` already check the *incoming* body; the gap was only
  // ever on stored content, which is exactly what publish reads.
  await assertTemplateAlarmVocabularies(deps.vocabularies, storedContent);

  const now = new Date();
  const [updated] = await tx
    .update(assetTemplates)
    .set({ status: "published", publishedAt: now, updatedAt: now })
    .where(eq(assetTemplates.id, id))
    .returning();

  await deps.audit.write(
    {
      actor: jwt,
      action: "master.asset_template.publish",
      entityType: "asset_template",
      entityId: id,
      organizationId: template.organizationId,
      payload: { code: template.code, version: template.version },
    },
    tx,
  );
  return updated;
}
